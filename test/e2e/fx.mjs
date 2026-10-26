// 外貨で入力: 為替レートで円に換算 / レートの手直し / 円に戻す / 取得失敗は手入力 / コピー
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire('/node-tools/node_modules/');
const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:5000';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
const a = await ctx.newPage();
const errors = [];
a.on('pageerror', (e) => errors.push(e.message));
a.on('dialog', (d) => d.accept());
const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const [ty, tm] = today.split('-').map(Number);
const prev = `${tm === 1 ? ty - 1 : ty}-${String(tm === 1 ? 12 : tm - 1).padStart(2, '0')}`;
const d5 = `${prev}-05`, d6 = `${prev}-06`;

// 為替APIの代わり: 日付ごとに違うレート (5日=149.2 / 6日=148 / それ以外=150)
const calls = [];
let fail = false;
await ctx.route(/api\.frankfurter\.dev|open\.er-api\.com/, (route) => {
  const url = route.request().url();
  calls.push(url);
  if (fail) return route.abort();
  const rate = url.includes(d5) ? 149.2 : url.includes(d6) ? 148 : 150;
  route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ rates: { JPY: rate } }) });
});

await a.goto(`${BASE}/?emulator=1`);
await a.click('text=新規登録');
await a.fill('input[placeholder=ニックネーム]', 'テスト');
await a.fill('input[type=email]', `t${Date.now()}@example.com`);
await a.fill('input[type=password]', 'password123');
await a.click('button[type=submit]');
await a.waitForSelector('.fab');
await a.evaluate((m) => { location.hash = `#/month/${m}`; }, prev);
await a.waitForSelector('.summary');

const rate = () => a.inputValue('.rate-in');
const result = () => a.locator('.fx-result').textContent();

// ---- 米ドルで入力 → その日のレートで円に ----
await a.click('.fab');
await a.selectOption('select[data-cur]', 'USD');
await a.fill('.sheet input[type=date]', d5);
await a.dispatchEvent('.sheet input[type=date]', 'change');
await a.fill('.amount-in', '25.5');
await a.waitForFunction(() => document.querySelector('.rate-in')?.value === '149.2');
assert.equal(await result(), '= ¥3,805');
assert.match(await a.locator('.fx-note').textContent(), /のレート/);
assert.equal(await a.getAttribute('.amount-wrap', 'data-sym'), '$');
await a.fill('input[placeholder="例: ランチ"]', 'ホテル');
await a.click('.sheet .btn:has-text("保存")');
await a.waitForSelector('.sheet', { state: 'detached' });
await a.waitForSelector('.row:has-text("ホテル")');
const row = a.locator('.row:has-text("ホテル")');
assert.match(await row.textContent(), /-¥3,805/);
assert.match(await row.textContent(), /\$25\.5/);
assert.match(await a.locator('.summary .s-exp b').textContent(), /¥3,805/); // 月の合計は円で集計
console.log('✓ 米ドルで入力: その日のレートで円に換算 / 記録に$表示 / 月の合計に反映');

// ---- 日付を変えるとレートも取り直す(手で直していなければ) ----
await a.click('.fab');
await a.selectOption('select[data-cur]', 'USD');
await a.fill('.sheet input[type=date]', d5);
await a.dispatchEvent('.sheet input[type=date]', 'change');
await a.waitForFunction(() => document.querySelector('.rate-in')?.value === '149.2');
await a.fill('.sheet input[type=date]', d6);
await a.dispatchEvent('.sheet input[type=date]', 'change');
await a.waitForFunction(() => document.querySelector('.rate-in')?.value === '148');
// 手で直したレートは、日付を変えても上書きしない
await a.fill('.rate-in', '151');
await a.fill('.sheet input[type=date]', d5);
await a.dispatchEvent('.sheet input[type=date]', 'change');
await a.waitForTimeout(400);
assert.equal(await rate(), '151');
await a.fill('.amount-in', '10');
assert.equal(await result(), '= ¥1,510');
await a.click('.sheet .btn:has-text("キャンセル")');
console.log('✓ 日付を変えるとレートも取り直す / 手で直したレートは保つ');

// ---- 編集: 記録時のレートのまま。レートを直して保存できる ----
await row.click();
await a.waitForSelector('.sheet h2:has-text("記録を編集")');
assert.equal(await a.inputValue('select[data-cur]'), 'USD');
assert.equal(await a.inputValue('.amount-in'), '25.5');
assert.equal(await rate(), '149.2');
await a.fill('.rate-in', '150');
assert.equal(await result(), '= ¥3,825');
await a.click('.sheet .btn:has-text("保存")');
await a.waitForSelector('.sheet', { state: 'detached' });
await a.waitForFunction(() => /-¥3,825/.test(document.querySelector('.row')?.textContent || ''));
console.log('✓ 編集: 元の通貨・金額・レートが入っている / レートを直すと円も変わる');

// ---- コピーでも外貨を引き継ぐ ----
await a.locator('.row:has-text("ホテル")').click();
await a.click('.sheet .btn:has-text("コピーして新規入力")');
await a.waitForSelector('.sheet h2:has-text("コピー")');
assert.equal(await a.inputValue('select[data-cur]'), 'USD');
assert.equal(await a.inputValue('.amount-in'), '25.5');
assert.equal(await rate(), '150');
await a.click('.sheet .btn:has-text("キャンセル")');
console.log('✓ コピー: 外貨も引き継ぐ');

// ---- 円に戻すと、外貨の情報は消える ----
await a.locator('.row:has-text("ホテル")').click();
await a.selectOption('select[data-cur]', 'JPY');
assert.equal(await a.locator('.fx-box').isHidden(), true);
await a.fill('.amount-in', '4000');
await a.click('.sheet .btn:has-text("保存")');
await a.waitForSelector('.sheet', { state: 'detached' });
await a.waitForFunction(() => /-¥4,000/.test(document.querySelector('.row')?.textContent || ''));
assert.ok(!/\$/.test(await a.locator('.row:has-text("ホテル")').textContent()));
console.log('✓ 円に戻す: 外貨の表示は消える');

// ---- レートを取得できないとき: 手入力 ----
fail = true;
await a.click('.fab');
await a.selectOption('select[data-cur]', 'EUR');
await a.fill('.amount-in', '12');
await a.waitForFunction(() => /取得できませんでした/.test(document.querySelector('.fx-note')?.textContent || ''));
await a.click('.sheet .btn:has-text("保存")');
assert.match(await a.locator('.sheet .err').textContent(), /レートを入力/);
await a.fill('.rate-in', '160.5');
assert.equal(await result(), '= ¥1,926');
await a.fill('.sheet input[type=date]', d5);
await a.fill('input[placeholder="例: ランチ"]', 'お土産');
await a.click('.sheet .btn:has-text("保存")');
await a.waitForSelector('.sheet', { state: 'detached' });
await a.waitForSelector('.row:has-text("お土産")');
assert.match(await a.locator('.row:has-text("お土産")').textContent(), /-¥1,926/);
assert.match(await a.locator('.row:has-text("お土産")').textContent(), /€12/);
console.log('✓ レートを取得できないとき: 手入力で保存できる');

// ---- 通常の追加画面には通貨の切り替えがある ----
await a.click('.fab');
assert.equal(await a.locator('select[data-cur]').count(), 1);
await a.click('.sheet .btn:has-text("キャンセル")');

assert.deepEqual(errors, []);
await browser.close();
console.log('E2E OK');
