// 実ブラウザ E2E: 登録 → 記録 → 繰り返し → カテゴリ → 検索ジャンプ → 共有 (2人) → リアルタイム反映 → 再起動の速さ
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire('/node-tools/node_modules/');
const { chromium } = require('playwright');

const BASE = 'http://127.0.0.1:5000';
const SHOTS = process.env.SHOTS_DIR || '/tmp';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
const errors = [];
const pages = [];
process.on('uncaughtException', async (e) => {
  console.error('FAILED:', e.message.split('\n')[0]);
  console.error('console errors:', errors);
  for (const [i, p] of pages.entries()) {
    await p.screenshot({ path: `${SHOTS}/fail-${i}.png` }).catch(() => {});
    console.error(`page${i} text:`, (await p.locator('body').innerText().catch(() => '')).slice(0, 300).replace(/\n/g, ' | '));
  }
  process.exit(1);
});
const newCtx = async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
  const page = await ctx.newPage();
  pages.push(page);
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
  page.on('dialog', (d) => d.accept());
  return { ctx, page };
};
const sheetSave = (p) => p.click('.sheet .btn:has-text("保存")');
const step = (s) => console.log('✓', s);

// ===== 太郎: 登録 =====
const A = await newCtx();
const a = A.page;
await a.goto(`${BASE}/?emulator=1`);
await a.click('text=新規登録');
await a.fill('input[placeholder=ニックネーム]', 'たろう');
await a.fill('input[type=email]', 'taro@example.com');
await a.fill('input[type=password]', 'password123');
await a.click('button[type=submit]');
await a.waitForSelector('.fab');
step('新規登録 → 家計簿が自動作成される');

// 支出追加
await a.click('.fab');
await a.fill('.amount-in', '1280');
await a.click('.cats button:has-text("食費")');
await a.fill('input[placeholder="例: ランチ"]', 'ランチ 寿司');
await sheetSave(a);
await a.waitForSelector('.row:has-text("ランチ 寿司")');
step('支出を追加');

// 過去月の記録
await a.click('.fab');
await a.fill('.amount-in', '5000');
await a.fill('.sheet input[type=date]', '2026-03-10');
await a.click('.cats button:has-text("趣味")');
await a.fill('input[placeholder="例: ランチ"]', 'ライブチケット');
await sheetSave(a);
await a.waitForSelector('.row:has-text("ライブチケット")');
step('過去月に追加すると、その月へ移動する');

// 不正入力はクライアントで止まる
await a.click('.fab');
await a.click('.sheet .btn:has-text("保存")');
assert.match(await a.textContent('.sheet .err'), /金額/);
await a.click('.sheet .btn:has-text("キャンセル")');
step('金額未入力はエラー表示');

// 繰り返し (毎月31日の家賃)
await a.click('a:has-text("繰り返し")');
await a.click('text=繰り返しを追加');
await a.fill('.amount-in', '80000');
await a.fill('.sheet input[type=date]', '2026-07-31');
await a.click('.cats button:has-text("住居")');
await a.fill('input[placeholder="例: ランチ"]', '家賃');
await sheetSave(a);
await a.waitForSelector('.row:has-text("家賃")');
step('繰り返しを登録');

// カテゴリ: サブカテゴリ追加
await a.click('a:has-text("設定")');
await a.click('text=カテゴリ編集');
await a.click('text=カテゴリを追加');
await a.fill('input[placeholder=カテゴリ名]', 'ペットフード');
await a.selectOption('.sheet select', { label: '食費' });
await a.screenshot({ path: `${SHOTS}/fb-category-edit.png` });
await a.click('.sheet .btn:has-text("保存")');
await a.waitForSelector('.row:has-text("ペットフード")');
step('サブカテゴリを追加');

// 検索 → ジャンプ
await a.click('a:has-text("検索")');
await a.fill('.search-in', 'ライブ');
await a.waitForSelector('.row:has-text("ライブチケット")');
await a.click('.row:has-text("ライブチケット")');
await a.waitForSelector('.row.flash');
assert.equal(await a.inputValue('input[type=month]'), '2026-03');
await a.screenshot({ path: `${SHOTS}/fb-jump.png` });
step('検索 → タップで該当月へジャンプして強調');

// 繰り返しが過去分まで展開されている (7/31, 8/31, 9/30)
await a.click('a:has-text("検索")');
await a.fill('.search-in', '家賃');
await a.waitForFunction(() => document.querySelector('.muted')?.textContent.includes('3件'));
assert.match(await a.textContent('.muted'), /3件 ・ 支出 ¥240,000/);
step('繰り返しが今日までの3件に展開 (月末は 9/30 に丸め)');

// ===== 共有: 太郎が招待 → 花子が参加 =====
await a.click('a:has-text("設定")');
await a.click('text=家族・パートナーを招待');
await a.waitForSelector('.code');
const code = (await a.textContent('.code')).trim();
step(`招待コード発行: ${code}`);

const B = await newCtx();
const b = B.page;
await b.goto(`${BASE}/?emulator=1#/join/${code}`); // 招待リンクから: 未ログインなので登録 → 自動で参加
await b.click('text=新規登録');
await b.fill('input[placeholder=ニックネーム]', 'はなこ');
await b.fill('input[type=email]', 'hanako@example.com');
await b.fill('input[type=password]', 'password456');
await b.click('button[type=submit]');
await b.waitForSelector('.row:has-text("ランチ 寿司")', { timeout: 15000 });
step('招待リンクから登録 → 太郎の家計簿に参加して記録が見える');

await b.click('a:has-text("設定")');
await b.waitForSelector('text=たろう');
assert.equal(await b.locator('.row:has-text("たろう"):has-text("オーナー")').count(), 1);
assert.equal(await b.locator('.row:has-text("はなこ (自分)"):has-text("メンバー")').count(), 1);
await b.screenshot({ path: `${SHOTS}/fb-settings.png` });

// リアルタイム: 花子が追加 → 太郎の画面に即反映
await b.click('a:has-text("家計簿")');
await b.click('.fab');
await b.fill('.amount-in', '300');
await b.fill('input[placeholder="例: ランチ"]', '花子のおやつ');
await sheetSave(b);
const thisMonth = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 7);
await a.evaluate((m) => { location.hash = `#/month/${m}`; }, thisMonth);
await a.waitForSelector('.row:has-text("花子のおやつ")', { timeout: 15000 });
assert.match(await a.textContent('.row:has-text("花子のおやつ")'), /はなこ/);
step('相手の追加がリアルタイムに反映 (誰の記録か表示)');

// ===== カレンダービュー =====
await a.click('button[data-view=cal]');
await a.waitForSelector('.cal-cell.today');
assert.match(await a.textContent('.cal-cell.today .a.e'), /1,580/);
assert.equal(await a.locator('.cal-cell.today.sel').count(), 1); // 今日が選択済み
assert.equal(await a.locator('.day-panel-head ~ .row:has-text("ランチ 寿司")').count(), 1);
await a.screenshot({ path: `${SHOTS}/fb-calendar.png` });
// 別の日を選ぶと記録なし → その日付で追加できる
const otherDay = `${thisMonth}-01`;
if (!(await a.locator('.cal-cell.today[data-date$="-01"]').count())) {
  await a.click(`.cal-cell[data-date="${otherDay}"]`);
  await a.waitForSelector('.cal-cell.sel[data-date="' + otherDay + '"]');
  assert.equal(await a.locator('text=この日の記録はありません').count(), 1);
  await a.click('.day-panel-head .btn');
  assert.equal(await a.inputValue('.sheet input[type=date]'), otherDay);
  await a.click('.sheet .btn:has-text("キャンセル")');
}
// 前回の表示形式を覚えている + 検索ジャンプはカレンダーでもその日を選んで強調
await a.click('a:has-text("検索")');
await a.fill('.search-in', 'ランチ');
await a.click('.row:has-text("ランチ 寿司")');
await a.waitForSelector('.row.flash');
assert.equal(await a.locator('.cal-cell.today.sel').count(), 1);
step('カレンダー: 日別の収支 / 日付選択 / その日に追加 / 検索ジャンプ');
await a.click('button[data-view=list]');
await a.waitForSelector('.day');
await a.emulateMedia({ colorScheme: 'dark' });
await a.screenshot({ path: `${SHOTS}/fb-list-dark.png` });
await a.emulateMedia({ colorScheme: 'light' });

// 花子はオーナーではないのでメンバー削除/家計簿名変更は出ない
assert.equal(await b.locator('text=家計簿名を変更').count(), 0);

// ===== 再起動の速さ (Service Worker + 前回データの即描画) =====
await a.waitForTimeout(1500); // SW 登録・スナップショット保存を待つ
const w = await A.ctx.newPage();
w.on('pageerror', (e) => errors.push('pageerror(warm): ' + e.message));
await w.goto(BASE, { waitUntil: 'commit' });
const t0 = Date.now();
await w.waitForSelector('.summary');
const warm = Date.now() - t0;
const nav = await w.evaluate(() => ({ fcp: Math.round(performance.getEntriesByName('first-contentful-paint')[0]?.startTime || 0) }));
console.log(`✓ 2回目以降の起動: 家計簿が見えるまで ${warm}ms (FCP ${nav.fcp}ms)`);
await w.screenshot({ path: `${SHOTS}/fb-month.png` });
assert.ok(warm < 1500, 'warm start too slow');

// ===== ログアウト → 別ユーザーに前のデータが残らない / 再ログイン =====
await a.click('a:has-text("設定")');
await a.click('button:has-text("ログアウト")');
await a.waitForSelector('input[type=password]');
assert.equal(await a.evaluate(() => localStorage.getItem('md:snap')), null);
await a.fill('input[type=email]', 'taro@example.com');
await a.fill('input[type=password]', 'wrong-password');
await a.click('button[type=submit]');
await a.waitForSelector('.err:has-text("違います")');
await a.fill('input[type=password]', 'password123');
await a.click('button[type=submit]');
await a.evaluate((m) => { location.hash = `#/month/${m}`; }, thisMonth);
await a.waitForSelector('.row:has-text("ランチ 寿司")');
step('ログアウトでキャッシュ削除 / 誤パスワード拒否 / 再ログイン');

const real = errors.filter((e) => !/Failed to load resource.*(400|401)|auth\/|net::ERR_ABORTED/.test(e));
console.log('errors:', real);
assert.equal(real.length, 0, 'console errors');
await browser.close();
console.log('E2E OK');
