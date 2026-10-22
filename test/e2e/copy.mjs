// カレンダーの金額は省略せず数字で表示 / 記録・繰り返しをコピーして新規入力
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
const day = (n) => `${today.slice(0, 7)}-${String(n).padStart(2, '0')}`;
await a.goto(`${BASE}/?emulator=1`);
await a.click('text=新規登録');
await a.fill('input[placeholder=ニックネーム]', 'テスト');
await a.fill('input[type=email]', `t${Date.now()}@example.com`);
await a.fill('input[type=password]', 'password123');
await a.click('button[type=submit]');
await a.waitForSelector('.fab');

async function add({ amount, memo, date, type = 'expense', cat }) {
  await a.click('.fab');
  if (type === 'income') await a.click('.sheet .seg button:has-text("収入")');
  await a.fill('.amount-in', String(amount));
  await a.fill('.sheet input[type=date]', date);
  if (cat) await a.click(`.cats button:has-text("${cat}")`);
  await a.fill('input[placeholder="例: ランチ"]', memo);
  await a.click('.sheet .btn:has-text("保存")');
  await a.waitForSelector('.sheet', { state: 'detached' });
}

// ---- 金額は「万」にせず数字で表示される ----
await add({ amount: 1280, memo: '小さい額', date: day(2), cat: '食費' });
await add({ amount: 123456, memo: '十万円台', date: day(3), cat: '住居' });
await add({ amount: 1234567, memo: '百万円台', date: day(4), cat: '住居' });
await add({ amount: 98765432, memo: '億に近い額', date: day(5), cat: '住居' });
await add({ amount: 300000, memo: '給与', date: day(6), type: 'income', cat: '給与' });
await a.evaluate((m) => { location.hash = `#/month/${m}`; }, today.slice(0, 7));
await a.click('button[data-view=cal]');
await a.waitForSelector('.cal-cell[data-date]');
const cell = (d) => a.locator(`.cal-cell[data-date="${d}"] .a`);
const texts = {};
for (const n of [2, 3, 4, 5, 6]) texts[n] = (await cell(day(n)).allTextContents()).join('|');
assert.equal(texts[2], '1,280');
assert.equal(texts[3], '123,456');           // 「12万」ではなく数字
assert.equal(texts[4], '1,234,567');
assert.equal(texts[5], '98,765,432');
assert.equal(texts[6], '300,000');           // 収入も数字
for (const n of [2, 3, 4, 5, 6]) assert.ok(!/万/.test(texts[n]));
// セルからはみ出して切れていない
const clipped = await a.evaluate(() => [...document.querySelectorAll('.cal-cell .a')].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent));
assert.deepEqual(clipped, []);
await a.screenshot({ path: `${process.env.SHOTS_DIR || '/tmp'}/fb-cal-numbers.png` });
console.log('✓ カレンダーの金額: 万にせず数字で表示 (1,234,567 / 98,765,432 も切れない)');

// ---- 記録のコピー ----
await a.click(`.cal-cell[data-date="${day(3)}"]`);
await a.click('.day-panel-head ~ .row:has-text("十万円台")');
await a.waitForSelector('.sheet h2:has-text("記録を編集")');
await a.click('.sheet .btn:has-text("コピーして新規入力")');
await a.waitForSelector('.sheet h2:has-text("記録をコピーして追加")');
assert.equal(await a.inputValue('.amount-in'), '123456');                                  // 金額
assert.equal(await a.inputValue('input[placeholder="例: ランチ"]'), '十万円台');            // メモ
assert.equal(await a.locator('.cats button.on').count(), 1);                               // カテゴリ
assert.match(await a.textContent('.cats button.on'), /住居/);
assert.equal(await a.inputValue('.sheet input[type=date]'), today);                         // 日付は今日
await a.fill('input[placeholder="例: ランチ"]', '十万円台 (コピー)');
await a.click('.sheet .btn:has-text("保存")');
await a.waitForSelector('.sheet', { state: 'detached' });
await a.waitForSelector(`.cal-cell[data-date="${today}"]`);
await a.click(`.cal-cell[data-date="${today}"]`);
await a.waitForSelector('.day-panel-head ~ .row:has-text("十万円台 (コピー)")');
assert.equal(await a.locator('.row:has-text("十万円台")').count() >= 1, true);
// 元の記録はそのまま残っている
await a.click(`.cal-cell[data-date="${day(3)}"]`);
await a.waitForSelector('.day-panel-head ~ .row:has-text("十万円台")');
console.log('✓ 記録のコピー: 金額・メモ・カテゴリが入った状態で開き、日付は今日 / 元の記録は残る');

// ---- 繰り返しのコピー ----
await a.click('.fab');
await a.fill('.amount-in', '5000');
await a.fill('.sheet input[type=date]', today);
await a.fill('input[placeholder="例: ランチ"]', 'ジム');
await a.selectOption('.sheet select', 'monthly');
await a.click('.sheet .btn:has-text("保存")');
await a.waitForTimeout(2500);
await a.click('a:has-text("設定")');
await a.click('.row:has-text("繰り返しの管理")');
await a.waitForSelector('h1:has-text("繰り返しの管理")');
await a.click('.row:has-text("ジム")');
await a.waitForSelector('.sheet h2:has-text("繰り返しを編集")');
await a.click('.sheet .btn:has-text("コピーして新規入力")');
await a.waitForSelector('.sheet h2:has-text("繰り返しをコピーして追加")');
assert.equal(await a.inputValue('.amount-in'), '5000');
assert.equal(await a.inputValue('.sheet select'), 'monthly');                               // 頻度も引き継ぐ
await a.fill('input[placeholder="例: ランチ"]', 'ジム 2つ目');
await a.click('.sheet .btn:has-text("保存")');
await a.waitForSelector('.row:has-text("ジム 2つ目")');
assert.equal(await a.locator('.row:has-text("ジム")').count(), 2);
console.log('✓ 繰り返しのコピー: 頻度・金額を引き継いで新規追加 / 元の設定は残る');
assert.deepEqual(errors, []);
await browser.close();
