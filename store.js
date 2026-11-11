// store.js — 저장소: 항상 이 기기에 저장하고, Google로 로그인하면 Firebase(Firestore)에도 같이 저장해 기기끼리 맞춤
// 모음: tabs(악보), sessions(연습 기록), pdfs(PDF 정보), settings(설정 1개 'main')
// PDF 파일 자체는 이 기기 IndexedDB + 로그인 시 Firestore에 900KB 조각으로 나눠 저장
const FB = 'https://www.gstatic.com/firebasejs/10.12.2/';
const COLS = ['tabs', 'sessions', 'pdfs', 'settings'];
const CHUNK = 900 * 1024;
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// ---------------------------------------------------------------- IndexedDB (PDF 파일)
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('bass-practice', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('files');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function idbDo(mode, fn) {
  const db = await idb();
  return new Promise((res, rej) => { const tx = db.transaction('files', mode), st = tx.objectStore('files'); const r = fn(st); tx.oncomplete = () => res(r && r.result); tx.onerror = () => rej(tx.error); });
}
const idbPut = (k, v) => idbDo('readwrite', st => st.put(v, k));
const idbGet = k => idbDo('readonly', st => st.get(k));
const idbDel = k => idbDo('readwrite', st => st.delete(k));

export class Store {
  constructor() {
    this.user = null; this.ns = 'local'; this.data = {}; this.fb = null; this.cfgOk = false; this.listeners = []; this.status = '이 기기에만 저장';
    this.loadLocal();
  }
  onChange(fn) { this.listeners.push(fn); }
  emit(what) { this.listeners.forEach(f => { try { f(what); } catch (e) { console.error(e); } }); }
  key(col) { return `bp.${this.ns}.${col}`; }
  loadLocal() {
    this.data = {};
    for (const c of COLS) { try { this.data[c] = JSON.parse(localStorage.getItem(this.key(c)) || '{}'); } catch (e) { this.data[c] = {}; } }
  }
  saveLocal(col) { try { localStorage.setItem(this.key(col), JSON.stringify(this.data[col])); } catch (e) { console.warn('로컬 저장 실패', e); } }

  // ---------------------------------------------------------------- Firebase
  async init(cfg) {
    this.cfgOk = !!(cfg && cfg.apiKey && cfg.projectId && cfg.authDomain);
    if (!this.cfgOk) { this.emit('auth'); return; }
    try {
      const [app, auth, fs] = await Promise.all([import(FB + 'firebase-app.js'), import(FB + 'firebase-auth.js'), import(FB + 'firebase-firestore.js')]);
      const a = app.initializeApp(cfg);
      this.fb = { auth: auth.getAuth(a), db: fs.getFirestore(a), A: auth, F: fs };
      this.fb.auth.languageCode = 'ko';
      try { await auth.getRedirectResult(this.fb.auth); } catch (e) { this.lastError = e; }
      auth.onAuthStateChanged(this.fb.auth, u => this.setUser(u));
    } catch (e) { this.fb = null; this.lastError = e; this.status = '로그인 기능을 불러오지 못했습니다'; this.emit('auth'); }
  }
  /** 반드시 버튼 탭 안에서 바로 호출 (팝업 차단 방지) */
  signIn() {
    if (!this.fb) return Promise.reject(new Error(this.cfgOk ? '로그인 기능을 아직 불러오는 중입니다' : 'Firebase 설정이 비어 있습니다 (README 참고)'));
    const { A, auth } = this.fb, p = new A.GoogleAuthProvider();
    p.setCustomParameters({ prompt: 'select_account' });
    return A.signInWithPopup(auth, p).catch(e => {
      if (/popup-blocked|operation-not-supported/.test(e.code || '')) return A.signInWithRedirect(auth, p);
      throw e;
    });
  }
  async signOut() { if (this.fb) await this.fb.A.signOut(this.fb.auth); }
  async setUser(u) {
    this.user = u ? { uid: u.uid, name: u.displayName || '', email: u.email || '', photo: u.photoURL || '' } : null;
    this.ns = u ? u.uid : 'local';
    this.loadLocal();
    this.status = u ? '동기화 중…' : '이 기기에만 저장';
    this.emit('auth');
    if (!u) { this.emit('data'); return; }
    try {
      await this.pull();
      // 로그인 전에 이 기기에 저장한 것을 계정으로 옮김 (처음 한 번)
      const mk = 'bp.migrated.' + u.uid;
      if (!localStorage.getItem(mk)) {
        const old = {}; for (const c of COLS) { try { old[c] = JSON.parse(localStorage.getItem(`bp.local.${c}`) || '{}'); } catch (e) { old[c] = {}; } }
        for (const c of COLS) for (const id in old[c]) if (!this.data[c][id]) { await this.put(c, old[c][id], { keepTime: true }); if (c === 'pdfs') { const blob = await idbGet('local:' + id); if (blob) { const n = await this.putPdfFile(id, blob); if (n) await this.put('pdfs', Object.assign({}, this.data.pdfs[id], { chunks: n }), { keepTime: true }); } } }
        try { localStorage.setItem(mk, '1'); } catch (e) { /* 무시 */ }
      }
      this.status = '계정에 저장 중';
    } catch (e) { this.lastError = e; this.status = '동기화 실패: ' + (e.code || e.message); }
    this.emit('auth'); this.emit('data');
  }
  udoc(...p) { return this.fb.F.doc(this.fb.db, 'users', this.user.uid, ...p); }
  ucol(c) { return this.fb.F.collection(this.fb.db, 'users', this.user.uid, c); }
  async pull() {
    const F = this.fb.F;
    for (const c of COLS) {
      const snap = await F.getDocs(this.ucol(c));
      const m = {};
      snap.forEach(d => { const v = d.data(); try { m[d.id] = JSON.parse(v.json); } catch (e) { /* 손상된 문서 건너뜀 */ } });
      // 이 기기에만 있고 아직 안 올라간 것은 유지
      for (const id in this.data[c]) if (!m[id] && this.data[c][id]._pending) m[id] = this.data[c][id];
      this.data[c] = m; this.saveLocal(c);
    }
  }
  // ---------------------------------------------------------------- 읽기·쓰기
  list(col) { return Object.values(this.data[col] || {}).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)); }
  get(col, id) { return (this.data[col] || {})[id] || null; }
  async put(col, obj, o = {}) {
    const v = JSON.parse(JSON.stringify(obj));
    v.id = v.id || uid(); if (!o.keepTime || !v.updatedAt) v.updatedAt = Date.now(); v.createdAt = v.createdAt || v.updatedAt;
    delete v._pending;
    this.data[col][v.id] = v; this.saveLocal(col); this.emit('data');
    if (this.user && this.fb) {
      try { await this.fb.F.setDoc(this.udoc(col, v.id), { json: JSON.stringify(v), updatedAt: v.updatedAt }); }
      catch (e) { v._pending = true; this.saveLocal(col); this.lastError = e; this.status = '계정 저장 실패 (이 기기에는 저장됨)'; this.emit('auth'); }
    }
    return v;
  }
  async del(col, id) {
    delete this.data[col][id]; this.saveLocal(col); this.emit('data');
    if (this.user && this.fb) { try { await this.fb.F.deleteDoc(this.udoc(col, id)); } catch (e) { this.lastError = e; } }
  }
  settings() { return this.get('settings', 'main') || { id: 'main' }; }
  async saveSettings(patch) { return this.put('settings', Object.assign({}, this.settings(), patch, { id: 'main' })); }

  // ---------------------------------------------------------------- PDF 파일
  async putPdfFile(id, blob) {
    await idbPut(this.ns + ':' + id, blob);
    if (this.user && this.fb) {
      const F = this.fb.F, u8 = new Uint8Array(await blob.arrayBuffer()), n = Math.ceil(u8.length / CHUNK);
      for (let k = 0; k < n; k++) await F.setDoc(this.udoc('pdfchunks', `${id}_${k}`), { k, n, data: F.Bytes.fromUint8Array(u8.subarray(k * CHUNK, (k + 1) * CHUNK)) });
      return n;
    }
    return 0;
  }
  async getPdfFile(id) {
    let b = await idbGet(this.ns + ':' + id);
    if (b) return b;
    const meta = this.get('pdfs', id);
    if (this.user && this.fb && meta && meta.chunks) {
      const F = this.fb.F, parts = [];
      for (let k = 0; k < meta.chunks; k++) { const d = await F.getDoc(this.udoc('pdfchunks', `${id}_${k}`)); if (!d.exists()) throw new Error('PDF 조각이 없습니다'); parts.push(d.data().data.toUint8Array()); }
      b = new Blob(parts, { type: 'application/pdf' });
      await idbPut(this.ns + ':' + id, b);
      return b;
    }
    return null;
  }
  async delPdf(id) {
    const meta = this.get('pdfs', id);
    await idbDel(this.ns + ':' + id).catch(() => {});
    if (this.user && this.fb && meta && meta.chunks) for (let k = 0; k < meta.chunks; k++) await this.fb.F.deleteDoc(this.udoc('pdfchunks', `${id}_${k}`)).catch(() => {});
    await this.del('pdfs', id);
  }
}
