// app.js — 베이스 타브 노트 (GitHub Pages 버전)
import * as AI from './engines.js';
const C = window.BassCore;
const $ = id => document.getElementById(id);
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const nameOf = m => m == null ? 'x' : NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
const sName = m => NAMES[((m % 12) + 12) % 12];
const TUNINGS = [
  { id: '4std', label: '4현 · 표준 (E A D G)', open: [28, 33, 38, 43] },
  { id: '4dropd', label: '4현 · 드롭 D (D A D G)', open: [26, 33, 38, 43] },
  { id: '4half', label: '4현 · 반음 내림', open: [27, 32, 37, 42] },
  { id: '4whole', label: '4현 · 한음 내림', open: [26, 31, 36, 41] },
  { id: '5std', label: '5현 · 표준 (B E A D G)', open: [23, 28, 33, 38, 43] },
  { id: '5half', label: '5현 · 반음 내림', open: [22, 27, 32, 37, 42] },
  { id: '6std', label: '6현 · 표준 (B E A D G C)', open: [23, 28, 33, 38, 43, 48] },
];
TUNINGS.forEach(t => { const o = document.createElement('option'); o.value = t.id; o.textContent = t.label; $('tuning').appendChild(o); });
[[0, '너트 (0프렛)'], [1, '1프렛'], [3, '3프렛'], [5, '5프렛']].forEach(([v, l]) => $('fA').add(new Option(l, v)));
[[5, '5프렛'], [7, '7프렛'], [9, '9프렛'], [12, '12프렛'], [15, '15프렛'], [17, '17프렛']].forEach(([v, l]) => $('fB').add(new Option(l, v)));
$('fB').value = '12';

const store = {
  get(k, d) { try { const v = localStorage.getItem('bt.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('bt.' + k, JSON.stringify(v)); } catch (e) { /* 저장 안 됨 */ } },
};

// ------------------------------------------------------------------ 상태
const S = {
  file: null, isVideo: false, mediaUrl: null, audioBuf: null,
  result: null, notes: [], tuning: TUNINGS[0], bpm: 92, beats: 4, origin: 0, six: 60 / 92 / 4, firstBeat: 0, offset: 0,
  example: true, undo: [], playing: false, src: 'mix', bassBuffer: null, hit: [],
  cal: null,            // 지금 화면의 보정 {pts, fA, fB}
  keys: [],             // 저장된 보정 장면 [{t, pts, fA, fB}]
  handsPreview: null,
};
let uid = 1;
const toast = (msg, ms = 2600) => { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, ms); };
const logUI = () => { $('logbox').textContent = AI.log.join('\n'); };
const fmtTime = t => { t = Math.max(0, t || 0); return Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0'); };
const fmtTime1 = t => { t = Math.max(0, t || 0); return Math.floor(t / 60) + ':' + (t % 60).toFixed(1).padStart(4, '0'); };

// ------------------------------------------------------------------ 예시 악보
function loadExample() {
  const ex = [
    [0, 2, 1, 0], [2, 2, 1, 4, { tech: 'h' }], [4, 2, 2, 2], [6, 2, 2, 4], [8, 4, 2, 2, { slideOut: 'down' }], [12, 2, 1, 4], [14, 2, 1, 2, { tech: 'p' }],
    [16, 2, 0, 5], [18, 2, 0, 5, { ghost: true }], [20, 2, 1, 4, { slideIn: 'up' }], [22, 2, 1, 7, { tech: 's' }], [24, 4, 2, 7, { bend: 2, release: true }], [28, 2, 2, 5], [30, 2, null, null, { dead: true }],
    [32, 4, 1, 5, { vib: true }], [36, 2, 1, 5, { slap: true }], [38, 2, 3, 7, { pop: true }], [40, 2, 1, 5], [42, 2, 1, 12, { tech: 't' }], [44, 2, 1, 5, { tech: 'p' }], [46, 2, 3, 12, { harm: true }],
    [48, 8, 1, 0, { vib: true }], [56, 2, 0, 5], [58, 2, 0, 7, { cert: 0.4 }], [60, 4, 1, 4, { tech: 's' }],
  ];
  S.tuning = TUNINGS[0]; S.bpm = 92; S.beats = 4; S.six = 60 / S.bpm / 4; S.origin = 0;
  S.notes = ex.map(([slot, len, st, fr, x]) => {
    const n = { id: uid++, slot, len, string: st == null ? 1 : st, fret: fr, cert: 1, start: slot * S.six, dur: len * S.six, tech: null, ...(x || {}) };
    n.midi = n.dead ? null : S.tuning.open[n.string] + n.fret; return n;
  });
  S.example = true;
}

// ------------------------------------------------------------------ 파일
function setFile(f) {
  if (!f) return;
  S.file = f; S.isVideo = /^video\//.test(f.type) || /\.(mp4|mov|m4v|webm)$/i.test(f.name);
  $('fileName').textContent = f.name + ' · ' + (f.size / 1048576).toFixed(1) + ' MB';
  if (S.mediaUrl) URL.revokeObjectURL(S.mediaUrl);
  S.mediaUrl = URL.createObjectURL(f);
  S.audioBuf = null; S.keys = []; S.cal = null; renderKeys();
  $('title').value = f.name.replace(/\.[^.]+$/, '');
  $('cardVideo').hidden = !S.isVideo;
  $('stepSet').textContent = S.isVideo ? '3' : '2';
  if (S.isVideo) { vid.src = S.mediaUrl; vid.load(); } else { $('audio').src = S.mediaUrl; }
  $('btnAnalyze').disabled = false; $('btnAnalyze').textContent = '베이스 채보 시작';
  $('btnPlay').disabled = false;
}
$('file').addEventListener('change', e => setFile(e.target.files[0]));
const drop = $('drop');
['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', e => setFile(e.dataTransfer.files[0]));

// 설정
const bindOut = (id, out, fmt) => { const f = () => $(out).textContent = fmt(+$(id).value); $(id).addEventListener('input', f); f(); };
bindOut('hp', 'hpOut', v => v + ' Hz'); bindOut('lp', 'lpOut', v => v + ' Hz');
bindOut('sens', 'sensOut', v => v < 0.3 ? '낮음 (확실한 것만)' : v > 0.7 ? '높음 (레가토 많이)' : '보통');
bindOut('aiSens', 'aiSensOut', v => v < 0.3 ? '낮음 (확실한 음만)' : v > 0.7 ? '높음 (작은 음까지)' : '보통');
['engine', 'tuning', 'meter', 'sens', 'aiSens', 'hp', 'lp', 'maxFret'].forEach(id => { const v = store.get('opt.' + id, null); if (v != null) { $(id).value = v; $(id).dispatchEvent(new Event('input')); } $(id).addEventListener('change', () => store.set('opt.' + id, $(id).value)); });
$('showUnsure').addEventListener('change', render);
$('tuning').addEventListener('change', () => { S.tuning = TUNINGS.find(t => t.id === $('tuning').value); if (S.notes.length) { pushUndo(); refret(); render(); } });
$('meter').addEventListener('change', () => { S.beats = +$('meter').value; if (S.result) requantize(); else render(); });

// ------------------------------------------------------------------ 넥 보정 (모서리 4점, 원근 반영)
const vid = $('video'), cc = $('calibCanvas');
const defaultCal = () => ({ pts: [[0.12, 0.42], [0.12, 0.58], [0.62, 0.40], [0.62, 0.60]], fA: +$('fA').value, fB: +$('fB').value });
vid.addEventListener('loadedmetadata', () => {
  $('vScrub').max = vid.duration || 1;
  if (!S.cal) S.cal = defaultCal();
  seekTo(vid, Math.min(1, (vid.duration || 3) / 3)).then(drawCalib);
});
vid.addEventListener('seeked', () => { $('vScrub').value = vid.currentTime; drawCalib(); renderKeys(); });
$('vScrub').addEventListener('input', () => { vid.currentTime = +$('vScrub').value; });
$('vPrev').addEventListener('click', () => { vid.currentTime = Math.max(0, vid.currentTime - 1); });
$('vNext').addEventListener('click', () => { vid.currentTime = Math.min(vid.duration || 0, vid.currentTime + 1); });
$('fA').addEventListener('change', () => { if (S.cal) S.cal.fA = +$('fA').value; $('fALabel').textContent = $('fA').selectedOptions[0].textContent; drawCalib(); });
$('fB').addEventListener('change', () => { if (S.cal) S.cal.fB = +$('fB').value; $('fBLabel').textContent = $('fB').selectedOptions[0].textContent; drawCalib(); });
$('topIsLow').addEventListener('change', drawCalib);
const topIsLow = () => $('topIsLow').checked;

function curModel() {
  if (S.cal) return C.neckModel(S.cal);
  return null;
}
let drag = null, dragXY = null;
function drawCalib() {
  const r = cc.getBoundingClientRect(), dpr = devicePixelRatio || 1;
  cc.width = Math.max(1, Math.round(r.width * dpr)); cc.height = Math.max(1, Math.round(r.height * dpr));
  const c = cc.getContext('2d'); c.clearRect(0, 0, cc.width, cc.height);
  if (!S.cal) return;
  const W = cc.width, H = cc.height, m = curModel();
  const P = (u, v) => { const [x, y] = m.toImg(u, v); return [x * W, y * H]; };
  if (m) {
    const nStr = S.tuning.open.length, mg = 0.12;
    // 지판 테두리
    c.lineWidth = 1.5 * dpr; c.strokeStyle = 'rgba(142,168,255,.95)';
    const u24 = C.fretU(22);
    [[0, 0, u24, 0], [0, 1, u24, 1]].forEach(([u0, v0, u1, v1]) => { c.beginPath(); c.moveTo(...P(u0, v0)); for (let k = 1; k <= 20; k++) c.lineTo(...P(u0 + (u1 - u0) * k / 20, v0)); c.stroke(); });
    // 프렛
    for (let f = 0; f <= 22; f++) {
      const u = C.fretU(f);
      c.strokeStyle = f === S.cal.fA || f === S.cal.fB ? 'rgba(255,120,60,.95)' : 'rgba(255,214,0,.85)';
      c.lineWidth = (f === 0 ? 2.5 : 1.3) * dpr;
      c.beginPath(); c.moveTo(...P(u, 0)); c.lineTo(...P(u, 1)); c.stroke();
      if ([3, 5, 7, 9, 12, 15, 17, 19, 21].includes(f)) {
        const [x, y] = P((u + C.fretU(f - 1)) / 2, 0.5);
        c.fillStyle = 'rgba(255,214,0,.95)'; c.font = `${11 * dpr}px IBM Plex Mono, monospace`; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.beginPath(); c.arc(x, y, 3 * dpr, 0, 7); c.fill();
      }
    }
    // 줄
    for (let s = 0; s < nStr; s++) {
      const v = mg + (1 - 2 * mg) * (topIsLow() ? s : nStr - 1 - s) / (nStr - 1);
      c.strokeStyle = 'rgba(255,255,255,.55)'; c.lineWidth = 1 * dpr;
      c.beginPath(); c.moveTo(...P(0, v)); c.lineTo(...P(u24, v)); c.stroke();
      const [x, y] = P(-0.025, v); c.fillStyle = '#fff'; c.font = `600 ${11 * dpr}px IBM Plex Mono, monospace`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(sName(S.tuning.open[s]), x, y);
    }
  }
  // 손 인식 미리보기
  if (S.handsPreview && m) {
    S.handsPreview.forEach(h => {
      h.all.forEach(([x, y]) => { c.fillStyle = 'rgba(80,255,160,.7)'; c.beginPath(); c.arc(x * W, y * H, 2.5 * dpr, 0, 7); c.fill(); });
      h.tips.forEach(([x, y]) => {
        const b = C.tipToBoard(m, x, y, S.tuning.open.length, topIsLow());
        c.fillStyle = '#50ffa0'; c.beginPath(); c.arc(x * W, y * H, 5 * dpr, 0, 7); c.fill();
        if (b.u > -0.03 && b.u < 0.75 && b.v > -0.4 && b.v < 1.4) {
          const fr = Math.max(0, Math.ceil(b.f - 0.15)), st = Math.round(Math.min(S.tuning.open.length - 1, Math.max(0, b.s)));
          c.fillStyle = 'rgba(0,0,0,.7)'; c.fillRect(x * W + 6 * dpr, y * H - 18 * dpr, 52 * dpr, 16 * dpr);
          c.fillStyle = '#fff'; c.font = `${11 * dpr}px IBM Plex Mono, monospace`; c.textAlign = 'left'; c.textBaseline = 'middle';
          c.fillText(`${sName(S.tuning.open[st])}줄 ${fr}`, x * W + 9 * dpr, y * H - 10 * dpr);
        }
      });
    });
  }
  // 점
  S.cal.pts.forEach(([x, y], i) => {
    c.beginPath(); c.fillStyle = drag === i ? '#ff7a3c' : '#2f6bff'; c.strokeStyle = '#fff'; c.lineWidth = 2 * dpr;
    c.arc(x * W, y * H, 9 * dpr, 0, 7); c.fill(); c.stroke();
  });
  // 돋보기
  if (drag != null && dragXY && vid.videoWidth) {
    const [x, y] = S.cal.pts[drag], R = 64 * dpr, Z = 3;
    let cx = x * W, cy = y * H - R - 34 * dpr; if (cy < R + 4) cy = y * H + R + 34 * dpr;
    cx = Math.min(W - R - 4, Math.max(R + 4, cx));
    c.save(); c.beginPath(); c.arc(cx, cy, R, 0, 7); c.clip();
    const sw = vid.videoWidth * (2 * R / W) / Z, sh = vid.videoHeight * (2 * R / H) / Z;
    try { c.drawImage(vid, x * vid.videoWidth - sw / 2, y * vid.videoHeight - sh / 2, sw, sh, cx - R, cy - R, 2 * R, 2 * R); } catch (e) { /* 프레임 없음 */ }
    if (m) {
      // 돋보기 안에도 프렛·테두리 선 표시
      c.translate(cx - x * W * Z, cy - y * H * Z); c.scale(Z, Z);
      c.strokeStyle = 'rgba(255,214,0,.9)'; c.lineWidth = 1 * dpr / Z;
      for (let f = 0; f <= 22; f++) { const u = C.fretU(f); c.beginPath(); c.moveTo(...P(u, 0)); c.lineTo(...P(u, 1)); c.stroke(); }
      c.strokeStyle = 'rgba(142,168,255,.95)';
      [0, 1].forEach(v => { c.beginPath(); c.moveTo(...P(0, v)); c.lineTo(...P(C.fretU(22), v)); c.stroke(); });
      c.setTransform(1, 0, 0, 1, 0, 0);
    }
    c.restore();
    c.strokeStyle = '#fff'; c.lineWidth = 2 * dpr; c.beginPath(); c.arc(cx, cy, R, 0, 7); c.stroke();
    c.strokeStyle = '#ff7a3c'; c.lineWidth = 1.5 * dpr; c.beginPath(); c.moveTo(cx - 10 * dpr, cy); c.lineTo(cx + 10 * dpr, cy); c.moveTo(cx, cy - 10 * dpr); c.lineTo(cx, cy + 10 * dpr); c.stroke();
  }
}
cc.addEventListener('pointerdown', e => {
  if (!S.cal) return; const r = cc.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
  let best = null, bd = 1e9;
  S.cal.pts.forEach(([px, py], i) => { const d = Math.hypot((px - x) * r.width, (py - y) * r.height); if (d < bd) { bd = d; best = i; } });
  if (bd < 44) { drag = best; dragXY = [x, y]; cc.setPointerCapture(e.pointerId); e.preventDefault(); drawCalib(); }
});
cc.addEventListener('pointermove', e => {
  if (drag == null) return; const r = cc.getBoundingClientRect();
  const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
  // 손가락으로 가리지 않도록 움직인 만큼만 이동
  const [ox, oy] = dragXY; dragXY = [x, y];
  const p = S.cal.pts[drag]; p[0] = Math.min(1, Math.max(0, p[0] + (x - ox))); p[1] = Math.min(1, Math.max(0, p[1] + (y - oy)));
  drawCalib();
});
['pointerup', 'pointercancel'].forEach(ev => cc.addEventListener(ev, () => { drag = null; dragXY = null; drawCalib(); }));
new ResizeObserver(() => { if (!$('cardVideo').hidden) drawCalib(); }).observe($('videoBox'));

function renderKeys() {
  const box = $('keys'); box.innerHTML = '';
  S.keys.sort((a, b) => a.t - b.t).forEach((k, i) => {
    const b = document.createElement('button'); b.type = 'button';
    b.textContent = fmtTime1(k.t) + ' ✕'; b.title = '이 장면으로 이동 (길게 누르거나 ✕로 삭제)';
    if (Math.abs(k.t - vid.currentTime) < 0.05) b.classList.add('cur');
    b.addEventListener('click', ev => {
      const rr = b.getBoundingClientRect();
      if (ev.clientX > rr.right - 22) { S.keys.splice(i, 1); renderKeys(); updCalibState(); return; }
      S.cal = { pts: k.pts.map(p => p.slice()), fA: k.fA, fB: k.fB }; $('fA').value = k.fA; $('fB').value = k.fB; vid.currentTime = k.t;
    });
    box.appendChild(b);
  });
  updCalibState();
}
function updCalibState() { $('calibState').textContent = S.keys.length ? `${S.keys.length}개 장면 저장됨` : '아직 저장 안 함'; }
$('btnKeySave').addEventListener('click', () => {
  if (!S.cal || !curModel()) return toast('점 위치가 이상합니다. 네 점이 사각형을 이루게 놓아 주세요');
  const t = vid.currentTime;
  const ex = S.keys.find(k => Math.abs(k.t - t) < 0.05);
  const k = { t, pts: S.cal.pts.map(p => p.slice()), fA: S.cal.fA, fB: S.cal.fB };
  if (ex) Object.assign(ex, k); else S.keys.push(k);
  renderKeys(); toast(`${fmtTime1(t)} 장면 기준을 저장했습니다`);
});

// ------------------------------------------------------------------ 영상 프레임
function seekTo(v, t) {
  return new Promise(res => {
    let done = false;
    const fin = () => { if (done) return; done = true; v.removeEventListener('seeked', onSeek); res(); };
    const onSeek = () => { if (v.requestVideoFrameCallback) { v.requestVideoFrameCallback(() => fin()); setTimeout(fin, 250); } else setTimeout(fin, 30); };
    v.addEventListener('seeked', onSeek);
    v.currentTime = Math.max(0, Math.min((v.duration || t) - 0.03, t));
    setTimeout(fin, 2000);
  });
}
let frameCv = null;
function grabFrame(maxW = 960) {
  const w = Math.min(maxW, vid.videoWidth), h = Math.round(w * vid.videoHeight / vid.videoWidth);
  if (!frameCv) frameCv = document.createElement('canvas');
  frameCv.width = w; frameCv.height = h;
  frameCv.getContext('2d', { willReadFrequently: true }).drawImage(vid, 0, 0, w, h);
  return frameCv;
}
async function primeVideo() { try { vid.muted = true; await vid.play(); vid.pause(); } catch (e) { /* 사용자 동작 필요 */ } }

$('btnHandTest').addEventListener('click', async () => {
  const b = $('btnHandTest'); b.disabled = true; b.textContent = '손 인식 준비 중…';
  try {
    await primeVideo();
    await AI.loadHands();
    S.handsPreview = AI.detectHands(grabFrame());
    drawCalib();
    toast(S.handsPreview.length ? `손 ${S.handsPreview.length}개를 찾았습니다. 손가락 끝의 줄·프렛 표시가 맞는지 확인하세요` : '이 장면에서 손을 찾지 못했습니다', 4200);
  } catch (e) { toast('손 인식을 불러오지 못했습니다: ' + e.message, 5000); }
  logUI(); b.disabled = false; b.textContent = '손 인식 확인';
});

// ------------------------------------------------------------------ 분석
const STAGES = [['decode', '디코딩'], ['ai', '음정 인식 AI'], ['filter', '저음 필터'], ['hpss', '킥 분리'], ['pitch', '음정 추적'], ['notes', '주법 감지'], ['video', '손 위치'], ['frets', '운지 배치']];
let stageSkip = new Set();
function setStage(id, frac) {
  const idx = id === 'done' ? STAGES.length : STAGES.findIndex(s => s[0] === id);
  $('stages').innerHTML = STAGES.map(([k, l], i) => `<span class="${stageSkip.has(k) ? 'skip' : i < idx ? 'done' : i === idx ? 'on' : ''}">${i < idx && !stageSkip.has(k) ? '✓ ' : ''}${l}</span>`).join('');
  const W = { decode: [0, 5], ai: [5, 30], filter: [35, 2], hpss: [37, 13], pitch: [50, 22], notes: [72, 4], video: [76, 21], frets: [97, 3] };
  const w = W[id] || [0, 0];
  $('progBar').style.width = (w[0] + w[1] * Math.min(1, frac || 0)) + '%';
}
async function decode() {
  if (S.audioBuf) return S.audioBuf;
  const AC = window.AudioContext || window.webkitAudioContext;
  const ac = new AC();
  const ab = await S.file.arrayBuffer();
  S.audioBuf = await new Promise((res, rej) => { const p = ac.decodeAudioData(ab, res, rej); if (p && p.then) p.then(res, rej); });
  try { ac.close(); } catch (e) { /* 무시 */ }
  return S.audioBuf;
}
/** 음정 인식 AI에 넣을 신호: 가운데 채널, 30Hz~1.2kHz (베이스 배음은 남기고 고음 악기는 줄임) */
function aiInput(chans, sr) {
  const n = chans[0].length, mid = new Float32Array(n);
  if (chans.length > 1) for (let i = 0; i < n; i++) mid[i] = 0.5 * (chans[0][i] + chans[1][i]); else mid.set(chans[0]);
  let x = C.biquad(mid, 'hp', 30, sr); x = C.biquad(x, 'lp', 1200, sr); x = C.biquad(x, 'lp', 1200, sr);
  return x;
}

$('btnAnalyze').addEventListener('click', async () => {
  const btn = $('btnAnalyze'); btn.disabled = true; btn.textContent = '분석 중…';
  $('progress').hidden = false; stageSkip = new Set();
  stopPlay();
  try {
    if (S.isVideo) await primeVideo();
    setStage('decode', 0);
    const buf = await decode();
    const sr = buf.sampleRate, total = buf.length;
    const t0 = Math.max(0, +$('rStart').value || 0), t1v = +$('rEnd').value || 0;
    const i0 = Math.min(total - 1, Math.floor(t0 * sr)), i1 = t1v > t0 ? Math.min(total, Math.floor(t1v * sr)) : total;
    const chans = []; for (let c = 0; c < Math.min(2, buf.numberOfChannels); c++) chans.push(buf.getChannelData(c).subarray(i0, i1));
    S.tuning = TUNINGS.find(t => t.id === $('tuning').value); S.beats = +$('meter').value;
    const low = S.tuning.open[0];

    // 1) 음정 인식 AI
    let ext = null;
    if ($('engine').value === 'ai') {
      setStage('ai', 0);
      try {
        const s = +$('aiSens').value;
        const poly = await AI.basicPitchNotes(aiInput(chans, sr), sr, { onsetThresh: 0.45 - 0.25 * s, frameThresh: 0.32 - 0.15 * s, minFreq: 440 * Math.pow(2, (low - 2 - 69) / 12), maxFreq: 440 }, f => setStage('ai', f));
        ext = C.bassLine(poly, low, low + 15 + (+$('maxFret').value || 20));
      } catch (e) { stageSkip.add('ai'); toast('음정 인식 AI를 쓸 수 없어 신호 분석만 씁니다: ' + e.message, 6000); }
      logUI();
    } else stageSkip.add('ai');

    // 2) 신호 분석 + 결합 + 주법
    const opts = {
      hp: +$('hp').value, lp: +$('lp').value, sensitivity: +$('sens').value,
      kickGuard: $('kick').checked, deadNotes: $('dead').checked, lowestMidi: low,
      bpm: +$('bpm').value || null, beatsPerBar: S.beats, extNotes: ext,
    };
    const res = await C.analyze(chans, sr, opts, (st, f) => setStage(st, f));
    res.all.forEach(n => { n.start += t0; n.end += t0; });
    res.firstBeat += t0; res.origin += t0;
    S.result = res; S.offset = t0; S.bpm = res.bpm; S.firstBeat = res.firstBeat;
    $('bpm').placeholder = res.estBpm.toFixed(1);

    // 3) 영상: 손 위치
    if (S.isVideo && $('useVideo').checked) {
      setStage('video', 0);
      const keys = S.keys.length ? S.keys : (S.cal ? [{ t: vid.currentTime, ...S.cal }] : []);
      if (!keys.length) { stageSkip.add('video'); toast('넥 위치를 맞추지 않아 손 위치 분석을 건너뜁니다'); }
      else await videoPass(res.all, keys, f => setStage('video', f));
    } else stageSkip.add('video');

    setStage('frets', 0);
    S.bassBuffer = null;
    requantize(true);
    setStage('done', 1); $('progBar').style.width = '100%';
    const n = S.notes.length, uns = S.notes.filter(x => x.cert < 0.55).length, techs = S.notes.filter(x => x.tech || x.bend || x.vib || x.slideIn || x.slideOut || x.dead).length;
    toast(`음 ${n}개 (확실하지 않은 음 ${uns}개), 주법 ${techs}개 · BPM ${S.bpm.toFixed(1)}`, 4500);
    $('btnReview').disabled = !gem.ok;
  } catch (e) {
    console.error(e);
    toast('분석하지 못했습니다: ' + (e && e.message ? e.message : e) + ' — 다른 파일 형식(mp4, m4a, wav)으로 시도해 보세요.', 7000);
  }
  logUI();
  btn.disabled = false; btn.textContent = '다시 분석';
});

function requantize(fresh) {
  if (!S.result) return;
  const src = S.result.all.map(n => ({ ...n }));
  const q = C.quantize(src, S.bpm, S.firstBeat, S.beats);
  S.origin = q.origin; S.six = q.sixteenth;
  S.notes = q.notes.map(n => ({ ...n, id: uid++ }));
  S.example = false; $('exBadge').hidden = true;
  if (!fresh) pushUndo();
  refret(); render();
}
$('beatL').addEventListener('click', () => { if (!S.result) return toast('분석 후에 쓸 수 있습니다'); S.firstBeat -= S.six; requantize(); });
$('beatR').addEventListener('click', () => { if (!S.result) return toast('분석 후에 쓸 수 있습니다'); S.firstBeat += S.six; requantize(); });
$('bpm').addEventListener('change', () => { if (!S.result) return; const v = +$('bpm').value; S.bpm = v > 0 ? v : S.result.estBpm; requantize(); });

function refret() {
  const max = +$('maxFret').value || 20;
  const free = S.notes.filter(n => !n.locked);
  C.assignFrets(free, S.tuning.open, max);
  S.notes.filter(n => n.locked && !n.dead && n.midi != null).forEach(n => { n.fret = n.midi - S.tuning.open[n.string]; });
  // 영상에서 지판 위에 두 손이 있었던 레가토 상행 → 태핑
  for (const n of S.notes) {
    if (!n.hand || !n.hand.tap || n.dead || n.locked) continue;
    if ((n.tech === 'h' || n.tech === 's') && n.hand.tap.some(tp => Math.abs(tp.f - (n.fret - 0.35)) < 1.6)) n.tech = 't';
  }
}

// ------------------------------------------------------------------ 영상: 손가락 끝 → 줄·프렛
async function videoPass(notes, keys, prog) {
  const nStr = S.tuning.open.length, tl = topIsLow();
  const pitched = notes.filter(n => n.midi != null);
  let useMP = true;
  try { await AI.loadHands(); } catch (e) { useMP = false; toast('손 인식 AI를 불러오지 못해 지판 가림 분석으로 대신합니다', 5000); }
  logUI();
  let times = [...new Set(pitched.map(n => Math.round((n.start + 0.035) * 20) / 20))].sort((a, b) => a - b);
  if (times.length > 900) { const st = times.length / 900; times = Array.from({ length: 900 }, (_, i) => times[Math.floor(i * st)]); }
  const byT = new Map();
  if (useMP) {
    for (let k = 0; k < times.length; k++) {
      const t = times[k];
      await seekTo(vid, t);
      const model = C.neckAt(keys, t); if (!model) continue;
      let hands = [];
      try { hands = AI.detectHands(grabFrame(640)); } catch (e) { /* 프레임 오류 */ }
      const on = hands.map(h => {
        const tips = h.tips.map(([x, y]) => C.tipToBoard(model, x, y, nStr, tl));
        const inside = tips.filter(b => b.u > -0.03 && b.u < 0.73 && b.v > -0.35 && b.v < 1.35);
        return { inside, mu: inside.length ? inside.reduce((a, b) => a + b.u, 0) / inside.length : 9 };
      }).filter(h => h.inside.length >= 2).sort((a, b) => a.mu - b.mu);
      if (on.length) byT.set(t, { tips: on[0].inside.map(b => ({ f: b.f, s: b.s })), tap: on[1] ? on[1].inside.map(b => ({ f: b.f, s: b.s })) : null });
      if (k % 4 === 0) prog(k / times.length);
    }
  } else {
    await occlusionPass(times, keys, byT, prog);
  }
  let used = 0;
  for (const n of pitched) {
    const h = byT.get(Math.round((n.start + 0.035) * 20) / 20);
    if (h) { n.hand = h; used++; }
  }
  prog(1);
  AI.log.push(`손 위치: 음 ${pitched.length}개 중 ${used}개에 적용`); logUI();
  if (!used) toast('영상에서 지판 위 손을 찾지 못했습니다. 넥 보정과 화면 방향을 확인해 보세요.', 5000);
}
// 손 인식 AI를 못 쓸 때: 지판이 가려진 구간(손 위치)을 프렛 범위로 사용
async function occlusionPass(times, keys, byT, prog) {
  const W = 320, H = Math.round(W * vid.videoHeight / vid.videoWidth);
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  const POS = 44, AC = 7, samples = [];
  for (let k = 0; k < times.length; k++) {
    await seekTo(vid, times[k]);
    const m = C.neckAt(keys, times[k]); if (!m) { samples.push(null); continue; }
    cx.drawImage(vid, 0, 0, W, H); const img = cx.getImageData(0, 0, W, H).data;
    const row = new Uint8Array(POS * AC * 3);
    for (let p = 0; p < POS; p++) for (let a = 0; a < AC; a++) {
      const [x, y] = m.toImg(C.fretU(p * 0.5 + 0.25), 0.1 + 0.8 * a / (AC - 1));
      const px = Math.min(W - 1, Math.max(0, Math.round(x * W))), py = Math.min(H - 1, Math.max(0, Math.round(y * H))), o = (py * W + px) * 4, d = (p * AC + a) * 3;
      row[d] = img[o]; row[d + 1] = img[o + 1]; row[d + 2] = img[o + 2];
    }
    samples.push(row);
    if (k % 5 === 0) prog(k / times.length);
  }
  const valid = samples.filter(Boolean); if (!valid.length) return;
  const L = POS * AC * 3, base = new Float32Array(L);
  for (let j = 0; j < L; j++) { const a = valid.map(r => r[j]).sort((x, y) => x - y); base[j] = a[a.length >> 1]; }
  samples.forEach((r, k) => {
    if (!r) return;
    const occ = [];
    for (let p = 0; p < POS; p++) { let c = 0; for (let a = 0; a < AC; a++) { const d = (p * AC + a) * 3; if (Math.hypot(r[d] - base[d], r[d + 1] - base[d + 1], r[d + 2] - base[d + 2]) > 42) c++; } occ.push(c / AC); }
    const hot = occ.map((v, p) => v >= 0.4 ? p : -1).filter(p => p >= 0);
    if (hot.length < 2) return;
    const lo = hot[0] * 0.5, hi = hot[hot.length - 1] * 0.5;
    if (hi - lo > 8) return;
    const tips = []; for (let f = lo; f <= hi + 0.5; f += 1) tips.push({ f: f + 0.6, s: (S.tuning.open.length - 1) / 2 });
    byT.set(times[k], { tips, tap: null, weak: true });
  });
}

// ------------------------------------------------------------------ 악보 그리기 (연필로 쓴 종이)
const INK = '#2b2f36', PEN = '#2547b0', FAINT = 'rgba(43,47,54,.4)', HL = 'rgba(255,221,0,.5)', WARN = '#b7791f';
function rand(seed) { let s = seed; return () => ((s = (s * 9301 + 49297) % 233280) / 233280); }
function pencilLine(c, x0, y0, x1, y1, seed, wob) {
  const r = rand(seed + 7), len = Math.hypot(x1 - x0, y1 - y0), steps = Math.max(2, Math.round(len / 40));
  c.beginPath(); c.moveTo(x0 + (r() - .5) * wob, y0 + (r() - .5) * wob);
  for (let i = 1; i <= steps; i++) { const t = i / steps; c.lineTo(x0 + (x1 - x0) * t + (r() - .5) * wob * .6, y0 + (y1 - y0) * t + (r() - .5) * wob); }
  c.stroke();
}
function layoutSystems(notes, cssW, beats) {
  const spb = 4 * beats;
  const lastSlot = notes.reduce((m, n) => Math.max(m, n.slot + (n.len || 1) - 1), 0);
  const nBars = Math.floor(lastSlot / spb) + 1;
  const perBar = new Array(nBars).fill(0); notes.forEach(n => perBar[Math.floor(n.slot / spb)]++);
  const base = cssW < 560 ? 2 : beats >= 6 ? 3 : 4;
  const systems = []; let b = 0;
  while (b < nBars) {
    let k = Math.min(base, nBars - b);
    if (Math.max(...perBar.slice(b, b + k)) > 8 && k > 1) k = Math.max(1, Math.floor(k / 2));
    if (Math.max(...perBar.slice(b, b + k)) > 12) k = 1;
    systems.push({ b0: b, b1: b + k }); b += k;
  }
  return { systems, spb };
}
function sysMetrics(cssW, nStr) {
  const k = Math.max(0.72, Math.min(1.25, cssW / 900));
  const gap = 15 * k, top = 58 * k, stem = 36 * k;
  return { k, gap, top, stem, h: top + gap * (nStr - 1) + stem + 18 * k, x0: 46 * k };
}
const isUnsure = n => $('showUnsure').checked && n.cert != null && n.cert < 0.55;
function drawSystem(c, sys, notes, all, o) {
  const { x, y, w, nStr, spb, playId, sysIndex } = o;
  const m = sysMetrics(w, nStr), k = m.k;
  const nBars = sys.b1 - sys.b0, barW = (w - m.x0 - 8 * k) / nBars, slotW = barW / spb;
  const top = y + m.top, lineY = s => top + (nStr - 1 - s) * m.gap, bottom = lineY(0);
  const hits = [];
  c.save(); c.lineCap = 'round'; c.lineJoin = 'round';
  c.strokeStyle = 'rgba(43,47,54,.55)'; c.lineWidth = 1 * k;
  for (let s = 0; s < nStr; s++) pencilLine(c, x + 4 * k, lineY(s), x + w - 4 * k, lineY(s), sysIndex * 31 + s, 1.1 * k);
  c.fillStyle = INK; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.font = `700 ${Math.round(15 * k)}px Caveat, cursive`;
  const mid = (top + bottom) / 2;
  ['T', 'A', 'B'].forEach((ch, i) => c.fillText(ch, x + 20 * k, mid + (i - 1) * 13 * k));
  c.font = `500 ${Math.round(12 * k)}px Caveat, cursive`; c.fillStyle = FAINT;
  for (let s = 0; s < nStr; s++) c.fillText(sName(S.tuning.open[s]), x + 6 * k, lineY(s));
  c.strokeStyle = 'rgba(43,47,54,.75)'; c.lineWidth = 1.3 * k;
  for (let b = 0; b <= nBars; b++) {
    const bx = x + m.x0 + b * barW;
    pencilLine(c, bx, top - 1, bx, bottom + 1, sysIndex * 97 + b, 1 * k);
    if (b < nBars) { c.fillStyle = FAINT; c.font = `500 ${Math.round(12 * k)}px Caveat, cursive`; c.textAlign = 'left'; c.fillText(String(sys.b0 + b + 1), bx + 3 * k, top - 40 * k); }
  }
  const nx = n => x + m.x0 + ((n.slot - sys.b0 * spb) + 0.5) * slotW;
  const byId = new Map(all.map((n, i) => [n.id, i]));
  const prevOf = n => { const i = byId.get(n.id); return i > 0 ? all[i - 1] : null; };
  c.textAlign = 'center'; c.textBaseline = 'middle';
  const fs = Math.round(17 * k);
  for (const n of notes) {
    const nxv = nx(n), ly = lineY(n.string), uns = isUnsure(n);
    let label = n.dead ? 'x' : String(n.fret);
    if (n.ghost) label = '(' + label + ')'; if (n.harm) label = '<' + label + '>';
    c.font = `700 ${fs}px Caveat, cursive`;
    const tw = c.measureText(label).width;
    c.fillStyle = '#fafbfd'; c.fillRect(nxv - tw / 2 - 2 * k, ly - 7 * k, tw + 4 * k, 14 * k);
    if (n.id === playId) { c.fillStyle = HL; c.beginPath(); c.ellipse(nxv, ly, tw / 2 + 7 * k, 11 * k, -0.1, 0, 7); c.fill(); }
    c.fillStyle = uns ? FAINT : INK;
    c.fillText(label, nxv, ly + 1 * k);
    hits.push({ id: n.id, x: nxv - Math.max(tw, 14 * k) / 2 - 4 * k, y: ly - 11 * k, w: Math.max(tw, 14 * k) + 8 * k, h: 22 * k });
    c.strokeStyle = PEN; c.fillStyle = PEN; c.lineWidth = 1.3 * k;
    const p = prevOf(n), sameSys = p && p.slot >= sys.b0 * spb;
    if (n.tech === 'h' || n.tech === 'p' || n.tech === 't') {
      const letter = n.tech === 'h' ? 'H' : n.tech === 'p' ? 'P' : 'T';
      const xa = sameSys ? nx(p) : nxv - slotW * 1.2, ya = sameSys ? lineY(p.string) : ly;
      const yy = Math.min(ya, ly) - 10 * k;
      c.beginPath(); c.moveTo(xa + 3 * k, yy + 2 * k); c.quadraticCurveTo((xa + nxv) / 2, yy - 9 * k, nxv - 3 * k, yy + 2 * k); c.stroke();
      c.font = `700 ${Math.round(13 * k)}px Caveat, cursive`; c.fillText(letter, (xa + nxv) / 2, yy - 11 * k);
    }
    if (n.tech === 's') {
      const up = !p || p.midi == null || n.midi == null || n.midi >= p.midi;
      const xa = sameSys ? nx(p) + 8 * k : nxv - slotW * 1.1;
      c.beginPath(); c.moveTo(xa, ly + (up ? 5 : -5) * k); c.lineTo(nxv - tw / 2 - 3 * k, ly + (up ? -5 : 5) * k); c.stroke();
    }
    if (n.slideIn) { c.beginPath(); c.moveTo(nxv - tw / 2 - 13 * k, ly + 6 * k); c.lineTo(nxv - tw / 2 - 3 * k, ly - 3 * k); c.stroke(); }
    if (n.slideOut) { c.beginPath(); c.moveTo(nxv + tw / 2 + 3 * k, ly - 3 * k); c.lineTo(nxv + tw / 2 + 13 * k, ly + 6 * k); c.stroke(); }
    if (n.bend) {
      const bx0 = nxv + tw / 2 + 2 * k, peakX = bx0 + Math.min(slotW * 1.2, 20 * k), peakY = top - 16 * k;
      c.beginPath(); c.moveTo(bx0, ly - 2 * k); c.quadraticCurveTo(peakX, ly - 2 * k, peakX, peakY); c.stroke();
      c.beginPath(); c.moveTo(peakX - 4 * k, peakY + 6 * k); c.lineTo(peakX, peakY); c.lineTo(peakX + 4 * k, peakY + 6 * k); c.stroke();
      c.font = `700 ${Math.round(12 * k)}px Caveat, cursive`;
      c.fillText(n.bend >= 2 ? 'full' : n.bend >= 1.5 ? '¾' : '½', peakX, peakY - 8 * k);
      if (n.release) {
        const rx = peakX + Math.max(14 * k, slotW * Math.max(1, (n.len || 2) - 1.5));
        c.setLineDash([3 * k, 3 * k]); c.beginPath(); c.moveTo(peakX + 2 * k, peakY + 2 * k); c.quadraticCurveTo(rx, peakY, rx, ly - 8 * k); c.stroke(); c.setLineDash([]);
        c.beginPath(); c.moveTo(rx - 4 * k, ly - 14 * k); c.lineTo(rx, ly - 8 * k); c.lineTo(rx + 4 * k, ly - 14 * k); c.stroke();
      }
    }
    if (n.vib) {
      const vx0 = nxv - 4 * k, vx1 = nxv + Math.max(18 * k, slotW * (n.len || 2) * 0.9), vy = top - 24 * k;
      c.beginPath(); for (let xx = vx0; xx <= vx1; xx += 1) { const yy = vy + Math.sin((xx - vx0) / (3.2 * k)) * 2.6 * k; xx === vx0 ? c.moveTo(xx, yy) : c.lineTo(xx, yy); } c.stroke();
    }
    if (n.slap || n.pop) { c.font = `700 ${Math.round(13 * k)}px Caveat, cursive`; c.fillText(n.slap ? 'S' : 'Po', nxv, top - 32 * k); }
    if (uns) { c.fillStyle = WARN; c.font = `700 ${Math.round(12 * k)}px Caveat, cursive`; c.fillText('?', nxv + tw / 2 + 5 * k, ly - 8 * k); }
  }
  // 리듬 (꼬리·빔)
  c.strokeStyle = INK; c.fillStyle = INK; c.lineWidth = 1.1 * k;
  const stemTop = bottom + 10 * k, stemBot = bottom + m.stem - 4 * k;
  for (let bar = sys.b0; bar < sys.b1; bar++) for (let beat = 0; beat < spb / 4; beat++) {
    const s0 = bar * spb + beat * 4;
    const grp = notes.filter(n => n.slot >= s0 && n.slot < s0 + 4).sort((a, b) => a.slot - b.slot);
    grp.forEach(n => {
      const len = n.len || 1, xx = nx(n), sb = len >= 8 ? stemTop + (stemBot - stemTop) * 0.5 : stemBot;
      c.beginPath(); c.moveTo(xx, stemTop); c.lineTo(xx, sb); c.stroke();
      if (len === 3 || len === 6 || len === 12) { c.beginPath(); c.arc(xx + 4 * k, sb - 3 * k, 1.4 * k, 0, 7); c.fill(); }
    });
    const short = grp.filter(n => (n.len || 1) < 4);
    if (!short.length) continue;
    const beamH = 3 * k;
    if (short.length >= 2) {
      c.fillRect(nx(short[0]), stemBot - beamH, nx(short[short.length - 1]) - nx(short[0]), beamH);
      short.forEach((n, i) => {
        if ((n.len || 1) !== 1) return;
        const xx = nx(n), nb = short[i + 1], pb = short[i - 1];
        let xa = xx, xb = xx;
        if (nb && (nb.len || 1) === 1) xb = nx(nb); else if (pb && (pb.len || 1) === 1) xa = xx; else if (nb) xb = xx + 7 * k; else xa = xx - 7 * k;
        c.fillRect(Math.min(xa, xb), stemBot - beamH * 2.6, Math.max(2, Math.abs(xb - xa)), beamH);
      });
    } else {
      const n = short[0], xx = nx(n), flags = (n.len || 1) === 1 ? 2 : 1;
      for (let f = 0; f < flags; f++) { c.beginPath(); c.moveTo(xx, stemBot - f * 6 * k); c.quadraticCurveTo(xx + 9 * k, stemBot - f * 6 * k - 6 * k, xx + 7 * k, stemBot - f * 6 * k - 13 * k); c.stroke(); }
    }
  }
  c.restore();
  return { hits, slotW, barW, x0: x + m.x0, top, gap: m.gap, b0: sys.b0, b1: sys.b1, h: m.h };
}
let lastLayout = null;
function render() {
  const nStr = S.tuning.open.length;
  $('meta').textContent = `튜닝 ${S.tuning.open.map(sName).join(' ')} · ♩= ${Math.round(S.bpm)} · ${S.beats}/4`;
  const uns = S.notes.filter(n => n.cert != null && n.cert < 0.55).length;
  $('stats').textContent = S.example ? '' : `음 ${S.notes.length}개 · 확실하지 않은 음 ${uns}개`;
  const box = $('systems'), cssW = Math.max(280, box.clientWidth || 600);
  const { systems, spb } = layoutSystems(S.notes, cssW, S.beats);
  const m = sysMetrics(cssW, nStr), dpr = Math.min(3, devicePixelRatio || 1);
  while (box.children.length > systems.length) box.lastChild.remove();
  while (box.children.length < systems.length) { const cv = document.createElement('canvas'); cv.addEventListener('click', onSheetTap); box.appendChild(cv); }
  S.hit = [];
  systems.forEach((sys, i) => {
    const cv = box.children[i];
    cv.dataset.i = i; cv.style.height = m.h + 'px';
    cv.width = Math.round(cssW * dpr); cv.height = Math.round(m.h * dpr);
    const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, cssW, m.h);
    const ns = S.notes.filter(n => n.slot >= sys.b0 * spb && n.slot < sys.b1 * spb);
    S.hit[i] = drawSystem(c, sys, ns, S.notes, { x: 0, y: 0, w: cssW, nStr, spb, playId: S.playId, sysIndex: i });
  });
  lastLayout = { systems, spb, cssW };
  $('btnUndo').disabled = !S.undo.length;
}
new ResizeObserver(() => { clearTimeout(render._t); render._t = setTimeout(render, 60); }).observe($('systems'));

// ------------------------------------------------------------------ 편집
function pushUndo() { S.undo.push(JSON.stringify(S.notes)); if (S.undo.length > 60) S.undo.shift(); $('btnUndo').disabled = false; }
$('btnUndo').addEventListener('click', () => { const s = S.undo.pop(); if (s) { S.notes = JSON.parse(s); render(); } });
function onSheetTap(e) {
  const cv = e.currentTarget, i = +cv.dataset.i, r = cv.getBoundingClientRect();
  const x = e.clientX - r.left, y = e.clientY - r.top, H = S.hit[i];
  const hit = H.hits.find(h => x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h);
  if (hit) return openEditor(S.notes.find(n => n.id === hit.id));
  const nStr = S.tuning.open.length;
  const s = nStr - 1 - Math.round((y - H.top) / H.gap);
  const slot = Math.floor((x - H.x0) / H.slotW) + H.b0 * lastLayout.spb;
  if (s < 0 || s >= nStr || x < H.x0 || slot >= H.b1 * lastLayout.spb) return;
  if (S.notes.some(n => n.slot === slot)) return toast('이 박에는 이미 음이 있습니다');
  openEditor({ id: uid++, slot, len: 2, string: s, fret: 0, midi: S.tuning.open[s], cert: 1, start: S.origin + slot * S.six, dur: 2 * S.six, tech: null, locked: true }, true);
}
function openEditor(n, isNew) {
  const ed = $('editor'), w = { ...n }, max = +$('maxFret').value || 24;
  const draw = () => {
    const pitch = w.dead ? '데드노트' : nameOf(S.tuning.open[w.string] + w.fret);
    const chip = (key, val, label) => `<button type="button" class="chip" data-k="${key}" data-v="${val}" aria-pressed="${String(val === 'true' ? !!w[key] : String(w[key] ?? (key === 'bend' ? 0 : 'null')) === val)}">${label}</button>`;
    ed.innerHTML = `
      <h3><span id="edTitle">${isNew ? '음 추가' : '음 고치기'} · ${pitch}</span><small>${fmtTime1(w.start)}${w.cert != null && w.cert < 0.55 ? ' · 불확실' : ''}</small></h3>
      <div class="grp"><span>프렛</span><div class="stepper">
        <button type="button" class="btn small" data-act="f-">−</button><output>${w.dead ? 'x' : w.fret}</output><button type="button" class="btn small" data-act="f+">+</button>
        <button type="button" class="btn small" data-act="oct-">옥타브 ↓</button><button type="button" class="btn small" data-act="oct+">옥타브 ↑</button>
        <button type="button" class="btn small" data-act="hear">들어보기</button></div></div>
      <div class="grp"><span>줄 (같은 음 유지)</span><div class="chips">${S.tuning.open.map((o, s) => `<button type="button" class="chip" data-act="str" data-s="${s}" aria-pressed="${w.string === s}">${sName(o)}</button>`).reverse().join('')}</div></div>
      <div class="grp"><span>앞 음과의 연결</span><div class="chips">${chip('tech', 'null', '피킹')}${chip('tech', 'h', 'H 해머링')}${chip('tech', 'p', 'P 풀링')}${chip('tech', 's', '/ 슬라이드')}${chip('tech', 't', 'T 태핑')}</div></div>
      <div class="grp"><span>표현</span><div class="chips">
        ${chip('bend', '0', '벤딩 없음')}${chip('bend', '1', '↑ ½')}${chip('bend', '2', '↑ full')}${chip('release', 'true', '릴리스')}
        ${chip('vib', 'true', '~ 비브라토')}${chip('slideIn', 'true', '/ 슬라이드 인')}${chip('slideOut', 'true', '\\ 슬라이드 아웃')}
        ${chip('dead', 'true', 'x 데드')}${chip('ghost', 'true', '( ) 고스트')}${chip('harm', 'true', '&lt; &gt; 하모닉')}${chip('slap', 'true', 'S 슬랩')}${chip('pop', 'true', 'Po 팝')}</div></div>
      <div class="grp"><span>길이</span><div class="chips">${[[1, '16분'], [2, '8분'], [3, '점8분'], [4, '4분'], [6, '점4분'], [8, '2분'], [16, '온']].map(([l, t]) => `<button type="button" class="chip" data-act="len" data-l="${l}" aria-pressed="${w.len === l}">${t}</button>`).join('')}</div></div>
      <div class="row">${isNew ? '' : '<button type="button" class="btn small" data-act="del">음 지우기</button>'}<button type="button" class="btn small" data-act="cancel">취소</button><button type="button" class="btn small primary" data-act="ok">${isNew ? '추가' : '적용'}</button></div>`;
  };
  const close = () => { ed.hidden = true; $('scrim').hidden = true; };
  ed.onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    const act = b.dataset.act, cur = w.dead ? null : S.tuning.open[w.string] + w.fret;
    if (b.dataset.k) {
      const k = b.dataset.k, v = b.dataset.v;
      if (k === 'tech') w.tech = v === 'null' ? null : v;
      else if (k === 'bend') { w.bend = +v; if (!w.bend) w.release = false; }
      else w[k] = !w[k] ? (k === 'slideIn' ? 'up' : k === 'slideOut' ? 'down' : true) : (k === 'slideIn' || k === 'slideOut' ? null : false);
      if (k === 'dead') w.fret = w.dead ? null : 0;
    }
    if (act === 'f-' && !w.dead) w.fret = Math.max(0, w.fret - 1);
    if (act === 'f+' && !w.dead) w.fret = Math.min(max, w.fret + 1);
    if ((act === 'oct-' || act === 'oct+') && !w.dead) { const nf = w.fret + (act === 'oct+' ? 12 : -12); if (nf >= 0 && nf <= max) w.fret = nf; else toast('이 줄에서는 옥타브를 옮길 수 없습니다'); }
    if (act === 'str') { const s = +b.dataset.s; if (w.dead) w.string = s; else { const f = cur - S.tuning.open[s]; if (f >= 0 && f <= max) { w.string = s; w.fret = f; } else toast(`${sName(S.tuning.open[s])}줄에서는 이 음을 낼 수 없습니다`); } }
    if (act === 'len') w.len = +b.dataset.l;
    if (act === 'hear') { playSpan(w.start - 0.4, Math.max(1.2, (w.dur || 0.3) + 0.8)); return; }
    if (act === 'cancel') return close();
    if (act === 'del') { pushUndo(); S.notes = S.notes.filter(x => x.id !== n.id); close(); return render(); }
    if (act === 'ok') {
      pushUndo();
      w.midi = w.dead ? null : S.tuning.open[w.string] + w.fret; w.locked = true; w.cert = 1;
      if (isNew) { S.notes.push(w); S.notes.sort((a, b) => a.slot - b.slot); } else Object.assign(n, w);
      close(); return render();
    }
    draw();
  };
  draw(); ed.hidden = false; $('scrim').hidden = false;
}
$('scrim').addEventListener('click', () => { $('editor').hidden = true; $('scrim').hidden = true; });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('editor').hidden) { $('editor').hidden = true; $('scrim').hidden = true; } });

// ------------------------------------------------------------------ 재생
const media = () => S.isVideo ? vid : $('audio');
let ac = null, bassNode = null, bassStartCtx = 0, bassStartPos = 0;
function makeBassBuffer() {
  if (S.bassBuffer || !S.result) return S.bassBuffer;
  const src = S.result.wide || S.result.bass, sr0 = S.result.wide ? S.result.wideSr : S.result.bassSr, sr = 22050, ratio = sr / sr0;
  // 넓은 대역 신호를 다시 저역 강조 (베이스만 듣기)
  const lp = C.biquad(C.biquad(src, 'lp', 700, sr0), 'lp', 700, sr0);
  const n = Math.floor(lp.length * ratio);
  ac = ac || new (window.AudioContext || window.webkitAudioContext)();
  const b = ac.createBuffer(1, n, sr), d = b.getChannelData(0);
  let peak = 1e-6; for (let i = 0; i < lp.length; i++) peak = Math.max(peak, Math.abs(lp[i]));
  for (let i = 0; i < n; i++) { const p = i / ratio, j = Math.floor(p), f = p - j; d[i] = ((lp[j] || 0) * (1 - f) + (lp[j + 1] || 0) * f) / peak * 0.9; }
  S.bassBuffer = b; return b;
}
function curTime() { if (S.src === 'bass' && bassNode) return bassStartPos + (ac.currentTime - bassStartCtx) * (+$('rate').value) + (S.offset || 0); return media().currentTime; }
async function startPlay() {
  const m = media(); m.playbackRate = +$('rate').value;
  if (S.src === 'bass') {
    const b = makeBassBuffer(); if (!b) { toast('베이스만 듣기는 분석 후에 쓸 수 있습니다'); return; }
    await ac.resume();
    bassNode = ac.createBufferSource(); bassNode.buffer = b; bassNode.playbackRate.value = +$('rate').value; bassNode.connect(ac.destination);
    const pos = Math.max(0, m.currentTime - (S.offset || 0));
    bassStartCtx = ac.currentTime; bassStartPos = pos; bassNode.start(0, Math.min(pos, b.duration - 0.01));
    bassNode.onended = () => { if (S.playing && S.src === 'bass') stopPlay(); };
  } else { m.muted = false; try { await m.play(); } catch (e) { toast('재생할 수 없습니다'); return; } }
  S.playing = true; $('btnPlay').textContent = '❚❚ 정지'; tick();
}
function stopPlay() {
  if (bassNode) { const t = curTime(); try { bassNode.stop(); } catch (e) { /* 무시 */ } bassNode = null; media().currentTime = t; }
  media().pause(); S.playing = false; $('btnPlay').textContent = '▶ 재생'; S.playId = null;
}
let spanTimer = null;
async function playSpan(t, dur) {
  if (S.playing) stopPlay();
  const m = media(); m.currentTime = Math.max(0, t); clearTimeout(spanTimer);
  await startPlay(); spanTimer = setTimeout(stopPlay, dur * 1000 / (+$('rate').value));
}
$('btnPlay').addEventListener('click', () => S.playing ? stopPlay() : startPlay());
[['srcMix', 'mix'], ['srcBass', 'bass']].forEach(([id, v]) => $(id).addEventListener('click', () => {
  const was = S.playing; if (was) stopPlay(); S.src = v; $('srcMix').setAttribute('aria-pressed', v === 'mix'); $('srcBass').setAttribute('aria-pressed', v === 'bass'); if (was) startPlay();
}));
$('rate').addEventListener('change', () => { const was = S.playing; if (was) stopPlay(); if (was) startPlay(); });
$('seek').addEventListener('input', () => { const m = media(); if (!m.duration) return; const was = S.playing; if (was) stopPlay(); m.currentTime = +$('seek').value * m.duration; updTime(); if (was) startPlay(); });
function updTime() { const m = media(); $('time').textContent = fmtTime(curTime()) + ' / ' + fmtTime(m.duration); if (m.duration) $('seek').value = curTime() / m.duration; }
let lastPlayId = null;
function tick() {
  if (!S.playing) { render(); return; }
  const t = curTime(); updTime();
  const n = S.notes.find(x => !x.dead && t >= (x.start ?? 0) && t < (x.start ?? 0) + Math.max(x.dur || 0, S.six * (x.len || 1)));
  S.playId = n ? n.id : null;
  if (S.playId !== lastPlayId) {
    lastPlayId = S.playId; render();
    if (n && lastLayout) { const idx = lastLayout.systems.findIndex(s => n.slot >= s.b0 * lastLayout.spb && n.slot < s.b1 * lastLayout.spb); const cv = $('systems').children[idx]; if (cv) { const r = cv.getBoundingClientRect(); if (r.top < 60 || r.bottom > innerHeight - 90) cv.scrollIntoView({ block: 'center', behavior: 'smooth' }); } }
  }
  requestAnimationFrame(tick);
}
['timeupdate', 'loadedmetadata'].forEach(ev => { vid.addEventListener(ev, updTime); $('audio').addEventListener(ev, updTime); });
vid.addEventListener('ended', stopPlay); $('audio').addEventListener('ended', stopPlay);

// ------------------------------------------------------------------ Gemini
const gem = { key: store.get('gemKey', ''), model: store.get('gemModel', ''), ok: false };
$('gemKey').value = gem.key;
function gemStatus(text, ok) { $('gemState').textContent = text; $('gemState').style.color = ok ? 'var(--ok)' : ''; }
async function gemConnect(quiet) {
  const key = $('gemKey').value.trim(); if (!key) { if (!quiet) toast('API 키를 넣어 주세요'); return; }
  const b = $('gemConnect'); b.disabled = true; b.textContent = '확인 중…';
  try {
    const ms = await AI.geminiModels(key);
    if (!ms.length) throw new Error('쓸 수 있는 Gemini 모델이 없습니다');
    gem.key = key; store.set('gemKey', key);
    const sel = $('gemModel'); sel.innerHTML = ''; ms.forEach(m => sel.add(new Option(m.label, m.id)));
    sel.value = ms.some(m => m.id === gem.model) ? gem.model : ms[0].id; gem.model = sel.value;
    $('gemModelRow').hidden = false; $('gemTools').hidden = false; $('btnGemNeck').hidden = false;
    gem.ok = true; gemStatus('연결됨', true); $('btnReview').disabled = !S.result;
    if (!quiet) toast('Gemini에 연결했습니다');
  } catch (e) { gem.ok = false; gemStatus('연결 안 됨'); if (!quiet) toast(e.message, 6000); }
  b.disabled = false; b.textContent = '연결 확인';
}
$('gemConnect').addEventListener('click', () => gemConnect(false));
$('gemModel').addEventListener('change', () => { gem.model = $('gemModel').value; store.set('gemModel', gem.model); });
if (gem.key) gemConnect(true);
const ask = (parts, opt) => AI.gemini(gem.key, gem.model, parts, opt);

// 넥 찾기
$('btnGemNeck').addEventListener('click', async () => {
  const b = $('btnGemNeck'); b.disabled = true; b.textContent = '넥 찾는 중…';
  try {
    await primeVideo();
    const cv = grabFrame(1024);
    const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.88));
    const ans = await ask([
      { text: `이 영상 프레임에서 베이스 기타의 지판(넥)을 찾아 주세요. 좌표는 이미지 왼쪽 위 (0,0), 오른쪽 아래 (1,1)인 비율 좌표입니다.
JSON만 반환: {"found": true|false, "nut": {"top": {"x":..,"y":..}, "bottom": {"x":..,"y":..}}, "fret": {"number": 5|7|9|12, "top": {"x":..,"y":..}, "bottom": {"x":..,"y":..}}, "lowStringOnTop": true|false}
- nut: 너트(0프렛)에서 지판의 화면상 위쪽 끝과 아래쪽 끝
- fret: 프렛 마커(점 인레이)로 번호를 알 수 있는 프렛 중 너트에서 가장 먼, 또렷이 보이는 프렛 줄(12프렛 우선)의 위·아래 끝
- 너트가 화면 밖이면 found=false
- lowStringOnTop: 가장 굵은 줄이 화면 위쪽이면 true` },
      { inlineData: { mimeType: 'image/jpeg', data: await AI.blobB64(blob) } }]);
    const ok = p => p && typeof p.x === 'number' && typeof p.y === 'number' && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
    if (ans && ans.found && ans.nut && ans.fret && ok(ans.nut.top) && ok(ans.nut.bottom) && ok(ans.fret.top) && ok(ans.fret.bottom) && [5, 7, 9, 12, 15, 17].includes(ans.fret.number)) {
      S.cal = { pts: [[ans.nut.top.x, ans.nut.top.y], [ans.nut.bottom.x, ans.nut.bottom.y], [ans.fret.top.x, ans.fret.top.y], [ans.fret.bottom.x, ans.fret.bottom.y]], fA: 0, fB: ans.fret.number };
      $('fA').value = '0'; $('fB').value = String(ans.fret.number);
      if (typeof ans.lowStringOnTop === 'boolean') $('topIsLow').checked = ans.lowStringOnTop;
      drawCalib(); toast('넥 위치를 잡았습니다. 노란 프렛 선이 실제 프렛과 겹치는지 확인하고 저장하세요', 5000);
    } else toast('이 장면에서는 넥을 찾지 못했습니다. 너트가 보이는 다른 장면에서 다시 해 보세요', 5000);
  } catch (e) { toast(e.message, 6000); }
  b.disabled = false; b.textContent = 'Gemini로 넥 찾기';
});

// 곡 정보 (유튜브 링크)
$('btnSongInfo').addEventListener('click', async () => {
  const url = $('ytUrl').value.trim();
  if (!/^https?:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\//.test(url)) return toast('유튜브 주소를 넣어 주세요');
  const b = $('btnSongInfo'); b.disabled = true; b.textContent = '영상 보는 중…';
  const out = $('aiOut'); out.hidden = false; out.textContent = 'Gemini가 영상을 보고 있습니다. 1분 정도 걸릴 수 있습니다…';
  try {
    const ans = await ask([{ fileData: { fileUri: url } }, { text: `이 영상의 곡에서 베이스 파트를 채보하려고 합니다. 들리는 대로 판단하고 JSON만 반환하세요:
{"title": "곡 제목", "artist": "연주자", "bpm": 숫자, "timeSignature": "4/4" 형식, "key": "조성", "bassTuning": "standard|dropD|halfDown|wholeDown|fiveString", "bassStrings": 4|5|6, "techniques": ["들리거나 보이는 베이스 주법"], "sections": [{"start": 초, "end": 초, "name": "구간 이름", "chords": ["코드"]}], "notes": "채보에 도움이 될 한국어 메모 2~3문장"}` }], { temperature: 0.1 });
    S.songInfo = ans;
    const lines = [];
    if (ans.title) { $('title').value = ans.artist ? `${ans.title} — ${ans.artist}` : ans.title; lines.push(`곡: ${$('title').value}`); }
    if (ans.bpm > 30 && ans.bpm < 260) { $('bpm').value = Math.round(ans.bpm * 2) / 2; lines.push(`BPM: ${ans.bpm} (설정에 넣었습니다)`); }
    const ts = String(ans.timeSignature || '').match(/^(\d)\/4$/); if (ts && ['2', '3', '4', '6'].includes(ts[1])) { $('meter').value = ts[1]; S.beats = +ts[1]; lines.push(`박자: ${ans.timeSignature}`); }
    if (ans.key) lines.push(`조성: ${ans.key}`);
    const tmap = { standard: (ans.bassStrings === 5 ? '5std' : ans.bassStrings === 6 ? '6std' : '4std'), dropD: '4dropd', halfDown: ans.bassStrings === 5 ? '5half' : '4half', wholeDown: '4whole', fiveString: '5std' };
    if (tmap[ans.bassTuning]) { $('tuning').value = tmap[ans.bassTuning]; S.tuning = TUNINGS.find(t => t.id === tmap[ans.bassTuning]); lines.push(`튜닝: ${S.tuning.label}`); }
    if (Array.isArray(ans.techniques) && ans.techniques.length) lines.push('주법: ' + ans.techniques.join(', '));
    if (Array.isArray(ans.sections)) lines.push('구간: ' + ans.sections.slice(0, 12).map(s => `${fmtTime(s.start)} ${s.name}${s.chords && s.chords.length ? ' (' + s.chords.slice(0, 6).join(' ') + ')' : ''}`).join(' · '));
    if (ans.notes) lines.push(ans.notes);
    out.textContent = lines.join('\n') + (S.result ? '\n\nBPM·박자를 바꿨다면 악보에 반영하려면 다시 분석하거나 BPM 칸을 다시 입력하세요.' : '');
    render();
  } catch (e) { out.textContent = '곡 정보를 받지 못했습니다: ' + e.message + '\n(공개 영상만 됩니다. 무료 키는 영상 길이에 따라 한도를 넘을 수 있습니다.)'; }
  b.disabled = false; b.textContent = '곡 정보 받기 (BPM·키·박자)';
});

// 악보 검토 (베이스 소리 + 음표 목록을 40초씩)
let suggestions = [], stopReq = null;
$('btnStop').addEventListener('click', () => { if (stopReq) stopReq.abort(); });
$('btnReview').addEventListener('click', async () => {
  if (!S.result) return toast('먼저 분석하세요');
  const b = $('btnReview'); b.disabled = true; $('btnStop').hidden = false;
  const out = $('aiOut'); out.hidden = false; $('sugg').hidden = true; $('btnApply').hidden = true;
  suggestions = []; stopReq = new AbortController();
  const wide = S.result.wide, wsr = S.result.wideSr, off = S.offset || 0;
  const tEnd = off + wide.length / wsr, CH = 40;
  const spb = 4 * S.beats, summaries = [];
  const ctx = S.songInfo ? `참고 곡 정보: ${JSON.stringify({ key: S.songInfo.key, bpm: S.songInfo.bpm, sections: S.songInfo.sections })}\n` : '';
  try {
    for (let c0 = off; c0 < tEnd - 1; c0 += CH) {
      const c1 = Math.min(tEnd, c0 + CH);
      const inChunk = S.notes.filter(n => n.start >= c0 && n.start < c1);
      out.textContent = `${fmtTime(c0)}~${fmtTime(c1)} 구간 검토 중… (제안 ${suggestions.length}개)`;
      const a = Math.floor((c0 - off) * wsr), z = Math.floor((c1 - off) * wsr);
      const seg = C.biquad(C.biquad(wide.subarray(a, z), 'lp', 900, wsr), 'lp', 900, wsr);
      const wav = AI.wavBytes(seg, wsr);
      const rows = inChunk.map(n => [S.notes.indexOf(n), (n.start - c0).toFixed(2), (n.dur || S.six * n.len).toFixed(2), n.dead ? 'x' : nameOf(n.midi), n.dead ? '-' : `${sName(S.tuning.open[n.string])}${n.fret}`,
        [n.tech, n.bend ? 'bend' + n.bend : '', n.vib ? 'vib' : '', n.slideIn ? 'slidein' : '', n.slideOut ? 'slideout' : ''].filter(Boolean).join('+') || '-', (n.cert ?? 1).toFixed(2), `${Math.floor(n.slot / spb) + 1}마디`].join('\t')).join('\n');
      const ans = await ask([
        { inlineData: { mimeType: 'audio/wav', data: AI.b64(wav) } },
        { text: `첨부 음원은 곡에서 베이스 기타 소리만 걸러낸 것입니다(0초 = 곡의 ${c0.toFixed(1)}초, 다른 악기 소리가 조금 섞여 있을 수 있음).
아래는 이 구간의 자동 채보 결과입니다. 튜닝(낮은 줄→높은 줄): ${S.tuning.open.map(nameOf).join(' ')}, BPM ${S.bpm.toFixed(1)}, ${S.beats}/4.
${ctx}열: 번호, 시작(초, 첨부 음원 기준), 길이(초), 음높이, 줄+프렛, 주법(h 해머링, p 풀링, s 슬라이드, t 태핑, bend, vib), 확실도(0~1, 낮을수록 의심), 마디
${rows || '(음 없음)'}

음원을 잘 듣고, 확실히 들리는 문제만 고쳐 주세요.
1. 음높이가 틀린 음 (특히 확실도가 낮은 음, 옥타브 오류)
2. 실제로는 없는 음 (다른 악기·드럼 소리를 잘못 잡은 것)
3. 빠진 음 (베이스가 쳤는데 목록에 없는 음): 시작 시간(첨부 음원 기준 초), 길이, 음높이(MIDI 번호)
4. 주법이 틀린 경우
확실하지 않으면 제안하지 마세요. 줄·프렛은 바꾸지 마세요(음높이만).
JSON만 반환: {"summary": "이 구간에 대한 한국어 한두 문장", "changes": [{"i": 번호, "midi": 새 MIDI 번호 또는 생략, "delete": true 또는 생략, "tech": "h"|"p"|"s"|"t"|null 또는 생략, "reason": "짧은 이유"}], "add": [{"start": 초, "dur": 초, "midi": MIDI 번호, "reason": "짧은 이유"}]}` }],
        { signal: stopReq.signal });
      if (ans.summary) summaries.push(`${fmtTime(c0)}~ ${ans.summary}`);
      (ans.changes || []).forEach(ch => { const n = S.notes[ch.i]; if (!n || !Number.isInteger(ch.i)) return; if (ch.midi != null && !(Number.isInteger(ch.midi) && ch.midi >= 20 && ch.midi <= 72)) return; suggestions.push({ kind: 'change', id: n.id, ...ch }); });
      (ans.add || []).forEach(ad => { if (!(ad.start >= 0 && ad.start <= CH && Number.isInteger(ad.midi) && ad.midi >= 20 && ad.midi <= 72)) return; suggestions.push({ kind: 'add', start: c0 + ad.start, dur: Math.max(0.08, Math.min(2, ad.dur || 0.25)), midi: ad.midi, reason: ad.reason }); });
    }
    out.textContent = summaries.join('\n') || '총평이 없습니다.';
  } catch (e) {
    out.textContent = (e.name === 'AbortError' ? '검토를 멈췄습니다.' : '검토 중 오류: ' + e.message) + (summaries.length ? '\n' + summaries.join('\n') : '');
  }
  showSuggestions();
  b.disabled = false; $('btnStop').hidden = true; stopReq = null;
});
const esc = s => String(s ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
function showSuggestions() {
  const box = $('sugg'), spb = 4 * S.beats;
  box.innerHTML = suggestions.length ? suggestions.map((c, k) => {
    if (c.kind === 'add') return `<label><input type="checkbox" checked data-k="${k}"><span><span class="mono">${fmtTime1(c.start)} · 음 추가 ${nameOf(c.midi)}</span><br>${esc(c.reason)}</span></label>`;
    const n = S.notes.find(x => x.id === c.id); if (!n) return '';
    const what = c.delete ? '삭제' : [c.midi != null ? `${nameOf(n.midi)} → ${nameOf(c.midi)}` : '', c.tech !== undefined ? '주법 ' + (c.tech || '피킹') : ''].filter(Boolean).join(', ');
    return `<label><input type="checkbox" checked data-k="${k}"><span><span class="mono">${Math.floor(n.slot / spb) + 1}마디 ${fmtTime1(n.start)} · ${what}</span><br>${esc(c.reason)}</span></label>`;
  }).join('') : '<p class="hint">고칠 점을 찾지 못했습니다.</p>';
  box.hidden = false; $('btnApply').hidden = !suggestions.length;
}
$('btnApply').addEventListener('click', () => {
  pushUndo();
  const picks = [...$('sugg').querySelectorAll('input:checked')].map(x => suggestions[+x.dataset.k]).filter(Boolean);
  const del = new Set(); let added = 0;
  for (const c of picks) {
    if (c.kind === 'add') {
      const slot = Math.max(0, Math.round((c.start - S.origin) / S.six));
      if (S.notes.some(n => n.slot === slot)) continue;
      S.notes.push({ id: uid++, slot, len: Math.max(1, Math.round(c.dur / S.six)), start: c.start, dur: c.dur, midi: c.midi, tech: null, cert: 0.5, src: 'gemini', string: 0, fret: 0 });
      added++; continue;
    }
    const n = S.notes.find(x => x.id === c.id); if (!n) continue;
    if (c.delete) { del.add(n.id); continue; }
    if (c.midi != null) { n.midi = c.midi; n.locked = false; n.cert = Math.max(n.cert ?? 0.5, 0.6); }
    if (c.tech !== undefined) n.tech = c.tech;
  }
  S.notes = S.notes.filter(n => !del.has(n.id)).sort((a, b) => a.slot - b.slot);
  refret(); render(); toast(`제안 ${picks.length}개를 적용했습니다${added ? ` (추가한 음 ${added}개는 ?로 표시)` : ''}`, 4000);
  $('sugg').hidden = true; $('btnApply').hidden = true;
});

// ------------------------------------------------------------------ 내보내기
async function saveFile(filename, blob) {
  try {
    const file = new File([blob], filename, { type: blob.type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: filename }); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}
const safeName = () => ($('title').value || 'bass-tab').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80);
async function renderPages() {
  await document.fonts.ready;
  const PW = 1240, PH = 1754, M = 80, W = PW - 2 * M, nStr = S.tuning.open.length;
  const { systems, spb } = layoutSystems(S.notes, W, S.beats);
  const m = sysMetrics(W, nStr);
  const pages = []; let c = null, y = 0, pi = 0;
  const newPage = () => {
    const cv = document.createElement('canvas'); cv.width = PW; cv.height = PH; c = cv.getContext('2d');
    c.fillStyle = '#fafbfd'; c.fillRect(0, 0, PW, PH); y = M; pi++;
    if (pi === 1) {
      c.fillStyle = '#222831'; c.font = '64px "Nanum Pen Script", cursive'; c.textBaseline = 'top'; c.fillText($('title').value || '제목 없음', M, y);
      c.font = '34px "Nanum Pen Script", cursive'; c.textAlign = 'right'; c.fillText($('meta').textContent, PW - M, y + 22); c.textAlign = 'left';
      y += 84; c.strokeStyle = 'rgba(43,47,54,.3)'; c.lineWidth = 2; c.beginPath(); c.moveTo(M, y); c.lineTo(PW - M, y); c.stroke(); y += 12;
      c.fillStyle = PEN; c.font = '28px "Nanum Pen Script", cursive'; c.fillText([...$('legend').children].map(s => s.textContent).join('   '), M, y); y += 46;
    }
    c.fillStyle = 'rgba(43,47,54,.5)'; c.font = '26px Caveat, cursive'; c.textAlign = 'center'; c.textBaseline = 'alphabetic'; c.fillText(String(pi), PW / 2, PH - 40); c.textAlign = 'left';
    pages.push(cv);
  };
  newPage();
  systems.forEach((sys, i) => {
    if (y + m.h > PH - M) newPage();
    const ns = S.notes.filter(n => n.slot >= sys.b0 * spb && n.slot < sys.b1 * spb);
    drawSystem(c, sys, ns, S.notes, { x: M, y, w: W, nStr, spb, playId: null, sysIndex: i });
    y += m.h + 8;
  });
  return pages;
}
function dataUrlBytes(u) { const b = atob(u.split(',')[1]); const a = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; }
function makePdf(jpegs, pw, ph) {
  const enc = new TextEncoder(), parts = [], offs = []; let len = 0;
  const push = x => { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); len += b.length; };
  push('%PDF-1.4\n');
  const n = jpegs.length, kids = [];
  const obj = (id, body) => { offs[id] = len; push(`${id} 0 obj\n`); body(); push('\nendobj\n'); };
  for (let i = 0; i < n; i++) kids.push(`${3 + i * 3} 0 R`);
  obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => push(`<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${n} >>`));
  jpegs.forEach((j, i) => {
    const p = 3 + i * 3, cs = p + 1, im = p + 2, content = `q ${pw} 0 0 ${ph} 0 0 cm /Im0 Do Q`;
    obj(p, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 ${im} 0 R >> >> /Contents ${cs} 0 R >>`));
    obj(cs, () => push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));
    obj(im, () => { push(`<< /Type /XObject /Subtype /Image /Width ${j.w} /Height ${j.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${j.bytes.length} >>\nstream\n`); push(j.bytes); push('\nendstream'); });
  });
  const total = 3 + n * 3, xref = len;
  let x = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let i = 1; i < total; i++) x += String(offs[i]).padStart(10, '0') + ' 00000 n \n';
  push(x + `trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  const out = new Uint8Array(len); let o = 0; parts.forEach(p => { out.set(p, o); o += p.length; }); return out;
}
$('btnPdf').addEventListener('click', async () => {
  const pages = await renderPages();
  const jpegs = pages.map(cv => ({ w: cv.width, h: cv.height, bytes: dataUrlBytes(cv.toDataURL('image/jpeg', 0.92)) }));
  saveFile(safeName() + '.pdf', new Blob([makePdf(jpegs, 595.28, 841.89)], { type: 'application/pdf' }));
});
$('btnPng').addEventListener('click', async () => {
  const pages = await renderPages();
  const cv = document.createElement('canvas'); cv.width = pages[0].width; cv.height = pages.reduce((s, p) => s + p.height, 0);
  const c = cv.getContext('2d'); let y = 0; pages.forEach(p => { c.drawImage(p, 0, y); y += p.height; });
  cv.toBlob(b => saveFile(safeName() + '.png', b), 'image/png');
});
$('btnTxt').addEventListener('click', () => saveFile(safeName() + '.txt', new Blob([textTab()], { type: 'text/plain' })));
function textTab() {
  const nStr = S.tuning.open.length, spb = 4 * S.beats;
  const last = S.notes.reduce((m, n) => Math.max(m, n.slot), 0), bars = Math.floor(last / spb) + 1;
  const grid = Array.from({ length: nStr }, () => new Array(bars * spb).fill('---'));
  S.notes.forEach((n, i) => {
    let t = n.dead ? 'x' : String(n.fret);
    if (n.ghost) t = '(' + t + ')';
    const prev = S.notes[i - 1];
    const pre = n.tech === 'h' ? 'h' : n.tech === 'p' ? 'p' : n.tech === 't' ? 't' : n.tech === 's' ? (prev && prev.midi <= n.midi ? '/' : '\\') : n.slideIn ? '/' : '';
    const post = (n.bend ? 'b' + (n.release ? 'r' : '') : '') + (n.vib ? '~' : '') + (n.slideOut ? '\\' : '') + (n.cert != null && n.cert < 0.55 ? '?' : '');
    grid[n.string][n.slot] = (pre + t + post).padEnd(3, '-');
  });
  const lines = [$('title').value, $('meta').textContent, 'h 해머링  p 풀링  / \\ 슬라이드  t 태핑  b 벤딩  r 릴리스  ~ 비브라토  x 데드  ? 불확실', ''];
  for (let b0 = 0; b0 < bars; b0 += 4) {
    lines.push(`  마디 ${b0 + 1}`);
    for (let s = nStr - 1; s >= 0; s--) {
      let l = sName(S.tuning.open[s]).padStart(2) + '|';
      for (let b = b0; b < Math.min(bars, b0 + 4); b++) l += grid[s].slice(b * spb, (b + 1) * spb).join('') + '|';
      lines.push(l);
    }
    lines.push('');
  }
  return lines.join('\n');
}
$('btnSave').addEventListener('click', () => saveFile(safeName() + '.json', new Blob([JSON.stringify({ v: 2, title: $('title').value, tuning: S.tuning.id, bpm: S.bpm, beats: S.beats, origin: S.origin, six: S.six, keys: S.keys, notes: S.notes.map(n => { const { hand, ...rest } = n; return rest; }) })], { type: 'application/json' })));
$('loadJson').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    S.tuning = TUNINGS.find(t => t.id === d.tuning) || TUNINGS[0]; $('tuning').value = S.tuning.id;
    S.bpm = d.bpm; S.beats = d.beats || 4; $('meter').value = S.beats; S.origin = d.origin || 0; S.six = d.six || 60 / S.bpm / 4;
    S.notes = d.notes.map(n => ({ ...n, id: uid++ })); $('title').value = d.title || ''; S.keys = d.keys || [];
    S.example = false; $('exBadge').hidden = true; S.undo = []; renderKeys(); render(); toast('작업을 불러왔습니다');
  } catch (err) { toast('작업 파일을 읽지 못했습니다'); }
  e.target.value = '';
});

// ------------------------------------------------------------------ 시작
loadExample();
render();
if (document.fonts) document.fonts.ready.then(render);
window.__bt = { S, C };
