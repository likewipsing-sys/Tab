// audio.js — 메트로놈 + 주법별 베이스 소리 + 악보 재생 (Web Audio, 한 시계로 정확하게 맞춤)
// 소리 원본은 synth.js(BassSynth). 줄마다 '목소리'를 따로 관리해서
//  · 해머링·풀링·슬라이드는 새로 튕기지 않고 울리던 줄의 음높이만 바꿈 (실제 레가토처럼)
//  · 새 음을 치면 앞 음은 손으로 막은 듯 바로 멈춤 (하모닉은 다른 줄이면 계속 울림)
//  · 벤딩·비브라토·슬라이드 인/아웃은 재생 속도로 음높이를 움직임
const HARM = { 12: 12, 7: 19, 19: 19, 5: 24, 24: 24, 4: 28, 9: 28, 16: 28 };
const Synth = () => (typeof window !== 'undefined' ? window.BassSynth : null);
const r2 = st => Math.pow(2, st / 12);

export function noteKind(n) {
  if (n.dead) return n.slap || n.pop ? 'deadSlap' : 'dead';
  if (n.harm) return 'harm';
  if (n.slap) return 'slap';
  if (n.pop) return 'pop';
  if (n.tech === 't') return 'tap';
  return 'finger';
}
export function notePitch(n, open) {
  const s = n.string ?? 0;
  if (n.dead) return open[s] + 3;
  if (n.harm) return open[s] + (HARM[n.fret] ?? 12);
  return n.midi ?? (open[s] + (n.fret || 0));
}

export class Engine {
  constructor() {
    this.ctx = null; this.cache = new Map();
    this.st = null; this.timer = null; this.listeners = {};
    this.clickVol = 0.8; this.bassVol = 0.8; this.marks = []; this.voices = []; this.virtualNow = null;
  }
  on(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); }
  emit(ev, d) { (this.listeners[ev] || []).forEach(f => { try { f(d); } catch (e) { console.error(e); } }); }
  init(ctx) {
    this.ctx = ctx; this.cache = new Map(); this.voices = [];
    this.master = ctx.createDynamicsCompressor(); this.master.threshold.value = -12; this.master.ratio.value = 3; this.master.attack.value = 0.004; this.master.release.value = 0.15; this.master.connect(ctx.destination);
    this.clickGain = ctx.createGain(); this.clickGain.gain.value = this.clickVol; this.clickGain.connect(this.master);
    this.bassGain = ctx.createGain(); this.bassGain.gain.value = this.bassVol;
    // 베이스 앰프 느낌: 저역 살짝 강조
    const eq = ctx.createBiquadFilter(); eq.type = 'lowshelf'; eq.frequency.value = 120; eq.gain.value = 3;
    this.bassGain.connect(eq); eq.connect(this.master);
    this.clicks = { accent: this.clickBuf(1760, 0.9), beat: this.clickBuf(1180, 0.65), sub: this.clickBuf(880, 0.32) };
    return ctx;
  }
  ensure() {
    if (this.ctx && !this.ctx.startRendering) { if (this.ctx.state === 'suspended') this.ctx.resume(); return this.ctx; }
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = this.init(new AC({ latencyHint: 'interactive' }));
    // iOS: 무음 버퍼 한 번 재생해서 소리 켜기
    const b = ctx.createBuffer(1, 1, ctx.sampleRate), s = ctx.createBufferSource(); s.buffer = b; s.connect(ctx.destination); s.start(0);
    return ctx;
  }
  now() { return this.virtualNow ?? this.ctx.currentTime; }
  setVolumes(click, bass) {
    if (click != null) { this.clickVol = click; if (this.clickGain) this.clickGain.gain.value = click; }
    if (bass != null) { this.bassVol = bass; if (this.bassGain) this.bassGain.gain.value = bass; }
  }
  clickBuf(freq, amp) {
    const sr = this.ctx.sampleRate, n = Math.round(sr * 0.045), b = this.ctx.createBuffer(1, n, sr), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) { const t = i / sr; d[i] = amp * Math.sin(2 * Math.PI * freq * t) * Math.exp(-t * 90) * Math.min(1, t / 0.0008); }
    return b;
  }
  // ---------------------------------------------------------------- 베이스 소리
  buf(midi, kind) {
    const key = midi + ':' + kind; if (this.cache.has(key)) return this.cache.get(key);
    const data = Synth().render(this.ctx.sampleRate, midi, kind);
    const b = this.ctx.createBuffer(1, data.length, this.ctx.sampleRate); b.getChannelData(0).set(data);
    this.cache.set(key, b); return b;
  }
  /** 미리 만들어 두기 (첫 음이 늦지 않게) */
  warm(tab, open) {
    if (!tab) return; const seen = new Set();
    for (const n of tab.notes) { const k = noteKind(n), m = notePitch(n, open), key = m + ':' + k; if (!seen.has(key)) { seen.add(key); this.buf(m, k); } if (seen.size > 60) break; }
  }
  damp(v, t, fade) {
    if (!v || !v.alive) return;
    const g = v.g.gain;
    try { g.cancelScheduledValues(t); g.setValueAtTime(v.level, t); g.linearRampToValueAtTime(0, t + (fade || 0.025)); } catch (e) { /* 무시 */ }
    try { v.src.stop(t + (fade || 0.025) + 0.05); } catch (e) { /* 이미 멈춤 */ }
    v.alive = false; v.end = t;
    if (v.lfo) { try { v.lfo.stop(t + 0.05); } catch (e) { /* 무시 */ } }
  }
  release(v, end, n) {
    const g = v.g.gain, rel = v.kind === 'harm' ? 0.35 : n.slideOut ? 0.03 : 0.045;
    g.setValueAtTime(v.level, Math.max(v.t0 + 0.005, end - 0.002));
    g.linearRampToValueAtTime(0, end + rel);
    v.end = end;
  }
  /** 음 하나 재생. t: 시작 시각(초), dur: 길이(초) */
  playNote(n, open, t, dur) {
    const ctx = this.ctx; if (!ctx) return;
    const s = n.string ?? 0, kind = noteKind(n), midi = notePitch(n, open);
    const v = this.voices[s];
    const legato = (n.tech === 'h' || n.tech === 'p' || n.tech === 's') && v && v.alive && v.end >= t - 0.05 && kind !== 'harm' && !n.dead && v.kind !== 'harm';
    if (legato) {
      // 같은 줄이 울리는 채로 음높이만 바꿈
      const pr = v.src.playbackRate, from = v.midi;
      try {
        pr.cancelScheduledValues(t); pr.setValueAtTime(r2(from - v.base), t);
        if (n.tech === 's') {
          // 슬라이드: 프렛을 하나씩 지나가며 (계단처럼) 이동
          const steps = Math.max(1, Math.round(Math.abs(midi - from))), glide = Math.min(0.11, Math.max(0.03, dur * 0.45)), dir = Math.sign(midi - from) || 1;
          for (let i = 1; i <= steps; i++) pr.setValueAtTime(r2(from + dir * Math.min(i, Math.abs(midi - from)) - v.base), t + glide * i / steps);
        } else pr.setValueAtTime(r2(midi - v.base), t);
        const g = v.g.gain; g.cancelScheduledValues(t); g.setValueAtTime(v.level, t);
        v.level *= n.tech === 's' ? 0.97 : 0.85; g.linearRampToValueAtTime(v.level, t + 0.012);
      } catch (e) { /* 자동화 충돌 시 새로 튕김 */ return this.attack(n, open, t, dur, s, kind, midi); }
      if (n.tech !== 's') { const c = ctx.createBufferSource(); c.buffer = this.buf(0, n.tech === 'h' ? 'hammer' : 'pull'); c.connect(this.bassGain); c.start(t); }
      v.midi = midi;
      this.expressive(v, n, t, dur);
      this.release(v, t + dur, n);
      return;
    }
    this.attack(n, open, t, dur, s, kind, midi);
  }
  attack(n, open, t, dur, s, kind, midi) {
    const ctx = this.ctx;
    // 새로 칠 때: 울리던 음은 손으로 막음 (다른 줄 하모닉은 계속)
    this.voices.forEach((w, i) => { if (w && w.alive && w.end > t - 0.001 && !(w.kind === 'harm' && i !== s && !n.dead)) this.damp(w, t, 0.02); });
    const src = ctx.createBufferSource(); src.buffer = this.buf(midi, kind);
    const g = ctx.createGain();
    const level = n.dead ? (n.ghost && !n.slap ? 0.55 : 0.8) : (n.ghost ? 0.4 : 1) * (kind === 'tap' ? 0.95 : 1);
    g.gain.setValueAtTime(level, t);
    src.connect(g); g.connect(this.bassGain);
    src.start(t);
    if (kind === 'tap') { const c = ctx.createBufferSource(); c.buffer = this.buf(0, 'hammer'); c.connect(this.bassGain); c.start(t); }
    if (n.dead) { this.voices[s] = null; return; }
    const v = { src, g, base: midi, midi, level, t0: t, end: t + dur, alive: true, kind, string: s };
    this.voices[s] = v;
    if (n.slideIn) {
      // 3프렛 아래에서 미끄러져 들어옴
      const pr = src.playbackRate, from = midi - 3;
      pr.setValueAtTime(r2(from - midi), t);
      for (let i = 1; i <= 3; i++) pr.setValueAtTime(r2(from + i - midi), t + 0.022 * i);
    }
    this.expressive(v, n, t, dur);
    this.release(v, t + dur, n);
  }
  /** 벤딩·비브라토·슬라이드 아웃 */
  expressive(v, n, t, dur) {
    const ctx = this.ctx, pr = v.src.playbackRate, base = r2(v.midi - v.base);
    try {
      if (n.bend) {
        const up = base * r2(n.bend), a = t + Math.min(dur * 0.25, 0.12);
        pr.setValueAtTime(base, a); pr.linearRampToValueAtTime(up, a + 0.1);
        if (n.release) { const b = t + dur * 0.65; pr.setValueAtTime(up, b); pr.linearRampToValueAtTime(base, b + 0.1); }
      }
      if (n.slideOut) {
        const a = t + Math.max(0.05, dur - 0.13);
        for (let i = 1; i <= 5; i++) pr.setValueAtTime(base * r2(-i), a + 0.024 * i);
        v.g.gain.setValueAtTime(v.level, a); v.g.gain.linearRampToValueAtTime(v.level * 0.2, t + dur);
      }
    } catch (e) { /* 무시 */ }
    if (n.vib && dur > 0.22) {
      // 손가락 비브라토: 약 5.5Hz, ±0.3반음 (서서히 커짐)
      const lfo = ctx.createOscillator(), depth = ctx.createGain();
      lfo.frequency.value = 5.5;
      const amt = base * (r2(0.3) - 1);
      depth.gain.setValueAtTime(0, t); depth.gain.linearRampToValueAtTime(amt, t + Math.min(0.3, dur * 0.5));
      depth.gain.setValueAtTime(amt, t + dur); depth.gain.linearRampToValueAtTime(0, t + dur + 0.05);
      lfo.connect(depth); depth.connect(pr);
      lfo.start(t + 0.08); lfo.stop(t + dur + 0.1);
      v.lfo = lfo;
    }
  }
  click(t, type) {
    const s = this.ctx.createBufferSource(); s.buffer = this.clicks[type]; s.connect(this.clickGain); s.start(t);
  }
  // ---------------------------------------------------------------- 재생
  /** opts: {bpm, beats, sub(1|2|3|4), accent, tab, loop:[barA, barB), countIn(마디), swing, gap:{play,mute}, trainer:{step, every, max}, clickOn, bassOn, open, loopOn} */
  begin(opts, t0) {
    const tab = opts.tab || null, beats = opts.beats || (tab && tab.beats) || 4, spb = 4 * beats;
    const totalBars = tab ? Math.max(1, tab.bars || Math.ceil(tab.notes.reduce((m, n) => Math.max(m, n.slot + (n.len || 1)), 0) / spb)) : Infinity;
    const loopA = opts.loop ? opts.loop[0] : (opts.startBar || 0), loopB = opts.loop ? opts.loop[1] : totalBars;
    const bySlot = new Map(); if (tab) tab.notes.forEach(n => { if (!bySlot.has(n.slot)) bySlot.set(n.slot, []); bySlot.get(n.slot).push(n); });
    const open = opts.open || [28, 33, 38, 43];
    this.voices = [];
    if (tab && opts.bassOn !== false) this.warm(tab, open);
    this.st = { opts, tab, beats, spb, bySlot, totalBars, loopA, loopB, bpm: opts.bpm, sub: opts.sub || 1, slot: loopA * spb - (opts.countIn || 0) * spb, nextTime: t0, loops: 0, startWall: performance.now(), played: 0, open };
    this.marks = [];
  }
  start(opts) {
    this.stop(true);
    const ctx = this.ensure();
    this.begin(opts, ctx.currentTime + 0.12);
    this.timer = setInterval(() => this.pump(), 25);
    this.pump();
    this.emit('start', { bpm: this.st.bpm });
  }
  stop(silent) {
    if (this.timer) clearInterval(this.timer); this.timer = null;
    const st = this.st; this.st = null; this.marks = [];
    if (this.ctx && !this.ctx.startRendering) { const t = this.ctx.currentTime; this.voices.forEach(v => this.damp(v, t, 0.04)); }
    this.voices = [];
    if (st && !silent) this.emit('stop', { seconds: (performance.now() - st.startWall) / 1000, bpm: st.bpm, loops: st.loops, played: st.played });
  }
  /** 재생 중에 악보가 바뀌면 다시 읽음 (편집 반영) */
  refreshTab() {
    const st = this.st; if (!st || !st.tab) return;
    const bySlot = new Map(); st.tab.notes.forEach(n => { if (!bySlot.has(n.slot)) bySlot.set(n.slot, []); bySlot.get(n.slot).push(n); });
    st.bySlot = bySlot;
    st.totalBars = Math.max(1, st.tab.bars || 1);
    if (!st.opts.loop) st.loopB = st.totalBars;
    this.warm(st.tab, st.open);
  }
  get running() { return !!this.st; }
  setBpm(b) { if (this.st) this.st.bpm = b; }
  pump() {
    const st = this.st, ctx = this.ctx; if (!st || st.ending) return;
    const o = st.opts;
    while (st.nextTime < this.now() + 0.15) {
      const slotDur = 60 / st.bpm / 4;
      const s = st.slot, rel = ((s % st.spb) + st.spb) % st.spb, bar = Math.floor(s / st.spb), inCount = s < st.loopA * st.spb;
      // 스윙: 8분 뒷박을 3연음 셋째 자리로
      let t = st.nextTime;
      const swing = o.swing && !inCount;
      if (swing) { if (rel % 4 === 2) t += slotDur * 0.667; else if (rel % 4 === 3) t += slotDur * 0.333; }
      const gapCycle = o.gap ? o.gap.play + o.gap.mute : 0;
      const gapMuted = gapCycle && !inCount && ((bar - st.loopA) % gapCycle + gapCycle) % gapCycle >= o.gap.play;
      if (o.clickOn !== false && !gapMuted) {
        if (rel % 4 === 0) {
          this.click(t, rel === 0 && o.accent !== false ? 'accent' : 'beat');
          if (st.sub === 3) { this.click(t + slotDur * 4 / 3, 'sub'); this.click(t + slotDur * 8 / 3, 'sub'); }
        } else if ((st.sub === 2 && rel % 2 === 0) || st.sub === 4) this.click(t, 'sub');
      }
      if (inCount && rel % 4 === 0) this.emit('count', { beat: rel / 4 + 1, beats: st.beats });
      if (st.tab && !inCount && o.bassOn !== false) {
        const ns = st.bySlot.get(s);
        if (ns) for (const n of ns) {
          // 음 길이: 악보 길이 그대로 (스윙이면 끝 위치도 스윙 격자에 맞춤)
          let endSlot = s + (n.len || 1), endT = st.nextTime + (n.len || 1) * slotDur;
          if (swing) { const er = ((endSlot % st.spb) + st.spb) % st.spb; if (er % 4 === 2) endT += slotDur * 0.667; else if (er % 4 === 3) endT += slotDur * 0.333; }
          const d = Math.max(0.03, endT - t - (n.dead ? 0 : 0.012));
          this.playNote(n, st.open, t, d);
          st.played++;
        }
      }
      this.marks.push({ t, slot: s, bar, rel, inCount });
      if (this.marks.length > 400) this.marks.splice(0, 200);
      st.nextTime += slotDur; st.slot++;
      if (st.tab && st.slot >= st.loopB * st.spb) {
        st.loops++;
        if (o.loopOn === false) { st.ending = true; const endT = st.nextTime; if (this.virtualNow == null) setTimeout(() => { if (this.st === st) this.stop(); }, Math.max(0, (endT - ctx.currentTime) * 1000 + 200)); break; }
        st.slot = st.loopA * st.spb;
        if (o.trainer && o.trainer.step && st.loops % (o.trainer.every || 1) === 0) {
          const nb = Math.min(o.trainer.max || 300, st.bpm + o.trainer.step);
          if (nb !== st.bpm) { st.bpm = nb; this.emit('bpm', { bpm: nb, loops: st.loops }); }
        }
        this.emit('loop', { loops: st.loops, bpm: st.bpm });
      } else if (!st.tab && o.trainer && o.trainer.step && rel === st.spb - 1 && bar >= 0) {
        const bars = bar + 1;
        if (bars % (o.trainer.every || 4) === 0) { const nb = Math.min(o.trainer.max || 300, st.bpm + o.trainer.step); if (nb !== st.bpm) { st.bpm = nb; this.emit('bpm', { bpm: nb }); } }
      }
    }
  }
  /** 지금 소리 나는 위치 {slot, bar, rel, inCount} */
  position() {
    if (!this.st || !this.ctx) return null;
    const now = this.now(); let m = null;
    for (let i = this.marks.length - 1; i >= 0; i--) if (this.marks[i].t <= now) { m = this.marks[i]; break; }
    return m;
  }
  /** 악보를 정해진 BPM으로 한 번 연주한 소리를 파일용으로 만듦 → AudioBuffer */
  async renderOffline(opts, sr = 44100) {
    const tab = opts.tab, spb = 4 * (tab.beats || 4);
    const bars = opts.loop ? opts.loop[1] - opts.loop[0] : (tab.bars || Math.ceil(tab.notes.reduce((m, n) => Math.max(m, n.slot + (n.len || 1)), 0) / spb));
    const secs = ((opts.countIn || 0) + bars) * spb * 60 / opts.bpm / 4 + 2;
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const oc = new OAC(1, Math.ceil(secs * sr), sr);
    const saved = { ctx: this.ctx, cache: this.cache, voices: this.voices, st: this.st, marks: this.marks, master: this.master, clickGain: this.clickGain, bassGain: this.bassGain, clicks: this.clicks, timer: this.timer };
    this.timer = null;
    try {
      this.init(oc);
      this.begin(Object.assign({}, opts, { loopOn: false, trainer: null }), 0.05);
      for (let vt = 0; vt < secs && this.st && !this.st.ending; vt += 0.05) { this.virtualNow = vt; this.pump(); }
      this.virtualNow = null; this.st = null;
      return await oc.startRendering();
    } finally {
      this.virtualNow = null;
      Object.assign(this, saved);
    }
  }
}

/** AudioBuffer → WAV (16비트) */
export function toWav(ab) {
  const ch = ab.getChannelData(0), n = ch.length, sr = ab.sampleRate, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.max(-32767, Math.min(32767, Math.round(ch[i] * 32767))), true);
  return new Blob([buf], { type: 'audio/wav' });
}

/** 탭 템포: 최근 탭 간격의 중앙값 */
export function tapTempo() {
  const taps = [];
  return () => {
    const now = performance.now();
    if (taps.length && now - taps[taps.length - 1] > 2000) taps.length = 0;
    taps.push(now); if (taps.length > 6) taps.shift();
    if (taps.length < 2) return null;
    const iv = []; for (let i = 1; i < taps.length; i++) iv.push(taps[i] - taps[i - 1]);
    iv.sort((a, b) => a - b);
    return Math.round(60000 / iv[iv.length >> 1]);
  };
}
