// src/icon.svg から PNG アイコンを作る (iPhone: 180px / Android・PWA: 192・512px)。
// Playwright (Chromium) で描画するので、実行には playwright が必要。 node scripts/make-icons.mjs
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(process.env.PLAYWRIGHT_DIR || '/node-tools/node_modules/');
const { chromium } = require('playwright');

const svg = readFileSync('src/icon.svg', 'utf8');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const [size, file] of [[180, 'icon-180.png'], [192, 'icon-192.png'], [512, 'icon-512.png']]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:#fff}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  await page.screenshot({ path: `src/${file}`, clip: { x: 0, y: 0, width: size, height: size } });
  console.log('wrote', file);
}
await browser.close();
