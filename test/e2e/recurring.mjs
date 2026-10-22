// 繰り返しの反映: 追加画面から登録 → 今日/過去/未来の開始日 → アプリ再開(日付が進む)でも反映され、重複しない
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire('/node-tools/node_modules/');
const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:5000';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
const a = await ctx.newPage();
a.on('pageerror', (e) => console.log('pageerror', e.message));
a.on('console', (m) => ['error', 'warning'].includes(m.type()) && console.log('console', m.type(), m.text().slice(0, 200)));
a.on('dialog', (d) => d.accept());
const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400e3).toISOString().slice(0, 10);
await a.goto(`${BASE}/?emulator=1`);
await a.click('text=新規登録');
await a.fill('input[placeholder=ニックネーム]', 'テスト');
await a.fill('input[type=email]', `t${Date.now()}@example.com`);
await a.fill('input[type=password]', 'password123');
await a.click('button[type=submit]');
await a.waitForSelector('.fab');

async function addViaSheet({ amount, memo, date, freq }) {
  await a.click('.fab');
  await a.fill('.amount-in', String(amount));
  await a.fill('.sheet input[type=date]', date);
  await a.fill('input[placeholder="例: ランチ"]', memo);
  if (freq) await a.selectOption('.sheet select', freq);
  await a.click('.sheet .btn:has-text("保存")');
}
const count = async (q) => {
  await a.click('a:has-text("検索")');
  await a.fill('.search-in', q);
  await a.waitForTimeout(800);
  return (await a.textContent('.muted')).trim();
};

// A: 追加画面で「毎月」を選び、今日の日付で登録 → 今日の1件が記録される
await addViaSheet({ amount: 5000, memo: 'サブスクA', date: today, freq: 'monthly' });
await a.waitForTimeout(2500);
assert.match(await count('サブスクA'), /^1件 ・ 支出 ¥5,000/);
console.log('✓ 今日開始・毎月: 今日の1件が記録される');
// B: 75日前から毎月 → 過去分3件が記録される
await a.click('a:has-text("家計簿")');
await addViaSheet({ amount: 1000, memo: 'サブスクB', date: addDays(today, -75), freq: 'monthly' });
await a.waitForTimeout(2500);
assert.match(await count('サブスクB'), /^3件 ・ 支出 ¥3,000/);
console.log('✓ 75日前開始・毎月: 過去分3件が記録される');
// C: 10日後から毎月 → その日までは記録されない (繰り返しの管理には出る)
await a.click('a:has-text("家計簿")');
await addViaSheet({ amount: 2000, memo: 'サブスクC', date: addDays(today, 10), freq: 'monthly' });
await a.waitForTimeout(2500);
assert.match(await count('サブスクC'), /該当する記録はありません/);
await a.click('a:has-text("設定")');
await a.click('.row:has-text("繰り返しの管理")');
await a.waitForSelector('h1:has-text("繰り返しの管理")');
assert.equal(await a.locator('.row').count(), 3);
console.log('✓ 未来の開始日: その日までは記録されない / 繰り返しの管理に3件');
// 再読み込みしても重複しない
await a.reload();
await a.waitForTimeout(3000);
assert.match(await count('サブスクA'), /^1件/);
assert.match(await count('サブスクB'), /^3件/);
console.log('✓ 再読み込みしても重複しない');
await a.click('a:has-text("家計簿")');
// D: 明日から毎日の繰り返し → いまは0件。日付が2日進んだ状態でアプリに戻ると反映される (再読み込みなし)
const tomorrow = addDays(today, 1);
await addViaSheet({ amount: 700, memo: 'サブスクD', date: tomorrow, freq: 'daily' });
await a.waitForTimeout(2500);
assert.match(await count('サブスクD'), /該当する記録はありません/);
await a.evaluate(() => { const real = Date.now; Date.now = () => real() + 2 * 86400e3; document.dispatchEvent(new Event('visibilitychange')); });
await a.waitForTimeout(3500);
assert.match(await count('サブスクD'), /^2件 ・ 支出 ¥1,400/); console.log('✓ アプリに戻ると(日付が進んでいれば)再読み込みなしで反映');
await a.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
await a.waitForTimeout(2500);
assert.match(await count('サブスクD'), /^2件/); console.log('✓ もう一度戻っても増えない');
await browser.close();
