// esbuild で src/ を dist/ に束ねる。app.js (画面) と data.js (Firebase) を分割し、初回描画を先に出す。
import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { relative, resolve } from 'node:path';

const emulator = process.argv.includes('--emulator');
rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });

const result = await esbuild.build({
  entryPoints: { app: 'src/app.js', data: 'src/data.js' },
  bundle: true, splitting: true, format: 'esm', target: 'es2022', minify: true, legalComments: 'none',
  outdir: 'dist', plugins: emulator ? [{
    name: 'emulator-config',
    setup: (b) => b.onResolve({ filter: /firebase-config\.js$/ }, () => ({ path: resolve('src/firebase-config.emulator.js') })),
  }] : [], chunkNames: 'chunks/[name]-[hash]', metafile: true, logLevel: 'info',
});

for (const f of ['index.html', 'style.css', 'manifest.webmanifest', 'icon.svg', 'icon-180.png', 'icon-192.png', 'icon-512.png']) cpSync(`src/${f}`, `dist/${f}`);

// Service Worker に事前キャッシュ対象と版番号を埋め込む
const built = Object.keys(result.metafile.outputs).map((o) => '/' + relative('dist', o));
const files = ['/', '/index.html', '/style.css', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', ...built];
const hash = createHash('sha256');
for (const f of files.filter((x) => x !== '/')) hash.update(readFileSync('dist' + f));
const sw = readFileSync('src/sw.js', 'utf8')
  .replace('__SHELL__', JSON.stringify(files))
  .replace('__VERSION__', hash.digest('hex').slice(0, 12));
writeFileSync('dist/sw.js', sw);
console.log(`dist/: ${files.length} files`);
