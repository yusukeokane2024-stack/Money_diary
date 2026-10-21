import { createServer } from 'node:http';
import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, normalize, sep } from 'node:path';
import { gzipSync } from 'node:zlib';
import { promisify } from 'node:util';
import { openDb, tx } from './db.js';
import { materialize, occurrence, today } from './recurring.js';

const scryptAsync = promisify(scrypt);
const SESSION_MS = 30 * 24 * 3600 * 1000;
const INVITE_MS = 7 * 24 * 3600 * 1000;

const DEFAULT_CATEGORIES = {
  expense: [
    ['食費', '🍚', '#ff9500'], ['日用品', '🧴', '#34c759'], ['交通費', '🚃', '#5ac8fa'],
    ['住居', '🏠', '#af52de'], ['水道光熱費', '💡', '#ffcc00'], ['通信費', '📱', '#007aff'],
    ['趣味・娯楽', '🎮', '#ff2d55'], ['衣服・美容', '👕', '#ff6482'], ['健康・医療', '🏥', '#30b0c7'],
    ['教育・教養', '📚', '#a2845e'], ['特別な支出', '🎁', '#ff3b30'], ['その他', '🏷️', '#8e8e93'],
  ],
  income: [
    ['給与', '💴', '#34c759'], ['賞与', '🎉', '#ffcc00'], ['副収入', '💼', '#5ac8fa'], ['その他', '🏷️', '#8e8e93'],
  ],
};

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (m) => new HttpError(400, m);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json',
};

export function createApp({ dbFile = process.env.DB_FILE || 'data/money.db', publicDir = new URL('../public', import.meta.url).pathname } = {}) {
  const db = openDb(dbFile);
  const q = (sql) => db.prepare(sql);

  // ---------- helpers ----------
  const sha = (s) => createHash('sha256').update(s).digest('hex');
  async function hashPassword(pw) {
    const salt = randomBytes(16);
    const key = await scryptAsync(pw, salt, 32);
    return `${salt.toString('hex')}:${key.toString('hex')}`;
  }
  async function verifyPassword(pw, stored) {
    const [s, k] = stored.split(':');
    const key = await scryptAsync(pw, Buffer.from(s, 'hex'), 32);
    return timingSafeEqual(key, Buffer.from(k, 'hex'));
  }
  function parseCookies(req) {
    const out = {};
    for (const p of (req.headers.cookie || '').split(';')) {
      const i = p.indexOf('=');
      if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
    }
    return out;
  }
  function startSession(res, req, userId) {
    const token = randomBytes(32).toString('base64url');
    q('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(sha(token), userId, Date.now() + SESSION_MS);
    const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
    res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MS / 1000}${secure}`);
  }
  function currentUser(req) {
    const t = parseCookies(req).sid;
    if (!t) return null;
    const row = q(`SELECT u.id, u.email, u.name, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`).get(sha(t));
    if (!row) return null;
    if (row.expires_at < Date.now()) { q('DELETE FROM sessions WHERE token_hash = ?').run(sha(t)); return null; }
    return { id: row.id, email: row.email, name: row.name };
  }
  function membership(bookId, userId) {
    return q('SELECT role FROM book_members WHERE book_id = ? AND user_id = ?').get(bookId, userId);
  }
  function requireBook(user, bookId) {
    const m = membership(bookId, user.id);
    if (!m) throw new HttpError(404, '家計簿が見つかりません');
    return m;
  }

  // 同一メール+IPの総当たり対策 (簡易)
  const fails = new Map();
  function checkRate(key) {
    const f = fails.get(key);
    if (f && f.n >= 8 && Date.now() - f.t < 10 * 60 * 1000) throw new HttpError(429, '試行回数が多すぎます。しばらくしてからやり直してください');
  }
  function noteFail(key) {
    const f = fails.get(key);
    fails.set(key, f && Date.now() - f.t < 10 * 60 * 1000 ? { n: f.n + 1, t: f.t } : { n: 1, t: Date.now() });
  }

  const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) &&
    new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;
  const isMonth = (s) => typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
  const str = (v, max, label, { required = true } = {}) => {
    const s = typeof v === 'string' ? v.trim() : '';
    if (required && !s) throw bad(`${label}を入力してください`);
    if (s.length > max) throw bad(`${label}は${max}文字以内にしてください`);
    return s;
  };
  const oneOf = (v, list, label) => { if (!list.includes(v)) throw bad(`${label}が不正です`); return v; };
  const money = (v) => {
    if (!Number.isInteger(v) || v < 1 || v > 999_999_999) throw bad('金額は1〜999,999,999の整数で入力してください');
    return v;
  };
  function checkCategory(bookId, categoryId, type) {
    if (categoryId == null) return null;
    const c = q('SELECT type FROM categories WHERE id = ? AND book_id = ?').get(categoryId, bookId);
    if (!c) throw bad('カテゴリが不正です');
    if (c.type !== type) throw bad('カテゴリの種類(収入/支出)が一致しません');
    return categoryId;
  }

  function createBook(userId, name) {
    return tx(db, () => {
      const id = Number(q('INSERT INTO books (name) VALUES (?)').run(name).lastInsertRowid);
      q('INSERT INTO book_members (book_id, user_id, role) VALUES (?, ?, ?)').run(id, userId, 'owner');
      const ins = q('INSERT INTO categories (book_id, type, name, icon, color, sort) VALUES (?, ?, ?, ?, ?, ?)');
      for (const [type, list] of Object.entries(DEFAULT_CATEGORIES)) list.forEach(([n, i, c], idx) => ins.run(id, type, n, i, c, idx));
      return id;
    });
  }

  // ---------- route table ----------
  const routes = [];
  const route = (method, path, handler, { auth = true } = {}) => {
    const keys = [];
    const re = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    routes.push({ method, re, keys, handler, auth });
  };

  // ---- auth ----
  route('POST', '/api/register', async (ctx) => {
    const email = str(ctx.body.email, 200, 'メールアドレス').toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad('メールアドレスの形式が不正です');
    const name = str(ctx.body.name, 40, 'ニックネーム');
    const pw = typeof ctx.body.password === 'string' ? ctx.body.password : '';
    if (pw.length < 8 || pw.length > 200) throw bad('パスワードは8文字以上にしてください');
    if (q('SELECT 1 FROM users WHERE email = ?').get(email)) throw new HttpError(409, 'このメールアドレスは登録済みです');
    const hash = await hashPassword(pw);
    const userId = Number(q('INSERT INTO users (email, name, pass_hash) VALUES (?, ?, ?)').run(email, name, hash).lastInsertRowid);
    const bookId = createBook(userId, `${name}の家計簿`);
    startSession(ctx.res, ctx.req, userId);
    return { user: { id: userId, email, name }, bookId };
  }, { auth: false });

  route('POST', '/api/login', async (ctx) => {
    const email = str(ctx.body.email, 200, 'メールアドレス').toLowerCase();
    const key = `${ctx.req.socket.remoteAddress}|${email}`;
    checkRate(key);
    const u = q('SELECT * FROM users WHERE email = ?').get(email);
    const ok = u && (await verifyPassword(String(ctx.body.password ?? ''), u.pass_hash));
    if (!ok) { noteFail(key); throw new HttpError(401, 'メールアドレスまたはパスワードが違います'); }
    fails.delete(key);
    startSession(ctx.res, ctx.req, u.id);
    return { user: { id: u.id, email: u.email, name: u.name } };
  }, { auth: false });

  route('POST', '/api/logout', (ctx) => {
    const t = parseCookies(ctx.req).sid;
    if (t) q('DELETE FROM sessions WHERE token_hash = ?').run(sha(t));
    ctx.res.setHeader('Set-Cookie', 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
    return { ok: true };
  }, { auth: false });

  route('GET', '/api/me', (ctx) => {
    const books = q(`SELECT b.id, b.name, m.role FROM books b JOIN book_members m ON m.book_id = b.id WHERE m.user_id = ? ORDER BY b.id`).all(ctx.user.id);
    return { user: ctx.user, books };
  });

  // ---- books / sharing ----
  route('POST', '/api/books', (ctx) => {
    const name = str(ctx.body.name, 60, '家計簿名');
    return { id: createBook(ctx.user.id, name), name };
  });

  route('PUT', '/api/books/:id', (ctx) => {
    if (requireBook(ctx.user, +ctx.params.id).role !== 'owner') throw new HttpError(403, 'オーナーのみ変更できます');
    q('UPDATE books SET name = ? WHERE id = ?').run(str(ctx.body.name, 60, '家計簿名'), +ctx.params.id);
    return { ok: true };
  });

  route('POST', '/api/books/:id/invite', (ctx) => {
    const id = +ctx.params.id;
    requireBook(ctx.user, id);
    const code = randomBytes(6).toString('base64url');
    q('INSERT INTO invites (code, book_id, expires_at) VALUES (?, ?, ?)').run(code, id, Date.now() + INVITE_MS);
    return { code, expiresAt: Date.now() + INVITE_MS };
  });

  route('POST', '/api/join', (ctx) => {
    const code = str(ctx.body.code, 40, '招待コード');
    const inv = q('SELECT * FROM invites WHERE code = ?').get(code);
    if (!inv || inv.expires_at < Date.now()) throw new HttpError(404, '招待コードが無効か、期限切れです');
    q('INSERT OR IGNORE INTO book_members (book_id, user_id, role) VALUES (?, ?, ?)').run(inv.book_id, ctx.user.id, 'member');
    return { bookId: inv.book_id };
  });

  route('DELETE', '/api/books/:id/members/:uid', (ctx) => {
    const id = +ctx.params.id, uid = +ctx.params.uid;
    const me = requireBook(ctx.user, id);
    if (uid !== ctx.user.id && me.role !== 'owner') throw new HttpError(403, 'オーナーのみメンバーを削除できます');
    const target = membership(id, uid);
    if (!target) throw new HttpError(404, 'メンバーが見つかりません');
    if (target.role === 'owner') throw bad('オーナーは退出できません');
    q('DELETE FROM book_members WHERE book_id = ? AND user_id = ?').run(id, uid);
    return { ok: true };
  });

  // ---- bootstrap: 起動時に1リクエストで必要なものを全部返す ----
  const listCategories = (bookId) =>
    q('SELECT id, type, name, icon, color, parent_id, sort, archived FROM categories WHERE book_id = ? ORDER BY type, sort, id').all(bookId);
  const listMembers = (bookId) =>
    q(`SELECT u.id, u.name, m.role FROM book_members m JOIN users u ON u.id = m.user_id WHERE m.book_id = ? ORDER BY m.rowid`).all(bookId);
  const listRecurrings = (bookId) => q('SELECT * FROM recurrings WHERE book_id = ? ORDER BY id').all(bookId);
  const monthTx = (bookId, month) =>
    q(`SELECT id, user_id, type, amount, category_id, date, memo, recurring_id FROM transactions
       WHERE book_id = ? AND date >= ? AND date <= ? ORDER BY date DESC, id DESC`).all(bookId, `${month}-01`, `${month}-31`);

  route('GET', '/api/books/:id/bootstrap', (ctx) => {
    const id = +ctx.params.id;
    requireBook(ctx.user, id);
    const month = ctx.query.get('month') || today().slice(0, 7);
    if (!isMonth(month)) throw bad('月の指定が不正です');
    materialize(db, id);
    return {
      book: q('SELECT id, name FROM books WHERE id = ?').get(id),
      month,
      categories: listCategories(id),
      members: listMembers(id),
      recurrings: listRecurrings(id),
      transactions: monthTx(id, month),
    };
  });

  route('GET', '/api/books/:id/transactions', (ctx) => {
    const id = +ctx.params.id;
    requireBook(ctx.user, id);
    const month = ctx.query.get('month');
    if (!isMonth(month)) throw bad('月の指定が不正です');
    materialize(db, id);
    return { month, transactions: monthTx(id, month) };
  });

  // ---- 検索 (メモ / カテゴリ名 / 金額 / 期間 / 種類) ----
  route('GET', '/api/books/:id/search', (ctx) => {
    const id = +ctx.params.id;
    requireBook(ctx.user, id);
    materialize(db, id);
    const where = ['t.book_id = ?'];
    const args = [id];
    const text = (ctx.query.get('q') || '').trim().slice(0, 100);
    for (const term of text.split(/\s+/).filter(Boolean).slice(0, 5)) {
      const like = `%${term.replace(/[\\%_]/g, '\\$&')}%`;
      const num = /^[\d,]+$/.test(term) ? Number(term.replace(/,/g, '')) : null;
      where.push(`(t.memo LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\' OR p.name LIKE ? ESCAPE '\\'${num != null ? ' OR t.amount = ?' : ''})`);
      args.push(like, like, like);
      if (num != null) args.push(num);
    }
    const type = ctx.query.get('type');
    if (type) { oneOf(type, ['expense', 'income'], '種類'); where.push('t.type = ?'); args.push(type); }
    const cat = ctx.query.get('category');
    if (cat) { where.push('(t.category_id = ? OR c.parent_id = ?)'); args.push(+cat, +cat); }
    for (const [k, op] of [['from', '>='], ['to', '<=']]) {
      const v = ctx.query.get(k);
      if (v) { if (!isDate(v)) throw bad('日付が不正です'); where.push(`t.date ${op} ?`); args.push(v); }
    }
    for (const [k, op] of [['min', '>='], ['max', '<=']]) {
      const v = ctx.query.get(k);
      if (v) { if (!/^\d{1,9}$/.test(v)) throw bad('金額が不正です'); where.push(`t.amount ${op} ?`); args.push(+v); }
    }
    const limit = Math.min(Math.max(+ctx.query.get('limit') || 50, 1), 200);
    const offset = Math.max(+ctx.query.get('offset') || 0, 0);
    const sql = `FROM transactions t
      LEFT JOIN categories c ON c.id = t.category_id
      LEFT JOIN categories p ON p.id = c.parent_id
      WHERE ${where.join(' AND ')}`;
    const rows = q(`SELECT t.id, t.user_id, t.type, t.amount, t.category_id, t.date, t.memo, t.recurring_id ${sql}
                    ORDER BY t.date DESC, t.id DESC LIMIT ? OFFSET ?`).all(...args, limit, offset);
    const agg = q(`SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN t.type='expense' THEN t.amount END),0) AS expense,
                          COALESCE(SUM(CASE WHEN t.type='income' THEN t.amount END),0) AS income ${sql}`).get(...args);
    return { results: rows, total: Number(agg.n), expense: Number(agg.expense), income: Number(agg.income) };
  });

  // ---- transactions CRUD ----
  function txInput(bookId, b) {
    const type = oneOf(b.type, ['expense', 'income'], '種類');
    if (!isDate(b.date)) throw bad('日付が不正です');
    return {
      type, date: b.date, amount: money(b.amount),
      category_id: checkCategory(bookId, b.category_id ?? null, type),
      memo: str(b.memo ?? '', 200, 'メモ', { required: false }),
    };
  }
  route('POST', '/api/books/:id/transactions', (ctx) => {
    const id = +ctx.params.id;
    requireBook(ctx.user, id);
    const t = txInput(id, ctx.body);
    const r = q(`INSERT INTO transactions (book_id, user_id, type, amount, category_id, date, memo) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(id, ctx.user.id, t.type, t.amount, t.category_id, t.date, t.memo);
    return { id: Number(r.lastInsertRowid) };
  });
  route('PUT', '/api/books/:id/transactions/:tid', (ctx) => {
    const id = +ctx.params.id;
    requireBook(ctx.user, id);
    const t = txInput(id, ctx.body);
    const r = q(`UPDATE transactions SET type=?, amount=?, category_id=?, date=?, memo=? WHERE id=? AND book_id=?`)
      .run(t.type, t.amount, t.category_id, t.date, t.memo, +ctx.params.tid, id);
    if (!r.changes) throw new HttpError(404, '取引が見つかりません');
    return { ok: true };
  });
  route('DELETE', '/api/books/:id/transactions/:tid', (ctx) => {
    const id = +ctx.params.id;
    requireBook(ctx.user, id);
    const r = q('DELETE FROM transactions WHERE id = ? AND book_id = ?').run(+ctx.params.tid, id);
    if (!r.changes) throw new HttpError(404, '取引が見つかりません');
    return { ok: true };
  });

  // ---- categories (無制限・階層) ----
  function catInput(bookId, b, selfId = null, fixedType = null) {
    const type = fixedType ?? oneOf(b.type, ['expense', 'income'], '種類');
    let parent = b.parent_id ?? null;
    if (parent != null) {
      const p = q('SELECT id, type FROM categories WHERE id = ? AND book_id = ?').get(parent, bookId);
      if (!p || p.type !== type) throw bad('親カテゴリが不正です');
      for (let cur = p.id, i = 0; cur != null && i < 1000; i++) { // 循環防止
        if (cur === selfId) throw bad('自分の子孫を親にはできません');
        cur = q('SELECT parent_id FROM categories WHERE id = ?').get(cur)?.parent_id ?? null;
      }
    }
    const color = typeof b.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(b.color) ? b.color : '#8e8e93';
    return { type, parent, color, name: str(b.name, 40, 'カテゴリ名'), icon: str(b.icon || '🏷️', 8, 'アイコン') };
  }
  route('POST', '/api/books/:id/categories', (ctx) => {
    const id = +ctx.params.id;
    requireBook(ctx.user, id);
    const c = catInput(id, ctx.body);
    const sort = q('SELECT COALESCE(MAX(sort),-1)+1 AS s FROM categories WHERE book_id = ? AND type = ?').get(id, c.type).s;
    const r = q('INSERT INTO categories (book_id, type, name, icon, color, parent_id, sort) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, c.type, c.name, c.icon, c.color, c.parent, sort);
    return { id: Number(r.lastInsertRowid) };
  });
  route('PUT', '/api/books/:id/categories/:cid', (ctx) => {
    const id = +ctx.params.id, cid = +ctx.params.cid;
    requireBook(ctx.user, id);
    const cur = q('SELECT type FROM categories WHERE id = ? AND book_id = ?').get(cid, id);
    if (!cur) throw new HttpError(404, 'カテゴリが見つかりません');
    const c = catInput(id, ctx.body, cid, cur.type); // 種類は変更不可 (既存取引との整合性のため)
    const archived = ctx.body.archived ? 1 : 0;
    const sort = Number.isInteger(ctx.body.sort) ? ctx.body.sort : q('SELECT sort FROM categories WHERE id = ?').get(cid).sort;
    q('UPDATE categories SET name=?, icon=?, color=?, parent_id=?, archived=?, sort=? WHERE id=? AND book_id=?')
      .run(c.name, c.icon, c.color, c.parent, archived, sort, cid, id);
    return { ok: true };
  });
  route('PUT', '/api/books/:id/categories-order', (ctx) => {
    const id = +ctx.params.id;
    requireBook(ctx.user, id);
    const ids = Array.isArray(ctx.body.ids) ? ctx.body.ids : [];
    const upd = q('UPDATE categories SET sort = ? WHERE id = ? AND book_id = ?');
    tx(db, () => ids.forEach((cid, i) => { if (Number.isInteger(cid)) upd.run(i, cid, id); }));
    return { ok: true };
  });
  route('DELETE', '/api/books/:id/categories/:cid', (ctx) => {
    const id = +ctx.params.id, cid = +ctx.params.cid;
    requireBook(ctx.user, id);
    const cur = q('SELECT parent_id FROM categories WHERE id = ? AND book_id = ?').get(cid, id);
    if (!cur) throw new HttpError(404, 'カテゴリが見つかりません');
    const used = q('SELECT 1 FROM transactions WHERE category_id = ? LIMIT 1').get(cid) || q('SELECT 1 FROM recurrings WHERE category_id = ? LIMIT 1').get(cid);
    return tx(db, () => {
      q('UPDATE categories SET parent_id = ? WHERE parent_id = ? AND book_id = ?').run(cur.parent_id, cid, id); // 子は親の親へ
      if (used) { q('UPDATE categories SET archived = 1 WHERE id = ?').run(cid); return { archived: true }; }
      q('DELETE FROM categories WHERE id = ?').run(cid);
      return { deleted: true };
    });
  });

  // ---- recurrings ----
  function recInput(bookId, b) {
    const type = oneOf(b.type, ['expense', 'income'], '種類');
    if (!isDate(b.start_date)) throw bad('開始日が不正です');
    if (b.end_date != null && b.end_date !== '' && (!isDate(b.end_date) || b.end_date < b.start_date)) throw bad('終了日が不正です');
    const every = Number.isInteger(b.every) && b.every >= 1 && b.every <= 365 ? b.every : 1;
    return {
      type, amount: money(b.amount), every, start_date: b.start_date, end_date: b.end_date || null,
      freq: oneOf(b.freq, ['daily', 'weekly', 'monthly', 'yearly'], '頻度'),
      category_id: checkCategory(bookId, b.category_id ?? null, type),
      memo: str(b.memo ?? '', 200, 'メモ', { required: false }),
    };
  }
  route('POST', '/api/books/:id/recurrings', (ctx) => {
    const id = +ctx.params.id;
    requireBook(ctx.user, id);
    const r = recInput(id, ctx.body);
    const rid = Number(q(`INSERT INTO recurrings (book_id, user_id, type, amount, category_id, memo, freq, every, start_date, end_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, ctx.user.id, r.type, r.amount, r.category_id, r.memo, r.freq, r.every, r.start_date, r.end_date).lastInsertRowid);
    materialize(db, id);
    return { id: rid };
  });
  route('PUT', '/api/books/:id/recurrings/:rid', (ctx) => {
    const id = +ctx.params.id, rid = +ctx.params.rid;
    requireBook(ctx.user, id);
    const old = q('SELECT * FROM recurrings WHERE id = ? AND book_id = ?').get(rid, id);
    if (!old) throw new HttpError(404, '繰り返し設定が見つかりません');
    const r = recInput(id, ctx.body);
    // 日付ルールが変わったら、生成済みの取引は残して切り離し、今日以降の分だけ新ルールで展開する
    const scheduleChanged = r.freq !== old.freq || r.every !== old.every || r.start_date !== old.start_date;
    tx(db, () => {
      q(`UPDATE recurrings SET type=?, amount=?, category_id=?, memo=?, freq=?, every=?, start_date=?, end_date=?, active=? WHERE id=?`)
        .run(r.type, r.amount, r.category_id, r.memo, r.freq, r.every, r.start_date, r.end_date, ctx.body.active === false ? 0 : 1, rid);
      if (scheduleChanged) {
        q('UPDATE transactions SET recurring_id = NULL WHERE recurring_id = ?').run(rid);
        let n = 0;
        const now = today();
        while (occurrence(r, n) < now && n < 100000) n++;
        q('UPDATE recurrings SET next_n = ? WHERE id = ?').run(n, rid);
      }
    });
    materialize(db, id);
    return { ok: true };
  });
  route('DELETE', '/api/books/:id/recurrings/:rid', (ctx) => {
    const id = +ctx.params.id;
    requireBook(ctx.user, id);
    const r = q('DELETE FROM recurrings WHERE id = ? AND book_id = ?').run(+ctx.params.rid, id);
    if (!r.changes) throw new HttpError(404, '繰り返し設定が見つかりません');
    return { ok: true };
  });

  // ---------- static (起動高速化: メモリ常駐 + gzip + ETag) ----------
  const staticCache = new Map();
  function loadStatic(rel) {
    const hit = staticCache.get(rel);
    if (hit) return hit;
    const full = normalize(join(publicDir, rel));
    if (!full.startsWith(publicDir + sep) || !existsSync(full) || !statSync(full).isFile()) return null;
    const raw = readFileSync(full);
    const ext = extname(full);
    const entry = {
      type: MIME[ext] || 'application/octet-stream', raw,
      gz: ['.html', '.js', '.css', '.json', '.svg', '.webmanifest'].includes(ext) ? gzipSync(raw, { level: 9 }) : null,
      etag: `"${sha(raw.toString('binary')).slice(0, 16)}"`,
    };
    if (process.env.NODE_ENV === 'production') staticCache.set(rel, entry);
    return entry;
  }
  function serveStatic(req, res, pathname) {
    let rel = decodeURIComponent(pathname).replace(/^\/+/, '') || 'index.html';
    let e = loadStatic(rel);
    if (!e && !extname(rel)) e = loadStatic('index.html'); // SPA フォールバック
    if (!e) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    const headers = { 'Content-Type': e.type, ETag: e.etag, 'Cache-Control': 'no-cache', Vary: 'Accept-Encoding' };
    if (req.headers['if-none-match'] === e.etag) { res.writeHead(304, headers); return res.end(); }
    if (e.gz && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
      res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip', 'Content-Length': e.gz.length });
      return res.end(e.gz);
    }
    res.writeHead(200, { ...headers, 'Content-Length': e.raw.length });
    res.end(e.raw);
  }

  // ---------- server ----------
  async function readJson(req) {
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > 100_000) throw new HttpError(413, 'リクエストが大きすぎます');
      chunks.push(c);
    }
    if (!size) return {};
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw bad('JSON が不正です'); }
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://x');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'");
    if (!url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
      return serveStatic(req, res, url.pathname);
    }
    const send = (status, data) => {
      const body = JSON.stringify(data);
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(body);
    };
    try {
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = r.re.exec(url.pathname);
        if (!m) continue;
        const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
        let body = {};
        if (req.method !== 'GET') {
          // CSRF 対策: JSON 以外の Content-Type (フォーム送信) は拒否
          if (!/^application\/json/.test(req.headers['content-type'] || '') && req.method !== 'DELETE') throw bad('Content-Type が不正です');
          body = await readJson(req);
        }
        const user = r.auth ? currentUser(req) : null;
        if (r.auth && !user) throw new HttpError(401, 'ログインしてください');
        const out = await r.handler({ req, res, user, params, query: url.searchParams, body });
        return send(200, out);
      }
      throw new HttpError(404, 'Not found');
    } catch (e) {
      if (e instanceof HttpError) return send(e.status, { error: e.message });
      console.error(e);
      send(500, { error: 'サーバーエラーが発生しました' });
    }
  }

  const server = createServer((req, res) => { handle(req, res); });
  // 期限切れセッション/招待の掃除
  const sweeper = setInterval(() => {
    q('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
    q('DELETE FROM invites WHERE expires_at < ?').run(Date.now());
  }, 3600 * 1000);
  sweeper.unref();
  server.on('close', () => { clearInterval(sweeper); db.close(); });
  return server;
}
