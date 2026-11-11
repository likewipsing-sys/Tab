// audio.js — 메트로놈 + 베이스 소리 + 악보 재생 (Web Audio, 한 시계로 정확하게 맞춤)
const HARM = { 12: 12, 7: 19, 19: 19, 5: 24, 24: 24, 4: 28, 9: 28, 16: 28 };

export class Engine {
  constructor() {
    this.ctx = null; this.cache = new Map();
    this.st = null; this.timer = null; this.listeners = {};
    this.clickVol = 0.8; this.bassVol = 0.8; this.marks = [];
  }
  on(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); }
  emit(ev, d) { (this.listeners[ev] || []).forEach(f => { try { f(d); } catch (e) { console.error(e); } }); }
  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return this.ctx; }
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = this.ctx = new AC({ latencyHint: 'interactive' });
    this.master = ctx.createDynamicsCompressor(); this.master.threshold.value = -10; this.master.ratio.value = 4; this.master.connect(ctx.destination);
    this.clickGain = ctx.createGain(); this.clickGain.gain.value = this.clickVol; this.clickGain.connect(this.master);
    this.bassGain = ctx.createGain(); this.bassGain.gain.value = this.bassVol; this.bassGain.connect(this.master);
    this.clicks = { accent: this.clickBuf(1760, 0.9), beat: this.clickBuf(1180, 0.65), sub: this.clickBuf(880, 0.32) };
    // iOS: 무음 버퍼 한 번 재생해서 소리 켜기
    const b = ctx.createBuffer(1, 1, ctx.sampleRate), s = ctx.createBufferSource(); s.buffer = b; s.connect(ctx.destination); s.start(0);
    return ctx;
  }
  setVolumes(click, bass) {
    if (click != null) { this.clickVol = click; if (this.clickGain) this.clickGain.gain.value = click; }
    if (bass != null) { this.bassVol = bass; if (this.bassGain) this.bassGain.gain.value = bass; }
  }
  clickBuf(freq, amp) {
    const sr = this.ctx.sampleRate, n = Math.round(sr * 0.045), b = this.ctx.createBuffer(1, n, sr), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) { const t = i / sr; d[i] = amp * Math.sin(2 * Math.PI * freq * t) * Math.exp(-t * 90) * Math.min(1, t / 0.0008); }
    return b;
  }
  // ---------------------------------------------------------------- 베이스 소리 (카플러스–스트롱 현 모델)
  noteBuf(midi, kind) {
    const key = midi + ':' + kind; if (this.cache.has(key)) return this.cache.get(key);
    const sr = this.ctx.sampleRate, dur = kind === 'dead' ? 0.08 : kind === 'harm' ? 2.2 : 2.4;
    const n = Math.round(sr * dur), b = this.ctx.createBuffer(1, n, sr), d = b.getChannelData(0);
    const f = 440 * Math.pow(2, (midi - 69) / 12);
    if (kind === 'dead') {
      let lp = 0; for (let i = 0; i < n; i++) { const t = i / sr; lp += 0.12 * ((Math.random() * 2 - 1) - lp); d[i] = lp * 2.2 * Math.exp(-t * 60) + 0.25 * Math.sin(2 * Math.PI * 70 * t) * Math.exp(-t * 50); }
    } else if (kind === 'harm') {
      for (let i = 0; i < n; i++) { const t = i / sr; d[i] = 0.5 * (Math.sin(2 * Math.PI * f * t) + 0.08 * Math.sin(4 * Math.PI * f * t)) * Math.exp(-t * 1.6) * Math.min(1, t / 0.003); }
    } else {
      const N = Math.max(2, Math.round(sr / f)), buf = new Float32Array(N);
      const bright = kind === 'slap' || kind === 'pop';
      let lp = 0;
      for (let i = 0; i < N; i++) { const r = Math.random() * 2 - 1; lp += (bright ? 0.7 : 0.25) * (r - lp); buf[i] = lp; }
      // 피킹 위치 효과 (빗살 필터)
      const pk = Math.max(1, Math.round(N * (bright ? 0.08 : 0.2))); for (let i = N - 1; i >= pk; i--) buf[i] -= 0.6 * buf[i - pk];
      let mx = 1e-9; for (let i = 0; i < N; i++) mx = Math.max(mx, Math.abs(buf[i])); for (let i = 0; i < N; i++) buf[i] /= mx;
      const rho = Math.pow(0.5, 1 / (f * (bright ? 1.4 : 2.2)));     // 감쇠 (낮은 음일수록 오래)
      let idx = 0, prev = 0;
      for (let i = 0; i < n; i++) {
        const cur = buf[idx], nxt = buf[(idx + 1) % N];
        const y = (bright ? 0.65 * cur + 0.35 * nxt : 0.5 * (cur + nxt)) * rho;
        buf[idx] = y; d[i] = 0.55 * cur + 0.45 * prev; prev = cur; idx = (idx + 1) % N;
      }
      if (bright) for (let i = 0; i < Math.min(n, sr * 0.012); i++) { const t = i / sr; d[i] += (kind === 'slap' ? 0.5 : 0.35) * (Math.random() * 2 - 1) * Math.exp(-t * 500); }
      for (let i = 0; i < Math.min(n, 64); i++) d[i] *= i / 64;
    }
    this.cache.set(key, b); return b;
  }
  playNote(n, open, t, dur, prevMidi) {
    const ctx = this.ctx; if (!ctx) return;
    const kind = n.dead ? 'dead' : n.harm ? 'harm' : n.slap ? 'slap' : n.pop ? 'pop' : 'finger';
    let midi = n.dead ? (open[n.string ?? 0] + 2) : n.harm ? open[n.string] + (HARM[n.fret] ?? 12) : (n.midi ?? open[n.string] + n.fret);
    const src = ctx.createBufferSource(); src.buffer = this.noteBuf(n.dead ? 0 : midi, kind);
    const g = ctx.createGain();
    const legato = n.tech === 'h' || n.tech === 'p' || n.tech === 's' || n.tech === 't';
    const vol = (n.ghost ? 0.35 : n.dead ? 0.7 : legato ? 0.6 : 1) * (kind === 'pop' ? 0.85 : 1);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + (legato ? 0.006 : 0.002));
    const end = t + Math.max(0.05, dur);
    g.gain.setValueAtTime(vol, Math.max(t + 0.01, end - 0.03)); g.gain.linearRampToValueAtTime(0, end + 0.03);
    // 슬라이드·벤딩·비브라토는 재생 속도로 음높이 변화
    if (n.tech === 's' && prevMidi != null && !n.dead) {
      const r0 = Math.pow(2, (prevMidi - midi) / 12); src.playbackRate.setValueAtTime(r0, t); src.playbackRate.linearRampToValueAtTime(1, t + Math.min(0.08, dur * 0.5));
    } else if (n.bend && !n.dead) {
      const up = Math.pow(2, n.bend / 12), a = t + dur * 0.25;
      src.playbackRate.setValueAtTime(1, a); src.playbackRate.linearRampToValueAtTime(up, a + 0.09);
      if (n.release) { src.playbackRate.setValueAtTime(up, t + dur * 0.7); src.playbackRate.linearRampToValueAtTime(1, t + dur * 0.7 + 0.09); }
    } else if (n.vib && !n.dead && dur > 0.25) {
      const len = 64, c = new Float32Array(len); for (let i = 0; i < len; i++) c[i] = Math.pow(2, 0.25 * Math.sin(2 * Math.PI * 5.5 * (i / len) * (dur - 0.12)) / 12);
      try { src.playbackRate.setValueCurveAtTime(c, t + 0.12, dur - 0.12); } catch (e) { /* 일부 브라우저 미지원 */ }
    }
    src.connect(g); g.connect(this.bassGain);
    src.start(t); src.stop(end + 0.08);
  }
  click(t, type) {
    const s = this.ctx.createBufferSource(); s.buffer = this.clicks[type]; s.connect(this.clickGain); s.start(t);
  }
  // ---------------------------------------------------------------- 재생
  /**
   * opts: {bpm, beats, sub(1|2|3|4), accent, tab, loop:[barA, barB) , countIn(마디), swing, gap:{play,mute}, trainer:{step, every, max}, clickOn, bassOn, startBar}
   */
  start(opts) {
    this.stop(true);
    const ctx = this.ensure();
    const tab = opts.tab || null, beats = opts.beats || (tab && tab.beats) || 4, spb = 4 * beats;
    const totalBars = tab ? Math.max(1, tab.bars || Math.ceil(tab.notes.reduce((m, n) => Math.max(m, n.slot + (n.len || 1)), 0) / spb)) : Infinity;
    const loopA = opts.loop ? opts.loop[0] : (opts.startBar || 0), loopB = opts.loop ? opts.loop[1] : totalBars;
    const bySlot = new Map(); if (tab) tab.notes.forEach(n => { if (!bySlot.has(n.slot)) bySlot.set(n.slot, []); bySlot.get(n.slot).push(n); });
    this.st = {
      opts, tab, beats, spb, bySlot, totalBars, loopA, loopB, bpm: opts.bpm, sub: opts.sub || 1,
      slot: loopA * spb - (opts.countIn || 0) * spb, nextTime: ctx.currentTime + 0.12, loops: 0, startWall: performance.now(), lastMidi: null, played: 0,
      open: opts.open || [28, 33, 38, 43],
    };
    this.marks = [];
    this.timer = setInterval(() => this.pump(), 25);
    this.pump();
    this.emit('start', { bpm: this.st.bpm });
  }
  stop(silent) {
    if (this.timer) clearInterval(this.timer); this.timer = null;
    const st = this.st; this.st = null; this.marks = [];
    if (st && !silent) this.emit('stop', { seconds: (performance.now() - st.startWall) / 1000, bpm: st.bpm, loops: st.loops, played: st.played });
  }
  get running() { return !!this.st; }
  setBpm(b) { if (this.st) this.st.bpm = b; }
  pump() {
    const st = this.st, ctx = this.ctx; if (!st || st.ending) return;
    const o = st.opts;
    while (st.nextTime < ctx.currentTime + 0.15) {
      const slotDur = 60 / st.bpm / 4;
      const s = st.slot, rel = ((s % st.spb) + st.spb) % st.spb, bar = Math.floor(s / st.spb), inCount = s < st.loopA * st.spb;
      // 스윙: 8분 뒷박을 3연음 셋째 자리로
      let t = st.nextTime;
      if (o.swing && !inCount) { if (rel % 4 === 2) t += slotDur * 0.667; else if (rel % 4 === 3) t += slotDur * 0.333; }
      // 메트로놈
      const gapCycle = o.gap ? o.gap.play + o.gap.mute : 0;
      const gapMuted = gapCycle && !inCount && ((bar - st.loopA) % gapCycle + gapCycle) % gapCycle >= o.gap.play;
      if (o.clickOn !== false && !gapMuted) {
        if (rel % 4 === 0) {
          this.click(t, rel === 0 && o.accent !== false ? 'accent' : 'beat');
          if (st.sub === 3) { this.click(t + slotDur * 4 / 3, 'sub'); this.click(t + slotDur * 8 / 3, 'sub'); }
        } else if ((st.sub === 2 && rel % 2 === 0) || st.sub === 4) this.click(t, 'sub');
      }
      if (inCount && rel % 4 === 0) this.emit('count', { beat: rel / 4 + 1, beats: st.beats });
      // 악보 음
      if (st.tab && !inCount && o.bassOn !== false) {
        const ns = st.bySlot.get(s);
        if (ns) for (const n of ns) {
          let d = (n.len || 1) * slotDur * (n.dead ? 0.4 : 0.96);
          this.playNote(n, st.open, t, d, st.lastMidi);
          if (!n.dead) st.lastMidi = n.dead ? st.lastMidi : (n.midi ?? st.lastMidi);
          st.played++;
        }
      }
      this.marks.push({ t, slot: s, bar, rel, inCount });
      if (this.marks.length > 400) this.marks.splice(0, 200);
      st.nextTime += slotDur; st.slot++;
      // 구간 반복 / 끝
      if (st.tab && st.slot >= st.loopB * st.spb) {
        st.loops++;
        if (o.loopOn === false) { st.ending = true; const endT = st.nextTime; setTimeout(() => { if (this.st === st) this.stop(); }, Math.max(0, (endT - ctx.currentTime) * 1000 + 200)); break; }
        st.slot = st.loopA * st.spb;
        if (o.trainer && o.trainer.step && st.loops % (o.trainer.every || 1) === 0) {
          const nb = Math.min(o.trainer.max || 300, st.bpm + o.trainer.step);
          if (nb !== st.bpm) { st.bpm = nb; this.emit('bpm', { bpm: nb, loops: st.loops }); }
        }
        this.emit('loop', { loops: st.loops, bpm: st.bpm });
      } else if (!st.tab && o.trainer && o.trainer.step && rel === st.spb - 1 && bar >= 0) {
        // 메트로놈만: 마디 단위로 빨라지기
        const bars = bar + 1;
        if (bars % (o.trainer.every || 4) === 0) { const nb = Math.min(o.trainer.max || 300, st.bpm + o.trainer.step); if (nb !== st.bpm) { st.bpm = nb; this.emit('bpm', { bpm: nb }); } }
      }
    }
  }
  /** 지금 소리 나는 위치 {slot, bar, beat, inCount} */
  position() {
    if (!this.st || !this.ctx) return null;
    const now = this.ctx.currentTime; let m = null;
    for (let i = this.marks.length - 1; i >= 0; i--) if (this.marks[i].t <= now) { m = this.marks[i]; break; }
    return m;
  }
}

/** 탭 템포: 최근 탭 간격 평균 */
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
