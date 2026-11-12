import { db, query, where, onSnapshot, writeBatch, addDoc, updateDoc, deleteDoc, doc, serverTimestamp } from '../firebase.js';
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
export async function createTasks(kidId, dates, { title, note, points, subject, due }, asMom) {
  const b = writeBatch(db);
  for (const date of dates) {
    b.set(doc(fcol('tasks')), {
      kidId, date, title, note: note || '', subject: subject || '',
      points: asMom ? points : 0,
      createdBy: asMom ? 'mom' : 'kid',
      status: asMom ? 'approved' : 'pending',
      momNote: '',
      ...(asMom && due ? { due } : {}),
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

// ---- 本週進度：媽媽訂內容與點數，小孩自己排到這週的某一天 ----
// kind: 'weekly'，week = 該週週一，weekEnd = 該週週日，date = '' 代表還沒排
export function watchUnscheduled(kidId, cb, onErr) {
  const q = query(fcol('tasks'), where('kidId', '==', kidId), where('date', '==', ''));
  return onSnapshot(q, (s) => cb(docs(s).filter((t) => t.kind === 'weekly' && t.status !== 'rejected').sort((a, b) => a.week.localeCompare(b.week) || tsMillis(a.createdAt) - tsMillis(b.createdAt))), onErr);
}

export const createWeeklyTask = (kidId, week, weekEnd, { title, note, points, subject, due }) => addDoc(fcol('tasks'), {
  kidId, kind: 'weekly', week, weekEnd, date: '', title, note: note || '', subject: subject || '', points, due: due || '',
  createdBy: 'mom', status: 'approved', momNote: '', itemApproved: false,
  createdAt: serverTimestamp(), updatedAt: serverTimestamp()
});

/** 把本週進度排到某一天（小孩只能排「還沒排」的；排定後要媽媽退回才能重排） */
export const scheduleWeekly = (id, date) => updateDoc(fdoc('tasks', id), { date, updatedAt: serverTimestamp() });

/**
 * 媽媽退回已排定的本週進度：清空日期讓孩子重排。
 * 原本那天如果已經有清單項目，會留著並顯示「已改期」，那天不會因此變成全部完成。
 */
export const unscheduleWeekly = (t, momNote) => updateDoc(fdoc('tasks', t.id), { date: '', momNote, updatedAt: serverTimestamp() });

/** 期限在 from～to 之間、還沒入帳的作業（首頁「快到期的作業」用） */
export function watchDue(kidId, from, to, cb, onErr) {
  const q = query(fcol('tasks'), where('kidId', '==', kidId), where('due', '>=', from), where('due', '<=', to));
  return onSnapshot(q, (s) => cb(docs(s).filter((t) => t.status === 'approved' && !t.itemApproved).sort((a, b) => a.due.localeCompare(b.due))), onErr);
}

/** 媽媽把逾期未排的進度移到另一週 */
export const moveWeeklyTo = (id, week, weekEnd) => updateDoc(fdoc('tasks', id), { week, weekEnd, date: '', updatedAt: serverTimestamp() });
