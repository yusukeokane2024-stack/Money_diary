import { test } from 'node:test';
import assert from 'node:assert/strict';
import { occurrence, dueOccurrences, firstFutureN, today } from '../src/lib/recurring.js';
import { searchTx } from '../src/lib/search.js';

test('月末の繰り返しは月ごとに丸められる', () => {
  const r = { startDate: '2024-01-31', freq: 'monthly', every: 1 };
  assert.equal(occurrence(r, 1), '2024-02-29');
  assert.equal(occurrence(r, 2), '2024-03-31');
  assert.equal(occurrence(r, 13), '2025-02-28');
});
test('週・年・間隔', () => {
  assert.equal(occurrence({ startDate: '2024-12-30', freq: 'weekly', every: 2 }, 1), '2025-01-13');
  assert.equal(occurrence({ startDate: '2024-02-29', freq: 'yearly', every: 1 }, 1), '2025-02-28');
  assert.equal(occurrence({ startDate: '2024-01-01', freq: 'monthly', every: 3 }, 4), '2025-01-01');
});
test('今日までの未生成分だけ返り、終了日で止まる', () => {
  const r = { startDate: '2024-01-31', freq: 'monthly', every: 1, nextN: 0, endDate: '2024-04-30' };
  const { due, nextN } = dueOccurrences(r, '2024-12-31');
  assert.deepEqual(due.map((d) => d.date), ['2024-01-31', '2024-02-29', '2024-03-31', '2024-04-30']);
  assert.equal(nextN, 4);
  assert.equal(dueOccurrences({ ...r, nextN }, '2024-12-31').due.length, 0);
});
test('上限で打ち切り、続きから再開できる', () => {
  const r = { startDate: '2020-01-01', freq: 'daily', every: 1, nextN: 0 };
  const a = dueOccurrences(r, '2021-12-31', 400);
  assert.equal(a.due.length, 400);
  const b = dueOccurrences({ ...r, nextN: a.nextN }, '2021-12-31', 400);
  assert.equal(b.due[0].date, '2021-02-04');
});
test('firstFutureN は過去分をスキップ', () => {
  const r = { startDate: '2024-01-15', freq: 'monthly', every: 1 };
  assert.equal(occurrence(r, firstFutureN(r, '2024-03-20')), '2024-04-15');
  assert.equal(firstFutureN(r, '2023-01-01'), 0);
});
test('today は JST', () => {
  assert.equal(today(Date.parse('2024-05-31T15:30:00Z')), '2024-06-01');
});

const cats = new Map([
  [1, { id: 1, name: '食費', parentId: null }],
  [2, { id: 2, name: '外食', parentId: 1 }],
  [3, { id: 3, name: '給与', parentId: null }],
]);
const txs = [
  { id: 'a', type: 'expense', amount: 1200, categoryId: 2, date: '2024-05-03', memo: 'ランチ 寿司' },
  { id: 'b', type: 'income', amount: 300000, categoryId: 3, date: '2024-03-25', memo: '' },
  { id: 'c', type: 'expense', amount: 800, categoryId: 1, date: '2024-05-03', memo: 'パン' },
];
test('検索: メモ/カテゴリ(親含む)/金額/複数語/期間', () => {
  const ids = (f) => searchTx(txs, cats, f).map((t) => t.id);
  assert.deepEqual(ids({ q: '寿司' }), ['a']);
  assert.deepEqual(ids({ q: '食費' }), ['c', 'a']); // 親カテゴリ名でも子の取引がヒット
  assert.deepEqual(ids({ q: '300,000' }), ['b']);
  assert.deepEqual(ids({ q: 'ランチ 外食' }), ['a']);
  assert.deepEqual(ids({ category: 1 }), ['c', 'a']);
  assert.deepEqual(ids({ type: 'income' }), ['b']);
  assert.deepEqual(ids({ from: '2024-04-01', min: '1000' }), ['a']);
  assert.deepEqual(ids({ q: '%' }), []);
});

import { monthGrid, compactYen, amountSize, dayTotals } from '../src/lib/calendar.js';
test('カレンダー: 週の並び (日曜始まり)', () => {
  const w = monthGrid('2026-02'); // 2026-02-01 は日曜 / 28日まで
  assert.equal(w.length, 4);
  assert.equal(w[0][0], '2026-02-01');
  assert.equal(w[3][6], '2026-02-28');
  const o = monthGrid('2026-10'); // 2026-10-01 は木曜
  assert.deepEqual(o[0].map((x) => x && x.slice(8)), [null, null, null, null, '01', '02', '03']);
  assert.equal(o.at(-1).filter(Boolean).at(-1), '2026-10-31');
  assert.ok(monthGrid('2024-02').flat().includes('2024-02-29')); // 閏年
  for (const wk of o) assert.equal(wk.length, 7);
});
test('カレンダー: 金額の短縮と日別合計', () => {
  assert.equal(compactYen(1280), '1,280');
  assert.equal(compactYen(99999), '99,999');
  assert.equal(compactYen(120000), '120,000');      // 「12万」のように省略せず、数字で表示する
  assert.equal(compactYen(1234567), '1,234,567');
  assert.equal(compactYen(999999999), '999,999,999');
  assert.equal(amountSize(1280), '');
  assert.equal(amountSize(123456), '');              // 7文字: そのまま
  assert.equal(amountSize(1234567), 'sm');           // 9文字: 少し小さく
  assert.equal(amountSize(123456789), 'xs');         // 11文字: さらに小さく
  const m = dayTotals([{ date: '2026-10-01', type: 'expense', amount: 100 }, { date: '2026-10-01', type: 'income', amount: 500 }, { date: '2026-10-01', type: 'expense', amount: 50 }]);
  assert.deepEqual(m.get('2026-10-01'), { income: 500, expense: 150, count: 3 });
});

import { categoryBreakdown, monthlyTrend, memberTotals, budgetStatus } from '../src/lib/charts.js';
const ccats = new Map([
  [1, { id: 1, name: '食費', color: '#e8890c', icon: 'utensils', parentId: null }],
  [2, { id: 2, name: '外食', color: '#aaaaaa', icon: 'coffee', parentId: 1 }],
  [3, { id: 3, name: '交通費', color: '#2d9cdb', icon: 'bus', parentId: null }],
]);
const ctx = [
  { type: 'expense', amount: 3000, categoryId: 2, date: '2026-10-03', userId: 'a' },
  { type: 'expense', amount: 1000, categoryId: 1, date: '2026-10-04', userId: 'b' },
  { type: 'expense', amount: 1000, categoryId: 3, date: '2026-10-05', userId: 'a' },
  { type: 'expense', amount: 500, categoryId: null, date: '2026-09-05', userId: 'a' },
  { type: 'income', amount: 200000, categoryId: null, date: '2026-10-25', userId: 'a' },
];
test('グラフ: カテゴリ別は大カテゴリにまとめて内訳を持つ', () => {
  const r = categoryBreakdown(ctx, ccats, 'expense');
  assert.equal(r.total, 5500);
  assert.deepEqual(r.items.map((i) => [i.name, i.total]), [['食費', 4000], ['交通費', 1000], ['未分類', 500]]);
  assert.deepEqual(r.items[0].children.map((c) => [c.name, c.total]), [['外食', 3000], ['食費', 1000]]);
  assert.ok(Math.abs(r.items.reduce((s, i) => s + i.share, 0) - 1) < 1e-9);
  assert.equal(categoryBreakdown([], ccats, 'expense').items.length, 0);
});
test('グラフ: 月別推移は年をまたいで直近6か月', () => {
  const t = monthlyTrend(ctx, '2026-10', 6);
  assert.deepEqual(t.map((m) => m.month), ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
  assert.equal(t[4].expense, 500);
  assert.deepEqual([t[5].expense, t[5].income], [5000, 200000]);
  assert.equal(monthlyTrend([], '2026-02', 3)[0].month, '2025-12');
});
test('グラフ: メンバー別と予算ゲージ', () => {
  const m = memberTotals(ctx, 'expense');
  assert.deepEqual(m.items.map((x) => [x.id, x.total]), [['a', 4500], ['b', 1000]]);
  assert.equal(budgetStatus(0, 100), null);
  assert.deepEqual(budgetStatus(10000, 4000), { remaining: 6000, ratio: 0.4, over: false });
  assert.equal(budgetStatus(10000, 12000).over, true);
});

import { upcomingInMonth } from '../src/lib/recurring.js';
test('予定: 未展開の分だけが、指定した月に出る', () => {
  const r = { startDate: '2026-10-25', freq: 'monthly', every: 1, nextN: 1, active: true, endDate: null }; // 10/25 は展開済み (nextN=1)
  assert.deepEqual(upcomingInMonth(r, '2026-10').map((x) => x.date), []);            // 今月分は記録済みなので予定に出ない
  assert.deepEqual(upcomingInMonth(r, '2026-11').map((x) => x.date), ['2026-11-25']);
  assert.deepEqual(upcomingInMonth(r, '2027-03').map((x) => x.date), ['2027-03-25']); // 数か月先も出る
  assert.deepEqual(upcomingInMonth({ ...r, endDate: '2026-12-31' }, '2027-02').map((x) => x.date), []); // 終了日を過ぎたら出ない
  assert.deepEqual(upcomingInMonth({ ...r, active: false }, '2026-11'), []);          // 停止中は出ない
  const eom = { startDate: '2026-01-31', freq: 'monthly', every: 1, nextN: 0, active: true };
  assert.deepEqual(upcomingInMonth(eom, '2026-02').map((x) => x.date), ['2026-02-28']); // 月末の丸め
  const daily = { startDate: '2026-10-01', freq: 'daily', every: 1, nextN: 5, active: true };
  assert.equal(upcomingInMonth(daily, '2026-10').length, 26); // 10/6〜10/31
});
