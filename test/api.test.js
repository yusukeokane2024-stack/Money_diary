import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
import { occurrence } from '../server/recurring.js';

let server, base;
before(async () => {
  server = createApp({ dbFile: ':memory:' });
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

function client() {
  let cookie = '';
  return async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie && { Cookie: cookie }) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => null) };
  };
}

test('月末の繰り返しは月ごとに丸められる', () => {
  const r = { start_date: '2024-01-31', freq: 'monthly', every: 1 };
  assert.equal(occurrence(r, 1), '2024-02-29');
  assert.equal(occurrence(r, 2), '2024-03-31');
  assert.equal(occurrence(r, 13), '2025-02-28');
});

test('登録・ログイン・共有・カテゴリ・検索・繰り返し', async () => {
  const a = client(), b = client(), c = client();
  let r = await a('POST', '/api/register', { email: 'a@example.com', name: 'A', password: 'password1' });
  assert.equal(r.status, 200);
  const bookId = r.data.bookId;

  assert.equal((await a('POST', '/api/register', { email: 'a@example.com', name: 'A', password: 'password1' })).status, 409);
  assert.equal((await a('POST', '/api/register', { email: 'x@example.com', name: 'X', password: 'short' })).status, 400);

  r = await b('POST', '/api/register', { email: 'b@example.com', name: 'B', password: 'password2' });
  const bBook = r.data.bookId;
  // 他人の家計簿は見えない
  assert.equal((await b('GET', `/api/books/${bookId}/bootstrap`)).status, 404);
  assert.equal((await c('GET', '/api/me')).status, 401);

  // 共有
  const inv = (await a('POST', `/api/books/${bookId}/invite`)).data.code;
  assert.equal((await b('POST', '/api/join', { code: 'nope' })).status, 404);
  assert.equal((await b('POST', '/api/join', { code: inv })).status, 200);
  r = await b('GET', `/api/books/${bookId}/bootstrap?month=2024-05`);
  assert.equal(r.status, 200);
  assert.equal(r.data.members.length, 2);
  assert.ok(bBook !== bookId);

  // 無限にカテゴリ追加 + 階層
  let parent = null;
  const ids = [];
  for (let i = 0; i < 30; i++) {
    r = await a('POST', `/api/books/${bookId}/categories`, { type: 'expense', name: `cat${i}`, parent_id: parent });
    assert.equal(r.status, 200);
    parent = r.data.id; ids.push(parent);
  }
  // 循環は拒否
  r = await a('PUT', `/api/books/${bookId}/categories/${ids[0]}`, { name: 'cat0', parent_id: ids[29] });
  assert.equal(r.status, 400);

  // 取引
  const food = (await a('GET', `/api/books/${bookId}/bootstrap?month=2024-05`)).data.categories.find((x) => x.name === '食費').id;
  r = await a('POST', `/api/books/${bookId}/transactions`, { type: 'expense', amount: 1200, date: '2024-05-03', category_id: food, memo: 'ランチ 寿司' });
  assert.equal(r.status, 200);
  await b('POST', `/api/books/${bookId}/transactions`, { type: 'income', amount: 300000, date: '2024-03-25', memo: '給与' });
  assert.equal((await a('POST', `/api/books/${bookId}/transactions`, { type: 'income', amount: 1, date: '2024-02-30', memo: '' })).status, 400);
  assert.equal((await a('POST', `/api/books/${bookId}/transactions`, { type: 'income', amount: 1, date: '2024-05-01', category_id: food })).status, 400);

  // 検索 (別の月でもヒット → ジャンプ用に date が返る)
  r = await a('GET', `/api/books/${bookId}/search?q=${encodeURIComponent('寿司')}`);
  assert.equal(r.data.total, 1);
  assert.equal(r.data.results[0].date, '2024-05-03');
  r = await a('GET', `/api/books/${bookId}/search?q=${encodeURIComponent('食費')}`);
  assert.equal(r.data.total, 1);
  r = await a('GET', `/api/books/${bookId}/search?q=300000`);
  assert.equal(r.data.total, 1);
  r = await a('GET', `/api/books/${bookId}/search?q=%25`); // ワイルドカードはリテラル扱い
  assert.equal(r.data.total, 0);

  // 繰り返し: 過去開始 → 今日までの分が展開され、再取得しても増えない
  r = await a('POST', `/api/books/${bookId}/recurrings`, { type: 'expense', amount: 80000, freq: 'monthly', start_date: '2024-01-31', memo: '家賃' });
  assert.equal(r.status, 200);
  r = await a('GET', `/api/books/${bookId}/transactions?month=2024-02`);
  assert.deepEqual(r.data.transactions.filter((t) => t.memo === '家賃').map((t) => t.date), ['2024-02-29']);
  const n1 = (await a('GET', `/api/books/${bookId}/search?q=家賃&limit=200`)).data.total;
  const n2 = (await a('GET', `/api/books/${bookId}/search?q=家賃&limit=200`)).data.total;
  assert.equal(n1, n2);
  assert.ok(n1 >= 28);

  // 使用中カテゴリの削除はアーカイブ
  r = await a('DELETE', `/api/books/${bookId}/categories/${food}`);
  assert.equal(r.data.archived, true);

  // ログアウト
  await a('POST', '/api/logout', {});
  assert.equal((await a('GET', '/api/me')).status, 401);
  assert.equal((await a('POST', '/api/login', { email: 'a@example.com', password: 'wrong-pass' })).status, 401);
  assert.equal((await a('POST', '/api/login', { email: 'a@example.com', password: 'password1' })).status, 200);
});
