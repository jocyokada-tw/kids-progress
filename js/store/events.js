import { query, where, onSnapshot, addDoc, updateDoc, deleteDoc, arrayUnion, serverTimestamp } from '../firebase.js';
import { fcol, fdoc, docs } from './paths.js';
import { weekday } from '../utils/date.js';

// 課程（非學校的固定行程，例如才藝課）：沒有點數，不進入每日清單
// repeat: 'weekly'（每週 weekdays 重複，從 from 到 until）| 'once'（只有 date 那天）
// skipDates: 每週課程中「只取消這一次」的日期
export function watchEvents(kidId, cb, onErr) {
  return onSnapshot(query(fcol('events'), where('kidId', '==', kidId)), (s) => cb(docs(s)), onErr);
}

/** 某一天有哪些課程（依開始時間排序） */
export function eventsOn(events, date) {
  return events.filter((e) => {
    if (e.repeat === 'once') return e.date === date;
    if (e.from && date < e.from) return false;
    if (e.until && date > e.until) return false;
    if ((e.skipDates || []).includes(date)) return false;
    return (e.weekdays || []).includes(weekday(date));
  }).sort((a, b) => (a.start || '').localeCompare(b.start || ''));
}

export function saveEvent(id, kidId, data) {
  const doc = { kidId, ...data, updatedAt: serverTimestamp() };
  if (id) return updateDoc(fdoc('events', id), doc);
  return addDoc(fcol('events'), { ...doc, skipDates: [], createdAt: serverTimestamp() });
}
export const skipEventOn = (id, date) => updateDoc(fdoc('events', id), { skipDates: arrayUnion(date) });
export const deleteEvent = (id) => deleteDoc(fdoc('events', id));
