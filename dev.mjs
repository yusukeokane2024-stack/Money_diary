// ローカル開発: エミュレータ (Auth / Firestore / Hosting) を起動する。 http://127.0.0.1:5000/?emulator=1
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';

execFileSync('node', ['build.mjs', '--emulator'], { stdio: 'inherit' });
const cfg = JSON.parse(readFileSync('firebase.json', 'utf8'));
for (const g of cfg.hosting.headers) for (const h of g.headers)
  if (h.key === 'Content-Security-Policy') h.value = h.value.replace("connect-src 'self'", "connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:*");
writeFileSync('.firebase.emulator.json', JSON.stringify(cfg));
try {
  execFileSync('npx', ['firebase', 'emulators:start', '--config', '.firebase.emulator.json', '--only', 'firestore,auth,hosting', '--project', 'demo-money-diary'], { stdio: 'inherit' });
} finally { rmSync('.firebase.emulator.json', { force: true }); }
