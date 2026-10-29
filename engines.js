// engines.js — 브라우저에서 불러오는 AI 엔진 3종
//  1) Spotify Basic Pitch (음정 인식 신경망, TensorFlow.js)
//  2) Google MediaPipe Hand Landmarker (손가락 관절 인식)
//  3) Google Gemini API (사용자 API 키로 직접 호출)
// 셋 다 실패해도 앱은 신호 분석만으로 동작하도록, 모든 함수는 실패 시 예외를 던지고 호출 쪽에서 대체합니다.

export const log = [];
function note(msg) { const line = new Date().toLocaleTimeString() + ' ' + msg; log.push(line); if (log.length > 200) log.shift(); console.log('[engines]', msg); }

// ------------------------------------------------------------------ 1) Basic Pitch
const BP_VER = '1.0.1';
const BP_SOURCES = [
  `https://cdn.jsdelivr.net/npm/@spotify/basic-pitch@${BP_VER}/+esm`,
  `https://esm.sh/@spotify/basic-pitch@${BP_VER}`,
];
const BP_MODEL = [
  `https://cdn.jsdelivr.net/npm/@spotify/basic-pitch@${BP_VER}/model/model.json`,
  `https://unpkg.com/@spotify/basic-pitch@${BP_VER}/model/model.json`,
];
let bpLib = null;
async function loadBP() {
  if (bpLib) return bpLib;
  let lastErr;
  for (const url of BP_SOURCES) {
    try { const m = await import(url); bpLib = m.default && m.default.BasicPitch ? m.default : m; note('Basic Pitch 불러옴: ' + url); return bpLib; }
    catch (e) { lastErr = e; note('Basic Pitch 불러오기 실패 (' + url + '): ' + e.message); }
  }
  throw new Error('음정 인식 AI를 불러오지 못했습니다: ' + (lastErr && lastErr.message));
}

/** 모노 신호를 22050Hz로 바꾸기 (Safari에서도 동작하는 OfflineAudioContext 사용) */
export async function resample(x, sr, target = 22050) {
  if (Math.abs(sr - target) < 1) return x;
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const len = Math.ceil(x.length * target / sr);
  const ctx = new OAC(1, len, target);
  const buf = ctx.createBuffer(1, x.length, sr);
  buf.getChannelData(0).set(x);
  const src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination); src.start();
  const out = await (ctx.startRendering.length ? new Promise(r => { ctx.oncomplete = e => r(e.renderedBuffer); ctx.startRendering(); }) : ctx.startRendering());
  return out.getChannelData(0).slice();
}

/**
 * 베이스 음표 인식. x: 모노 신호(저역 강조 권장), sr: 샘플레이트
 * 반환: [{start, end, midi, amp}] (다성 결과 — 호출 쪽에서 BassCore.bassLine으로 한 줄로 만듦)
 */
export async function basicPitchNotes(x, sr, opts = {}, onProgress) {
  const lib = await loadBP();
  const { BasicPitch, outputToNotesPoly, addPitchBendsToNoteEvents, noteFramesToTime } = lib;
  if (!BasicPitch || !outputToNotesPoly || !noteFramesToTime) throw new Error('음정 인식 AI 라이브러리 형식이 예상과 다릅니다');
  const audio = await resample(x, sr, 22050);
  let bp = null, lastErr;
  for (const url of BP_MODEL) {
    try { bp = new BasicPitch(url); await bp.model; note('모델: ' + url); break; }
    catch (e) { lastErr = e; bp = null; note('모델 불러오기 실패 (' + url + '): ' + e.message); }
  }
  if (!bp) throw new Error('음정 인식 모델 파일을 받지 못했습니다: ' + (lastErr && lastErr.message));
  const frames = [], onsets = [], contours = [];
  await bp.evaluateModel(audio, (f, o, c) => {
    for (const r of f) frames.push(r); for (const r of o) onsets.push(r); for (const r of c) contours.push(r);
  }, p => onProgress && onProgress(Math.min(1, p)));
  const onsetT = opts.onsetThresh ?? 0.3, frameT = opts.frameThresh ?? 0.22, minLen = opts.minLen ?? 5;
  const maxF = opts.maxFreq ?? 440, minF = opts.minFreq ?? 25;
  let ev = outputToNotesPoly(frames, onsets, onsetT, frameT, minLen, true, maxF, minF, true, 11);
  if (addPitchBendsToNoteEvents) { try { ev = addPitchBendsToNoteEvents(contours, ev); } catch (e) { /* 피치벤드 없이 진행 */ } }
  const tm = noteFramesToTime(ev);
  const out = tm.map(n => {
    const start = n.startTimeSeconds ?? n.startTime ?? 0, dur = n.durationSeconds ?? n.duration ?? 0;
    return { start, end: start + dur, midi: n.pitchMidi ?? n.pitch, amp: n.amplitude ?? 0.5 };
  }).filter(n => Number.isFinite(n.start) && Number.isFinite(n.midi));
  note(`음정 인식 AI: 음 ${out.length}개`);
  return out;
}

// ------------------------------------------------------------------ 2) MediaPipe 손 인식
const MP_VER = '0.10.14';
const MP_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VER}`;
const MP_MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
let hl = null;
export async function loadHands() {
  if (hl) return hl;
  const vision = await import(`${MP_BASE}/vision_bundle.mjs`);
  const fileset = await vision.FilesetResolver.forVisionTasks(`${MP_BASE}/wasm`);
  const make = delegate => vision.HandLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MP_MODEL, delegate },
    runningMode: 'IMAGE', numHands: 2,
    minHandDetectionConfidence: 0.3, minHandPresenceConfidence: 0.3, minTrackingConfidence: 0.3,
  });
  try { hl = await make('GPU'); note('손 인식: GPU'); }
  catch (e) { note('손 인식 GPU 실패, CPU로 전환: ' + e.message); hl = await make('CPU'); }
  return hl;
}
/** 이미지(캔버스)에서 손 찾기 → [{tips:[[x,y]..], all:[[x,y]...], side:'Left'|'Right', score}] (정규화 좌표) */
export function detectHands(source) {
  if (!hl) throw new Error('손 인식이 준비되지 않았습니다');
  const r = hl.detect(source);
  return (r.landmarks || []).map((lm, i) => ({
    all: lm.map(p => [p.x, p.y]),
    tips: [8, 12, 16, 20].map(k => [lm[k].x, lm[k].y]),
    pads: [7, 11, 15, 19].map(k => [lm[k].x, lm[k].y]),
    thumb: [lm[4].x, lm[4].y],
    side: r.handedness && r.handedness[i] && r.handedness[i][0] ? r.handedness[i][0].categoryName : '',
    score: r.handedness && r.handedness[i] && r.handedness[i][0] ? r.handedness[i][0].score : 0,
  }));
}

// ------------------------------------------------------------------ 3) Gemini
const G_BASE = 'https://generativelanguage.googleapis.com/v1beta';
export async function geminiModels(key) {
  const r = await fetch(`${G_BASE}/models?pageSize=200`, { headers: { 'x-goog-api-key': key } });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(geminiErr(r.status, d));
  const ms = (d.models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent') && /gemini/i.test(m.name) && !/(embedding|tts|image|live|native-audio|robotics|computer-use)/i.test(m.name));
  // 새 버전·pro 우선
  const ver = n => { const m = n.match(/gemini-(\d+(?:\.\d+)?)/); return m ? parseFloat(m[1]) : 0; };
  ms.sort((a, b) => ver(b.name) - ver(a.name) || (/pro/.test(b.name) - /pro/.test(a.name)) || (/preview|exp/.test(a.name) - /preview|exp/.test(b.name)));
  return ms.map(m => ({ id: m.name, label: (m.displayName || m.name.replace('models/', '')) }));
}
function geminiErr(status, d) {
  const m = d && d.error && d.error.message ? d.error.message : '';
  if (status === 400 && /API key/i.test(m)) return 'API 키가 올바르지 않습니다. AI Studio에서 키를 다시 복사해 주세요.';
  if (status === 403) return 'API 키에 이 기능 권한이 없습니다: ' + m;
  if (status === 429) return '사용 한도를 넘었습니다. 잠시 기다리거나 Flash 모델을 고르세요. (' + m.slice(0, 120) + ')';
  return `Gemini 오류 ${status}: ${m || '알 수 없는 오류'}`;
}
/** parts: [{text}|{inlineData:{mimeType,data}}|{fileData:{fileUri}}] */
export async function gemini(key, model, parts, { json = true, signal, temperature = 0.2 } = {}) {
  const body = { contents: [{ role: 'user', parts }], generationConfig: { temperature } };
  if (json) body.generationConfig.responseMimeType = 'application/json';
  const r = await fetch(`${G_BASE}/${model}:generateContent`, { method: 'POST', signal, headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(geminiErr(r.status, d));
  const c = d.candidates && d.candidates[0];
  if (!c) throw new Error('Gemini가 답하지 않았습니다' + (d.promptFeedback && d.promptFeedback.blockReason ? ' (' + d.promptFeedback.blockReason + ')' : ''));
  const text = (c.content && c.content.parts || []).filter(p => !p.thought && typeof p.text === 'string').map(p => p.text).join('');
  if (!json) return text;
  try { return JSON.parse(text); }
  catch (e) { const m = text.match(/\{[\s\S]*\}/); if (m) return JSON.parse(m[0]); throw new Error('Gemini 답을 읽지 못했습니다'); }
}
export const b64 = bytes => { let s = ''; const CH = 0x8000; for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH)); return btoa(s); };
export async function blobB64(blob) { return b64(new Uint8Array(await blob.arrayBuffer())); }
/** Float32 모노 → 16비트 WAV 바이트 */
export function wavBytes(x, sr) {
  const n = x.length, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  let pk = 1e-9; for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(x[i]));
  const g = 0.95 / pk;
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, Math.round(sr), true); v.setUint32(28, Math.round(sr) * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.max(-32767, Math.min(32767, Math.round(x[i] * g * 32767))), true);
  return new Uint8Array(buf);
}
