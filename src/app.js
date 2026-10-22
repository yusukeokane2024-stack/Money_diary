// マネーダイアリー 画面 (ビルド時に束ねる / フレームワークなし)
// Firebase を含む data.js は初回描画のあとで読み込む。前回のデータを localStorage から先に描画する。
import { searchTx } from './lib/search.js';
import { icon, CATEGORY_ICONS } from './lib/icons.js';
import { monthGrid, compactYen, amountSize, dayTotals } from './lib/calendar.js';
import { dueOccurrences, upcomingInMonth, today as jstToday } from './lib/recurring.js';
import { categoryBreakdown, monthlyTrend, memberTotals, budgetStatus } from './lib/charts.js';

/* global __BUILD__ */
const $app = document.getElementById('app');
const BUILD = typeof __BUILD__ === 'string' ? __BUILD__ : 'dev';
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
/** アプリのロゴ (¥ を線で描いたマーク) */
function mark() {
  const t = document.createElement('template');
  t.innerHTML = '<div class="mark"><svg viewBox="0 0 24 24"><path d="M6.5 4l5.5 8 5.5-8M12 12v8M8 14.5h8M8 17.5h8"/></svg></div>';
  return t.content.firstChild;
}
const catChip = (c, size = 20) => h('div', { class: 'ic', style: `--c:${c?.color || '#8a8b91'}` }, icon(c?.icon || 'tag', size));
const chev = () => h('span', { class: 'chev', style: 'display:flex;color:var(--sub)' }, icon('chevron-right', 18));
const viewMode = () => (LS.get('md:view') === 'list' ? 'list' : 'cal'); // 既定はカレンダー

function toast(msg) {
  const t = h('div', { class: 'toast' }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), 2600);
}

// ---------- state ----------
const S = {
  me: null, books: [], bookId: null, month: todayStr().slice(0, 7),
  cats: new Map(), kids: new Map(), members: new Map(), recs: [],
  txs: null, all: null, hl: null, ready: false, selDay: null, budget: 0,
};
let D = null; // data.js (動的 import)
let unsubBook = null, unsubMonth = null, unsubAll = null, materializing = false, materializeAgain = false, lastRoute = '';
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
      cats: [...S.cats.values()], members: [...S.members.values()], recs: S.recs, txs: S.txs, budget: S.budget,
    });
  }, 300);
}
function hydrate(s) {
  S.me = s.me; S.books = s.books; S.bookId = s.bookId; S.month = s.month;
  setCats(s.cats); S.members = new Map(s.members.map((m) => [m.id, m])); S.recs = s.recs; S.txs = s.txs; S.budget = s.budget || 0;
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

/**
 * 今日までに発生している繰り返し分があれば、取引として記録する (二重登録されない)。
 * 繰り返しの一覧が更新されたとき・アプリに戻ってきたとき・ネットに戻ったときに呼ぶ。
 */
function runMaterialize() {
  if (!D || !S.bookId) return;
  if (materializing) { materializeAgain = true; return; } // 処理中に呼ばれたら、終わったあとにもう一度実行する (取りこぼし防止)
  const now = jstToday();
  if (!S.recs.some((r) => r.active && dueOccurrences(r, now, 1).due.length)) return; // 未生成の分がなければ何もしない
  materializing = true;
  D.materialize(S.bookId, S.recs).finally(() => {
    materializing = false;
    if (materializeAgain) { materializeAgain = false; runMaterialize(); }
  });
}

function stopAll() {
  unsubBook?.(); unsubMonth?.(); unsubAll?.();
  unsubBook = unsubMonth = unsubAll = null;
  S.all = null;
}

function openBook(bookId, month = S.month) {
  stopAll();
  S.bookId = bookId;
  if (S.snapBook !== bookId) { S.cats = new Map(); S.kids = new Map(); S.members = new Map(); S.recs = []; S.txs = null; S.budget = 0; }
  S.snapBook = bookId;
  LS.set('md:last', { bookId });
  const onErr = (e) => { if (e.code === 'permission-denied') { toast('この家計簿にアクセスできません'); reloadBooks(true); } };
  unsubBook = D.watchBook(bookId, {
    categories: (l) => { setCats(l); changed(); },
    members: (l) => { S.members = new Map(l.map((m) => [m.id, m])); changed(); },
    recurrings: (l) => { S.recs = l; changed(); runMaterialize(); },
    budget: (v) => { S.budget = v; changed(); },
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
  if (['month', 'graph'].includes(parts[0]) || !parts[0]) {
    const m = /^\d{4}-\d{2}$/.test(parts[1] || '') ? parts[1] : S.month;
    const hl = parts[0] === 'graph' ? null : q.get('hl');
    if (S.bookId && (m !== S.month || hl)) { setMonth(m, hl); return; }
  }
  if (['search', 'graph'].includes(parts[0]) && S.bookId) ensureAll();
  render();
}
window.addEventListener('hashchange', onHash);

// ---------- shell ----------
function shell(title, body, { left, right, fab = true } = {}) {
  const { parts } = route();
  const cur = parts[0] || 'month';
  const active = { recurring: 'settings', categories: 'settings' }[cur] || cur; // 設定の中のページは設定タブを選択状態にする
  const tab = (id, ic, label) => h('a', { href: `#/${id}`, class: active === id ? 'on' : '' }, icon(ic, 22), label);
  const nodes = [
    h('div', { class: 'top' }, left || h('span', { style: 'width:40px' }), h('h1', {}, title), right || h('span', { style: 'width:40px' })),
    body,
    h('nav', { class: 'tabs' }, tab('month', 'wallet', '家計簿'), tab('graph', 'pie', 'グラフ'), tab('search', 'search', '検索'), tab('settings', 'sliders', '設定')),
  ];
  if (fab) {
    nodes.push(h('button', { class: 'fab', 'aria-label': '追加',
      onclick: () => openSheet({ date: cur === 'month' && viewMode() === 'cal' ? S.selDay : null }) }, icon('plus', 26)));
  }
  const y = window.scrollY;
  $app.replaceChildren(...nodes);
  window.scrollTo(0, cur === lastRoute ? y : 0); // データ更新での再描画ではスクロール位置を保つ
  lastRoute = cur;
}

function render() {
  if (!S.me) return renderAuth();
  const { parts } = route();
  if (!S.bookId || !S.ready && !S.cats.size && S.txs == null) return $app.replaceChildren(h('div', { class: 'splash' }, mark()));
  switch (parts[0]) {
    case 'search': return renderSearch();
    case 'graph': return renderGraph();
    case 'recurring': return renderRecurring();
    case 'settings': return renderSettings();
    case 'categories': return renderCategories();
    default: return renderMonth();
  }
}

// ---------- rows ----------
/**
 * 表示する月の記録。実際の記録に、繰り返しの「予定」(まだ記録されていない未来分) を加えたもの。
 * 予定は保存されておらず、日付が来て記録されると自動で本物に置き換わる (nextN で二重計上を防ぐ)。
 */
function monthItems() {
  if (S.txs == null) return null;
  const have = new Set(S.txs.map((t) => t.id)); // 記録済みと重なる予定は除く (書き込み直後の一瞬の二重表示を避ける)
  const sched = [];
  for (const r of S.recs) {
    for (const { date } of upcomingInMonth(r, S.month)) {
      const id = `r_${r.id}_${date}`;
      if (have.has(id)) continue;
      sched.push({ id: `p_${id}`, userId: r.userId, type: r.type, amount: r.amount, categoryId: r.categoryId ?? null, date, memo: r.memo || '', recurringId: r.id, scheduled: true });
    }
  }
  if (!sched.length) return S.txs;
  return [...S.txs, ...sched].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (a.scheduled ? 0 : 1) - (b.scheduled ? 0 : 1)));
}

function txRow(t, { onclick, showDate = false } = {}) {
  const c = S.cats.get(t.categoryId);
  const who = S.members.size > 1 ? S.members.get(t.userId)?.name : null;
  const sub = [showDate ? t.date.replaceAll('-', '/') : null, t.memo ? catName(t.categoryId) : null, who].filter(Boolean).join(' · ');
  // 予定の行は、タップすると元の繰り返し設定の編集画面を開く
  const open = t.scheduled
    ? () => { const r = S.recs.find((x) => x.id === t.recurringId); if (r) openSheet({ rec: r }); }
    : () => openSheet({ tx: t });
  return h('button', { class: 'row' + (t.scheduled ? ' sched' : ''), 'data-id': t.id, onclick: onclick || open },
    catChip(c),
    h('div', { class: 'mid' },
      h('div', { class: 't' }, t.memo || catName(t.categoryId)),
      h('div', { class: 's' }, t.scheduled && h('span', { class: 'tag' }, '予定'), sub, t.recurringId && icon('repeat', 12))),
    h('div', { class: 'amt num ' + (t.type === 'income' ? 'inc' : '') }, (t.type === 'expense' ? '-' : '+') + yen(t.amount)));
}

// ---------- month view ----------
function renderMonth() {
  const txs = monthItems();
  const view = viewMode();
  let inc = 0, exp = 0;
  const byCat = new Map();
  let schedInc = 0, schedExp = 0;
  for (const t of txs || []) {
    if (t.type === 'income') { inc += t.amount; if (t.scheduled) schedInc += t.amount; }
    else {
      exp += t.amount;
      if (t.scheduled) schedExp += t.amount;
      const k = rootOf(t.categoryId)?.id ?? 0;
      byCat.set(k, (byCat.get(k) || 0) + t.amount);
    }
  }
  const parts = [...byCat].sort((a, b) => b[1] - a[1]);
  const colorOf = (id) => S.cats.get(id)?.color || '#8a8b91';
  const bal = inc - exp;

  // 検索からのジャンプ時はカレンダーでもその日を選択する
  if (S.hl && txs) { const t = txs.find((x) => x.id === S.hl); if (t) S.selDay = t.date; }
  if (!S.selDay || S.selDay.slice(0, 7) !== S.month) S.selDay = S.month === todayStr().slice(0, 7) ? todayStr() : `${S.month}-01`;

  const summary = h('div', { class: 'card' },
    h('div', { class: 'summary-head' }, h('small', {}, `${+S.month.slice(5)}月の収支`), h('div', { class: 'balance num' }, (bal < 0 ? '-' : '') + yen(Math.abs(bal)))),
    h('div', { class: 'summary' },
      h('div', { class: 's-inc' }, h('small', {}, '収入'), h('b', { class: 'num' }, yen(inc))),
      h('div', { class: 's-exp' }, h('small', {}, '支出'), h('b', { class: 'num' }, yen(exp)))),
    (schedInc || schedExp) > 0 && h('div', { class: 'sched-note num' }, '予定を含む: ' + [schedExp ? `支出 ${yen(schedExp)}` : null, schedInc ? `収入 ${yen(schedInc)}` : null].filter(Boolean).join(' ・ ')),
    exp > 0 && h('div', { class: 'bar' }, parts.map(([id, v]) => h('i', { style: `width:${(v / exp) * 100}%;background:${colorOf(id)}` }))),
    exp > 0 && h('div', { class: 'legend' }, parts.slice(0, 6).map(([id, v]) =>
      h('span', { style: `--c:${colorOf(id)}` }, `${S.cats.get(id)?.name || '未分類'} ${Math.round((v / exp) * 100)}%`))),
    budgetBlock(exp));
  const toggle = h('div', { class: 'seg toggle', role: 'tablist' },
    [['list', 'list', 'リスト'], ['cal', 'calendar', 'カレンダー']].map(([v, ic, l]) =>
      h('button', { class: view === v ? 'on' : '', 'data-view': v, onclick: () => { LS.set('md:view', v); render(); } }, icon(ic, 16), l)));

  let main;
  if (txs == null) main = h('div', { class: 'empty' }, '読み込み中…');
  else if (view === 'cal') main = calendarCard(txs);
  else if (!txs.length) main = h('div', { class: 'empty' }, 'この月の記録はありません', h('br'), '右下の ＋ から追加できます');
  else main = dayGroups(txs);

  const hd = monthHeader();
  shell(hd.title, h('div', {}, summary, toggle, main), { left: hd.left, right: hd.right });

  if (S.hl && txs) { // 検索からのジャンプ: 該当行へスクロールして強調
    const row = $app.querySelector(`[data-id="${S.hl}"]`);
    if (row) { row.scrollIntoView({ block: 'center' }); row.classList.add('flash'); }
    S.hl = null;
    history.replaceState(null, '', `#/month/${S.month}`);
  }
}

/** 月の切り替えヘッダ (家計簿・グラフで共通) */
function monthHeader() {
  const tab = route().parts[0] === 'graph' ? 'graph' : 'month';
  const to = (m) => go(`#/${tab}/${m}`);
  const monthIn = h('input', { type: 'month', value: S.month, tabindex: '-1', 'aria-label': '月を選択', onchange: (e) => e.target.value && to(e.target.value) });
  const title = h('button', { class: 'month-btn', onclick: () => { try { monthIn.showPicker(); } catch { monthIn.focus(); monthIn.click(); } } },
    `${S.month.slice(0, 4)}年${+S.month.slice(5)}月`, icon('chevron-down', 16), monthIn);
  return {
    title,
    left: h('button', { class: 'icon-btn', onclick: () => to(shiftMonth(S.month, -1)), 'aria-label': '前の月' }, icon('chevron-left', 22)),
    right: h('button', { class: 'icon-btn', onclick: () => to(shiftMonth(S.month, 1)), 'aria-label': '次の月' }, icon('chevron-right', 22)),
  };
}

function budgetBlock(spent) {
  const bs = budgetStatus(S.budget, spent);
  if (!bs) return h('button', { class: 'budget-set', onclick: openBudget }, icon('target', 16), '月の予算を設定する');
  return h('button', { class: 'budget', onclick: openBudget, 'aria-label': '予算を変更' },
    h('div', { class: 'budget-top' }, h('span', {}, bs.over ? '予算オーバー' : '今月の残り予算'), h('b', { class: 'num' + (bs.over ? ' exp' : '') }, (bs.over ? '-' : '') + yen(Math.abs(bs.remaining)))),
    h('div', { class: 'gauge' + (bs.over ? ' over' : '') }, h('i', { style: `width:${Math.min(bs.ratio, 1) * 100}%` })),
    h('div', { class: 'budget-sub num' }, `予算 ${yen(S.budget)} ・ ${Math.round(bs.ratio * 100)}% 使用`));
}

function openBudget() {
  const input = h('input', { type: 'text', inputmode: 'numeric', class: 'amount-in', placeholder: '0', value: S.budget ? String(S.budget) : '',
    oninput: (e) => { e.target.value = e.target.value.replace(/[^\d]/g, ''); } });
  const err = h('div', { class: 'err' });
  const bg = h('div', { class: 'sheet-bg', onclick: (e) => e.target === bg && close() });
  const close = () => bg.remove();
  const save = (n) => {
    if (!Number.isInteger(n) || n < 0 || n > 999_999_999) return (err.textContent = '予算は0〜999,999,999の整数で入力してください');
    fire(D.setBudget(S.bookId, n), n ? '予算を保存しました' : '予算を解除しました');
    close();
  };
  bg.append(h('div', { class: 'sheet form' },
    h('h2', {}, '月の予算'), h('p', { class: 'muted', style: 'margin:0' }, '毎月の支出の上限です。メンバー全員で共通です。'),
    h('label', {}, '1か月の予算'), h('div', { class: 'amount-wrap' }, input), err,
    h('button', { class: 'btn', onclick: () => save(Number(input.value)) }, '保存'),
    S.budget > 0 && h('button', { class: 'btn danger', onclick: () => save(0) }, '予算を解除'),
    h('button', { class: 'btn ghost', onclick: close }, 'キャンセル')));
  document.body.append(bg);
  setTimeout(() => input.focus(), 50);
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
      card.append(h('div', { class: 'day' }, h('span', {}, dayLabel(cur)), h('span', { class: 'num' }, (n < 0 ? '-' : '+') + yen(Math.abs(n)))));
    }
    card.append(txRow(t));
  }
  return card;
}

/** カレンダー: 日ごとの収支を表示し、日付をタップするとその日の記録を下に出す */
function calendarCard(txs) {
  const totals = dayTotals(txs);
  const today = todayStr();
  const cal = h('div', { class: 'cal' },
    h('div', { class: 'cal-wd' }, WD.map((w) => h('span', {}, w))),
    monthGrid(S.month).map((week) => h('div', { class: 'cal-week' }, week.map((date, i) => {
      if (!date) return h('div', { class: 'cal-cell' });
      const t = totals.get(date);
      return h('button', {
        class: `cal-cell${date === today ? ' today' : ''}${date === S.selDay ? ' sel' : ''}${i === 0 ? ' sun' : ''}${i === 6 ? ' sat' : ''}`,
        'data-date': date, 'aria-label': dayLabel(date), onclick: () => { S.selDay = date; render(); },
      }, h('span', { class: 'd' }, String(+date.slice(8))),
        t?.expense ? h('span', { class: `a e num ${amountSize(t.expense)}` }, compactYen(t.expense)) : null,
        t?.income ? h('span', { class: `a n num ${amountSize(t.income)}` }, compactYen(t.income)) : null);
    }))));
  const day = txs.filter((t) => t.date === S.selDay);
  const net = day.reduce((s, t) => s + (t.type === 'income' ? t.amount : -t.amount), 0);
  return h('div', { class: 'card' }, cal,
    h('div', { class: 'day-panel-head' },
      h('div', {}, h('b', {}, dayLabel(S.selDay)), day.length ? h('small', { class: 'num' }, (net < 0 ? '-' : '+') + yen(Math.abs(net))) : null),
      h('button', { class: 'btn sm', onclick: () => openSheet({ date: S.selDay }) }, icon('plus', 15), '追加')),
    day.length ? day.map((t) => txRow(t)) : h('div', { class: 'empty', style: 'padding:20px 16px 24px' }, 'この日の記録はありません'));
}

// ---------- graph ----------
let graphType = 'expense';
const expanded = new Set();
const safeColor = (c) => (/^#[0-9a-fA-F]{6}$/.test(c) ? c : '#8a8b91');
const svgEl = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild; };

function donut(items, total) {
  const R = 70, W = 26, C = 2 * Math.PI * R, gap = items.length > 1 ? 2 : 0;
  let off = 0;
  const arcs = items.map((it) => {
    const len = Math.max(it.share * C - gap, 0.5);
    const c = `<circle cx="100" cy="100" r="${R}" fill="none" stroke="${safeColor(it.color)}" stroke-width="${W}" stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}"/>`;
    off += it.share * C;
    return c;
  }).join('');
  const svg = svgEl(`<svg viewBox="0 0 200 200" class="donut" role="img" aria-label="カテゴリ別の割合"><circle cx="100" cy="100" r="${R}" fill="none" stroke="var(--fill)" stroke-width="${W}"/><g transform="rotate(-90 100 100)">${arcs}</g></svg>`);
  return h('div', { class: 'donut-wrap' }, svg,
    h('div', { class: 'donut-center' }, h('small', {}, graphType === 'expense' ? '支出' : '収入'), h('b', { class: 'num' }, yen(total))));
}

function trendChart(data) {
  const W = 320, base = 118, top = 16, gw = W / data.length, bw = 13;
  const max = Math.max(1, ...data.flatMap((d) => [d.income, d.expense]));
  const hgt = (v) => (v ? Math.max(2, (v / max) * (base - top)) : 0);
  const groups = data.map((d, i) => {
    const x = i * gw + gw / 2, cur = d.month === S.month;
    return `<g data-m="${d.month}" class="tr-g${cur ? ' cur' : ''}"><rect x="${i * gw}" y="0" width="${gw}" height="150" fill="transparent"/>`
      + `<rect class="tr-i" x="${(x - bw - 1).toFixed(1)}" y="${(base - hgt(d.income)).toFixed(1)}" width="${bw}" height="${hgt(d.income).toFixed(1)}" rx="3"/>`
      + `<rect class="tr-e" x="${(x + 1).toFixed(1)}" y="${(base - hgt(d.expense)).toFixed(1)}" width="${bw}" height="${hgt(d.expense).toFixed(1)}" rx="3"/>`
      + `<text x="${x}" y="${base + 18}" text-anchor="middle" class="tr-l">${+d.month.slice(5)}月</text></g>`;
  }).join('');
  const svg = svgEl(`<svg viewBox="0 0 ${W} 144" class="trend" role="img" aria-label="月別の収入と支出の推移"><line x1="0" x2="${W}" y1="${base}" y2="${base}" class="tr-axis"/>${groups}</svg>`);
  svg.querySelectorAll('[data-m]').forEach((g) => g.addEventListener('click', () => go(`#/graph/${g.getAttribute('data-m')}`)));
  return svg;
}

function renderGraph() {
  const type = graphType;
  const items = monthItems();
  const bd = categoryBreakdown(items || [], S.cats, type);
  const seg = h('div', { class: 'seg', style: 'margin:12px 12px 0' },
    [['expense', '支出'], ['income', '収入']].map(([v, l]) => h('button', { class: `${type === v ? 'on' : ''} ${v}`, 'data-type': v, onclick: () => { graphType = v; render(); } }, l)));

  const catCard = h('div', { class: 'card' },
    h('div', { class: 'g-title' }, 'カテゴリ別'),
    items == null ? h('div', { class: 'empty' }, '読み込み中…')
      : !bd.items.length ? h('div', { class: 'empty' }, `この月の${type === 'expense' ? '支出' : '収入'}はありません`)
        : [donut(bd.items, bd.total), h('div', { class: 'g-list' }, bd.items.map((it) => {
          const open = expanded.has(`${type}:${it.id}`);
          const hasKids = it.children.length > 1 || (it.children[0] && it.children[0].id !== it.id);
          return h('div', { class: 'g-item' },
            h('button', { class: 'row g-row', 'aria-expanded': open ? 'true' : 'false', onclick: () => { const k = `${type}:${it.id}`; expanded.has(k) ? expanded.delete(k) : expanded.add(k); render(); } },
              h('div', { class: 'ic', style: `--c:${safeColor(it.color)}` }, icon(it.icon, 20)),
              h('div', { class: 'mid' }, h('div', { class: 't' }, it.name),
                h('div', { class: 'pbar' }, h('i', { style: `width:${(it.share * 100).toFixed(1)}%;background:${safeColor(it.color)}` }))),
              h('div', { class: 'g-amt' }, h('b', { class: 'num' }, yen(it.total)), h('small', { class: 'num' }, `${(it.share * 100).toFixed(it.share < 0.1 ? 1 : 0)}%`)),
              hasKids && h('span', { class: 'chev' + (open ? ' open' : ''), style: 'display:flex;color:var(--sub)' }, icon('chevron-down', 18))),
            open && hasKids && h('div', { class: 'g-kids' }, it.children.map((k) =>
              h('div', { class: 'g-kid' }, h('span', {}, k.name), h('span', { class: 'num' }, `${yen(k.total)}  ${Math.round(k.share * 100)}%`)))));
        }))]);

  const trend = S.all ? monthlyTrend(S.all, S.month, 6) : null;
  const trendCard = h('div', { class: 'card' },
    h('div', { class: 'g-title' }, '月別の推移', h('span', { class: 'tr-legend' }, h('i', { class: 'i-inc' }), '収入', h('i', { class: 'i-exp' }), '支出')),
    trend ? trendChart(trend) : h('div', { class: 'empty', style: 'padding:30px' }, '読み込み中…'));

  const mt = memberTotals(items || [], type);
  const memberCard = S.members.size > 1 && mt.total > 0 ? h('div', { class: 'card' },
    h('div', { class: 'g-title' }, 'メンバー別'),
    mt.items.map((m) => h('div', { class: 'row', style: 'cursor:default' },
      h('div', { class: 'ic', style: '--c:var(--ink)' }, h('b', {}, (S.members.get(m.id)?.name || '?').slice(0, 1))),
      h('div', { class: 'mid' }, h('div', { class: 't' }, S.members.get(m.id)?.name || '退出したメンバー'), h('div', { class: 'pbar' }, h('i', { style: `width:${(m.share * 100).toFixed(1)}%;background:var(--ink)` }))),
      h('div', { class: 'g-amt' }, h('b', { class: 'num' }, yen(m.total)), h('small', { class: 'num' }, `${Math.round(m.share * 100)}%`))))) : null;

  const hd = monthHeader();
  shell(hd.title, h('div', {}, seg, catCard, trendCard, memberCard), { left: hd.left, right: hd.right, fab: false });
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
      h('option', { value: c.id, selected: c.id === searchState.category }, `${type === 'income' ? '収入 / ' : ''}${'　'.repeat(depth)}${c.name}`))));
  const typeSel = h('select', { onchange: (e) => { searchState.type = e.target.value; run(true); } },
    [['', '収入+支出'], ['expense', '支出のみ'], ['income', '収入のみ']].map(([v, l]) => h('option', { value: v, selected: v === searchState.type }, l)));

  const body = h('div', {},
    h('div', { class: 'search-wrap' }, icon('search', 18), input('q', { class: 'search-in', type: 'search', placeholder: 'メモ・カテゴリ・金額で検索' })),
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
          catChip(c),
          h('div', { class: 'mid' }, h('div', { class: 't' }, r.memo || catName(r.categoryId)),
            h('div', { class: 's' }, `${freqLabel(r)} ・ ${r.startDate.replaceAll('-', '/')}〜${r.endDate ? r.endDate.replaceAll('-', '/') : ''}${r.active ? '' : ' (停止中)'}`)),
          h('div', { class: 'amt num ' + (r.type === 'income' ? 'inc' : '') }, yen(r.amount)));
      }))
      : h('div', { class: 'empty' }, '繰り返しの収入・支出はまだありません', h('br'), '家賃・給与・サブスクなどを登録すると自動で記録されます'),
    h('div', { class: 'pad' }, h('button', { class: 'btn', onclick: () => openSheet({ rec: {} }) }, '繰り返しを追加')));
  shell('繰り返しの管理', body, { fab: false, left: h('button', { class: 'icon-btn', onclick: () => go('#/settings'), 'aria-label': '戻る' }, icon('chevron-left', 22)) });
}

// ---------- add / edit sheet (取引 / 繰り返し 共用) ----------
function openSheet({ tx = null, rec = null, date: defDate = null, copied = false }) {
  const isRec = !!rec;
  const src = tx || rec || {};
  const isNew = !src.id;
  const fromRec = !isRec && !isNew && src.recurringId ? S.recs.find((r) => r.id === src.recurringId) : null; // 繰り返しから作られた記録
  const st = { type: src.type || 'expense', categoryId: src.categoryId ?? null, freq: isRec ? src.freq || 'monthly' : '', every: src.every || 1, active: src.active !== false };
  const amount = h('input', { class: 'amount-in', type: 'text', inputmode: 'numeric', placeholder: '0', value: src.amount ? String(src.amount) : '',
    oninput: (e) => { e.target.value = e.target.value.replace(/[^\d]/g, ''); } });
  const date = h('input', { type: 'date', value: (isRec ? src.startDate : src.date) || defDate || todayStr() });
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
        catChip(c, 18), (depth ? '└ ' : '') + c.name)),
      h('button', { type: 'button', onclick: () => { close(); go('#/categories'); } }, h('div', { class: 'ic' }, icon('pencil', 18)), '編集'));
  }
  function drawRepeat() {
    repeatBox.replaceChildren(st.freq && h('div', {},
      h('label', {}, '間隔'), h('div', { class: 'every-row' }, every, h('span', {}, FREQ[st.freq] + 'ごと')),
      h('label', {}, '終了日 (任意)'), endDate,
      isRec && !isNew && h('label', { class: 'switch-row' },
        h('span', {}, h('b', {}, '有効にする'), h('small', {}, 'オフにすると一時停止します (記録も予定も作りません)')),
        h('input', { type: 'checkbox', class: 'switch', role: 'switch', checked: st.active, onchange: (e) => { st.active = e.target.checked; } }))));
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
      // 既存の記録に繰り返しを付ける: この記録を1回目にして、次回以降を作る。それ以外は繰り返し設定そのものを保存
      const op = !isRec && !isNew
        ? D.saveTxAsRecurring(S.bookId, src.id, { ...body, date: date.value }, body)
        : D.saveRecurring(S.bookId, isRec && !isNew ? src.id : null, body, isRec && !isNew ? src : null);
      fire(op.then(() => D.materialize(S.bookId, S.recs)), !isRec && !isNew ? '繰り返しを登録しました' : '保存しました');
    } else {
      body.date = date.value;
      S.selDay = date.value;
      fire(D.saveTx(S.bookId, isNew ? null : src.id, body), null);
      const m = date.value.slice(0, 7);
      const onMonth = (route().parts[0] || 'month') === 'month';
      if (!onMonth || m !== S.month) go(`#/month/${m}`); // 追加した月へ移動して確認できるようにする
    }
    close();
  }
  /** いま入力されている内容をベースに、新しい入力画面を開く (日付は今日 / 繰り返しは開始日を今日に) */
  function copyIt() {
    const base = { type: st.type, amount: Number(amount.value) || src.amount, categoryId: st.categoryId, memo: memo.value.trim() };
    close();
    if (isRec) openSheet({ rec: { ...base, freq: st.freq, every: Number(every.value) || 1, startDate: todayStr(), endDate: null, active: true }, copied: true });
    else openSheet({ tx: { ...base, date: todayStr() }, copied: true });
  }
  function del() {
    if (!confirm('削除しますか？')) return;
    fire(isRec ? D.deleteRecurring(S.bookId, src.id) : D.deleteTx(S.bookId, src.id), '削除しました');
    close();
  }

  drawSeg(); drawCats(); drawRepeat();
  bg.append(h('div', { class: 'sheet form' },
    h('h2', {}, copied ? (isRec ? '繰り返しをコピーして追加' : '記録をコピーして追加') : isRec ? (isNew ? '繰り返しを追加' : '繰り返しを編集') : isNew ? '記録を追加' : '記録を編集'),
    h('div', { style: 'margin-top:10px' }, seg),
    h('label', {}, '金額'), h('div', { class: 'amount-wrap' }, amount),
    h('label', {}, isRec ? '開始日' : '日付'), date,
    h('label', {}, 'カテゴリ'), catBox,
    h('label', {}, 'メモ'), memo,
    fromRec
      ? h('div', { class: 'from-rec' }, icon('repeat', 14), h('span', {}, 'この記録は、繰り返しから作られています。'),
        h('button', { type: 'button', onclick: () => { close(); openSheet({ rec: fromRec }); } }, '繰り返し設定を開く'))
      : [h('label', {}, isRec ? '頻度' : '繰り返し'), freqSel,
        !isRec && !isNew && h('p', { class: 'muted hint' }, 'この記録を1回目として、次回以降を自動で記録します (日付が過去なら、今日までの分も記録されます)。')],
    repeatBox, err,
    h('button', { class: 'btn', onclick: save }, '保存'),
    !isNew && h('button', { class: 'btn ghost', onclick: copyIt }, icon('copy', 18), 'コピーして新規入力'),
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
        catChip(c), h('div', { class: 'mid' }, h('div', { class: 't' }, c.name)), chev()))),
    archived.length > 0 && h('div', { class: 'sectitle' }, `非表示 (${archived.length})`),
    archived.length > 0 && h('div', { class: 'card' }, archived.map((c) =>
      h('button', { class: 'row', onclick: () => openCategory(c) }, catChip(c), h('div', { class: 'mid muted' }, c.name)))),
    h('div', { class: 'pad' }, h('button', { class: 'btn', onclick: () => openCategory(null) }, 'カテゴリを追加'),
      h('p', { class: 'muted' }, 'カテゴリは数に制限なく追加でき、親子関係 (サブカテゴリ) も作れます。')));
  shell('カテゴリ編集', body, {
    fab: false, left: h('button', { class: 'icon-btn', onclick: () => go('#/settings'), 'aria-label': '戻る' }, icon('chevron-left', 22)),
  });
}

const COLORS = ['#e5484d', '#e8890c', '#d4a017', '#3aa76d', '#0ea5a0', '#2d9cdb', '#3b6cf6', '#8b5cf6', '#d6409f', '#f2603a', '#92704f', '#8a8b91'];

function openCategory(cat) {
  const isNew = !cat;
  const type = cat?.type || catTab;
  const st = { icon: cat?.icon || 'tag', color: cat?.color || COLORS[Math.floor(Math.random() * COLORS.length)], parent: cat?.parentId ?? '' };
  const name = h('input', { type: 'text', maxlength: 40, value: cat?.name || '', placeholder: 'カテゴリ名' });
  const err = h('div', { class: 'err' });
  const banned = new Set(); // 自分と子孫は親に選べない
  if (cat) { const stack = [cat.id]; while (stack.length) { const id = stack.pop(); banned.add(id); (S.kids.get(id) || []).forEach((k) => stack.push(k.id)); } }
  const parentSel = h('select', { onchange: (e) => { st.parent = e.target.value; } },
    h('option', { value: '' }, '(なし: 大カテゴリ)'),
    flatCats(type, st.parent || null).filter(({ c }) => !banned.has(c.id))
      .map(({ c, depth }) => h('option', { value: c.id, selected: c.id === st.parent }, '　'.repeat(depth) + c.name)));
  const iconBox = h('div', { class: 'icons' });
  const swatches = h('div', { class: 'swatches' });
  const drawPickers = () => {
    const keys = CATEGORY_ICONS.includes(st.icon) ? CATEGORY_ICONS : [st.icon, ...CATEGORY_ICONS]; // 旧データの絵文字も選択状態で残す
    iconBox.replaceChildren(...keys.map((k) => h('button', { type: 'button', 'aria-label': k, class: st.icon === k ? 'on' : '',
      style: `color:${st.color}`, onclick: () => { st.icon = k; drawPickers(); } }, icon(k, 22))));
    swatches.replaceChildren(...COLORS.map((c) => h('button', { type: 'button', 'aria-label': c, class: st.color === c ? 'on' : '',
      style: `background:${c}`, onclick: () => { st.color = c; drawPickers(); } })));
  };
  drawPickers();

  const bg = h('div', { class: 'sheet-bg', onclick: (e) => e.target === bg && close() });
  const close = () => bg.remove();
  function save(extra = {}) {
    if (!name.value.trim()) return (err.textContent = 'カテゴリ名を入力してください');
    const sibs = [...S.cats.values()].filter((c) => c.type === type);
    const body = {
      type, name: name.value.trim(), icon: st.icon || 'tag', color: st.color, parentId: st.parent || null,
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
    h('label', {}, 'アイコン'), iconBox,
    h('label', {}, '色'), swatches, err,
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
        } }, icon('share', 15), '共有する')));
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
    h('div', { class: 'card' }, h('div', { class: 'row', style: 'cursor:default' },
      h('div', { class: 'mid' }, h('div', { class: 't' }, S.me.name), h('div', { class: 's' }, S.me.email)),
      h('button', { class: 'btn sm ghost', onclick: openName }, icon('pencil', 15), '名前を変更'))),
    h('div', { class: 'sectitle' }, '家計簿'),
    h('div', { class: 'card' }, S.books.map((b) => h('button', { class: 'row', onclick: () => b.id !== S.bookId && switchTo(b.id) },
      h('div', { class: 'mid' }, b.name), b.id === S.bookId ? h('span', { class: 'chip' }, '表示中') : h('span', { class: 'muted' }, '切替')))),
    h('div', { class: 'pad' }, h('button', { class: 'btn ghost sm', onclick: async () => {
      const n = prompt('新しい家計簿の名前')?.trim(); if (!n) return;
      try { const id = await D.createBook(n); S.books = await D.listBooks(); openBook(id, todayStr().slice(0, 7)); go('#/month'); } catch (e) { toast(D.friendly(e)); }
    } }, icon('plus', 15), '家計簿を作成')),
    h('div', { class: 'sectitle' }, `共有メンバー — ${book?.name || ''}`),
    h('div', { class: 'card' }, [...S.members.values()].map((m) => h('div', { class: 'row' },
      h('div', { class: 'mid' }, m.name + (m.id === S.me.id ? ' (自分)' : '')), h('span', { class: 'chip' }, m.role === 'owner' ? 'オーナー' : 'メンバー'),
      m.role !== 'owner' && (isOwner || m.id === S.me.id) && h('button', { class: 'btn sm danger', onclick: () => removeMember(m) }, m.id === S.me.id ? '退出' : '削除')))),
    h('div', { class: 'card' }, h('div', { class: 'pad' }, h('button', { class: 'btn sm', onclick: invite }, icon('users', 15), '家族・パートナーを招待')), inviteBox),
    h('div', { class: 'sectitle' }, '招待コードで参加'),
    h('div', { class: 'card form' }, h('div', { class: 'pad' }, joinIn, h('button', { class: 'btn sm', style: 'margin-top:10px', onclick: () => {
      const c = joinIn.value.trim(); if (c) joinWith(c.replace(/^.*\/join\//, ''));
    } }, '参加する'))),
    h('div', { class: 'sectitle' }, '管理'),
    h('div', { class: 'card' },
      h('button', { class: 'row plain', onclick: openBudget }, h('div', { class: 'ic' }, icon('target', 20)), h('div', { class: 'mid' }, '月の予算'), h('span', { class: 'muted num' }, S.budget ? yen(S.budget) : '未設定'), chev()),
      h('button', { class: 'row plain', onclick: () => go('#/recurring') }, h('div', { class: 'ic' }, icon('repeat', 20)), h('div', { class: 'mid' }, '繰り返しの管理'), h('span', { class: 'muted num' }, S.recs.length ? `${S.recs.length}件` : ''), chev()),
      h('button', { class: 'row plain', onclick: () => go('#/categories') }, h('div', { class: 'ic' }, icon('tag', 20)), h('div', { class: 'mid' }, 'カテゴリ編集'), chev()),
      isOwner && h('button', { class: 'row plain', onclick: async () => {
        const n = prompt('家計簿の名前', book?.name)?.trim(); if (!n) return;
        try { await D.renameBook(S.bookId, n); await reloadBooks(); } catch (e) { toast(D.friendly(e)); }
      } }, h('div', { class: 'ic' }, icon('pencil', 20)), h('div', { class: 'mid' }, '家計簿名を変更'), chev())),
    h('div', { class: 'pad' }, h('button', { class: 'btn danger', onclick: logout }, icon('logout', 18), 'ログアウト')),
    h('div', { class: 'sectitle' }, 'アプリ'),
    h('div', { class: 'card' }, h('div', { class: 'row', style: 'cursor:default' },
      h('div', { class: 'mid' }, h('div', { class: 't' }, 'バージョン'), h('div', { class: 's num', 'data-build': BUILD }, BUILD)),
      h('button', { class: 'btn sm ghost', onclick: refreshApp }, icon('repeat', 15), '最新版に更新'))));
  shell('設定', body, { fab: false });
}

function openName() {
  const input = h('input', { type: 'text', maxlength: 40, value: S.me.name, autocomplete: 'nickname' });
  const err = h('div', { class: 'err' });
  const bg = h('div', { class: 'sheet-bg', onclick: (e) => e.target === bg && close() });
  const close = () => bg.remove();
  const btn = h('button', { class: 'btn', onclick: save }, '保存');
  async function save() {
    const n = input.value.trim();
    if (!n) return (err.textContent = '名前を入力してください');
    if (n.length > 40) return (err.textContent = '名前は40文字以内にしてください');
    if (n === S.me.name) return close();
    btn.disabled = true;
    try {
      await D.updateName(n, S.books.map((b) => b.id));
      S.me = { ...S.me, name: n };
      close();
      changed();
      toast('名前を変更しました');
    } catch (e) { err.textContent = D.friendly(e); btn.disabled = false; }
  }
  bg.append(h('div', { class: 'sheet form' },
    h('h2', {}, '名前を変更'), h('p', { class: 'muted', style: 'margin:0' }, '共有しているメンバーにも、この名前で表示されます。'),
    h('label', {}, 'ニックネーム'), input, err, btn,
    h('button', { class: 'btn ghost', onclick: close }, 'キャンセル')));
  document.body.append(bg);
  setTimeout(() => { input.focus(); input.select(); }, 50);
}

/** 保存済みのアプリの部品を消して、最新版を取得し直す (ログインやデータは消えない) */
async function refreshApp() {
  try {
    const regs = (await navigator.serviceWorker?.getRegistrations?.()) || [];
    await Promise.all(regs.map((r) => r.unregister()));
    await Promise.all((await caches.keys()).map((k) => caches.delete(k)));
  } catch {}
  location.reload();
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
    mark(), h('h1', {}, 'マネーダイアリー'), h('p', {}, '家族と共有できる家計簿'),
    h('form', { class: 'card pad form', onsubmit: submit },
      h('div', { class: 'seg' }, [['login', 'ログイン'], ['register', '新規登録']].map(([m, l]) =>
        h('button', { type: 'button', class: mode === m ? 'on' : '', onclick: () => renderAuth(m) }, l))),
      mode === 'register' && h('label', {}, 'ニックネーム'), mode === 'register' && name,
      h('label', {}, 'メールアドレス'), email, h('label', {}, 'パスワード'), pw, err, btn)));
}

// ---------- boot ----------
async function boot() {
  // ホーム画面から開いたアプリは再読み込みされず再開されるため、戻ってきたときに日付の変化と繰り返し分を反映する
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    navigator.serviceWorker?.getRegistration().then((r) => r?.update()).catch(() => {}); // 新しい版が公開されていれば取り込む
    runMaterialize();
    if (S.me) changed();
  });
  window.addEventListener('pageshow', () => runMaterialize());
  window.addEventListener('online', () => runMaterialize());
  // アプリとして使うので拡大・縮小を無効にする (iOS Safari は viewport の user-scalable=no を無視するため、ジェスチャも止める)
  for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, (e) => e.preventDefault());
  document.addEventListener('touchmove', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
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
