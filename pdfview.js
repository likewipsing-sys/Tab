// pdfview.js — PDF 악보 보기 + 자동 스크롤 (pdf.js는 vendor 폴더에 들어 있음)
let pdfjs = null;
async function lib() {
  if (pdfjs) return pdfjs;
  pdfjs = await import('./pdf.min.js');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('./pdf.worker.min.js', import.meta.url).href;
  return pdfjs;
}
export async function pdfInfo(blob) {
  const L = await lib();
  const task = L.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) });
  const doc = await task.promise;
  const n = doc.numPages; let title = '';
  try { const md = await doc.getMetadata(); title = (md && md.info && md.info.Title) || ''; } catch (e) { /* 없음 */ }
  await (task.destroy ? task.destroy() : doc.destroy && doc.destroy());
  return { pages: n, title };
}

export class PdfViewer {
  /** el: 전체 화면 레이어, save(meta패치): 설정 저장 콜백 */
  constructor(el, { save, onState, metro } = {}) {
    this.el = el; this.save = save; this.onState = onState; this.metro = metro;
    this.scroller = el.querySelector('.pdf-scroll'); this.pagesBox = el.querySelector('.pdf-pages');
    this.doc = null; this.meta = null; this.playing = false; this.speed = 30; this.raf = 0; this.rendered = new Map(); this.wake = null;
    this.io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) this.renderPage(+e.target.dataset.p); }), { root: this.scroller, rootMargin: '150% 0px' });
    this.scroller.addEventListener('scroll', () => { this.report(); clearTimeout(this._sv); this._sv = setTimeout(() => this.persist(), 800); }, { passive: true });
    // 화면을 짧게 탭하면 재생/정지 (끌어서 스크롤할 때는 무시)
    let down = null;
    this.scroller.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, t: performance.now(), top: this.scroller.scrollTop }; });
    this.scroller.addEventListener('pointerup', e => {
      if (!down) return; const d = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      if (d < 8 && performance.now() - down.t < 350 && Math.abs(this.scroller.scrollTop - down.top) < 4) this.toggle();
      down = null;
    });
    this.keyHandler = e => {
      if (this.el.hidden) return;
      if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
      const k = e.key;
      if (k === ' ' || k === 'Enter') { e.preventDefault(); this.toggle(); }
      else if (k === 'ArrowDown' || k === 'PageDown' || k === 'ArrowRight') { e.preventDefault(); this.playing ? this.setSpeed(this.speed + 3) : this.scroller.scrollBy({ top: this.scroller.clientHeight * 0.8, behavior: 'smooth' }); }
      else if (k === 'ArrowUp' || k === 'PageUp' || k === 'ArrowLeft') { e.preventDefault(); this.playing ? this.setSpeed(this.speed - 3) : this.scroller.scrollBy({ top: -this.scroller.clientHeight * 0.8, behavior: 'smooth' }); }
      else if (k === 'Escape') this.close();
    };
    document.addEventListener('keydown', this.keyHandler);
    new ResizeObserver(() => { if (this.doc) { clearTimeout(this._rz); this._rz = setTimeout(() => this.layout(true), 150); } }).observe(this.scroller);
  }
  async open(blob, meta) {
    const L = await lib();
    this.close(true);
    this.meta = meta; this.speed = meta.speed || 30; this.zoom = meta.zoom || 1;
    this.task = L.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) });
    this.doc = await this.task.promise;
    this.sizes = [];
    for (let i = 1; i <= this.doc.numPages; i++) { const p = await this.doc.getPage(i); const v = p.getViewport({ scale: 1 }); this.sizes.push([v.width, v.height]); }
    this.el.hidden = false; document.body.classList.add('pdf-open');
    this.layout();
    requestAnimationFrame(() => { const max = this.scroller.scrollHeight - this.scroller.clientHeight; this.scroller.scrollTop = Math.max(0, (meta.pos || 0) * max); this.report(); });
  }
  layout(keepPos) {
    const frac = keepPos ? this.fraction() : null;
    this.io.disconnect(); this.rendered.clear(); this.pagesBox.innerHTML = '';
    const W = Math.min(this.scroller.clientWidth - 16, 1400) * this.zoom;
    this.sizes.forEach(([w, h], i) => {
      const d = document.createElement('div'); d.className = 'pdf-page'; d.dataset.p = i + 1;
      d.style.width = W + 'px'; d.style.height = Math.round(W * h / w) + 'px';
      this.pagesBox.appendChild(d); this.io.observe(d);
    });
    if (frac != null) requestAnimationFrame(() => { this.scroller.scrollTop = frac * (this.scroller.scrollHeight - this.scroller.clientHeight); });
  }
  async renderPage(p) {
    if (this.rendered.has(p) || !this.doc) return;
    this.rendered.set(p, true);
    const holder = this.pagesBox.children[p - 1]; if (!holder) return;
    const page = await this.doc.getPage(p);
    const cssW = parseFloat(holder.style.width), dpr = Math.min(2, window.devicePixelRatio || 1);
    const vp = page.getViewport({ scale: cssW / page.getViewport({ scale: 1 }).width * dpr });
    const cv = document.createElement('canvas'); cv.width = Math.floor(vp.width); cv.height = Math.floor(vp.height);
    const ctx = cv.getContext('2d');
    await page.render({ canvas: cv, canvasContext: ctx, viewport: vp }).promise;
    holder.innerHTML = ''; holder.appendChild(cv);
    // 멀리 떨어진 페이지는 메모리를 위해 지움
    for (const [q] of this.rendered) if (Math.abs(q - p) > 4) { const h = this.pagesBox.children[q - 1]; if (h) h.innerHTML = ''; this.rendered.delete(q); }
  }
  fraction() { const max = this.scroller.scrollHeight - this.scroller.clientHeight; return max > 0 ? this.scroller.scrollTop / max : 0; }
  report() {
    if (!this.doc) return;
    const mid = this.scroller.scrollTop + this.scroller.clientHeight / 2; let page = 1, acc = 0;
    for (const ch of this.pagesBox.children) { acc += ch.offsetHeight + 12; if (acc >= mid) break; page++; }
    const left = this.playing && this.speed > 0 ? (this.scroller.scrollHeight - this.scroller.clientHeight - this.scroller.scrollTop) / this.pxPerSec() : null;
    this.onState && this.onState({ page: Math.min(page, this.doc.numPages), pages: this.doc.numPages, frac: this.fraction(), playing: this.playing, speed: this.speed, left });
  }
  pxPerSec() { return this.speed * (this.scroller.clientWidth / 1000) * this.zoom; }   // 속도: 화면 폭 1000px 기준 초당 픽셀
  setSpeed(v) { this.speed = Math.max(1, Math.min(300, Math.round(v))); this.report(); this.persist(); }
  /** 남은 부분을 정해진 시간(초) 동안 스크롤하도록 속도 계산 */
  fitDuration(sec) { const remain = this.scroller.scrollHeight - this.scroller.clientHeight - this.scroller.scrollTop; if (sec > 0 && remain > 0) this.setSpeed(remain / sec / ((this.scroller.clientWidth / 1000) * this.zoom)); }
  setZoom(z) { this.zoom = z; this.layout(true); this.persist(); }
  async play(delaySec) {
    if (this.playing) return;
    this.playing = true; this.report();
    try { if (navigator.wakeLock) this.wake = await navigator.wakeLock.request('screen'); } catch (e) { /* 화면 꺼짐 방지 못 함 */ }
    if (delaySec > 0) { this.onState && this.onState({ countdown: delaySec }); await new Promise(r => setTimeout(r, delaySec * 1000)); if (!this.playing) return; }
    let last = performance.now(), acc = 0;
    const step = now => {
      if (!this.playing) return;
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      acc += this.pxPerSec() * dt;
      if (acc >= 1) { const px = Math.floor(acc); acc -= px; this.scroller.scrollTop += px; }
      if (this.scroller.scrollTop >= this.scroller.scrollHeight - this.scroller.clientHeight - 1) { this.pause(); return; }
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }
  pause() { this.playing = false; cancelAnimationFrame(this.raf); if (this.wake) { this.wake.release().catch(() => {}); this.wake = null; } this.report(); this.persist(); }
  toggle(delay) { this.playing ? this.pause() : this.play(delay ?? this.delay ?? 0); }
  top() { this.scroller.scrollTop = 0; }
  persist() { if (this.meta && this.save) this.save({ speed: this.speed, pos: Math.round(this.fraction() * 1000) / 1000, zoom: this.zoom }); }
  close(silent) {
    if (this.playing) this.pause();
    if (this.doc && !silent) this.persist();
    if (this.doc) { try { (this.task && this.task.destroy) ? this.task.destroy() : this.doc.destroy && this.doc.destroy(); } catch (e) { /* 무시 */ } this.doc = null; this.task = null; }
    this.io.disconnect(); this.pagesBox.innerHTML = ''; this.rendered.clear();
    if (!silent) { this.el.hidden = true; document.body.classList.remove('pdf-open'); }
  }
}
