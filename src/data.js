// Firebase (Auth + Firestore) とのやりとりをここに集約する。
// 画面側 (app.js) は初回描画のあとでこのファイルを動的 import する (起動を速くするため)。
import { initializeApp } from 'firebase/app';
import {
  initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, connectAuthEmulator,
  createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, updateProfile,
} from 'firebase/auth';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, connectFirestoreEmulator,
  collection, doc, query, where, orderBy, limit, onSnapshot, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
  writeBatch, runTransaction, serverTimestamp, Timestamp,
} from 'firebase/firestore';
import { firebaseConfig } from './firebase-config.js';
import { dueOccurrences, firstFutureN, today } from './lib/recurring.js';

// icon は src/lib/icons.js のキー
const DEFAULT_CATEGORIES = {
  expense: [
    ['食費', 'utensils', '#e8890c'], ['日用品', 'bag', '#3aa76d'], ['交通費', 'bus', '#2d9cdb'],
    ['住居', 'home', '#8b5cf6'], ['水道光熱費', 'zap', '#d4a017'], ['通信費', 'phone', '#3b6cf6'],
    ['趣味・娯楽', 'gamepad', '#e5484d'], ['衣服・美容', 'shirt', '#d6409f'], ['健康・医療', 'heart', '#0ea5a0'],
    ['教育・教養', 'book', '#92704f'], ['特別な支出', 'gift', '#f2603a'], ['その他', 'tag', '#8a8b91'],
  ],
  income: [['給与', 'banknote', '#3aa76d'], ['賞与', 'star', '#d4a017'], ['副収入', 'briefcase', '#2d9cdb'], ['その他', 'tag', '#8a8b91']],
};
const INVITE_MS = 7 * 24 * 3600 * 1000;

const app = initializeApp(firebaseConfig);
const auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] });
// localhost + ?emulator=1 のときだけエミュレータに接続 (開発・E2Eテスト用)
if (new URLSearchParams(location.search).get('emulator') === '1') sessionStorage.setItem('md:emu', '1');
const useEmu = ['localhost', '127.0.0.1'].includes(location.hostname) && sessionStorage.getItem('md:emu') === '1';
const db = initializeFirestore(app, useEmu ? {} : { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
if (useEmu) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}

const col = (b, name) => collection(db, 'books', b, name);
const bookDoc = (b) => doc(db, 'books', b);

export function friendly(e) {
  const m = {
    'auth/invalid-credential': 'メールアドレスまたはパスワードが違います',
    'auth/wrong-password': 'メールアドレスまたはパスワードが違います',
    'auth/user-not-found': 'メールアドレスまたはパスワードが違います',
    'auth/invalid-email': 'メールアドレスの形式が不正です',
    'auth/email-already-in-use': 'このメールアドレスは登録済みです',
    'auth/weak-password': 'パスワードは8文字以上にしてください',
    'auth/too-many-requests': '試行回数が多すぎます。しばらくしてからやり直してください',
    'auth/network-request-failed': '通信できません。ネットワークを確認してください',
    'permission-denied': '権限がありません',
    unavailable: 'オフラインです。接続後に反映されます',
  }[e?.code];
  return m || e?.message || 'エラーが発生しました';
}

// ---------- 認証 ----------
export const onUser = (cb) => onAuthStateChanged(auth, (u) => cb(u ? { id: u.uid, email: u.email, name: u.displayName || u.email.split('@')[0] } : null));
export const currentUser = () => auth.currentUser && { id: auth.currentUser.uid, name: auth.currentUser.displayName || '' };

export async function register(email, password, name) {
  if (password.length < 8) throw Object.assign(new Error(), { code: 'auth/weak-password' });
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(cred.user, { displayName: name });
  return createBook(`${name}の家計簿`);
}
export const login = (email, password) => signInWithEmailAndPassword(auth, email, password);
export const logout = () => signOut(auth);

// ---------- 家計簿 / 共有 ----------
const me = () => ({ uid: auth.currentUser.uid, name: auth.currentUser.displayName || 'ユーザー' });

export async function createBook(name) {
  const { uid, name: userName } = me();
  const ref = doc(collection(db, 'books'));
  // 家計簿とオーナー登録は同時に書く (ルールが getAfter で整合性を検証する)
  const b = writeBatch(db);
  b.set(ref, { name, ownerId: uid, createdAt: serverTimestamp() });
  b.set(doc(ref, 'members', uid), { role: 'owner', name: userName });
  b.set(doc(db, 'users', uid, 'memberships', ref.id), { name, role: 'owner' });
  await b.commit();
  const c = writeBatch(db);
  for (const [type, list] of Object.entries(DEFAULT_CATEGORIES)) {
    list.forEach(([n, icon, color], i) => c.set(doc(collection(ref, 'categories')), { name: n, type, icon, color, parentId: null, sort: i, archived: false }));
  }
  await c.commit();
  return ref.id;
}

/** 自分が参加している家計簿。削除された/外された家計簿の記録は掃除する。 */
export async function listBooks() {
  const { uid } = me();
  const snap = await getDocs(collection(db, 'users', uid, 'memberships'));
  const out = await Promise.all(snap.docs.map(async (d) => {
    try {
      const b = await getDoc(bookDoc(d.id));
      if (!b.exists()) return null;
      return { id: d.id, name: b.data().name, role: d.data().role };
    } catch (e) {
      if (e.code === 'permission-denied') { deleteDoc(d.ref).catch(() => {}); return null; }
      return { id: d.id, name: d.data().name, role: d.data().role }; // オフライン時は保存済みの名前
    }
  }));
  return out.filter(Boolean).sort((a, b) => a.id.localeCompare(b.id));
}

export async function renameBook(bookId, name) {
  await updateDoc(bookDoc(bookId), { name });
  await updateDoc(doc(db, 'users', me().uid, 'memberships', bookId), { name }).catch(() => {});
}

export async function createInvite(bookId, bookName) {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  const code = Array.from(bytes, (x) => 'abcdefghjkmnpqrstuvwxyz23456789'[x % 31]).join('');
  const expires = Date.now() + INVITE_MS;
  await setDoc(doc(db, 'invites', code), { bookId, bookName, expiresAt: Timestamp.fromMillis(expires), createdBy: me().uid });
  return { code, expiresAt: expires };
}

export async function joinBook(code) {
  const { uid, name } = me();
  const inv = await getDoc(doc(db, 'invites', code.trim())).catch(() => null);
  if (!inv?.exists() || inv.data().expiresAt.toMillis() < Date.now()) throw new Error('招待コードが無効か、期限切れです');
  const { bookId, bookName } = inv.data();
  const already = await getDoc(doc(db, 'books', bookId, 'members', uid)).then((s) => s.exists()).catch(() => false);
  const b = writeBatch(db);
  if (!already) b.set(doc(db, 'books', bookId, 'members', uid), { role: 'member', name, code: code.trim() });
  b.set(doc(db, 'users', uid, 'memberships', bookId), { name: bookName, role: 'member' });
  await b.commit();
  return bookId;
}

/** 表示名を変更する。ログイン情報と、参加しているすべての家計簿のメンバー情報を更新する。 */
export async function updateName(name, bookIds) {
  await updateProfile(auth.currentUser, { displayName: name });
  const uid = auth.currentUser.uid;
  await Promise.allSettled(bookIds.map((b) => updateDoc(doc(db, 'books', b, 'members', uid), { name })));
}

export async function removeMember(bookId, userId) {
  await deleteDoc(doc(db, 'books', bookId, 'members', userId));
  if (userId === me().uid) await deleteDoc(doc(db, 'users', userId, 'memberships', bookId)).catch(() => {});
}

// ---------- リアルタイム購読 ----------
const withId = (d) => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) });
const txOf = (d) => { const t = withId(d); t.createdAt = t.createdAt?.toMillis?.() ?? Date.now(); return t; };
const sortTx = (list) => list.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt - a.createdAt));

export function watchBook(bookId, h) {
  const err = (e) => h.error?.(e);
  const subs = [
    onSnapshot(col(bookId, 'categories'), (s) => h.categories(s.docs.map(withId).sort((a, b) => a.sort - b.sort)), err),
    onSnapshot(col(bookId, 'members'), (s) => h.members(s.docs.map((d) => ({ id: d.id, ...d.data() }))), err),
    onSnapshot(col(bookId, 'recurrings'), (s) => h.recurrings(s.docs.map(withId)), err),
    onSnapshot(doc(db, 'books', bookId, 'meta', 'budget'), (s) => h.budget(s.exists() ? s.data().monthly : 0), err),
  ];
  return () => subs.forEach((u) => u());
}
export function watchMonth(bookId, month, cb, errCb) {
  const q = query(col(bookId, 'transactions'), where('date', '>=', `${month}-01`), where('date', '<=', `${month}-31`), orderBy('date', 'desc'));
  return onSnapshot(q, (s) => cb(sortTx(s.docs.map(txOf))), errCb);
}
export function watchAll(bookId, cb, errCb) {
  return onSnapshot(col(bookId, 'transactions'), (s) => cb(sortTx(s.docs.map(txOf))), errCb);
}

// ---------- 月の予算 (家計簿ごとに1つ。0 で解除) ----------
export function setBudget(bookId, amount) {
  const ref = doc(db, 'books', bookId, 'meta', 'budget');
  return amount > 0 ? setDoc(ref, { monthly: amount }) : deleteDoc(ref);
}

// ---------- 取引 ----------
export function saveTx(bookId, id, t) {
  const fields = { type: t.type, amount: t.amount, categoryId: t.categoryId ?? null, date: t.date, memo: t.memo || '', fx: t.fx ?? null }; // fx: 外貨で入力したときの元の通貨・金額・レート
  if (id) return updateDoc(doc(col(bookId, 'transactions'), id), fields);
  return setDoc(doc(col(bookId, 'transactions')), { ...fields, userId: me().uid, recurringId: null, createdAt: serverTimestamp() });
}
export const deleteTx = (bookId, id) => deleteDoc(doc(col(bookId, 'transactions'), id));

// ---------- カテゴリ (無制限・階層) ----------
export function saveCategory(bookId, id, c) {
  const fields = { name: c.name, type: c.type, icon: c.icon || 'tag', color: c.color, parentId: c.parentId ?? null, sort: c.sort ?? 0, archived: !!c.archived };
  return id ? setDoc(doc(col(bookId, 'categories'), id), fields) : setDoc(doc(col(bookId, 'categories')), fields);
}
export function reorderCategories(bookId, ids) {
  const b = writeBatch(db);
  ids.forEach((id, i) => b.update(doc(col(bookId, 'categories'), id), { sort: i }));
  return b.commit();
}
/** 使用中ならアーカイブ、未使用なら削除。子カテゴリは親の親へ付け替える。 */
export async function deleteCategory(bookId, cat, childIds) {
  let used = true; // 確認できない(オフライン等)ときは安全側 = アーカイブ
  try {
    const [t, r] = await Promise.all([
      getDocs(query(col(bookId, 'transactions'), where('categoryId', '==', cat.id), limit(1))),
      getDocs(query(col(bookId, 'recurrings'), where('categoryId', '==', cat.id), limit(1))),
    ]);
    used = !t.empty || !r.empty;
  } catch { /* keep used = true */ }
  const b = writeBatch(db);
  childIds.forEach((id) => b.update(doc(col(bookId, 'categories'), id), { parentId: cat.parentId ?? null }));
  if (used) b.update(doc(col(bookId, 'categories'), cat.id), { archived: true });
  else b.delete(doc(col(bookId, 'categories'), cat.id));
  await b.commit();
  return { archived: used };
}

// ---------- 繰り返し ----------
export async function saveRecurring(bookId, id, r, prev = null) {
  const fields = {
    type: r.type, amount: r.amount, categoryId: r.categoryId ?? null, memo: r.memo || '', freq: r.freq, every: r.every || 1,
    startDate: r.startDate, endDate: r.endDate || null, active: r.active !== false,
  };
  if (!id) {
    await setDoc(doc(col(bookId, 'recurrings')), { ...fields, userId: me().uid, nextN: 0 });
    return;
  }
  // 日付ルールを変えたら、生成済みの過去分は残して、今日以降を新ルールで作り直す
  const changed = !prev || prev.freq !== fields.freq || prev.every !== fields.every || prev.startDate !== fields.startDate;
  await updateDoc(doc(col(bookId, 'recurrings'), id), { ...fields, userId: prev?.userId ?? me().uid, nextN: changed ? firstFutureN(fields) : prev.nextN });
}
/**
 * 既存の記録を「1回目」として、繰り返しを新しく作る。
 * 記録の更新 + 繰り返しの作成 + 記録との紐づけを、1つのバッチで同時に書く。
 * nextN=1 から始めるので、1回目 (この記録) と同じ日の記録が二重に作られることはない。
 */
export async function saveTxAsRecurring(bookId, txId, t, r) {
  const recRef = doc(col(bookId, 'recurrings'));
  const b = writeBatch(db);
  b.set(recRef, {
    type: t.type, amount: t.amount, categoryId: t.categoryId ?? null, memo: t.memo || '', freq: r.freq, every: r.every || 1,
    startDate: t.date, endDate: r.endDate || null, active: true, userId: me().uid, nextN: 1,
  });
  b.update(doc(col(bookId, 'transactions'), txId), { type: t.type, amount: t.amount, categoryId: t.categoryId ?? null, date: t.date, memo: t.memo || '', recurringId: recRef.id });
  await b.commit();
  return recRef.id;
}

/**
 * 繰り返しから作られた項目 (記録 または 予定) を変更する。
 *  scope='one'       : この項目だけ変更。予定 (まだ記録されていない) なら、その1回分だけ別の内容で記録する。
 *  scope='following' : この項目以降すべて。繰り返し設定 (今後の記録・予定) と、すでにある以降の記録をまとめて変更する。
 *                      日付は変更しない (繰り返しの日付は設定の開始日で決まるため)。
 * item: { id, date, scheduled?, recurringId } / f: { type, amount, categoryId, memo, date } / rec: 元の繰り返し設定
 */
export async function saveOccurrence(bookId, item, f, scope, rec) {
  const fields = { type: f.type, amount: f.amount, categoryId: f.categoryId ?? null, memo: f.memo || '' };
  const txCol = col(bookId, 'transactions');
  if (scope === 'one') {
    if (item.scheduled) {
      // 日付が来たときに自動記録で上書きされないよう、予定の元の日付で決まる ID で作る (記録処理は、すでにある記録を残す)
      return setDoc(doc(txCol, `r_${rec.id}_${item.date}`), { ...fields, userId: rec.userId, date: f.date, recurringId: rec.id, createdAt: serverTimestamp() });
    }
    return updateDoc(doc(txCol, item.id), { ...fields, date: f.date });
  }
  // これ以降すべて: 繰り返し設定 + すでにある「この日付以降」の記録
  const snap = await getDocs(query(txCol, where('recurringId', '==', rec.id)));
  const targets = snap.docs.filter((d) => d.data().date >= item.date).map((d) => d.ref);
  if (!item.scheduled && !targets.some((r) => r.id === item.id)) targets.push(doc(txCol, item.id));
  const ops = [(b) => b.update(doc(col(bookId, 'recurrings'), rec.id), fields), ...targets.map((ref) => (b) => b.update(ref, fields))];
  for (let i = 0; i < ops.length; i += 400) { // 1回のバッチは500件まで
    const b = writeBatch(db);
    ops.slice(i, i + 400).forEach((op) => op(b));
    await b.commit();
  }
}

export const deleteRecurring = (bookId, id) => deleteDoc(doc(col(bookId, 'recurrings'), id));

/**
 * 今日までの繰り返し分を取引として展開する。
 * recurring ごとにトランザクションで「取引の作成 + nextN の更新」を同時に行うので、
 * 複数人が同時に開いても二重登録されず、編集・削除した取引が復活することもない。
 */
let materializeChain = Promise.resolve();
export function materialize(bookId, recurrings) {
  // 同時に複数のトランザクションが走ると片方が衝突してやり直しになるので、1つずつ順番に実行する
  const run = () => materializeNow(bookId, recurrings);
  materializeChain = materializeChain.then(run, run);
  return materializeChain;
}

async function materializeNow(bookId, recurrings) {
  let made = 0;
  for (const r of recurrings.filter((x) => x.active)) {
    for (let guard = 0; guard < 50; guard++) {
      const n = await runTransaction(db, async (t) => {
        const ref = doc(col(bookId, 'recurrings'), r.id);
        const snap = await t.get(ref);
        if (!snap.exists()) return 0;
        const rec = snap.data();
        if (!rec.active) return 0;
        const { due, nextN } = dueOccurrences(rec, today(), 400);
        if (!due.length) return 0;
        // 「この項目のみ」変更して先に作られている記録は、上書きせず残す (読み取りは、書き込みより先に行う)
        const refs = due.map(({ date }) => doc(col(bookId, 'transactions'), `r_${r.id}_${date}`));
        const exists = (await Promise.all(refs.map((x) => t.get(x)))).map((x) => x.exists());
        due.forEach(({ date }, i) => {
          if (exists[i]) return;
          t.set(refs[i], {
            userId: rec.userId, type: rec.type, amount: rec.amount, categoryId: rec.categoryId ?? null,
            date, memo: rec.memo || '', recurringId: r.id, createdAt: serverTimestamp(),
          });
        });
        t.update(ref, { nextN });
        return due.length;
      }).catch(() => -1); // オフライン等: 次回起動時にやり直す
      if (n <= 0) break;
      made += n;
      if (n < 400) break;
    }
  }
  return made;
}
