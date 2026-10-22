// 繰り返しの反映: 追加画面から登録 → 今日/過去/未来の開始日 → アプリ再開(日付が進む)でも反映され、重複しない
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire('/node-tools/node_modules/');
const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:5000';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
const a = await ctx.newPage();
// 失敗したときに、画面の状態 (文字・アドレス・コンソールの警告) を残して原因を追えるようにする
const logs = [];
a.on('console', (m) => ['error', 'warning'].includes(m.type()) && logs.push(`${m.type()}: ${m.text().slice(0, 240)}`));
process.on('uncaughtException', async (e) => {
  console.error('FAILED:', e.message.split('\n')[0]);
  console.error('url:', a.url());
  console.error('body:', (await a.locator('body').innerText().catch(() => '')).slice(0, 700).replace(/\n/g, ' | '));
  console.error('state:', JSON.stringify(await a.evaluate(() => ({ hash: location.hash, vis: document.visibilityState, rows: document.querySelectorAll('.row').length })).catch(() => null)));
  console.error('console tail:', logs.slice(-6));
  if (process.env.SHOTS_DIR) await a.screenshot({ path: `${process.env.SHOTS_DIR}/fail-recurring.png` }).catch(() => {});
  process.exit(1);
});
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
// 条件に合う表示になるまで待つ (固定の待ち時間だと、動作が少し遅れたときに失敗するため)
async function countUntil(q, re, ms = 12000) {
  const t0 = Date.now();
  let last = '';
  while (Date.now() - t0 < ms) { last = await count(q); if (re.test(last)) return last; await a.waitForTimeout(400); }
  return last;
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
// 予定: 毎月の繰り返しは、翌月以降のカレンダー/一覧に「予定」として出る (保存はされない)
const shiftMonth = (m, d) => { const [y, mo] = m.split('-').map(Number); const t = y * 12 + (mo - 1) + d; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`; };
const thisMonth = today.slice(0, 7);
await a.click('a:has-text("家計簿")');
await a.click('button[data-view=list]');
await a.evaluate((m) => { location.hash = `#/month/${m}`; }, shiftMonth(thisMonth, 1));
await a.waitForSelector('.row.sched:has-text("サブスクA")');
if (process.env.SHOTS_DIR) await a.screenshot({ path: `${process.env.SHOTS_DIR}/fb-sched.png` });
assert.equal(await a.locator('.row.sched:has-text("サブスクA")').count(), 1);
assert.match(await a.textContent('.sched-note'), /予定を含む: 支出 ¥/);   // 合計に予定が含まれる旨を表示
assert.match(await a.textContent('.s-exp'), /¥/);
await a.evaluate((m) => { location.hash = `#/month/${m}`; }, shiftMonth(thisMonth, 4)); // 数か月先も出る
await a.waitForSelector('.row.sched:has-text("サブスクA")');
await a.click('.row.sched:has-text("サブスクA")'); // 予定をタップ → 元の繰り返し設定の編集画面
await a.waitForSelector('.sheet h2:has-text("繰り返しを編集")');
await a.click('.sheet .btn:has-text("キャンセル")');
// 今月の分は本物の記録 (予定ではない)
await a.evaluate((m) => { location.hash = `#/month/${m}`; }, thisMonth);
await a.waitForSelector('.row:has-text("サブスクA")');
assert.equal(await a.locator('.row.sched:has-text("サブスクA")').count(), 0);
// 予定は検索に混ざらない
assert.match(await count('サブスクA'), /^1件/);
// カレンダー表示: 翌月の該当日に金額が出る
await a.click('a:has-text("家計簿")');
await a.click('button[data-view=cal]');
await a.evaluate((m) => { location.hash = `#/month/${m}`; }, shiftMonth(thisMonth, 1));
await a.waitForSelector('.cal-cell .a.e');
assert.ok((await a.locator('.cal-cell .a.e').count()) >= 1);
console.log('✓ 予定: 翌月・数か月先に表示 / 合計に含める旨を注記 / タップで編集 / 今月分は本物 / 検索に混ざらない / カレンダーにも出る');
await a.click('button[data-view=list]');

// 一時停止スイッチ: オフにすると予定が消えて一覧に(停止中)と出る / オンに戻すと予定が戻る
const nextMonth = shiftMonth(thisMonth, 1);
async function openRecurringA() {
  await a.click('a:has-text("設定")');
  await a.click('.row:has-text("繰り返しの管理")');
  await a.waitForSelector('h1:has-text("繰り返しの管理")');
  await a.click('.row:has-text("サブスクA")');
  await a.waitForSelector('.sheet h2:has-text("繰り返しを編集")');
}
await openRecurringA();
await a.locator('.sheet input.switch').click();
assert.equal(await a.locator('.sheet input.switch').isChecked(), false);
await a.click('.sheet .btn:has-text("保存")');
await a.waitForSelector('.row:has-text("サブスクA"):has-text("停止中")');
await a.evaluate((m) => { location.hash = `#/month/${m}`; }, nextMonth);
await a.waitForSelector('.summary');
assert.equal(await a.locator('.row.sched:has-text("サブスクA")').count(), 0);
await openRecurringA();
await a.locator('.sheet input.switch').click();
assert.equal(await a.locator('.sheet input.switch').isChecked(), true);
await a.click('.sheet .btn:has-text("保存")');
await a.waitForSelector('.row:has-text("サブスクA")');
await a.evaluate((m) => { location.hash = `#/month/${m}`; }, nextMonth);
await a.waitForSelector('.row.sched:has-text("サブスクA")');
console.log('✓ 一時停止スイッチ: オフで予定が消え「停止中」と出る / オンに戻すと予定が戻る');
await a.evaluate((m) => { location.hash = `#/month/${m}`; }, thisMonth);

// 既存の記録を繰り返しにする: その記録が1回目になり、同じ日の記録が二重にならない
await a.click('a:has-text("家計簿")');
await a.click('button[data-view=list]');
await addViaSheet({ amount: 3000, memo: 'ジム代', date: today });
await a.waitForSelector('.row:has-text("ジム代")');
assert.match(await count('ジム代'), /^1件/);
await a.click('a:has-text("家計簿")');
await a.click('.row:has-text("ジム代")');
await a.waitForSelector('.sheet h2:has-text("記録を編集")');
assert.match(await a.textContent('.sheet .hint'), /1回目として/);       // 既存の記録にも「繰り返し」の選択が出る
await a.selectOption('.sheet select', 'monthly');
await a.click('.sheet .btn:has-text("保存")');
await a.waitForSelector('.sheet', { state: 'detached' });
await a.waitForTimeout(2500);
assert.match(await count('ジム代'), /^1件/);                           // 今日の分は二重にならない
await a.click('a:has-text("家計簿")');
await a.waitForSelector('.row:has-text("ジム代") .s svg');              // 繰り返しのマークが付く
await a.evaluate((m) => { location.hash = `#/month/${m}`; }, nextMonth);
await a.waitForSelector('.row.sched:has-text("ジム代")');              // 翌月に予定が出る
await a.evaluate((m) => { location.hash = `#/month/${m}`; }, thisMonth);
await a.click('.row:has-text("ジム代")');                               // 繰り返しから作られた記録を開くと、元の設定へ移れる
await a.waitForSelector('.sheet .from-rec');
assert.equal(await a.locator('.sheet select').count(), 0);
await a.click('.sheet .from-rec button');
await a.waitForSelector('.sheet h2:has-text("繰り返しを編集")');
await a.click('.sheet .btn:has-text("キャンセル")');
console.log('✓ 既存の記録を繰り返しに: 1回目として登録 / 二重にならない / マーク / 翌月に予定 / 元の設定へのリンク');

// 過去の日付の記録を繰り返しにすると、今日までの分も記録される
await addViaSheet({ amount: 800, memo: 'ジム過去', date: addDays(today, -75) });
await a.waitForSelector('.row:has-text("ジム過去")');
await a.click('.row:has-text("ジム過去")');
await a.waitForSelector('.sheet h2:has-text("記録を編集")');
await a.selectOption('.sheet select', 'monthly');
await a.click('.sheet .btn:has-text("保存")');
await a.waitForSelector('.sheet', { state: 'detached' });
await a.waitForTimeout(3000);
assert.match(await count('ジム過去'), /^3件 ・ 支出 ¥2,400/);           // 元の1件 + 今日までの2件
console.log('✓ 過去の記録を繰り返しに: 元の1件 + 今日までの分が記録される');
await a.click('a:has-text("家計簿")');

// D: 明日から毎日の繰り返し → いまは0件。日付が2日進んだ状態でアプリに戻ると反映される (再読み込みなし)
const tomorrow = addDays(today, 1);
await addViaSheet({ amount: 700, memo: 'サブスクD', date: tomorrow, freq: 'daily' });
await a.waitForTimeout(2500);
assert.match(await count('サブスクD'), /該当する記録はありません/);
await a.evaluate(() => { const real = Date.now; Date.now = () => real() + 2 * 86400e3; document.dispatchEvent(new Event('visibilitychange')); });
assert.match(await countUntil('サブスクD', /^2件 ・ 支出 ¥1,400/), /^2件 ・ 支出 ¥1,400/); console.log('✓ アプリに戻ると(日付が進んでいれば)再読み込みなしで反映');
await a.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
await a.waitForTimeout(2500);
assert.match(await count('サブスクD'), /^2件/); console.log('✓ もう一度戻っても増えない');
await browser.close();
