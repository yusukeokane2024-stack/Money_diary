// 繰り返し収支の発生日計算 (純粋関数)。
// n 回目の発生日は開始日から直接計算するので、月末(31日など)でもずれずに丸められる。

const pad = (n) => String(n).padStart(2, '0');
const fmt = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** 日本向けアプリなので JST 基準の今日 (YYYY-MM-DD) */
export function today(now = Date.now()) {
  const d = new Date(now + 9 * 3600 * 1000);
  return fmt(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

export function occurrence(rec, n) {
  const [y, m, d] = rec.startDate.split('-').map(Number);
  const k = n * rec.every;
  if (rec.freq === 'daily' || rec.freq === 'weekly') {
    const t = new Date(Date.UTC(y, m - 1, d + (rec.freq === 'daily' ? k : k * 7)));
    return fmt(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
  }
  const total = y * 12 + (m - 1) + (rec.freq === 'monthly' ? k : k * 12);
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return fmt(ny, nm, Math.min(d, daysIn(ny, nm)));
}

/** nextN 以降で now までに発生する分を返す。max 件で打ち切る。 */
export function dueOccurrences(rec, now = today(), max = 400) {
  const out = [];
  let n = rec.nextN;
  while (out.length < max) {
    const date = occurrence(rec, n);
    if (date > now || (rec.endDate && date > rec.endDate)) break;
    out.push({ n, date });
    n++;
  }
  return { due: out, nextN: n };
}

/** now より前をスキップした最初の n (スケジュール変更時に過去分を再生成しない) */
export function firstFutureN(rec, now = today()) {
  let n = 0;
  while (occurrence(rec, n) < now && n < 100000) n++;
  return n;
}
