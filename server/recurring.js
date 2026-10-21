// 繰り返し収支の展開ロジック。
// n 回目の発生日は開始日から計算するので、月末(31日など)でもずれずに丸められる。

const pad = (n) => String(n).padStart(2, '0');
const fmt = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

export function today() {
  // 日本向けアプリなので JST 基準の日付にする
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  return fmt(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

export function occurrence(rec, n) {
  const [y, m, d] = rec.start_date.split('-').map(Number);
  const k = n * rec.every;
  if (rec.freq === 'daily' || rec.freq === 'weekly') {
    const step = rec.freq === 'daily' ? k : k * 7;
    const t = new Date(Date.UTC(y, m - 1, d + step));
    return fmt(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
  }
  const months = rec.freq === 'monthly' ? k : k * 12;
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return fmt(ny, nm, Math.min(d, daysIn(ny, nm)));
}

const MAX_PER_RUN = 2000;

/** 今日までの未生成分を取引として展開する。冪等 (unique index + INSERT OR IGNORE)。 */
export function materialize(db, bookId, now = today()) {
  const recs = db.prepare('SELECT * FROM recurrings WHERE book_id = ? AND active = 1').all(bookId);
  if (!recs.length) return 0;
  const ins = db.prepare(
    `INSERT OR IGNORE INTO transactions (book_id, user_id, type, amount, category_id, date, memo, recurring_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const upd = db.prepare('UPDATE recurrings SET next_n = ? WHERE id = ?');
  let made = 0;
  db.exec('BEGIN');
  try {
    for (const r of recs) {
      let n = r.next_n;
      let guard = 0;
      for (;;) {
        const date = occurrence(r, n);
        if (date > now || (r.end_date && date > r.end_date) || guard++ >= MAX_PER_RUN) break;
        made += Number(ins.run(r.book_id, r.user_id, r.type, r.amount, r.category_id, date, r.memo, r.id).changes);
        n++;
      }
      if (n !== r.next_n) upd.run(n, r.id);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return made;
}
