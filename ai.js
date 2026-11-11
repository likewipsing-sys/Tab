/* BassAI — Gemini로 연습 악보 만들기 + 받은 결과 검사·정리 (검사 함수는 Node에서도 테스트 가능) */
(function (root) {
  'use strict';
  const T = (typeof module !== 'undefined' && module.exports) ? require('./theory.js') : root.BassTheory;

  const GENRES = { funk: '펑크', rock: '록', pop: '팝', jazz: '재즈', blues: '블루스', rnb: 'R&B·소울', disco: '디스코', metal: '메탈', reggae: '레게', latin: '라틴', gospel: '가스펠', hiphop: '힙합', country: '컨트리', fusion: '퓨전' };
  const DIFF = { beginner: '입문', easy: '초급', intermediate: '중급', advanced: '고급' };
  const TECH_EN = { scale: 'scale practice', fingering: 'two-finger plucking / fingering technique', walking: 'walking bass (quarter-note lines)', slap: 'slap and pop', harmonics: 'natural harmonics', groove: 'fingerstyle groove with ghost notes', legato: 'hammer-ons and pull-offs' };
  const HARM_FRETS = [12, 7, 5, 4, 9, 19, 16, 24];

  function stringNames(open) { const N = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']; return open.map(m => N[m % 12]); }

  function buildPrompt(o) {
    const open = T.openOf(o.tuning), names = stringNames(open);
    const strList = names.map((n, i) => `"${n}"${i === 0 ? '(가장 낮은 줄)' : i === names.length - 1 ? '(가장 높은 줄)' : ''}`).join(', ');
    const dens = { beginner: '음 수를 적게(마디당 2~6개), 프렛 0~5 위주, 16분음표는 거의 쓰지 않기', easy: '마디당 4~8개, 쉬운 리듬', intermediate: '마디당 6~12개, 싱코페이션 포함', advanced: '마디당 8~16개, 빠른 16분음표·주법 조합' }[o.difficulty] || '';
    return `당신은 베이스 기타 교사입니다. 학생이 연습할 베이스 악보를 만들어 주세요.
- 장르: ${GENRES[o.genre] || o.genre}
- 연습할 주법: ${T.TECHNIQUES[o.technique] || o.technique} (${TECH_EN[o.technique] || ''})
- 난이도: ${DIFF[o.difficulty] || o.difficulty} — ${dens}
- 조성: ${o.key}${o.scale ? ' ' + o.scale : ''}
- 길이: ${o.bars}마디, 박자 4/4, 템포 약 ${o.bpm} BPM
- 베이스 줄: ${strList}, 최고 프렛 ${o.maxFret || 20}
${o.extra ? '- 추가 요청: ' + o.extra + '\n' : ''}
규칙:
1. notes 배열의 각 음: bar(1부터), pos(마디 안 16분음표 위치 0~15), dur(16분음표 개수, 1 이상), string(위 줄 이름 중 하나), fret(정수, 데드·고스트 노트는 null), tech(앞 음과의 연결: "" | "h"(해머링) | "p"(풀링) | "s"(슬라이드)), art("" | "slap"(엄지) | "pop"(팝) | "ghost"(고스트·데드 노트) | "harmonic"(자연 하모닉, fret은 12·7·5·4 등 하모닉 위치) | "vibrato" | "bend").
2. 한 번에 한 음만 (같은 bar·pos에 두 음 금지). 음이 겹치지 않게 dur를 정하세요.
3. 해머링·풀링·슬라이드는 앞 음과 같은 줄에서만.
4. 실제로 손가락으로 치기 편한 운지(한 손 위치에서 4~5프렛 범위)로.
5. 장르 특유의 리듬과 ${T.TECHNIQUES[o.technique] || o.technique} 주법이 잘 드러나게. 마디마다 조금씩 변화를 주되 반복 연습하기 좋게.
6. chords: 마디별 코드 이름 배열(${o.bars}개).
7. tips: 이 연습을 할 때 주의할 점 2~4개 (한국어, 짧게).`;
  }

  const SCHEMA = {
    type: 'OBJECT',
    properties: {
      title: { type: 'STRING' }, description: { type: 'STRING' }, bpm: { type: 'NUMBER' }, swing: { type: 'BOOLEAN' },
      chords: { type: 'ARRAY', items: { type: 'STRING' } }, tips: { type: 'ARRAY', items: { type: 'STRING' } },
      notes: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
        bar: { type: 'INTEGER' }, pos: { type: 'INTEGER' }, dur: { type: 'INTEGER' }, string: { type: 'STRING' }, fret: { type: 'INTEGER', nullable: true },
        tech: { type: 'STRING', enum: ['', 'h', 'p', 's'] }, art: { type: 'STRING', enum: ['', 'slap', 'pop', 'ghost', 'harmonic', 'vibrato', 'bend'] } },
        required: ['bar', 'pos', 'dur', 'string', 'fret'] } },
    },
    required: ['title', 'notes'],
  };

  /** Gemini 결과 → 악보. 잘못된 음은 고치거나 버리고, 무엇을 고쳤는지 fixes에 남김 */
  function toTab(raw, o) {
    const open = T.openOf(o.tuning), names = stringNames(open), maxF = o.maxFret || 24, bars = o.bars || 8;
    const fixes = [];
    if (!raw || !Array.isArray(raw.notes)) throw new Error('AI 답에 음표 목록이 없습니다');
    const sIdx = s => {
      if (typeof s === 'number') return s >= 1 && s <= open.length ? s - 1 : -1;
      const t = String(s || '').trim().toUpperCase().replace(/줄|STRING/g, '').trim();
      let i = names.findIndex(n => n.toUpperCase() === t);
      if (i < 0 && /^\d$/.test(t)) i = +t - 1;
      if (i < 0 && t === 'LOW B') i = names.indexOf('B');
      return i;
    };
    const notes = [];
    const used = new Set();
    let dropped = 0;
    for (const r of raw.notes) {
      const bar = Math.round(+r.bar), pos = Math.round(+r.pos);
      if (!(bar >= 1 && bar <= bars && pos >= 0 && pos <= 15)) { dropped++; continue; }
      const slot = (bar - 1) * 16 + pos;
      if (used.has(slot)) { dropped++; continue; }
      const s = sIdx(r.string); if (s < 0 || s >= open.length) { dropped++; continue; }
      const art = String(r.art || '').toLowerCase(), dead = art === 'ghost' || r.fret == null;
      let fret = dead ? null : Math.round(+r.fret);
      if (!dead && !(fret >= 0 && fret <= maxF)) { dropped++; continue; }
      const n = { slot, len: Math.max(1, Math.min(16, Math.round(+r.dur) || 1)), string: s, fret };
      if (dead) { n.dead = true; n.ghost = true; n.midi = null; }
      if (art === 'slap') n.slap = true; else if (art === 'pop') n.pop = true;
      else if (art === 'harmonic') { if (HARM_FRETS.includes(fret)) { n.harm = true; n.midi = T.harmPitch(open, s, fret); } else fixes.push(`${bar}마디: ${fret}프렛은 자연 하모닉 위치가 아니라 일반 음으로 바꿈`); }
      else if (art === 'vibrato') n.vib = true; else if (art === 'bend') { n.bend = 1; }
      const tech = String(r.tech || '').toLowerCase();
      if (['h', 'p', 's'].includes(tech)) n.tech = tech;
      used.add(slot); notes.push(n);
    }
    notes.sort((a, b) => a.slot - b.slot);
    // 겹침 정리, 레가토 모순 정리
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i], nx = notes[i + 1], pv = notes[i - 1];
      if (nx && n.slot + n.len > nx.slot) n.len = nx.slot - n.slot;
      if (n.tech && (!pv || pv.dead || n.dead || pv.string !== n.string || pv.slot + pv.len < n.slot - 1)) { fixes.push(`${Math.floor(n.slot / 16) + 1}마디: 앞 음과 다른 줄이라 ${({ h: '해머링', p: '풀링', s: '슬라이드' })[n.tech]} 표시를 뺌`); delete n.tech; }
      else if (n.tech === 'h' && pv.fret >= n.fret) n.tech = pv.fret > n.fret ? 'p' : 's';
      else if (n.tech === 'p' && pv.fret <= n.fret) n.tech = pv.fret < n.fret ? 'h' : 's';
      if (n.tech === 's' && pv && pv.fret === n.fret) delete n.tech;
    }
    if (dropped) fixes.push(`잘못된 음 ${dropped}개를 뺌`);
    if (notes.filter(n => !n.dead).length < Math.max(2, bars)) throw new Error('AI가 만든 음이 너무 적습니다. 다시 만들어 보세요');
    const tab = T.finish({
      title: String(raw.title || `${GENRES[o.genre] || o.genre} ${T.TECHNIQUES[o.technique] || ''}`).slice(0, 80),
      desc: String(raw.description || '').slice(0, 400), tips: (raw.tips || []).map(String).slice(0, 5),
      chords: Array.isArray(raw.chords) ? raw.chords.map(String).slice(0, bars) : null,
      technique: o.technique, genre: o.genre, difficulty: o.difficulty, key: o.key, tuning: o.tuning,
      bpm: Math.round(Math.min(240, Math.max(40, +raw.bpm || o.bpm || 90))), beats: 4, swing: !!raw.swing, source: 'ai', bars, notes,
    });
    tab.fixes = fixes;
    return tab;
  }

  async function generate(o, key, model, signal) {
    const url = `https://generativelanguage.googleapis.com/v1beta/${model}:generateContent`;
    const call = async useSchema => {
      const body = { contents: [{ role: 'user', parts: [{ text: buildPrompt(o) }] }], generationConfig: { temperature: 0.8, responseMimeType: 'application/json' } };
      if (useSchema) body.generationConfig.responseSchema = SCHEMA;
      const r = await fetch(url, { method: 'POST', signal, headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { const e = new Error((d.error && d.error.message) || ('Gemini 오류 ' + r.status)); e.status = r.status; throw e; }
      const c = d.candidates && d.candidates[0];
      const text = c && c.content ? (c.content.parts || []).filter(p => !p.thought && p.text).map(p => p.text).join('') : '';
      if (!text) throw new Error('Gemini가 답하지 않았습니다');
      try { return JSON.parse(text); } catch (e) { const m = text.match(/\{[\s\S]*\}/); if (m) return JSON.parse(m[0]); throw new Error('Gemini 답을 읽지 못했습니다'); }
    };
    let raw;
    try { raw = await call(true); }
    catch (e) { if (e.status === 400 && /schema|responseSchema/i.test(e.message)) raw = await call(false); else throw e; }
    return toTab(raw, o);
  }

  const BassAI = { GENRES, DIFF, buildPrompt, toTab, generate, SCHEMA };
  if (typeof module !== 'undefined' && module.exports) module.exports = BassAI; else root.BassAI = BassAI;
})(typeof self !== 'undefined' ? self : this);
