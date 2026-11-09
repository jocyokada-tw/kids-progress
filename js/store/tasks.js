import { db, query, where, onSnapshot, writeBatch, updateDoc, deleteDoc, doc, serverTimestamp } from '../firebase.js';
import { fcol, fdoc, docs, tsMillis } from './paths.js';

// 任務（進度項目）
// status: pending（小孩安排，待媽媽確認）| approved（已確認，會出現在每日清單）| rejected（媽媽退回）
const sortTasks = (list) => list.sort((a, b) => a.date.localeCompare(b.date) || tsMillis(a.createdAt) - tsMillis(b.createdAt));

export function watchTasksRange(kidId, from, to, cb, onErr) {
  const q = query(fcol('tasks'), where('kidId', '==', kidId), where('date', '>=', from), where('date', '<=', to));
  return onSnapshot(q, (s) => cb(sortTasks(docs(s))), onErr);
}
export function watchTasksOnDate(kidId, date, cb, onErr) {
  const q = query(fcol('tasks'), where('kidId', '==', kidId), where('date', '==', date));
  return onSnapshot(q, (s) => cb(sortTasks(docs(s))), onErr);
}
export function watchPendingTasks(kidId, cb, onErr) {
  const q = query(fcol('tasks'), where('kidId', '==', kidId), where('status', '==', 'pending'));
  return onSnapshot(q, (s) => cb(sortTasks(docs(s))), onErr);
}

/** 一次在多個日期建立同樣的進度。媽媽建立的直接是 approved；小孩建立的是 pending、點數由媽媽決定 */
export async function createTasks(kidId, dates, { title, note, points, subject }, asMom) {
  const b = writeBatch(db);
  for (const date of dates) {
    b.set(doc(fcol('tasks')), {
      kidId, date, title, note: note || '', subject: subject || '',
      points: asMom ? points : 0,
      createdBy: asMom ? 'mom' : 'kid',
      status: asMom ? 'approved' : 'pending',
      momNote: '',
      createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    });
  }
  await b.commit();
}

/** 小孩修改自己尚未確認的進度 */
export const kidUpdateTask = (id, { title, note, date, subject }) =>
  updateDoc(fdoc('tasks', id), { title, note, date, subject: subject || '', updatedAt: serverTimestamp() });

/** 媽媽確認／調整（可同時改內容、點數、留建議） */
export const momSaveTask = (id, patch, status) =>
  updateDoc(fdoc('tasks', id), { ...patch, ...(status ? { status } : {}), updatedAt: serverTimestamp() });

export const deleteTask = (id) => deleteDoc(fdoc('tasks', id));
