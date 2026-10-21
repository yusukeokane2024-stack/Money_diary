// マネーダイアリー 画面 (ビルド時に束ねる / フレームワークなし)
// Firebase を含む data.js は初回描画のあとで読み込む。前回のデータを localStorage から先に描画する。
import { searchTx } from './lib/search.js';

const $app = document.getElementById('app');
const LS = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

// ---------- utils ----------
const yen = (n) => '¥' + Number(n).toLocaleString('ja-JP');
const todayStr = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const shiftMonth = (m, d) => {
  const [y, mo] = m.split('-').map(Number);
  const t = y * 12 + (mo - 1) + d;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
};
const WD = ['日', '月', '火', '水', '木', '金', '土'];
const dayLabel = (d) => `${+d.slice(5, 7)}月${+d.slice(8)}日 (${WD[new Date(d + 'T00:00:00Z').getUTCDay()]})`;
const FREQ = { daily: '日', weekly: '週', monthly: 'ヶ月', yearly: '年' };
const freqLabel = (r) => (r.every === 1 ? { daily: '毎日', weekly: '毎週', monthly: '毎月', yearly: '毎年' }[r.freq] : `${r.every}${FREQ[r.freq]}ごと`);
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  const add = (c) => {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach(add);
    else el.append(c instanceof Node ? c : document.createTextNode(c));
  };
  kids.forEach(add);
  return el;
}
function toast(msg) {
  const t = h('div', { class: 'toast' }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), 2600);
}

// ---------- state ----------
const S = {
  me: null, books: [], bookId: null, month: todayStr().slice(0, 7),
  cats: new Map(), kids: new Map(), members: new Map(), recs: [],
  txs: null, all: null, hl: null, ready: false,
};
let D = null; // data.js (動的 import)
let unsubBook = null, unsubMonth = null, unsubAll = null, matDone = false, lastRoute = '';
const loadData = () => (D ? Promise.resolve(D) : import('./data.js').then((m) => (D = m)));

function setCats(list) {
  S.cats = new Map(list.map((c) => [c.id, c]));
  S.kids = new Map();
  for (const c of list) {
    const k = c.parentId ?? 0;
    if (!S.kids.has(k)) S.kids.set(k, []);
    S.kids.get(k).push(c);
  }
}
const rootOf = (id) => { let c = S.cats.get(id); while (c && c.parentId != null && S.cats.has(c.parentId)) c = S.cats.get(c.parentId); return c; };
const catName = (id) => {
  const c = S.cats.get(id);
  if (!c) return '未分類';
  const p = c.parentId != null ? S.cats.get(c.parentId) : null;
  return p ? `${p.name} › ${c.name}` : c.name;
};
/** 階層順に平坦化したカテゴリ一覧 */
function flatCats(type, keepId = null) {
  const out = [];
  const walk = (pid, depth) => {
    for (const c of S.kids.get(pid) || []) {
      if (c.type !== type) continue;
      if (!c.archived || c.id === keepId) out.push({ c, depth });
      walk(c.id, depth + 1);
    }
  };
  walk(0, 0);
  return out;
}
const myRole = () => S.members.get(S.me?.id)?.role || S.books.find((b) => b.id === S.bookId)?.role;

// 前回の画面を即描画するためのスナップショット (他人のデータは残さないよう、ログアウト時に消す)
let snapTimer;
function saveSnap() {
  clearTimeout(snapTimer);
  snapTimer = setTimeout(() => {
    if (!S.me || !S.bookId) return;
    LS.set('md:snap', {
      me: S.me, books: S.books, bookId: S.bookId, month: S.month,
      cats: [...S.cats.values()], members: [...S.members.values()], recs: S.recs, txs: S.txs,
    });
  }, 300);
}
function hydrate(s) {
  S.me = s.me; S.books = s.books; S.bookId = s.bookId; S.month = s.month;
  setCats(s.cats); S.members = new Map(s.members.map((m) => [m.id, m])); S.recs = s.recs; S.txs = s.txs;
}

// ---------- data wiring ----------
let rafPending = false;
function changed() {
  saveSnap();
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    if (route().parts[0] === 'search' && S.searchRefresh) S.searchRefresh();
    else render();
  });
}

function stopAll() {
  unsubBook?.(); unsubMonth?.(); unsubAll?.();
  unsubBook = unsubMonth = unsubAll = null;
  S.all = null; matDone = false;
}

function openBook(bookId, month = S.month) {
  stopAll();
  S.bookId = bookId;
  if (S.snapBook !== bookId) { S.cats = new Map(); S.kids = new Map(); S.members = new Map(); S.recs = []; S.txs = null; }
  S.snapBook = bookId;
  LS.set('md:last', { bookId });
  const onErr = (e) => { if (e.code === 'permission-denied') { toast('この家計簿にアクセスできません'); reloadBooks(true); } };
  unsubBook = D.watchBook(bookId, {
    categories: (l) => { setCats(l); changed(); },
    members: (l) => { S.members = new Map(l.map((m) => [m.id, m])); changed(); },
    recurrings: (l) => {
      S.recs = l;
      if (!matDone) { matDone = true; D.materialize(bookId, l); }
      changed();
    },
    error: onErr,
  });
  setMonth(month);
}

function setMonth(month, hl = null) {
  S.month = month;
  S.hl = hl;
  if (S.txsMonth !== month) S.txs = null;
  S.txsMonth = month;
  unsubMonth?.();
  unsubMonth = D.watchMonth(S.bookId, month, (l) => { S.txs = l; changed(); }, () => {});
  changed();
}

function ensureAll() {
  if (unsubAll) return;
  unsubAll = D.watchAll(S.bookId, (l) => { S.all = l; changed(); }, () => {});
}

async function reloadBooks(forceSwitch = false) {
  S.books = await D.listBooks();
  if (!S.books.length) return;
  if (forceSwitch || !S.books.some((b) => b.id === S.bookId)) openBook(S.books[0].id, todayStr().slice(0, 7));
  changed();
}

async function afterLogin(user) {
  S.me = user;
  const pending = sessionStorage.getItem('md:join');
  // 家計簿の一覧取得を待たず、前回の家計簿の購読を先に始める
  if (!S.bookId) S.bookId = LS.get('md:last')?.bookId || null;
  if (S.bookId && !unsubBook) openBook(S.bookId, S.month);
  let books = await D.listBooks();
  if (!books.length && !pending) { // 登録途中で中断された場合の救済
    await D.createBook(`${user.name}の家計簿`);
    books = await D.listBooks();
  }
  S.books = books;
  if (pending) { sessionStorage.removeItem('md:join'); await joinWith(pending); return; }
  if (!books.some((b) => b.id === S.bookId)) openBook(books[0].id, todayStr().slice(0, 7));
  S.ready = true;
  onHash();
  changed();
}

async function joinWith(code) {
  history.replaceState(null, '', '#/month');
  try {
    const id = await D.joinBook(code);
    S.books = await D.listBooks();
    openBook(id, todayStr().slice(0, 7));
    S.ready = true;
    toast('家計簿に参加しました');
    onHash();
  } catch (e) { toast(D.friendly(e)); if (S.bookId) { S.ready = true; render(); } }
}

/** 書き込みは待たずに画面へ即反映 (オフラインでも動く)。失敗したときだけ通知する。 */
const fire = (p, ok) => Promise.resolve(p).then(() => ok && toast(ok)).catch((e) => toast(D.friendly(e)));

// ---------- routing ----------
function route() {
  const [path, qs] = (location.hash.slice(1) || '/month').split('?');
  return { parts: path.split('/').filter(Boolean), q: new URLSearchParams(qs || '') };
}
const go = (hash) => { if (location.hash === hash) render(); else location.hash = hash; };

function onHash() {
  if (!S.me || !D) return;
  const { parts, q } = route();
  if (parts[0] === 'join') { joinWith(parts[1]); return; }
  if (parts[0] === 'month' || !parts[0]) {
    const m = /^\d{4}-\d{2}$/.test(parts[1] || '') ? parts[1] : S.month;
    const hl = q.get('hl');
    if (S.bookId && (m !== S.month || hl)) { setMonth(m, hl); return; }
  }
  if (parts[0] === 'search' && S.bookId) ensureAll();
  render();
}
window.addEventListener('hashchange', onHash);

// ---------- shell ----------
function shell(title, body, { left, right, fab = true } = {}) {
  const { parts } = route();
  const cur = parts[0] || 'month';
  const tab = (id, icon, label) => h('a', { href: `#/${id}`, class: cur === id ? 'on' : '' }, h('span', {}, icon), label);
  const nodes = [
    h('div', { class: 'top' }, left || h('span', { style: 'width:40px' }), h('h1', {}, title), right || h('span', { style: 'width:40px' })),
    body,
    h('nav', { class: 'tabs' }, tab('month', '📒', '家計簿'), tab('search', '🔍', '検索'), tab('recurring', '🔁', '繰り返し'), tab('settings', '⚙️', '設定')),
  ];
  if (fab) nodes.push(h('button', { class: 'fab', 'aria-label': '追加', onclick: () => openSheet({}) }, '＋'));
  const y = window.scrollY;
  $app.replaceChildren(...nodes);
  window.scrollTo(0, cur === lastRoute ? y : 0); // データ更新での再描画ではスクロール位置を保つ
  lastRoute = cur;
}

function render() {
  if (!S.me) return renderAuth();
  const { parts } = route();
  if (!S.bookId || !S.ready && !S.cats.size && S.txs == null) return $app.replaceChildren(h('div', { class: 'splash' }, h('div', { class: 'splash-logo' }, '💰')));
  switch (parts[0]) {
    case 'search': return renderSearch();
    case 'recurring': return renderRecurring();
    case 'settings': return renderSettings();
    case 'categories': return renderCategories();
    default: return renderMonth();
  }
}

// ---------- rows ----------
function txRow(t, { onclick, showDate = false } = {}) {
  const c = S.cats.get(t.categoryId);
  const who = S.members.size > 1 ? S.members.get(t.userId)?.name : null;
  return h('button', { class: 'row', 'data-id': t.id, onclick: onclick || (() => openSheet({ tx: t })) },
    h('div', { class: 'ic', style: `--c:${c?.color || '#8e8e93'}` }, c?.icon || '🏷️'),
    h('div', { class: 'mid' },
      h('div', { class: 't' }, t.memo || catName(t.categoryId)),
      h('div', { class: 's' }, [showDate ? t.date.replaceAll('-', '/') : null, t.memo ? catName(t.categoryId) : null, who, t.recurringId ? '🔁' : null].filter(Boolean).join(' · '))),
    h('div', { class: 'amt ' + (t.type === 'expense' ? 'exp' : 'inc') }, (t.type === 'expense' ? '-' : '+') + yen(t.amount)));
}

// ---------- month view ----------
function renderMonth() {
  const txs = S.txs;
  let inc = 0, exp = 0;
  const byCat = new Map();
  for (const t of txs || []) {
    if (t.type === 'income') inc += t.amount;
    else {
      exp += t.amount;
      const k = rootOf(t.categoryId)?.id ?? 0;
      byCat.set(k, (byCat.get(k) || 0) + t.amount);
    }
  }
  const parts = [...byCat].sort((a, b) => b[1] - a[1]);
  const colorOf = (id) => S.cats.get(id)?.color || '#8e8e93';
  const body = h('div', {},
    h('div', { class: 'card' },
      h('div', { class: 'summary' },
        h('div', {}, h('small', {}, '収入'), h('b', { class: 'inc' }, yen(inc))),
        h('div', {}, h('small', {}, '支出'), h('b', { class: 'exp' }, yen(exp))),
        h('div', {}, h('small', {}, '収支'), h('b', {}, (inc - exp < 0 ? '-' : '') + yen(Math.abs(inc - exp))))),
      exp > 0 && h('div', { class: 'bar' }, parts.map(([id, v]) => h('i', { style: `width:${(v / exp) * 100}%;background:${colorOf(id)}` }))),
      exp > 0 && h('div', { class: 'legend' }, parts.slice(0, 6).map(([id, v]) =>
        h('span', { style: `--c:${colorOf(id)}` }, `${S.cats.get(id)?.name || '未分類'} ${Math.round((v / exp) * 100)}%`)))),
    txs == null ? h('div', { class: 'empty' }, '読み込み中…')
      : txs.length ? dayGroups(txs) : h('div', { class: 'empty' }, 'この月の記録はありません', h('br'), '右下の ＋ から追加できます'));

  const monthIn = h('input', {
    type: 'month', value: S.month, 'aria-label': '月を選択',
    style: 'border:0;background:none;font:600 18px inherit;text-align:center;width:100%;color:inherit',
    onchange: (e) => e.target.value && go(`#/month/${e.target.value}`),
  });
  shell(null, body, {
    left: h('button', { class: 'icon-btn', onclick: () => go(`#/month/${shiftMonth(S.month, -1)}`), 'aria-label': '前の月' }, '‹'),
    right: h('button', { class: 'icon-btn', onclick: () => go(`#/month/${shiftMonth(S.month, 1)}`), 'aria-label': '次の月' }, '›'),
  });
  $app.querySelector('.top h1').replaceChildren(monthIn);

  if (S.hl && txs) { // 検索からのジャンプ: 該当行へスクロールして強調
    const row = $app.querySelector(`[data-id="${S.hl}"]`);
    if (row) { row.scrollIntoView({ block: 'center' }); row.classList.add('flash'); }
    S.hl = null;
    history.replaceState(null, '', `#/month/${S.month}`);
  }
}

function dayGroups(txs) {
  const card = h('div', { class: 'card' });
  const net = new Map();
  for (const t of txs) net.set(t.date, (net.get(t.date) || 0) + (t.type === 'income' ? t.amount : -t.amount));
  let cur = null;
  for (const t of txs) {
    if (t.date !== cur) {
      cur = t.date;
      const n = net.get(cur);
      card.append(h('div', { class: 'day' }, h('span', {}, dayLabel(cur)), h('span', {}, (n < 0 ? '-' : '') + yen(Math.abs(n)))));
    }
    card.append(txRow(t));
  }
  return card;
}

// ---------- search (端末内の全件を検索) ----------
let searchState = { q: '', type: '', category: '', min: '', max: '', from: '', to: '' };
function renderSearch() {
  const results = h('div', {});
  const info = h('div', { class: 'muted', style: 'padding:4px 16px' });
  let timer, shown = 50;

  function run(reset = false) {
    if (reset) shown = 50;
    if (!S.all) { info.textContent = '読み込み中…'; return; }
    const list = searchTx(S.all, S.cats, { ...searchState, category: searchState.category || '' });
    let inc = 0, exp = 0;
    for (const t of list) t.type === 'income' ? (inc += t.amount) : (exp += t.amount);
    info.textContent = list.length ? `${list.length}件 ・ 支出 ${yen(exp)} ・ 収入 ${yen(inc)}` : '該当する記録はありません';
    results.replaceChildren(list.length ? h('div', { class: 'card' },
      list.slice(0, shown).map((t) => txRow(t, { showDate: true, onclick: () => go(`#/month/${t.date.slice(0, 7)}?hl=${t.id}`) })), // タップで該当月へジャンプ
      list.length > shown && h('button', { class: 'row', onclick: () => { shown += 50; run(); } }, 'もっと見る')) : null);
  }
  S.searchRefresh = () => run();
  const input = (key, attrs = {}) => h('input', { ...attrs, value: searchState[key], oninput: (e) => { searchState[key] = e.target.value; clearTimeout(timer); timer = setTimeout(() => run(true), 150); } });
  const catSel = h('select', { onchange: (e) => { searchState.category = e.target.value; run(true); } },
    h('option', { value: '' }, 'すべてのカテゴリ'),
    ['expense', 'income'].flatMap((type) => flatCats(type, searchState.category).map(({ c, depth }) =>
      h('option', { value: c.id, selected: c.id === searchState.category }, `${type === 'income' ? '【収入】' : ''}${'　'.repeat(depth)}${c.name}`))));
  const typeSel = h('select', { onchange: (e) => { searchState.type = e.target.value; run(true); } },
    [['', '収入+支出'], ['expense', '支出のみ'], ['income', '収入のみ']].map(([v, l]) => h('option', { value: v, selected: v === searchState.type }, l)));

  const body = h('div', {},
    input('q', { class: 'search-in', type: 'search', placeholder: 'メモ・カテゴリ・金額で検索' }),
    h('div', { class: 'filters' }, typeSel, catSel,
      input('min', { type: 'number', inputmode: 'numeric', placeholder: '金額 下限' }), input('max', { type: 'number', inputmode: 'numeric', placeholder: '金額 上限' }),
      input('from', { type: 'date', 'aria-label': '開始日' }), input('to', { type: 'date', 'aria-label': '終了日' })),
    info, results);
  shell('検索', body, { fab: false });
  ensureAll();
  run();
}

// ---------- recurring ----------
function renderRecurring() {
  const list = S.recs;
  const body = h('div', {},
    list.length
      ? h('div', { class: 'card' }, list.map((r) => {
        const c = S.cats.get(r.categoryId);
        return h('button', { class: 'row', onclick: () => openSheet({ rec: r }) },
          h('div', { class: 'ic', style: `--c:${c?.color || '#8e8e93'}` }, c?.icon || '🏷️'),
          h('div', { class: 'mid' }, h('div', { class: 't' }, r.memo || catName(r.categoryId)),
            h('div', { class: 's' }, `${freqLabel(r)} ・ ${r.startDate.replaceAll('-', '/')}〜${r.endDate ? r.endDate.replaceAll('-', '/') : ''}${r.active ? '' : ' (停止中)'}`)),
          h('div', { class: 'amt ' + (r.type === 'expense' ? 'exp' : 'inc') }, yen(r.amount)));
      }))
      : h('div', { class: 'empty' }, '繰り返しの収入・支出はまだありません', h('br'), '家賃・給与・サブスクなどを登録すると自動で記録されます'),
    h('div', { class: 'pad' }, h('button', { class: 'btn', onclick: () => openSheet({ rec: {} }) }, '＋ 繰り返しを追加')));
  shell('繰り返し', body, { fab: false });
}

// ---------- add / edit sheet (取引 / 繰り返し 共用) ----------
function openSheet({ tx = null, rec = null }) {
  const isRec = !!rec;
  const src = tx || rec || {};
  const isNew = !src.id;
  const st = { type: src.type || 'expense', categoryId: src.categoryId ?? null, freq: isRec ? src.freq || 'monthly' : '', every: src.every || 1, active: src.active !== false };
  const amount = h('input', { class: 'amount-in', type: 'text', inputmode: 'numeric', placeholder: '0', value: src.amount ? String(src.amount) : '',
    oninput: (e) => { e.target.value = e.target.value.replace(/[^\d]/g, ''); } });
  const date = h('input', { type: 'date', value: (isRec ? src.startDate : src.date) || todayStr() });
  const endDate = h('input', { type: 'date', value: src.endDate || '' });
  const memo = h('input', { type: 'text', maxlength: 200, placeholder: '例: ランチ', value: src.memo || '' });
  const err = h('div', { class: 'err' });
  const catBox = h('div', { class: 'cats' });
  const seg = h('div', { class: 'seg' });
  const repeatBox = h('div', {});
  const every = h('input', { type: 'number', min: 1, max: 365, value: st.every });
  const freqSel = h('select', { onchange: (e) => { st.freq = e.target.value; drawRepeat(); } },
    [['', '繰り返さない'], ['daily', '毎日'], ['weekly', '毎週'], ['monthly', '毎月'], ['yearly', '毎年']]
      .filter(([v]) => !isRec || v).map(([v, l]) => h('option', { value: v, selected: v === st.freq }, l)));

  function drawSeg() {
    seg.replaceChildren(...[['expense', '支出'], ['income', '収入']].map(([v, l]) =>
      h('button', { class: `${st.type === v ? 'on' : ''} ${v}`, type: 'button', onclick: () => { if (st.type !== v) { st.type = v; st.categoryId = null; drawSeg(); drawCats(); } } }, l)));
  }
  function drawCats() {
    catBox.replaceChildren(...flatCats(st.type, st.categoryId).map(({ c, depth }) =>
      h('button', { type: 'button', class: st.categoryId === c.id ? 'on' : '', onclick: () => { st.categoryId = c.id; drawCats(); } },
        h('span', {}, c.icon), (depth ? '└ ' : '') + c.name)),
      h('button', { type: 'button', onclick: () => { close(); go('#/categories'); } }, h('span', {}, '➕'), '編集'));
  }
  function drawRepeat() {
    repeatBox.replaceChildren(st.freq && h('div', {},
      h('label', {}, '間隔'), h('div', { style: 'display:flex;gap:8px;align-items:center' }, every, h('span', {}, FREQ[st.freq] + 'ごと')),
      h('label', {}, '終了日 (任意)'), endDate,
      isRec && !isNew && h('label', { style: 'display:flex;gap:8px;align-items:center;font-size:15px;color:var(--text)' },
        h('input', { type: 'checkbox', style: 'width:auto', checked: st.active, onchange: (e) => { st.active = e.target.checked; } }), '有効にする')));
  }

  const bg = h('div', { class: 'sheet-bg', onclick: (e) => e.target === bg && close() });
  const close = () => bg.remove();
  function save() {
    err.textContent = '';
    const amt = Number(amount.value);
    if (!Number.isInteger(amt) || amt < 1 || amt > 999_999_999) return (err.textContent = '金額は1〜999,999,999の整数で入力してください');
    if (!isDate(date.value)) return (err.textContent = '日付を入力してください');
    const body = { type: st.type, amount: amt, categoryId: st.categoryId, memo: memo.value.trim() };
    if (isRec || st.freq) {
      const ev = Math.floor(Number(every.value)) || 1;
      if (ev < 1 || ev > 365) return (err.textContent = '間隔は1〜365で入力してください');
      if (endDate.value && (!isDate(endDate.value) || endDate.value < date.value)) return (err.textContent = '終了日は開始日以降にしてください');
      Object.assign(body, { freq: st.freq, every: ev, startDate: date.value, endDate: endDate.value || null, active: st.active });
      fire(D.saveRecurring(S.bookId, isRec && !isNew ? src.id : null, body, isRec && !isNew ? src : null)
        .then(() => D.materialize(S.bookId, S.recs)), '保存しました');
    } else {
      body.date = date.value;
      fire(D.saveTx(S.bookId, isNew ? null : src.id, body), null);
      const m = date.value.slice(0, 7);
      const onMonth = (route().parts[0] || 'month') === 'month';
      if (!onMonth || m !== S.month) go(`#/month/${m}`); // 追加した月へ移動して確認できるようにする
    }
    close();
  }
  function del() {
    if (!confirm('削除しますか？')) return;
    fire(isRec ? D.deleteRecurring(S.bookId, src.id) : D.deleteTx(S.bookId, src.id), '削除しました');
    close();
  }

  drawSeg(); drawCats(); drawRepeat();
  bg.append(h('div', { class: 'sheet form' },
    h('h2', {}, isRec ? (isNew ? '繰り返しを追加' : '繰り返しを編集') : isNew ? '記録を追加' : '記録を編集'),
    h('div', { style: 'margin-top:10px' }, seg),
    h('label', {}, '金額'), amount,
    h('label', {}, isRec ? '開始日' : '日付'), date,
    h('label', {}, 'カテゴリ'), catBox,
    h('label', {}, 'メモ'), memo,
    (isNew || isRec) && h('label', {}, isRec ? '頻度' : '繰り返し'),
    (isNew || isRec) && freqSel,
    repeatBox, err,
    h('button', { class: 'btn', onclick: save }, '保存'),
    !isNew && h('button', { class: 'btn danger', onclick: del }, '削除'),
    h('button', { class: 'btn ghost', onclick: close }, 'キャンセル')));
  document.body.append(bg);
  setTimeout(() => amount.focus(), 50);
}

// ---------- categories (無制限・階層) ----------
let catTab = 'expense';
function renderCategories() {
  const items = flatCats(catTab, null);
  const archived = [...S.cats.values()].filter((c) => c.type === catTab && c.archived);
  const body = h('div', {},
    h('div', { style: 'padding:0 12px' }, h('div', { class: 'seg' },
      [['expense', '支出'], ['income', '収入']].map(([v, l]) => h('button', { class: `${catTab === v ? 'on' : ''} ${v}`, onclick: () => { catTab = v; renderCategories(); } }, l)))),
    h('div', { class: 'card' }, items.map(({ c, depth }) =>
      h('button', { class: 'row', style: `padding-left:${16 + depth * 24}px`, onclick: () => openCategory(c) },
        h('div', { class: 'ic', style: `--c:${c.color}` }, c.icon), h('div', { class: 'mid' }, h('div', { class: 't' }, c.name)), h('span', { class: 'muted' }, '›')))),
    archived.length > 0 && h('div', { class: 'sectitle' }, `非表示 (${archived.length})`),
    archived.length > 0 && h('div', { class: 'card' }, archived.map((c) =>
      h('button', { class: 'row', onclick: () => openCategory(c) }, h('div', { class: 'ic', style: `--c:${c.color}` }, c.icon), h('div', { class: 'mid muted' }, c.name)))),
    h('div', { class: 'pad' }, h('button', { class: 'btn', onclick: () => openCategory(null) }, '＋ カテゴリを追加'),
      h('p', { class: 'muted' }, 'カテゴリは数に制限なく追加でき、親子関係 (サブカテゴリ) も作れます。')));
  shell('カテゴリ編集', body, {
    fab: false, left: h('button', { class: 'icon-btn', onclick: () => go('#/settings'), 'aria-label': '戻る' }, '‹'),
  });
}

const EMOJIS = '🍚 🍜 🍞 ☕ 🍺 🛒 🧴 🚃 🚗 ⛽ 🏠 💡 🚿 📱 💻 🎮 🎬 🎵 👕 💄 ✂️ 🏥 💊 📚 🎓 🎁 ✈️ 🏨 🐶 👶 💴 💼 🎉 📈 🏦 🧾 🏷️'.split(' ');
const COLORS = ['#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#16a085', '#5ac8fa', '#007aff', '#5856d6', '#af52de', '#ff2d55', '#a2845e', '#8e8e93'];

function openCategory(cat) {
  const isNew = !cat;
  const type = cat?.type || catTab;
  const st = { icon: cat?.icon || '🏷️', color: cat?.color || COLORS[Math.floor(Math.random() * COLORS.length)], parent: cat?.parentId ?? '' };
  const name = h('input', { type: 'text', maxlength: 40, value: cat?.name || '', placeholder: 'カテゴリ名' });
  const iconIn = h('input', { type: 'text', maxlength: 8, value: st.icon, oninput: (e) => { st.icon = e.target.value; } });
  const err = h('div', { class: 'err' });
  const banned = new Set(); // 自分と子孫は親に選べない
  if (cat) { const stack = [cat.id]; while (stack.length) { const id = stack.pop(); banned.add(id); (S.kids.get(id) || []).forEach((k) => stack.push(k.id)); } }
  const parentSel = h('select', { onchange: (e) => { st.parent = e.target.value; } },
    h('option', { value: '' }, '(なし: 大カテゴリ)'),
    flatCats(type, st.parent || null).filter(({ c }) => !banned.has(c.id))
      .map(({ c, depth }) => h('option', { value: c.id, selected: c.id === st.parent }, '　'.repeat(depth) + c.icon + ' ' + c.name)));
  const emojiRow = h('div', { style: 'display:flex;flex-wrap:wrap;gap:4px;margin-top:6px' },
    EMOJIS.map((e) => h('button', { type: 'button', style: 'font-size:22px;padding:2px 4px', onclick: () => { st.icon = e; iconIn.value = e; } }, e)));
  const colorIn = h('input', { type: 'color', value: st.color, style: 'height:40px;padding:2px', oninput: (e) => { st.color = e.target.value; } });
  const swatches = h('div', { style: 'display:flex;gap:6px;margin-top:6px;flex-wrap:wrap' },
    COLORS.map((c) => h('button', { type: 'button', 'aria-label': c, style: `width:26px;height:26px;border-radius:50%;background:${c}`, onclick: () => { st.color = c; colorIn.value = c; } })));

  const bg = h('div', { class: 'sheet-bg', onclick: (e) => e.target === bg && close() });
  const close = () => bg.remove();
  function save(extra = {}) {
    if (!name.value.trim()) return (err.textContent = 'カテゴリ名を入力してください');
    const sibs = [...S.cats.values()].filter((c) => c.type === type);
    const body = {
      type, name: name.value.trim(), icon: (st.icon || '🏷️').trim(), color: st.color, parentId: st.parent || null,
      sort: cat?.sort ?? sibs.reduce((m, c) => Math.max(m, c.sort), -1) + 1, archived: !!cat?.archived, ...extra,
    };
    fire(D.saveCategory(S.bookId, cat?.id ?? null, body));
    close();
  }
  function move(dir) {
    const sibs = (S.kids.get(cat.parentId ?? 0) || []).filter((c) => c.type === type);
    const i = sibs.findIndex((c) => c.id === cat.id), j = i + dir;
    if (j < 0 || j >= sibs.length) return;
    [sibs[i], sibs[j]] = [sibs[j], sibs[i]];
    fire(D.reorderCategories(S.bookId, sibs.map((c) => c.id)));
    close();
  }
  async function del() {
    if (!confirm('このカテゴリを削除しますか？\n(記録で使用中の場合は非表示になります)')) return;
    close();
    try {
      const r = await D.deleteCategory(S.bookId, cat, (S.kids.get(cat.id) || []).map((c) => c.id));
      toast(r.archived ? '使用中のため非表示にしました' : '削除しました');
    } catch (e) { toast(D.friendly(e)); }
  }

  bg.append(h('div', { class: 'sheet form' },
    h('h2', {}, isNew ? `${type === 'expense' ? '支出' : '収入'}カテゴリを追加` : 'カテゴリを編集'),
    h('label', {}, '名前'), name,
    h('label', {}, '親カテゴリ'), parentSel,
    h('label', {}, 'アイコン'), iconIn, emojiRow,
    h('label', {}, '色'), colorIn, swatches, err,
    h('button', { class: 'btn', onclick: () => save() }, '保存'),
    !isNew && h('div', { style: 'display:flex;gap:8px' },
      h('button', { class: 'btn ghost', onclick: () => move(-1) }, '↑ 上へ'), h('button', { class: 'btn ghost', onclick: () => move(1) }, '↓ 下へ')),
    !isNew && h('button', { class: 'btn ghost', onclick: () => save({ archived: !cat.archived }) }, cat.archived ? '表示に戻す' : '非表示にする'),
    !isNew && h('button', { class: 'btn danger', onclick: del }, '削除'),
    h('button', { class: 'btn ghost', onclick: close }, 'キャンセル')));
  document.body.append(bg);
}

// ---------- settings / sharing ----------
function renderSettings() {
  const book = S.books.find((b) => b.id === S.bookId);
  const isOwner = myRole() === 'owner';
  const inviteBox = h('div', {});
  const joinIn = h('input', { type: 'text', placeholder: '招待コードを入力' });

  async function invite() {
    try {
      const { code } = await D.createInvite(S.bookId, book?.name || '家計簿');
      const link = `${location.origin}/#/join/${code}`;
      inviteBox.replaceChildren(h('div', { class: 'pad' },
        h('div', { class: 'muted' }, '招待コード (7日間有効)'), h('div', { class: 'code' }, code),
        h('div', { class: 'muted', style: 'word-break:break-all;margin:6px 0' }, link),
        h('button', { class: 'btn sm', onclick: async () => {
          try { if (navigator.share) await navigator.share({ title: 'マネーダイアリー', text: `家計簿に参加: ${link}` }); else { await navigator.clipboard.writeText(link); toast('リンクをコピーしました'); } } catch {}
        } }, '共有する')));
    } catch (e) { toast(D.friendly(e)); }
  }
  async function removeMember(m) {
    const self = m.id === S.me.id;
    if (!confirm(self ? 'この家計簿から退出しますか？' : `${m.name} さんを削除しますか？`)) return;
    try {
      await D.removeMember(S.bookId, m.id);
      if (self) await reloadBooks(true);
    } catch (e) { toast(D.friendly(e)); }
  }
  async function switchTo(id) { openBook(id, todayStr().slice(0, 7)); go('#/month'); }

  const body = h('div', {},
    h('div', { class: 'sectitle' }, 'アカウント'),
    h('div', { class: 'card' }, h('div', { class: 'pad' }, h('b', {}, S.me.name), h('div', { class: 'muted' }, S.me.email))),
    h('div', { class: 'sectitle' }, '家計簿'),
    h('div', { class: 'card' }, S.books.map((b) => h('button', { class: 'row', onclick: () => b.id !== S.bookId && switchTo(b.id) },
      h('div', { class: 'mid' }, b.name), b.id === S.bookId ? h('span', { class: 'chip' }, '表示中') : h('span', { class: 'muted' }, '切替')))),
    h('div', { class: 'pad' }, h('button', { class: 'btn ghost sm', onclick: async () => {
      const n = prompt('新しい家計簿の名前')?.trim(); if (!n) return;
      try { const id = await D.createBook(n); S.books = await D.listBooks(); openBook(id, todayStr().slice(0, 7)); go('#/month'); } catch (e) { toast(D.friendly(e)); }
    } }, '＋ 家計簿を作成')),
    h('div', { class: 'sectitle' }, `共有メンバー — ${book?.name || ''}`),
    h('div', { class: 'card' }, [...S.members.values()].map((m) => h('div', { class: 'row' },
      h('div', { class: 'mid' }, m.name + (m.id === S.me.id ? ' (自分)' : '')), h('span', { class: 'chip' }, m.role === 'owner' ? 'オーナー' : 'メンバー'),
      m.role !== 'owner' && (isOwner || m.id === S.me.id) && h('button', { class: 'btn sm danger', onclick: () => removeMember(m) }, m.id === S.me.id ? '退出' : '削除')))),
    h('div', { class: 'card' }, h('div', { class: 'pad' }, h('button', { class: 'btn sm', onclick: invite }, '家族・パートナーを招待')), inviteBox),
    h('div', { class: 'sectitle' }, '招待コードで参加'),
    h('div', { class: 'card form' }, h('div', { class: 'pad' }, joinIn, h('button', { class: 'btn sm', style: 'margin-top:10px', onclick: () => {
      const c = joinIn.value.trim(); if (c) joinWith(c.replace(/^.*\/join\//, ''));
    } }, '参加する'))),
    h('div', { class: 'sectitle' }, '管理'),
    h('div', { class: 'card' },
      h('button', { class: 'row', onclick: () => go('#/categories') }, h('div', { class: 'mid' }, '🏷️ カテゴリ編集'), h('span', { class: 'muted' }, '›')),
      isOwner && h('button', { class: 'row', onclick: async () => {
        const n = prompt('家計簿の名前', book?.name)?.trim(); if (!n) return;
        try { await D.renameBook(S.bookId, n); await reloadBooks(); } catch (e) { toast(D.friendly(e)); }
      } }, h('div', { class: 'mid' }, '✏️ 家計簿名を変更'), h('span', { class: 'muted' }, '›'))),
    h('div', { class: 'pad' }, h('button', { class: 'btn danger', onclick: logout }, 'ログアウト')));
  shell('設定', body, { fab: false });
}

async function logout() {
  stopAll();
  LS.del('md:snap'); LS.del('md:last');
  try { await D.logout(); } catch {}
  location.hash = '#/month';
  Object.assign(S, { me: null, books: [], bookId: null, snapBook: null, txs: null, ready: false });
  renderAuth();
}

// ---------- auth ----------
function renderAuth(mode = 'login') {
  const email = h('input', { type: 'email', autocomplete: 'email', placeholder: 'メールアドレス' });
  const name = h('input', { type: 'text', autocomplete: 'nickname', placeholder: 'ニックネーム', maxlength: 40 });
  const pw = h('input', { type: 'password', autocomplete: mode === 'login' ? 'current-password' : 'new-password', placeholder: 'パスワード (8文字以上)' });
  const err = h('div', { class: 'err' });
  const btn = h('button', { class: 'btn', type: 'submit' }, mode === 'login' ? 'ログイン' : 'アカウントを作成');
  async function submit(e) {
    e.preventDefault();
    err.textContent = '';
    btn.disabled = true;
    try {
      await loadData();
      if (mode === 'login') await D.login(email.value.trim(), pw.value);
      else {
        if (!name.value.trim()) throw new Error('ニックネームを入力してください');
        S.registering = true;
        await D.register(email.value.trim(), pw.value, name.value.trim());
        S.registering = false;
        await afterLogin(D.currentUser() && { ...D.currentUser(), email: email.value.trim() });
      }
    } catch (x) { S.registering = false; err.textContent = D ? D.friendly(x) : x.message; btn.disabled = false; }
  }
  $app.replaceChildren(h('div', { class: 'auth' },
    h('div', { style: 'font-size:56px' }, '💰'), h('h1', {}, 'マネーダイアリー'),
    h('form', { class: 'card pad form', onsubmit: submit },
      h('div', { class: 'seg' }, [['login', 'ログイン'], ['register', '新規登録']].map(([m, l]) =>
        h('button', { type: 'button', class: mode === m ? 'on' : '', onclick: () => renderAuth(m) }, l))),
      mode === 'register' && h('label', {}, 'ニックネーム'), mode === 'register' && name,
      h('label', {}, 'メールアドレス'), email, h('label', {}, 'パスワード'), pw, err, btn)));
}

// ---------- boot ----------
async function boot() {
  if ('serviceWorker' in navigator) {
    // 新しい版に切り替わったら一度だけ再読み込みして、古い版の部品が混ざらないようにする
    const had = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (had && !reloaded) { reloaded = true; location.reload(); } });
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
  const m = /^#\/join\/(.+)$/.exec(location.hash);
  if (m) sessionStorage.setItem('md:join', decodeURIComponent(m[1]));

  // 1) 前回のデータがあれば、Firebase の読み込みを待たず即描画
  const snap = LS.get('md:snap');
  if (snap?.me && snap.bookId && !m) { hydrate(snap); S.snapBook = snap.bookId; S.txsMonth = snap.month; S.ready = true; render(); }

  // 2) Firebase を読み込み、ログイン状態に応じて最新データへ切り替える
  await loadData();
  D.onUser((user) => {
    if (S.registering) return;
    if (!user) {
      stopAll();
      LS.del('md:snap');
      Object.assign(S, { me: null, bookId: null, snapBook: null, books: [], txs: null, ready: false });
      return renderAuth();
    }
    if (S.me && S.me.id !== user.id) { Object.assign(S, { bookId: null, snapBook: null, books: [], txs: null }); }
    afterLogin(user).catch((e) => toast(D.friendly(e)));
  });
}
boot();
