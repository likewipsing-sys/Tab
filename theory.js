/* BassTheory — 음악 이론 + 연습 악보 생성기 (규칙 기반, AI 없이 동작)
 * 악보 형식(채보 앱과 같음): {title, tuning, bpm, beats, swing, notes:[{slot, len, string, fret, midi, tech, slap, pop, dead, ghost, harm, vib, bend}]}
 * slot/len 단위 = 16분음표, string 0 = 가장 낮은 줄
 */
(function (root) {
  'use strict';
  const C = (typeof module !== 'undefined' && module.exports) ? require('../core.js') : root.BassCore;

  const TUNINGS = {
    '4std': { label: '4현 · 표준 (E A D G)', open: [28, 33, 38, 43] },
    '4dropd': { label: '4현 · 드롭 D (D A D G)', open: [26, 33, 38, 43] },
    '4half': { label: '4현 · 반음 내림', open: [27, 32, 37, 42] },
    '4whole': { label: '4현 · 한음 내림', open: [26, 31, 36, 41] },
    '5std': { label: '5현 · 표준 (B E A D G)', open: [23, 28, 33, 38, 43] },
    '5half': { label: '5현 · 반음 내림', open: [22, 27, 32, 37, 42] },
    '6std': { label: '6현 · 표준 (B E A D G C)', open: [23, 28, 33, 38, 43, 48] },
  };
  const SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  const KEYS = [['C', 0], ['C#', 1], ['Db', 1], ['D', 2], ['Eb', 3], ['E', 4], ['F', 5], ['F#', 6], ['Gb', 6], ['G', 7], ['Ab', 8], ['A', 9], ['Bb', 10], ['B', 11]];
  const KEY_PC = Object.fromEntries(KEYS);
  const useFlats = key => /b/.test(key) || ['F'].includes(key);
  const noteName = (midi, key) => (key && useFlats(key) ? FLAT : SHARP)[((midi % 12) + 12) % 12];

  const SCALES = {
    major: { label: '메이저 (이오니안)', iv: [0, 2, 4, 5, 7, 9, 11] },
    minor: { label: '내추럴 마이너 (에올리안)', iv: [0, 2, 3, 5, 7, 8, 10] },
    majpent: { label: '메이저 펜타토닉', iv: [0, 2, 4, 7, 9] },
    minpent: { label: '마이너 펜타토닉', iv: [0, 3, 5, 7, 10] },
    blues: { label: '블루스', iv: [0, 3, 5, 6, 7, 10] },
    dorian: { label: '도리안', iv: [0, 2, 3, 5, 7, 9, 10] },
    mixolydian: { label: '믹솔리디안', iv: [0, 2, 4, 5, 7, 9, 10] },
    phrygian: { label: '프리지안', iv: [0, 1, 3, 5, 7, 8, 10] },
    lydian: { label: '리디안', iv: [0, 2, 4, 6, 7, 9, 11] },
    harmminor: { label: '하모닉 마이너', iv: [0, 2, 3, 5, 7, 8, 11] },
    melminor: { label: '멜로딕 마이너', iv: [0, 2, 3, 5, 7, 9, 11] },
    chromatic: { label: '크로매틱', iv: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
  };
  const CHORDS = { maj7: [0, 4, 7, 11], 7: [0, 4, 7, 10], m7: [0, 3, 7, 10], m7b5: [0, 3, 6, 10], dim7: [0, 3, 6, 9], maj: [0, 4, 7], m: [0, 3, 7], 6: [0, 4, 7, 9], m6: [0, 3, 7, 9] };
  // 진행: [근음 반음 거리, 코드 종류] — 마디마다 1개 (배열이면 반 마디씩)
  const PROGRESSIONS = {
    blues: { label: '12마디 블루스', bars: [[0, '7'], [5, '7'], [0, '7'], [0, '7'], [5, '7'], [5, '7'], [0, '7'], [0, '7'], [7, '7'], [5, '7'], [0, '7'], [7, '7']] },
    minorblues: { label: '마이너 블루스', bars: [[0, 'm7'], [5, 'm7'], [0, 'm7'], [0, 'm7'], [5, 'm7'], [5, 'm7'], [0, 'm7'], [0, 'm7'], [8, '7'], [7, '7'], [0, 'm7'], [7, '7']] },
    iiVI: { label: 'ii–V–I (메이저)', bars: [[2, 'm7'], [7, '7'], [0, 'maj7'], [0, 'maj7']] },
    iiVIminor: { label: 'ii–V–i (마이너)', bars: [[2, 'm7b5'], [7, '7'], [0, 'm7'], [0, 'm7']] },
    rhythm: { label: '리듬 체인지 A', bars: [[[0, 'maj7'], [9, '7']], [[2, 'm7'], [7, '7']], [[0, 'maj7'], [9, '7']], [[2, 'm7'], [7, '7']], [[5, 'maj7'], [6, 'dim7']], [[0, 'maj7'], [9, '7']], [[2, 'm7'], [7, '7']], [0, 'maj7']] },
    pop: { label: 'I–V–vi–IV', bars: [[0, 'maj'], [7, 'maj'], [9, 'm'], [5, 'maj']] },
    rock: { label: 'I–♭VII–IV–I', bars: [[0, 'maj'], [10, 'maj'], [5, 'maj'], [0, 'maj']] },
    funk: { label: 'i7 원코드 펑크', bars: [[0, 'm7'], [0, 'm7'], [0, 'm7'], [5, '7']] },
    soul: { label: 'i–iv (소울)', bars: [[0, 'm7'], [0, 'm7'], [5, 'm7'], [5, 'm7']] },
    disco: { label: 'i–IV 디스코', bars: [[0, 'm7'], [5, '7'], [0, 'm7'], [5, '7']] },
    autumn: { label: 'ii–V–I–IV 순환', bars: [[2, 'm7'], [7, '7'], [0, 'maj7'], [5, 'maj7'], [11, 'm7b5'], [4, '7'], [9, 'm7'], [9, 'm7']] },
  };
  const TECHNIQUES = {
    scale: '스케일', fingering: '핑거링', walking: '워킹', slap: '슬랩', harmonics: '하모닉스', groove: '그루브·고스트노트', legato: '해머링·풀링',
  };

  function rng(seed) { let s = (seed >>> 0) || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
  const pick = (R, a) => a[Math.floor(R() * a.length) % a.length];
  const openOf = t => (TUNINGS[t] || TUNINGS['4std']).open;

  function finish(tab) {
    // 마디 수 맞추기, midi 채우기, 정렬
    const open = openOf(tab.tuning);
    tab.notes.forEach(n => { if (!n.dead && n.midi == null && n.string != null && n.fret != null) n.midi = open[n.string] + n.fret; if (n.dead && n.midi === undefined) n.midi = null; n.len = n.len || 1; });
    tab.notes.sort((a, b) => a.slot - b.slot);
    const spb = 4 * (tab.beats || 4);
    const last = tab.notes.reduce((m, n) => Math.max(m, n.slot + n.len), 0);
    tab.bars = Math.max(tab.bars || 0, Math.ceil(last / spb));
    tab.createdAt = tab.createdAt || Date.now();
    return tab;
  }
  /** 음높이만 있는 음표들의 줄·프렛을 손 이동이 가장 적게 배치 (선호 프렛 범위 가능) */
  function placeFrets(notes, tuning, lo, hi, maxFret) {
    const free = notes.filter(n => n.string == null && !n.dead);
    if (lo != null) free.forEach(n => { n.hint = { lo, hi, w: 1.5 }; });
    C.assignFrets(free, openOf(tuning), maxFret || 20);
    free.forEach(n => { delete n.hint; });
    return notes;
  }
  /** 키의 근음을 원하는 프렛 구역에서 E/A(5현이면 B/E)줄로 칠 수 있는 높이로 */
  function rootMidi(key, tuning, region) {
    const open = openOf(tuning), pc = KEY_PC[key] ?? 0;
    const [lo, hi] = region === 'high' ? [9, 14] : region === 'mid' ? [5, 9] : [0, 5];
    for (let m = open[0]; m < open[0] + 40; m++) {
      if ((m % 12 + 12) % 12 !== pc) continue;
      for (const s of [0, 1]) { const f = m - open[s]; if (f >= lo && f <= hi) return m; }
    }
    let m = open[0]; while ((m % 12 + 12) % 12 !== pc) m++; return m;
  }
  const regionFrets = r => r === 'high' ? [9, 14] : r === 'mid' ? [4, 9] : [0, 5];

  // ------------------------------------------------------------ 스케일
  function scaleExercise(o) {
    o = Object.assign({ key: 'C', scale: 'major', octaves: 1, rhythm: 8, pattern: 'updown', region: 'low', tuning: '4std', bpm: 80 }, o);
    const iv = (SCALES[o.scale] || SCALES.major).iv, r0 = rootMidi(o.key, o.tuning, o.region);
    const deg = []; for (let k = 0; k < o.octaves; k++) iv.forEach(x => deg.push(r0 + 12 * k + x)); deg.push(r0 + 12 * o.octaves);
    let seq = [];
    if (o.pattern === 'thirds') { for (let i = 0; i + 2 < deg.length; i++) seq.push(deg[i], deg[i + 2]); for (let i = deg.length - 1; i - 2 >= 0; i--) seq.push(deg[i], deg[i - 2]); seq.push(r0); }
    else if (o.pattern === 'four') { for (let i = 0; i + 3 < deg.length; i++) seq.push(deg[i], deg[i + 1], deg[i + 2], deg[i + 3]); for (let i = deg.length - 1; i - 3 >= 0; i--) seq.push(deg[i], deg[i - 1], deg[i - 2], deg[i - 3]); seq.push(r0); }
    else { seq = deg.concat(deg.slice(0, -1).reverse()); }
    const len = o.rhythm === 16 ? 1 : o.rhythm === 4 ? 4 : 2;
    const notes = seq.map((m, i) => ({ slot: i * len, len, midi: m }));
    const lastNote = notes[notes.length - 1]; const spb = 16, end = Math.ceil((lastNote.slot + 1) / spb) * spb; lastNote.len = Math.max(len, end - lastNote.slot);
    const [lo, hi] = regionFrets(o.region);
    placeFrets(notes, o.tuning, lo, hi + (o.octaves > 1 ? 3 : 1));
    return finish({ title: `${o.key} ${(SCALES[o.scale] || SCALES.major).label}${o.pattern === 'thirds' ? ' · 3도' : o.pattern === 'four' ? ' · 4음 묶음' : ''}`, technique: 'scale', key: o.key, tuning: o.tuning, bpm: o.bpm, beats: 4, notes,
      desc: `${o.octaves}옥타브, ${o.rhythm === 16 ? '16분' : o.rhythm === 4 ? '4분' : '8분'}음표. 한 손가락이 한 프렛을 맡는 자세로 손 위치를 고정하세요.` });
  }

  // ------------------------------------------------------------ 핑거링 (크로매틱·스파이더·스트링 크로싱)
  const PERMS = ['1234', '1243', '1324', '1342', '1423', '1432', '2134', '2143', '3412', '4321'];
  function fingeringExercise(o) {
    o = Object.assign({ type: 'chromatic', position: 1, perm: '1234', rhythm: 16, tuning: '4std', bpm: 70 }, o);
    const open = openOf(o.tuning), nStr = open.length, len = o.rhythm === 16 ? 1 : 2, notes = [];
    let slot = 0;
    const put = (s, f, extra) => { notes.push(Object.assign({ slot, len, string: s, fret: f }, extra || {})); slot += len; };
    const P = Math.max(1, o.position);
    if (o.type === 'spider') {
      // 두 줄씩 번갈아: 1-3 / 2-4 손가락 쌍
      for (let s = 0; s + 1 < nStr; s++) { put(s, P); put(s + 1, P + 2); put(s, P + 1); put(s + 1, P + 3); }
      for (let s = nStr - 1; s - 1 >= 0; s--) { put(s, P + 3); put(s - 1, P + 1); put(s, P + 2); put(s - 1, P); }
    } else if (o.type === 'crossing') {
      // 스트링 크로싱: 근음–5도–옥타브–5도 (교대 피킹)
      for (const r of [P + 2, P + 4, P, P + 2]) { put(0, r); put(1, r + 2); put(2, r + 2); put(1, r + 2); put(0, r); put(1, r + 2); put(3 < nStr ? 3 : 2, r + (3 < nStr ? 2 : 2)); put(1, r + 2); }
    } else {
      const perm = (o.perm || '1234').split('').map(Number);
      for (let s = 0; s < nStr; s++) perm.forEach(fg => put(s, P + fg - 1));
      for (let s = nStr - 1; s >= 0; s--) perm.slice().reverse().forEach(fg => put(s, P + fg - 1));
    }
    const end = Math.ceil(slot / 16) * 16; if (end > slot) notes[notes.length - 1].len += end - slot;
    const names = { chromatic: `크로매틱 ${o.perm}`, spider: '스파이더', crossing: '스트링 크로싱' };
    return finish({ title: `핑거링 · ${names[o.type] || o.type} (${P}프렛)`, technique: 'fingering', tuning: o.tuning, bpm: o.bpm, beats: 4, notes,
      desc: '검지·중지 교대 피킹을 지키고, 한 손가락이 한 프렛을 맡으세요. 누른 손가락은 다음 음을 칠 때까지 떼지 마세요.' });
  }

  // ------------------------------------------------------------ 워킹
  function chordAt(prog, bar, half) { const b = prog.bars[bar % prog.bars.length]; return Array.isArray(b[0]) ? b[half ? 1 : 0] : b; }
  function walkingExercise(o) {
    o = Object.assign({ key: 'F', progression: 'blues', bars: null, tuning: '4std', bpm: 100, seed: 1, swing: true }, o);
    const prog = PROGRESSIONS[o.progression] || PROGRESSIONS.blues, R = rng(o.seed * 7919 + 13);
    const bars = o.bars || prog.bars.length, keyPc = KEY_PC[o.key] ?? 5, open = openOf(o.tuning);
    const LO = open[0], HI = open[0] + 24;
    const near = (pc, ref) => { let best = null; for (let m = LO; m <= HI; m++) if ((m % 12 + 12) % 12 === pc && (best == null || Math.abs(m - ref) < Math.abs(best - ref))) best = m; return best; };
    const beats = [];
    for (let b = 0; b < bars; b++) for (let q = 0; q < 4; q++) { const [rt, ty] = chordAt(prog, b, q >= 2); beats.push({ b, q, rootPc: (keyPc + rt) % 12, ty, split: Array.isArray(prog.bars[b % prog.bars.length][0]) }); }
    let prev = near(beats[0].rootPc, LO + 8);
    const out = [];
    for (let i = 0; i < beats.length; i++) {
      const bt = beats[i], tones = CHORDS[bt.ty] || CHORDS['7'], nxt = beats[i + 1] || beats[0];
      const chordStart = bt.q === 0 || (bt.split && bt.q === 2);
      const nextChordStart = nxt.q === 0 || (nxt.split && nxt.q === 2);
      let m;
      if (chordStart) m = near(bt.rootPc, prev);
      else if (nextChordStart) {
        // 다음 근음으로 반음 접근 (아래/위) 또는 5도 위에서 내려오기
        const tgt = near(nxt.rootPc, prev), opts = [tgt - 1, tgt + 1, tgt + 7, tgt - 5].filter(x => x >= LO && x <= HI && x !== prev);
        opts.sort((a, b) => Math.abs(a - prev) - Math.abs(b - prev));
        m = R() < 0.75 ? opts[0] : pick(R, opts.slice(0, 2));
      } else {
        // 코드톤 또는 스케일 음으로 진행 방향 유지
        const tgtNext = near(nxt.rootPc, prev);
        const dir = tgtNext >= prev ? 1 : -1;
        const cands = [];
        for (let m2 = prev - 7; m2 <= prev + 7; m2++) {
          if (m2 < LO || m2 > HI || m2 === prev) continue;
          const pc = ((m2 - bt.rootPc) % 12 + 12) % 12;
          if (tones.includes(pc)) cands.push({ m: m2, w: (Math.sign(m2 - prev) === dir ? 2 : 1) / (1 + Math.abs(m2 - prev) / 3) });
        }
        if (!cands.length) m = prev + dir * 2; else { const tot = cands.reduce((a, c) => a + c.w, 0); let x = R() * tot; m = cands.find(c => (x -= c.w) <= 0)?.m ?? cands[0].m; }
      }
      out.push({ slot: i * 4, len: 4, midi: m }); prev = m;
    }
    placeFrets(out, o.tuning, 0, 7);
    const chordNames = [];
    for (let b = 0; b < bars; b++) {
      const bb = prog.bars[b % prog.bars.length], f = c => noteName((keyPc + c[0]) % 12, o.key) + ({ maj7: 'maj7', 7: '7', m7: 'm7', m7b5: 'm7♭5', dim7: '°7', maj: '', m: 'm', 6: '6', m6: 'm6' }[c[1]] ?? c[1]);
      chordNames.push(Array.isArray(bb[0]) ? bb.map(f).join(' ') : f(bb));
    }
    return finish({ title: `워킹 · ${o.key} ${prog.label}`, technique: 'walking', key: o.key, tuning: o.tuning, bpm: o.bpm, beats: 4, swing: o.swing, notes: out, chords: chordNames,
      desc: '4분음표 워킹. 1박은 근음, 4박은 다음 근음으로 반음 접근하는 음입니다. 음 길이를 끝까지 이어서 레가토로.' });
  }

  // ------------------------------------------------------------ 슬랩
  // T 엄지(근음) · O 팝(옥타브) · G 엄지 고스트 · g 팝 고스트 · 5 팝(5도 위 옥타브=♭7) · h 엄지 후 해머링(+2) · . 쉼
  const SLAP_TEMPLATES = {
    beginner: ['T...O...T...O...', 'T.O.T.O.T.O.T.O.'],
    disco: ['T.O.T.O.T.O.T.O.', 'T.OGT.OGT.OGT.O.'],
    funk: ['T..GO.T.T.GO..O.', 'T.GOT.GOT..GO.G.', 'T..O..T.G.O.T.O.'],
    advanced: ['ThGOT.GOThGO.TGO', 'T.GOThG5T.GOTh5.', 'ThGgThGOTGO.ThGO'],
  };
  function slapExercise(o) {
    o = Object.assign({ key: 'E', progression: 'funk', level: 'funk', bars: 4, tuning: '4std', bpm: 90, seed: 3 }, o);
    const R = rng(o.seed * 104729 + 7), prog = PROGRESSIONS[o.progression] || PROGRESSIONS.funk, keyPc = KEY_PC[o.key] ?? 4, open = openOf(o.tuning);
    const tpls = SLAP_TEMPLATES[o.level] || SLAP_TEMPLATES.funk;
    const notes = [];
    for (let b = 0; b < o.bars; b++) {
      const [rt, ty] = chordAt(prog, b, false), pc = (keyPc + rt) % 12;
      // 근음: E줄(0) 0~7프렛 또는 A줄(1) 0~7프렛
      let s = 0, f = ((pc - open[0] % 12) + 12) % 12;
      if (f > 7) { s = 1; f = ((pc - open[1] % 12) + 12) % 12; }
      if (open.length >= 5 && f === 0 && s === 0) { /* 개방현 그대로 */ }
      const tpl = (b % 2 === 1 && tpls.length > 1) ? tpls[(Math.floor(R() * (tpls.length - 1)) + 1) % tpls.length] : tpls[0];
      const minor7 = (CHORDS[ty] || []).includes(10);
      for (let k = 0; k < 16; k++) {
        const c = tpl[k], slot = b * 16 + k;
        if (c === '.') continue;
        let len = 1; while (k + len < 16 && tpl[k + len] === '.' && len < 4) len++;
        if (c === 'T') notes.push({ slot, len, string: s, fret: f, slap: true });
        else if (c === 'O') notes.push({ slot, len, string: s + 2, fret: f + 2, pop: true });
        else if (c === '5') notes.push({ slot, len, string: s + 2, fret: f + (minor7 ? 0 : 1), pop: true });
        else if (c === 'G') notes.push({ slot, len: 1, string: s, fret: null, dead: true, slap: true });
        else if (c === 'g') notes.push({ slot, len: 1, string: s + 2, fret: null, dead: true, pop: true });
        else if (c === 'h') notes.push({ slot, len, string: s, fret: f + 2, tech: 'h' });
      }
    }
    return finish({ title: `슬랩 · ${o.key} ${({ beginner: '입문 옥타브', disco: '디스코 옥타브', funk: '펑크 그루브', advanced: '해머링·고스트 콤보' })[o.level] || o.level}`, technique: 'slap', key: o.key, tuning: o.tuning, bpm: o.bpm, beats: 4, notes,
      desc: 'S = 엄지(썸) 슬랩, Po = 검지·중지 팝, x = 고스트 노트(왼손으로 줄을 살짝 뮤트). 엄지는 손목 회전으로 튕기세요.' });
  }

  // ------------------------------------------------------------ 하모닉스
  const HARM_PITCH = { 12: 12, 7: 19, 19: 19, 5: 24, 24: 24, 4: 28, 9: 28, 16: 28 };
  function harmonicsExercise(o) {
    o = Object.assign({ type: 'natural', tuning: '4std', bpm: 72 }, o);
    const open = openOf(o.tuning), nStr = open.length, notes = []; let slot = 0;
    const put = (s, f, len) => { notes.push({ slot, len, string: s, fret: f, harm: true, midi: open[s] + (HARM_PITCH[f] ?? 12) }); slot += len; };
    if (o.type === 'tuning') {
      // 줄 맞추기: 아래 줄 5프렛 하모닉 = 위 줄 7프렛 하모닉
      for (let s = 0; s + 1 < nStr; s++) { put(s, 5, 8); put(s + 1, 7, 8); }
    } else if (o.type === 'arpeggio') {
      for (let rep = 0; rep < 2; rep++) for (let s = 0; s < nStr; s++) for (const f of [12, 7, 5]) put(s, f, 2);
      for (let s = nStr - 1; s >= 0; s--) for (const f of [5, 7, 12]) put(s, f, 2);
    } else {
      for (let s = 0; s < nStr; s++) for (const f of [12, 7, 5, 4]) put(s, f, 4);
    }
    const end = Math.ceil(slot / 16) * 16; if (end > slot) notes[notes.length - 1].len += end - slot;
    return finish({ title: `하모닉스 · ${({ natural: '자연 하모닉 위치', arpeggio: '하모닉 아르페지오', tuning: '하모닉 튜닝' })[o.type]}`, technique: 'harmonics', tuning: o.tuning, bpm: o.bpm, beats: 4, notes,
      desc: '프렛 바로 위(프렛 사이가 아니라 금속 프렛 선 위)를 손가락으로 살짝만 대고, 치자마자 떼세요. 브리지 가까이를 치면 더 잘 울립니다.' });
  }

  // ------------------------------------------------------------ 그루브·고스트노트 (핑거스타일)
  // R 근음 · 5 5도 · O 옥타브 · b ♭7 · 3 3도 · x 고스트 · . 쉼 · - 앞 음 이어서
  const GROOVES = {
    rock: ['R.R.R.R.R.R.R.R.', 'R.R.R.R.R.R.5.O.'],
    pop: ['R..R..R.R.5.O...', 'R...R..5R...O.5.'],
    rnb: ['R--x.RxR..5.b.O.', 'R--x.R.x5..xO.b.'],
    funk: ['R.xRx.Rx.R.xO.bx', 'RxxR.xRxx.R.Ox5x'],
    reggae: ['....R.R...5.O...', '....R-5.R...3.5.'],
    motown: ['R..5O.R.3..5R.5.', 'R.5.O..b5..3R...'],
    metal: ['RRRRRRRRRRRRRRRR', 'RRRR5555RRRR5555'],
    latin: ['R..5..5.R..5..5.', 'R..5..O.R..5..5.'],
  };
  function grooveExercise(o) {
    o = Object.assign({ key: 'A', genre: 'rnb', progression: null, bars: 4, tuning: '4std', bpm: 90, seed: 5 }, o);
    const prog = PROGRESSIONS[o.progression || ({ rock: 'rock', pop: 'pop', rnb: 'soul', funk: 'funk', reggae: 'pop', motown: 'pop', metal: 'rock', latin: 'iiVI' })[o.genre] || 'pop'];
    const keyPc = KEY_PC[o.key] ?? 9, tpls = GROOVES[o.genre] || GROOVES.pop, open = openOf(o.tuning), notes = [];
    for (let b = 0; b < o.bars; b++) {
      const [rt, ty] = chordAt(prog, b, false), tones = CHORDS[ty] || CHORDS.maj;
      let r = open[0]; while ((r % 12 + 12) % 12 !== (keyPc + rt) % 12) r++;
      if (r - open[0] > 7) r -= 0; // E줄 0~11프렛 범위
      const tpl = tpls[b % tpls.length];
      for (let k = 0; k < 16; k++) {
        const c = tpl[k]; if (c === '.' || c === '-') continue;
        let len = 1; while (k + len < 16 && tpl[k + len] === '-') len++;
        if (len === 1) { let l2 = 1; while (k + l2 < 16 && tpl[k + l2] === '.' && l2 < 2) l2++; len = c === 'x' ? 1 : l2; }
        const slot = b * 16 + k;
        if (c === 'x') { notes.push({ slot, len: 1, dead: true, ghost: true, midi: null, string: null, _ghostOf: r }); continue; }
        const iv = c === 'R' ? 0 : c === '5' ? 7 : c === 'O' ? 12 : c === 'b' ? 10 : c === '3' ? (tones.includes(3) ? 3 : 4) : 0;
        notes.push({ slot, len, midi: r + iv });
      }
    }
    placeFrets(notes, o.tuning, 0, 7);
    // 고스트 노트는 바로 앞 음과 같은 줄
    notes.forEach((n, i) => { if (n.dead) { const p = notes.slice(0, i).reverse().find(x => !x.dead) || notes.find(x => !x.dead); n.string = p ? p.string : 1; n.fret = null; delete n._ghostOf; } });
    return finish({ title: `그루브 · ${o.key} ${({ rock: '록 8비트', pop: '팝', rnb: 'R&B 고스트노트', funk: '펑크 16비트', reggae: '레게 원드롭', motown: '모타운', metal: '메탈 질주', latin: '라틴 툼바오' })[o.genre] || o.genre}`, technique: 'groove', key: o.key, tuning: o.tuning, bpm: o.bpm, beats: 4, notes,
      desc: 'x는 고스트 노트: 왼손으로 줄을 누르지 않고 살짝 대서 "툭" 소리만 냅니다. 음 길이(쉼표 위치)를 정확히 지키는 게 그루브의 핵심입니다.' });
  }

  // ------------------------------------------------------------ 해머링·풀링
  function legatoExercise(o) {
    o = Object.assign({ position: 5, tuning: '4std', bpm: 70, type: 'trill' }, o);
    const open = openOf(o.tuning), nStr = open.length, notes = [], P = o.position; let slot = 0;
    const put = (s, f, tech) => { notes.push({ slot, len: 1, string: s, fret: f, tech }); slot += 1; };
    if (o.type === 'trill') {
      for (let s = 0; s < nStr; s++) for (const [a, b] of [[P, P + 2], [P, P + 3]]) { put(s, a); put(s, b, 'h'); put(s, a, 'p'); put(s, b, 'h'); put(s, a, 'p'); put(s, b, 'h'); put(s, a, 'p'); put(s, b, 'h'); }
    } else {
      // 3음 레가토: 피킹 1번 + 해머 2번 / 피킹 1번 + 풀 2번
      for (let s = 0; s < nStr; s++) { put(s, P); put(s, P + 2, 'h'); put(s, P + 4, 'h'); put(s, P + 4); put(s, P + 2, 'p'); put(s, P, 'p'); }
      for (let s = nStr - 1; s >= 0; s--) { put(s, P); put(s, P + 2, 'h'); put(s, P + 4, 'h'); put(s, P + 4); put(s, P + 2, 'p'); put(s, P, 'p'); }
    }
    const end = Math.ceil(slot / 16) * 16; if (end > slot) notes[notes.length - 1].len += end - slot;
    return finish({ title: `해머링·풀링 · ${o.type === 'trill' ? '트릴' : '3음 레가토'} (${P}프렛)`, technique: 'legato', tuning: o.tuning, bpm: o.bpm, beats: 4, notes,
      desc: 'H = 해머링(손가락으로 내리쳐 소리 내기), P = 풀링(손가락을 옆으로 튕기며 떼기). 피킹한 음과 음량이 같아지도록 연습하세요.' });
  }

  /** 기술·장르별 규칙 생성 (AI 없이) */
  function generate(o) {
    const t = o.technique;
    const seed = o.seed || Math.floor(Math.random() * 1e6);
    if (t === 'scale') return scaleExercise(Object.assign({ scale: o.scale || (o.genre === 'blues' ? 'blues' : o.genre === 'jazz' ? 'dorian' : 'major') }, o));
    if (t === 'walking') return walkingExercise(Object.assign({ progression: o.progression || (o.genre === 'jazz' ? 'iiVI' : 'blues'), seed }, o));
    if (t === 'slap') return slapExercise(Object.assign({ level: o.level || (o.genre === 'disco' ? 'disco' : o.difficulty === 'beginner' ? 'beginner' : o.difficulty === 'advanced' ? 'advanced' : 'funk'), progression: o.genre === 'disco' ? 'disco' : 'funk', seed }, o));
    if (t === 'harmonics') return harmonicsExercise(o);
    if (t === 'legato') return legatoExercise(o);
    if (t === 'fingering') return fingeringExercise(o);
    return grooveExercise(Object.assign({ genre: ({ rock: 'rock', pop: 'pop', funk: 'funk', rnb: 'rnb', soul: 'motown', reggae: 'reggae', metal: 'metal', latin: 'latin', jazz: 'motown', blues: 'motown', disco: 'funk', gospel: 'rnb', hiphop: 'rnb' })[o.genre] || 'pop', seed }, o));
  }

  /** 하모닉 음높이 */
  const harmPitch = (open, s, f) => open[s] + (HARM_PITCH[f] ?? 12);

  const BassTheory = { TUNINGS, KEYS, KEY_PC, SCALES, CHORDS, PROGRESSIONS, TECHNIQUES, PERMS, SLAP_TEMPLATES, GROOVES, HARM_PITCH, noteName, rootMidi, scaleExercise, fingeringExercise, walkingExercise, slapExercise, harmonicsExercise, grooveExercise, legatoExercise, generate, finish, placeFrets, harmPitch, openOf, rng };
  if (typeof module !== 'undefined' && module.exports) module.exports = BassTheory; else root.BassTheory = BassTheory;
})(typeof self !== 'undefined' ? self : this);
