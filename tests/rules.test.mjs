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
    await setDoc(doc(d, F, 'rewards/rw1'), { title: '看卡通', emoji: '📺', cost: 20, active: true });
    await setDoc(doc(d, F, 'events/e1'), { kidId: 'kidA', title: '朱宗慶', repeat: 'weekly', weekdays: [3], start: '16:00', end: '17:00' });
    await setDoc(doc(d, F, 'events/eB'), { kidId: 'kidB', title: '游泳', repeat: 'weekly', weekdays: [2], start: '16:00', end: '17:00' });
    await setDoc(doc(d, F, 'items/kidA_2026-11-08_t1'), { kidId: 'kidA', date: '2026-11-08', sourceType: 'task', sourceId: 't1', title: '數學', points: 3, done: false, review: 'none' });
  });
}
beforeEach(seed);

const kidItem = (over = {}) => ({
  kidId: 'kidA', date: '2026-11-08', sourceType: 'routine', sourceId: 'r1', title: '刷牙', subject: '', points: 1, order: 0,
  done: false, doneAt: null, review: 'none', returnNote: '', createdAt: serverTimestamp(), ...over
});
const kidTask = (over = {}) => ({
  kidId: 'kidA', date: '2026-11-09', title: '練琴', note: '', subject: 'math', points: 0, createdBy: 'kid', status: 'pending', momNote: '',
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
  await assertFails(updateDoc(ref, { done: false, doneAt: null, review: 'none' })); // 送出後不能自己取消
  await assertFails(deleteDoc(ref));
  // 媽媽退回後可以重新勾選
  await assertSucceeds(updateDoc(doc(db('mom'), F, 'items/kidA_2026-11-08_t1'), { done: false, doneAt: null, review: 'returned', returnNote: 'x' }));
  await assertSucceeds(updateDoc(ref, { done: true, doneAt: serverTimestamp(), review: 'pending' }));
});
test('已改期／取消的項目，小孩不能勾選', async () => {
  await updateDoc(doc(db('mom'), F, 'items/kidA_2026-11-08_t1'), { missed: true });
  await assertFails(updateDoc(doc(db('a'), F, 'items/kidA_2026-11-08_t1'), { done: true, doneAt: serverTimestamp(), review: 'pending' }));
  await assertFails(updateDoc(doc(db('a'), F, 'items/kidA_2026-11-08_t1'), { missed: false }));
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

// ---------- 第二階段：課程、兌換、目標、留言 ----------
const redeem = (over = {}) => ({
  kidId: 'kidA', rewardId: 'rw1', title: '看卡通', emoji: '📺', cost: 20, status: 'pending', momNote: '',
  createdAt: serverTimestamp(), decidedAt: null, ...over
});

test('課程：小孩只能看自己的，不能新增或修改', async () => {
  const d = db('a');
  await assertSucceeds(getDocs(query(collection(d, F, 'events'), where('kidId', '==', 'kidA'))));
  await assertFails(getDocs(query(collection(d, F, 'events'), where('kidId', '==', 'kidB'))));
  await assertFails(setDoc(doc(d, F, 'events/x'), { kidId: 'kidA', title: 'x' }));
  await assertFails(updateDoc(doc(d, F, 'events/e1'), { title: 'x' }));
  await assertSucceeds(setDoc(doc(db('mom'), F, 'events/x'), { kidId: 'kidA', title: 'x' }));
});
test('兌換項目：小孩可讀不可寫', async () => {
  await assertSucceeds(getDocs(collection(db('a'), F, 'rewards')));
  await assertFails(updateDoc(doc(db('a'), F, 'rewards/rw1'), { cost: 1 }));
  await assertSucceeds(updateDoc(doc(db('mom'), F, 'rewards/rw1'), { cost: 25 }));
});
test('兌換申請：點數必須和兌換項目一致、只能是申請中', async () => {
  const d = db('a');
  await assertSucceeds(setDoc(doc(d, F, 'redemptions/q1'), redeem()));
  await assertFails(setDoc(doc(d, F, 'redemptions/q2'), redeem({ cost: 1 })));
  await assertFails(setDoc(doc(d, F, 'redemptions/q3'), redeem({ status: 'approved' })));
  await assertFails(setDoc(doc(d, F, 'redemptions/q4'), redeem({ kidId: 'kidB' })));
});
test('兌換申請：小孩只能取消，不能自己核可；媽媽可以核可', async () => {
  const d = db('a');
  await setDoc(doc(d, F, 'redemptions/q1'), redeem());
  await assertFails(updateDoc(doc(d, F, 'redemptions/q1'), { status: 'approved' }));
  await assertFails(updateDoc(doc(d, F, 'redemptions/q1'), { status: 'cancelled', cost: 0 }));
  await assertSucceeds(updateDoc(doc(d, F, 'redemptions/q1'), { status: 'cancelled', decidedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(d, F, 'redemptions/q1'), { status: 'pending' }));
  await setDoc(doc(d, F, 'redemptions/q2'), redeem());
  await assertSucceeds(updateDoc(doc(db('mom'), F, 'redemptions/q2'), { status: 'approved' }));
  await assertFails(deleteDoc(doc(db('mom'), F, 'redemptions/q2')));
});
test('目標存在 members，只有媽媽能設定', async () => {
  await assertFails(setDoc(doc(db('a'), F, 'members/kidA'), { goal: { title: 'x', points: 1 } }, { merge: true }));
  await assertSucceeds(setDoc(doc(db('mom'), F, 'members/kidA'), { goal: { title: '樂高', points: 200 } }, { merge: true }));
});
test('留言：小孩只能以小孩身分在自己的對話串留言，不能改或刪', async () => {
  const d = db('a');
  const col = collection(d, F, 'threads/kidA/messages');
  await assertSucceeds(setDoc(doc(col, 'm1'), { from: 'kid', text: '嗨', createdAt: serverTimestamp() }));
  await assertFails(setDoc(doc(col, 'm2'), { from: 'mom', text: '假冒', createdAt: serverTimestamp() }));
  await assertFails(setDoc(doc(col, 'm3'), { from: 'kid', text: '', createdAt: serverTimestamp() }));
  await assertFails(setDoc(doc(col, 'm4'), { from: 'kid', text: 'x'.repeat(501), createdAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(col, 'm1'), { text: '改' }));
  await assertFails(deleteDoc(doc(col, 'm1')));
  await assertFails(setDoc(doc(d, F, 'threads/kidB/messages/m5'), { from: 'kid', text: '嗨', createdAt: serverTimestamp() }));
  await assertFails(getDocs(collection(d, F, 'threads/kidB/messages')));
  await assertSucceeds(setDoc(doc(db('mom'), F, 'threads/kidA/messages/m6'), { from: 'mom', text: '好', createdAt: serverTimestamp() }));
  await assertSucceeds(getDocs(col));
});
test('已讀時間：小孩只能更新 kidReadAt', async () => {
  const d = db('a');
  await assertSucceeds(setDoc(doc(d, F, 'threads/kidA'), { kidReadAt: serverTimestamp() }, { merge: true }));
  await assertFails(setDoc(doc(d, F, 'threads/kidA'), { momReadAt: serverTimestamp() }, { merge: true }));
  await assertSucceeds(setDoc(doc(db('mom'), F, 'threads/kidA'), { momReadAt: serverTimestamp() }, { merge: true }));
  await assertSucceeds(getDoc(doc(d, F, 'threads/kidA')));
  await assertFails(getDoc(doc(d, F, 'threads/kidB')));
});
test('媽媽核可兌換時寫入負數流水帳', async () => {
  await assertSucceeds(setDoc(doc(db('mom'), F, 'ledger/redeem_q1'), { kidId: 'kidA', amount: -20, type: 'redeem', title: '兌換', createdAt: serverTimestamp() }));
  await assertFails(setDoc(doc(db('a'), F, 'ledger/redeem_q2'), { kidId: 'kidA', amount: 20, type: 'redeem', title: '兌換', createdAt: serverTimestamp() }));
});

// ---------- 本週進度 ----------
async function seedWeekly(over = {}) {
  await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), F, 'tasks/w1'), {
    kidId: 'kidA', kind: 'weekly', week: '2026-11-09', weekEnd: '2026-11-15', date: '', title: '數學習作', note: '', subject: 'math',
    points: 3, createdBy: 'mom', status: 'approved', momNote: '', itemApproved: false, ...over
  }));
}
test('本週進度：小孩可以排到同一週的某一天，排定後不能自己改；媽媽退回後可重排', async () => {
  await seedWeekly();
  const ref = doc(db('a'), F, 'tasks/w1');
  await assertSucceeds(updateDoc(ref, { date: '2026-11-11', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(ref, { date: '2026-11-15', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(ref, { date: '', updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(doc(db('mom'), F, 'tasks/w1'), { date: '' }));
  await assertSucceeds(updateDoc(ref, { date: '2026-11-15', updatedAt: serverTimestamp() }));
  await assertSucceeds(getDocs(query(collection(db('a'), F, 'tasks'), where('kidId', '==', 'kidA'), where('date', '==', ''))));
});
test('本週進度：不能排到別週、不能改點數或內容、入帳後不能改', async () => {
  await seedWeekly();
  const ref = doc(db('a'), F, 'tasks/w1');
  await assertFails(updateDoc(ref, { date: '2026-11-16' }));
  await assertFails(updateDoc(ref, { date: '2026-11-08' }));
  await assertFails(updateDoc(ref, { date: 'tomorrow' }));
  await assertFails(updateDoc(ref, { points: 30 }));
  await assertFails(updateDoc(ref, { title: '改', date: '2026-11-10' }));
  await assertFails(updateDoc(ref, { week: '2026-11-16', weekEnd: '2026-11-22' }));
  await seedWeekly({ date: '2026-11-10', itemApproved: true });
  await assertFails(updateDoc(ref, { date: '2026-11-12' }));
});
test('一般進度（非本週）小孩仍然不能改日期', async () => {
  await assertFails(updateDoc(doc(db('a'), F, 'tasks/t1'), { date: '2026-11-09' }));
});

// ---------- 推播權杖 ----------
test('推播權杖：已配對裝置只能寫自己的，任何人都讀不到', async () => {
  const tok = { token: 'abc', ua: 'iPhone', updatedAt: serverTimestamp() };
  await assertSucceeds(setDoc(doc(db('a'), F, 'pushTokens/a'), tok));
  await assertFails(setDoc(doc(db('a'), F, 'pushTokens/mom'), tok));
  await assertFails(setDoc(doc(db('stranger'), F, 'pushTokens/stranger'), tok));
  await assertFails(setDoc(doc(db('a'), F, 'pushTokens/a'), { ...tok, extra: 1 }));
  await assertFails(getDoc(doc(db('a'), F, 'pushTokens/a')));
  await assertFails(getDoc(doc(db('mom'), F, 'pushTokens/a')));
  await assertSucceeds(deleteDoc(doc(db('a'), F, 'pushTokens/a')));
  await assertFails(getDocs(collection(db('mom'), F, 'pushQueue')));
});

// ---------- 每日單字 ----------
test('字庫：小孩可讀不可寫', async () => {
  await assertSucceeds(setDoc(doc(db('mom'), F, 'wordLists/l1'), { name: 'Flyers', kind: 'general', kids: ['kidA'], count: 1, active: true }));
  await assertSucceeds(setDoc(doc(db('mom'), F, 'wordLists/l1/chunks/0'), { words: [{ w: 'apple', zh: '蘋果', ex: '' }] }));
  await assertSucceeds(getDocs(collection(db('a'), F, 'wordLists')));
  await assertSucceeds(getDocs(collection(db('a'), F, 'wordLists/l1/chunks')));
  await assertFails(setDoc(doc(db('a'), F, 'wordLists/l1/chunks/0'), { words: [] }));
  await assertFails(updateDoc(doc(db('a'), F, 'wordLists/l1'), { count: 0 }));
  await assertFails(getDocs(collection(db('stranger'), F, 'wordLists')));
});
test('單字進度：小孩只能讀寫自己的', async () => {
  await assertSucceeds(setDoc(doc(db('a'), F, 'wordProgress/kidA'), { w: { apple: { b: 0, d: '2026-11-09' } } }, { merge: true }));
  await assertSucceeds(getDoc(doc(db('a'), F, 'wordProgress/kidA')));
  await assertFails(setDoc(doc(db('a'), F, 'wordProgress/kidB'), { w: {} }, { merge: true }));
  await assertFails(getDoc(doc(db('a'), F, 'wordProgress/kidB')));
});
test('單字練習：答錯紀錄不能刪、有答錯就不能標成全對、完成後不能再改', async () => {
  const d = db('a');
  const ref = doc(d, F, 'wordSessions/kidA_2026-11-08');
  const base = { kidId: 'kidA', date: '2026-11-08', newWords: ['apple'], reviewWords: [], wrong: [], finished: false, perfect: false };
  await assertFails(setDoc(doc(d, F, 'wordSessions/kidA_2026-11-09'), { ...base, date: '2026-11-09', finished: true, perfect: true }));
  await assertFails(setDoc(doc(d, F, 'wordSessions/kidB_2026-11-08'), { ...base, kidId: 'kidB' }));
  await assertSucceeds(setDoc(ref, base));
  await assertSucceeds(updateDoc(ref, { wrong: ['apple'] }));
  await assertFails(updateDoc(ref, { wrong: [] }));
  await assertFails(updateDoc(ref, { finished: true, perfect: true }));
  await assertFails(updateDoc(ref, { newWords: [] }));
  await assertSucceeds(updateDoc(ref, { finished: true, perfect: false }));
  await assertFails(updateDoc(ref, { perfect: true, wrong: [] }));
  await assertFails(deleteDoc(ref));
  await assertSucceeds(getDocs(query(collection(d, F, 'wordSessions'), where('kidId', '==', 'kidA'))));
  await assertFails(getDocs(query(collection(d, F, 'wordSessions'), where('kidId', '==', 'kidB'))));
});
test('每日單字的清單項目：點數必須等於設定', async () => {
  await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), F, 'meta/settings'), { words: { perDay: 5, points: 2, perfectBonus: 2 } }));
  const d = db('a');
  const it = kidItem({ sourceType: 'words', sourceId: 'words', title: '📖 每日單字', points: 2, order: 500 });
  await assertFails(setDoc(doc(d, F, 'items/kidA_2026-11-08_words'), { ...it, points: 50 }));
  await assertSucceeds(setDoc(doc(d, F, 'items/kidA_2026-11-08_words'), it));
});

test('雲端語音快取：已配對裝置可讀單筆，不能列出、不能寫', async () => {
  await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), F, 'tts/abc'), { text: 'apple', audio: 'QUJD' }));
  await assertSucceeds(getDoc(doc(db('a'), F, 'tts/abc')));
  await assertSucceeds(getDoc(doc(db('a'), F, 'tts/none')));
  await assertFails(getDoc(doc(db('stranger'), F, 'tts/abc')));
  await assertFails(getDocs(collection(db('mom'), F, 'tts')));
  await assertFails(setDoc(doc(db('mom'), F, 'tts/x'), { text: 'x', audio: 'x' }));
});

test('有期限的本週進度：小孩只能排在期限當天或之前', async () => {
  await seedWeekly({ due: '2026-11-12' });
  const ref = doc(db('a'), F, 'tasks/w1');
  await assertFails(updateDoc(ref, { date: '2026-11-13', updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(ref, { date: '2026-11-12', updatedAt: serverTimestamp() }));
});

test('指定完成時間：小孩補建的項目時間必須和來源一致；送出時間由伺服器決定', async () => {
  await env.withSecurityRulesDisabled(async (c) => {
    const d = c.firestore();
    await setDoc(doc(d, F, 'routines/dish'), { kidId: 'kidA', title: '洗餐碗', points: 2, weekdays: [0, 1, 2, 3, 4, 5, 6], active: true, dueTime: '18:30' });
  });
  const d = db('a');
  const base = kidItem({ sourceId: 'dish', title: '洗餐碗', points: 2 });
  await assertFails(setDoc(doc(d, F, 'items/kidA_2026-11-08_dish'), base));                          // 少了 dueTime（想躲掉時間）
  await assertFails(setDoc(doc(d, F, 'items/kidA_2026-11-08_dish'), { ...base, dueTime: '23:59' }));  // 自己改時間
  await assertSucceeds(setDoc(doc(d, F, 'items/kidA_2026-11-08_dish'), { ...base, dueTime: '18:30' }));
  const ref = doc(d, F, 'items/kidA_2026-11-08_dish');
  const { Timestamp } = await import('firebase/firestore');
  await assertFails(updateDoc(ref, { done: true, doneAt: Timestamp.fromDate(new Date('2026-11-08T09:00:00Z')), review: 'pending' }));  // 偽造送出時間
  await assertSucceeds(updateDoc(ref, { done: true, doneAt: serverTimestamp(), review: 'pending' }));
  await assertFails(updateDoc(ref, { dueTime: '' }));
});

test('課後小記：孩子寫自己的；點數欄位只有伺服器能寫；留言只有媽媽能寫', async () => {
  const a = db('a');
  const ref = doc(a, F, 'classNotes/kidA_2026-11-10');
  const base = { kidId: 'kidA', date: '2026-11-10', mood: 'fun', learned: '分數', updatedAt: serverTimestamp() };
  await assertFails(setDoc(doc(a, F, 'classNotes/kidA_2026-11-11'), base));            // ID 和日期不一致
  await assertFails(setDoc(doc(a, F, 'classNotes/kidB_2026-11-10'), { ...base, kidId: 'kidB' }));   // 別人的
  await assertFails(setDoc(ref, { ...base, awarded: 3 }));                              // 自己給點數
  await assertSucceeds(setDoc(ref, base));
  await assertSucceeds(setDoc(ref, { interesting: '原來', updatedAt: serverTimestamp() }, { merge: true }));
  await assertFails(updateDoc(ref, { level: 'full' }));
  await assertFails(updateDoc(ref, { momComment: '好棒' }));
  await assertFails(updateDoc(ref, { date: '2026-11-11' }));
  const m = db('mom');
  await assertSucceeds(updateDoc(doc(m, F, 'classNotes/kidA_2026-11-10'), { momComment: '好棒', momCommentAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(m, F, 'classNotes/kidA_2026-11-10'), { awarded: 9 }));
  await assertSucceeds(getDoc(ref));
  await assertSucceeds(getDocs(query(collection(a, F, 'classNotes'), where('kidId', '==', 'kidA'))));
  await assertFails(getDocs(query(collection(a, F, 'classNotes'), where('kidId', '==', 'kidB'))));
  await assertFails(deleteDoc(ref));
});
