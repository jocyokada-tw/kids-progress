import { query, where, onSnapshot, addDoc, updateDoc, serverTimestamp } from '../firebase.js';
import { fcol, fdoc, docs, tsMillis } from './paths.js';

// 每日固定事項（應完成事項），例如「刷牙」「閱讀 20 分鐘」，依星期幾自動進入每日清單
export function watchRoutines(kidId, cb, onErr) {
  const q = query(fcol('routines'), where('kidId', '==', kidId));
  return onSnapshot(q, (s) => cb(docs(s)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || tsMillis(a.createdAt) - tsMillis(b.createdAt))), onErr);
}

export function saveRoutine(id, kidId, { title, points, weekdays, order }) {
  const data = { kidId, title, points, weekdays, order, active: true };
  if (id) return updateDoc(fdoc('routines', id), data);
  return addDoc(fcol('routines'), { ...data, createdAt: serverTimestamp() });
}

/** 軟刪除：保留文件，過去的清單仍可追溯 */
export const archiveRoutine = (id) => updateDoc(fdoc('routines', id), { active: false });
