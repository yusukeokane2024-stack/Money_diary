// エミュレータ (Auth / Firestore / Hosting) を起動して、実ブラウザで E2E を流す。
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

execFileSync('node', ['build.mjs', '--emulator'], { stdio: 'inherit' });
// 本番と同じヘッダ (CSP 含む) で配信する。エミュレータ宛の接続だけ追加で許可する。
const cfg = JSON.parse(readFileSync('firebase.json', 'utf8'));
for (const g of cfg.hosting.headers) for (const h of g.headers)
  if (h.key === 'Content-Security-Policy') h.value = h.value.replace("connect-src 'self'", "connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:*");
writeFileSync('.firebase.emulator.json', JSON.stringify(cfg));
const scripts = process.argv.length > 2 ? process.argv.slice(2) : ['test/e2e/e2e.mjs', 'test/e2e/recurring.mjs', 'test/e2e/copy.mjs', 'test/e2e/gestures.mjs'];
try {
  for (const script of scripts) {
    // エミュレータの一時的な接続断で稀に失敗するため、失敗したら1回だけやり直す (2回続けて失敗したら本物の失敗)
    for (let attempt = 1; ; attempt++) {
      try {
        execFileSync('npx', ['firebase', 'emulators:exec', '--config', '.firebase.emulator.json', '--only', 'firestore,auth,hosting', '--project', 'demo-money-diary', `node ${script}`], { stdio: 'inherit' });
        break;
      } catch (e) {
        if (attempt >= 2) throw e;
        console.warn(`\n⚠ ${script} が失敗したので、1回だけやり直します\n`);
      }
    }
  }
} finally {
  execFileSync('rm', ['-f', '.firebase.emulator.json']);
}
