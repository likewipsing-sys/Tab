// main.js — 베이스 연습 노트: 화면 전환, 메트로놈, 주법 연습, AI 악보, 라이브러리, PDF, 기록, 설정
import { Engine, tapTempo, toWav } from './audio.js';
import { TabView } from './tabview.js';
import { Store } from './store.js';
import { PdfViewer, pdfInfo } from './pdfview.js';
import * as AI from './engines.js';
import fileCfg from './firebase-config.js';

const T = window.BassTheory, G = window.BassAI;
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const toast = (msg, ms = 2800) => { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, ms); };
const ls = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 저장 불가 */ } } };
const fmtMin = s => s >= 3600 ? `${Math.floor(s / 3600)}시간 ${Math.round(s % 3600 / 60)}분` : `${Math.round(s / 60)}분`;
const dayKey = t => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const TECH = Object.assign({}, T.TECHNIQUES, { metronome: '메트로놈', song: '곡 연습', pdf: 'PDF 악보' });

const store = new Store();
const engine = new Engine();
const settings = () => store.settings();
const tuningId = () => settings().tuning || '4std';

// ------------------------------------------------------------------ 화면 전환
let view = 'home';
function show(v) {
  view = v;
  document.querySelectorAll('section.view').forEach(s => { s.hidden = s.id !== 'v-' + v; });
  document.querySelectorAll('.tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.v === v || (v === 'play' && b.dataset.v === playFrom))));
  document.body.classList.toggle('view-trans', v === 'trans');
  if (v !== 'play') ls.set('bp.view', v);
  if (v === 'home') renderHome();
  if (v === 'lib') renderLib();
  if (v === 'play') tv.render();
  window.scrollTo(0, 0);
}
document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => show(b.dataset.v)));

// ------------------------------------------------------------------ 로그인
function renderAuth() {
  const u = store.user;
  $('userName').textContent = u ? (u.name || u.email || '내 계정') : (store.cfgOk ? '로그인' : '이 기기 저장');
  $('userAv').innerHTML = u && u.photo ? `<img src="${esc(u.photo)}" alt="" referrerpolicy="no-referrer">` : esc(u ? (u.name || u.email || '?').slice(0, 1) : '?');
  $('hmLogin').hidden = !!u;
  $('hmLoginMsg').textContent = store.cfgOk ? 'Google 계정으로 로그인하면 연습 기록과 악보가 계정에 저장되어 다른 기기에서도 이어서 볼 수 있습니다. 로그인하지 않아도 이 기기에 저장됩니다.' : '로그인 기능은 설정 탭에서 Firebase 설정을 넣으면 켜집니다. 지금은 이 기기에 저장됩니다.';
  $('hmLoginBtn').textContent = store.cfgOk ? 'Google로 로그인' : '설정으로 가기';
  $('setLogin').hidden = !!u; $('setLogout').hidden = !u;
  $('setSync').textContent = store.status;
  $('setAccountMsg').textContent = u ? `${u.name || ''} ${u.email ? '(' + u.email + ')' : ''} 계정에 저장합니다.` : store.cfgOk ? '로그인하지 않았습니다. 기록은 이 기기에만 저장됩니다.' : 'Firebase 설정이 없어 로그인 기능이 꺼져 있습니다. 아래에 설정을 붙여넣으면 켜집니다.';
  if (store.lastError && !u) $('setAccountMsg').textContent += ` (오류: ${store.lastError.code || store.lastError.message})`;
}
function doLogin() {
  if (!store.cfgOk) { show('settings'); $('setFbBox').open = true; return; }
  store.signIn().catch(e => toast('로그인하지 못했습니다: ' + (e.code === 'auth/unauthorized-domain' ? '이 주소가 Firebase 승인 도메인에 없습니다 (README 4단계)' : (e.code || e.message)), 6000));
}
$('hmLoginBtn').addEventListener('click', doLogin);
$('setLogin').addEventListener('click', doLogin);
$('setLogout').addEventListener('click', () => store.signOut());
$('userChip').addEventListener('click', () => { show('settings'); });
store.onChange(what => { if (what === 'auth') renderAuth(); if (what === 'data') { if (view === 'home') renderHome(); if (view === 'lib') renderLib(); applySettings(); } });

// Firebase 설정: 파일(firebase-config.js) 또는 설정 탭에 붙여넣은 값
function fbConfig() {
  if (fileCfg && fileCfg.apiKey) return fileCfg;
  return ls.get('bp.fbcfg', null);
}
$('setFbCfg').value = (() => { const c = ls.get('bp.fbcfg', null); return c ? JSON.stringify(c, null, 1) : ''; })();
$('setFbSave').addEventListener('click', () => {
  const txt = $('setFbCfg').value, cfg = {};
  for (const k of ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId', 'measurementId']) {
    const m = txt.match(new RegExp(`["']?${k}["']?\\s*:\\s*["']([^"']+)["']`)); if (m) cfg[k] = m[1];
  }
  if (!cfg.apiKey || !cfg.projectId || !cfg.authDomain) return toast('apiKey, authDomain, projectId를 찾지 못했습니다. firebaseConfig 내용을 통째로 붙여넣어 주세요', 5000);
  ls.set('bp.fbcfg', cfg); toast('저장했습니다. 다시 불러옵니다'); setTimeout(() => location.reload(), 700);
});
$('setFbClear').addEventListener('click', () => { try { localStorage.removeItem('bp.fbcfg'); } catch (e) { /* 무시 */ } $('setFbCfg').value = ''; toast('지웠습니다. 다시 불러오면 로그인 기능이 꺼집니다'); });

// ------------------------------------------------------------------ 설정
Object.entries(T.TUNINGS).forEach(([id, t]) => { $('setTuning').add(new Option(t.label, id)); $('genTuning').add(new Option(t.label, id)); });
function applySettings() {
  const s = settings();
  $('setTuning').value = s.tuning || '4std'; $('genTuning').value = $('genTuning').value || s.tuning || '4std';
  $('setBassVol').value = s.bassVol ?? 0.8; $('setBassVolOut').textContent = Math.round((s.bassVol ?? 0.8) * 100) + '%';
  $('mtVol').value = s.clickVol ?? 0.8; $('mtVolOut').textContent = Math.round((s.clickVol ?? 0.8) * 100) + '%';
  $('setMinSec').value = s.minSec ?? 20;
  engine.setVolumes(s.clickVol ?? 0.8, s.bassVol ?? 0.8);
}
$('setTuning').addEventListener('change', () => store.saveSettings({ tuning: $('setTuning').value }));
$('setBassVol').addEventListener('input', () => { $('setBassVolOut').textContent = Math.round($('setBassVol').value * 100) + '%'; engine.setVolumes(null, +$('setBassVol').value); });
$('setBassVol').addEventListener('change', () => store.saveSettings({ bassVol: +$('setBassVol').value }));
$('mtVol').addEventListener('input', () => { $('mtVolOut').textContent = Math.round($('mtVol').value * 100) + '%'; engine.setVolumes(+$('mtVol').value, null); });
$('mtVol').addEventListener('change', () => store.saveSettings({ clickVol: +$('mtVol').value }));
$('setMinSec').addEventListener('change', () => store.saveSettings({ minSec: Math.max(5, +$('setMinSec').value || 20) }));

// Gemini (채보 탭과 같은 키 저장소를 씀)
const gem = { key: ls.get('bt.gemKey', ''), model: ls.get('bt.gemModel', ''), ok: false };
$('setGemKey').value = gem.key;
async function gemConnect(quiet) {
  const key = $('setGemKey').value.trim(); if (!key) { if (!quiet) toast('API 키를 넣어 주세요'); return; }
  const b = $('setGemConnect'); b.disabled = true; b.textContent = '확인 중…';
  try {
    const ms = await AI.geminiModels(key);
    if (!ms.length) throw new Error('쓸 수 있는 Gemini 모델이 없습니다');
    gem.key = key; ls.set('bt.gemKey', key);
    const sel = $('setGemModel'); sel.innerHTML = ''; ms.forEach(m => sel.add(new Option(m.label, m.id)));
    sel.value = ms.some(m => m.id === gem.model) ? gem.model : ms[0].id; gem.model = sel.value; ls.set('bt.gemModel', gem.model);
    $('setGemModelRow').hidden = false; gem.ok = true;
    // 채보 탭도 같은 키로 연결
    const tk = $('gemKey'); if (tk && !tk.value) { tk.value = key; $('gemConnect') && $('gemConnect').click(); }
    if (!quiet) toast('Gemini에 연결했습니다');
  } catch (e) { gem.ok = false; if (!quiet) toast(e.message, 6000); }
  b.disabled = false; b.textContent = '연결 확인'; gemState();
}
function gemState() { const t = gem.ok ? '연결됨' : '연결 안 됨'; $('setGemState').textContent = t; $('genState').textContent = 'Gemini ' + t; $('genGo').disabled = !gem.ok; }
$('setGemConnect').addEventListener('click', () => gemConnect(false));
$('setGemModel').addEventListener('change', () => { gem.model = $('setGemModel').value; ls.set('bt.gemModel', gem.model); });
if (gem.key) gemConnect(true); else gemState();

// 백업
$('setExport').addEventListener('click', () => {
  const data = { app: 'bass-practice', v: 1, at: Date.now(), tabs: store.list('tabs'), sessions: store.list('sessions'), pdfs: store.list('pdfs'), settings: settings() };
  saveBlob(`베이스연습_백업_${dayKey(Date.now())}.json`, new Blob([JSON.stringify(data)], { type: 'application/json' }));
});
$('setImport').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const d = JSON.parse(await f.text()); let n = 0;
    for (const c of ['tabs', 'sessions']) for (const x of d[c] || []) { if (!store.get(c, x.id)) { await store.put(c, x, { keepTime: true }); n++; } }
    toast(`${n}개를 불러왔습니다`);
  } catch (err) { toast('백업 파일을 읽지 못했습니다'); }
  e.target.value = '';
});

async function saveBlob(name, blob) {
  try { const file = new File([blob], name, { type: blob.type }); if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return; } }
  catch (e) { if (e && e.name === 'AbortError') return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}

// ------------------------------------------------------------------ 연습 기록
let cur = null;   // 지금 하는 연습 {kind:'metro'|'tab', tab, startBpm, maxBpm}
engine.on('bpm', d => { if (cur) cur.maxBpm = Math.max(cur.maxBpm || 0, d.bpm); if (cur && cur.kind === 'tab') showPlBpm(d.bpm); if (cur && cur.kind === 'metro') setMetroBpm(d.bpm, true); toast(`♩ ${d.bpm}로 빨라졌습니다`, 1500); });
engine.on('stop', async d => {
  releaseWake();
  const c = cur; cur = null; syncPlayButtons();
  if (!c) return;
  const minSec = settings().minSec ?? 20;
  if (d.seconds < minSec) return;
  const tab = c.tab;
  const rec = { date: Date.now(), seconds: Math.round(d.seconds), technique: c.kind === 'metro' ? 'metronome' : (tab.technique || 'song'), title: c.kind === 'metro' ? `메트로놈 ♩${c.startBpm}` : tab.title, tabId: tab && tab.id || null, bpm: c.startBpm, maxBpm: Math.max(c.maxBpm || 0, d.bpm || 0, c.startBpm), loops: d.loops || 0 };
  await store.put('sessions', rec);
  if (tab && tab.id && store.get('tabs', tab.id)) {
    const t = store.get('tabs', tab.id);
    if (rec.maxBpm > (t.bestBpm || 0)) { t.bestBpm = rec.maxBpm; await store.put('tabs', t, { keepTime: true }); }
  }
  toast(`${fmtMin(rec.seconds)} 연습을 기록했습니다`);
});
let wake = null;
async function holdWake() { try { if (navigator.wakeLock && !wake) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } } catch (e) { /* 지원 안 함 */ } }
function releaseWake() { if (wake) { wake.release().catch(() => {}); wake = null; } }

// ------------------------------------------------------------------ 홈
function renderHome() {
  const ses = store.list('sessions'), now = Date.now(), today = dayKey(now);
  const byDay = {}; ses.forEach(s => { const k = dayKey(s.date); byDay[k] = (byDay[k] || 0) + (s.seconds || 0); });
  $('hmToday').textContent = fmtMin(byDay[today] || 0);
  let streak = 0; for (let i = 0; i < 400; i++) { const k = dayKey(now - i * 86400000); if (byDay[k]) streak++; else if (i > 0) break; }
  $('hmStreak').textContent = streak + '일';
  let week = 0; const bars = [];
  for (let i = 6; i >= 0; i--) { const k = dayKey(now - i * 86400000); week += byDay[k] || 0; bars.push({ k, s: byDay[k] || 0, label: ['일', '월', '화', '수', '목', '금', '토'][new Date(now - i * 86400000).getDay()], today: i === 0 }); }
  $('hmWeek').textContent = fmtMin(week);
  $('hmTabs').textContent = store.list('tabs').length + '개';
  const mx = Math.max(60, ...bars.map(b => b.s));
  $('hmWeekBars').innerHTML = bars.map(b => `<div class="${b.today ? 'today' : ''}" title="${b.k}: ${fmtMin(b.s)}"><span>${b.s ? Math.round(b.s / 60) : ''}</span><i style="height:${Math.round(b.s / mx * 80)}%"></i><span>${b.label}</span></div>`).join('');
  const byTech = {}; ses.forEach(s => { byTech[s.technique] = (byTech[s.technique] || 0) + (s.seconds || 0); });
  const tmax = Math.max(1, ...Object.values(byTech));
  const techs = Object.keys(T.TECHNIQUES).concat(['metronome', 'song', 'pdf']);
  $('hmTech').innerHTML = techs.filter(t => byTech[t] || T.TECHNIQUES[t]).map(t => `<div class="r"><span>${TECH[t]}</span><span class="tr"><i style="width:${Math.round((byTech[t] || 0) / tmax * 100)}%"></i></span><span class="mono">${fmtMin(byTech[t] || 0)}</span></div>`).join('');
  $('hmRecent').innerHTML = ses.slice(0, 6).map(s => `<div class="item"><span class="t">${esc(s.title)}</span><span class="s">${new Date(s.date).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })} · ${TECH[s.technique] || s.technique} · ${fmtMin(s.seconds)}${s.maxBpm ? ' · ♩' + s.maxBpm : ''}</span></div>`).join('') || '<p class="empty">아직 연습 기록이 없습니다. 메트로놈이나 주법 연습을 시작하면 여기에 쌓입니다.</p>';
  // 추천: 최근 7일 가장 적게 한 주법
  const recent = {}; ses.filter(s => now - s.date < 7 * 86400000).forEach(s => { recent[s.technique] = (recent[s.technique] || 0) + s.seconds; });
  const sug = Object.keys(T.TECHNIQUES).sort((a, b) => (recent[a] || 0) - (recent[b] || 0))[0];
  homeSuggest = sug;
  $('hmSuggestMsg').textContent = `최근 7일 동안 ${T.TECHNIQUES[sug]} 연습이 ${recent[sug] ? fmtMin(recent[sug]) + '로 가장 적었습니다' : '없었습니다'}. 기본 설정으로 연습 악보를 만들어 드립니다.`;
}
let homeSuggest = 'scale';
$('hmSuggestGo').addEventListener('click', () => { prSel = homeSuggest; renderPracticeOpts(); makePractice(); });

// ------------------------------------------------------------------ 메트로놈
const tap = tapTempo();
let mt = { bpm: ls.get('bp.mtBpm', 90), sub: 1 };
function setMetroBpm(b, fromEngine) {
  mt.bpm = Math.max(30, Math.min(260, Math.round(b)));
  $('mtBpm').textContent = mt.bpm; $('mtSlider').value = mt.bpm; $('mmBpm').textContent = '♩ ' + mt.bpm;
  ls.set('bp.mtBpm', mt.bpm);
  if (!fromEngine && cur && cur.kind === 'metro') engine.setBpm(mt.bpm);
}
setMetroBpm(mt.bpm);
$('mtMinus').addEventListener('click', () => setMetroBpm(mt.bpm - 1));
$('mtPlus').addEventListener('click', () => setMetroBpm(mt.bpm + 1));
$('mtSlider').addEventListener('input', () => setMetroBpm(+$('mtSlider').value));
$('mtTap').addEventListener('click', () => { engine.ensure(); const b = tap(); if (b) setMetroBpm(b); });
document.querySelectorAll('#mtSub .chip').forEach(c => c.addEventListener('click', () => { mt.sub = +c.dataset.sub; document.querySelectorAll('#mtSub .chip').forEach(x => x.setAttribute('aria-pressed', String(x === c))); if (cur && cur.kind === 'metro') startMetro(); }));
$('mtBeats').addEventListener('change', () => { renderLights(); if (cur && cur.kind === 'metro') startMetro(); });
function renderLights() { const n = +$('mtBeats').value; $('mtLights').innerHTML = Array.from({ length: n }, (_, i) => `<i class="${i === 0 ? 'acc' : ''}"></i>`).join(''); }
renderLights();
function startMetro() {
  engine.ensure();
  const o = { bpm: mt.bpm, beats: +$('mtBeats').value, sub: mt.sub, accent: $('mtAccent').checked };
  if ($('mtTrain').checked) o.trainer = { step: +$('mtStep').value || 4, every: +$('mtEvery').value || 4, max: +$('mtMax').value || 200 };
  if ($('mtGap').checked) o.gap = { play: +$('mtGapPlay').value || 2, mute: +$('mtGapMute').value || 2 };
  cur = { kind: 'metro', startBpm: mt.bpm, maxBpm: mt.bpm };
  engine.start(o); holdWake(); syncPlayButtons(); loop();
}
function toggleMetro() { if (engine.running) engine.stop(); else startMetro(); }
$('mtStart').addEventListener('click', toggleMetro);
$('mmToggle').addEventListener('click', () => { if (engine.running) engine.stop(); else startMetro(); });
function syncPlayButtons() {
  const on = engine.running, m = on && cur && cur.kind === 'metro', t = on && cur && cur.kind === 'tab';
  $('mtStart').textContent = m ? '■ 멈추기' : '▶ 시작';
  $('mmToggle').textContent = on ? '■' : '▶'; $('mmToggle').classList.toggle('on', on);
  $('plPlay').textContent = t ? '■ 멈추기' : '▶ 연습 시작';
  if (!on) { tv.setPlay(null); document.querySelectorAll('#mtLights i').forEach(i => i.classList.remove('on')); $('countBig').hidden = true; }
}
// 화면 갱신 (재생 위치·박자 표시)
let rafOn = false;
function loop() {
  if (rafOn) return; rafOn = true;
  const step = () => {
    if (!engine.running) { rafOn = false; return; }
    const p = engine.position();
    if (p) {
      const beat = Math.floor(p.rel / 4);
      document.querySelectorAll('#mtLights i').forEach((i, k) => i.classList.toggle('on', k === beat && (p.rel % 4) < 2));
      if (cur && cur.kind === 'tab') {
        if (p.inCount) { $('countBig').hidden = false; $('countBig').textContent = beat + 1; tv.setPlay(null); }
        else { $('countBig').hidden = true; tv.setPlay(p.slot); }
      }
      $('mmBpm').textContent = '♩ ' + (engine.st ? engine.st.bpm : mt.bpm);
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ------------------------------------------------------------------ 악보 연습 (재생 화면)
let playFrom = 'practice';
const P = { tab: null, saved: false, loop: null, loopStart: null };
const tv = new TabView($('plSystems'), { onBar: bar => setLoopBar(bar) });
function openPlayer(tab, { from, saved } = {}) {
  if (engine.running) engine.stop();
  playFrom = from || view; P.tab = tab; P.saved = !!saved; P.loop = null; P.loopStart = null;
  if (typeof setEdit === 'function') { setEdit(false); E.undo = []; E.redo = []; }
  $('plTitle').value = tab.title || '연습 악보';
  $('plTech').textContent = TECH[tab.technique] || '곡'; $('plTech').hidden = !tab.technique;
  $('plSource').textContent = { ai: 'Gemini가 만듦', rule: '자동 생성', transcribe: '채보', import: '가져옴' }[tab.source] || (tab.source ? tab.source : '');
  $('plSource').hidden = !$('plSource').textContent;
  $('plMeta').textContent = `${(T.TUNINGS[tab.tuning] || T.TUNINGS['4std']).label.replace(/ ·.*/, '')} · ♩= ${tab.bpm} · ${tab.beats || 4}/4${tab.swing ? ' · 스윙' : ''}${tab.key ? ' · ' + tab.key : ''}${tab.bestBpm ? ' · 최고 ♩' + tab.bestBpm : ''}`;
  $('plDesc').textContent = tab.desc || ''; $('plDesc').hidden = !tab.desc;
  $('plTips').innerHTML = (tab.tips || []).map(t => `<li>${esc(t)}</li>`).join(''); $('plTips').hidden = !(tab.tips || []).length;
  $('plFixes').textContent = tab.fixes && tab.fixes.length ? '자동 정리: ' + tab.fixes.join(' · ') : ''; $('plFixes').hidden = !$('plFixes').textContent;
  showPlBpm(tab.lastBpm || tab.bpm);
  $('plBpmReset').textContent = `원래 속도 ♩${tab.bpm}`;
  $('plSave').textContent = P.saved ? '저장됨' : '라이브러리에 저장'; $('plSave').disabled = P.saved;
  updLoop();
  show('play');
  tv.set(tab, T.openOf(tab.tuning));
}
$('plBack').addEventListener('click', () => { if (engine.running) engine.stop(); setEdit(false); show(playFrom || 'practice'); });
$('plTitle').addEventListener('change', async () => { if (!P.tab) return; P.tab.title = $('plTitle').value.trim() || P.tab.title; if (P.saved) await store.put('tabs', P.tab, { keepTime: true }); });
$('plSave').addEventListener('click', async () => {
  if (!P.tab) return;
  P.tab.title = $('plTitle').value.trim() || P.tab.title;
  const v = await store.put('tabs', P.tab);
  Object.assign(P.tab, { id: v.id, createdAt: v.createdAt, updatedAt: v.updatedAt }); P.saved = true; $('plSave').textContent = '저장됨'; $('plSave').disabled = true; toast('라이브러리에 저장했습니다');
});
function setLoopBar(bar) {
  if (P.loopStart == null) { P.loopStart = bar; P.loop = [bar, bar + 1]; }
  else { const a = Math.min(P.loopStart, bar), b = Math.max(P.loopStart, bar) + 1; P.loop = [a, b]; P.loopStart = null; }
  updLoop();
  if (engine.running && cur && cur.kind === 'tab') startTab();
}
function updLoop() {
  tv.setLoop(P.loop);
  $('plLoop').textContent = P.loop ? `${P.loop[0] + 1}${P.loop[1] - P.loop[0] > 1 ? '–' + P.loop[1] : ''}마디 반복${P.loopStart != null ? ' (끝 마디를 탭하세요)' : ''}` : '전체 반복';
  $('plLoopClear').hidden = !P.loop;
}
$('plMoreBtn').addEventListener('click', () => { const o = $('plMore').classList.toggle('open'); $('plMoreBtn').setAttribute('aria-expanded', String(o)); });
$('plLoopClear').addEventListener('click', () => { P.loop = null; P.loopStart = null; updLoop(); if (engine.running && cur && cur.kind === 'tab') startTab(); });
function startTab() {
  if (!P.tab) return;
  engine.ensure();
  const bpm = +$('plBpm').value || P.tab.bpm;
  const o = { tab: P.tab, bpm, beats: P.tab.beats || 4, open: T.openOf(P.tab.tuning), swing: !!P.tab.swing, countIn: $('plCount').checked ? 1 : 0, clickOn: $('plClick').checked, bassOn: $('plBass').checked, loop: P.loop };
  if ($('plTrain').checked) o.trainer = { step: +$('plStep').value || 4, every: 1, max: 260 };
  cur = { kind: 'tab', tab: P.tab, startBpm: bpm, maxBpm: bpm };
  engine.start(o); holdWake(); syncPlayButtons(); loop();
  if (P.saved) { P.tab.lastBpm = bpm; store.put('tabs', P.tab, { keepTime: true }); }
}
$('plPlay').addEventListener('click', () => { if (engine.running && cur && cur.kind === 'tab') engine.stop(); else startTab(); });
function showPlBpm(b) {
  $('plBpm').value = b; $('plBpmNum').value = b; $('plBpmOut').textContent = '♩ ' + b;
  $('plPct').textContent = P.tab ? Math.round(b / P.tab.bpm * 100) + '%' : '';
}
const setPlBpm = b => {
  b = Math.max(30, Math.min(260, Math.round(b)));
  showPlBpm(b);
  if (engine.running && cur && cur.kind === 'tab') { engine.setBpm(b); cur.maxBpm = Math.max(cur.maxBpm || 0, b); }
  if (P.tab && P.saved) { P.tab.lastBpm = b; clearTimeout(setPlBpm._t); setPlBpm._t = setTimeout(() => store.put('tabs', P.tab, { keepTime: true }), 800); }
};
$('plBpmNum').addEventListener('change', () => setPlBpm(+$('plBpmNum').value || (P.tab ? P.tab.bpm : 90)));
$('plBpmReset').addEventListener('click', () => { if (P.tab) setPlBpm(P.tab.bpm); });
const plTap = tapTempo();
$('plTap').addEventListener('click', () => { engine.ensure(); const b = plTap(); if (b) setPlBpm(b); });
$('plWav').addEventListener('click', async () => {
  if (!P.tab) return;
  if (engine.running) engine.stop();
  const btn = $('plWav'); btn.disabled = true; btn.textContent = '만드는 중…';
  try {
    const bpm = +$('plBpm').value || P.tab.bpm;
    const ab = await engine.renderOffline({ tab: P.tab, bpm, beats: P.tab.beats || 4, open: T.openOf(P.tab.tuning), swing: !!P.tab.swing, countIn: $('plCount').checked ? 1 : 0, clickOn: $('plClick').checked, bassOn: true, loop: P.loop });
    saveBlob(`${($('plTitle').value || '연습').replace(/[\\/:*?"<>|]+/g, '_')}_${bpm}bpm.wav`, toWav(ab));
  } catch (e) { console.error(e); toast('소리 파일을 만들지 못했습니다: ' + e.message); }
  btn.disabled = false; btn.textContent = '소리 저장(WAV)';
});
$('plBpm').addEventListener('input', () => setPlBpm(+$('plBpm').value));
$('plSlower').addEventListener('click', () => setPlBpm(+$('plBpm').value - 2));
$('plFaster').addEventListener('click', () => setPlBpm(+$('plBpm').value + 2));
['plClick', 'plBass', 'plCount', 'plTrain'].forEach(id => $(id).addEventListener('change', () => { if (engine.running && cur && cur.kind === 'tab' && id !== 'plCount') startTab(); }));
document.addEventListener('keydown', e => {
  if (view !== 'play' || /INPUT|SELECT|TEXTAREA/.test((e.target || {}).tagName || '')) return;
  if (e.key === ' ') { e.preventDefault(); $('plPlay').click(); }
});

// 연습 악보 PDF로 저장
$('plPdf').addEventListener('click', async () => {
  if (!P.tab) return;
  await document.fonts.ready;
  const PW = 1240, PH = 1754, M = 80, W = PW - 2 * M;
  const lay = tv.layoutSystems(W), pages = []; let c = null, y = 0;
  const newPage = first => {
    const cv = document.createElement('canvas'); cv.width = PW; cv.height = PH; c = cv.getContext('2d'); c.fillStyle = '#fafbfd'; c.fillRect(0, 0, PW, PH); y = M;
    if (first) {
      c.fillStyle = '#222831'; c.font = '60px "Nanum Pen Script", cursive'; c.textBaseline = 'top'; c.fillText($('plTitle').value, M, y);
      c.font = '32px "Nanum Pen Script", cursive'; c.textAlign = 'right'; c.fillText($('plMeta').textContent, PW - M, y + 20); c.textAlign = 'left'; y += 90;
    }
    pages.push(cv);
  };
  newPage(true);
  const savedTab = tv.tab;
  for (let i = 0; i < lay.systems.length; i++) {
    const h = tv.metrics(W).h; if (y + h > PH - M) newPage(false);
    tv.drawTo(c, i, M, y, W); y += h + 8;
  }
  tv.tab = savedTab;
  const jpg = pages.map(cv => { const u = cv.toDataURL('image/jpeg', 0.9), b = atob(u.split(',')[1]), a = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return { w: cv.width, h: cv.height, bytes: a }; });
  saveBlob(($('plTitle').value || '연습 악보').replace(/[\\/:*?"<>|]+/g, '_') + '.pdf', new Blob([makePdf(jpg, 595.28, 841.89)], { type: 'application/pdf' }));
});
function makePdf(jpegs, pw, ph) {
  const enc = new TextEncoder(), parts = [], offs = []; let len = 0;
  const push = x => { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); len += b.length; };
  push('%PDF-1.4\n'); const n = jpegs.length, kids = [];
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
  const total = 3 + n * 3, xref = len; let x = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let i = 1; i < total; i++) x += String(offs[i]).padStart(10, '0') + ' 00000 n \n';
  push(x + `trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  const out = new Uint8Array(len); let o = 0; parts.forEach(p => { out.set(p, o); o += p.length; }); return out;
}

// ------------------------------------------------------------------ 악보 직접 편집
// 커서(마디 안 16분음표 칸 × 줄)를 옮기며 프렛 번호를 넣는 방식. 한 칸에는 음 하나.
const HARM_FRETS = [12, 7, 5, 4, 9, 19, 16, 24];
const LENS = [[1, '16분'], [2, '8분'], [3, '점8분'], [4, '4분'], [6, '점4분'], [8, '2분'], [12, '점2분'], [16, '온음표']];
const E = { on: false, slot: 0, string: 0, len: 2, undo: [], redo: [], buf: '', bufT: null, clip: null, saveT: null };
const spbOf = () => 4 * ((P.tab && P.tab.beats) || 4);
const openNow = () => T.openOf(P.tab.tuning);
const noteAtSlot = s => P.tab.notes.find(n => n.slot === s) || null;
function snapshot() { const t = P.tab; return JSON.stringify({ notes: t.notes, bars: t.bars, chords: t.chords || null, beats: t.beats, tuning: t.tuning, bpm: t.bpm, swing: !!t.swing }); }
function pushEdit() { E.undo.push(snapshot()); if (E.undo.length > 100) E.undo.shift(); E.redo = []; }
function restore(json) { const d = JSON.parse(json); Object.assign(P.tab, d); edChanged(true); }
function fixMidi(n, open) {
  if (n.dead) { n.midi = null; n.fret = null; return; }
  n.midi = n.harm ? T.harmPitch(open, n.string, n.fret) : open[n.string] + n.fret;
}
/** 겹침 정리·정렬·마디 수 */
function normalize() {
  const t = P.tab, spb = spbOf();
  t.notes.sort((a, b) => a.slot - b.slot);
  for (let i = 0; i < t.notes.length; i++) { const n = t.notes[i], nx = t.notes[i + 1]; n.len = Math.max(1, n.len || 1); if (nx && n.slot + n.len > nx.slot) n.len = Math.max(1, nx.slot - n.slot); }
  const last = t.notes.reduce((m, n) => Math.max(m, n.slot + n.len), 0);
  t.bars = Math.max(1, t.bars || 1, Math.ceil(last / spb));
}
function edChanged(structural) {
  normalize();
  if (structural) tv.set(P.tab, openNow()); else tv.render();
  tv.setCursor(E.on ? { slot: E.slot, string: E.string } : null);
  if (engine.running && cur && cur.kind === 'tab') engine.refreshTab();
  updMeta(); edUI();
  // 저장: 라이브러리에 있는 악보는 자동 저장, 아니면 저장 버튼 켬
  if (P.saved) { clearTimeout(E.saveT); E.saveT = setTimeout(() => store.put('tabs', P.tab, { keepTime: false }).then(v => { P.tab.updatedAt = v.updatedAt; }), 900); $('plSave').textContent = '자동 저장됨'; }
  else { $('plSave').disabled = false; $('plSave').textContent = '라이브러리에 저장'; }
}
function updMeta() {
  const tab = P.tab;
  $('plMeta').textContent = `${(T.TUNINGS[tab.tuning] || T.TUNINGS['4std']).label.replace(/ ·.*/, '')} · ♩= ${tab.bpm} · ${tab.beats || 4}/4${tab.swing ? ' · 스윙' : ''}${tab.key ? ' · ' + tab.key : ''}${tab.bestBpm ? ' · 최고 ♩' + tab.bestBpm : ''}`;
}
function moveCursor(slot, string) {
  const spb = spbOf(), maxSlot = (P.tab.bars + 1) * spb - 1, nStr = openNow().length;
  E.slot = Math.max(0, Math.min(maxSlot, slot)); E.string = Math.max(0, Math.min(nStr - 1, string));
  if (E.slot >= P.tab.bars * spb) { P.tab.bars = Math.floor(E.slot / spb) + 1; tv.set(P.tab, openNow()); }
  const n = noteAtSlot(E.slot); if (n && n.string != null && n.string !== E.string && !n.dead) { /* 다른 줄의 음이 있으면 그 줄로 */ E.string = n.string; }
  if (n) E.len = n.len;
  tv.setCursor({ slot: E.slot, string: E.string }); edUI();
}
function edUI() {
  if (!E.on || !P.tab) return;
  const spb = spbOf(), bar = Math.floor(E.slot / spb), pos = E.slot % spb, beat = Math.floor(pos / 4) + 1, sub = pos % 4;
  const open = openNow(), n = noteAtSlot(E.slot);
  const nm = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][open[E.string] % 12];
  $('edPos').textContent = `${bar + 1}마디 ${beat}박${sub ? ' +' + ['', 'e', '&', 'a'][sub] : ''} · ${nm}줄${n ? (n.dead ? ' · x' : ' · ' + n.fret + '프렛') : ' · 쉼'}`;
  $('edLen').querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', String(+c.dataset.l === E.len)));
  $('edTech').querySelectorAll('.chip').forEach(c => { c.disabled = !n || n.dead; c.setAttribute('aria-pressed', String(!!n && String(n.tech || '') === c.dataset.v)); });
  $('edFx').querySelectorAll('.chip').forEach(c => { const k = c.dataset.k; c.disabled = !n || (n.dead && k !== 'dead' && k !== 'slap' && k !== 'pop'); c.setAttribute('aria-pressed', String(!!n && (k === 'bend' ? (n.bend || 0) === +c.dataset.v && n.bend > 0 : !!n[k]))); });
  $('edUndo').disabled = !E.undo.length; $('edRedo').disabled = !E.redo.length;
  $('edChordLbl').textContent = `${bar + 1}마디 코드`; $('edChord').value = (P.tab.chords && P.tab.chords[bar]) || '';
  $('edBeats').value = String(P.tab.beats || 4); $('edTuning').value = P.tab.tuning || '4std'; $('edBpm').value = P.tab.bpm; $('edSwing').checked = !!P.tab.swing;
}
function audition(n) {
  if (!$('edSound').checked || !n || (engine.running && cur && cur.kind === 'tab')) return;
  const ctx = engine.ensure();
  const dur = Math.min(1.2, (n.len || 1) * 60 / (P.tab.bpm || 90) / 4);
  engine.voices = []; engine.playNote(Object.assign({}, n, { tech: null }), openNow(), ctx.currentTime + 0.02, Math.max(0.15, dur));
}
/** 커서 칸에 프렛 넣기 (이미 음이 있으면 바꿈) */
function putFret(fret, dead, noPush) {
  const open = openNow(), max = 24;
  if (!dead && (fret < 0 || fret > max)) return toast(`프렛은 0~${max}입니다`);
  if (!noPush) pushEdit();
  let n = noteAtSlot(E.slot);
  if (!n) {
    // 앞 음이 이 칸까지 이어지면 잘라 줌
    const prev = P.tab.notes.filter(x => x.slot < E.slot).pop(); if (prev && prev.slot + prev.len > E.slot) prev.len = E.slot - prev.slot;
    n = { slot: E.slot, len: E.len, string: E.string, fret: 0 }; P.tab.notes.push(n);
  }
  n.string = E.string;
  if (dead) { n.dead = true; n.ghost = true; n.fret = null; n.harm = false; }
  else { n.dead = false; if (n.ghost && n.fret == null) n.ghost = false; n.fret = fret; if (n.harm && !HARM_FRETS.includes(fret)) { n.harm = false; toast(`${fret}프렛은 자연 하모닉 위치가 아니라 하모닉 표시를 뺐습니다`); } }
  fixMidi(n, open);
  edChanged(false); audition(n);
}
function delAtCursor() {
  const n = noteAtSlot(E.slot); if (!n) return moveCursor(E.slot - E.len, E.string);
  pushEdit(); P.tab.notes.splice(P.tab.notes.indexOf(n), 1); edChanged(false);
}
function clearBuf() { clearTimeout(E.bufT); E.buf = ''; }
function typeDigit(d) {
  clearTimeout(E.bufT);
  if (E.buf && E.bufSlot === E.slot) {
    // 두 번째 자리 (10~24)
    const v = +(E.buf + d); E.buf = '';
    if (v <= 24) putFret(v, false, true); else toast('프렛은 24까지입니다');
    moveCursor(E.slot + E.len, E.string); return;
  }
  E.buf = '';
  putFret(+d);
  if (d === '1' || d === '2') { E.buf = d; E.bufSlot = E.slot; E.bufT = setTimeout(() => { E.buf = ''; moveCursor(E.slot + E.len, E.string); }, 700); }
  else moveCursor(E.slot + E.len, E.string);
}
function setLen(l) {
  E.len = l;
  const n = noteAtSlot(E.slot);
  if (n) { pushEdit(); const nx = P.tab.notes.find(x => x.slot > n.slot); n.len = l; if (nx && n.slot + l > nx.slot) { n.len = nx.slot - n.slot; toast('다음 음이 있어서 그 앞까지만 늘였습니다. 길게 하려면 다음 음을 먼저 지우세요', 3500); } edChanged(false); }
  else edUI();
}
function setTech(v) {
  const n = noteAtSlot(E.slot); if (!n || n.dead) return;
  pushEdit();
  if (v) {
    const prev = P.tab.notes.filter(x => x.slot < n.slot && !x.dead).pop();
    if (!prev || prev.string !== n.string) { if (v !== 't') toast('해머링·풀링·슬라이드는 앞 음과 같은 줄이어야 소리가 이어집니다'); }
  }
  n.tech = v || null; edChanged(false);
}
function toggleFx(k, val) {
  const n = noteAtSlot(E.slot); if (!n) return;
  pushEdit();
  const open = openNow();
  if (k === 'bend') { n.bend = (n.bend === +val) ? 0 : +val; if (!n.bend) n.release = false; }
  else if (k === 'release') { n.release = !n.release; if (n.release && !n.bend) n.bend = 2; }
  else if (k === 'slideIn') n.slideIn = n.slideIn ? null : 'up';
  else if (k === 'slideOut') n.slideOut = n.slideOut ? null : 'down';
  else if (k === 'dead') { if (n.dead) { n.dead = false; n.ghost = false; n.fret = 0; } else { n.dead = true; n.ghost = true; n.fret = null; n.harm = false; n.tech = null; } }
  else if (k === 'harm') { if (!n.harm && !HARM_FRETS.includes(n.fret)) { E.undo.pop(); return toast('자연 하모닉은 12·7·5·4·9·19프렛 등에서만 납니다'); } n.harm = !n.harm; }
  else if (k === 'slap') { n.slap = !n.slap; if (n.slap) n.pop = false; }
  else if (k === 'pop') { n.pop = !n.pop; if (n.pop) n.slap = false; }
  else n[k] = !n[k];
  fixMidi(n, open);
  edChanged(false); audition(n);
}
function barOp(op) {
  const spb = spbOf(), bar = Math.floor(E.slot / spb), a = bar * spb, b = a + spb, t = P.tab;
  if (op === 'paste' && !E.clip) return toast('먼저 마디를 복사하세요');
  if (op === 'del' && t.bars <= 1) return toast('마디가 하나뿐입니다');
  pushEdit();
  t.chords = t.chords || [];
  if (op === 'add') { t.notes.forEach(n => { if (n.slot >= b) n.slot += spb; }); t.chords.splice(bar + 1, 0, ''); t.bars++; E.slot = b; }
  else if (op === 'del') { t.notes = t.notes.filter(n => n.slot < a || n.slot >= b); t.notes.forEach(n => { if (n.slot >= b) n.slot -= spb; }); t.chords.splice(bar, 1); t.bars--; E.slot = Math.min(E.slot, t.bars * spb - 1); }
  else if (op === 'clear') { t.notes = t.notes.filter(n => n.slot < a || n.slot >= b); }
  else if (op === 'copy') { E.undo.pop(); E.clip = { notes: t.notes.filter(n => n.slot >= a && n.slot < b).map(n => Object.assign({}, n, { slot: n.slot - a })), chord: t.chords[bar] || '' }; return toast(`${bar + 1}마디를 복사했습니다`); }
  else if (op === 'paste') { t.notes = t.notes.filter(n => n.slot < a || n.slot >= b).concat(E.clip.notes.map(n => Object.assign({}, n, { slot: n.slot + a }))); if (E.clip.chord) t.chords[bar] = E.clip.chord; }
  if (t.chords.every(c => !c)) t.chords = null;
  edChanged(true);
}
function setEdit(on) {
  E.on = on && !!P.tab;
  document.body.classList.toggle('editing', E.on);
  $('plEditor').hidden = !E.on; $('plEdit').setAttribute('aria-pressed', String(E.on)); $('plEdit').textContent = E.on ? '✎ 편집 중' : '✎ 편집';
  if (E.on) { const first = P.tab.notes[0]; E.slot = first ? first.slot : 0; E.string = first && first.string != null ? first.string : 0; if (first) E.len = first.len; tv.setCursor({ slot: E.slot, string: E.string }); edUI(); }
  else { tv.setCursor(null); E.buf = ''; }
}
// 버튼 만들기
$('edLen').innerHTML = LENS.map(([l, t]) => `<button type="button" class="chip sm" data-l="${l}">${t}</button>`).join('');
$('edLen').querySelectorAll('.chip').forEach(c => c.addEventListener('click', () => setLen(+c.dataset.l)));
$('edKeys').innerHTML = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'].map(d => `<button type="button" data-d="${d}">${d}</button>`).join('') + '<button type="button" data-a="x" aria-label="데드 노트">x</button><button type="button" data-a="del" aria-label="음 지우기">⌫</button>';
$('edKeys').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { if (b.dataset.d) typeDigit(b.dataset.d); else if (b.dataset.a === 'x') { putFret(0, true); moveCursor(E.slot + E.len, E.string); } else delAtCursor(); }));
$('edTech').innerHTML = [['', '피킹'], ['h', 'H 해머링'], ['p', 'P 풀링'], ['s', '/ 슬라이드'], ['t', 'T 태핑']].map(([v, l]) => `<button type="button" class="chip sm" data-v="${v}">${l}</button>`).join('');
$('edTech').querySelectorAll('.chip').forEach(c => c.addEventListener('click', () => setTech(c.dataset.v)));
$('edFx').innerHTML = [['slap', '', 'S 슬랩'], ['pop', '', 'Po 팝'], ['dead', '', 'x 데드'], ['ghost', '', '( ) 고스트'], ['harm', '', '< > 하모닉'], ['vib', '', '~ 비브라토'], ['bend', '1', '↑ ½'], ['bend', '2', '↑ full'], ['release', '', '릴리스'], ['slideIn', '', '/ 슬라이드 인'], ['slideOut', '', '\\ 슬라이드 아웃']]
  .map(([k, v, l]) => `<button type="button" class="chip sm" data-k="${k}" data-v="${v}">${esc(l)}</button>`).join('');
$('edFx').querySelectorAll('.chip').forEach(c => c.addEventListener('click', () => toggleFx(c.dataset.k, c.dataset.v)));
$('edLeft').addEventListener('click', () => clearBuf() || moveCursor(E.slot - E.len, E.string));
$('edRight').addEventListener('click', () => clearBuf() || moveCursor(E.slot + E.len, E.string));
$('edUp').addEventListener('click', () => clearBuf() || moveCursor(E.slot, E.string + 1));
$('edDown').addEventListener('click', () => clearBuf() || moveCursor(E.slot, E.string - 1));
$('edUndo').addEventListener('click', () => { if (!E.undo.length) return; E.redo.push(snapshot()); restore(E.undo.pop()); });
$('edRedo').addEventListener('click', () => { if (!E.redo.length) return; E.undo.push(snapshot()); restore(E.redo.pop()); });
$('edHear').addEventListener('click', () => { const n = noteAtSlot(E.slot); if (n) { const s = $('edSound').checked; $('edSound').checked = true; audition(n); $('edSound').checked = s; } });
$('edPlay').addEventListener('click', () => { if (engine.running && cur && cur.kind === 'tab') engine.stop(); else startTab(); $('edPlay').textContent = engine.running ? '■ 멈추기' : '▶ 재생'; });
engine.on('stop', () => { $('edPlay').textContent = '▶ 재생'; });
$('edDone').addEventListener('click', () => setEdit(false));
$('plEdit').addEventListener('click', () => setEdit(!E.on));
$('edChord').addEventListener('change', () => { const bar = Math.floor(E.slot / spbOf()); pushEdit(); P.tab.chords = P.tab.chords || []; while (P.tab.chords.length < P.tab.bars) P.tab.chords.push(''); P.tab.chords[bar] = $('edChord').value.trim(); if (P.tab.chords.every(c => !c)) P.tab.chords = null; edChanged(true); });
$('edBarAdd').addEventListener('click', () => barOp('add'));
$('edBarDel').addEventListener('click', () => barOp('del'));
$('edBarClear').addEventListener('click', () => barOp('clear'));
$('edBarCopy').addEventListener('click', () => barOp('copy'));
$('edBarPaste').addEventListener('click', () => barOp('paste'));
Object.entries(T.TUNINGS).forEach(([id, t]) => $('edTuning').add(new Option(t.label, id)));
$('edBeats').addEventListener('change', () => { pushEdit(); P.tab.beats = +$('edBeats').value; edChanged(true); toast('박자를 바꿨습니다. 음 위치는 그대로라 마디 나눔이 달라질 수 있습니다', 4000); });
$('edTuning').addEventListener('change', () => {
  const nt = $('edTuning').value, open = T.openOf(nt), oldOpen = openNow();
  pushEdit();
  // 같은 음높이를 새 튜닝에서 칠 수 있게 줄·프렛 다시 배치
  P.tab.notes.forEach(n => { if (n.dead) { n.string = Math.min(n.string ?? 0, open.length - 1); return; } if (n.harm) { n.string = Math.min(n.string, open.length - 1); return; } n.midi = n.midi ?? oldOpen[n.string] + n.fret; n.string = null; });
  P.tab.tuning = nt;
  T.placeFrets(P.tab.notes, nt, null, null, 24);
  P.tab.notes.forEach(n => fixMidi(n, open));
  E.string = Math.min(E.string, open.length - 1);
  edChanged(true);
});
$('edBpm').addEventListener('change', () => { const b = Math.max(30, Math.min(260, +$('edBpm').value || 90)); pushEdit(); P.tab.bpm = b; $('plBpmReset').textContent = `원래 속도 ♩${b}`; setPlBpm(b); edChanged(false); });
$('edSwing').addEventListener('change', () => { pushEdit(); P.tab.swing = $('edSwing').checked; edChanged(false); });
tv.safeBottom = () => (E.on ? $('plEditor').getBoundingClientRect().height + 24 : 120);
// 악보를 탭: 편집 중이면 그 칸으로 커서
tv.onCell = ({ slot, string }) => { E.buf = ''; clearTimeout(E.bufT); moveCursor(slot, string); E.string = string; const n = noteAtSlot(slot); if (n && n.string != null) E.string = n.string; tv.setCursor({ slot: E.slot, string: E.string }); edUI(); };
// 키보드 (iPad 매직 키보드 등)
document.addEventListener('keydown', e => {
  if (!E.on || view !== 'play' || /INPUT|SELECT|TEXTAREA/.test((e.target || {}).tagName || '')) return;
  const k = e.key;
  if (/^[0-9]$/.test(k)) { e.preventDefault(); typeDigit(k); }
  else if (k === 'ArrowRight') { e.preventDefault(); clearBuf(); moveCursor(E.slot + (e.shiftKey ? 1 : E.len), E.string); }
  else if (k === 'ArrowLeft') { e.preventDefault(); clearBuf(); moveCursor(E.slot - (e.shiftKey ? 1 : E.len), E.string); }
  else if (k === 'ArrowUp') { e.preventDefault(); moveCursor(E.slot, E.string + 1); }
  else if (k === 'ArrowDown') { e.preventDefault(); moveCursor(E.slot, E.string - 1); }
  else if (k === 'Backspace' || k === 'Delete') { e.preventDefault(); delAtCursor(); }
  else if (k === 'x' || k === 'X') { putFret(0, true); moveCursor(E.slot + E.len, E.string); }
  else if (k === 'h' || k === 'p' || k === 's') setTech((noteAtSlot(E.slot) || {}).tech === k ? '' : k);
  else if ((e.metaKey || e.ctrlKey) && k.toLowerCase() === 'z') { e.preventDefault(); (e.shiftKey ? $('edRedo') : $('edUndo')).click(); }
}, true);
// 새 악보
function newTab() {
  const tab = { title: '새 악보', technique: 'song', source: 'user', tuning: tuningId(), bpm: 90, beats: 4, bars: 4, notes: [], createdAt: Date.now() };
  openPlayer(tab, { from: view === 'play' ? 'lib' : view });
  setEdit(true);
  toast('커서를 옮기며 숫자(프렛)를 누르세요. 악보를 탭하면 그 칸으로 갑니다', 4500);
}
$('libNew').addEventListener('click', newTab);
$('prBlank').addEventListener('click', newTab);

// ------------------------------------------------------------------ 주법 연습 (규칙 기반 악보)
const keyOpts = T.KEYS.filter(([k]) => !['Db', 'Gb'].includes(k) || true).map(([k]) => [k, k]);
const OPTS = {
  scale: [['key', '조성', keyOpts, 'C'], ['scale', '스케일', Object.entries(T.SCALES).map(([k, v]) => [k, v.label]), 'major'], ['pattern', '순서', [['updown', '올라갔다 내려오기'], ['thirds', '3도씩'], ['four', '4음 묶음']], 'updown'], ['region', '손 위치', [['low', '낮은 프렛 (0~5)'], ['mid', '중간 (5~9)'], ['high', '높은 프렛 (9~14)']], 'low'], ['octaves', '옥타브', [[1, '1옥타브'], [2, '2옥타브']], 1], ['rhythm', '음표', [[4, '4분음표'], [8, '8분음표'], [16, '16분음표']], 8], ['bpm', 'BPM', 'num', 80]],
  fingering: [['type', '종류', [['chromatic', '크로매틱 (1-2-3-4)'], ['spider', '스파이더'], ['crossing', '스트링 크로싱']], 'chromatic'], ['perm', '손가락 순서', T.PERMS.map(p => [p, p.split('').join('-')]), '1234'], ['position', '시작 프렛', Array.from({ length: 12 }, (_, i) => [i + 1, (i + 1) + '프렛']), 1], ['rhythm', '음표', [[8, '8분음표'], [16, '16분음표']], 16], ['bpm', 'BPM', 'num', 70]],
  walking: [['key', '조성', keyOpts, 'F'], ['progression', '코드 진행', Object.entries(T.PROGRESSIONS).filter(([k]) => ['blues', 'minorblues', 'iiVI', 'iiVIminor', 'rhythm', 'autumn'].includes(k)).map(([k, v]) => [k, v.label]), 'blues'], ['swing', '느낌', [['1', '스윙'], ['0', '스트레이트']], '1'], ['bpm', 'BPM', 'num', 100]],
  slap: [['key', '조성', keyOpts, 'E'], ['level', '패턴', [['beginner', '입문 옥타브'], ['disco', '디스코 옥타브'], ['funk', '펑크 그루브'], ['advanced', '해머링·고스트 콤보']], 'funk'], ['progression', '진행', [['funk', '원코드 펑크'], ['disco', 'i–IV 디스코'], ['soul', 'i–iv']], 'funk'], ['bars', '마디', [[4, '4마디'], [8, '8마디']], 4], ['bpm', 'BPM', 'num', 90]],
  harmonics: [['type', '종류', [['natural', '자연 하모닉 위치'], ['arpeggio', '하모닉 아르페지오'], ['tuning', '하모닉으로 줄 맞추기']], 'natural'], ['bpm', 'BPM', 'num', 72]],
  groove: [['genre', '스타일', Object.keys(T.GROOVES).map(g => [g, { rock: '록 8비트', pop: '팝', rnb: 'R&B 고스트노트', funk: '펑크 16비트', reggae: '레게', motown: '모타운', metal: '메탈', latin: '라틴' }[g]]), 'rnb'], ['key', '조성', keyOpts, 'A'], ['bars', '마디', [[4, '4마디'], [8, '8마디']], 4], ['bpm', 'BPM', 'num', 90]],
  legato: [['type', '종류', [['trill', '트릴 (해머·풀 반복)'], ['three', '3음 레가토']], 'trill'], ['position', '시작 프렛', Array.from({ length: 12 }, (_, i) => [i + 1, (i + 1) + '프렛']), 5], ['bpm', 'BPM', 'num', 70]],
};
let prSel = ls.get('bp.prSel', 'scale'), prSeed = 1;
$('prTech').innerHTML = Object.entries(T.TECHNIQUES).map(([k, v]) => `<button type="button" class="chip" data-t="${k}">${v}</button>`).join('');
$('prTech').querySelectorAll('.chip').forEach(c => c.addEventListener('click', () => { prSel = c.dataset.t; ls.set('bp.prSel', prSel); renderPracticeOpts(); }));
function renderPracticeOpts() {
  $('prTech').querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', String(c.dataset.t === prSel)));
  const saved = ls.get('bp.prOpt.' + prSel, {});
  $('prOpts').innerHTML = OPTS[prSel].map(([id, label, opts, def]) => {
    const v = saved[id] ?? def;
    if (opts === 'num') return `<div class="field"><label for="po_${id}">${label}</label><input type="number" id="po_${id}" data-k="${id}" min="30" max="260" value="${esc(v)}"></div>`;
    return `<div class="field"><label for="po_${id}">${label}</label><select id="po_${id}" data-k="${id}">${opts.map(([ov, ol]) => `<option value="${esc(ov)}"${String(ov) === String(v) ? ' selected' : ''}>${esc(ol)}</option>`).join('')}</select></div>`;
  }).join('');
  $('prOpts').querySelectorAll('[data-k]').forEach(el => el.addEventListener('change', () => { const o = ls.get('bp.prOpt.' + prSel, {}); o[el.dataset.k] = el.value; ls.set('bp.prOpt.' + prSel, o); }));
  $('prHint').textContent = { scale: '스케일을 정확한 손 위치로 오르내립니다. 처음엔 느리게, 반복마다 BPM을 올리세요.', fingering: '양손 독립과 교대 피킹을 위한 기본 운지 연습입니다.', walking: '재즈·블루스 워킹 라인을 코드 진행에 맞춰 만듭니다. "다른 패턴으로"를 누르면 같은 진행에서 새 라인이 나옵니다.', slap: '엄지 슬랩(S), 팝(Po), 고스트 노트(x)를 섞은 그루브입니다.', harmonics: '자연 하모닉 위치를 익히고, 하모닉으로 줄 맞추는 법을 연습합니다.', groove: '장르별 핑거스타일 그루브와 고스트 노트입니다.', legato: '왼손 힘을 기르는 해머링·풀링 연습입니다.' }[prSel];
  $('prAgain').hidden = !['walking', 'slap', 'groove'].includes(prSel);
}
function makePractice(newSeed) {
  if (newSeed) prSeed++;
  const o = { technique: prSel, tuning: tuningId(), seed: prSeed };
  $('prOpts').querySelectorAll('[data-k]').forEach(el => { const k = el.dataset.k; let v = el.value; if (['octaves', 'rhythm', 'position', 'bars', 'bpm'].includes(k)) v = +v; if (k === 'swing') v = v === '1'; o[k] = v; });
  let tab;
  try {
    if (prSel === 'scale') tab = T.scaleExercise(o); else if (prSel === 'fingering') tab = T.fingeringExercise(o); else if (prSel === 'walking') tab = T.walkingExercise(o);
    else if (prSel === 'slap') tab = T.slapExercise(o); else if (prSel === 'harmonics') tab = T.harmonicsExercise(o); else if (prSel === 'groove') tab = T.grooveExercise(o); else tab = T.legatoExercise(o);
  } catch (e) { console.error(e); return toast('악보를 만들지 못했습니다: ' + e.message); }
  tab.source = 'rule';
  openPlayer(tab, { from: 'practice' });
}
$('prMake').addEventListener('click', () => makePractice(false));
$('prAgain').addEventListener('click', () => makePractice(true));
renderPracticeOpts();

// ------------------------------------------------------------------ AI 악보
const gs = { genre: ls.get('bp.genGenre', 'funk'), tech: ls.get('bp.genTech', 'slap'), diff: ls.get('bp.genDiff', 'intermediate') };
function chipGroup(box, entries, key, store_) {
  $(box).innerHTML = entries.map(([k, v]) => `<button type="button" class="chip sm" data-v="${k}" aria-pressed="${String(gs[key] === k)}">${v}</button>`).join('');
  $(box).querySelectorAll('.chip').forEach(c => c.addEventListener('click', () => { gs[key] = c.dataset.v; ls.set(store_, gs[key]); $(box).querySelectorAll('.chip').forEach(x => x.setAttribute('aria-pressed', String(x === c))); }));
}
chipGroup('genGenre', Object.entries(G.GENRES), 'genre', 'bp.genGenre');
chipGroup('genTech', Object.entries(T.TECHNIQUES), 'tech', 'bp.genTech');
chipGroup('genDiff', Object.entries(G.DIFF), 'diff', 'bp.genDiff');
T.KEYS.forEach(([k]) => $('genKey').add(new Option(k, k))); $('genKey').value = ls.get('bp.genKey', 'E');
$('genKey').addEventListener('change', () => ls.set('bp.genKey', $('genKey').value));
const genOpts = () => ({ genre: gs.genre, technique: gs.tech, difficulty: gs.diff, key: $('genKey').value, bars: +$('genBars').value, bpm: +$('genBpm').value || 90, tuning: $('genTuning').value || tuningId(), extra: $('genExtra').value.trim(), maxFret: 20 });
let genAbort = null;
$('genGo').addEventListener('click', async () => {
  if (!gem.ok) { show('settings'); return toast('설정 탭에서 Gemini API 키를 먼저 연결하세요'); }
  const o = genOpts();
  $('genGo').disabled = true; $('genStop').hidden = false; $('genMsg').textContent = 'Gemini가 악보를 쓰고 있습니다… (보통 10~40초)';
  genAbort = new AbortController();
  try {
    const tab = await G.generate(o, gem.key, gem.model, genAbort.signal);
    $('genMsg').textContent = `"${tab.title}"을(를) 만들었습니다.${tab.fixes.length ? ' 치기 어려운 부분 ' + tab.fixes.length + '곳을 자동으로 정리했습니다.' : ''}`;
    openPlayer(tab, { from: 'ai' });
  } catch (e) {
    $('genMsg').textContent = e.name === 'AbortError' ? '멈췄습니다.' : '만들지 못했습니다: ' + e.message + (/quota|429|한도/.test(e.message) ? ' — 설정에서 Flash 모델을 고르거나 잠시 뒤 다시 해 보세요.' : '');
  }
  $('genGo').disabled = !gem.ok; $('genStop').hidden = true; genAbort = null;
});
$('genStop').addEventListener('click', () => genAbort && genAbort.abort());
$('genRule').addEventListener('click', () => {
  const o = genOpts();
  const tab = T.generate({ technique: o.technique, genre: o.genre, key: o.key, difficulty: o.difficulty, bars: Math.min(8, o.bars), bpm: o.bpm, tuning: o.tuning, seed: Math.floor(Math.random() * 1e6) });
  tab.source = 'rule'; tab.genre = o.genre;
  openPlayer(tab, { from: 'ai' });
});

// ------------------------------------------------------------------ 라이브러리
let libFilter = 'all', libMode = 'tabs';
function setLibMode(m) { libMode = m; $('libTabsBtn').setAttribute('aria-pressed', String(m === 'tabs')); $('libPdfBtn').setAttribute('aria-pressed', String(m === 'pdf')); $('libTabsCard').hidden = m !== 'tabs'; $('libPdfCard').hidden = m !== 'pdf'; renderLib(); }
$('libTabsBtn').addEventListener('click', () => setLibMode('tabs'));
$('libPdfBtn').addEventListener('click', () => setLibMode('pdf'));
function confirmBtn(btn, fn) {
  if (btn.dataset.armed) { fn(); return; }
  btn.dataset.armed = '1'; const t = btn.textContent; btn.textContent = '정말 삭제'; btn.classList.add('primary');
  setTimeout(() => { delete btn.dataset.armed; btn.textContent = t; btn.classList.remove('primary'); }, 3000);
}
function renderLib() {
  const tabs = store.list('tabs');
  const techs = ['all', ...new Set(tabs.map(t => t.technique || 'song'))];
  $('libFilter').innerHTML = techs.map(t => `<button type="button" class="chip sm" data-f="${t}" aria-pressed="${String(libFilter === t)}">${t === 'all' ? '전체' : TECH[t] || t}</button>`).join('');
  $('libFilter').querySelectorAll('.chip').forEach(c => c.addEventListener('click', () => { libFilter = c.dataset.f; renderLib(); }));
  const shown = tabs.filter(t => libFilter === 'all' || (t.technique || 'song') === libFilter);
  $('libTabs').innerHTML = shown.map(t => `<div class="item" data-id="${esc(t.id)}"><span class="t">${esc(t.title)}</span><span class="s">${TECH[t.technique] || '곡'}${t.genre ? ' · ' + esc(G.GENRES[t.genre] || t.genre) : ''} · ${t.bars || '?'}마디 · ♩${t.bpm}${t.bestBpm ? ' · 최고 ♩' + t.bestBpm : ''} · ${new Date(t.updatedAt).toLocaleDateString('ko-KR')}</span><span class="acts"><button class="btn small primary" type="button" data-a="open">연습</button><button class="btn small" type="button" data-a="del">삭제</button></span></div>`).join('') || '<p class="empty">저장한 악보가 없습니다. 주법 연습·AI 악보·채보 화면에서 "라이브러리에 저장"을 누르면 여기에 모입니다.</p>';
  $('libTabs').querySelectorAll('.item').forEach(it => {
    const id = it.dataset.id;
    it.querySelector('[data-a=open]').addEventListener('click', () => openPlayer(store.get('tabs', id), { from: 'lib', saved: true }));
    const d = it.querySelector('[data-a=del]'); d.addEventListener('click', () => confirmBtn(d, () => store.del('tabs', id)));
  });
  const pdfs = store.list('pdfs');
  $('libPdfs').innerHTML = pdfs.map(p => `<div class="item" data-id="${esc(p.id)}"><span class="t">${esc(p.name)}</span><span class="s">${p.pages || '?'}쪽 · ${(p.size / 1048576).toFixed(1)} MB${p.lastAt ? ' · 마지막 ' + new Date(p.lastAt).toLocaleDateString('ko-KR') : ''}${p.chunks ? ' · 계정에 저장됨' : ''}</span><span class="acts"><button class="btn small primary" type="button" data-a="open">보기</button><button class="btn small" type="button" data-a="del">삭제</button></span></div>`).join('') || '<p class="empty">가져온 PDF 악보가 없습니다.</p>';
  $('libPdfs').querySelectorAll('.item').forEach(it => {
    const id = it.dataset.id;
    it.querySelector('[data-a=open]').addEventListener('click', () => openPdf(id));
    const d = it.querySelector('[data-a=del]'); d.addEventListener('click', () => confirmBtn(d, () => store.delPdf(id)));
  });
}
$('libPdfFile').addEventListener('change', async e => {
  const files = [...e.target.files]; e.target.value = '';
  for (const f of files) {
    if (f.size > 20 * 1048576) { toast(`${f.name}: 20MB보다 큰 PDF는 가져올 수 없습니다`); continue; }
    try {
      toast(`${f.name} 가져오는 중…`, 6000);
      const info = await pdfInfo(f);
      const meta = await store.put('pdfs', { name: f.name.replace(/\.pdf$/i, ''), size: f.size, pages: info.pages, speed: 30, pos: 0, zoom: 1 });
      const n = await store.putPdfFile(meta.id, f);
      if (n) await store.put('pdfs', Object.assign({}, meta, { chunks: n }), { keepTime: true });
      toast(`${meta.name} (${info.pages}쪽)을 가져왔습니다`);
    } catch (err) { console.error(err); toast(`${f.name}을(를) 읽지 못했습니다: ${err.message}`, 6000); }
  }
});

// ------------------------------------------------------------------ PDF 자동 스크롤
let pdfSession = null;
const pv = new PdfViewer($('pdfView'), {
  save: patch => { if (pv.meta) { const m = Object.assign({}, store.get('pdfs', pv.meta.id) || pv.meta, patch, { lastAt: Date.now() }); pv.meta = m; clearTimeout(pvSaveT); pvSaveT = setTimeout(() => store.put('pdfs', m, { keepTime: true }), 600); } },
  onState: s => {
    if (s.countdown) { $('pvStatus').textContent = `${s.countdown}초 뒤 시작`; return; }
    $('pvPlay').textContent = s.playing ? '■ 멈추기' : '▶ 자동 스크롤';
    $('pvSpeed').value = Math.min(200, s.speed);
    $('pvStatus').textContent = `${s.page}/${s.pages}쪽 · 속도 ${s.speed}${s.left != null ? ' · 남은 시간 ' + Math.floor(s.left / 60) + ':' + String(Math.round(s.left % 60)).padStart(2, '0') : ''}`;
    if (s.playing && !pdfSession) pdfSession = { start: performance.now() };
    if (!s.playing && pdfSession) logPdf();
  },
});
let pvSaveT = null;
async function logPdf() {
  const sec = (performance.now() - pdfSession.start) / 1000; pdfSession = null;
  if (sec >= (settings().minSec ?? 20) && pv.meta) { await store.put('sessions', { date: Date.now(), seconds: Math.round(sec), technique: 'pdf', title: pv.meta.name }); toast(`${fmtMin(sec)} 연습을 기록했습니다`); }
}
async function openPdf(id) {
  const meta = store.get('pdfs', id); if (!meta) return;
  try {
    toast('PDF를 여는 중…', 4000);
    const blob = await store.getPdfFile(id);
    if (!blob) return toast('이 기기에 PDF 파일이 없습니다. 처음 가져온 기기에서 로그인한 뒤 다시 열어 보세요', 6000);
    $('pvName').textContent = meta.name; $('pvZoom').value = String(meta.zoom || 1); $('pvDelay').value = String(ls.get('bp.pvDelay', 3));
    pv.delay = +$('pvDelay').value;
    await pv.open(blob, meta);
    $('toast').hidden = true;
  } catch (e) { console.error(e); toast('PDF를 열지 못했습니다: ' + e.message, 6000); }
}
$('pvClose').addEventListener('click', () => { if (pv.playing) pv.pause(); pv.close(); renderLib(); });
$('pvPlay').addEventListener('click', () => pv.toggle(+$('pvDelay').value));
$('pvSpeed').addEventListener('input', () => pv.setSpeed(+$('pvSpeed').value));
$('pvSlower').addEventListener('click', () => pv.setSpeed(pv.speed - 2));
$('pvFaster').addEventListener('click', () => pv.setSpeed(pv.speed + 2));
$('pvTop').addEventListener('click', () => pv.top());
$('pvZoom').addEventListener('change', () => pv.setZoom(+$('pvZoom').value));
$('pvDelay').addEventListener('change', () => { pv.delay = +$('pvDelay').value; ls.set('bp.pvDelay', pv.delay); });
$('pvFitBtn').addEventListener('click', () => {
  const m = $('pvFit').value.trim().match(/^(\d+)(?::(\d{1,2}))?$/); if (!m) return toast('곡 길이를 3:30처럼 넣어 주세요');
  const sec = m[2] != null ? +m[1] * 60 + +m[2] : +m[1];
  pv.fitDuration(sec); toast(`지금 위치부터 ${Math.floor(sec / 60)}분 ${sec % 60}초 동안 끝까지 내려가도록 맞췄습니다`);
});

// ------------------------------------------------------------------ 채보 → 라이브러리
window.addEventListener('bt:totab', async e => {
  const d = e.detail; if (!d || !d.notes || !d.notes.length) return toast('저장할 악보가 없습니다');
  const tab = T.finish({ title: d.title || '채보한 곡', tuning: T.TUNINGS[d.tuning] ? d.tuning : '4std', bpm: Math.round(d.bpm) || 90, beats: d.beats || 4, technique: 'song', source: 'transcribe', notes: d.notes });
  await store.put('tabs', tab);
  toast('채보한 악보를 라이브러리에 저장했습니다. 라이브러리에서 메트로놈·구간 반복으로 연습할 수 있습니다', 4500);
});

// ------------------------------------------------------------------ 시작
renderAuth(); applySettings();
store.init(fbConfig()).then(renderAuth);
show(ls.get('bp.view', 'home') === 'play' ? 'home' : ls.get('bp.view', 'home'));
document.addEventListener('visibilitychange', () => { if (document.hidden && engine.running) engine.stop(); });
window.__bp = { store, engine, T, G, openPlayer, tv };
