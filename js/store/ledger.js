import { query, where, onSnapshot, addDoc, serverTimestamp } from '../firebase.js';
import { fcol, docs, tsMillis } from './paths.js';
import { todayStr } from '../utils/date.js';

// 點數流水帳：只新增、不修改、不刪除。目前點數 = 所有紀錄 amount 的總和。
// type: task（完成項目）| bonus（全部完成獎勵）| adjust（媽媽手動調整）| redeem（兌換，第二階段）
export const LEDGER_TYPES = { task: '完成項目', bonus: '額外獎勵', adjust: '手動調整', redeem: '兌換' };

export function watchLedger(kidId, cb, onErr) {
  const q = query(fcol('ledger'), where('kidId', '==', kidId));
  return onSnapshot(q, (s) => {
    const list = docs(s).sort((a, b) => tsMillis(b.createdAt) - tsMillis(a.createdAt));
    const balance = list.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
    cb({ list, balance });
  }, onErr);
}

export const addAdjustment = (kidId, amount, title) => addDoc(fcol('ledger'), {
  kidId, amount, type: 'adjust', title, date: todayStr(), refId: '', createdAt: serverTimestamp(), createdBy: 'mom'
});
