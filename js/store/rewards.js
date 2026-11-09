import { db, query, where, onSnapshot, addDoc, updateDoc, runTransaction, serverTimestamp } from '../firebase.js';
import { fcol, fdoc, docs, tsMillis } from './paths.js';
import { todayStr } from '../utils/date.js';

// ---- 兌換項目（媽媽設定） ----
export function watchRewards(cb, onErr) {
  return onSnapshot(fcol('rewards'), (s) => cb(docs(s).filter((r) => r.active !== false)
    .sort((a, b) => a.cost - b.cost || tsMillis(a.createdAt) - tsMillis(b.createdAt))), onErr);
}
export function saveReward(id, { title, emoji, cost }) {
  if (id) return updateDoc(fdoc('rewards', id), { title, emoji, cost });
  return addDoc(fcol('rewards'), { title, emoji, cost, active: true, createdAt: serverTimestamp() });
}
export const archiveReward = (id) => updateDoc(fdoc('rewards', id), { active: false });

// ---- 兌換申請 ----
// status: pending（申請中，點數先預留）| approved（已兌換，流水帳扣點）| rejected（媽媽退回）| cancelled（小孩取消）
export function watchRedemptions(kidId, cb, onErr) {
  return onSnapshot(query(fcol('redemptions'), where('kidId', '==', kidId)),
    (s) => cb(docs(s).sort((a, b) => tsMillis(b.createdAt) - tsMillis(a.createdAt))), onErr);
}
export function watchPendingRedemptions(kidId, cb, onErr) {
  return onSnapshot(query(fcol('redemptions'), where('kidId', '==', kidId), where('status', '==', 'pending')), (s) => cb(docs(s)), onErr);
}

export const requestRedemption = (kidId, reward) => addDoc(fcol('redemptions'), {
  kidId, rewardId: reward.id, title: reward.title, emoji: reward.emoji || '🎁', cost: reward.cost,
  status: 'pending', momNote: '', createdAt: serverTimestamp(), decidedAt: null
});

export const cancelRedemption = (id) => updateDoc(fdoc('redemptions', id), { status: 'cancelled', decidedAt: serverTimestamp() });
export const rejectRedemption = (id, momNote) => updateDoc(fdoc('redemptions', id), { status: 'rejected', momNote: momNote || '', decidedAt: serverTimestamp() });

/** 媽媽核可：同一個交易中改狀態並寫入負數流水帳（ID 固定，不會重複扣點） */
export async function approveRedemption(id) {
  const ref = fdoc('redemptions', id);
  const lref = fdoc('ledger', `redeem_${id}`);
  await runTransaction(db, async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists()) throw new Error('申請不存在');
    const r = s.data();
    if (r.status !== 'pending') throw new Error('這筆申請已經處理過了');
    const l = await tx.get(lref);
    tx.update(ref, { status: 'approved', decidedAt: serverTimestamp() });
    if (!l.exists()) {
      tx.set(lref, {
        kidId: r.kidId, amount: -r.cost, type: 'redeem', title: `兌換：${r.emoji || ''} ${r.title}`.trim(),
        date: todayStr(), refId: id, createdAt: serverTimestamp(), createdBy: 'mom'
      });
    }
  });
}
