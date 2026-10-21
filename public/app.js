// マネーダイアリー フロントエンド (ビルド不要・依存なし)
const $app = document.getElementById('app');
const LS = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

// ---------- utils ----------
const yen = (n) => '¥' + Number(n).toLocaleString('ja-JP');
const jstNow = () => new Date(Date.now() + 9 * 3600 * 1000);
const todayStr = () => jstNow().toISOString().slice(0, 10);
const shiftMonth = (m, d) => {
  const [y, mo] = m.split('-').map(Number);
  const t = y * 12 + (mo - 1) + d;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
};
const monthLabel = (m) => `${m.slice(0, 4)}年${+m.slice(5)}月`;
const WD = ['日', '月', '火', '水', '木', '金', '土'];
const dayLabel = (d) => `${+d.slice(5, 7)}月${+d.slice(8)}日 (${WD[new Date(d + 'T00:00:00Z').getUTCDay()]})`;
const FREQ = { daily: '日', weekly: '週', monthly: 'ヶ月', yearly: '年' };
const freqLabel = (r) => (r.every === 1 ? { daily: '毎日', weekly: '毎週', monthly: '毎月', yearly: '毎年' }[r.freq] : `${r.every}${FREQ[r.freq]}ごと`);

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
  setTimeout(() => t.remove(), 2200);
}

class ApiError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
async function api(method, path, body) {
  const res = await fetch('/api' + path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && path !== '/login' && path !== '/register') { S.me = null; renderAuth(); }
    throw new ApiError(res.status, data.error || 'エラーが発生しました');
  }
  return data;
}

// ---------- state ----------
const S = { me: null, books: [], bookId: null, month: todayStr().slice(0, 7), data: null, hl: null };
const bookPath = (p = '') => `/books/${S.bookId}${p}`;

function setData(d) {
  S.data = d;
  S.cats = new Map(d.categories.map((c) => [c.id, c]));
  S.kids = new Map();
  for (const c of d.categories) {
    const k = c.parent_id ?? 0;
    if (!S.kids.has(k)) S.kids.set(k, []);
    S.kids.get(k).push(c);
  }
  S.members = new Map(d.members.map((m) => [m.id, m]));
}
function saveBoot() {
  LS.set('md:last', { bookId: S.bookId, month: S.month });
  LS.set('md:boot', { bookId: S.bookId, month: S.month, data: S.data, me: S.me, books: S.books });
}

const rootOf = (id) => { let c = S.cats.get(id); while (c && c.parent_id != null && S.cats.has(c.parent_id)) c = S.cats.get(c.parent_id); return c; };
const catName = (id) => {
  const c = S.cats.get(id);
  if (!c) return '未分類';
  const p = c.parent_id != null ? S.cats.get(c.parent_id) : null;
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

async function loadMonth(month, { hl = null } = {}) {
  S.month = month;
  S.hl = hl;
  const d = await api('GET', bookPath(`/bootstrap?month=${month}`));
  setData(d);
  saveBoot();
  render();
}
async function refresh() { await loadMonth(S.month); }

async function loadMe() {
  const { user, books } = await api('GET', '/me');
  S.me = user;
  S.books = books;
  return books;
}

// ---------- routing ----------
function route() {
  const [path, qs] = (location.hash.slice(1) || '/month').split('?');
  return { parts: path.split('/').filter(Boolean), q: new URLSearchParams(qs || '') };
}
const go = (hash) => { if (location.hash === hash) render(); else location.hash = hash; };

async function onHash() {
  if (!S.me) return;
  const { parts, q } = route();
  if (parts[0] === 'join') { await joinWith(parts[1]); return; }
  if (parts[0] === 'month' || !parts[0]) {
    const m = parts[1] || S.month;
    const hl = q.get('hl') ? +q.get('hl') : null;
    if (m !== S.data?.month || hl) await loadMonth(m, { hl });
    else render();
    return;
  }
  render();
}
window.addEventListener('hashchange', onHash);

async function joinWith(code) {
  history.replaceState(null, '', '#/month');
  try {
    const { bookId } = await api('POST', '/join', { code });
    await loadMe();
    await switchBook(bookId);
    toast('家計簿に参加しました');
  } catch (e) { toast(e.message); render(); }
}
async function switchBook(id) {
  S.bookId = id;
  S.month = todayStr().slice(0, 7);
  await loadMonth(S.month);
  go('#/month');
}

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
  $app.replaceChildren(...nodes);
  window.scrollTo(0, 0);
}

function render() {
  if (!S.me) return renderAuth();
  if (!S.data) return $app.replaceChildren(h('div', { class: 'splash' }, h('div', { class: 'splash-logo' }, '💰')));
  const { parts } = route();
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
  const c = S.cats.get(t.category_id);
  const who = S.members.size > 1 ? S.members.get(t.user_id)?.name : null;
  return h('button', { class: 'row', 'data-id': t.id, onclick: onclick || (() => openSheet({ tx: t })) },
    h('div', { class: 'ic', style: `--c:${c?.color || '#8e8e93'}` }, c?.icon || '🏷️'),
    h('div', { class: 'mid' },
      h('div', { class: 't' }, t.memo || catName(t.category_id)),
      h('div', { class: 's' }, [showDate ? t.date.replaceAll('-', '/') : null, t.memo ? catName(t.category_id) : null, who, t.recurring_id ? '🔁' : null].filter(Boolean).join(' · '))),
    h('div', { class: 'amt ' + (t.type === 'expense' ? 'exp' : 'inc') }, (t.type === 'expense' ? '-' : '+') + yen(t.amount)));
}

// ---------- month view ----------
function renderMonth() {
  const txs = S.data.transactions;
  let inc = 0, exp = 0;
  const byCat = new Map();
  for (const t of txs) {
    if (t.type === 'income') inc += t.amount;
    else {
      exp += t.amount;
      const r = rootOf(t.category_id);
      const k = r?.id ?? 0;
      byCat.set(k, (byCat.get(k) || 0) + t.amount);
    }
  }
  const parts = [...byCat].sort((a, b) => b[1] - a[1]);
  const body = h('div', {},
    h('div', { class: 'card' },
      h('div', { class: 'summary' },
        h('div', {}, h('small', {}, '収入'), h('b', { class: 'inc' }, yen(inc))),
        h('div', {}, h('small', {}, '支出'), h('b', { class: 'exp' }, yen(exp))),
        h('div', {}, h('small', {}, '収支'), h('b', {}, (inc - exp < 0 ? '-' : '') + yen(Math.abs(inc - exp))))),
      exp > 0 && h('div', { class: 'bar' }, parts.map(([id, v]) => h('i', { style: `width:${(v / exp) * 100}%;background:${S.cats.get(id)?.color || '#8e8e93'}` }))),
      exp > 0 && h('div', { class: 'legend' }, parts.slice(0, 6).map(([id, v]) =>
        h('span', { style: `--c:${S.cats.get(id)?.color || '#8e8e93'}` }, `${S.cats.get(id)?.name || '未分類'} ${Math.round((v / exp) * 100)}%`)))),
    txs.length ? dayGroups(txs) : h('div', { class: 'empty' }, 'この月の記録はありません', h('br'), '右下の ＋ から追加できます'));

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

  if (S.hl) { // 検索からのジャンプ: 該当行へスクロールして強調
    const row = $app.querySelector(`[data-id="${S.hl}"]`);
    if (row) { row.scrollIntoView({ block: 'center' }); row.classList.add('flash'); }
    S.hl = null;
    history.replaceState(null, '', `#/month/${S.month}`);
  }
}

function dayGroups(txs) {
  const frag = h('div', { class: 'card' });
  let cur = null;
  for (const t of txs) {
    if (t.date !== cur) {
      cur = t.date;
      const net = txs.filter((x) => x.date === cur).reduce((s, x) => s + (x.type === 'income' ? x.amount : -x.amount), 0);
      frag.append(h('div', { class: 'day' }, h('span', {}, dayLabel(cur)), h('span', {}, (net < 0 ? '-' : '') + yen(Math.abs(net)))));
    }
    frag.append(txRow(t));
  }
  return frag;
}

// ---------- search ----------
let searchState = { q: '', type: '', category: '', min: '', max: '', from: '', to: '' };
function renderSearch() {
  const results = h('div', {});
  const info = h('div', { class: 'muted', style: 'padding:4px 16px' });
  let timer, seq = 0, offset = 0;

  async function run(more = false) {
    const my = ++seq;
    if (!more) offset = 0;
    const p = new URLSearchParams({ limit: 50, offset });
    for (const [k, v] of Object.entries(searchState)) if (v) p.set(k, v);
    let r;
    try { r = await api('GET', bookPath(`/search?${p}`)); } catch (e) { info.textContent = e.message; return; }
    if (my !== seq) return;
    if (!more) results.replaceChildren();
    info.textContent = r.total ? `${r.total}件 ・ 支出 ${yen(r.expense)} ・ 収入 ${yen(r.income)}` : '該当する記録はありません';
    const card = results.querySelector('.card') || results.appendChild(h('div', { class: 'card' }));
    card.querySelector('.more')?.remove();
    for (const t of r.results) {
      card.append(txRow(t, {
        showDate: true,
        onclick: () => go(`#/month/${t.date.slice(0, 7)}?hl=${t.id}`), // タップで該当月へジャンプ
      }));
    }
    offset += r.results.length;
    if (offset < r.total) card.append(h('button', { class: 'row more', onclick: () => run(true) }, 'もっと見る'));
  }
  const input = (key, attrs = {}) => h('input', { ...attrs, value: searchState[key], oninput: (e) => { searchState[key] = e.target.value; clearTimeout(timer); timer = setTimeout(run, 250); } });
  const catSel = h('select', { onchange: (e) => { searchState.category = e.target.value; run(); } },
    h('option', { value: '' }, 'すべてのカテゴリ'),
    ['expense', 'income'].flatMap((type) => flatCats(type, null).map(({ c, depth }) =>
      h('option', { value: c.id, selected: String(c.id) === String(searchState.category) }, `${type === 'income' ? '【収入】' : ''}${'　'.repeat(depth)}${c.name}`))));
  const typeSel = h('select', { onchange: (e) => { searchState.type = e.target.value; run(); } },
    [['', '収入+支出'], ['expense', '支出のみ'], ['income', '収入のみ']].map(([v, l]) => h('option', { value: v, selected: v === searchState.type }, l)));

  const body = h('div', {},
    input('q', { class: 'search-in', type: 'search', placeholder: 'メモ・カテゴリ・金額で検索', autofocus: true }),
    h('div', { class: 'filters' }, typeSel, catSel,
      input('min', { type: 'number', inputmode: 'numeric', placeholder: '金額 下限' }), input('max', { type: 'number', inputmode: 'numeric', placeholder: '金額 上限' }),
      input('from', { type: 'date', 'aria-label': '開始日' }), input('to', { type: 'date', 'aria-label': '終了日' })),
    info, results);
  shell('検索', body, { fab: false });
  run();
}

// ---------- recurring ----------
function renderRecurring() {
  const list = S.data.recurrings;
  const body = h('div', {},
    list.length
      ? h('div', { class: 'card' }, list.map((r) => {
        const c = S.cats.get(r.category_id);
        return h('button', { class: 'row', onclick: () => openSheet({ rec: r }) },
          h('div', { class: 'ic', style: `--c:${c?.color || '#8e8e93'}` }, c?.icon || '🏷️'),
          h('div', { class: 'mid' }, h('div', { class: 't' }, r.memo || catName(r.category_id)),
            h('div', { class: 's' }, `${freqLabel(r)} ・ ${r.start_date.replaceAll('-', '/')}〜${r.end_date ? r.end_date.replaceAll('-', '/') : ''}${r.active ? '' : ' (停止中)'}`)),
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
  const st = {
    type: src.type || 'expense', category_id: src.category_id ?? null,
    freq: rec ? src.freq || 'monthly' : '', every: src.every || 1, active: src.active !== 0,
  };
  const amount = h('input', { class: 'amount-in', type: 'text', inputmode: 'numeric', placeholder: '0', value: src.amount ? String(src.amount) : '', autofocus: true,
    oninput: (e) => { e.target.value = e.target.value.replace(/[^\d]/g, ''); } });
  const date = h('input', { type: 'date', value: (isRec ? src.start_date : src.date) || todayStr() });
  const endDate = h('input', { type: 'date', value: src.end_date || '' });
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
      h('button', { class: `${st.type === v ? 'on' : ''} ${v}`, type: 'button', onclick: () => { if (st.type !== v) { st.type = v; st.category_id = null; drawSeg(); drawCats(); } } }, l)));
  }
  function drawCats() {
    const items = flatCats(st.type, st.category_id);
    catBox.replaceChildren(...items.map(({ c, depth }) =>
      h('button', { type: 'button', class: st.category_id === c.id ? 'on' : '', onclick: () => { st.category_id = c.id; drawCats(); } },
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
  async function save() {
    err.textContent = '';
    const body = {
      type: st.type, amount: Number(amount.value), category_id: st.category_id, memo: memo.value,
    };
    try {
      if (isRec || st.freq) {
        Object.assign(body, { freq: st.freq, every: Number(every.value) || 1, start_date: date.value, end_date: endDate.value || null, active: st.active });
        if (isRec && !isNew) await api('PUT', bookPath(`/recurrings/${src.id}`), body);
        else await api('POST', bookPath('/recurrings'), body);
      } else {
        body.date = date.value;
        if (isNew) await api('POST', bookPath('/transactions'), body);
        else await api('PUT', bookPath(`/transactions/${src.id}`), body);
      }
      close();
      // 追加した日付の月へ移動して確認できるようにする
      const m = date.value.slice(0, 7);
      await loadMonth(isRec ? S.month : m, {});
      if (!isRec && route().parts[0] !== 'month') go('#/month');
      toast('保存しました');
    } catch (e) { err.textContent = e.message; }
  }
  async function del() {
    if (!confirm('削除しますか？')) return;
    try {
      await api('DELETE', bookPath(isRec ? `/recurrings/${src.id}` : `/transactions/${src.id}`));
      close(); await refresh(); toast('削除しました');
    } catch (e) { err.textContent = e.message; }
  }

  drawSeg(); drawCats(); drawRepeat();
  bg.append(h('div', { class: 'sheet form' },
    h('h2', {}, (isNew ? '' : '') + (isRec ? (isNew ? '繰り返しを追加' : '繰り返しを編集') : isNew ? '記録を追加' : '記録を編集')),
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
  const items = flatCats(catTab, -1);
  const archived = S.data.categories.filter((c) => c.type === catTab && c.archived);
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
  const st = { icon: cat?.icon || '🏷️', color: cat?.color || COLORS[Math.floor(Math.random() * COLORS.length)], parent: cat?.parent_id ?? '' };
  const type = cat?.type || catTab;
  const name = h('input', { type: 'text', maxlength: 40, value: cat?.name || '', placeholder: 'カテゴリ名', autofocus: true });
  const iconIn = h('input', { type: 'text', maxlength: 8, value: st.icon, oninput: (e) => { st.icon = e.target.value; } });
  const err = h('div', { class: 'err' });
  // 自分と子孫は親に選べない
  const banned = new Set();
  if (cat) { const stack = [cat.id]; while (stack.length) { const id = stack.pop(); banned.add(id); (S.kids.get(id) || []).forEach((k) => stack.push(k.id)); } }
  const parentSel = h('select', { onchange: (e) => { st.parent = e.target.value; } },
    h('option', { value: '' }, '(なし: 大カテゴリ)'),
    flatCats(type, st.parent === '' ? null : st.parent).filter(({ c }) => !banned.has(c.id))
      .map(({ c, depth }) => h('option', { value: c.id, selected: c.id === st.parent }, '　'.repeat(depth) + c.icon + ' ' + c.name)));
  const emojiRow = h('div', { style: 'display:flex;flex-wrap:wrap;gap:4px;margin-top:6px' },
    EMOJIS.map((e) => h('button', { type: 'button', style: 'font-size:22px;padding:2px 4px', onclick: () => { st.icon = e; iconIn.value = e; } }, e)));
  const colorIn = h('input', { type: 'color', value: st.color, style: 'height:40px;padding:2px', oninput: (e) => { st.color = e.target.value; } });
  const swatches = h('div', { style: 'display:flex;gap:6px;margin-top:6px;flex-wrap:wrap' },
    COLORS.map((c) => h('button', { type: 'button', 'aria-label': c, style: `width:26px;height:26px;border-radius:50%;background:${c}`, onclick: () => { st.color = c; colorIn.value = c; } })));

  const bg = h('div', { class: 'sheet-bg', onclick: (e) => e.target === bg && close() });
  const close = () => bg.remove();
  async function save(extra = {}) {
    const body = { type, name: name.value, icon: st.icon || '🏷️', color: st.color, parent_id: st.parent === '' ? null : Number(st.parent), archived: cat?.archived ? 1 : 0, ...extra };
    try {
      if (isNew) await api('POST', bookPath('/categories'), body);
      else await api('PUT', bookPath(`/categories/${cat.id}`), body);
      close(); await refresh();
    } catch (e) { err.textContent = e.message; }
  }
  async function move(dir) {
    const sibs = (S.kids.get(cat.parent_id ?? 0) || []).filter((c) => c.type === type);
    const i = sibs.findIndex((c) => c.id === cat.id), j = i + dir;
    if (j < 0 || j >= sibs.length) return;
    [sibs[i], sibs[j]] = [sibs[j], sibs[i]];
    await api('PUT', bookPath('/categories-order'), { ids: sibs.map((c) => c.id) });
    close(); await refresh();
  }
  async function del() {
    if (!confirm('このカテゴリを削除しますか？\n(記録で使用中の場合は非表示になります)')) return;
    try { const r = await api('DELETE', bookPath(`/categories/${cat.id}`)); close(); await refresh(); toast(r.archived ? '使用中のため非表示にしました' : '削除しました'); }
    catch (e) { err.textContent = e.message; }
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
    !isNew && h('button', { class: 'btn ghost', onclick: () => save({ archived: cat.archived ? 0 : 1 }) }, cat.archived ? '表示に戻す' : '非表示にする'),
    !isNew && h('button', { class: 'btn danger', onclick: del }, '削除'),
    h('button', { class: 'btn ghost', onclick: close }, 'キャンセル')));
  document.body.append(bg);
}

// ---------- settings / sharing ----------
function renderSettings() {
  const book = S.books.find((b) => b.id === S.bookId);
  const isOwner = book?.role === 'owner';
  const inviteBox = h('div', {});
  const joinIn = h('input', { type: 'text', placeholder: '招待コードを入力' });

  async function invite() {
    try {
      const { code } = await api('POST', bookPath('/invite'));
      const link = `${location.origin}/#/join/${code}`;
      inviteBox.replaceChildren(h('div', { class: 'pad' },
        h('div', { class: 'muted' }, '招待コード (7日間有効)'), h('div', { class: 'code' }, code),
        h('div', { class: 'muted', style: 'word-break:break-all;margin:6px 0' }, link),
        h('button', { class: 'btn sm', onclick: async () => {
          try { if (navigator.share) await navigator.share({ title: 'マネーダイアリー', text: `家計簿に参加: ${link}` }); else { await navigator.clipboard.writeText(link); toast('リンクをコピーしました'); } } catch {}
        } }, '共有する')));
    } catch (e) { toast(e.message); }
  }
  async function removeMember(m) {
    if (!confirm(m.id === S.me.id ? 'この家計簿から退出しますか？' : `${m.name} さんを削除しますか？`)) return;
    try {
      await api('DELETE', bookPath(`/members/${m.id}`));
      if (m.id === S.me.id) { await loadMe(); await switchBook(S.books[0].id); } else await refresh();
    } catch (e) { toast(e.message); }
  }
  const body = h('div', {},
    h('div', { class: 'sectitle' }, 'アカウント'),
    h('div', { class: 'card' }, h('div', { class: 'pad' }, h('b', {}, S.me.name), h('div', { class: 'muted' }, S.me.email))),
    h('div', { class: 'sectitle' }, '家計簿'),
    h('div', { class: 'card' }, S.books.map((b) => h('button', { class: 'row', onclick: () => b.id !== S.bookId && switchBook(b.id) },
      h('div', { class: 'mid' }, b.name), b.id === S.bookId ? h('span', { class: 'chip' }, '表示中') : h('span', { class: 'muted' }, '切替')))),
    h('div', { class: 'pad' }, h('button', { class: 'btn ghost sm', onclick: async () => {
      const name = prompt('新しい家計簿の名前'); if (!name) return;
      try { const r = await api('POST', '/books', { name }); await loadMe(); await switchBook(r.id); } catch (e) { toast(e.message); }
    } }, '＋ 家計簿を作成')),
    h('div', { class: 'sectitle' }, `共有メンバー — ${S.data.book.name}`),
    h('div', { class: 'card' }, S.data.members.map((m) => h('div', { class: 'row' },
      h('div', { class: 'mid' }, m.name + (m.id === S.me.id ? ' (自分)' : '')), h('span', { class: 'chip' }, m.role === 'owner' ? 'オーナー' : 'メンバー'),
      m.role !== 'owner' && (isOwner || m.id === S.me.id) && h('button', { class: 'btn sm danger', onclick: () => removeMember(m) }, m.id === S.me.id ? '退出' : '削除')))),
    h('div', { class: 'card' }, h('div', { class: 'pad' }, h('button', { class: 'btn sm', onclick: invite }, '家族・パートナーを招待')), inviteBox),
    h('div', { class: 'sectitle' }, '招待コードで参加'),
    h('div', { class: 'card form' }, h('div', { class: 'pad' }, joinIn, h('button', { class: 'btn sm', style: 'margin-top:10px', onclick: async () => {
      if (joinIn.value.trim()) await joinWith(joinIn.value.trim());
    } }, '参加する'))),
    h('div', { class: 'sectitle' }, '管理'),
    h('div', { class: 'card' },
      h('button', { class: 'row', onclick: () => go('#/categories') }, h('div', { class: 'mid' }, '🏷️ カテゴリ編集'), h('span', { class: 'muted' }, '›')),
      isOwner && h('button', { class: 'row', onclick: async () => {
        const name = prompt('家計簿の名前', book.name); if (!name) return;
        try { await api('PUT', bookPath(), { name }); await loadMe(); await refresh(); } catch (e) { toast(e.message); }
      } }, h('div', { class: 'mid' }, '✏️ 家計簿名を変更'), h('span', { class: 'muted' }, '›'))),
    h('div', { class: 'pad' }, h('button', { class: 'btn danger', onclick: logout }, 'ログアウト')));
  shell('設定', body, { fab: false });
}

async function logout() {
  try { await api('POST', '/logout', {}); } catch {}
  LS.del('md:boot'); LS.del('md:last');
  Object.assign(S, { me: null, books: [], bookId: null, data: null });
  renderAuth();
}

// ---------- auth ----------
function renderAuth(mode = 'login') {
  const email = h('input', { type: 'email', autocomplete: 'email', placeholder: 'メールアドレス' });
  const name = h('input', { type: 'text', autocomplete: 'nickname', placeholder: 'ニックネーム', maxlength: 40 });
  const pw = h('input', { type: 'password', autocomplete: mode === 'login' ? 'current-password' : 'new-password', placeholder: 'パスワード (8文字以上)' });
  const err = h('div', { class: 'err' });
  async function submit(e) {
    e.preventDefault();
    err.textContent = '';
    try {
      await api('POST', mode === 'login' ? '/login' : '/register', { email: email.value, password: pw.value, name: name.value });
      await start();
    } catch (x) { err.textContent = x.message; }
  }
  $app.replaceChildren(h('div', { class: 'auth' },
    h('div', { style: 'font-size:56px' }, '💰'), h('h1', {}, 'マネーダイアリー'),
    h('form', { class: 'card pad form', onsubmit: submit },
      h('div', { class: 'seg' }, [['login', 'ログイン'], ['register', '新規登録']].map(([m, l]) =>
        h('button', { type: 'button', class: mode === m ? 'on' : '', onclick: () => renderAuth(m) }, l))),
      mode === 'register' && h('label', {}, 'ニックネーム'), mode === 'register' && name,
      h('label', {}, 'メールアドレス'), email, h('label', {}, 'パスワード'), pw, err,
      h('button', { class: 'btn', type: 'submit' }, mode === 'login' ? 'ログイン' : 'アカウントを作成'))));
}

// ---------- boot ----------
async function start() {
  const books = await loadMe();
  const last = LS.get('md:last');
  S.bookId = books.find((b) => b.id === last?.bookId)?.id ?? books[0]?.id;
  const pending = sessionStorage.getItem('md:join');
  if (pending) { sessionStorage.removeItem('md:join'); await joinWith(pending); return; }
  await loadMonth(last?.bookId === S.bookId && last.month ? last.month : S.month);
  await onHash();
}

async function boot() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  const m = /^#\/join\/(.+)$/.exec(location.hash);
  if (m) sessionStorage.setItem('md:join', decodeURIComponent(m[1]));

  // 1) 前回のデータがあれば、通信を待たず即座に描画 (体感起動時間ほぼゼロ)
  const cached = LS.get('md:boot');
  if (cached?.data && cached.me && !m) {
    Object.assign(S, { me: cached.me, books: cached.books, bookId: cached.bookId, month: cached.month });
    setData(cached.data);
    render();
  }
  // 2) インラインスクリプトで先行開始した通信結果で更新 (なければ通常フロー)
  const early = window.__boot && !m ? await window.__boot.p : null;
  if (early && cached?.me) {
    S.month = early.month;
    setData(early);
    saveBoot();
    await onHash();
    loadMe().then(() => { saveBoot(); }).catch(() => {});
    return;
  }
  try { await start(); }
  catch (e) {
    if (e.status === 401 || !cached?.data) { S.me = null; renderAuth(); }
    else toast('オフラインです。保存済みのデータを表示しています');
  }
}
boot();
