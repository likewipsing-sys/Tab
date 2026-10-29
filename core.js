/* BassCore — 베이스 분리 · 음정 추적 · 주법 감지 · 운지 배치 (브라우저/Node 공용) */
(function (root) {
  'use strict';

  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const yieldUI = () => new Promise(r => setTimeout(r, 0));
  // 오래 걸리는 루프 안에서 주기적으로 UI에 양보
  function makeYielder(progress, base, span) {
    let last = now();
    return async (frac) => {
      if (now() - last > 40) {
        last = now();
        if (progress) progress(base + span * Math.min(1, frac));
        await yieldUI();
      }
    };
  }

  // ------------------------------------------------------------ 필터
  function biquad(x, type, f0, sr, Q) {
    Q = Q || Math.SQRT1_2;
    const w0 = 2 * Math.PI * f0 / sr, c = Math.cos(w0), s = Math.sin(w0), a = s / (2 * Q);
    let b0, b1, b2;
    if (type === 'lp') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = (1 - c) / 2; }
    else { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = (1 + c) / 2; }
    const a0 = 1 + a, a1 = -2 * c / a0, a2 = (1 - a) / a0;
    b0 /= a0; b1 /= a0; b2 /= a0;
    const y = new Float32Array(x.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) {
      const xi = x[i];
      const yi = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = xi; y2 = y1; y1 = yi; y[i] = yi;
    }
    return y;
  }

  /** 스테레오 → 중앙(Mid) 채널, 저역 대역통과, 약 4kHz로 다운샘플 */
  function bandLimit(channels, sr, hp, lp) {
    const n = channels[0].length;
    let mid;
    if (channels.length > 1) {
      mid = new Float32Array(n);
      const L = channels[0], R = channels[1];
      for (let i = 0; i < n; i++) mid[i] = 0.5 * (L[i] + R[i]);
    } else mid = Float32Array.from(channels[0]);
    let x = mid;
    x = biquad(x, 'hp', hp, sr); x = biquad(x, 'hp', hp, sr);
    for (let k = 0; k < 4; k++) x = biquad(x, 'lp', lp, sr);
    const dec = Math.max(1, Math.floor(sr / 4000));
    const out = new Float32Array(Math.floor(n / dec));
    for (let i = 0; i < out.length; i++) out[i] = x[i * dec];
    // 어택·배음 측정용 넓은 대역 (30Hz~1.6kHz, 약 11kHz 샘플링)
    let w = biquad(mid, 'hp', 30, sr); w = biquad(w, 'lp', 1600, sr); w = biquad(w, 'lp', 1600, sr); w = biquad(w, 'lp', 1600, sr);
    const dec2 = Math.max(1, Math.floor(sr / 11000));
    const wide = new Float32Array(Math.floor(n / dec2));
    for (let i = 0; i < wide.length; i++) wide[i] = w[i * dec2];
    return { x: out, sr: sr / dec, mid, wide, sr2: sr / dec2 };
  }

  // ------------------------------------------------------------ FFT
  function fft(re, im, inverse) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = 2 * Math.PI / len * (inverse ? 1 : -1);
      const wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let j = 0; j < len / 2; j++) {
          const ar = re[i + j], ai = im[i + j];
          const br = re[i + j + len / 2] * cr - im[i + j + len / 2] * ci;
          const bi = re[i + j + len / 2] * ci + im[i + j + len / 2] * cr;
          re[i + j] = ar + br; im[i + j] = ai + bi;
          re[i + j + len / 2] = ar - br; im[i + j + len / 2] = ai - bi;
          const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
        }
      }
    }
    if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
  }

  function median(arr, a, b) {
    const t = Array.prototype.slice.call(arr, a, b).sort((p, q) => p - q);
    return t.length ? t[t.length >> 1] : 0;
  }

  /** 화성/타악 분리(HPSS) — 킥드럼 등 타악 성분을 저역에서 걷어냄 */
  async function hpss(x, opts, progress) {
    const n = 256, hop = 32, bins = n / 2 + 1, kt = 21, kf = 7;
    const frames = Math.max(1, Math.floor((x.length - n) / hop) + 1);
    const win = new Float32Array(n);
    for (let i = 0; i < n; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n);
    const RE = new Float32Array(frames * bins), IM = new Float32Array(frames * bins), MAG = new Float32Array(frames * bins);
    const re = new Float64Array(n), im = new Float64Array(n);
    const y = makeYielder(progress, 0, 0.4);
    for (let f = 0; f < frames; f++) {
      for (let i = 0; i < n; i++) { re[i] = (x[f * hop + i] || 0) * win[i]; im[i] = 0; }
      fft(re, im);
      for (let k = 0; k < bins; k++) {
        const o = f * bins + k;
        RE[o] = re[k]; IM[o] = im[k]; MAG[o] = Math.hypot(re[k], im[k]);
      }
      await y(f / frames);
    }
    // 시간축 중앙값(화성) / 주파수축 중앙값(타악)
    const H = new Float32Array(frames * bins), P = new Float32Array(frames * bins);
    const col = new Float32Array(frames);
    const y2 = makeYielder(progress, 0.4, 0.3);
    for (let k = 0; k < bins; k++) {
      for (let f = 0; f < frames; f++) col[f] = MAG[f * bins + k];
      for (let f = 0; f < frames; f++) H[f * bins + k] = median(col, Math.max(0, f - (kt >> 1)), Math.min(frames, f + (kt >> 1) + 1));
      await y2(k / bins);
    }
    const row = new Float32Array(bins);
    for (let f = 0; f < frames; f++) {
      for (let k = 0; k < bins; k++) row[k] = MAG[f * bins + k];
      for (let k = 0; k < bins; k++) P[f * bins + k] = median(row, Math.max(0, k - (kf >> 1)), Math.min(bins, k + (kf >> 1) + 1));
    }
    // 소프트 마스크 + 역STFT
    const harm = new Float32Array(x.length), perc = new Float32Array(x.length), wsum = new Float32Array(x.length);
    const hr = new Float64Array(n), hi = new Float64Array(n), pr = new Float64Array(n), pi = new Float64Array(n);
    const y3 = makeYielder(progress, 0.7, 0.3);
    for (let f = 0; f < frames; f++) {
      hr.fill(0); hi.fill(0); pr.fill(0); pi.fill(0);
      for (let k = 0; k < bins; k++) {
        const o = f * bins + k, h2 = H[o] * H[o], p2 = P[o] * P[o];
        const mh = h2 / (h2 + p2 + 1e-12), mp = 1 - mh;
        hr[k] = RE[o] * mh; hi[k] = IM[o] * mh; pr[k] = RE[o] * mp; pi[k] = IM[o] * mp;
        if (k > 0 && k < n / 2) {
          hr[n - k] = hr[k]; hi[n - k] = -hi[k]; pr[n - k] = pr[k]; pi[n - k] = -pi[k];
        }
      }
      fft(hr, hi, true); fft(pr, pi, true);
      for (let i = 0; i < n; i++) {
        const j = f * hop + i; if (j >= x.length) break;
        harm[j] += hr[i] * win[i]; perc[j] += pr[i] * win[i]; wsum[j] += win[i] * win[i];
      }
      await y3(f / frames);
    }
    for (let j = 0; j < x.length; j++) if (wsum[j] > 1e-6) { harm[j] /= wsum[j]; perc[j] /= wsum[j]; }
    return { harm, perc };
  }

  // ------------------------------------------------------------ 음정 추적 (YIN)
  async function yinTrack(x, sr, opts, progress) {
    const fmin = opts.fmin || 28, fmax = opts.fmax || 420;
    const hop = Math.max(8, Math.round(sr * 0.008));
    const tauMin = Math.max(2, Math.floor(sr / fmax)), tauMax = Math.ceil(sr / fmin);
    const W = tauMax;
    const frames = Math.max(0, Math.floor((x.length - W - tauMax - 2) / hop));
    const t = new Float32Array(frames), mc = new Float32Array(frames), conf = new Float32Array(frames), rms = new Float32Array(frames);
    const d = new Float64Array(tauMax + 2), cm = new Float64Array(tauMax + 2);
    const thr = opts.yinThr || 0.15;
    // 100ms 창 Goertzel (기본음 에너지 확인용)
    const GN = Math.round(sr * 0.1), gw = new Float32Array(GN);
    for (let i = 0; i < GN; i++) gw[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / GN);
    const gz = (sig, center, f) => {
      const w = 2 * Math.cos(2 * Math.PI * f / sr); let s1 = 0, s2 = 0; const a = Math.round(center - GN / 2);
      for (let j = 0; j < GN; j++) { const s0 = (sig[a + j] || 0) * gw[j] + w * s1 - s2; s2 = s1; s1 = s0; }
      return s1 * s1 + s2 * s2 - w * s1 * s2;
    };
    const yld = makeYielder(progress, 0, 1);
    for (let fi = 0; fi < frames; fi++) {
      const i0 = fi * hop;
      let e = 0;
      for (let j = 0; j < W; j++) e += x[i0 + j] * x[i0 + j];
      rms[fi] = Math.sqrt(e / W);
      t[fi] = (i0 + (W + tauMax) / 2) / sr;
      d[0] = 0;
      for (let tau = 1; tau <= tauMax + 1; tau++) {
        let s = 0;
        for (let j = 0; j < W; j++) { const df = x[i0 + j] - x[i0 + j + tau]; s += df * df; }
        d[tau] = s;
      }
      cm[0] = 1; let run = 0;
      for (let tau = 1; tau <= tauMax + 1; tau++) { run += d[tau]; cm[tau] = run > 0 ? d[tau] * tau / run : 1; }
      let best = -1;
      for (let tau = tauMin; tau <= tauMax; tau++) {
        if (cm[tau] < thr) { while (tau + 1 <= tauMax && cm[tau + 1] < cm[tau]) tau++; best = tau; break; }
      }
      if (best < 0) { let mv = 9; for (let tau = tauMin; tau <= tauMax; tau++) if (cm[tau] < mv) { mv = cm[tau]; best = tau; } }
      // 한 옥타브 위(주기 절반)에도 거의 같은 깊이의 골이 있으면 그쪽을 택함 (아래 옥타브 오류 방지)
      for (let guard = 0; guard < 2; guard++) {
        const h = best / 2; if (h < tauMin + 1) break;
        let hb = -1, hv = 9;
        for (let tau = Math.max(tauMin, Math.floor(h * 0.94)); tau <= Math.ceil(h * 1.06); tau++) if (cm[tau] < hv) { hv = cm[tau]; hb = tau; }
        if (hb > 0 && hv < Math.max(opts.octThr || 0.3, cm[best] + (opts.octDelta || 0.12))) best = hb; else break;
      }
      // 기본음 자리에 실제 에너지가 없으면(화음이 만든 가짜 저음) 한 옥타브 위를 택함
      if (opts.fundCheck !== false && best / 2 >= tauMin + 1) {
        const f = sr / best, c = i0 + (W + tauMax) / 2;
        const e1 = gz(x, c, f), e2 = gz(x, c, 2 * f);
        // 홀수 배음(3f, 5f)이 없으면 진짜 음높이는 2f (킥 여운·화음이 만든 가짜 저음)
        let oddLow = false;
        if (3 * f < 310) { const e3 = gz(x, c, 3 * f), e4 = 4 * f < 420 ? gz(x, c, 4 * f) : 0, e5 = 5 * f < 330 ? gz(x, c, 5 * f) : 0; oddLow = (e3 + e5) < (e2 + e4) * (opts.oddRatio || 0.05); }
        if (opts.dbgFund) opts.dbgFund(c / sr, f, e1, e2, oddLow);
        if (e1 < e2 * (opts.fundRatio || 0.04) || oddLow) {
          let hb = -1, hv = 9; const h = best / 2;
          for (let tau = Math.max(tauMin, Math.floor(h * 0.94)); tau <= Math.ceil(h * 1.06); tau++) if (cm[tau] < hv) { hv = cm[tau]; hb = tau; }
          if (hb > 0 && hv < 0.6) best = hb;
        }
      }
      let tb = best;
      if (best > 1 && best < tauMax + 1) {
        const a = cm[best - 1], b = cm[best], c = cm[best + 1], den = a - 2 * b + c;
        if (den > 0) tb = best + 0.5 * (a - c) / den;
      }
      conf[fi] = Math.max(0, 1 - cm[best]);
      const f0 = sr / tb;
      mc[fi] = 69 + 12 * Math.log2(f0 / 440);
      if ((fi & 255) === 0) await yld(fi / frames);
    }
    return { t, mc, conf, rms, hop: hop / sr, smear: (W + tauMax) / sr };
  }

  // ------------------------------------------------------------ 배음 합산(살리언스) 음정 추적 — 혼합 음원에서 YIN보다 견고
  async function salTrack(x, sr, opts, progress) {
    const hopS = 0.008, hop = Math.round(sr * hopS);
    const WN = opts.salWin || 1024, NF = 4096, half = NF / 2;
    const lo = opts.lowestMidi ? opts.lowestMidi - 2 : 26, hi = opts.highMidi || 68, STEP = 0.1;
    const nb = Math.round((hi - lo) / STEP) + 1;
    const H = opts.salH || 10, alpha = opts.salAlpha || 0.65;
    const win = new Float32Array(WN); for (let i = 0; i < WN; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / WN);
    const frames = Math.max(0, Math.floor((x.length - WN) / hop));
    const t = new Float32Array(frames), rms = new Float32Array(frames);
    // 후보 음높이별 배음 위치(빈 단위)
    const binHz = sr / NF;
    const hb = new Float32Array(nb * H), hw = new Float32Array(H);
    for (let h = 0; h < H; h++) hw[h] = Math.pow(alpha, h);
    for (let b = 0; b < nb; b++) { const f0 = 440 * Math.pow(2, (lo + b * STEP - 69) / 12); for (let h = 0; h < H; h++) { const f = f0 * (h + 1); hb[b * H + h] = f < sr / 2.3 && f < 1500 ? f / binHz : -1; } }
    const re = new Float64Array(NF), im = new Float64Array(NF), mag = new Float32Array(half);
    const multi = opts.salMulti ?? 0.6;         // 짧은 창(빠른 음) 살리언스 가중치
    const WS = Math.round(WN / 2), winS = new Float32Array(WS); for (let i = 0; i < WS; i++) winS[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / WS);
    const K = 6;
    const candB = new Int16Array(frames * K).fill(-1), candS = new Float32Array(frames * K);
    const sal = new Float32Array(nb);
    const yld = makeYielder(progress, 0, 0.85);
    const lin = (k) => { const i = Math.floor(k), f = k - i; return mag[i] * (1 - f) + mag[i + 1] * f; };
    const addSal = (w, scale) => {
      for (let b = 0; b < nb; b++) {
        let s = 0; const o = b * H;
        for (let h = 0; h < H; h++) { const k = hb[o + h]; if (k < 0) break; s += hw[h] * lin(k); }
        sal[b] += s * scale;
      }
    };
    for (let fi = 0; fi < frames; fi++) {
      const i0 = fi * hop;
      let e = 0;
      for (let i = 0; i < WN; i++) { const v = x[i0 + i]; e += v * v; re[i] = v * win[i]; im[i] = 0; }
      for (let i = WN; i < NF; i++) { re[i] = 0; im[i] = 0; }
      rms[fi] = Math.sqrt(e / WN); t[fi] = (i0 + WN / 2) / sr;
      fft(re, im);
      for (let k = 0; k < half; k++) mag[k] = Math.sqrt(Math.hypot(re[k], im[k]));   // 압축된 크기
      sal.fill(0); addSal(win, 1);
      if (multi) {
        const off = i0 + ((WN - WS) >> 1);
        for (let i = 0; i < NF; i++) { re[i] = i < WS ? x[off + i] * winS[i] : 0; im[i] = 0; }
        fft(re, im);
        for (let k = 0; k < half; k++) mag[k] = Math.sqrt(Math.hypot(re[k], im[k]));
        addSal(winS, multi * Math.SQRT2);
      }
      // 국소 최대값 상위 K개
      for (let b = 1; b < nb - 1; b++) {
        const v = sal[b]; if (!(v > sal[b - 1] && v >= sal[b + 1])) continue;
        let m = -1, mv = Infinity;
        for (let q = 0; q < K; q++) { const cv = candB[fi * K + q] < 0 ? -1 : candS[fi * K + q]; if (cv < mv) { mv = cv; m = q; } }
        if (v > mv) { candB[fi * K + m] = b; candS[fi * K + m] = v; }
      }
      if ((fi & 127) === 0) await yld(fi / frames);
    }
    // 곡 전체 기준 정규화
    const all = []; for (let i = 0; i < frames * K; i++) if (candB[i] >= 0) all.push(candS[i]);
    all.sort((a, b) => a - b);
    const ref = all[Math.floor(all.length * 0.98)] || 1;
    // 비터비: 후보 사이 이동 비용
    const jumpCost = opts.salJump || 0.35, glideCost = 0.04;
    const cost = new Float32Array(frames * K).fill(Infinity), back = new Int8Array(frames * K).fill(-1);
    const nodeCost = (i) => candB[i] < 0 ? Infinity : -Math.log(Math.max(1e-4, candS[i] / ref));
    for (let q = 0; q < K; q++) cost[q] = nodeCost(q);
    for (let fi = 1; fi < frames; fi++) {
      for (let q = 0; q < K; q++) {
        const i = fi * K + q; if (candB[i] < 0) continue;
        const nc = nodeCost(i); let best = Infinity, bj = -1;
        for (let r = 0; r < K; r++) {
          const j = (fi - 1) * K + r; if (candB[j] < 0 || cost[j] === Infinity) continue;
          const d = Math.abs(candB[i] - candB[j]) * STEP;
          const tc = d <= 0.25 ? 0 : d <= 3 ? glideCost * d : jumpCost;
          const v = cost[j] + tc; if (v < best) { best = v; bj = r; }
        }
        cost[i] = (bj < 0 ? 5 : best) + nc; back[i] = bj;
        if (bj < 0) cost[i] = nc + 5;
      }
      // 수치 안정: 프레임별 최소값 빼기
      let m = Infinity; for (let q = 0; q < K; q++) m = Math.min(m, cost[fi * K + q]);
      if (m < Infinity) for (let q = 0; q < K; q++) cost[fi * K + q] -= m;
    }
    const mc = new Float32Array(frames), conf = new Float32Array(frames);
    let q = 0, bv = Infinity; for (let r = 0; r < K; r++) if (cost[(frames - 1) * K + r] < bv) { bv = cost[(frames - 1) * K + r]; q = r; }
    for (let fi = frames - 1; fi >= 0; fi--) {
      const i = fi * K + q;
      if (candB[i] >= 0) { mc[fi] = lo + candB[i] * STEP; conf[fi] = Math.min(1, candS[i] / ref); }
      else { mc[fi] = 0; conf[fi] = 0; }
      const bq = back[i]; if (fi > 0) q = bq >= 0 ? bq : 0;
    }
    if (progress) progress(1);
    return { t, mc, conf, rms, hop: hopS, smear: WN / sr * 0.6, salRef: ref };
  }

  /** YIN(정밀한 음높이) + 살리언스(옥타브·잡음에 강함) 결합 */
  function fuseTracks(yin, sal, opts) {
    const n = yin.t.length, out = { t: yin.t, mc: new Float32Array(n), conf: new Float32Array(n), rms: yin.rms, hop: yin.hop, smear: Math.max(yin.smear, sal.smear * 0.7) };
    let j = 0;
    for (let i = 0; i < n; i++) {
      while (j + 1 < sal.t.length && sal.t[j + 1] <= yin.t[i]) j++;
      const sm = sal.mc[j], sc = sal.conf[j];
      const ym = yin.mc[i], yc = yin.conf[i];
      if (sm && Math.abs(ym - sm) < 0.7 && yc > 0.3) { out.mc[i] = ym; out.conf[i] = Math.max(yc, 0.6 + 0.4 * sc); }
      else if (sm && sc >= (opts.salVoice || 0.18)) { out.mc[i] = sm; out.conf[i] = 0.5 + 0.5 * Math.min(1, sc / 0.6); }
      else { out.mc[i] = ym; out.conf[i] = yc * 0.6; }
    }
    return out;
  }

  /** 하모닉 성분의 에너지 상승(dB) — 피킹 어택 강도 */
  function attackCurve(harm, sr, track, perc) {
    const n = track.t.length, win = Math.round(sr * 0.02);
    const eDb = new Float32Array(n), att = new Float32Array(n), pDb = new Float32Array(n), tDb = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const c = Math.round(track.t[i] * sr - win / 2);
      let e = 0, ep = 0;
      let et = 0;
      for (let j = 0; j < win; j++) { const v = harm[c + j] || 0; e += v * v; const w = perc ? perc[c + j] || 0 : 0; ep += w * w; et += (v + w) * (v + w); }
      eDb[i] = 10 * Math.log10(e / win + 1e-10);
      pDb[i] = 10 * Math.log10(ep / win + 1e-10);
      tDb[i] = 10 * Math.log10(et / win + 1e-10);
    }
    for (let i = 6; i < n; i++) {
      let m = eDb[i - 1], mt = tDb[i - 1];
      for (let k = 2; k <= 6; k++) { m = Math.min(m, eDb[i - k]); mt = Math.min(mt, tDb[i - k]); }
      // 화성 성분 상승 + (현 잡음 같은) 짧은 트랜지언트의 상승 중 큰 값
      att[i] = Math.max(0, eDb[i] - m, perc ? tDb[i] - mt : 0);
    }
    return { eDb, att, pDb, tDb };
  }

  function peaks(arr, thr, minGap) {
    const out = [];
    for (let i = 1; i < arr.length - 1; i++) {
      if (arr[i] >= thr && arr[i] >= arr[i - 1] && arr[i] > arr[i + 1]) {
        if (out.length && i - out[out.length - 1] < minGap) {
          if (arr[i] > arr[out[out.length - 1]]) out[out.length - 1] = i;
        } else out.push(i);
      }
    }
    return out;
  }

  // ------------------------------------------------------------ 음표 분할
  function segment(track, curve, opts) {
    const { t, mc, conf, rms } = track, n = t.length, dt = track.hop;
    const sortedRms = Array.from(rms).sort((a, b) => a - b);
    const rmsMax = sortedRms[Math.floor(n * 0.995)] || 1e-9;
    const rmsThr = Math.max(sortedRms[Math.floor(n * 0.15)] || 0, rmsMax * (opts.gate || 0.1));
    const ok = new Uint8Array(n);
    for (let i = 0; i < n; i++) ok[i] = conf[i] >= (opts.conf || 0.55) && rms[i] >= rmsThr && mc[i] > 15 && mc[i] < 80 ? 1 : 0;
    // 1프레임짜리 구멍 메우기
    for (let i = 1; i < n - 1; i++) if (!ok[i] && ok[i - 1] && ok[i + 1] && Math.abs(mc[i - 1] - mc[i + 1]) < 0.6) { ok[i] = 1; mc[i] = (mc[i - 1] + mc[i + 1]) / 2; }

    // 킥드럼 구간: 타악 성분이 화성 성분보다 훨씬 큰 순간 이후 ~110ms
    const kick = new Uint8Array(n);
    if (curve.pDb && opts.kickGuard !== false) {
      const ps = Array.from(curve.pDb).sort((a, b) => a - b), pHi = ps[Math.floor(n * 0.6)];
      const zone = Math.round(0.16 / dt);
      for (let i = 1; i < n; i++) {
        if (curve.pDb[i] - curve.eDb[i] > 6 && curve.pDb[i] > pHi && !(curve.pDb[i - 1] - curve.eDb[i - 1] > 6)) {
          for (let k = Math.max(0, i - 1); k < Math.min(n, i + zone); k++) kick[k] = 1;
        }
      }
      // 킥 구간 앞뒤 음정이 같으면 구간을 이어 붙임 (킥이 음정을 흔드는 것 방지)
      for (let i = 0; i < n; i++) {
        if (!kick[i] || (i > 0 && kick[i - 1])) continue;
        let j = i; while (j < n && kick[j]) j++;
        const a = i - 2, b = j + 2;
        if (a >= 0 && b < n && ok[a] && ok[b] && Math.abs(mc[a] - mc[b]) < 0.5) {
          for (let k = a; k <= b; k++) { mc[k] = mc[a] + (mc[b] - mc[a]) * (k - a) / (b - a); ok[k] = 1; }
        } else if (b < n) {
          // 앞/뒤 어느 음과도 맞지 않는 프레임은 신뢰하지 않음
          const pre = a >= 0 && ok[a] ? mc[a] : null, post = ok[b] ? mc[b] : null;
          for (let k = i; k < j; k++) {
            const nearPre = pre != null && Math.abs(mc[k] - pre) < 0.5, nearPost = post != null && Math.abs(mc[k] - post) < 0.5;
            if (!nearPre && !nearPost) ok[k] = 0;
          }
        }
      }
    }

    // 피킹 판별 기준 (곡마다 적응)
    const minGap = Math.round(0.05 / dt);
    const allPk = peaks(curve.att, 1.5, minGap).filter(i => !kick[i]);
    const starts = allPk.filter(i => i > 6 && !ok[i - 5] && !ok[i - 6]).map(i => curve.att[i]).sort((a, b) => a - b);
    const typical = starts.length ? starts[starts.length >> 1] : 8;
    const sens = opts.sensitivity == null ? 0.5 : opts.sensitivity; // 0~1, 높을수록 레가토로 판정
    const pickThr = Math.min(4, Math.max(2.2, typical * 0.3)) * (0.7 + 0.6 * sens);
    const attPk = peaks(curve.att, pickThr, minGap);
    const isAttack = new Uint8Array(n); attPk.forEach(i => { isAttack[i] = 1; });

    // 세그먼트용 음높이: 5프레임 중앙값으로 잡음 완화
    const ms = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const w = []; for (let k = Math.max(0, i - 2); k <= Math.min(n - 1, i + 2); k++) if (ok[k]) w.push(mc[k]);
      w.sort((a, b) => a - b); ms[i] = w.length ? w[w.length >> 1] : mc[i];
    }
    const segs = [];
    let cur = null;
    const close = (end) => { if (cur) { cur.i1 = end; segs.push(cur); cur = null; } };
    for (let i = 0; i < n; i++) {
      if (!ok[i]) { close(i); continue; }
      const r = Math.round(ms[i]);
      if (!cur) { cur = { i0: i, ref: ms[i] }; continue; }
      const dur = i - cur.i0;
      const ref = dur < 3 ? ms[i - 1] : cur.ref;
      if (Math.abs(ms[i] - ref) > 0.7) { close(i); cur = { i0: i, ref: ms[i] }; continue; }
      // 같은 음 재피킹
      if (dur * dt > 0.07 && isAttack[i] && i + 4 < n) {
        const look = Math.round(0.08 / dt);
        let pre = -999, dip = 999;
        for (let k = Math.max(cur.i0, i - 2 * look); k < i - look; k++) pre = Math.max(pre, curve.eDb[k]);
        for (let k = i - look; k <= i; k++) dip = Math.min(dip, curve.eDb[k]);
        if (!kick[i] && (pre - dip >= 1.5 || curve.att[i] >= 1.1 * pickThr)) { close(i); cur = { i0: i, ref: ms[i] }; continue; }
      }
      if (dur < 6) cur.ref = (cur.ref * dur + ms[i]) / (dur + 1);
    }
    close(n);

    const notes = [];
    for (const s of segs) {
      const dur = (s.i1 - s.i0) * dt;
      const a = s.i0 + Math.floor((s.i1 - s.i0) * 0.2), b = Math.max(a + 1, s.i1 - Math.floor((s.i1 - s.i0) * 0.2));
      const pitch = Math.round(median(ms, a, b));
      let c = 0; for (let i = s.i0; i < s.i1; i++) c += conf[i];
      notes.push({ i0: s.i0, i1: s.i1, start: t[s.i0], end: t[Math.min(n - 1, s.i1)], dur, midi: pitch, conf: c / (s.i1 - s.i0) });
    }
    const minDur = opts.minNote || 0.045;
    const kept = notes.filter(nt => nt.dur >= minDur && (nt.conf >= (opts.minConfShort || 0.88) || nt.dur >= 0.12));
    // 붙어 있는 같은 음 합치기 (사이에 어택이 없을 때)
    const merged = [];
    for (const nt of kept) {
      const p = merged[merged.length - 1];
      if (p && p.midi === nt.midi && nt.i0 - p.i1 <= 3) {
        let att = false; for (let i = Math.max(0, nt.i0 - 2); i <= Math.min(n - 1, nt.i0 + 3); i++) if (isAttack[i]) att = true;
        if (!att) { p.i1 = nt.i1; p.end = nt.end; p.dur = p.end - p.start; continue; }
      }
      merged.push(nt);
    }
    return { notes: merged, ok, isAttack, attPk, pickThr, kick };
  }


  // ------------------------------------------------------------ 베이스 배음 에너지 (음높이에 맞춘 좁은 대역)
  function partialEnergies(x, sr, times, pa) {
    const n = times.length;
    const lo = new Float32Array(n), hi = new Float32Array(n), h1 = new Float32Array(n);
    const NL = Math.round(0.046 * sr), NH = Math.round(0.024 * sr);
    const wl = new Float32Array(NL), wh = new Float32Array(NH);
    for (let i = 0; i < NL; i++) wl[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / NL);
    for (let i = 0; i < NH; i++) wh[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / NH);
    const g = (c, N, win, f) => {
      const w = 2 * Math.cos(2 * Math.PI * f / sr); let s1 = 0, s2 = 0; const a = c - (N >> 1);
      for (let j = 0; j < N; j++) { const v = x[a + j] || 0; const s0 = v * win[j] + w * s1 - s2; s2 = s1; s1 = s0; }
      return (s1 * s1 + s2 * s2 - w * s1 * s2) / (N * N);
    };
    for (let i = 0; i < n; i++) {
      const m = pa[i];
      if (!(m > 0)) { lo[i] = hi[i] = h1[i] = -120; continue; }
      const f0 = 440 * Math.pow(2, (m - 69) / 12), c = Math.round(times[i] * sr);
      let el = 1e-12, eh = 1e-12;
      const e1 = g(c, NL, wl, f0);
      for (let h = 1; h <= 4; h++) { const f = h * f0; if (f < 65 && h === 1) continue; if (f > sr / 2.3) break; el += h === 1 ? e1 : g(c, NL, wl, f); }
      for (let h = 2; h <= 12; h++) { const f = h * f0; if (f < 100) continue; if (f > 1500) break; eh += g(c, NH, wh, f); }
      lo[i] = 10 * Math.log10(el); hi[i] = 10 * Math.log10(eh); h1[i] = 10 * Math.log10(e1 + 1e-12);
    }
    return { lo, hi, h1 };
  }



  // 특정 시각·주파수의 에너지 (100ms 한 창)
  function gzAt(x, sr, time, f) {
    const N = Math.round(sr * 0.1), a = Math.round(time * sr - N / 2), w = 2 * Math.cos(2 * Math.PI * f / sr);
    let s1 = 0, s2 = 0;
    for (let j = 0; j < N; j++) { const s0 = (x[a + j] || 0) * (0.5 - 0.5 * Math.cos(2 * Math.PI * j / N)) + w * s1 - s2; s2 = s1; s1 = s0; }
    return s1 * s1 + s2 * s2 - w * s1 * s2;
  }

  function octaveCheck(note, x, sr) {
    const a = note.start + Math.min(0.03, note.dur * 0.2), b = Math.min(note.end - 0.01, a + 0.25);
    const N = Math.round((b - a) * sr); if (N < sr * 0.04) return;
    const c0 = Math.round(a * sr);
    const win = new Float32Array(N); for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
    const E = f => { if (f > sr / 2.3) return 0; const w = 2 * Math.cos(2 * Math.PI * f / sr); let s1 = 0, s2 = 0; for (let j = 0; j < N; j++) { const s0 = (x[c0 + j] || 0) * win[j] + w * s1 - s2; s2 = s1; s1 = s0; } return (s1 * s1 + s2 * s2 - w * s1 * s2) / (N * N); };
    const f0 = 440 * Math.pow(2, (note.midi - 69) / 12);
    const odd = E(f0) + E(3 * f0) + E(5 * f0), even = E(2 * f0) + E(4 * f0) + E(6 * f0);
    note.oddEven = 10 * Math.log10((odd + 1e-14) / (even + 1e-14));
    if (odd < even * 0.06 && note.midi + 12 <= 72) { note.midi += 12; note.octFix = 1; return; }
    // 한 옥타브 아래가 진짜 기본음인지 (기본음이 약하게 녹음된 경우)
    const sub = E(f0 / 2), sub3 = E(1.5 * f0), main = E(f0) + E(2 * f0);
    note.sub = 10 * Math.log10((sub + sub3 + 1e-14) / (main + 1e-14));
    if (sub > main * 0.04 && sub3 > main * 0.04 && note.midi - 12 >= 23) { note.midi -= 12; note.octFix = -1; }
  }

  // ------------------------------------------------------------ 음표 분할 v2: 음높이 구간 + 배음 어택으로 시작점/재피킹 판정
  function segment2(track, curve, ctx, opts) {
    const { t, mc, conf, rms } = track, n = t.length, dt = track.hop;
    const F = s => Math.max(1, Math.round(s / dt));
    const sortedRms = Array.from(rms).sort((a, b) => a - b);
    const rmsMax = sortedRms[Math.floor(n * 0.995)] || 1e-9;
    const rmsThr = Math.max(sortedRms[Math.floor(n * 0.15)] || 0, rmsMax * (opts.gate || 0.06));
    const ok = new Uint8Array(n);
    for (let i = 0; i < n; i++) ok[i] = conf[i] >= (opts.conf || 0.55) && rms[i] >= rmsThr && mc[i] > 15 && mc[i] < 80 ? 1 : 0;
    for (let i = 1; i < n - 1; i++) if (!ok[i] && ok[i - 1] && ok[i + 1] && Math.abs(mc[i - 1] - mc[i + 1]) < 0.6) { ok[i] = 1; mc[i] = (mc[i - 1] + mc[i + 1]) / 2; }

    // 킥드럼 구간
    const kick = new Uint8Array(n), kickStart = new Uint8Array(n);
    if (curve.pDb && opts.kickGuard !== false) {
      const ps = Array.from(curve.pDb).sort((a, b) => a - b), pHi = ps[Math.floor(n * 0.6)];
      const zone = F(0.16);
      let last = -999;
      for (let i = 4; i < n; i++) {
        // 타악 성분이 화성보다 크게 튀거나, 타악 성분이 짧은 시간에 크게 솟을 때 = 킥
        let pm = curve.pDb[i - 1]; for (let q = 2; q <= 4; q++) pm = Math.min(pm, curve.pDb[i - q]);
        const ratio = curve.pDb[i] - curve.eDb[i] > 6 && !(curve.pDb[i - 1] - curve.eDb[i - 1] > 6);
        const rise = curve.pDb[i] - pm >= (opts.kickRise || 14) && curve.pDb[i] > pHi;
        if ((ratio && curve.pDb[i] > pHi) || rise) {
          if (i - last < F(0.06)) continue;
          last = i; kickStart[i] = 1;
          for (let k = Math.max(0, i - 1); k < Math.min(n, i + zone); k++) kick[k] = 1;
        }
      }
    }
    // 킥 여운(40~68Hz의 빨리 사라지는 순음) 제거: 킥 뒤 250ms 동안의 저음 프레임이
    // 킥 여운이 사라진 뒤(250~350ms)의 음높이와 다르면 킥 소리로 봄
    const kickOf = new Int32Array(n).fill(-1);
    for (let k = 0; k < n; k++) {
      if (!kickStart[k]) continue;
      const vals = []; for (let i = k + F(0.24); i < Math.min(n, k + F(0.34)); i++) if (ok[i]) vals.push(mc[i]);
      vals.sort((a, b) => a - b);
      const P = vals.length >= 3 ? vals[vals.length >> 1] : null;
      for (let i = k; i < Math.min(n, k + F(0.26)); i++) {
        kickOf[i] = k;
        if (!ok[i]) continue;
        const f = 440 * Math.pow(2, (mc[i] - 69) / 12);
        if (f < (opts.kickTailHz || 68) && (P == null || Math.abs(mc[i] - P) > 0.5)) {
          // 이 주파수의 에너지가 120ms 뒤 크게 줄면 킥 여운
          const e0 = gzAt(ctx.x, ctx.sr, t[i], f), e1 = gzAt(ctx.x, ctx.sr, t[i] + 0.12, f);
          if (10 * Math.log10((e0 + 1e-14) / (e1 + 1e-14)) >= (opts.tailDrop || 8)) ok[i] = 0;
        }
      }
    }
    // 킥 구간 안에서 앞뒤 음과 맞지 않는 음높이(킥의 미끄러지는 저음)는 버림
    for (let i = 0; i < n; i++) {
      if (!kick[i] || (i > 0 && kick[i - 1])) continue;
      let j = i; while (j < n && kick[j]) j++;
      let pre = null; for (let k = i - 1; k >= Math.max(0, i - F(0.05)); k--) if (ok[k]) { pre = mc[k]; break; }
      let post = null; for (let k = j; k < Math.min(n, j + F(0.08)); k++) if (ok[k]) { post = mc[k]; break; }
      for (let k = i; k < j; k++) {
        if (!ok[k]) continue;
        const nearPre = pre != null && Math.abs(mc[k] - pre) < 0.5, nearPost = post != null && Math.abs(mc[k] - post) < 0.5;
        if (!nearPre && !nearPost) ok[k] = 0;
      }
    }
    // 매끈한 음높이
    const ms = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const w = []; for (let k = Math.max(0, i - 2); k <= Math.min(n - 1, i + 2); k++) if (ok[k]) w.push(mc[k]);
      w.sort((a, b) => a - b); ms[i] = w.length ? w[w.length >> 1] : mc[i];
    }
    // 음높이 구간(run): 끊김·킥 구간을 넘어 같은 음이면 이어 붙임
    const runs = [];
    {
      let cur = null, gap = 0, gapStart = -1;
      const close = () => { if (cur) { runs.push(cur); cur = null; } };
      for (let i = 0; i < n; i++) {
        if (!ok[i]) {
          if (cur) { if (gap === 0) gapStart = i; gap++; const lim = kick[i] ? F(0.2) : F(0.05); if (gap > lim) { cur.b = gapStart; close(); } }
          continue;
        }
        if (cur && Math.abs(ms[i] - cur.ref) > 0.7) {
          const d = cur.n < 3 ? Math.abs(ms[i] - ms[i - 1]) : 9;
          if (d > 0.7) { cur.b = gap ? gapStart : i; close(); }
        }
        if (!cur) { cur = { a: i, b: i + 1, ref: ms[i], n: 1, gaps: [] }; gap = 0; continue; }
        if (gap) { cur.gaps.push([gapStart, i]); gap = 0; }
        cur.b = i + 1; cur.n++;
        if (cur.n < 8) cur.ref = (cur.ref * (cur.n - 1) + ms[i]) / cur.n;
      }
      if (cur) close();
    }
    // 각 프레임에서 잴 음높이: 구간 음높이 (구간 바로 앞 140ms는 그 구간 음높이로 채움)
    const pa = new Float32Array(n);
    runs.forEach(r => { for (let i = r.a; i < r.b; i++) pa[i] = ok[i] ? ms[i] : r.ref; });
    runs.forEach(r => { for (let i = Math.max(0, r.a - F(0.14)); i < r.a; i++) if (!pa[i]) pa[i] = r.ref; });
    for (let i = 1; i < n; i++) if (!pa[i] && pa[i - 1] && i - 1 >= 0) { let k = i; while (k < n && !pa[k] && k - i < F(0.1)) { pa[k] = pa[i - 1]; k++; } i = k; }
    const PE = partialEnergies(ctx.wide, ctx.sr2, t, pa);
    // 어택 세기: 높은 배음이 짧은 시간에 올라간 양
    const hiS = new Float32Array(n);
    for (let i = 1; i < n - 1; i++) hiS[i] = (PE.hi[i - 1] + PE.hi[i] + PE.hi[i + 1]) / 3;
    const OS = new Float32Array(n);
    for (let i = 4; i < n; i++) { let m = hiS[i - 1]; for (let k = 2; k <= 4; k++) m = Math.min(m, hiS[i - k]); OS[i] = Math.max(0, hiS[i] - m); }
    const mean = (arr, a, b) => { let s = 0, c = 0; for (let i = Math.max(0, a); i < Math.min(n, b); i++) { s += arr[i]; c++; } return c ? s / c : -120; };
    const persist = (k, arr) => mean(arr, k + 3, k + F(0.075)) - mean(arr, k - F(0.05), k - 1);

    const osThr = opts.osThr || 4, pThr = opts.pThr || 1.5;
    const notes = [];
    const strength = [];
    // 짧게 미끄러져 들어오는 조각(슬라이드 인)은 다음 음에 합침
    for (let q = 0; q < runs.length - 1; q++) {
      const X = runs[q], Y = runs[q + 1];
      if ((X.b - X.a) * dt < 0.09 && Y.a - X.b <= 3 && Math.abs(Y.ref - X.ref) <= 4.5 && (Y.b - Y.a) > (X.b - X.a)) {
        Y.slideFrom = X.ref; Y.a0 = X.a; runs.splice(q, 1); q--;
      }
    }
    let prevEnd = 0;
    for (const r of runs) {
      // 시작점 앞당기기: 구간 시작 전 120ms 안에서 가장 큰 어택 (앞 구간 끝보다 앞으로는 못 감)
      let a = r.a, bestOS = 0, bestK = -1;
      let lim = Math.max(1, prevEnd, (r.a0 != null ? r.a0 : r.a) - F(0.12));
      // 킥 여운 때문에 늦게 잡힌 음은 킥 시점까지 앞당길 수 있음
      if (kickOf[r.a] >= 0 && kickOf[r.a] >= prevEnd) lim = Math.max(1, Math.min(lim, kickOf[r.a] - 2));
      prevEnd = r.b;
      for (let k = lim; k <= Math.min(n - 1, r.a + 2); k++) if (OS[k] > bestOS) { bestOS = OS[k]; bestK = k; }
      if (bestK >= 0 && bestOS >= osThr * 0.6) { let k = bestK; while (k > lim && hiS[k - 1] < hiS[k] - 0.3 && bestK - k < F(0.04)) k--; a = Math.min(a, k); }
      if (r.a0 != null) a = Math.min(a, r.a0);
      // 구간 안 재피킹
      const cuts = [a];
      const minGap = F(0.07);
      for (let k = r.a + 2; k < r.b - 3; k++) {
        if (k - cuts[cuts.length - 1] < minGap) continue;
        const isPk = OS[k] >= OS[k - 1] && OS[k] > OS[k + 1];
        const inGap = r.gaps.some(([g0, g1]) => k >= g0 - 2 && k <= g1 + 2);
        let cut = false;
        if (isPk && OS[k] >= osThr && persist(k, PE.hi) >= pThr && persist(k, PE.lo) >= pThr * 0.4) {
          // 킥과 겹친 어택은 킥 여운이 지난 뒤에도 소리가 커져 있어야 재피킹으로 인정
          if (!kick[k]) cut = true;
          else if (k + F(0.16) < r.b && mean(PE.hi, k + F(0.1), k + F(0.16)) - mean(PE.hi, k - F(0.05), k - 1) >= pThr + 1) cut = true;
          else if (k + F(0.16) >= r.b && persist(k, PE.hi) >= pThr + 4) cut = true;
        }
        if (!cut && inGap) {
          // 소리가 잠깐 끊겼다가 다시 시작 (뮤트 후 재피킹)
          const before = Math.max(...Array.from(PE.lo.slice(Math.max(r.a, k - F(0.15)), k - 2)).concat([-120]));
          let dip = 999; for (let q = k - 3; q <= k; q++) dip = Math.min(dip, PE.lo[q]);
          if (isPk && OS[k] >= osThr * 0.5 && before - dip >= 6) cut = true;
        }
        if (cut) { let q = k; while (q > cuts[cuts.length - 1] + 2 && hiS[q - 1] < hiS[q] - 0.3 && k - q < F(0.03)) q--; cuts.push(q); }
      }
      cuts.push(r.b);
      for (let c = 0; c < cuts.length - 1; c++) {
        const i0 = cuts[c], i1 = cuts[c + 1];
        const vs = []; for (let i = Math.max(i0, r.a); i < i1; i++) if (ok[i]) vs.push(ms[i]);
        if (!vs.length) continue;
        vs.sort((x, y) => x - y);
        const q0 = Math.floor(vs.length * 0.2), q1 = Math.max(q0 + 1, Math.ceil(vs.length * 0.8));
        const pitch = Math.round(vs.slice(q0, q1)[(q1 - q0) >> 1]);
        let cs = 0, cn = 0; for (let i = Math.max(i0, r.a); i < i1; i++) if (ok[i]) { cs += conf[i]; cn++; }
        let pk = 0; for (let k = Math.max(1, i0 - 2); k <= Math.min(n - 1, i0 + 4); k++) pk = Math.max(pk, OS[k]);
        // 배음 비율 (킥 꼬리는 거의 순음)
        const harmon = mean(PE.hi, i0, i1) - mean(PE.h1, i0, i1);
        // 음이 바뀌는 순간 앞뒤 배음 크기 차이 (피킹이면 커지고, 해머링·풀링이면 거의 그대로)
        const jump = mean(PE.hi, i0 + 2, i0 + F(0.06)) - mean(PE.hi, i0 - F(0.06), i0 - 1);
        const jumpLo = mean(PE.lo, i0 + 2, i0 + F(0.06)) - mean(PE.lo, i0 - F(0.06), i0 - 1);
        let tr = 0; if (curve.tDb) for (let k = Math.max(4, i0 - 2); k <= Math.min(n - 1, i0 + 3); k++) { let m = curve.tDb[k - 1]; for (let q = 2; q <= 4; q++) m = Math.min(m, curve.tDb[k - q]); tr = Math.max(tr, curve.tDb[k] - m); }
        notes.push({ i0, i1, start: t[i0] + (opts.onsetShift ?? 0.01), end: t[Math.min(n - 1, i1)], dur: (i1 - i0) * dt, midi: pitch, conf: cs / cn, pluck: pk, jump, jumpLo, tr, harmon, slideFrom: c === 0 && r.slideFrom != null ? r.slideFrom : null, inKick: kick[i0] || kick[Math.min(n - 1, i0 + 2)] });
      }
    }
    // 킥 꼬리 제거: 킥과 함께 시작한 짧은 순음
    const hs = notes.map(x => x.harmon).sort((a, b) => a - b), hMed = hs.length ? hs[hs.length >> 1] : 0;
    const kept = notes.filter(x => {
      if (x.dur < (opts.minNote || 0.045)) return false;
      if (x.conf < (opts.minConfShort || 0.85) && x.dur < 0.12) return false;
      if (x.inKick && x.dur < 0.35 && x.harmon < hMed - 5) return false;
      return true;
    });
    // 옥타브 검사: 음 가운데 구간에서 홀수/짝수 배음, 반 옥타브 아래 성분 비교
    if (opts.octaveFix !== false) for (const x of kept) octaveCheck(x, ctx.wide, ctx.sr2);
    // 피킹 판정 기준 (곡마다 적응): 쉼 뒤에 시작한 음들의 어택 세기 중앙값
    const fresh = kept.filter((x, j) => j === 0 || x.i0 - kept[j - 1].i1 > F(0.05)).map(x => x.pluck).sort((a, b) => a - b);
    const typical = fresh.length ? fresh[fresh.length >> 1] : 8;
    const sens = opts.sensitivity == null ? 0.5 : opts.sensitivity;
    const pickThr = Math.max(1.5, typical * (0.25 + 0.3 * sens));
    const isAttack = new Uint8Array(n);
    const trThr = 3.5 + 3 * sens;   // 민감도가 높을수록 레가토로 판정
    kept.forEach(x => { x.picked = x.tr >= trThr || x.jump >= 5 + 3 * sens; if (x.picked) isAttack[Math.min(n - 1, x.i0 + 1)] = 1; });
    // 데드노트 후보용 어택 목록 (기존 방식)
    const minGap = F(0.05);
    const attPk = peaks(curve.att, Math.max(2.2, pickThr), minGap).filter(i => !kick[i]);
    return { notes: kept, ok, isAttack, attPk, pickThr, kick, PE, OS };
  }

  // ------------------------------------------------------------ 주법 감지
  function classify(notes, track, seg, opts) {
    const { mc, t } = track, ok = seg.ok, n = t.length, dt = track.hop;
    const attackNear = (i, before, after) => {
      let m = 0;
      for (let k = Math.max(0, i - before); k <= Math.min(n - 1, i + after); k++) if (seg.isAttack[k]) m = 1;
      return m;
    };
    const tapInterval = opts.tapInterval || 7;
    for (const nt of notes) { nt.tech = null; nt.bend = 0; nt.release = false; nt.vib = false; nt.slideIn = null; nt.slideOut = null; nt.dead = false; }
    const sm0 = Math.round(track.smear / dt);
    const linked = (A, B) => {
      // A와 B가 소리 끊김 없이 이어지는가 (전이 구간의 짧은 불확실 프레임은 허용)
      if (B.i0 - A.i1 > Math.round(0.06 / dt) + sm0) return false;
      let lvl = -999; for (let i = Math.max(A.i0, A.i1 - 4); i < A.i1; i++) lvl = Math.max(lvl, track._curve.eDb[i]);
      let bad = 0;
      for (let i = A.i1; i < B.i0; i++) {
        if (ok[i] || (seg.kick && seg.kick[i])) continue;
        if (track._curve.eDb[i] < lvl - 8) return false;
        bad++;
      }
      return bad * dt <= track.smear + 0.03;
    };
    // 미끄러지는 중간의 짧은 음(글라이드 조각) 제거
    for (let changed = true; changed;) {
      changed = false;
      for (let k = 1; k < notes.length - 1; k++) {
        const A = notes[k - 1], X = notes[k], B = notes[k + 1];
        const lo = Math.min(A.midi, B.midi), hi = Math.max(A.midi, B.midi);
        if (X.dur < 0.1 && X.midi > lo && X.midi < hi && linked(A, X) && linked(X, B) && !attackNear(X.i0, sm0, 4) && !attackNear(B.i0, sm0, 4)) {
          notes.splice(k, 1); changed = true; break;
        }
      }
    }

    for (let k = 0; k < notes.length; k++) {
      const B = notes[k], A = notes[k - 1];
      const sm = Math.round(track.smear / dt);
      const picked = B.picked != null ? B.picked : attackNear(B.i0, sm, 4);
      // 앞 음과 끊김 없이 이어졌는가
      const continuous = !!A && linked(A, B);
      if (opts.debug && A) opts.debug({ b: B.start, bm: B.midi, am: A.midi, continuous, picked, gap: (B.i0 - A.i1) * dt });
      if (A && continuous && !picked && A.midi !== B.midi) {
        const iv = B.midi - A.midi;
        // 전이 구간: A와 B 사이 '중간 음높이'에 머문 시간
        const lo = Math.min(A.midi, B.midi), hi = Math.max(A.midi, B.midi);
        const w0 = Math.max(A.i0, A.i1 - Math.round(0.25 / dt)), w1 = Math.min(B.i1, B.i0 + Math.round(0.2 / dt));
        let gf = 0, lastA = w0, firstB = w1, mono = 0, pv = null, g0 = -1;
        for (let i = w0; i < w1; i++) if (ok[i] && track.mc[i] > lo + 0.25 && track.mc[i] < hi - 0.25) {
          if (g0 < 0) g0 = i; gf++; if (pv != null && Math.sign(track.mc[i] - pv) === Math.sign(iv)) mono++; pv = track.mc[i];
        }
        const monotone = gf <= 2 || mono >= (gf - 1) * 0.7;
        const glide = Math.max(0, gf * dt - 0.025);
        const dist = Math.abs(iv);
        if (opts.debug) opts.debug({ a: A.start, b: B.start, am: A.midi, bm: B.midi, glide, lastA: track.t[lastA], firstB: track.t[firstB] });
        if (iv > 0 && dist <= 2 && glide >= 0.05 && monotone && A.dur >= 0.05 && B.dur >= 0.06) {
          // 벤딩: A를 B 높이까지 밀어 올림 → 이어서 내려오면 릴리스
          A.bend = iv; B._absorbedBend = true;
          A.i1 = B.i1; A.end = B.end;
          for (let m = k + 1; m < notes.length; m++) {
            const C = notes[m];
            if (C.midi >= A.midi && C.midi < A.midi + iv && linked(notes[m - 1], C) && !attackNear(C.i0, sm0, 4)) {
              A.release = true; C._absorbedBend = true; A.i1 = C.i1; A.end = C.end;
            } else break;
          }
          A.dur = A.end - A.start;
        } else if (B._absorbedBend) {
          // 이미 벤딩에 흡수된 음
        } else if (glide >= (dist >= 3 ? 0.022 : 0.035) && monotone) {
          B.tech = 's';
          if (g0 >= 0 && t[g0] < B.start) { B.start = t[g0]; B.dur = B.end - B.start; }
        } else if (iv > 0) {
          B.tech = (dist >= tapInterval || (B.videoTap && dist >= 3)) ? 't' : 'h';
        } else {
          B.tech = 'p';
        }
      }
      // 앞쪽 슬라이드 인 (무음에서 미끄러져 들어옴)
      if (!B.tech && !B._absorbedBend && B.slideFrom != null && B.slideFrom < B.midi - 0.5 && (!A || !linked(A, B))) B.slideIn = 'up';
      if (!B.tech && !B._absorbedBend && !B.slideIn) {
        const look = Math.round(0.15 / dt);
        let minBefore = 99, frames = 0;
        const from = Math.max(0, B.i0 - look, A ? A.i1 + sm0 : 0);
        let rising = 0, prevV = null;
        for (let i = from; i < B.i0; i++) if (ok[i]) { frames++; minBefore = Math.min(minBefore, mc[i]); if (prevV != null && mc[i] >= prevV - 0.1) rising++; prevV = mc[i]; }
        if (frames >= 5 && rising >= frames - 2 && B.midi - minBefore >= 2) B.slideIn = 'up';
      }
      // 끝쪽 슬라이드 아웃
      {
        const look = Math.round(0.18 / dt);
        let lowAfter = 99, frames = 0;
        for (let i = B.i1; i < Math.min(n, B.i1 + look); i++) { if (!ok[i]) break; frames++; lowAfter = Math.min(lowAfter, mc[i]); }
        const nextStart = notes[k + 1] ? notes[k + 1].i0 : n;
        if (frames >= 3 && B.midi - lowAfter >= 2 && nextStart - B.i1 > frames) B.slideOut = 'down';
      }
      // 비브라토
      if (B.dur >= 0.25) {
        const a = B.i0 + Math.round(0.05 / dt), b = B.i1 - 2;
        let m = 0, c = 0; for (let i = a; i < b; i++) { m += mc[i]; c++; }
        if (c > 10) {
          m /= c; let v = 0, zc = 0, prev = 0;
          for (let i = a; i < b; i++) { const dv = mc[i] - m; v += dv * dv; if (prev && Math.sign(dv) !== Math.sign(prev)) zc++; prev = dv; }
          const sd = Math.sqrt(v / c), rate = zc / 2 / (c * dt);
          if (sd > 0.12 && sd < 0.7 && rate > 3 && rate < 9) B.vib = true;
        }
      }
    }
    let out = notes.filter(nt => !nt._absorbedBend);

    // 데드노트: 강한 어택 + 음정 없음
    if (opts.deadNotes !== false) {
      const starts = new Set(); out.forEach(nt => { for (let i = nt.i0 - 6; i <= nt.i0 + 6; i++) starts.add(i); });
      for (const i of seg.attPk) {
        if (starts.has(i) || (seg.kick && seg.kick[i])) continue;
        let voiced = 0; for (let k = i; k < Math.min(n, i + Math.round(0.08 / dt)); k++) voiced += ok[k];
        let inNote = out.some(nt => i >= nt.i0 && i < nt.i1);
        if (!inNote && voiced <= 2 && track._curve && track._curve.att[i] >= seg.pickThr * 1.3) {
          out.push({ i0: i, i1: i + Math.round(0.06 / dt), start: t[i], end: t[i] + 0.06, dur: 0.06, midi: null, dead: true, conf: 0.5, tech: null, bend: 0, vib: false });
        }
      }
      out.sort((a, b) => a.start - b.start);
    }
    for (const nt of out) { delete nt._absorbedBend; }
    return out;
  }

  // ------------------------------------------------------------ 템포
  function estimateTempo(mid, sr, notes) {
    const hop = Math.round(sr / 100), n = Math.floor(mid.length / hop);
    const e = new Float32Array(n);
    let prev = 0;
    for (let k = 0; k < n; k++) {
      let s = 0; for (let j = 0; j < hop; j++) { const v = mid[k * hop + j]; s += v * v; }
      const db = Math.log(1 + 1000 * Math.sqrt(s / hop));
      e[k] = Math.max(0, db - prev); prev = db;
    }
    // 베이스 음 시작점도 가중
    if (notes) for (const nt of notes) { const k = Math.round(nt.start * 100); if (k < n) e[k] += 0.5; }
    let best = 50, bestV = -1;
    const ac = {};
    for (let L = 30; L <= 100; L++) {
      let s = 0; for (let k = L; k < n; k++) s += e[k] * e[k - L];
      const w = Math.exp(-0.5 * Math.pow(Math.log2(L / 50) / 0.8, 2));
      ac[L] = s; if (s * w > bestV) { bestV = s * w; best = L; }
    }
    let Lr = best;
    if (ac[best - 1] != null && ac[best + 1] != null) {
      const a = ac[best - 1], b = ac[best], c = ac[best + 1], den = a - 2 * b + c;
      if (den < 0) Lr = best + 0.5 * (a - c) / den;
    }
    const bpm = 6000 / Lr;
    let bo = 0, bs = -1;
    for (let o = 0; o < best; o++) { let s = 0; for (let k = o; k < n; k += Lr) s += e[Math.round(k)] || 0; if (s > bs) { bs = s; bo = o; } }
    return { bpm, firstBeat: bo / 100 };
  }

  function quantize(notes, bpm, firstBeat, beatsPerBar) {
    beatsPerBar = beatsPerBar || 4;
    const six = 60 / bpm / 4, bar = six * 4 * beatsPerBar;
    let origin = firstBeat;
    if (notes.length && notes[0].start < origin) origin -= Math.ceil((origin - notes[0].start) / bar) * bar;
    const bySlot = new Map();
    for (const nt of notes) {
      nt.slot = Math.max(0, Math.round((nt.start - origin) / six));
      nt.len = Math.max(1, Math.round(nt.dur / six));
      const p = bySlot.get(nt.slot);
      if (!p || (p.dead && !nt.dead) || (!!p.dead === !!nt.dead && nt.dur > p.dur)) bySlot.set(nt.slot, nt);
    }
    const out = [...bySlot.values()].sort((a, b) => a.slot - b.slot);
    for (let i = 0; i < out.length - 1; i++) out[i].len = Math.max(1, Math.min(out[i].len, out[i + 1].slot - out[i].slot));
    return { notes: out, origin, sixteenth: six };
  }

  // ------------------------------------------------------------ 운지 (Viterbi + 영상 힌트)
  function assignFrets(notes, tuning, maxFret, opts) {
    opts = opts || {};
    const low = tuning[0], high = tuning[tuning.length - 1] + maxFret;
    const pitched = notes.filter(n => !n.dead);
    const cands = pitched.map(n => {
      while (n.midi < low) n.midi += 12;
      while (n.midi > high) n.midi -= 12;
      const c = [];
      tuning.forEach((o, s) => { const f = n.midi - o; if (f >= 0 && f <= maxFret) c.push([s, f]); });
      return c;
    });
    const local = (n, [s, f]) => {
      let c = 0.04 * f + (f > 12 ? 0.08 * (f - 12) : 0) + (f > 0 ? 0.08 : 0);
      if (n.hand && n.hand.tips && n.hand.tips.length) {
        // 영상에서 본 손가락 끝 위치와의 거리 (프렛 단위 + 줄 단위)
        const W = (opts.handWeight ?? 1.6) * (n.hand.weak ? 0.3 : 1);
        if (f === 0) c += W * 0.5;
        else {
          let d = 9;
          for (const tp of n.hand.tips) d = Math.min(d, Math.abs(tp.f - (f - 0.35)) + 0.45 * Math.abs(tp.s - s));
          c += W * Math.min(d, 5);
        }
      } else if (n.hint && f > 0) {
        const lo = n.hint.lo - 1, hi = n.hint.hi + 1;
        const d = f < lo ? lo - f : f > hi ? f - hi : 0;
        c += 1.2 * d * (n.hint.w || 1);
      } else if (n.hint && f === 0) c += 0.3;
      return c;
    };
    const trans = (B, [sa, fa], [sb, fb]) => {
      let c;
      if (fa === 0 || fb === 0) c = 0.3 * Math.abs(sa - sb);
      else { const j = Math.abs(fa - fb); c = 0.15 * j + 0.7 * Math.max(0, j - 3) + 0.25 * Math.abs(sa - sb); }
      if ((B.tech === 'h' || B.tech === 'p' || B.tech === 's') && sa !== sb) c += 6;
      if (B.tech === 's' && fb === 0) c += 6;
      if (B.tech === 'h' && fa !== 0 && fb - fa > 5) c += 2;
      return c;
    };
    if (!pitched.length) return notes;
    let cost = cands[0].map(c => local(pitched[0], c));
    const back = [];
    for (let i = 1; i < pitched.length; i++) {
      const nc = [], ptr = [];
      for (const c of cands[i]) {
        let bj = 0, bv = Infinity;
        cands[i - 1].forEach((p, j) => { const v = cost[j] + trans(pitched[i], p, c); if (v < bv) { bv = v; bj = j; } });
        nc.push(bv + local(pitched[i], c)); ptr.push(bj);
      }
      cost = nc; back.push(ptr);
    }
    let k = cost.indexOf(Math.min(...cost));
    for (let i = pitched.length - 1; i >= 0; i--) {
      [pitched[i].string, pitched[i].fret] = cands[i][k];
      if (i > 0) k = back[i - 1][k];
    }
    // 데드노트는 이웃 음의 줄에 배치
    notes.forEach((n, i) => {
      if (!n.dead) return;
      const nb = notes.slice(i + 1).find(m => !m.dead) || notes.slice(0, i).reverse().find(m => !m.dead);
      n.string = nb ? nb.string : 0; n.fret = null;
    });
    return notes;
  }


  // ------------------------------------------------------------ 음표 확실도 (0~1) — '?' 표시 기준
  // 합성 실험 곡에서 맞은 음/틀린 음을 가르도록 맞춘 로지스틱 모델. 곡마다 신뢰도 중앙값을 기준으로 삼아 녹음 상태에 덜 민감함
  function certainty(notes) {
    const cs = notes.filter(n => n.midi != null && n.conf != null).map(n => n.conf).sort((a, b) => a - b);
    const mc = cs.length ? cs[cs.length >> 1] : 0.8;
    for (const n of notes) {
      if (n.dead) { n.cert = 0.7; continue; }
      const legato = n.tech === 'h' || n.tech === 'p' || n.tech === 's' || n.tech === 't' || n.bend;
      const tr = legato ? Math.max(n.tr || 0, 3) : (n.tr ?? 3);
      const z = -0.04 + 0.637 * ((n.conf ?? mc) - mc) * 10 + 0.652 * Math.log(Math.max(0.03, n.dur || 0.2) / 0.2)
        - 0.366 * Math.log1p(Math.max(0, n.pluck ?? 5)) + 1.538 * Math.log1p(Math.max(0, tr)) - 0.804 * (n.inKick ? 1 : 0);
      let c = 1 / (1 + Math.exp(-z));
      if (n.src === 'both') c = Math.max(c, 0.9);
      else if (n.src === 'ai') c = Math.min(c, 0.3 + 0.6 * (n.amp || 0.5));
      else if (n.src === 'dsp' && n.extChecked) c *= 0.8;
      n.cert = c;
    }
    return notes;
  }

  // ------------------------------------------------------------ 외부(AI) 음표와 결합
  // dsp: segment2 결과(프레임 인덱스 포함), ext: [{start, end, midi, amp}]
  function fuseNotes(dsp, ext, track, opts) {
    const dt = track.hop, t0 = track.t[0], n = track.t.length;
    const tol = opts.fuseTol || 0.07;
    const usedE = new Set();
    const out = [];
    for (const d of dsp) {
      let best = -1, bd = 1e9;
      ext.forEach((e, j) => {
        if (usedE.has(j)) return;
        const dd = Math.abs(e.start - d.start);
        if (dd <= tol && (e.midi === d.midi || Math.abs(e.midi - d.midi) === 12) && dd < bd) { bd = dd; best = j; }
      });
      d.extChecked = true;
      if (best >= 0) {
        usedE.add(best);
        const e = ext[best];
        d.src = 'both'; d.amp = e.amp;
        if (e.midi !== d.midi) { d.octAlt = e.midi; if ((e.amp || 0) >= 0.5) { d.midi = e.midi; } d.src = 'oct'; }
        out.push(d);
      } else {
        d.src = 'dsp'; out.push(d);
      }
    }
    // AI만 찾은 음 추가 (DSP 음과 겹치지 않는 구간)
    const minAmp = opts.extMinAmp ?? 0.3;
    ext.forEach((e, j) => {
      if (usedE.has(j) || (e.amp ?? 1) < minAmp || e.end - e.start < 0.05) return;
      const clash = out.find(d => e.start > d.start - 0.04 && e.start < d.end - 0.04 && (d.midi === e.midi || d.src === 'both'));
      if (clash && clash.midi === e.midi) return;          // 같은 음이 이미 울리는 중 (재피킹이 아니면 무시)
      const i0 = Math.max(0, Math.min(n - 1, Math.round((e.start - t0) / dt))), i1 = Math.max(i0 + 1, Math.min(n, Math.round((e.end - t0) / dt)));
      out.push({ i0, i1, start: e.start, end: e.end, dur: e.end - e.start, midi: e.midi, conf: null, src: 'ai', amp: e.amp, pluck: 5, tr: 5 });
    });
    out.sort((a, b) => a.start - b.start);
    // 겹치는 음 정리: 앞 음 끝을 다음 음 시작에 맞춤, 같은 시점 중복 제거
    const res = [];
    for (const x of out) {
      const p = res[res.length - 1];
      if (p && x.start - p.start < 0.04) {
        // 같은 시점이면 둘 다 확인된 음 > DSP > AI 순으로 남김
        const rank = y => (y.src === 'both' ? 3 : y.src === 'oct' ? 2 : y.src === 'dsp' ? 1 : 0);
        if (rank(x) > rank(p)) res[res.length - 1] = x;
        continue;
      }
      if (p && p.end > x.start) { p.end = x.start; p.i1 = Math.max(p.i0 + 1, x.i0); p.dur = p.end - p.start; }
      res.push(x);
    }
    return res;
  }

  // ------------------------------------------------------------ AI 다성 음표 → 베이스 한 줄로
  function bassLine(poly, lowMidi, highMidi) {
    const ns = poly.filter(e => e.midi >= lowMidi - 1 && e.midi <= highMidi).sort((a, b) => a.start - b.start || a.midi - b.midi);
    const keep = [];
    for (const e of ns) {
      // 같은 시점에 시작한 음 중 가장 낮은 음 (단, 아주 약한 낮은 음보다 뚜렷한 높은 음)
      const p = keep[keep.length - 1];
      if (p && Math.abs(e.start - p.start) < 0.05) {
        if (e.midi > p.midi && (p.amp || 0) < 0.35 * (e.amp || 0)) keep[keep.length - 1] = e;
        continue;
      }
      // 앞 음이 울리는 중에 시작한 더 높은 음: 앞 음보다 뚜렷하게 크면 새 음, 아니면 화음으로 보고 버림
      if (p && e.start < p.end - 0.03 && e.midi > p.midi && (e.amp || 0) < 1.2 * (p.amp || 0)) continue;
      keep.push(Object.assign({}, e));
    }
    for (let i = 0; i < keep.length - 1; i++) if (keep[i].end > keep[i + 1].start) keep[i].end = keep[i + 1].start;
    return keep.filter(e => e.end - e.start >= 0.04);
  }

  // ------------------------------------------------------------ 지판 원근 보정 (호모그래피)
  const fretU = f => 1 - Math.pow(2, -f / 12);               // 너트=0, 브리지=1 (현 길이 비율)
  const uFret = u => -12 * Math.log2(Math.max(1e-6, 1 - u));
  function solveH(src, dst) {
    // src[i]=(x,y) → dst[i]=(X,Y), 4점, 3x3 행렬(h33=1)
    const A = [], b = [];
    for (let i = 0; i < 4; i++) {
      const [x, y] = src[i], [X, Y] = dst[i];
      A.push([x, y, 1, 0, 0, 0, -X * x, -X * y]); b.push(X);
      A.push([0, 0, 0, x, y, 1, -Y * x, -Y * y]); b.push(Y);
    }
    const n = 8;
    for (let c = 0; c < n; c++) {
      let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
      if (Math.abs(A[c][c]) < 1e-12) return null;
      for (let r = 0; r < n; r++) { if (r === c) continue; const f = A[r][c] / A[c][c]; for (let k = c; k < n; k++) A[r][k] -= f * A[c][k]; b[r] -= f * b[c]; }
    }
    const h = b.map((v, i) => v / A[i][i]);
    return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
  }
  function applyH(H, x, y) { const w = H[6] * x + H[7] * y + H[8]; return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w]; }
  function invH(H) {
    const [a, b, c, d, e, f, g, h, i] = H;
    const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
    const det = a * A + b * B + c * C; if (Math.abs(det) < 1e-15) return null;
    return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
  }
  /** cal = {pts:[[x,y]x4: A위, A아래, B위, B아래], fA, fB} (정규화 이미지 좌표) → 지판(u,v)↔이미지 변환 */
  function neckModel(cal) {
    const uA = fretU(cal.fA || 0), uB = fretU(cal.fB == null ? 12 : cal.fB);
    const src = [[uA, 0], [uA, 1], [uB, 0], [uB, 1]];
    const H = solveH(src, cal.pts); if (!H) return null;
    const Hi = invH(H); if (!Hi) return null;
    return { H, Hi, toImg: (u, v) => applyH(H, u, v), toBoard: (x, y) => applyH(Hi, x, y) };
  }
  /** 보정 키프레임들 사이를 시간으로 보간 (보드 기준 0프렛·12프렛 모서리를 선형 보간) */
  function neckAt(keys, t) {
    if (!keys || !keys.length) return null;
    const corners = k => { const m = neckModel(k); if (!m) return null; return [m.toImg(0, 0), m.toImg(0, 1), m.toImg(0.5, 0), m.toImg(0.5, 1)]; };
    const ks = keys.slice().sort((a, b) => a.t - b.t);
    let a = ks[0], b = ks[0];
    for (const k of ks) { if (k.t <= t) a = k; }
    b = ks.find(k => k.t > t) || a;
    if (t <= ks[0].t) { a = b = ks[0]; }
    const ca = corners(a), cb = corners(b); if (!ca || !cb) return null;
    const w = a === b ? 0 : (t - a.t) / (b.t - a.t);
    const pts = ca.map((p, i) => [p[0] + (cb[i][0] - p[0]) * w, p[1] + (cb[i][1] - p[1]) * w]);
    return neckModel({ pts, fA: 0, fB: 12 });
  }
  /** 손가락 끝(이미지 좌표) → {f: 연속 프렛 위치, s: 연속 줄 번호(0=가장 낮은 줄)} */
  function tipToBoard(model, x, y, nStr, topIsLow, margin) {
    const [u, v] = model.toBoard(x, y);
    const m = margin ?? 0.12;
    const idx = (v - m) / (1 - 2 * m) * (nStr - 1);
    return { u, v, f: uFret(u), s: topIsLow ? idx : (nStr - 1 - idx) };
  }

  // ------------------------------------------------------------ 전체 파이프라인
  async function analyze(channels, sr, opts, onStage) {
    const P = (stage, frac) => onStage && onStage(stage, frac);
    P('filter', 0); await yieldUI();
    const band = bandLimit(channels, sr, opts.hp || 32, opts.lp || 330);
    P('hpss', 0);
    const sep = opts.skipHpss ? { harm: band.x, perc: new Float32Array(band.x.length) } : await hpss(band.x, opts, f => P('hpss', f));
    P('pitch', 0);
    const fmin = 440 * Math.pow(2, ((opts.lowestMidi || 28) - 2 - 69) / 12);
    const mode = opts.tracker || 'sal';
    let track = mode === 'sal' ? null : await yinTrack(sep.harm, band.sr, Object.assign({}, opts, { fmin, fmax: opts.fmax || 420 }), f => P('pitch', mode === 'yin' ? f : f * 0.4));
    if (mode !== 'yin') {
      const st = await salTrack(band.wide, band.sr2, opts, f => P('pitch', (mode === 'sal' ? 0 : 0.4) + (mode === 'sal' ? 1 : 0.6) * f));
      track = (opts.tracker || 'sal') === 'sal' ? st : fuseTracks(track, st, opts);
    }
    const curve = attackCurve(sep.harm, band.sr, track, sep.perc);
    track._curve = curve;
    P('notes', 0); await yieldUI();
    let notesRaw;
    if (opts.externalNotes) {
      // AI 엔진이 준 음표를 프레임 인덱스로 변환
      const seg0 = segment(track, curve, opts);
      notesRaw = { ...seg0, notes: opts.externalNotes.map(e => {
        const i0 = Math.max(0, Math.round((e.start - track.t[0]) / track.hop)), i1 = Math.max(i0 + 1, Math.round((e.end - track.t[0]) / track.hop));
        return { i0, i1, start: e.start, end: e.end, dur: e.end - e.start, midi: e.midi, conf: e.conf || 0.8 };
      }) };
    } else notesRaw = opts.legacy ? segment(track, curve, opts) : segment2(track, curve, band, opts);
    if (opts.extNotes && opts.extNotes.length) notesRaw.notes = fuseNotes(notesRaw.notes, opts.extNotes, track, opts);
    if (opts.videoHints) opts.videoHints(notesRaw.notes);
    let notes = classify(notesRaw.notes, track, notesRaw, opts);
    certainty(notes);
    // AI 결과가 있을 때: AI가 확인하지 못한 불확실한 DSP 음은 버림
    if (opts.extNotes && opts.extNotes.length && opts.dropUnconfirmed !== false) notes = notes.filter(n => !(n.src === 'dsp' && n.cert < (opts.dropBelow ?? 0.5)));
    const tempo = estimateTempo(band.mid, sr, notes);
    const bpm = opts.bpm || tempo.bpm;
    const first = opts.bpm && opts.firstBeat != null ? opts.firstBeat : tempo.firstBeat;
    const q = quantize(notes, bpm, opts.firstBeat != null ? opts.firstBeat : first, opts.beatsPerBar || 4);
    P('frets', 0); await yieldUI();
    return { notes: q.notes, all: notes, bpm, estBpm: tempo.bpm, firstBeat: first, origin: q.origin, sixteenth: q.sixteenth, bass: sep.harm, bassSr: band.sr, wide: band.wide, wideSr: band.sr2, track, pickThr: notesRaw.pickThr };
  }

  const BassCore = { certainty, fuseNotes, bassLine, fretU, uFret, solveH, applyH, invH, neckModel, neckAt, tipToBoard, salTrack, fuseTracks, partialEnergies, segment2, biquad, bandLimit, fft, hpss, yinTrack, attackCurve, segment, classify, estimateTempo, quantize, assignFrets, analyze };
  if (typeof module !== 'undefined' && module.exports) module.exports = BassCore;
  else root.BassCore = BassCore;
})(typeof self !== 'undefined' ? self : this);
