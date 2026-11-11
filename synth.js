/* BassSynth — 주법별 베이스 소리 (물리 현 모델: 카플러스–스트롱 + 분수 지연 보정)
 * 순수 함수라 브라우저·Node 모두에서 동작. 결과는 Float32Array (모노)
 *  finger  : 손가락 피킹 — 삼각형 변위로 튕김, 따뜻하고 길게 울림
 *  slap    : 엄지 슬랩 — 빠른 타격(속도 충격) + 프렛에 부딪히는 금속성 소리, 밝고 빨리 줄어듦
 *  pop     : 팝 — 줄을 당겨 놓아 프렛에 '딱' 부딪힘, 가장 밝고 날카로운 시작
 *  harm    : 자연 하모닉 — 마디(節)에서 울리는 순한 종소리, 배음 위치의 음높이만
 *  tap     : 태핑 — 오른손으로 지판을 두드림, 부드러운 시작
 *  dead    : 고스트·데드 — 음높이 없는 짧은 '툭'
 *  deadSlap: 슬랩 고스트 — 짧고 밝은 '탁'
 *  hammer / pull : 레가토 연결음에 덧입히는 작은 손가락 소리(보조)
 */
(function (root) {
  'use strict';
  const hz = m => 440 * Math.pow(2, (m - 69) / 12);
  function rng(seed) { let s = (seed >>> 0) || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296 * 2 - 1; }; }

  const KINDS = {
    finger: { dur: 5.0, t60: 4.2, b: 0.5, pluck: 0.22, shape: 'tri', noise: 0.12, lp: 2600, gain: 0.9 },
    slap: { dur: 3.2, t60: 2.4, b: 0.32, pluck: 0.36, shape: 'hit', noise: 0.25, lp: 7000, gain: 1.0, clank: 0.55 },
    pop: { dur: 3.0, t60: 2.0, b: 0.22, pluck: 0.16, shape: 'tri', noise: 0.15, lp: 8000, gain: 0.95, snap: 0.6 },
    harm: { dur: 3.5, t60: 3.0, b: 0.5, pluck: 0.5, shape: 'sine', noise: 0.0, lp: 3000, gain: 0.75 },
    tap: { dur: 4.0, t60: 3.2, b: 0.5, pluck: 0.3, shape: 'bump', noise: 0.05, lp: 2400, gain: 0.7 },
  };

  /** 카플러스–스트롱: 정확한 주기를 위해 1차 올패스로 분수 지연 보정 */
  function ks(sr, f, p, seed) {
    const n = Math.round(sr * p.dur), out = new Float32Array(n), R = rng(seed || 7);
    const b = p.b, P = sr / f;
    // 루프 지연 = N + b(2점 필터) + d(올패스) = P
    let N = Math.floor(P - b - 0.15); if (N < 2) N = 2;
    let d = P - N - b; if (d < 0.05) { N -= 1; d += 1; }
    const C = (1 - d) / (1 + d);
    const rho = Math.pow(10, -3 / (f * p.t60));              // 한 바퀴마다 줄어드는 비율 (t60초에 -60dB)
    // 처음 줄 모양(들뜸)
    const ex = new Float32Array(N);
    const pk = Math.max(1, Math.round(N * p.pluck));
    for (let i = 0; i < N; i++) {
      let v;
      if (p.shape === 'tri') v = i < pk ? i / pk : (N - i) / (N - pk);            // 손가락으로 당긴 삼각형
      else if (p.shape === 'hit') { const w = Math.max(2, N * 0.06), x = (i - pk) / w; v = Math.exp(-x * x) * (i < pk ? 1 : 1); } // 엄지로 친 좁은 충격
      else if (p.shape === 'bump') { const w = N * 0.18, x = (i - pk) / w; v = Math.exp(-x * x); }
      else v = Math.sin(Math.PI * i / N);                                     // 하모닉: 한 배음만
      ex[i] = v;
    }
    let mean = 0; for (let i = 0; i < N; i++) mean += ex[i]; mean /= N;
    let lpn = 0;
    for (let i = 0; i < N; i++) { lpn += 0.35 * (R() - lpn); ex[i] = ex[i] - mean + p.noise * lpn; }
    let mx = 1e-9; for (let i = 0; i < N; i++) mx = Math.max(mx, Math.abs(ex[i])); for (let i = 0; i < N; i++) ex[i] /= mx;
    // 루프
    const L = N + 2, dl = new Float32Array(L);
    let w = 0, apx = 0, apy = 0;
    for (let i = 0; i < n; i++) {
      let y;
      if (i < N) y = ex[i];
      else {
        const s0 = dl[(w - N + L * 4) % L], s1 = dl[(w - N - 1 + L * 4) % L];
        const lp = (1 - b) * s0 + b * s1;
        const ap = C * lp + apx - C * apy; apx = lp; apy = ap;
        y = rho * ap;
      }
      dl[w] = y; w = (w + 1) % L;
      out[i] = y;
    }
    return out;
  }
  function onePoleLP(x, sr, fc) { const a = Math.exp(-2 * Math.PI * fc / sr); let y = 0; for (let i = 0; i < x.length; i++) { y = (1 - a) * x[i] + a * y; x[i] = y; } return x; }
  function dcBlock(x) { let px = 0, py = 0; for (let i = 0; i < x.length; i++) { const y = x[i] - px + 0.995 * py; px = x[i]; py = y; x[i] = y; } return x; }
  function bandNoise(sr, n, lo, hi, decay, seed) {
    const R = rng(seed), out = new Float32Array(n);
    const al = Math.exp(-2 * Math.PI * hi / sr), ah = Math.exp(-2 * Math.PI * lo / sr);
    let l1 = 0, l2 = 0;
    for (let i = 0; i < n; i++) { const r = R(); l1 = (1 - al) * r + al * l1; l2 = (1 - ah) * r + ah * l2; out[i] = (l1 - l2) * Math.exp(-i / sr * decay); }
    let mx = 1e-9; for (const v of out) mx = Math.max(mx, Math.abs(v)); for (let i = 0; i < n; i++) out[i] /= mx;
    return out;
  }
  function normalize(x, peak) { let mx = 1e-9; for (const v of x) mx = Math.max(mx, Math.abs(v)); const g = peak / mx; for (let i = 0; i < x.length; i++) x[i] *= g; return x; }

  /** midi 음높이·주법 → 소리. 하모닉은 midi에 '울리는 음높이'(예: 12프렛 하모닉 = 개방현+12)를 넣음 */
  function render(sr, midi, kind, seed) {
    seed = seed || (midi * 131 + kind.length * 17);
    if (kind === 'dead' || kind === 'deadSlap') {
      const bright = kind === 'deadSlap', n = Math.round(sr * 0.12), out = new Float32Array(n), f = hz(Math.max(23, midi));
      // 눌리지 않은 줄의 아주 짧은 울림 + 손가락·엄지 부딪힘
      const p = { dur: 0.12, t60: 0.05, b: bright ? 0.3 : 0.5, pluck: 0.3, shape: bright ? 'hit' : 'tri', noise: 0.6, lp: 0 };
      const s = ks(sr, f, p, seed);
      const nz = bandNoise(sr, n, bright ? 900 : 80, bright ? 5000 : 900, bright ? 70 : 45, seed + 3);
      for (let i = 0; i < n; i++) { const t = i / sr, env = Math.min(1, t / 0.0015) * Math.exp(-t * (bright ? 55 : 40)); out[i] = (0.55 * s[i] + (bright ? 0.6 : 0.5) * nz[i]) * env; }
      if (!bright) onePoleLP(out, sr, 1200);
      return normalize(dcBlock(out), bright ? 0.75 : 0.55);
    }
    if (kind === 'hammer' || kind === 'pull') {
      const n = Math.round(sr * 0.03), nz = bandNoise(sr, n, kind === 'hammer' ? 150 : 600, kind === 'hammer' ? 1500 : 3500, kind === 'hammer' ? 160 : 220, seed);
      return normalize(nz, kind === 'hammer' ? 0.18 : 0.12);
    }
    const p = KINDS[kind] || KINDS.finger, f = hz(midi);
    const x = ks(sr, f, p, seed);
    // 시작 순간의 소리 (슬랩: 프렛 부딪힘, 팝: '딱')
    if (p.clank) { const nz = bandNoise(sr, Math.round(sr * 0.05), 1200, 5500, 75, seed + 11); for (let i = 0; i < nz.length; i++) x[i] += p.clank * nz[i]; }
    if (p.snap) { const nz = bandNoise(sr, Math.round(sr * 0.02), 2500, 8000, 260, seed + 13); for (let i = 0; i < nz.length; i++) x[i] += p.snap * nz[i]; }
    // 픽업·앰프: 너무 높은 성분 줄이기, 직류 제거
    onePoleLP(x, sr, p.lp);
    dcBlock(x);
    // 아주 짧은 시작 램프(딸깍 방지), 하모닉·태핑은 부드럽게
    const att = Math.round(sr * (kind === 'harm' ? 0.004 : kind === 'tap' ? 0.015 : 0.0007));
    for (let i = 0; i < att; i++) x[i] *= i / att;
    return normalize(x, p.gain);
  }

  const BassSynth = { render, KINDS, hz };
  if (typeof module !== 'undefined' && module.exports) module.exports = BassSynth; else root.BassSynth = BassSynth;
})(typeof self !== 'undefined' ? self : this);
