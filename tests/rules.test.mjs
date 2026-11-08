// 安全規則測試：cd tests && npm install && npm run test:rules
import { test, before, after, beforeEach } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, writeBatch, collection, query, where, getDocs, serverTimestamp } from 'firebase/firestore';

const F = 'families/home';
let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-kids',
    firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8080 }
  });
});
after(() => env.cleanup());

const db = (uid) => (uid ? env.authenticatedContext(uid).firestore() : env.unauthenticatedContext().firestore());

/** 建好一個家庭：mom 裝置、kidA 裝置、共用裝置，加上固定事項與任務 */
async function seed() {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const d = ctx.firestore();
    await setDoc(doc(d, F), { setupBy: 'mom' });
    await setDoc(doc(d, F, 'devices/mom'), { isMom: true, kids: ['kidA', 'kidB'] });
    await setDoc(doc(d, F, 'devices/a'), { isMom: false, kids: ['kidA'] });
    await setDoc(doc(d, F, 'private/pin'), { hash: 'x', salt: 'y' });
    await setDoc(doc(d, F, 'routines/r1'), { kidId: 'kidA', title: '刷牙', points: 1, weekdays: [0, 1, 2, 3, 4, 5, 6], active: true });
    await setDoc(doc(d, F, 'tasks/t1'), { kidId: 'kidA', date: '2026-11-08', title: '數學', points: 3, status: 'approved', createdBy: 'mom', momNote: '' });
    await setDoc(doc(d, F, 'tasks/tB'), { kidId: 'kidB', date: '2026-11-08', title: '國語', points: 3, status: 'approved', createdBy: 'mom', momNote: '' });
    await setDoc(doc(d, F, 'items/kidA_2026-11-08_t1'), { kidId: 'kidA', date: '2026-11-08', sourceType: 'task', sourceId: 't1', title: '數學', points: 3, done: false, review: 'none' });
  });
}
beforeEach(seed);

const kidItem = (over = {}) => ({
  kidId: 'kidA', date: '2026-11-08', sourceType: 'routine', sourceId: 'r1', title: '刷牙', points: 1, order: 0,
  done: false, doneAt: null, review: 'none', returnNote: '', createdAt: serverTimestamp(), ...over
});
const kidTask = (over = {}) => ({
  kidId: 'kidA', date: '2026-11-09', title: '練琴', note: '', points: 0, createdBy: 'kid', status: 'pending', momNote: '',
  createdAt: serverTimestamp(), updatedAt: serverTimestamp(), ...over
});

// ---------- 建立家庭 ----------
test('第一台裝置可在家庭不存在時建立家庭並成為媽媽', async () => {
  await env.clearFirestore();
  const d = db('first');
  const b = writeBatch(d);
  b.set(doc(d, F), { setupBy: 'first', createdAt: serverTimestamp() });
  b.set(doc(d, F, 'devices/first'), { isMom: true, kids: ['kidA', 'kidB'], label: 'x' });
  b.set(doc(d, F, 'members/kidA'), { name: 'A' });
  b.set(doc(d, F, 'meta/settings'), { bonusAllDone: 5 });
  b.set(doc(d, F, 'private/pin'), { hash: 'h', salt: 's' });
  await assertSucceeds(b.commit());
});
test('家庭已存在時，陌生裝置不能自封為媽媽', async () => {
  const d = db('stranger');
  await assertFails(setDoc(doc(d, F, 'devices/stranger'), { isMom: true, kids: [] }));
  const b = writeBatch(d);
  b.set(doc(d, F), { setupBy: 'stranger' });
  b.set(doc(d, F, 'devices/stranger'), { isMom: true, kids: [] });
  await assertFails(b.commit());
});

// ---------- 配對 ----------
test('未配對裝置只能送出自己的配對申請，讀不到家庭資料', async () => {
  const d = db('new');
  await assertSucceeds(getDoc(doc(d, F)));
  await assertSucceeds(setDoc(doc(d, F, 'pairRequests/new'), { code: '1234', label: 'iPad', createdAt: serverTimestamp() }));
  await assertFails(setDoc(doc(d, F, 'pairRequests/other'), { code: '1234', label: 'iPad' }));
  await assertSucceeds(getDoc(doc(d, F, 'devices/new')));
  await assertFails(getDoc(doc(d, F, 'devices/mom')));
  await assertFails(getDoc(doc(d, F, 'routines/r1')));
  await assertFails(getDocs(collection(d, F, 'pairRequests')));
});
test('媽媽可以核可配對；小孩裝置不行', async () => {
  await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), F, 'pairRequests/new'), { code: '1', label: 'x' }));
  await assertFails(setDoc(doc(db('a'), F, 'devices/new'), { isMom: true, kids: [] }));
  const d = db('mom');
  await assertSucceeds(getDocs(collection(d, F, 'pairRequests')));
  const b = writeBatch(d);
  b.set(doc(d, F, 'devices/new'), { isMom: false, kids: ['kidB'] });
  b.delete(doc(d, F, 'pairRequests/new'));
  await assertSucceeds(b.commit());
});

// ---------- PIN、設定 ----------
test('小孩裝置讀不到 PIN 雜湊、不能改設定', async () => {
  await assertFails(getDoc(doc(db('a'), F, 'private/pin')));
  await assertSucceeds(getDoc(doc(db('mom'), F, 'private/pin')));
  await assertFails(setDoc(doc(db('a'), F, 'meta/settings'), { bonusAllDone: 999 }));
  await assertFails(setDoc(doc(db('a'), F, 'members/kidA'), { name: 'hack' }, { merge: true }));
});

// ---------- 任務 ----------
test('小孩只看得到自己的任務', async () => {
  const d = db('a');
  await assertSucceeds(getDocs(query(collection(d, F, 'tasks'), where('kidId', '==', 'kidA'), where('date', '>=', '2026-11-01'), where('date', '<=', '2026-11-30'))));
  await assertFails(getDocs(query(collection(d, F, 'tasks'), where('kidId', '==', 'kidB'))));
  await assertFails(getDocs(collection(d, F, 'tasks')));
  await assertFails(getDoc(doc(d, F, 'tasks/tB')));
});
test('小孩新增任務必須是待確認、0 點', async () => {
  const d = db('a');
  await assertSucceeds(setDoc(doc(d, F, 'tasks/k1'), kidTask()));
  await assertFails(setDoc(doc(d, F, 'tasks/k2'), kidTask({ status: 'approved' })));
  await assertFails(setDoc(doc(d, F, 'tasks/k3'), kidTask({ points: 50 })));
  await assertFails(setDoc(doc(d, F, 'tasks/k4'), kidTask({ kidId: 'kidB' })));
  await assertFails(setDoc(doc(d, F, 'tasks/k5'), kidTask({ momNote: 'ok' })));
});
test('小孩可改自己待確認的任務，但不能改點數／狀態，也不能動已確認的任務', async () => {
  const d = db('a');
  await setDoc(doc(d, F, 'tasks/k1'), kidTask());
  await assertSucceeds(updateDoc(doc(d, F, 'tasks/k1'), { title: '練琴 30 分', date: '2026-11-10' }));
  await assertFails(updateDoc(doc(d, F, 'tasks/k1'), { status: 'approved' }));
  await assertFails(updateDoc(doc(d, F, 'tasks/k1'), { points: 10 }));
  await assertFails(updateDoc(doc(d, F, 'tasks/t1'), { title: 'x' }));
  await assertFails(deleteDoc(doc(d, F, 'tasks/t1')));
  await assertSucceeds(deleteDoc(doc(d, F, 'tasks/k1')));
});
test('媽媽可以確認任務並留建議', async () => {
  await setDoc(doc(db('a'), F, 'tasks/k1'), kidTask());
  await assertSucceeds(updateDoc(doc(db('mom'), F, 'tasks/k1'), { status: 'approved', points: 2, momNote: '很好！' }));
});

// ---------- 清單項目 ----------
test('小孩可以補建清單項目，但點數必須和來源一致', async () => {
  const d = db('a');
  await assertSucceeds(setDoc(doc(d, F, 'items/kidA_2026-11-08_r1'), kidItem()));
  await assertFails(setDoc(doc(d, F, 'items/kidA_2026-11-09_r1'), kidItem({ date: '2026-11-09', points: 100 })));
  await assertFails(setDoc(doc(d, F, 'items/whatever'), kidItem({ date: '2026-11-10' })));
  await assertFails(setDoc(doc(d, F, 'items/kidA_2026-11-11_r1'), kidItem({ date: '2026-11-11', done: true, review: 'approved' })));
});
test('任務項目：任務必須已確認且日期相符', async () => {
  await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), F, 'tasks/p1'), { kidId: 'kidA', date: '2026-11-08', title: 'p', points: 0, status: 'pending', createdBy: 'kid', momNote: '' }));
  const d = db('a');
  await assertFails(setDoc(doc(d, F, 'items/kidA_2026-11-08_p1'), kidItem({ sourceType: 'task', sourceId: 'p1', points: 0 })));
  await assertFails(setDoc(doc(d, F, 'items/kidA_2026-11-09_t1'), kidItem({ sourceType: 'task', sourceId: 't1', date: '2026-11-09', points: 3 })));
});
test('小孩可以勾選，但不能自己核可', async () => {
  const d = db('a');
  const ref = doc(d, F, 'items/kidA_2026-11-08_t1');
  await assertSucceeds(updateDoc(ref, { done: true, doneAt: serverTimestamp(), review: 'pending' }));
  await assertFails(updateDoc(ref, { review: 'approved' }));
  await assertFails(updateDoc(ref, { points: 99 }));
  await assertSucceeds(updateDoc(ref, { done: false, doneAt: null, review: 'none' }));
  await assertFails(deleteDoc(ref));
});
test('已入帳的項目，小孩不能取消', async () => {
  await updateDoc(doc(db('mom'), F, 'items/kidA_2026-11-08_t1'), { done: true, review: 'approved' });
  await assertFails(updateDoc(doc(db('a'), F, 'items/kidA_2026-11-08_t1'), { done: false, doneAt: null, review: 'none' }));
});
test('小孩查詢待核可項目只能查自己的', async () => {
  await assertSucceeds(getDocs(query(collection(db('a'), F, 'items'), where('kidId', '==', 'kidA'), where('review', '==', 'pending'))));
  await assertFails(getDocs(query(collection(db('a'), F, 'items'), where('kidId', '==', 'kidB'), where('review', '==', 'pending'))));
});

// ---------- 點數流水帳 ----------
test('只有媽媽能新增流水帳；流水帳不能修改或刪除', async () => {
  const e = { kidId: 'kidA', amount: 3, type: 'task', title: '數學', date: '2026-11-08', createdAt: serverTimestamp() };
  await assertFails(setDoc(doc(db('a'), F, 'ledger/x'), e));
  await assertSucceeds(setDoc(doc(db('mom'), F, 'ledger/x'), e));
  await assertFails(updateDoc(doc(db('mom'), F, 'ledger/x'), { amount: 300 }));
  await assertFails(deleteDoc(doc(db('mom'), F, 'ledger/x')));
  await assertFails(setDoc(doc(db('mom'), F, 'ledger/x'), e)); // 同一 ID 不能重複入帳
  await assertFails(setDoc(doc(db('mom'), F, 'ledger/y'), { ...e, amount: 1.5 }));
});
test('小孩只能讀自己的流水帳', async () => {
  await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), F, 'ledger/b1'), { kidId: 'kidB', amount: 5, type: 'task' }));
  await assertSucceeds(getDocs(query(collection(db('a'), F, 'ledger'), where('kidId', '==', 'kidA'))));
  await assertFails(getDocs(query(collection(db('a'), F, 'ledger'), where('kidId', '==', 'kidB'))));
  await assertFails(getDoc(doc(db('a'), F, 'ledger/b1')));
});
test('未登入者什麼都不能讀', async () => {
  await assertFails(getDoc(doc(db(null), F)));
  await assertFails(getDoc(doc(db(null), F, 'routines/r1')));
});
