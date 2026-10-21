// カレンダー表示用の純粋関数

const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** 'YYYY-MM' → 週ごとの配列 (日曜始まり)。月外のセルは null。 */
export function monthGrid(month) {
  const [y, m] = month.split('-').map(Number);
  const lead = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const cells = Array(lead).fill(null);
  for (let d = 1; d <= daysIn(y, m); d++) cells.push(`${month}-${String(d).padStart(2, '0')}`);
  while (cells.length % 7) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** セルに収まるよう金額を短くする: 1,234 / 12万 */
export function compactYen(n) {
  if (n >= 100000) return `${Math.round(n / 10000).toLocaleString('ja-JP')}万`;
  return n.toLocaleString('ja-JP');
}

/** 日付ごとの収入・支出の合計 */
export function dayTotals(txs) {
  const map = new Map();
  for (const t of txs || []) {
    const e = map.get(t.date) || { income: 0, expense: 0, count: 0 };
    e[t.type] += t.amount;
    e.count++;
    map.set(t.date, e);
  }
  return map;
}
