import { firebaseConfig, FIREBASE_SDK_VERSION } from './firebase-config.js';

(() => {
'use strict';

/* ---------- definitions ---------- */
const MAX_DS = 10, MIN_ANALYSIS = 3;
const MODES = {
  team:   {label:'チームスタッツ集計モード', short:'チーム', desc:'チームと対戦相手のスタッツを1試合ごとに記録します。'},
  simple: {label:'チーム・個人簡易集計モード', short:'簡易', desc:'チームスタッツに加えて、ゴール・アシスト、出場GKのセーブ数とセーブ率、イエロー・レッドカードを記録します。'},
  detail: {label:'チーム・個人詳細集計モード', short:'詳細', desc:'簡易集計に加えて、選手ごとの出場有無と出場試合数を記録し、欠場試合を分析に含めるかを切り替えられます。'}
};
const OWN = [
  {k:'poss', l:'支配率', u:'%', max:100},
  {k:'shots', l:'シュート数'},
  {k:'sot', l:'枠内シュート数'},
  {k:'fouls', l:'ファウル'},
  {k:'offsides', l:'オフサイド'},
  {k:'corners', l:'コーナーキック数'},
  {k:'fks', l:'フリーキック数'},
  {k:'passes', l:'パス数'},
  {k:'passOk', l:'パス成功数'},
  {k:'crosses', l:'クロス'},
  {k:'intercepts', l:'パスカット'},
  {k:'tackles', l:'タックル成功'},
  {k:'saves', l:'セーブ数'}
];
const OPP = [
  {k:'poss', l:'支配率', u:'%', max:100},
  {k:'shots', l:'被シュート数'},
  {k:'sot', l:'被枠内シュート数'},
  {k:'fouls', l:'被ファウル数'},
  {k:'passes', l:'パス数'},
  {k:'passOk', l:'パス成功数'},
  {k:'saves', l:'被セーブ数'}
];
const CMP = [
  ['poss','支配率','%'],['shots','シュート'],['sot','枠内シュート'],['fouls','ファウル'],
  ['passes','パス数'],['passOk','パス成功数'],['passRate','パス成功率','%'],['saves','セーブ']
];

/* ---------- utils ---------- */
const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone = o => JSON.parse(JSON.stringify(o ?? null));
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const toNum = v => { if (v === '' || v == null) return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const rid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const fmt = (v, d=1) => isNum(v) ? (Math.round(v * 10**d) / 10**d).toFixed(d) : '—';
const fmtInt = v => isNum(v) ? String(Math.round(v)) : '—';
const pct = (a, b) => (isNum(a) && isNum(b) && b > 0) ? a / b * 100 : null;
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const md = s => { if (!s) return ''; const p = s.split('-'); return p.length === 3 ? `${+p[1]}/${+p[2]}` : s; };
const normName = s => String(s || '').trim().replace(/\s+/g, ' ');

/* ---------- stores ---------- */
/* Firestore layout: users/{uid}/datasets/{datasetId} and users/{uid}/datasets/{datasetId}/matches/{matchId} */
class CloudStore {
  constructor(FS, db, uid) { this.FS = FS; this.db = db; this.uid = uid; }
  dcol() { return this.FS.collection(this.db, 'users', this.uid, 'datasets'); }
  mcol(dsId) { return this.FS.collection(this.db, 'users', this.uid, 'datasets', dsId, 'matches'); }
  async listDatasets() {
    const s = await this.FS.getDocs(this.dcol());
    return s.docs.map(d => ({...clone(d.data()), id: d.id}));
  }
  async putDataset(ds) { const {id, ...rest} = ds; await this.FS.setDoc(this.FS.doc(this.dcol(), id), clone(rest)); }
  async listMatches(dsId) {
    const s = await this.FS.getDocs(this.mcol(dsId));
    return s.docs.map(d => ({...clone(d.data()), id: d.id}));
  }
  async putMatch(dsId, m) { const {id, ...rest} = m; await this.FS.setDoc(this.FS.doc(this.mcol(dsId), id), clone(rest)); }
  async putMatches(dsId, ms) {
    for (let i = 0; i < ms.length; i += 400) {
      const b = this.FS.writeBatch(this.db);
      ms.slice(i, i + 400).forEach(m => { const {id, ...rest} = m; b.set(this.FS.doc(this.mcol(dsId), id), clone(rest)); });
      await b.commit();
    }
  }
  async delMatch(dsId, id) { await this.FS.deleteDoc(this.FS.doc(this.mcol(dsId), id)); }
  async delDataset(id) {
    const s = await this.FS.getDocs(this.mcol(id));
    const refs = s.docs.map(d => d.ref);
    for (let i = 0; i < refs.length; i += 400) {
      const b = this.FS.writeBatch(this.db);
      refs.slice(i, i + 400).forEach(r => b.delete(r));
      await b.commit();
    }
    await this.FS.deleteDoc(this.FS.doc(this.dcol(), id));
  }
}
class LocalStore {
  constructor(key, seed) { this.key = key; this.mem = seed || null; }
  _load() {
    if (this.key) { try { const r = localStorage.getItem(this.key); if (r) return JSON.parse(r); } catch (e) {} }
    return this.mem || {ds:{}, m:{}};
  }
  _save(o) { this.mem = o; if (this.key) { try { localStorage.setItem(this.key, JSON.stringify(o)); } catch (e) {} } }
  async listDatasets() { return Object.values(this._load().ds).map(clone); }
  async putDataset(ds) { const o = this._load(); o.ds[ds.id] = clone(ds); this._save(o); }
  async listMatches(id) { return Object.values(this._load().m[id] || {}).map(clone); }
  async putMatch(dsId, m) { const o = this._load(); (o.m[dsId] = o.m[dsId] || {})[m.id] = clone(m); this._save(o); }
  async delMatch(dsId, id) { const o = this._load(); if (o.m[dsId]) delete o.m[dsId][id]; this._save(o); }
  async delDataset(id) { const o = this._load(); delete o.ds[id]; delete o.m[id]; this._save(o); }
  async putMatches(dsId, ms) { for (const m of ms) await this.putMatch(dsId, m); }
}

/* ---------- state ---------- */
const S = { main:null, store:null, fb:null, user:null, datasets:[], cur:null, matches:[], tab:'matches', demo:false, denom:'played' };
const app = $('#app');

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}
function errMsg(e) {
  const c = e && e.code;
  if (c === 'permission-denied' || c === 'unauthenticated') return '保存できませんでした。ログインし直してからもう一度お試しください。';
  if (c === 'resource-exhausted') return 'サーバーの利用上限に達しました。時間をおいてからもう一度お試しください。';
  if (c === 'unavailable') return 'オフラインのようです。通信できる状態でもう一度お試しください。';
  if (c === 'invalid-argument') return '保存できませんでした。入力内容が大きすぎる可能性があります。';
  return '通信に失敗しました。もう一度お試しください。';
}

/* ---------- computations ---------- */
const sortMatches = ms => ms.slice().sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999') || (a.createdAt || 0) - (b.createdAt || 0));
function summarize(ms) {
  const s = {n:ms.length, w:0, d:0, l:0, pkw:0, pkl:0, gf:0, ga:0};
  for (const m of ms) {
    if (m.result === 'W') { s.w++; if (m.pk) s.pkw++; }
    else if (m.result === 'L') { s.l++; if (m.pk) s.pkl++; }
    else s.d++;
    s.gf += m.gf || 0; s.ga += m.ga || 0;
  }
  return s;
}
const oppPoss = m => isNum(m.opp?.poss) ? m.opp.poss : (isNum(m.own?.poss) ? 100 - m.own.poss : null);
function statAgg(ms, side, k) {
  const vals = ms.map(m => side === 'opp' && k === 'poss' ? oppPoss(m) : m[side]?.[k]).filter(isNum);
  const sum = vals.reduce((a, b) => a + b, 0);
  return {sum, n: vals.length, avg: vals.length ? sum / vals.length : null};
}
function rateAgg(ms, side) {
  let ok = 0, all = 0, n = 0;
  for (const m of ms) { const p = m[side]?.passes, o = m[side]?.passOk; if (isNum(p) && isNum(o) && p > 0) { ok += o; all += p; n++; } }
  return {ok, all, n, rate: all > 0 ? ok / all * 100 : null};
}
function playerAgg(ms) {
  const P = {};
  const g = id => P[id] || (P[id] = {id, g:0, a:0, y:0, r:0, apps:0, starts:0, gk:0, sv:0, con:0, rs:0, rc:0, w:0, d:0, l:0});
  for (const m of ms) {
    for (const x of m.goals || []) { if (x.scorer) g(x.scorer).g++; if (x.assist) g(x.assist).a++; }
    for (const c of m.cards || []) { if (!c.pid) continue; if (c.type === 'R') g(c.pid).r++; else g(c.pid).y++; }
    for (const k of m.gks || []) {
      if (!k.pid) continue; const p = g(k.pid); p.gk++;
      if (isNum(k.saves)) p.sv += k.saves;
      if (isNum(k.conceded)) p.con += k.conceded;
      if (isNum(k.saves) && isNum(k.conceded)) { p.rs += k.saves; p.rc += k.conceded; }
    }
    for (const [pid, st] of Object.entries(m.apps || {})) {
      if (st !== 'S' && st !== 'B') continue;
      const p = g(pid); p.apps++; if (st === 'S') p.starts++;
      if (m.result === 'W') p.w++; else if (m.result === 'L') p.l++; else p.d++;
    }
  }
  return P;
}
function pname(pid) { const p = (S.cur?.players || []).find(x => x.id === pid); return p ? p.name : '（削除済み）'; }

/* ---------- boot & sign-in ---------- */
const SDK = `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/`;
const configReady = () => !!(firebaseConfig && firebaseConfig.apiKey && !/^YOUR_|^<|xxxx/i.test(firebaseConfig.apiKey) && firebaseConfig.projectId && !/^YOUR_/i.test(firebaseConfig.projectId));
const isInApp = () => /\bLine\/|FBAN|FBAV|Instagram|Twitter|MicroMessenger|TikTok|BytedanceWebview|; wv\)/i.test(navigator.userAgent || '');

async function boot() {
  renderAcct();
  if (!configReady()) { renderSetup(); return; }
  try {
    const [A, FA, FS] = await Promise.all([import(SDK + 'firebase-app.js'), import(SDK + 'firebase-auth.js'), import(SDK + 'firebase-firestore.js')]);
    const fapp = A.initializeApp(firebaseConfig);
    const auth = FA.getAuth(fapp); auth.languageCode = 'ja';
    let db;
    try { db = FS.initializeFirestore(fapp, {localCache: FS.persistentLocalCache({tabManager: FS.persistentMultipleTabManager()})}); }
    catch (e) { db = FS.getFirestore(fapp); }
    S.fb = {FA, FS, auth, db};
    FA.getRedirectResult(auth).catch(authError);
    FA.onAuthStateChanged(auth, onUser);
  } catch (e) {
    console.error(e);
    app.innerHTML = `<section class="panel"><h2>読み込みに失敗しました</h2><p class="muted">通信状態を確認して、ページを再読み込みしてください。</p></section>`;
  }
}
function onUser(user) {
  S.user = user || null;
  S.main = user ? new CloudStore(S.fb.FS, S.fb.db, user.uid) : null;
  renderAcct();
  if (S.demo) return;
  closeModal();
  loadHome();
}
function renderAcct() {
  const a = $('#acct'); if (!a) return;
  if (S.user) {
    a.className = 'acct cloud';
    a.innerHTML = `<i class="dot"></i><span title="このアカウントに保存">${esc(S.user.email || S.user.displayName || 'ログイン中')}</span><button class="btn ghost sm" data-act="logout">ログアウト</button>`;
  } else {
    a.className = 'acct';
    a.innerHTML = S.fb ? `<button class="btn sm" data-act="login">ログイン</button>` : '';
  }
}
async function login() {
  if (!S.fb) return;
  const {FA, auth} = S.fb;
  const p = new FA.GoogleAuthProvider();
  p.setCustomParameters({prompt: 'select_account'});
  try { await FA.signInWithPopup(auth, p); }
  catch (e) {
    if (e && (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment')) {
      try { await FA.signInWithRedirect(auth, p); } catch (e2) { authError(e2); }
      return;
    }
    authError(e);
  }
}
function authError(e) {
  const c = e && e.code;
  if (!c || c === 'auth/popup-closed-by-user' || c === 'auth/cancelled-popup-request' || c === 'auth/user-cancelled') return;
  if (c === 'auth/unauthorized-domain') { toast('このURLはログインが許可されていません。管理者はFirebaseの「承認済みドメイン」にこのドメインを追加してください。'); return; }
  if (c === 'auth/network-request-failed') { toast('通信に失敗しました。もう一度お試しください。'); return; }
  if (c === 'auth/web-storage-unsupported' || c === 'auth/internal-error') { toast('このブラウザではログインできません。SafariやChromeで開いてください。'); return; }
  toast('ログインできませんでした（' + c + '）');
}
async function logout() {
  if (!S.fb) return;
  try { await S.fb.FA.signOut(S.fb.auth); toast('ログアウトしました'); } catch (e) { toast('ログアウトできませんでした'); }
}

function renderLogin() {
  const inapp = isInApp();
  app.innerHTML = `<section class="login">
    <div class="login-main">
      <p class="eyebrow">eFootball Tournament Stats</p>
      <h1>大会ごとのスタッツを、<br>1試合ずつ記録して分析。</h1>
      <p class="lead">支配率・シュート・パス成功率から、得点者やGKのセーブ率まで。3試合を超えると、1試合あたりの平均が自動で出ます。</p>
      ${inapp ? `<div class="banner"><b>アプリ内ブラウザではGoogleログインができません。</b> 画面のメニューから「ブラウザで開く」を選ぶか、URLをコピーしてSafariやChromeで開いてください。
        <div style="margin-top:8px"><button class="btn sm" data-act="copy-url">URLをコピー</button></div></div>` : ''}
      <div class="login-actions">
        <button class="btn primary lg" data-act="login">Googleアカウントでログイン</button>
        <button class="btn lg" data-act="demo">ログインせずに見本を見る</button>
      </div>
      <p class="small muted">記録はあなたのGoogleアカウントに紐付けて保存され、ほかの人からは見えません。どの端末からでも、同じアカウントでログインすれば続きから使えます。</p>
    </div>
    <div class="mode-cols">${Object.entries(MODES).map(([k, m]) => `<div class="mode-col"><span class="mode-badge m-${k}">${m.short}</span><h3>${m.label}</h3><p>${m.desc}</p></div>`).join('')}</div>
  </section>`;
}
function renderSetup() {
  app.innerHTML = `<section class="panel">
    <h2>初期設定が必要です（管理者向け）</h2>
    <p class="muted" style="margin-bottom:10px">Firebaseの接続情報がまだ入っていません。<code>js/firebase-config.js</code> に、Firebaseコンソールで表示される設定値を貼り付けてください。手順はリポジトリの README.md にあります。</p>
    <p class="muted">設定前でも、見本データで画面を確認できます。</p>
    <div style="margin-top:12px"><button class="btn" data-act="demo">見本を見る</button></div>
  </section>`;
}

async function loadHome() {
  S.cur = null; S.matches = []; S.demo = false; S.store = S.main;
  if (!S.main) { S.datasets = []; if (configReady()) renderLogin(); else renderSetup(); return; }
  app.innerHTML = '<div class="loading">読み込み中…</div>';
  try { S.datasets = await S.store.listDatasets(); }
  catch (e) { S.datasets = []; toast(errMsg(e)); }
  S.datasets.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  renderHome();
}

/* ---------- home ---------- */
function renderHome() {
  const n = S.datasets.length, full = n >= MAX_DS;
  const pips = Array.from({length: MAX_DS}, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('');
  let body;
  if (!n) {
    body = `<section class="empty">
      <div><h2>最初の記録データを作りましょう</h2><p class="muted">大会ごとに1つのデータを作り、試合を1つずつ登録します。3試合を超えると平均値の分析が表示されます。記録データは最大${MAX_DS}件まで作成できます。</p></div>
      <div class="mode-cols">${Object.entries(MODES).map(([k, m]) => `<div class="mode-col"><span class="mode-badge m-${k}">${m.short}</span><h3>${m.label}</h3><p>${m.desc}</p></div>`).join('')}</div>
      <div class="empty-actions">
        <button class="btn primary" data-act="new-ds">＋ 記録データを作成</button>
        <button class="btn" data-act="demo">見本を見る（保存されません）</button>
        <button class="btn ghost" data-act="import">バックアップから読み込む</button>
      </div></section>`;
  } else {
    body = `<div class="ds-grid">${S.datasets.map(dsCard).join('')}
      <button class="ds-card ds-new" data-act="new-ds" ${full ? 'disabled' : ''}>${full ? '作成数の上限です<small>不要なデータを［設定］から削除すると作成できます</small>' : '＋ 新しい記録データ<small>あと' + (MAX_DS - n) + '件作成できます</small>'}</button>
    </div>
    <div class="home-tools">
      <button class="btn sm" data-act="import" ${full ? 'disabled' : ''}>バックアップから読み込む</button>
      <button class="btn sm ghost" data-act="demo">見本を見る</button>
    </div>`;
  }
  app.innerHTML = `
    <section>
      <div class="home-head">
        <div><p class="eyebrow">Tournament records</p><h1>記録データ</h1></div>
        <div class="slots"><div class="pips" aria-hidden="true">${pips}</div><div class="slots-label"><b class="tn">${n}</b> / ${MAX_DS} 件</div></div>
      </div>
      ${body}
    </section>`;
}
function dsCard(ds) {
  const s = ds.summary || {n:0, w:0, d:0, l:0};
  const upd = ds.updatedAt ? new Date(ds.updatedAt) : null;
  return `<button class="ds-card" data-act="open-ds" data-id="${esc(ds.id)}">
    <span class="mode-badge m-${esc(ds.mode)}">${esc(MODES[ds.mode]?.short || '')}</span>
    <span class="ds-name">${esc(ds.name)}</span>
    <span class="ds-rec"><span><b>${s.w}</b>勝</span><span><b>${s.d}</b>分</span><span><b>${s.l}</b>負</span></span>
    <span class="ds-meta">${s.n}試合${upd ? ' · 更新 ' + (upd.getMonth() + 1) + '/' + upd.getDate() : ''}</span>
  </button>`;
}

/* ---------- modal ---------- */
function openModal(html, narrow) {
  const root = $('#modal-root');
  root.innerHTML = `<div class="overlay" data-overlay><div class="sheet ${narrow ? 'narrow' : ''}" role="dialog" aria-modal="true">${html}</div></div>`;
  document.body.style.overflow = 'hidden';
  const f = root.querySelector('input:not([type=hidden]):not([readonly]),select,textarea');
  if (f && narrow) setTimeout(() => f.focus(), 30);
}
function setSaving(on, text) {
  $$('#modal-root .save-btn').forEach(b => { b.disabled = on; b.textContent = on ? (text || '保存中…') : (b.dataset.label || b.textContent); });
}
function closeModal() { $('#modal-root').innerHTML = ''; document.body.style.overflow = ''; }
document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('#modal-root').firstChild) closeModal(); });

function modeRadios(sel) {
  return `<div class="mode-pick">${Object.entries(MODES).map(([k, m]) => `
    <label class="mode-opt"><input type="radio" name="mode" value="${k}" ${sel === k ? 'checked' : ''}><b>${m.label}</b><p>${m.desc}</p></label>`).join('')}</div>`;
}

function newDatasetModal() {
  if (S.datasets.length >= MAX_DS) { toast('記録データは最大' + MAX_DS + '件です。不要なデータを削除してください。'); return; }
  openModal(`<form id="ds-form" novalidate>
    <div class="sheet-head"><h2>新しい記録データ</h2><div class="head-actions"><button type="button" class="btn ghost sm" data-act="close">閉じる</button><button type="submit" class="btn primary sm save-btn" data-label="作成する">作成する</button></div></div>
    <div class="sheet-body">
      <div class="field"><label for="ds-name">大会名・データ名 <span class="req">必須</span></label><input class="inp" id="ds-name" maxlength="60" placeholder="例：秋季オンラインカップ 2026" autocomplete="off"><span class="errs" id="ds-name-err" hidden>大会名・データ名を入力してください。</span></div>
      <div class="field"><label for="ds-memo">メモ（任意）</label><input class="inp" id="ds-memo" maxlength="120" placeholder="例：チーム名、フォーメーション など"></div>
      <div class="field"><span class="lab">集計モード</span>${modeRadios('simple')}</div>
      <p class="note">モードは作成後も［設定］から変更できます。</p>
    </div>
    <div class="sheet-foot"><div class="right"><button type="button" class="btn" data-act="close">キャンセル</button><button class="btn primary save-btn" type="submit" data-label="作成する">作成する</button></div></div>
  </form>`, true);
  $('#ds-name').addEventListener('input', () => { $('#ds-name').classList.remove('bad'); $('#ds-name-err').hidden = true; });
  $('#ds-form').addEventListener('submit', async e => {
    e.preventDefault();
    const name = normName($('#ds-name').value);
    if (!name) { $('#ds-name').classList.add('bad'); $('#ds-name-err').hidden = false; $('#ds-name').focus(); return; }
    const mode = $('#ds-form').querySelector('input[name=mode]:checked')?.value || 'team';
    const ds = {id: rid('ds'), name, memo: normName($('#ds-memo').value), mode, players: [], summary: {n:0,w:0,d:0,l:0,gf:0,ga:0}, createdAt: Date.now(), updatedAt: Date.now()};
    setSaving(true, '作成中…');
    try { await S.store.putDataset(ds); S.datasets.push(ds); closeModal(); openDataset(ds.id); toast('作成しました'); }
    catch (err) { setSaving(false); toast(errMsg(err)); }
  });
}

/* ---------- dataset view ---------- */
async function openDataset(id) {
  const ds = S.datasets.find(d => d.id === id); if (!ds) return;
  S.cur = ds; S.tab = 'matches';
  app.innerHTML = '<div class="loading">読み込み中…</div>';
  try { S.matches = sortMatches(await S.store.listMatches(id)); }
  catch (e) { S.matches = []; toast(errMsg(e)); }
  ds.players = ds.players || [];
  renderDataset();
  window.scrollTo(0, 0);
}
function refreshRoster() {
  $('#roster').innerHTML = (S.cur?.players || []).map(p => `<option value="${esc(p.name)}"></option>`).join('');
}
function renderDataset() {
  const ds = S.cur, s = summarize(S.matches);
  refreshRoster();
  const tabs = [['matches','試合'],['analysis','分析'], ...(ds.mode !== 'team' ? [['players','選手']] : []), ['settings','設定']];
  if (!tabs.some(t => t[0] === S.tab)) S.tab = 'matches';
  app.innerHTML = `
    ${S.demo ? '<div class="banner"><b>見本データです。</b> 自由に触れますが、内容は保存されません。一覧に戻ると元に戻ります。</div>' : ''}
    <div class="back"><button class="linkbtn" data-act="home">← 記録データ一覧</button></div>
    <header class="ds-head">
      <div class="ds-title"><span class="mode-badge m-${ds.mode}">${MODES[ds.mode].label}</span><h1>${esc(ds.name)}</h1>${ds.memo ? `<p>${esc(ds.memo)}</p>` : ''}</div>
      <div class="board" aria-label="通算成績">
        <div><b>${s.n}</b><span>試合</span></div>
        <div class="w"><b>${s.w}</b><span>勝</span></div>
        <div class="d"><b>${s.d}</b><span>分</span></div>
        <div class="l"><b>${s.l}</b><span>負</span></div>
        <div><b>${s.gf}</b><span>得点</span></div>
        <div><b>${s.ga}</b><span>失点</span></div>
      </div>
    </header>
    <nav class="tabs" role="tablist">${tabs.map(([k, l]) => `<button class="tab" role="tab" data-act="tab" data-tab="${k}" aria-selected="${S.tab === k}">${l}</button>`).join('')}</nav>
    <div id="tab-body">${tabHtml()}</div>`;
}
function tabHtml() {
  if (S.tab === 'analysis') return analysisHtml();
  if (S.tab === 'players') return playersHtml();
  if (S.tab === 'settings') return settingsHtml();
  return matchesHtml();
}
function rerenderTab() { const b = $('#tab-body'); if (b) b.innerHTML = tabHtml(); }

function resPill(m) {
  const t = m.result === 'W' ? '勝' : m.result === 'L' ? '負' : '分';
  return `<span class="res res-${m.result || 'D'}">${t}${m.pk ? '<small>PK</small>' : ''}</span>`;
}
function matchesHtml() {
  const ms = S.matches;
  if (!ms.length) return `<div class="none"><p>まだ試合が登録されていません。<br>勝敗とスコアだけで登録でき、スタッツは後から追加・修正できます。</p><button class="btn primary" data-act="new-match">＋ 試合を記録</button></div>`;
  const rows = ms.map((m, i) => ({m, i})).reverse().map(({m, i}) => {
    const mini = [];
    if (isNum(m.own?.poss)) mini.push('支配率 ' + m.own.poss + '%');
    if (isNum(m.own?.shots)) mini.push('シュート ' + m.own.shots + (isNum(m.opp?.shots) ? '-' + m.opp.shots : ''));
    const sub = [m.round, mini.join(' · ')].filter(Boolean).join(' ｜ ');
    return `<button class="match" data-act="edit-match" data-id="${esc(m.id)}">
      <span class="m-no">第${i + 1}戦<small>${esc(md(m.date)) || '日付なし'}</small></span>
      <span class="m-opp"><b>vs ${esc(m.opponent || '相手未登録')}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span>
      <span class="m-score">${m.gf}<i>-</i>${m.ga}</span>
      ${resPill(m)}
    </button>`;
  }).join('');
  return `<div class="bar"><h2>${ms.length}試合</h2><button class="btn primary" data-act="new-match">＋ 試合を記録</button></div>
    <div class="mlist">${rows}</div>
    <p class="note">試合をタップすると、スタッツの追加・修正・削除ができます。</p>`;
}

/* ---------- analysis ---------- */
function analysisHtml() {
  const ms = S.matches, s = summarize(ms), mode = S.cur.mode;
  if (s.n < MIN_ANALYSIS) {
    const left = MIN_ANALYSIS - s.n;
    return `<section class="panel lock">
      <h2>分析は${MIN_ANALYSIS}試合から表示されます</h2>
      <div class="lock-pips" aria-hidden="true">${Array.from({length: MIN_ANALYSIS}, (_, i) => `<i class="${i < s.n ? 'on' : ''}"></i>`).join('')}</div>
      <p class="muted">あと <b>${left}</b> 試合記録すると、1試合あたりの平均スタッツ${mode !== 'team' ? 'と選手別の集計' : ''}が表示されます。</p>
      <button class="btn primary" data-act="new-match">＋ 試合を記録</button>
    </section>`;
  }
  const own = {}, opp = {};
  OWN.forEach(d => own[d.k] = statAgg(ms, 'own', d.k));
  OPP.forEach(d => opp[d.k] = statAgg(ms, 'opp', d.k));
  own.passRate = rateAgg(ms, 'own'); opp.passRate = rateAgg(ms, 'opp');
  const winRate = s.w / s.n * 100;

  const kpis = `<section class="panel"><h2>通算成績 <small>${s.n}試合</small></h2><div class="kpis">
    <div class="kpi"><span>戦績</span><b>${s.w}-${s.d}-${s.l}</b><em>勝-分-負${s.pkw || s.pkl ? `（PK ${s.pkw}勝${s.pkl}敗を含む）` : ''}</em></div>
    <div class="kpi"><span>勝率</span><b>${fmt(winRate)}%</b><em>勝利数 ÷ 試合数</em></div>
    <div class="kpi"><span>平均得点</span><b>${fmt(s.gf / s.n, 2)}</b><em>総得点 ${s.gf}</em></div>
    <div class="kpi"><span>平均失点</span><b>${fmt(s.ga / s.n, 2)}</b><em>総失点 ${s.ga}</em></div>
    <div class="kpi"><span>得失点差</span><b>${s.gf - s.ga > 0 ? '+' : ''}${s.gf - s.ga}</b><em>1試合 ${fmt((s.gf - s.ga) / s.n, 2)}</em></div>
  </div></section>`;

  const cmpRows = CMP.map(([k, l, u]) => {
    const a = k === 'passRate' ? own.passRate.rate : own[k]?.avg;
    const b = k === 'passRate' ? opp.passRate.rate : opp[k]?.avg;
    if (!isNum(a) && !isNum(b)) return '';
    const A = isNum(a) ? a : 0, B = isNum(b) ? b : 0, T = A + B;
    const fa = T > 0 ? A / T : .5;
    return `<div class="cmp-row">
      <span class="v o">${fmt(a)}${u && isNum(a) ? '<small>' + u + '</small>' : ''}</span>
      <span class="lbl">${l}</span>
      <span class="v p">${fmt(b)}${u && isNum(b) ? '<small>' + u + '</small>' : ''}</span>
      <div class="split" aria-hidden="true"><span class="o" style="flex:${fa.toFixed(4)}"></span><span class="p" style="flex:${(1 - fa).toFixed(4)}"></span></div>
    </div>`;
  }).join('');
  const cmp = `<section class="panel"><h2>1試合平均の比較</h2>
    <div class="cmp-legend"><span class="o">自チーム</span><span class="p">対戦相手</span></div>
    <div class="cmp">${cmpRows || '<p class="muted">比較できるスタッツがまだ記録されていません。</p>'}</div></section>`;

  const tRow = (label, a, u, isRate) => `<tr><td>${label}</td>
    <td>${isRate ? (a.all ? `${a.ok}/${a.all}` : '—') : (a.n ? fmtInt(a.sum) : '—')}</td>
    <td><b>${isRate ? fmt(a.rate) : fmt(a.avg)}</b>${(isRate ? isNum(a.rate) : isNum(a.avg)) && u ? u : ''}</td>
    <td class="cnt">${a.n}/${s.n}</td></tr>`;
  const ownRows = OWN.map(d => tRow(d.l, own[d.k], d.u)).join('') + tRow('パス成功率', own.passRate, '%', true);
  const oppRows = OPP.map(d => tRow(d.l, opp[d.k], d.u)).join('') + tRow('パス成功率', opp.passRate, '%', true);
  const head = `<thead><tr><th>項目</th><th>合計</th><th>1試合平均</th><th>記録試合</th></tr></thead>`;
  const tables = `<div class="two">
    <section class="panel"><h2><span class="side-o">自チーム</span>スタッツ</h2><div class="tbl-wrap"><table>${head}<tbody>${ownRows}</tbody></table></div></section>
    <section class="panel"><h2><span class="side-p">対戦相手</span>スタッツ</h2><div class="tbl-wrap"><table>${head}<tbody>${oppRows}</tbody></table></div></section>
  </div>
  <p class="note">平均は「合計 ÷ その項目を入力した試合数」で算出しています（未入力の試合は平均に含めません）。パス成功率は、パス数と成功数の両方を入力した試合の合計から算出しています。支配率（相手）は自チームの支配率から自動算出しています。</p>`;

  return `<div class="stack">${kpis}${cmp}${tables}${mode !== 'team' ? playerAnalysisHtml(ms) : ''}</div>`;
}

function playerAnalysisHtml(ms) {
  const mode = S.cur.mode, N = ms.length, P = playerAgg(ms);
  const detail = mode === 'detail';
  const denomLabel = detail ? (S.denom === 'played' ? '出場試合' : '全試合') : '全試合';
  const perDen = p => detail ? (S.denom === 'played' ? p.apps : N) : N;
  const gkDen = p => detail && S.denom === 'all' ? N : p.gk;

  const toggle = detail ? `<div class="toggle-row"><span class="muted">1試合平均の分母</span>
    <div class="seg" role="radiogroup" aria-label="平均の分母">
      <label><input type="radio" name="denom" value="played" data-act="denom" ${S.denom === 'played' ? 'checked' : ''}><span>出場試合のみ</span></label>
      <label><input type="radio" name="denom" value="all" data-act="denom" ${S.denom === 'all' ? 'checked' : ''}><span>欠場試合も含める</span></label>
    </div></div>` : '';

  const roster = S.cur.players || [];
  let list = roster.map(p => P[p.id] || {id:p.id, g:0,a:0,y:0,r:0,apps:0,starts:0,gk:0,sv:0,con:0,rs:0,rc:0,w:0,d:0,l:0});
  Object.values(P).forEach(p => { if (!list.some(x => x.id === p.id)) list.push(p); });
  const fieldList = list.filter(p => detail ? (p.apps || p.g || p.a || p.y || p.r) : (p.g || p.a || p.y || p.r))
    .sort((a, b) => (b.g + b.a) - (a.g + a.a) || b.g - a.g || b.apps - a.apps);

  const pRows = fieldList.map(p => {
    const d = perDen(p);
    return `<tr><td>${esc(pname(p.id))}</td>
      ${detail ? `<td>${p.apps}<span class="muted small">（先発${p.starts}）</span></td>` : ''}
      <td><b>${p.g}</b></td><td>${p.a}</td><td>${p.g + p.a}</td>
      <td>${d ? fmt(p.g / d, 2) : '—'}</td><td>${d ? fmt(p.a / d, 2) : '—'}</td>
      <td>${p.y}</td><td>${p.r}</td>
      ${detail ? `<td class="cnt">${p.apps ? `${p.w}勝${p.d}分${p.l}敗` : '—'}</td>` : ''}</tr>`;
  }).join('');
  const pHead = `<thead><tr><th>選手</th>${detail ? '<th>出場</th>' : ''}<th>得点</th><th>アシスト</th><th>G+A</th><th>得点/試合</th><th>A/試合</th><th>警告</th><th>退場</th>${detail ? '<th>出場時の成績</th>' : ''}</tr></thead>`;

  const gks = list.filter(p => p.gk > 0).sort((a, b) => b.gk - a.gk);
  const gRows = gks.map(p => {
    const d = gkDen(p), faced = p.rs + p.rc;
    return `<tr><td>${esc(pname(p.id))}</td><td>${p.gk}</td><td><b>${p.sv}</b></td><td>${p.con}</td>
      <td><b>${faced ? fmt(p.rs / faced * 100) + '%' : '—'}</b></td>
      <td>${d ? fmt(p.sv / d, 2) : '—'}</td><td>${d ? fmt(p.con / d, 2) : '—'}</td></tr>`;
  }).join('');
  const gHead = `<thead><tr><th>GK</th><th>出場</th><th>セーブ</th><th>失点</th><th>セーブ率</th><th>セーブ/試合</th><th>失点/試合</th></tr></thead>`;

  return `<section class="panel"><h2>選手別の集計 <small>平均の分母：${denomLabel}</small></h2>${toggle}
      ${fieldList.length ? `<div class="tbl-wrap"><table>${pHead}<tbody>${pRows}</tbody></table></div>` : '<p class="muted">得点・アシスト・カード' + (detail ? '・出場' : '') + 'の記録がまだありません。</p>'}
      ${detail ? '<p class="note">「出場試合のみ」では、出場していない試合を平均の計算から外します。「欠場試合も含める」では、登録した全試合数で割ります。</p>' : '<p class="note">簡易集計モードでは、1試合平均を登録した全試合数で割っています。</p>'}
    </section>
    <section class="panel"><h2>GK別の集計</h2>
      ${gks.length ? `<div class="tbl-wrap"><table>${gHead}<tbody>${gRows}</tbody></table></div>` : '<p class="muted">出場GKの記録がまだありません。</p>'}
      <p class="note">セーブ率 = セーブ数 ÷（セーブ数 + 失点）。セーブ数と失点の両方がある試合から算出しています。${detail && S.denom === 'all' ? 'GKの1試合平均も全試合数で割っています。' : 'GKの1試合平均はGKとして出場した試合数で割っています。'}</p>
    </section>`;
}

/* ---------- players tab ---------- */
function playersHtml() {
  const ds = S.cur, P = playerAgg(S.matches), detail = ds.mode === 'detail';
  const rows = (ds.players || []).map(p => {
    const a = P[p.id]; const used = !!a;
    const st = a ? [detail ? `出場${a.apps}` : '', `${a.g}G`, `${a.a}A`, a.gk ? `GK${a.gk}` : ''].filter(Boolean).join(' · ') : '記録なし';
    return `<div class="r-row">
      <input class="inp" id="pl-${esc(p.id)}" value="${esc(p.name)}" data-act="rename" data-id="${esc(p.id)}" maxlength="30" aria-label="選手名">
      <span class="r-stats">${st}</span>
      <button class="btn sm ghost" data-act="del-player" data-id="${esc(p.id)}" ${used ? 'disabled title="記録がある選手は削除できません（名前の変更はできます）"' : ''}>削除</button>
    </div>`;
  }).join('');
  return `<section class="panel">
    <h2>選手リスト <small>${(ds.players || []).length}人</small></h2>
    <form class="inline-add" id="add-player-form" style="margin-bottom:12px">
      <input class="inp" id="new-player" placeholder="選手名を入力" maxlength="30">
      <button class="btn" type="submit">追加</button>
    </form>
    <div class="roster">${rows || '<p class="muted">選手はまだいません。試合の記録画面で名前を入力しても自動で追加されます。</p>'}</div>
    <p class="note">名前を書き換えると、過去の試合の記録にも反映されます。記録がある選手は削除できません。</p>
  </section>`;
}

/* ---------- settings tab ---------- */
function settingsHtml() {
  const ds = S.cur;
  return `<div class="set-grid">
    <section class="panel"><h2>名前とメモ</h2>
      <form id="meta-form" style="display:grid;gap:10px">
        <div class="field"><label for="set-name">大会名・データ名</label><input class="inp" id="set-name" value="${esc(ds.name)}" maxlength="60" required></div>
        <div class="field"><label for="set-memo">メモ</label><input class="inp" id="set-memo" value="${esc(ds.memo || '')}" maxlength="120"></div>
        <div><button class="btn primary" type="submit">保存</button></div>
      </form>
    </section>
    <section class="panel"><h2>集計モード</h2>
      <form id="mode-form" style="display:grid;gap:10px">
        ${modeRadios(ds.mode)}
        <p class="note">モードを下げても、入力済みの個人記録は消えずに非表示になります。モードを戻すと再び表示されます。</p>
        <div><button class="btn primary" type="submit">モードを変更</button></div>
      </form>
    </section>
    <section class="panel"><h2>バックアップ</h2>
      <p class="muted" style="margin-bottom:10px">この記録データをJSONファイルに書き出します。一覧画面の「バックアップから読み込む」で復元できます。</p>
      <button class="btn" data-act="export">JSONで書き出す</button>
    </section>
    <section class="panel danger-zone"><h2>記録データを削除</h2>
      <p class="muted" style="margin-bottom:10px">「${esc(ds.name)}」と、登録済みの${S.matches.length}試合の記録をすべて削除します。元に戻せません。</p>
      <div class="confirm" id="del-ds-box"><button class="btn danger" data-act="del-ds-ask">この記録データを削除</button></div>
    </section>
  </div>`;
}

/* ---------- match form ---------- */
let FR = {result: null, pk: false};
let FORM_MATCH = null;

function numField(side, d, val) {
  const id = `${side}_${d.k}`;
  const auto = side === 'opp' && d.k === 'poss';
  return `<div class="field"><label for="${id}">${d.l}${d.u ? '（' + d.u + '）' : ''}</label>
    <input class="inp" type="number" inputmode="numeric" min="0" ${d.max ? `max="${d.max}"` : ''} step="1" id="${id}" value="${isNum(val) ? val : ''}" ${auto ? 'data-auto="1"' : ''}></div>`;
}
function goalRow(sc, as) {
  return `<div class="prow goal">
    <span class="g-no"></span>
    <div class="field"><span class="lab">得点者</span><input class="inp g-sc" list="roster" value="${esc(sc)}" maxlength="30" placeholder="選手名" aria-label="得点者"></div>
    <div class="field"><span class="lab">アシスト</span><input class="inp g-as" list="roster" value="${esc(as)}" maxlength="30" placeholder="なし" aria-label="アシスト"></div></div>`;
}
/* GK candidates: players used as GK in this dataset (most recent first), then everyone else */
function gkCandidates() {
  const players = S.cur?.players || [];
  const seen = [];
  for (let i = S.matches.length - 1; i >= 0; i--) for (const k of S.matches[i].gks || []) if (k.pid && !seen.includes(k.pid)) seen.push(k.pid);
  players.forEach(p => { if (p.pos === 'GK' && !seen.includes(p.id)) seen.push(p.id); });
  const gks = seen.map(id => players.find(p => p.id === id)).filter(Boolean);
  const others = players.filter(p => !seen.includes(p.id));
  return {gks, others};
}
function gkRow(pid, sv, con) {
  const {gks, others} = gkCandidates();
  const known = !pid || gks.some(p => p.id === pid) || others.some(p => p.id === pid);
  const noRoster = !gks.length && !others.length;
  const opt = p => `<option value="${esc(p.id)}" ${p.id === pid ? 'selected' : ''}>${esc(p.name)}</option>`;
  const sel = `<select class="inp k-sel" aria-label="出場GK">
      <option value="" ${!pid && !noRoster ? 'selected' : ''}>選択してください</option>
      ${!known ? `<option value="${esc(pid)}" selected>${esc(pname(pid))}</option>` : ''}
      ${gks.length ? `<optgroup label="このデータのGK">${gks.map(opt).join('')}</optgroup>` : ''}
      ${others.length ? `<optgroup label="その他の選手">${others.map(opt).join('')}</optgroup>` : ''}
      <option value="__new" ${noRoster && !pid ? 'selected' : ''}>＋ 新しいGKを入力</option>
    </select>
    <input class="inp k-nm" maxlength="30" placeholder="新しいGKの名前" aria-label="新しいGKの名前" ${noRoster && !pid ? '' : 'hidden'}>`;
  return `<div class="prow gk">
    <div class="field"><span class="lab">出場GK</span>${sel}</div>
    <div class="field"><span class="lab">セーブ</span><input class="inp k-sv" type="number" min="0" inputmode="numeric" value="${isNum(sv) ? sv : ''}" aria-label="セーブ数"></div>
    <div class="field"><span class="lab">失点</span><input class="inp k-con" type="number" min="0" inputmode="numeric" value="${isNum(con) ? con : ''}" aria-label="失点"></div>
    <button type="button" class="rm" data-act="rm-row" aria-label="この行を削除">×</button></div>`;
}
function cardRow(nm, type) {
  return `<div class="prow card">
    <div class="field"><span class="lab">選手</span><input class="inp c-nm" list="roster" value="${esc(nm)}" maxlength="30" placeholder="選手名" aria-label="カードを受けた選手"></div>
    <div class="field"><span class="lab">カード</span><select class="inp c-ty" aria-label="カードの種類"><option value="Y" ${type !== 'R' ? 'selected' : ''}>イエロー</option><option value="R" ${type === 'R' ? 'selected' : ''}>レッド</option></select></div>
    <button type="button" class="rm" data-act="rm-row" aria-label="この行を削除">×</button></div>`;
}
let appSeq = 0;
function appRow(key, name, st, isNew) {
  const n = 'app' + (appSeq++);
  const attr = isNew ? `data-name="${esc(name)}"` : `data-pid="${esc(key)}"`;
  return `<div class="app-row" ${attr}><span class="nm">${esc(name)}${isNew ? '<small>新規</small>' : ''}</span>
    <div class="seg" role="radiogroup" aria-label="${esc(name)}の出場">
      <label><input type="radio" name="${n}" value="S" ${st === 'S' ? 'checked' : ''}><span>先発</span></label>
      <label><input type="radio" name="${n}" value="B" ${st === 'B' ? 'checked' : ''}><span>途中</span></label>
      <label><input type="radio" name="${n}" value="N" ${st !== 'S' && st !== 'B' ? 'checked' : ''}><span>—</span></label>
    </div></div>`;
}

function matchForm(m) {
  const ds = S.cur, mode = ds.mode, isNew = !m;
  const last = S.matches[S.matches.length - 1];
  const base = m ? clone(m) : {date: today(), opponent:'', round:'', memo:'', gf:0, ga:0, own:{}, opp:{}, goals:[], gks:[], cards:[], apps:{}};
  FORM_MATCH = m || null;
  FR = {result: base.result || null, pk: !!base.pk};
  const idx = m ? S.matches.findIndex(x => x.id === m.id) + 1 : S.matches.length + 1;

  const own = OWN.map(d => numField('own', d, base.own?.[d.k])).join('');
  const opp = OPP.map(d => numField('opp', d, d.k === 'poss' ? oppPoss(base) : base.opp?.[d.k])).join('');

  let personal = '';
  if (mode !== 'team') {
    const goals = base.goals.length ? base.goals.map(g => goalRow(g.scorer ? pname(g.scorer) : '', g.assist ? pname(g.assist) : '')).join('') : '';
    let gks = base.gks.map(k => gkRow(k.pid || null, k.saves, k.conceded)).join('');
    if (isNew) { const lg = last?.gks?.[0]; gks = gkRow(lg?.pid || null, null, null); }
    const cards = base.cards.map(c => cardRow(c.pid ? pname(c.pid) : '', c.type)).join('');
    personal = `
    <section class="fs"><div class="fs-h"><h3>ゴール・アシスト</h3><span class="muted small">自チームの得点数に合わせて枠が変わります</span></div>
      <div class="rows" id="goals">${goals}</div>
      <p class="muted small" id="goals-empty">スコアの自チーム得点を増やすと、ここに得点者の入力枠が出ます。</p>
      <p class="note" style="margin-top:0">名前は候補から選ぶか、新しく入力できます（新しい名前は選手リストに自動で追加）。得点者を空欄にすると「得点者なし（オウンゴール等）」として数えます。</p>
    </section>
    <section class="fs"><div class="fs-h"><h3>出場GK</h3><button type="button" class="btn sm" data-act="add-gk">＋ GKを追加</button></div>
      <div class="rows" id="gks">${gks}</div>
      <p class="note" style="margin-top:0">GKが1人のとき、セーブ・失点が空欄ならチームのセーブ数と失点を使います。</p>
    </section>
    <section class="fs"><div class="fs-h"><h3>カード</h3><button type="button" class="btn sm" data-act="add-card">＋ カードを追加</button></div>
      <div class="rows" id="cards">${cards}</div>
    </section>`;
    if (mode === 'detail') {
      const apps = (ds.players || []).map(p => appRow(p.id, p.name, base.apps?.[p.id], false)).join('');
      personal += `
      <section class="fs"><div class="fs-h"><h3>出場選手</h3>
        <div style="display:flex;gap:6px;flex-wrap:wrap"><button type="button" class="btn sm" data-act="apps-copy" ${S.matches.length ? '' : 'disabled'}>前の試合と同じ</button><button type="button" class="btn sm ghost" data-act="apps-clear">全員「—」</button></div></div>
        <div class="apps" id="apps">${apps || '<p class="muted small" id="apps-empty">選手リストが空です。下の欄から追加してください。</p>'}</div>
        <div class="inline-add"><input class="inp" id="app-new" maxlength="30" placeholder="選手を追加" list="roster"><button type="button" class="btn sm" data-act="app-add">追加</button></div>
        <p class="note" style="margin-top:0">得点・アシスト・カード・GKに入力した選手が「—」のままなら、保存時に出場扱いにします（GKは先発、それ以外は途中出場）。</p>
      </section>`;
    }
  }

  openModal(`<form id="mform" novalidate>
    <div class="sheet-head"><h2>${isNew ? '試合を記録' : '第' + idx + '戦を編集'}</h2><div class="head-actions"><button type="button" class="btn ghost sm" data-act="close">閉じる</button><button type="submit" class="btn primary sm save-btn" data-label="${isNew ? '登録する' : '保存する'}">${isNew ? '登録する' : '保存する'}</button></div></div>
    <div class="sheet-body">
      <section class="fs">
        <div class="fs-h"><h3>試合結果 <span class="req">必須</span></h3></div>
        <div class="score-row">
          <div class="score-box">
            ${stepper('f_gf', '自チーム', base.gf)}
            <span class="dash">-</span>
            ${stepper('f_ga', '相手', base.ga)}
          </div>
          <div class="resbox" id="resbox"></div>
        </div>
        <div class="grid-f">
          <div class="field"><label for="f_opp">対戦相手</label><input class="inp" id="f_opp" maxlength="40" value="${esc(base.opponent)}" placeholder="相手チーム名"></div>
          <div class="field"><label for="f_date">日付</label><input class="inp" type="date" id="f_date" value="${esc(base.date || '')}"></div>
          <div class="field"><label for="f_round">ラウンド等</label><input class="inp" id="f_round" maxlength="30" value="${esc(base.round || '')}" placeholder="例：GS第2節、準決勝"></div>
          <div class="field"><label for="f_memo">メモ</label><input class="inp" id="f_memo" maxlength="120" value="${esc(base.memo || '')}" placeholder="任意"></div>
        </div>
      </section>
      <section class="fs">
        <div class="fs-h"><h3><i class="sw"></i>自チームのスタッツ</h3><span class="muted small">空欄のままでも登録できます</span></div>
        <div class="grid-f">${own}<div class="calc">パス成功率 <b id="own_rate">—</b></div></div>
      </section>
      <section class="fs">
        <div class="fs-h"><h3><i class="sw p"></i>対戦相手のスタッツ</h3><span class="muted small">支配率は自チームの値から自動算出</span></div>
        <div class="grid-f">${opp}<div class="calc">パス成功率 <b id="opp_rate">—</b></div></div>
      </section>
      ${personal}
      <div class="errs" id="errs" role="alert"></div>
    </div>
    <div class="sheet-foot">
      ${isNew ? '' : `<div class="confirm" id="del-m-box"><button type="button" class="btn danger sm" data-act="del-match-ask">この試合を削除</button></div>`}
      <div class="right"><button type="button" class="btn" data-act="close">キャンセル</button><button type="submit" class="btn primary save-btn" data-label="${isNew ? '登録する' : '保存する'}">${isNew ? '登録する' : '保存する'}</button></div>
    </div>
  </form>`);

  const f = $('#mform');
  f.addEventListener('input', onFormInput);
  f.addEventListener('submit', e => { e.preventDefault(); saveMatch(); });
  syncForm();
  updateResult(true);
  syncGoalRows();
}

function stepper(id, label, val) {
  return `<div class="stepper">
    <span class="st-lbl">${label}</span>
    <button type="button" class="st-btn" data-act="step" data-t="${id}" data-d="1" aria-label="${label}の得点を1増やす">▲</button>
    <input class="inp" type="number" inputmode="numeric" min="0" step="1" id="${id}" value="${isNum(val) ? val : 0}" aria-label="${label}の得点">
    <button type="button" class="st-btn" data-act="step" data-t="${id}" data-d="-1" aria-label="${label}の得点を1減らす">▼</button>
  </div>`;
}
function onFormInput(e) {
  const id = e.target.id;
  if (id === 'f_gf' || id === 'f_ga') { updateResult(false); if (id === 'f_gf') syncGoalRows(); }
  syncForm();
}
/* keep exactly as many scorer rows as the team's goals; drop empty rows first */
function syncGoalRows() {
  const box = $('#goals'); if (!box) return;
  const gf = toNum($('#f_gf').value);
  const target = isNum(gf) && gf >= 0 ? Math.min(Math.floor(gf), 30) : 0;
  let rows = $$('.prow.goal', box);
  if (rows.length < target) {
    for (let i = rows.length; i < target; i++) box.insertAdjacentHTML('beforeend', goalRow('', ''));
  } else if (rows.length > target) {
    let extra = rows.length - target;
    const isEmpty = r => !normName($('.g-sc', r).value) && !normName($('.g-as', r).value);
    for (let i = rows.length - 1; i >= 0 && extra > 0; i--) if (isEmpty(rows[i])) { rows[i].remove(); extra--; }
    rows = $$('.prow.goal', box);
    for (let i = rows.length - 1; i >= 0 && extra > 0; i--) { rows[i].remove(); extra--; }
  }
  $$('.prow.goal', box).forEach((r, i) => { $('.g-no', r).textContent = (i + 1) + '点目'; });
  const empty = $('#goals-empty'); if (empty) empty.hidden = target > 0;
}
function syncForm() {
  const op = $('#own_poss'), pp = $('#opp_poss');
  if (op && pp) {
    const v = toNum(op.value);
    if (isNum(v) && v >= 0 && v <= 100) { pp.value = 100 - v; pp.readOnly = true; }
    else { if (pp.readOnly) pp.value = ''; pp.readOnly = false; }
  }
  for (const side of ['own', 'opp']) {
    const p = toNum($(`#${side}_passes`)?.value), o = toNum($(`#${side}_passOk`)?.value);
    const r = pct(o, p);
    const el = $(`#${side}_rate`); if (el) el.textContent = isNum(r) ? fmt(r) + '%' : '—';
  }
}
function updateResult(initial) {
  const gf = toNum($('#f_gf').value), ga = toNum($('#f_ga').value), box = $('#resbox');
  if (!isNum(gf) || !isNum(ga)) { FR.result = null; box.innerHTML = '<span class="muted small">スコアを入力すると勝敗が決まります</span>'; return; }
  if (gf > ga) { FR = {result:'W', pk:false}; box.innerHTML = '<span class="res res-W">勝ち</span>'; return; }
  if (gf < ga) { FR = {result:'L', pk:false}; box.innerHTML = '<span class="res res-L">負け</span>'; return; }
  if (!(FR.result === 'D' || FR.pk)) FR = {result:'D', pk:false};
  const cur = FR.result === 'D' ? 'D' : FR.result === 'W' ? 'PKW' : 'PKL';
  box.innerHTML = `<div class="seg" role="radiogroup" aria-label="同点時の結果">
    <label><input type="radio" name="tie" value="D" data-act="tie" ${cur === 'D' ? 'checked' : ''}><span>引き分け</span></label>
    <label><input type="radio" name="tie" value="PKW" data-act="tie" ${cur === 'PKW' ? 'checked' : ''}><span>PK勝ち</span></label>
    <label><input type="radio" name="tie" value="PKL" data-act="tie" ${cur === 'PKL' ? 'checked' : ''}><span>PK負け</span></label></div>`;
}

async function saveMatch() {
  const ds = S.cur, mode = ds.mode, errs = [];
  $$('#mform .inp.bad').forEach(x => x.classList.remove('bad'));
  const gf = toNum($('#f_gf').value), ga = toNum($('#f_ga').value);
  const badInt = v => !isNum(v) || v < 0 || !Number.isInteger(v);
  if (badInt(gf) || badInt(ga)) { errs.push('スコア（自チーム・相手の得点）は必須です。0以上の整数で入力してください。'); if (badInt(gf)) $('#f_gf').classList.add('bad'); if (badInt(ga)) $('#f_ga').classList.add('bad'); }
  const read = (side, defs) => {
    const o = {};
    for (const d of defs) {
      const el = $(`#${side}_${d.k}`); const raw = el.value.trim();
      if (raw === '') { o[d.k] = null; continue; }
      const v = toNum(raw);
      if (!isNum(v) || v < 0 || (d.max && v > d.max)) { el.classList.add('bad'); errs.push(`${side === 'own' ? '自チーム' : '相手'}の${d.l}は0${d.max ? '〜' + d.max : '以上'}の数値で入力してください。`); o[d.k] = null; }
      else o[d.k] = v;
    }
    if (isNum(o.passes) && isNum(o.passOk) && o.passOk > o.passes) { $(`#${side}_passOk`).classList.add('bad'); errs.push(`${side === 'own' ? '自チーム' : '相手'}のパス成功数がパス数を上回っています。`); }
    return o;
  };
  const own = read('own', OWN), opp = read('opp', OPP);
  if (isNum(own.poss)) opp.poss = 100 - own.poss;

  const players = clone(ds.players || []);
  let rosterChanged = false;
  const idOf = name => {
    const n = normName(name); if (!n) return null;
    const hit = players.find(p => p.name.toLowerCase() === n.toLowerCase());
    if (hit) return hit.id;
    const p = {id: rid('p'), name: n}; players.push(p); rosterChanged = true; return p.id;
  };

  let goals = [], gks = [], cards = [], apps = {};
  if (mode !== 'team') {
    goals = $$('#goals .prow.goal').map(r => ({scorer: idOf($('.g-sc', r).value), assist: idOf($('.g-as', r).value)}));
    // drop fully empty trailing rows beyond the score
    const trimmed = goals.slice();
    while (trimmed.length > (isNum(gf) ? gf : 0) && trimmed.length && !trimmed[trimmed.length - 1].scorer && !trimmed[trimmed.length - 1].assist) trimmed.pop();
    goals = trimmed;
    gks = $$('#gks .prow.gk').map(r => {
      const sel = $('.k-sel', r).value;
      const pid = sel === '__new' ? idOf($('.k-nm', r).value) : (sel || null);
      return {pid, saves: toNum($('.k-sv', r).value), conceded: toNum($('.k-con', r).value)};
    })
      .filter(k => k.pid || isNum(k.saves) || isNum(k.conceded));
    if (gks.some(k => !k.pid)) errs.push('出場GKの名前が空欄の行があります。名前を入力するか、行を削除してください。');
    if (gks.length === 1) {
      if (!isNum(gks[0].saves) && isNum(own.saves)) gks[0].saves = own.saves;
      if (!isNum(gks[0].conceded) && isNum(ga)) gks[0].conceded = ga;
    }
    cards = $$('#cards .prow.card').map(r => ({pid: idOf($('.c-nm', r).value), type: $('.c-ty', r).value})).filter(c => c.pid);
    if (mode === 'detail') {
      $$('#apps .app-row').forEach(r => {
        const v = r.querySelector('input[type=radio]:checked')?.value;
        if (v !== 'S' && v !== 'B') return;
        const id = r.dataset.pid || idOf(r.dataset.name);
        if (id) apps[id] = v;
      });
      gks.forEach(k => { if (k.pid && !apps[k.pid]) apps[k.pid] = 'S'; });
      [...goals.flatMap(g => [g.scorer, g.assist]), ...cards.map(c => c.pid)].forEach(id => { if (id && !apps[id]) apps[id] = 'B'; });
    } else if (FORM_MATCH?.apps) apps = FORM_MATCH.apps;
  } else if (FORM_MATCH) {
    goals = FORM_MATCH.goals || []; gks = FORM_MATCH.gks || []; cards = FORM_MATCH.cards || []; apps = FORM_MATCH.apps || {};
  }

  if (errs.length) { $('#errs').innerHTML = errs.map(x => `<span>・${esc(x)}</span>`).join(''); $('#errs').scrollIntoView({block:'nearest'}); return; }

  let result = FR.result, pk = FR.pk;
  if (gf > ga) { result = 'W'; pk = false; } else if (gf < ga) { result = 'L'; pk = false; } else if (!result) { result = 'D'; pk = false; }
  gks.forEach(k => { const p = players.find(x => x.id === k.pid); if (p && p.pos !== 'GK') { p.pos = 'GK'; rosterChanged = true; } });

  const now = Date.now();
  const m = {
    id: FORM_MATCH?.id || rid('m'), createdAt: FORM_MATCH?.createdAt || now, updatedAt: now,
    date: $('#f_date').value || '', opponent: normName($('#f_opp').value), round: normName($('#f_round').value), memo: normName($('#f_memo').value),
    gf, ga, result, pk, own, opp, goals, gks, cards, apps
  };
  setSaving(true);
  try {
    await S.store.putMatch(ds.id, m);
    const list = S.matches.filter(x => x.id !== m.id); list.push(m);
    S.matches = sortMatches(list);
    const nds = {...ds, players, summary: summarize(S.matches), updatedAt: now};
    await S.store.putDataset(nds);
    Object.assign(ds, nds);
    closeModal(); renderDataset();
    toast(FORM_MATCH ? '保存しました' : '試合を登録しました');
  } catch (e) {
    setSaving(false);
    toast(errMsg(e));
  }
}

async function deleteMatch() {
  const ds = S.cur, m = FORM_MATCH; if (!m) return;
  try {
    await S.store.delMatch(ds.id, m.id);
    S.matches = S.matches.filter(x => x.id !== m.id);
    const nds = {...ds, summary: summarize(S.matches), updatedAt: Date.now()};
    await S.store.putDataset(nds); Object.assign(ds, nds);
    closeModal(); renderDataset(); toast('試合の記録を削除しました');
  } catch (e) { toast(errMsg(e)); }
}

/* ---------- player management ---------- */
async function saveRoster(players, msg) {
  const ds = S.cur;
  const nds = {...ds, players, updatedAt: Date.now()};
  try { await S.store.putDataset(nds); Object.assign(ds, nds); refreshRoster(); rerenderTab(); if (msg) toast(msg); }
  catch (e) { toast(errMsg(e)); rerenderTab(); }
}

/* ---------- export / import ---------- */
async function exportDs() {
  const ds = S.cur;
  const payload = {app: 'efootball-tournament-stats', version: 1, exportedAt: new Date().toISOString(),
    dataset: {name: ds.name, memo: ds.memo || '', mode: ds.mode, players: ds.players || []},
    matches: S.matches.map(m => { const {id, ...r} = m; return r; })};
  const json = JSON.stringify(payload, null, 2);
  const fname = (ds.name || 'stats').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) + '.json';
  try {
    const url = URL.createObjectURL(new Blob([json], {type: 'application/json'}));
    const link = document.createElement('a');
    link.href = url; link.download = fname; document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast('バックアップを書き出しました');
  } catch (e) { toast('書き出しに失敗しました'); }
}
async function importFile(file) {
  if (S.datasets.length >= MAX_DS) { toast('記録データは最大' + MAX_DS + '件です。不要なデータを削除してください。'); return; }
  let obj;
  try { obj = JSON.parse(await file.text()); } catch (e) { toast('JSONファイルを読み込めませんでした'); return; }
  if (!obj || !obj.dataset || !Array.isArray(obj.matches) || !MODES[obj.dataset.mode]) { toast('このツールのバックアップファイルではありません'); return; }
  if (obj.matches.length > 500) { toast('試合数が多すぎるため読み込めません（上限500試合）'); return; }
  const now = Date.now();
  const matches = obj.matches.map((m, i) => ({...m, id: rid('m'), createdAt: m.createdAt || now + i}));
  const ds = {id: rid('ds'), name: normName(obj.dataset.name) || '読み込んだデータ', memo: obj.dataset.memo || '', mode: obj.dataset.mode,
    players: Array.isArray(obj.dataset.players) ? obj.dataset.players : [], summary: summarize(matches), createdAt: now, updatedAt: now};
  toast('読み込み中…');
  try {
    await S.store.putDataset(ds);
    await S.store.putMatches(ds.id, matches);
    S.datasets.push(ds); renderHome(); toast(`「${ds.name}」を読み込みました（${matches.length}試合）`);
  } catch (e) { toast(errMsg(e)); }
}

/* ---------- demo ---------- */
function demoSeed() {
  const names = ['小林','田中','佐藤','鈴木','高橋','伊藤','渡辺','山本','中村','加藤','吉田','山田','松本'];
  const pl = names.map((n, i) => ({id: 'dp' + i, name: n, ...(i === 0 || i === 12 ? {pos:'GK'} : {})}));
  const P = i => 'dp' + i;
  const starters = [0,1,2,3,4,5,6,7,8,9,10];
  const mk = (i, date, opp, round, gf, ga, res, pk, own, op, goals, gks, cards, subs, swap) => {
    const apps = {}; starters.forEach(s => apps[P(s)] = 'S'); (swap || []).forEach(([o, n]) => { delete apps[P(o)]; apps[P(n)] = 'S'; });
    (subs || []).forEach(s => apps[P(s)] = 'B');
    const [poss, shots, sot, fouls, offsides, corners, fks, passes, passOk, crosses, intercepts, tackles, saves] = own;
    const [oshots, osot, ofouls, opasses, opassOk, osaves] = op;
    return {id: 'dm' + i, createdAt: i, updatedAt: i, date, opponent: opp, round, memo: '', gf, ga, result: res, pk,
      own: {poss, shots, sot, fouls, offsides, corners, fks, passes, passOk, crosses, intercepts, tackles, saves},
      opp: {poss: 100 - poss, shots: oshots, sot: osot, fouls: ofouls, passes: opasses, passOk: opassOk, saves: osaves},
      goals: goals.map(([s, a]) => ({scorer: s == null ? null : P(s), assist: a == null ? null : P(a)})),
      gks: gks.map(([g, s, c]) => ({pid: P(g), saves: s, conceded: c})),
      cards: cards.map(([p, t]) => ({pid: P(p), type: t})), apps};
  };
  const ms = [
    mk(1,'2026-09-05','FCブルーライン','GS第1節',3,1,'W',false,[56,14,7,3,1,5,4,412,356,9,11,14,3],[8,4,5,318,262,4],[[1,2],[1,3],[4,null]],[[0,3,1]],[[5,'Y']],[11]),
    mk(2,'2026-09-06','レッドオウルズ','GS第2節',1,2,'L',false,[47,9,3,6,2,3,6,351,291,12,8,10,4],[13,6,2,402,351,2],[[4,1]],[[0,4,2]],[[3,'Y'],[7,'Y']],[11,9]),
    mk(3,'2026-09-12','SCミナト','GS第3節',2,2,'W',true,[52,12,6,4,0,6,5,388,331,7,13,12,5],[11,7,4,360,300,4],[[1,6],[8,1]],[[0,5,2]],[],[],[[10,11]]),
    mk(4,'2026-09-19','グレイシャーズ','準々決勝',4,0,'W',false,[61,17,9,2,3,8,3,455,402,10,9,16,2],[6,2,6,290,231,5],[[1,2],[2,4],[1,null],[11,1]],[[12,2,0]],[[6,'Y']],[11],[[0,12]]),
    mk(5,'2026-09-26','ノースウィンド','準決勝',0,1,'L',false,[50,10,4,5,1,4,7,372,310,11,10,11,3],[9,4,3,368,309,4],[],[[0,3,1]],[[2,'Y'],[2,'Y'],[9,'R']],[11,12].slice(0,1))
  ];
  const summary = summarize(ms);
  const ds = {id: 'demo', name: '見本：秋季オンラインカップ', memo: '4-2-1-3 ／ 見本データ', mode: 'detail', players: pl, summary, createdAt: 0, updatedAt: Date.now()};
  const o = {ds: {demo: ds}, m: {demo: {}}}; ms.forEach(m => o.m.demo[m.id] = m);
  return o;
}
async function openDemo() {
  S.store = new LocalStore(null, demoSeed()); S.demo = true;
  S.datasets = await S.store.listDatasets();
  S.cur = S.datasets[0]; S.tab = 'analysis';
  S.matches = sortMatches(await S.store.listMatches('demo'));
  renderDataset(); window.scrollTo(0, 0);
}

/* ---------- events ---------- */
document.addEventListener('click', async e => {
  const ov = e.target.closest('[data-overlay]');
  if (ov && e.target === ov) { if (ov.querySelector('.sheet.narrow')) closeModal(); return; }
  const el = e.target.closest('[data-act]'); if (!el) return;
  const act = el.dataset.act;
  switch (act) {
    case 'home': closeModal(); if (S.cur || S.demo) loadHome(); break;
    case 'close': closeModal(); break;
    case 'new-ds': newDatasetModal(); break;
    case 'open-ds': openDataset(el.dataset.id); break;
    case 'demo': openDemo(); break;
    case 'import': $('#import-file').value = ''; $('#import-file').click(); break;
    case 'tab': S.tab = el.dataset.tab; $$('.tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.tab === S.tab))); rerenderTab(); break;
    case 'new-match': matchForm(null); break;
    case 'edit-match': { const m = S.matches.find(x => x.id === el.dataset.id); if (m) matchForm(m); break; }
    case 'step': {
      const inp = $('#' + el.dataset.t); if (!inp) return;
      const v = Math.max(0, Math.min(99, (Math.floor(toNum(inp.value)) || 0) + Number(el.dataset.d)));
      inp.value = v; inp.classList.remove('bad');
      inp.dispatchEvent(new Event('input', {bubbles: true}));
      break;
    }
    case 'add-gk': $('#gks').insertAdjacentHTML('beforeend', gkRow(null, null, null)); $$('#gks .k-sel').pop()?.focus(); break;
    case 'add-card': $('#cards').insertAdjacentHTML('beforeend', cardRow('', 'Y')); $$('#cards .c-nm').pop()?.focus(); break;
    case 'rm-row': el.closest('.prow')?.remove(); break;
    case 'tie': {
      const v = el.value; FR = v === 'D' ? {result:'D', pk:false} : v === 'PKW' ? {result:'W', pk:true} : {result:'L', pk:true}; break;
    }
    case 'app-add': {
      const inp = $('#app-new'); const n = normName(inp.value); if (!n) return;
      const ex = (S.cur.players || []).find(p => p.name.toLowerCase() === n.toLowerCase());
      const dup = ex ? $(`#apps .app-row[data-pid="${CSS.escape(ex.id)}"]`) : $$('#apps .app-row[data-name]').find(r => r.dataset.name.toLowerCase() === n.toLowerCase());
      if (dup) { const s = dup.querySelector('input[value=S]'); s.checked = true; inp.value = ''; return; }
      $('#apps-empty')?.remove();
      $('#apps').insertAdjacentHTML('beforeend', ex ? appRow(ex.id, ex.name, 'S', false) : appRow(null, n, 'S', true));
      inp.value = ''; inp.focus(); break;
    }
    case 'apps-copy': {
      const cur = FORM_MATCH ? S.matches.findIndex(x => x.id === FORM_MATCH.id) : S.matches.length;
      const prev = S.matches[cur - 1]; if (!prev) { toast('前の試合がありません'); return; }
      $$('#apps .app-row').forEach(r => { const st = r.dataset.pid ? prev.apps?.[r.dataset.pid] : null; const v = st === 'S' || st === 'B' ? st : 'N'; r.querySelector(`input[value=${v}]`).checked = true; });
      toast('前の試合の出場状況をコピーしました'); break;
    }
    case 'apps-clear': $$('#apps .app-row input[value=N]').forEach(i => i.checked = true); break;
    case 'del-match-ask':
      $('#del-m-box').innerHTML = `<span class="small">削除しますか？</span><button type="button" class="btn danger solid sm" data-act="del-match">削除する</button><button type="button" class="btn sm" data-act="del-match-cancel">やめる</button>`; break;
    case 'del-match-cancel': $('#del-m-box').innerHTML = `<button type="button" class="btn danger sm" data-act="del-match-ask">この試合を削除</button>`; break;
    case 'del-match': el.disabled = true; await deleteMatch(); break;
    case 'del-player': {
      const players = (S.cur.players || []).filter(p => p.id !== el.dataset.id);
      await saveRoster(players, '選手を削除しました'); break;
    }
    case 'export': exportDs(); break;
    case 'login': login(); break;
    case 'logout': logout(); break;
    case 'copy-url': {
      try { await navigator.clipboard.writeText(location.href); toast('URLをコピーしました'); } catch (err) { toast(location.href); }
      break;
    }
    case 'del-ds-ask':
      $('#del-ds-box').innerHTML = `<span>本当に削除しますか？</span><button class="btn danger solid" data-act="del-ds">完全に削除する</button><button class="btn" data-act="del-ds-cancel">やめる</button>`; break;
    case 'del-ds-cancel': $('#del-ds-box').innerHTML = `<button class="btn danger" data-act="del-ds-ask">この記録データを削除</button>`; break;
    case 'del-ds': {
      el.disabled = true; el.textContent = '削除中…';
      const name = S.cur.name;
      try { await S.store.delDataset(S.cur.id); if (S.demo) { loadHome(); } else { await loadHome(); } toast(`「${name}」を削除しました`); }
      catch (err) { toast(errMsg(err)); el.disabled = false; el.textContent = '完全に削除する'; }
      break;
    }
  }
});
document.addEventListener('change', async e => {
  const t = e.target;
  if (t.id === 'import-file' && t.files && t.files[0]) { importFile(t.files[0]); return; }
  if (t.classList && t.classList.contains('k-sel')) {
    const nm = $('.k-nm', t.closest('.prow')); const isNew = t.value === '__new';
    nm.hidden = !isNew; if (isNew) nm.focus(); else nm.value = '';
    return;
  }
  if (t.dataset && t.dataset.act === 'denom') { S.denom = t.value; rerenderTab(); return; }
  if (t.dataset && t.dataset.act === 'rename') {
    const n = normName(t.value); const players = clone(S.cur.players || []);
    const p = players.find(x => x.id === t.dataset.id); if (!p) return;
    if (!n) { t.value = p.name; return; }
    if (players.some(x => x.id !== p.id && x.name.toLowerCase() === n.toLowerCase())) { toast('同じ名前の選手がすでにいます'); t.value = p.name; return; }
    if (p.name === n) return;
    p.name = n; await saveRoster(players, '名前を変更しました');
  }
});
document.addEventListener('submit', async e => {
  const f = e.target;
  if (f.id === 'add-player-form') {
    e.preventDefault();
    const inp = $('#new-player'); const n = normName(inp.value); if (!n) return;
    const players = clone(S.cur.players || []);
    if (players.some(x => x.name.toLowerCase() === n.toLowerCase())) { toast('同じ名前の選手がすでにいます'); return; }
    players.push({id: rid('p'), name: n});
    await saveRoster(players, `${n} を追加しました`);
    $('#new-player')?.focus();
  }
  if (f.id === 'meta-form') {
    e.preventDefault();
    const name = normName($('#set-name').value); if (!name) { $('#set-name').classList.add('bad'); return; }
    const nds = {...S.cur, name, memo: normName($('#set-memo').value), updatedAt: Date.now()};
    try { await S.store.putDataset(nds); Object.assign(S.cur, nds); S.tab = 'settings'; renderDataset(); toast('保存しました'); } catch (err) { toast(errMsg(err)); }
  }
  if (f.id === 'mode-form') {
    e.preventDefault();
    const mode = f.querySelector('input[name=mode]:checked')?.value; if (!mode || mode === S.cur.mode) return;
    const nds = {...S.cur, mode, updatedAt: Date.now()};
    try { await S.store.putDataset(nds); Object.assign(S.cur, nds); S.tab = 'settings'; renderDataset(); toast(MODES[mode].label + 'に変更しました'); } catch (err) { toast(errMsg(err)); }
  }
});

boot();
})();
