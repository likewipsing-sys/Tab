/* NeckTrack — 영상에서 베이스 넥(지판) 따라가기
 *  1) 지판 격자점(프렛×줄 교차점)을 피라미드 루카스-카나데 광류로 다음 프레임까지 추적
 *  2) RANSAC으로 원근 변환(호모그래피)을 맞춤 (손에 가린 점·잘못 추적된 점은 자동으로 버림)
 *  3) 프렛 줄(밝은 선)과 지판 테두리에 딱 맞도록 미세 조정 → 오차가 쌓이지 않게 함
 *  4) 기준 장면(사용자가 맞춘 장면)에서 앞·뒤 양방향으로 추적하고 둘을 섞음
 * 모든 좌표: 정규화 이미지 좌표(0~1). 모서리 4점 = [0프렛 위, 0프렛 아래, 12프렛 위, 12프렛 아래]
 */
(function (root) {
  'use strict';
  const C = (typeof module !== 'undefined' && module.exports) ? require('./core.js') : root.BassCore;

  // ------------------------------------------------------------ 영상 → 회색조
  function toGray(rgba, w, h) {
    const g = new Uint8Array(w * h);
    for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = (rgba[j] * 77 + rgba[j + 1] * 150 + rgba[j + 2] * 29) >> 8;
    return g;
  }
  function pyramid(gray, w, h, levels) {
    const out = [];
    // 0단계: 3x3 가볍게 흐림
    let cur = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let s = 0, c = 0;
      for (let dy = -1; dy <= 1; dy++) { const yy = y + dy; if (yy < 0 || yy >= h) continue; for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx < 0 || xx >= w) continue; const k = (dx ? 1 : 2) * (dy ? 1 : 2); s += gray[yy * w + xx] * k; c += k; } }
      cur[y * w + x] = s / c;
    }
    out.push({ d: cur, w, h });
    for (let l = 1; l < levels; l++) {
      const p = out[l - 1], nw = p.w >> 1, nh = p.h >> 1, d = new Float32Array(nw * nh);
      for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
        const x2 = x * 2, y2 = y * 2, a = p.d;
        d[y * nw + x] = (a[y2 * p.w + x2] + a[y2 * p.w + Math.min(p.w - 1, x2 + 1)] + a[Math.min(p.h - 1, y2 + 1) * p.w + x2] + a[Math.min(p.h - 1, y2 + 1) * p.w + Math.min(p.w - 1, x2 + 1)]) * 0.25;
      }
      out.push({ d, w: nw, h: nh });
    }
    return out;
  }
  function samp(L, x, y) {
    if (x < 0) x = 0; else if (x > L.w - 1.001) x = L.w - 1.001;
    if (y < 0) y = 0; else if (y > L.h - 1.001) y = L.h - 1.001;
    const xi = x | 0, yi = y | 0, fx = x - xi, fy = y - yi, o = yi * L.w + xi, d = L.d;
    return (d[o] * (1 - fx) + d[o + 1] * fx) * (1 - fy) + (d[o + L.w] * (1 - fx) + d[o + L.w + 1] * fx) * fy;
  }

  // ------------------------------------------------------------ 피라미드 루카스-카나데
  function lk(P, Q, pts, guess, r) {
    r = r || 4;
    const levels = P.length, out = [];
    const n = (2 * r + 1) * (2 * r + 1);
    const Ix = new Float32Array(n), Iy = new Float32Array(n), Iv = new Float32Array(n);
    for (let k = 0; k < pts.length; k++) {
      const [px, py] = pts[k];
      let gx = guess ? guess[k][0] / (1 << (levels - 1)) : 0, gy = guess ? guess[k][1] / (1 << (levels - 1)) : 0;
      let ok = true, minEig = 0, resid = 0;
      for (let l = levels - 1; l >= 0; l--) {
        const s = 1 << l, I = P[l], J = Q[l], x0 = px / s, y0 = py / s;
        let a = 0, b = 0, c = 0, q = 0;
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
          const x = x0 + dx, y = y0 + dy;
          const ix = (samp(I, x + 1, y) - samp(I, x - 1, y)) * 0.5, iy = (samp(I, x, y + 1) - samp(I, x, y - 1)) * 0.5;
          Ix[q] = ix; Iy[q] = iy; Iv[q] = samp(I, x, y); a += ix * ix; b += ix * iy; c += iy * iy; q++;
        }
        const det = a * c - b * b;
        minEig = (a + c - Math.sqrt((a - c) * (a - c) + 4 * b * b)) / 2 / n;
        if (det < 1e-6 || minEig < 0.5) { ok = false; break; }
        for (let it = 0; it < 12; it++) {
          let bx = 0, by = 0; q = 0;
          for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
            const e = Iv[q] - samp(J, x0 + dx + gx, y0 + dy + gy);
            bx += e * Ix[q]; by += e * Iy[q]; q++;
          }
          const ux = (c * bx - b * by) / det, uy = (a * by - b * bx) / det;
          gx += ux; gy += uy;
          if (ux * ux + uy * uy < 0.0009) break;
        }
        if (l > 0) { gx *= 2; gy *= 2; }
      }
      if (ok) {
        let e = 0, q = 0; const I = P[0], J = Q[0];
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { e += Math.abs(samp(I, px + dx, py + dy) - samp(J, px + dx + gx, py + dy + gy)); q++; }
        resid = e / q;
      }
      out.push({ x: px + gx, y: py + gy, ok: ok && Number.isFinite(gx) && Number.isFinite(gy), minEig, resid });
    }
    return out;
  }

  // ------------------------------------------------------------ 호모그래피 (최소제곱 + RANSAC)
  function solveHls(src, dst) {
    if (src.length === 4) return C.solveH(src, dst);
    const M = Array.from({ length: 8 }, () => new Float64Array(8)), v = new Float64Array(8);
    const add = (row, b) => { for (let i = 0; i < 8; i++) { v[i] += row[i] * b; for (let j = 0; j < 8; j++) M[i][j] += row[i] * row[j]; } };
    for (let i = 0; i < src.length; i++) {
      const [x, y] = src[i], [X, Y] = dst[i];
      add([x, y, 1, 0, 0, 0, -X * x, -X * y], X); add([0, 0, 0, x, y, 1, -Y * x, -Y * y], Y);
    }
    const A = M.map(r => Array.from(r)), b = Array.from(v), n = 8;
    for (let c = 0; c < n; c++) {
      let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
      if (Math.abs(A[c][c]) < 1e-14) return null;
      for (let r = 0; r < n; r++) { if (r === c) continue; const f = A[r][c] / A[c][c]; for (let k = c; k < n; k++) A[r][k] -= f * A[c][k]; b[r] -= f * b[c]; }
    }
    const h = b.map((x, i) => x / A[i][i]);
    return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
  }
  function ransacH(src, dst, thr, iters, R) {
    const n = src.length; if (n < 4) return null;
    R = R || Math.random;
    let best = null, bestIn = [];
    for (let it = 0; it < iters; it++) {
      const idx = new Set(); while (idx.size < 4) idx.add(Math.floor(R() * n));
      const ii = [...idx];
      const H = C.solveH(ii.map(i => src[i]), ii.map(i => dst[i]));
      if (!H) continue;
      const inl = [];
      for (let i = 0; i < n; i++) { const [x, y] = C.applyH(H, src[i][0], src[i][1]); if (Math.hypot(x - dst[i][0], y - dst[i][1]) < thr) inl.push(i); }
      if (inl.length > bestIn.length) { bestIn = inl; best = H; if (inl.length > n * 0.9) break; }
    }
    if (!best || bestIn.length < 4) return null;
    let H = solveHls(bestIn.map(i => src[i]), bestIn.map(i => dst[i])) || best;
    // 한 번 더: 새 모델 기준 인라이어로 다시 맞춤
    const inl2 = []; for (let i = 0; i < n; i++) { const [x, y] = C.applyH(H, src[i][0], src[i][1]); if (Math.hypot(x - dst[i][0], y - dst[i][1]) < thr) inl2.push(i); }
    if (inl2.length >= 4) H = solveHls(inl2.map(i => src[i]), inl2.map(i => dst[i])) || H;
    return { H, inliers: inl2.length >= bestIn.length ? inl2 : bestIn };
  }

  // ------------------------------------------------------------ 모서리 ↔ 모델
  const CORNER_UV = [[0, 0], [0, 1], [0.5, 0], [0.5, 1]];
  function cornersOf(key) { const m = C.neckModel(key); return m ? CORNER_UV.map(([u, v]) => m.toImg(u, v)) : null; }
  const modelOf = pts => C.neckModel({ pts, fA: 0, fB: 12 });
  function stringV(nStr, mg) { const a = []; for (let s = 0; s < nStr; s++) a.push(mg + (1 - 2 * mg) * s / (nStr - 1)); return a; }

  // ------------------------------------------------------------ 프렛 줄·테두리에 맞추기
  function makeMask(masks, w, h) {
    if (!masks || !masks.length) return () => false;
    return (x, y) => masks.some(m => ((x / w - m.cx) / m.rx) ** 2 + ((y / h - m.cy) / m.ry) ** 2 < 1);
  }
  function snapScore(L, w, h, pts, inMask, maxF, sv) {
    const m = modelOf(pts.map(([x, y]) => [x / w, y / h])); if (!m) return -1e9;
    const P = (u, v) => { const [x, y] = m.toImg(u, v); return [x * w, y * h]; };
    let rs = 0, rc = 0, es = 0, ec = 0;
    for (let f = 0; f <= maxF; f++) {
      const u = C.fretU(f), du = C.fretU(f + 0.05) - u;
      for (let k = 1; k <= 7; k++) {
        const v = k / 8, [x, y] = P(u, v);
        if (x < 3 || y < 3 || x > w - 4 || y > h - 4 || inMask(x, y)) continue;
        const [x2, y2] = P(u + du, v); let dx = x2 - x, dy = y2 - y; const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
        const c0 = samp(L, x, y), a = samp(L, x + 2 * dx, y + 2 * dy), b = samp(L, x - 2 * dx, y - 2 * dy);
        rs += Math.abs(c0 - 0.5 * (a + b)) * (f === 0 ? 1.5 : 1); rc++;
      }
    }
    for (let f = 1; f <= maxF; f++) {
      const u = (C.fretU(f) + C.fretU(f - 1)) / 2;
      for (const v of [0, 1]) {
        const [x, y] = P(u, v); if (x < 3 || y < 3 || x > w - 4 || y > h - 4 || inMask(x, y)) continue;
        const [x2, y2] = P(u, v + 0.05); let dx = x2 - x, dy = y2 - y; const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
        es += Math.abs(samp(L, x + 1.5 * dx, y + 1.5 * dy) - samp(L, x - 1.5 * dx, y - 1.5 * dy)); ec++;
      }
    }
    // 줄(가로로 긴 밝은 선)
    let ss = 0, sc = 0;
    if (sv) for (const v of sv) for (let f = 1; f <= maxF; f++) {
      const u = (C.fretU(f) + C.fretU(f - 1)) / 2, [x, y] = P(u, v);
      if (x < 3 || y < 3 || x > w - 4 || y > h - 4 || inMask(x, y)) continue;
      const [x2, y2] = P(u, v + 0.05); let dx = x2 - x, dy = y2 - y; const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
      ss += samp(L, x, y) - 0.5 * (samp(L, x + 2 * dx, y + 2 * dy) + samp(L, x - 2 * dx, y - 2 * dy)); sc++;
    }
    if (rc < 12) return -1e9;
    return rs / rc + 0.5 * (ec ? es / ec : 0) + (sc ? 0.6 * ss / sc : 0);
  }
  /** 대략 맞춘 모서리를 프렛 줄에 딱 맞게 다듬음. ptsN: 정규화 모서리, 반환: {pts, score} */
  function snap(L, ptsN, masks, opts) {
    opts = opts || {};
    const w = L.w, h = L.h, inMask = makeMask(masks, w, h), maxF = opts.maxF || 15, maxShift = opts.maxShift ?? 4;
    const start = ptsN.map(([x, y]) => [x * w, y * h]);
    const sv = opts.nStr ? stringV(opts.nStr, opts.margin ?? 0.12) : null;
    let P = start.map(p => p.slice()), best = snapScore(L, w, h, P, inMask, maxF, sv);
    if (best < -1e8) return { pts: ptsN, score: best };
    for (const step of opts.steps || [1.5, 0.75, 0.35]) {
      for (let pass = 0; pass < 6; pass++) {
        let improved = false;
        for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) for (const sg of [1, -1]) {
          const old = P[i][j]; P[i][j] = old + sg * step;
          if (Math.abs(P[i][j] - start[i][j]) > maxShift) { P[i][j] = old; continue; }
          const s = snapScore(L, w, h, P, inMask, maxF, sv);
          if (s > best + 1e-4) { best = s; improved = true; } else P[i][j] = old;
        }
        // 전체 평행이동도 시도 (모서리 하나씩 움직이면 못 넘는 경우)
        for (const [dx, dy] of [[step, 0], [-step, 0], [0, step], [0, -step]]) {
          const Q = P.map(([x, y]) => [x + dx, y + dy]);
          if (Q.some((q, i) => Math.abs(q[0] - start[i][0]) > maxShift || Math.abs(q[1] - start[i][1]) > maxShift)) continue;
          const s = snapScore(L, w, h, Q, inMask, maxF, sv);
          if (s > best + 1e-4) { best = s; P = Q; improved = true; }
        }
        if (!improved) break;
      }
    }
    return { pts: P.map(([x, y]) => [x / w, y / h]), score: best };
  }

  /** 대충 맞춘 모서리(오차 10~15px)도 찾도록 큰 범위 → 작은 범위로 맞춤 */
  function autoFit(P, ptsN, masks, opts) {
    opts = opts || {};
    let pts = ptsN;
    if (P.length > 1) pts = snap(P[1], pts, masks, Object.assign({}, opts, { maxShift: (opts.range || 14) / 2, steps: [2, 1, 0.5] })).pts;
    const r = snap(P[0], pts, masks, Object.assign({}, opts, { maxShift: 4, steps: [1.5, 0.75, 0.35] }));
    return r;
  }

  // ------------------------------------------------------------ 한 프레임 → 다음 프레임
  function step(PA, PB, ptsN, masksA, masksB, opts, R) {
    const w = PA[0].w, h = PA[0].h, nStr = opts.nStr || 4;
    const m = modelOf(ptsN); if (!m) return null;
    const inA = makeMask(masksA, w, h), inB = makeMask(masksB, w, h);
    const vs = [0, ...stringV(nStr, opts.margin ?? 0.12), 1];
    const src = [], pts = [], guess = [];
    for (let f = 0; f <= (opts.maxF || 17); f++) for (const v of vs) {
      const u = C.fretU(f);
      const [x, y] = m.toImg(u, v), X = x * w, Y = y * h;
      if (X < 6 || Y < 6 || X > w - 7 || Y > h - 7 || inA(X, Y) || inB(X, Y)) continue;
      src.push([u, v]); pts.push([X, Y]);
      if (opts.vel) { const [x2, y2] = opts.vel.toImg(u, v); guess.push([x2 * w - X, y2 * h - Y]); }
    }
    if (pts.length < 8) return { pts: ptsN, q: 0, n: pts.length };
    const tr = lk(PA, PB, pts, opts.vel ? guess : null, opts.win || 4);
    const s2 = [], d2 = [];
    tr.forEach((r, i) => { if (r.ok && r.resid < (opts.maxResid || 22)) { s2.push(src[i]); d2.push([r.x, r.y]); } });
    if (s2.length < 8) return { pts: ptsN, q: 0, n: pts.length };
    const fit = ransacH(s2, d2, opts.thr || 1.6, 160, R);
    if (!fit) return { pts: ptsN, q: 0, n: pts.length };
    const q = fit.inliers.length / pts.length;
    if (fit.inliers.length < 8 || q < (opts.minQ || 0.3)) return { pts: ptsN, q: 0, n: pts.length };
    let out = CORNER_UV.map(([u, v]) => { const [x, y] = C.applyH(fit.H, u, v); return [x / w, y / h]; });
    let score = null;
    if (opts.snap !== false) { const sp = snap(PB[0], out, masksB, { maxShift: opts.snapShift ?? 2.5, maxF: opts.snapF || 15, nStr: opts.nStr, margin: opts.margin }); out = sp.pts; score = sp.score; }
    // 지판처럼 보이는가: 프렛 선·줄 대비가 기준 장면보다 크게 약하면 놓친 것으로 봄 (장면 전환·가림)
    if (score != null && opts.refScore && score < opts.refScore * (opts.minLook || 0.5)) return { pts: ptsN, q: 0, n: pts.length, score };
    return { pts: out, q, n: pts.length, score };
  }

  /**
   * frames: [{t, gray, w, h, masks}], anchors: [{t, pts, fA, fB}]
   * 반환: [{t, pts|null, q}] (프레임마다)
   */
  async function trackAll(frames, anchors, opts, onProgress) {
    opts = opts || {};
    const N = frames.length; if (!N || !anchors.length) return frames.map(f => ({ t: f.t, pts: null, q: 0 }));
    const levels = opts.levels || 3;
    const A = anchors.map(a => ({ t: a.t, pts: cornersOf(a) })).filter(a => a.pts).sort((a, b) => a.t - b.t);
    const near = t => { let b = 0; for (let k = 0; k < N; k++) if (Math.abs(frames[k].t - t) < Math.abs(frames[b].t - t)) b = k; return b; };
    const ai = A.map(a => near(a.t));
    const fw = new Array(N).fill(null), bw = new Array(N).fill(null);
    let done = 0; const total = N * 2;
    const R = (() => { let s = 12345; return () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296); })();
    const pyrCache = new Map();
    const pyr = k => { if (!pyrCache.has(k)) { if (pyrCache.size > 4) pyrCache.delete(pyrCache.keys().next().value); pyrCache.set(k, pyramid(frames[k].gray, frames[k].w, frames[k].h, levels)); } return pyrCache.get(k); };
    const run = async (from, to, dir, store, pts0) => {
      let pts = pts0, prev = null, lastGood = from;
      store[from] = { pts: pts0, q: 1, d: 0 };
      // 기준 장면 자체도 다듬기
      let refScore = null;
      if (opts.snapAnchor !== false) { const sp = snap(pyr(from)[0], pts0, frames[from].masks, { maxShift: opts.anchorShift ?? 4, nStr: opts.nStr, margin: opts.margin }); pts = sp.pts; store[from].pts = pts; refScore = sp.score > 0 ? sp.score : null; }
      for (let k = from + dir, d = 1; dir > 0 ? k < to : k > to; k += dir, d++) {
        const vel = prev ? modelOf(pts.map((p, i) => [2 * p[0] - prev[i][0], 2 * p[1] - prev[i][1]])) : null;
        const r = step(pyr(k - dir), pyr(k), pts, frames[k - dir].masks, frames[k].masks, Object.assign({}, opts, { vel, refScore }), R);
        if (r && r.q > 0) { prev = pts; pts = r.pts; lastGood = k; store[k] = { pts, q: r.q, d }; }
        else { store[k] = null; prev = null; if (Math.abs(frames[k].t - frames[lastGood].t) > (opts.maxLost || 1.5)) break; }
        done++;
        if (done % 8 === 0) { onProgress && onProgress(Math.min(1, done / total)); await new Promise(r => setTimeout(r, 0)); }
      }
    };
    for (let j = 0; j < A.length; j++) {
      const k0 = ai[j];
      const next = j + 1 < A.length ? ai[j + 1] : N, prev = j > 0 ? ai[j - 1] : -1;
      await run(k0, next, 1, fw, A[j].pts);
      await run(k0, prev, -1, bw, A[j].pts);
    }
    return frames.map((f, k) => {
      const a = fw[k], b = bw[k];
      if (a && b) {
        const wa = a.q / (a.d + 1), wb = b.q / (b.d + 1), s = wa + wb;
        return { t: f.t, pts: a.pts.map((p, i) => [(p[0] * wa + b.pts[i][0] * wb) / s, (p[1] * wa + b.pts[i][1] * wb) / s]), q: Math.max(a.q, b.q) };
      }
      const r = a || b;
      return { t: f.t, pts: r ? r.pts : null, q: r ? r.q : 0 };
    });
  }

  // ------------------------------------------------------------ 줄 간격 자동 찾기
  /** 지판 위 줄(가로로 긴 밝은 선) 위치를 찾아 테두리~바깥 줄 사이 여백(margin)과 굵기 순서를 추정 */
  function findStrings(L, ptsN, masks, nStr) {
    const w = L.w, h = L.h, m = modelOf(ptsN); if (!m) return null;
    const inMask = makeMask(masks, w, h);
    const prof = [], wide = [];
    for (let k = 0; k <= 100; k++) {
      const v = k / 100; let s = 0, s2 = 0, c = 0;
      for (let f = 1; f <= 14; f++) {
        const u = (C.fretU(f) + C.fretU(f - 1)) / 2;
        const [x, y] = m.toImg(u, v), X = x * w, Y = y * h; if (X < 4 || Y < 4 || X > w - 5 || Y > h - 5 || inMask(X, Y)) continue;
        const [x2, y2] = m.toImg(u, v + 0.02); let dx = x2 * w - X, dy = y2 * h - Y; const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
        const c0 = samp(L, X, Y);
        s += c0 - 0.5 * (samp(L, X + 2 * dx, Y + 2 * dy) + samp(L, X - 2 * dx, Y - 2 * dy));
        s2 += 0.5 * (samp(L, X + dx, Y + dy) + samp(L, X - dx, Y - dy)) - 0.5 * (samp(L, X + 3 * dx, Y + 3 * dy) + samp(L, X - 3 * dx, Y - 3 * dy));
        c++;
      }
      prof.push(c ? s / c : 0); wide.push(c ? s2 / c : 0);
    }
    const at = (arr, v) => { if (v < 0 || v > 1) return -50; const x = v * 100, i = Math.floor(x), f = x - i; return (arr[i] || 0) * (1 - f) + (arr[Math.min(100, i + 1)] || 0) * f; };
    // 줄 위치 = a + b·s (첫 줄 위치 a, 줄 간격 b) — 위아래 여백이 달라도 찾음
    let ba = 0.12, bb = (1 - 0.24) / (nStr - 1), bs = -1e9;
    for (let b = 0.5 / (nStr - 1); b <= 0.98 / (nStr - 1); b += 0.004) for (let a = 0; a + b * (nStr - 1) <= 1; a += 0.004) {
      let sc = 0; for (let k = 0; k < nStr; k++) sc += at(prof, a + b * k);
      if (sc > bs) { bs = sc; ba = a; bb = b; }
    }
    const vs = []; for (let k = 0; k < nStr; k++) vs.push(ba + bb * k);
    const margin = (1 - bb * (nStr - 1)) / 2, offset = ba - margin;
    const pk = Math.max(1e-3, ...vs.map(v => Math.abs(at(prof, v))));
    const thick = vs.map(v => at(wide, v) / (Math.abs(at(prof, v)) + 0.15 * pk));
    const half = Math.floor(nStr / 2);
    const topT = thick.slice(0, half).reduce((a, b) => a + b, 0), botT = thick.slice(nStr - half).reduce((a, b) => a + b, 0);
    // 대비(줄이 실제로 보이는가): 줄 위치 평균 대비 / 줄 사이 평균
    let between = 0; for (let k = 0; k < nStr - 1; k++) between += at(prof, ba + bb * (k + 0.5));
    return { margin, offset, contrast: bs / nStr - between / (nStr - 1), topThicker: topT > botT, thickRatio: topT / Math.max(1e-6, botT), vs };
  }
  /** 줄 위치를 찾아 모서리의 위아래 어긋남을 바로잡음 → {pts, margin, topThicker} */
  function fitStrings(L, ptsN, masks, nStr) {
    const r = findStrings(L, ptsN, masks, nStr);
    if (!r || r.contrast < 2) return null;
    const m = modelOf(ptsN);
    const pts = CORNER_UV.map(([u, v]) => m.toImg(u, v + r.offset));
    return { pts, margin: r.margin, topThicker: r.topThicker, contrast: r.contrast };
  }

  /** 손 랜드마크로 줄 방향 판단: 왼손 손목·손바닥은 가는 줄(G) 쪽에 있음 */
  function lowOnTopFromHand(model, hand) {
    if (!hand || !hand.all || !model) return null;
    const wrist = model.toBoard(hand.all[0][0], hand.all[0][1]);
    const mcp = [5, 9, 13, 17].map(i => model.toBoard(hand.all[i][0], hand.all[i][1]));
    const v = (wrist[1] + mcp.reduce((a, p) => a + p[1], 0) / 4) / 2;
    if (v > 0.8) return true;      // 손바닥이 화면 아래쪽 → 아래가 가는 줄 → 위가 낮은 줄
    if (v < 0.2) return false;
    return null;
  }

  const NeckTrack = { fitStrings, autoFit, toGray, pyramid, lk, ransacH, solveHls, snap, snapScore, step, trackAll, findStrings, lowOnTopFromHand, cornersOf, modelOf, stringV };
  if (typeof module !== 'undefined' && module.exports) module.exports = NeckTrack; else root.NeckTrack = NeckTrack;
})(typeof self !== 'undefined' ? self : this);
