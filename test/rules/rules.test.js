import { test, before, after, beforeEach } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, collection, getDocs, setDoc, getDoc, deleteDoc, updateDoc, writeBatch, Timestamp } from 'firebase/firestore';

let env;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-money-diary',
    firestore: { rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});
after(() => env.cleanup());
beforeEach(() => env.clearFirestore());

const db = (uid) => env.authenticatedContext(uid).firestore();
const anon = () => env.unauthenticatedContext().firestore();
const future = (days = 1) => Timestamp.fromMillis(Date.now() + days * 86400000);

// alice が家計簿 b1 を作成 (アプリと同じ手順: book + owner member を1バッチ)
async function seedBook(owner = 'alice', b = 'b1') {
  const d = db(owner);
  const batch = writeBatch(d);
  batch.set(doc(d, 'books', b), { name: '家計簿', ownerId: owner, createdAt: Timestamp.now() });
  batch.set(doc(d, 'books', b, 'members', owner), { role: 'owner', name: 'Alice' });
  await assertSucceeds(batch.commit());
}
const tx = (o = {}) => ({ userId: 'alice', type: 'expense', amount: 1200, categoryId: null, date: '2024-05-03', memo: 'ランチ', recurringId: null, createdAt: Timestamp.now(), ...o });

test('家計簿の作成: ownerId は自分だけ / 他人を owner にはできない', async () => {
  await seedBook();
  const m = db('mallory');
  const batch = writeBatch(m);
  batch.set(doc(m, 'books', 'b9'), { name: 'x', ownerId: 'alice', createdAt: Timestamp.now() });
  await assertFails(batch.commit());
  // 他人の家計簿に owner として自分を追加
  await assertFails(setDoc(doc(m, 'books', 'b1', 'members', 'mallory'), { role: 'owner', name: 'M' }));
});

test('未ログイン・非メンバーは読み書きできない', async () => {
  await seedBook();
  await assertFails(getDoc(doc(anon(), 'books', 'b1')));
  await assertFails(getDoc(doc(db('bob'), 'books', 'b1')));
  await assertFails(setDoc(doc(db('bob'), 'books', 'b1', 'transactions', 't1'), tx({ userId: 'bob' })));
  await assertSucceeds(getDoc(doc(db('alice'), 'books', 'b1')));
});

test('招待: 有効なコードで本人だけ参加できる / 期限切れ・別の家計簿のコードは不可', async () => {
  await seedBook();
  await seedBook('carol', 'b2');
  const a = db('alice');
  await assertSucceeds(setDoc(doc(a, 'invites', 'GOOD'), { bookId: 'b1', bookName: '家計簿', expiresAt: future(), createdBy: 'alice' }));
  await assertFails(setDoc(doc(a, 'invites', 'LONG'), { bookId: 'b1', bookName: '家計簿', expiresAt: future(30), createdBy: 'alice' })); // 8日超
  await assertFails(setDoc(doc(db('bob'), 'invites', 'EVIL'), { bookId: 'b1', bookName: '家計簿', expiresAt: future(), createdBy: 'bob' })); // 非メンバーは発行不可
  await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), 'invites', 'OLD'), { bookId: 'b1', bookName: '家計簿', expiresAt: Timestamp.fromMillis(Date.now() - 1000), createdBy: 'alice' }));

  const bob = db('bob');
  await assertFails(setDoc(doc(bob, 'books', 'b1', 'members', 'bob'), { role: 'member', name: 'Bob', code: 'OLD' }));
  await assertFails(setDoc(doc(bob, 'books', 'b1', 'members', 'bob'), { role: 'member', name: 'Bob', code: 'NOPE' }));
  await assertFails(setDoc(doc(bob, 'books', 'b1', 'members', 'bob'), { role: 'owner', name: 'Bob', code: 'GOOD' }));
  await assertFails(setDoc(doc(db('eve'), 'books', 'b1', 'members', 'bob'), { role: 'member', name: 'Bob', code: 'GOOD' })); // 他人の枠
  await assertSucceeds(getDoc(doc(bob, 'invites', 'GOOD')));
  await assertSucceeds(setDoc(doc(bob, 'books', 'b1', 'members', 'bob'), { role: 'member', name: 'Bob', code: 'GOOD' }));
  // 参加後は読み書きできる
  await assertSucceeds(setDoc(doc(bob, 'books', 'b1', 'transactions', 't1'), tx({ userId: 'bob' })));
  await assertSucceeds(getDoc(doc(bob, 'books', 'b1')));
  // 招待コードは別の家計簿には使えない
  await assertFails(setDoc(doc(bob, 'books', 'b2', 'members', 'bob'), { role: 'member', name: 'Bob', code: 'GOOD' }));
});

test('メンバー削除: オーナーは他人を削除可 / メンバーは自分だけ退出 / オーナーは削除不可', async () => {
  await seedBook();
  await env.withSecurityRulesDisabled(async (c) => {
    await setDoc(doc(c.firestore(), 'books', 'b1', 'members', 'bob'), { role: 'member', name: 'Bob' });
    await setDoc(doc(c.firestore(), 'books', 'b1', 'members', 'dan'), { role: 'member', name: 'Dan' });
  });
  await assertFails(deleteDoc(doc(db('bob'), 'books', 'b1', 'members', 'dan')));
  await assertFails(deleteDoc(doc(db('bob'), 'books', 'b1', 'members', 'alice')));
  await assertFails(deleteDoc(doc(db('alice'), 'books', 'b1', 'members', 'alice')));
  await assertSucceeds(deleteDoc(doc(db('bob'), 'books', 'b1', 'members', 'bob')));
  await assertSucceeds(deleteDoc(doc(db('alice'), 'books', 'b1', 'members', 'dan')));
  await assertFails(getDoc(doc(db('bob'), 'books', 'b1')));
});

test('取引の検証: 不正な金額・日付・種類・余計なフィールドは拒否', async () => {
  await seedBook();
  const t = (id) => doc(db('alice'), 'books', 'b1', 'transactions', id);
  await assertSucceeds(setDoc(t('ok'), tx()));
  await assertFails(setDoc(t('a'), tx({ amount: 0 })));
  await assertFails(setDoc(t('b'), tx({ amount: 1.5 })));
  await assertFails(setDoc(t('c'), tx({ amount: 1e10 })));
  await assertFails(setDoc(t('d'), tx({ date: '2024/05/03' })));
  await assertFails(setDoc(t('e'), tx({ type: 'transfer' })));
  await assertFails(setDoc(t('f'), tx({ memo: 'x'.repeat(201) })));
  await assertFails(setDoc(t('g'), tx({ extra: 1 })));
  await assertFails(setDoc(t('h'), tx({ userId: 'someone-else' }))); // なりすまし
  // 更新で userId を書き換えられない
  await assertFails(updateDoc(t('ok'), { userId: 'bob' }));
  await assertSucceeds(updateDoc(t('ok'), { amount: 2000 }));
  await assertSucceeds(deleteDoc(t('ok')));
});

test('繰り返し・カテゴリの検証と、自動生成の取引 (recurringId 付き) は他メンバー名義でも作成可', async () => {
  await seedBook();
  const a = db('alice');
  const rec = { userId: 'bob', type: 'expense', amount: 80000, categoryId: null, memo: '家賃', freq: 'monthly', every: 1, startDate: '2024-01-31', endDate: null, nextN: 0, active: true };
  await assertSucceeds(setDoc(doc(a, 'books', 'b1', 'recurrings', 'r1'), rec));
  await assertFails(setDoc(doc(a, 'books', 'b1', 'recurrings', 'r2'), { ...rec, freq: 'hourly' }));
  await assertFails(setDoc(doc(a, 'books', 'b1', 'recurrings', 'r3'), { ...rec, every: 0 }));
  await assertSucceeds(setDoc(doc(a, 'books', 'b1', 'transactions', 'r_r1_2024-01-31'), tx({ userId: 'bob', recurringId: 'r1' })));

  const cat = { name: '食費', type: 'expense', icon: '🍚', color: '#ff9500', parentId: null, sort: 0, archived: false };
  await assertSucceeds(setDoc(doc(a, 'books', 'b1', 'categories', 'c1'), cat));
  await assertSucceeds(setDoc(doc(a, 'books', 'b1', 'categories', 'c2'), { ...cat, name: '外食', parentId: 'c1' }));
  await assertFails(setDoc(doc(a, 'books', 'b1', 'categories', 'c3'), { ...cat, color: 'red' }));
  await assertFails(setDoc(doc(a, 'books', 'b1', 'categories', 'c4'), { ...cat, name: '' }));
});

test('メンバーシップ一覧(ミラー)は本人のみ', async () => {
  const m = (u) => doc(db(u), 'users', 'alice', 'memberships', 'b1');
  await assertSucceeds(setDoc(m('alice'), { name: '家計簿', role: 'owner' }));
  await assertFails(setDoc(m('bob'), { name: '家計簿', role: 'owner' }));
  await assertFails(getDoc(m('bob')));
  await assertFails(setDoc(m('alice'), { name: '家計簿', role: 'admin' }));
  await assertSucceeds(getDoc(m('alice')));
  await assertSucceeds(getDocs(collection(db('alice'), 'users', 'alice', 'memberships'))); // 一覧 (listBooks と同じ)
  await assertFails(getDocs(collection(db('bob'), 'users', 'alice', 'memberships')));
  await assertSucceeds(deleteDoc(m('alice')));
});

test('予算: メンバーだけが設定でき、値は検証される', async () => {
  await seedBook();
  await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), 'books', 'b1', 'members', 'bob'), { role: 'member', name: 'Bob' }));
  const bud = (u) => doc(db(u), 'books', 'b1', 'meta', 'budget');
  await assertSucceeds(setDoc(bud('bob'), { monthly: 150000 })); // オーナー以外も設定可
  await assertSucceeds(getDoc(bud('alice')));
  await assertFails(setDoc(bud('bob'), { monthly: 0 }));
  await assertFails(setDoc(bud('bob'), { monthly: 1.5 }));
  await assertFails(setDoc(bud('bob'), { monthly: 100, extra: 1 }));
  await assertFails(setDoc(doc(db('bob'), 'books', 'b1', 'meta', 'other'), { monthly: 100 })); // budget 以外の文書は不可
  await assertFails(setDoc(bud('eve'), { monthly: 100 })); // 非メンバー
  await assertFails(getDoc(bud('eve')));
  await assertSucceeds(deleteDoc(bud('bob')));
});
