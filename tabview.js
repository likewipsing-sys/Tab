// tabview.js — 연습 악보를 연필로 쓴 종이 타브로 그리기 + 재생 위치 표시 + 마디 탭
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const sName = m => NAMES[((m % 12) + 12) % 12];
const INK = '#2b2f36', PEN = '#2547b0', FAINT = 'rgba(43,47,54,.4)', HL = 'rgba(255,221,0,.55)', LOOP = 'rgba(37,71,176,.07)', PLAY = 'rgba(214,69,69,.75)';
function rand(seed) { let s = seed; return () => ((s = (s * 9301 + 49297) % 233280) / 233280); }
function pencil(c, x0, y0, x1, y1, seed, wob) {
  const r = rand(seed + 7), len = Math.hypot(x1 - x0, y1 - y0), steps = Math.max(2, Math.round(len / 40));
  c.beginPath(); c.moveTo(x0 + (r() - .5) * wob, y0 + (r() - .5) * wob);
  for (let i = 1; i <= steps; i++) { const t = i / steps; c.lineTo(x0 + (x1 - x0) * t + (r() - .5) * wob * .6, y0 + (y1 - y0) * t + (r() - .5) * wob); }
  c.stroke();
}

export class TabView {
  constructor(box, opts = {}) {
    this.box = box; this.tab = null; this.open = [28, 33, 38, 43]; this.play = null; this.loop = null; this.hits = []; this.onBar = opts.onBar || null; this.onCell = opts.onCell || null; this.cursor = null;
    new ResizeObserver(() => { clearTimeout(this._t); this._t = setTimeout(() => this.render(), 60); }).observe(box);
  }
  set(tab, open) { this.tab = tab; this.open = open; this.play = null; this.render(); }
  setLoop(l) { this.loop = l; this.render(); }
  /** 편집 커서 {slot, string} 또는 null */
  setCursor(c) {
    const prev = this.sysOf(this.cursor && this.cursor.slot), now = this.sysOf(c && c.slot);
    this.cursor = c;
    [prev, now].filter((v, i, a) => v != null && a.indexOf(v) === i).forEach(i => this.drawOne(i));
    if (now != null) {
      const cv = this.box.children[now]; if (!cv) return;
      const r = cv.getBoundingClientRect(), vh = window.innerHeight, keep = this.safeBottom ? this.safeBottom() : 120;
      if (r.top < 70) window.scrollBy({ top: r.top - 90, behavior: 'smooth' });
      else if (r.bottom > vh - keep) window.scrollBy({ top: r.bottom - (vh - keep) + 16, behavior: 'smooth' });
    }
  }
  setPlay(slot) {
    if (slot === this.play) return;
    const prevSys = this.sysOf(this.play), nowSys = this.sysOf(slot);
    this.play = slot;
    // 바뀐 줄만 다시 그림
    [prevSys, nowSys].filter((v, i, a) => v != null && a.indexOf(v) === i).forEach(i => this.drawOne(i));
    if (nowSys != null && nowSys !== prevSys) { const cv = this.box.children[nowSys]; if (cv) { const r = cv.getBoundingClientRect(), vh = window.innerHeight; if (r.top < 90 || r.bottom > vh - 120) cv.scrollIntoView({ block: 'center', behavior: 'smooth' }); } }
  }
  sysOf(slot) { if (slot == null || !this.layout) return null; const { systems, spb } = this.layout; const i = systems.findIndex(s => slot >= s.b0 * spb && slot < s.b1 * spb); return i < 0 ? null : i; }
  layoutSystems(cssW) {
    const tab = this.tab, beats = tab.beats || 4, spb = 4 * beats;
    const nBars = Math.max(tab.bars || 1, Math.floor(tab.notes.reduce((m, n) => Math.max(m, n.slot + (n.len || 1) - 1), 0) / spb) + 1);
    const perBar = new Array(nBars).fill(0); tab.notes.forEach(n => perBar[Math.floor(n.slot / spb)]++);
    const base = cssW < 560 ? 2 : 4, systems = []; let b = 0;
    while (b < nBars) {
      let k = Math.min(base, nBars - b);
      if (Math.max(...perBar.slice(b, b + k)) > 9 && k > 1) k = Math.max(1, Math.floor(k / 2));
      if (Math.max(...perBar.slice(b, b + k)) > 13) k = 1;
      systems.push({ b0: b, b1: b + k }); b += k;
    }
    return { systems, spb, nBars };
  }
  metrics(cssW) {
    const nStr = this.open.length, k = Math.max(0.72, Math.min(1.25, cssW / 900));
    const gap = 15 * k, top = (this.tab.chords ? 70 : 58) * k, stem = 36 * k;
    return { k, gap, top, stem, h: top + gap * (nStr - 1) + stem + 18 * k, x0: 46 * k };
  }
  render() {
    if (!this.tab) { this.box.innerHTML = ''; return; }
    const cssW = Math.max(280, this.box.clientWidth || 600);
    this.layout = this.layoutSystems(cssW); this.cssW = cssW;
    const m = this.metrics(cssW), n = this.layout.systems.length;
    while (this.box.children.length > n) this.box.lastChild.remove();
    while (this.box.children.length < n) { const cv = document.createElement('canvas'); cv.addEventListener('click', e => this.tap(e)); this.box.appendChild(cv); }
    this.hits = [];
    for (let i = 0; i < n; i++) { this.box.children[i].style.height = m.h + 'px'; this.box.children[i].dataset.i = i; this.drawOne(i); }
  }
  drawOne(i) {
    const cv = this.box.children[i]; if (!cv || !this.layout) return;
    const dpr = Math.min(3, devicePixelRatio || 1), cssW = this.cssW, m = this.metrics(cssW);
    cv.width = Math.round(cssW * dpr); cv.height = Math.round(m.h * dpr);
    const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = '#fafbfd'; c.fillRect(0, 0, cssW, m.h);
    this.hits[i] = drawSystem(c, this.layout.systems[i], this.tab, this.open, { x: 0, y: 0, w: cssW, spb: this.layout.spb, play: this.play, loop: this.loop, sysIndex: i, cursor: this.cursor }, m);
  }
  tap(e) {
    const cv = e.currentTarget, i = +cv.dataset.i, r = cv.getBoundingClientRect(), H = this.hits[i]; if (!H) return;
    const x = e.clientX - r.left, y = e.clientY - r.top; if (x < H.x0) return;
    const bar = H.b0 + Math.floor((x - H.x0) / H.barW);
    if (bar >= H.b1) return;
    if (this.cursor && this.onCell) {
      const nStr = this.open.length, spb = this.layout.spb;
      const slot = Math.max(H.b0 * spb, Math.min(H.b1 * spb - 1, H.b0 * spb + Math.floor((x - H.x0) / H.slotW)));
      const string = Math.max(0, Math.min(nStr - 1, nStr - 1 - Math.round((y - H.top) / H.gap)));
      this.onCell({ slot, string });
      return;
    }
    if (this.onBar) this.onBar(bar);
  }
  /** 인쇄용: 시스템 하나를 주어진 캔버스에 그림 */
  drawTo(c, sysIndex, x, y, w) {
    const lay = this.layoutSystems(w), m = this.metrics(w);
    drawSystem(c, lay.systems[sysIndex], this.tab, this.open, { x, y, w, spb: lay.spb, play: null, loop: null, sysIndex }, m);
    return m.h;
  }
}

export function drawSystem(c, sys, tab, open, o, m) {
  const { x, y, w, spb, play, loop, sysIndex, cursor } = o, nStr = open.length, k = m.k;
  const nBars = sys.b1 - sys.b0, barW = (w - m.x0 - 8 * k) / nBars, slotW = barW / spb;
  const top = y + m.top, lineY = s => top + (nStr - 1 - s) * m.gap, bottom = lineY(0);
  const notes = tab.notes.filter(n => n.slot >= sys.b0 * spb && n.slot < sys.b1 * spb);
  c.save(); c.lineCap = 'round'; c.lineJoin = 'round';
  // 구간 반복 영역
  if (loop) for (let b = sys.b0; b < sys.b1; b++) if (b >= loop[0] && b < loop[1]) { c.fillStyle = LOOP; c.fillRect(x + m.x0 + (b - sys.b0) * barW, top - 18 * k, barW, bottom - top + 36 * k); }
  c.strokeStyle = 'rgba(43,47,54,.55)'; c.lineWidth = 1 * k;
  for (let s = 0; s < nStr; s++) pencil(c, x + 4 * k, lineY(s), x + w - 4 * k, lineY(s), sysIndex * 31 + s, 1.1 * k);
  c.fillStyle = INK; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.font = `700 ${Math.round(15 * k)}px Caveat, cursive`;
  const mid = (top + bottom) / 2;
  ['T', 'A', 'B'].forEach((ch, i) => c.fillText(ch, x + 20 * k, mid + (i - 1) * 13 * k));
  c.font = `500 ${Math.round(12 * k)}px Caveat, cursive`; c.fillStyle = FAINT;
  for (let s = 0; s < nStr; s++) c.fillText(sName(open[s]), x + 6 * k, lineY(s));
  c.strokeStyle = 'rgba(43,47,54,.75)'; c.lineWidth = 1.3 * k;
  for (let b = 0; b <= nBars; b++) {
    const bx = x + m.x0 + b * barW;
    pencil(c, bx, top - 1, bx, bottom + 1, sysIndex * 97 + b, 1 * k);
    if (b < nBars) {
      c.fillStyle = FAINT; c.font = `500 ${Math.round(12 * k)}px Caveat, cursive`; c.textAlign = 'left'; c.fillText(String(sys.b0 + b + 1), bx + 3 * k, top - 40 * k);
      const ch = tab.chords && tab.chords[sys.b0 + b];
      if (ch) { c.fillStyle = PEN; c.font = `700 ${Math.round(16 * k)}px Caveat, "Nanum Pen Script", cursive`; c.fillText(ch, bx + 18 * k, top - 54 * k); }
    }
  }
  const nx = n => x + m.x0 + ((n.slot - sys.b0 * spb) + 0.5) * slotW;
  const idx = new Map(tab.notes.map((n, i) => [n, i]));
  c.textAlign = 'center'; c.textBaseline = 'middle';
  const fs = Math.round(17 * k);
  for (const n of notes) {
    const nxv = nx(n), ly = lineY(n.string ?? 0);
    let label = n.dead ? 'x' : String(n.fret);
    if (n.ghost && !n.dead) label = '(' + label + ')';
    if (n.harm) label = '<' + label + '>';
    c.font = `700 ${fs}px Caveat, cursive`;
    const tw = c.measureText(label).width;
    const playing = play != null && play >= n.slot && play < n.slot + (n.len || 1);
    c.fillStyle = '#fafbfd'; c.fillRect(nxv - tw / 2 - 2 * k, ly - 7 * k, tw + 4 * k, 14 * k);
    if (playing) { c.fillStyle = HL; c.beginPath(); c.ellipse(nxv, ly, tw / 2 + 7 * k, 11 * k, -0.1, 0, 7); c.fill(); }
    c.fillStyle = INK; c.fillText(label, nxv, ly + 1 * k);
    c.strokeStyle = PEN; c.fillStyle = PEN; c.lineWidth = 1.3 * k;
    const p = tab.notes[idx.get(n) - 1], sameSys = p && p.slot >= sys.b0 * spb;
    if (n.tech === 'h' || n.tech === 'p' || n.tech === 't') {
      const letter = n.tech === 'h' ? 'H' : n.tech === 'p' ? 'P' : 'T';
      const xa = sameSys ? nx(p) : nxv - slotW * 1.2, ya = sameSys ? lineY(p.string) : ly, yy = Math.min(ya, ly) - 10 * k;
      c.beginPath(); c.moveTo(xa + 3 * k, yy + 2 * k); c.quadraticCurveTo((xa + nxv) / 2, yy - 9 * k, nxv - 3 * k, yy + 2 * k); c.stroke();
      c.font = `700 ${Math.round(13 * k)}px Caveat, cursive`; c.fillText(letter, (xa + nxv) / 2, yy - 11 * k);
    }
    if (n.tech === 's') {
      const up = !p || p.fret == null || n.fret == null || n.fret >= p.fret;
      const xa = sameSys ? nx(p) + 8 * k : nxv - slotW * 1.1;
      c.beginPath(); c.moveTo(xa, ly + (up ? 5 : -5) * k); c.lineTo(nxv - tw / 2 - 3 * k, ly + (up ? -5 : 5) * k); c.stroke();
    }
    if (n.slideIn) { c.beginPath(); c.moveTo(nxv - tw / 2 - 13 * k, ly + 6 * k); c.lineTo(nxv - tw / 2 - 3 * k, ly - 3 * k); c.stroke(); }
    if (n.slideOut) { c.beginPath(); c.moveTo(nxv + tw / 2 + 3 * k, ly - 3 * k); c.lineTo(nxv + tw / 2 + 13 * k, ly + 6 * k); c.stroke(); }
    if (n.bend) {
      const bx0 = nxv + tw / 2 + 2 * k, px = bx0 + Math.min(slotW * 1.2, 20 * k), py = top - 16 * k;
      c.beginPath(); c.moveTo(bx0, ly - 2 * k); c.quadraticCurveTo(px, ly - 2 * k, px, py); c.stroke();
      c.beginPath(); c.moveTo(px - 4 * k, py + 6 * k); c.lineTo(px, py); c.lineTo(px + 4 * k, py + 6 * k); c.stroke();
      c.font = `700 ${Math.round(12 * k)}px Caveat, cursive`; c.fillText(n.bend >= 2 ? 'full' : '½', px, py - 8 * k);
    }
    if (n.vib) {
      const vx0 = nxv - 4 * k, vx1 = nxv + Math.max(18 * k, slotW * (n.len || 2) * 0.9), vy = top - 24 * k;
      c.beginPath(); for (let xx = vx0; xx <= vx1; xx += 1) { const yy = vy + Math.sin((xx - vx0) / (3.2 * k)) * 2.6 * k; xx === vx0 ? c.moveTo(xx, yy) : c.lineTo(xx, yy); } c.stroke();
    }
    if (n.slap || n.pop) { c.font = `700 ${Math.round(13 * k)}px Caveat, cursive`; c.fillText(n.slap ? 'S' : 'Po', nxv, top - 30 * k); }
    if (n.harm) { c.font = `600 ${Math.round(11 * k)}px Caveat, cursive`; c.fillText('Harm.', nxv, top - 30 * k); }
  }
  // 리듬
  c.strokeStyle = INK; c.fillStyle = INK; c.lineWidth = 1.1 * k;
  const stemTop = bottom + 10 * k, stemBot = bottom + m.stem - 4 * k;
  for (let bar = sys.b0; bar < sys.b1; bar++) for (let beat = 0; beat < spb / 4; beat++) {
    const s0 = bar * spb + beat * 4, grp = notes.filter(n => n.slot >= s0 && n.slot < s0 + 4);
    grp.forEach(n => {
      const len = n.len || 1, xx = nx(n), sb = len >= 8 ? stemTop + (stemBot - stemTop) * 0.5 : stemBot;
      c.beginPath(); c.moveTo(xx, stemTop); c.lineTo(xx, sb); c.stroke();
      if (len === 3 || len === 6 || len === 12) { c.beginPath(); c.arc(xx + 4 * k, sb - 3 * k, 1.4 * k, 0, 7); c.fill(); }
    });
    const short = grp.filter(n => (n.len || 1) < 4); if (!short.length) continue;
    const beamH = 3 * k;
    if (short.length >= 2) {
      c.fillRect(nx(short[0]), stemBot - beamH, nx(short[short.length - 1]) - nx(short[0]), beamH);
      short.forEach((n, i) => {
        if ((n.len || 1) !== 1) return;
        const xx = nx(n), nb = short[i + 1], pb = short[i - 1]; let xa = xx, xb = xx;
        if (nb && (nb.len || 1) === 1) xb = nx(nb); else if (pb && (pb.len || 1) === 1) xa = xx; else if (nb) xb = xx + 7 * k; else xa = xx - 7 * k;
        c.fillRect(Math.min(xa, xb), stemBot - beamH * 2.6, Math.max(2, Math.abs(xb - xa)), beamH);
      });
    } else {
      const n = short[0], xx = nx(n), flags = (n.len || 1) === 1 ? 2 : 1;
      for (let f = 0; f < flags; f++) { c.beginPath(); c.moveTo(xx, stemBot - f * 6 * k); c.quadraticCurveTo(xx + 9 * k, stemBot - f * 6 * k - 6 * k, xx + 7 * k, stemBot - f * 6 * k - 13 * k); c.stroke(); }
    }
  }
  // 편집 커서
  if (cursor) {
    // 박 위치 점 (어디가 몇 박인지)
    c.fillStyle = 'rgba(37,71,176,.35)';
    for (let b = sys.b0; b < sys.b1; b++) for (let q = 0; q < spb; q++) {
      const px = x + m.x0 + ((b - sys.b0) * spb + q + 0.5) * slotW;
      c.beginPath(); c.arc(px, bottom + 5 * k, q % 4 === 0 ? 1.8 * k : 0.9 * k, 0, 7); c.fill();
    }
    if (cursor.slot >= sys.b0 * spb && cursor.slot < sys.b1 * spb) {
      const cx = x + m.x0 + (cursor.slot - sys.b0 * spb) * slotW, cy = lineY(cursor.string);
      const cw = Math.max(slotW, 16 * k), ox = (cw - slotW) / 2;
      c.fillStyle = 'rgba(37,71,176,.16)'; c.strokeStyle = PEN; c.lineWidth = 1.6 * k;
      c.beginPath(); c.rect(cx - ox, cy - m.gap / 2, cw, m.gap); c.fill(); c.stroke();
      c.fillStyle = 'rgba(37,71,176,.07)'; c.fillRect(cx - ox, top - 12 * k, cw, bottom - top + 24 * k);
    }
  }
  // 재생 위치 선
  if (play != null && play >= sys.b0 * spb && play < sys.b1 * spb) {
    const px = x + m.x0 + (play - sys.b0 * spb + 0.5) * slotW;
    c.strokeStyle = PLAY; c.lineWidth = 2 * k; c.beginPath(); c.moveTo(px, top - 20 * k); c.lineTo(px, bottom + m.stem); c.stroke();
  }
  c.restore();
  return { x0: x + m.x0, barW, slotW, b0: sys.b0, b1: sys.b1, top, gap: m.gap };
}
