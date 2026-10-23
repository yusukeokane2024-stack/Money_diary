// シートを下スワイプで閉じる / カレンダーの左右スワイプ / グラフの年表示
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire('/node-tools/node_modules/');
const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:5000';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, locale: 'ja-JP', timezoneId: 'Asia/Tokyo', hasTouch: true });
const a = await ctx.newPage();
const errors = [];
a.on('pageerror', (e) => errors.push(e.message));
a.on('dialog', (d) => d.accept());
const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const month = today.slice(0, 7);
const shift = (m, d) => { const [y, mo] = m.split('-').map(Number); const t = y * 12 + mo - 1 + d; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`; };
await a.goto(`${BASE}/?emulator=1`);
await a.click('text=新規登録');
await a.fill('input[placeholder=ニックネーム]', 'テスト');
await a.fill('input[type=email]', `t${Date.now()}@example.com`);
await a.fill('input[type=password]', 'password123');
await a.click('button[type=submit]');
await a.waitForSelector('.fab');
const cdp = await ctx.newCDPSession(a);
async function swipe(x1, y1, x2, y2, steps = 8) {
  const pt = (x, y) => [{ x, y }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(x1, y1) });
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(x1 + ((x2 - x1) * i) / steps, y1 + ((y2 - y1) * i) / steps) });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
const box = async (sel) => (await a.locator(sel).first().boundingBox());

// ---- シート: 下スワイプで閉じる (入力せずキャンセル) ----
await a.click('.fab');
await a.waitForSelector('.sheet');
await a.waitForTimeout(400);
let b = await box('.sheet');
await swipe(b.x + b.width / 2, b.y + 6, b.x + b.width / 2, b.y + 260);
await a.waitForSelector('.sheet', { state: 'detached', timeout: 3000 });
console.log('✓ 追加シート: 下へスワイプで閉じる');

// 短いスワイプでは閉じない
await a.click('.fab');
await a.waitForSelector('.sheet');
await a.waitForTimeout(400);
b = await box('.sheet');
await swipe(b.x + b.width / 2, b.y + 6, b.x + b.width / 2, b.y + 40);
await a.waitForTimeout(500);
assert.equal(await a.locator('.sheet').count(), 1);
assert.equal(await a.evaluate(() => getComputedStyle(document.querySelector('.sheet')).transform), 'none'); // 元の位置に戻る
// 入力欄の上からのスワイプでは閉じない / 横方向のスワイプでも閉じない
const ib = await box('.amount-in');
await swipe(ib.x + 20, ib.y + 10, ib.x + 20, ib.y + 300);
await a.waitForTimeout(400);
assert.equal(await a.locator('.sheet').count(), 1, '入力欄上のスワイプで閉じた');
await swipe(b.x + 40, b.y + 6, b.x + 330, b.y + 60);
await a.waitForTimeout(400);
assert.equal(await a.locator('.sheet').count(), 1, '横スワイプで閉じた');
console.log('✓ 短い/横/入力欄上のスワイプでは閉じない');
await a.keyboard.press('Escape');
await a.evaluate(() => document.querySelector('.sheet-bg')?.click());
await a.waitForSelector('.sheet', { state: 'detached' });

// ---- カレンダー: 左右スワイプで月を移動 ----
await a.evaluate((m) => { location.hash = `#/month/${m}`; }, month);
await a.click('button[data-view=cal]');
await a.waitForSelector('.cal-cell[data-date]');
const monthText = () => a.locator('.month-btn').first().textContent();
const label = (m) => `${m.slice(0, 4)}年${+m.slice(5)}月`;
assert.match(await monthText(), new RegExp(label(month)));
let cb = await box('.cal');
const cy = cb.y + 120;
await swipe(cb.x + 300, cy, cb.x + 60, cy);        // 左へ → 翌月
await a.waitForFunction((t) => document.querySelector('.month-btn')?.textContent.includes(t), label(shift(month, 1)));
cb = await box('.cal');
await swipe(cb.x + 60, cb.y + 120, cb.x + 300, cb.y + 120); // 右へ → 前月
await a.waitForFunction((t) => document.querySelector('.month-btn')?.textContent.includes(t), label(month));
await swipe(cb.x + 60, cb.y + 120, cb.x + 300, cb.y + 120);
await a.waitForFunction((t) => document.querySelector('.month-btn')?.textContent.includes(t), label(shift(month, -1)));
// 途中まで引くと指に追従し、離すと元に戻る (月は変わらない)
{
  await a.waitForTimeout(500);
  const c0 = await box('.cal');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: c0.x + 200, y: c0.y + 100 }] });
  for (let i = 1; i <= 4; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: c0.x + 200 - i * 10, y: c0.y + 100 }] });
  const tx = await a.evaluate(() => new DOMMatrix(getComputedStyle(document.querySelector('[data-cal-card]')).transform).m41);
  assert.ok(tx < -20 && tx > -45, `追従 ${tx}`);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await a.waitForFunction(() => new DOMMatrix(getComputedStyle(document.querySelector('[data-cal-card]')).transform).m41 === 0);
  assert.match(await monthText(), new RegExp(label(shift(month, -1))));
}
// 下へスクロールした状態でスワイプしても、スクロール位置は先頭に戻らない
{
  await a.setViewportSize({ width: 390, height: 520 });
  await a.waitForTimeout(300);
  const maxY = await a.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  assert.ok(maxY > 120, `スクロールできる高さ ${maxY}`);
  const y = Math.min(200, maxY);
  await a.evaluate((v) => window.scrollTo(0, v), y);
  const c1 = await box('.cal');
  const m0 = await monthText();
  await swipe(c1.x + 300, c1.y + 60, c1.x + 60, c1.y + 60);
  await a.waitForFunction((t) => document.querySelector('.month-btn')?.textContent !== t, m0);
  await a.waitForSelector('.cal-cell[data-date]');
  await a.waitForTimeout(500);
  const y1 = await a.evaluate(() => window.scrollY);
  assert.ok(Math.abs(y1 - y) <= 60, `スクロール位置 ${y} → ${y1}`);
  await a.setViewportSize({ width: 390, height: 800 });
  await a.evaluate(() => window.scrollTo(0, 0));
}
// 縦方向のスワイプでは月が変わらない
cb = await box('.cal');
await swipe(cb.x + 200, cb.y + 200, cb.x + 230, cb.y + 20);
await a.waitForTimeout(300);
assert.match(await monthText(), new RegExp(label(month)));
console.log('✓ カレンダー: 左スワイプで翌月 / 右で前月 / 縦スワイプでは動かない');

// ---- グラフの年表示 ----
const y = today.slice(0, 4);
async function add({ amount, memo, date, type = 'expense' }) {
  await a.click('.fab');
  if (type === 'income') await a.click('.sheet .seg button:has-text("収入")');
  await a.fill('.amount-in', String(amount));
  await a.fill('.sheet input[type=date]', date);
  await a.fill('input[placeholder="例: ランチ"]', memo);
  await a.click('.sheet .btn:has-text("保存")');
  await a.waitForSelector('.sheet', { state: 'detached' });
}
await a.evaluate((m) => { location.hash = `#/month/${m}`; }, month);
await add({ amount: 1000, memo: '今月の支出', date: `${month}-02` });
await add({ amount: 5000, memo: '今月の収入', date: `${month}-03`, type: 'income' });
await add({ amount: 2000, memo: '1月の支出', date: `${y}-01-15` });
await add({ amount: 7000, memo: '1月の収入', date: `${y}-01-20`, type: 'income' });
await a.click('a:has-text("グラフ")');
await a.click('[data-scope=year]');
await a.waitForSelector('[data-year-summary]');
await a.waitForFunction(() => /¥/.test(document.querySelector('[data-year-summary] .s-inc b')?.textContent || ''));
const sum = await a.locator('[data-year-summary]').textContent();
assert.match(sum, new RegExp(`${y}年の収支`));
const isJan = month === `${y}-01`;
const expTotal = isJan ? 3000 : 3000, incTotal = 12000; // 1,000+2,000 / 5,000+7,000 (いまの月 + 1月)
const money = (n) => '¥' + n.toLocaleString('ja-JP');
if (!isJan) {
  assert.equal(await a.locator('[data-year-summary] .s-exp b').textContent(), money(expTotal));
  assert.equal(await a.locator('[data-year-summary] .s-inc b').textContent(), money(incTotal));
  assert.match(sum, new RegExp('¥9,000')); // 収支 12,000 - 3,000
}
assert.equal(await a.locator('svg.trend .tr-g').count(), 12);
// 棒の高さ: 収入(青)と支出(赤)が入れ替わっていない。最大は1月の収入 7,000
const hs = await a.evaluate(() => {
  const g = [...document.querySelectorAll('svg.trend .tr-g')];
  const ht = (el) => +el.getAttribute('height');
  return g.map((x) => ({ m: x.getAttribute('data-m'), i: ht(x.querySelector('.tr-i')), e: ht(x.querySelector('.tr-e')) }));
});
const jan = hs.find((x) => x.m === `${y}-01`);
assert.ok(jan.i > jan.e && jan.i > 0 && jan.e > 0, 'jan income bar taller than expense');
assert.ok(Math.abs(jan.e / jan.i - 2000 / 7000) < 0.02);
// 年の切り替え
await a.click('button[aria-label="前の年"]');
await a.waitForFunction((t) => document.querySelector('[data-year-summary]')?.textContent.includes(t), `${+y - 1}年の収支`);
assert.equal(await a.locator('[data-year-summary] .s-exp b').textContent(), '¥0');
// 棒をタップするとその月の表示へ
await a.click('button[aria-label="次の年"]');
await a.waitForFunction((t) => document.querySelector('[data-year-summary]')?.textContent.includes(t), `${y}年の収支`);
await a.locator(`svg.trend [data-m="${y}-01"]`).dispatchEvent('click');
await a.waitForSelector('[data-scope=month].on');
console.log('✓ グラフの年表示: 年間の収入/支出/収支・12か月の棒・年の切り替え・棒タップで月へ');

assert.deepEqual(errors, []);
await browser.close();
console.log('E2E OK');
