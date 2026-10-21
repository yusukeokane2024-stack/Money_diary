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
