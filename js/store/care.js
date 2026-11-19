import { query, where, onSnapshot, getDoc, getDocs, setDoc, serverTimestamp } from '../firebase.js';
import { fcol, fdoc, docs } from './paths.js';

// 照顧紀錄：只有媽媽裝置能讀寫（安全規則）
// momLogs/{kidId}_{date}：
//   meds: { 藥物id: { status: taken|skipped, at: 'HH:MM', note } }
//   mood: { score: 1-5, note }, learning: { score: 1-5, note }
//   observed: { list: ['胃口不佳', …], note }
//   sleep: { bed: 'HH:MM'（上床那天）, wake: 'HH:MM'（隔天早上）, note }
// private/care：設定（誰要記錄、藥物清單、提醒時間）
export const logId = (kidId, date) => `${kidId}_${date}`;

export function watchCareSettings(cb, onErr) {
  return onSnapshot(fdoc('private', 'care'), (s) => cb(s.exists() ? s.data() : null), onErr);
}
export const saveCareSettings = (data) => setDoc(fdoc('private', 'care'), { ...data, updatedAt: serverTimestamp() });

export function watchLog(kidId, date, cb, onErr) {
  return onSnapshot(fdoc('momLogs', logId(kidId, date)), (s) => cb(s.exists() ? s.data() : null), onErr);
}
/** 某個孩子一段期間的紀錄（日期排序） */
export function watchLogs(kidId, from, to, cb, onErr) {
  return onSnapshot(query(fcol('momLogs'), where('kidId', '==', kidId)),
    (s) => cb(docs(s).filter((l) => l.date >= from && l.date <= to).sort((a, b) => a.date.localeCompare(b.date))), onErr);
}
export const getLogsOnce = async (kidId) => docs(await getDocs(query(fcol('momLogs'), where('kidId', '==', kidId))));

/** 合併寫入（patch 是巢狀物件，例如 { meds: { concerta: { status: 'taken', at: '07:42' } } }） */
export const saveLog = (kidId, date, patch) => setDoc(fdoc('momLogs', logId(kidId, date)), { ...patch, kidId, date, updatedAt: serverTimestamp() }, { merge: true });

/** 學習的自動摘要：當天清單、每日單字、課後小記（只讀一次） */
export async function daySummary(kidId, date) {
  const [items, sess, note] = await Promise.all([
    getDocs(query(fcol('items'), where('kidId', '==', kidId), where('date', '==', date))).then(docs),
    getDoc(fdoc('wordSessions', `${kidId}_${date}`)).then((s) => (s.exists() ? s.data() : null)),
    getDoc(fdoc('classNotes', `${kidId}_${date}`)).then((s) => (s.exists() ? s.data() : null))
  ]);
  return { items, sess, note };
}
