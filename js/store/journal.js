import { query, where, onSnapshot, getDoc, getDocs, setDoc, updateDoc, deleteDoc, serverTimestamp } from '../firebase.js';
import { fcol, fdoc, docs, tsMillis } from './paths.js';

// 課後小記：classNotes/{kidId}_{date}
// 孩子填寫的欄位：skipped, memorable, topic, mood, moodDetail, followUpAnswer, boringReason, boringAnswer,
//   learned, interesting, question, projectProgress, extraCategory, extraText
// 只有伺服器能寫：level, awarded, onTheDay（點數由 Cloud Functions 依填寫內容自動入帳）
// 只有媽媽能寫：momComment, momCommentAt
export const noteId = (kidId, date) => `${kidId}_${date}`;

export const KID_FIELDS = ['skipped', 'memorable', 'topic', 'mood', 'moodDetail', 'followUpAnswer', 'boringReason', 'boringAnswer',
  'learned', 'interesting', 'question', 'projectProgress', 'extraCategory', 'extraText'];

export function watchNote(kidId, date, cb, onErr) {
  return onSnapshot(fdoc('classNotes', noteId(kidId, date)), (s) => cb(s.exists() ? { id: s.id, ...s.data() } : null), onErr);
}

/** 這個孩子所有的小記（新的在前） */
export function watchNotes(kidId, cb, onErr) {
  return onSnapshot(query(fcol('classNotes'), where('kidId', '==', kidId)),
    (s) => cb(docs(s).sort((a, b) => b.date.localeCompare(a.date) || tsMillis(b.updatedAt) - tsMillis(a.updatedAt))), onErr);
}

/** 孩子儲存（只寫孩子可以寫的欄位） */
export function saveNote(kidId, date, data) {
  const clean = {};
  for (const k of KID_FIELDS) if (k in data) clean[k] = typeof data[k] === 'string' ? data[k].trim().slice(0, 500) : data[k];
  return setDoc(fdoc('classNotes', noteId(kidId, date)), { ...clean, kidId, date, updatedAt: serverTimestamp() }, { merge: true });
}

export const setMomComment = (id, text) => updateDoc(fdoc('classNotes', id), { momComment: String(text || '').trim().slice(0, 300), momCommentAt: serverTimestamp() });

// ---- 提示文字：先讀 meta/journalPrompts（媽媽之後可在 App 內修改），沒有就用 data/journalPrompts.json ----
let promptsP = null;
export function loadPrompts() {
  promptsP ||= (async () => {
    try {
      const s = await getDoc(fdoc('meta', 'journalPrompts'));
      if (s.exists() && s.data().feelings) return s.data();
    } catch (e) { console.warn('journalPrompts', e); }
    const r = await fetch('./data/journalPrompts.json');
    if (!r.ok) throw new Error('讀不到提示文字');
    return r.json();
  })().catch((e) => { promptsP = null; throw e; });
  return promptsP;
}

/** 媽媽儲存提示文字（存在 meta/journalPrompts，覆蓋 data/journalPrompts.json） */
export async function savePrompts(data) {
  await setDoc(fdoc('meta', 'journalPrompts'), { ...data, updatedAt: serverTimestamp() });
  promptsP = null;
}
/** 恢復成 data/journalPrompts.json 的內容 */
export async function resetPrompts() {
  await deleteDoc(fdoc('meta', 'journalPrompts'));
  promptsP = null;
}
export async function defaultPrompts() {
  const r = await fetch('./data/journalPrompts.json', { cache: 'no-cache' });
  return r.json();
}

// ---- 週末記事錄整理：weeklyJournals/{kidId}_{週一} ----
// 孩子寫：sections: { 類別: { text } }, status: draft|done, submittedAt；伺服器寫：awarded
export const weeklyId = (kidId, week) => `${kidId}_${week}`;
export function watchWeekly(kidId, week, cb, onErr) {
  return onSnapshot(fdoc('weeklyJournals', weeklyId(kidId, week)), (s) => cb(s.exists() ? { id: s.id, ...s.data() } : null), onErr);
}
export function watchWeeklies(kidId, cb, onErr) {
  return onSnapshot(query(fcol('weeklyJournals'), where('kidId', '==', kidId)), (s) => cb(docs(s).sort((a, b) => b.week.localeCompare(a.week))), onErr);
}
export function saveWeeklyText(kidId, week, category, text) {
  return setDoc(fdoc('weeklyJournals', weeklyId(kidId, week)),
    { kidId, week, sections: { [category]: { text: String(text || '').slice(0, 3000) } }, updatedAt: serverTimestamp() }, { merge: true });
}
export function setWeeklyStatus(kidId, week, status) {
  return setDoc(fdoc('weeklyJournals', weeklyId(kidId, week)),
    { kidId, week, status, ...(status === 'done' ? { submittedAt: serverTimestamp() } : {}), updatedAt: serverTimestamp() }, { merge: true });
}

// ---- 孩子自訂的開頭句：customStarters/{kidId} = { list: [{ id, category, text }] } ----
export function watchCustomStarters(kidId, cb, onErr) {
  return onSnapshot(fdoc('customStarters', kidId), (s) => cb((s.exists() && s.data().list) || []), onErr);
}
export const saveCustomStarters = (kidId, list) => setDoc(fdoc('customStarters', kidId), { list: list.slice(0, 50) });

/** 匯出用：讀一次全部 */
export const getNotesOnce = async (kidId) => docs(await getDocs(query(fcol('classNotes'), where('kidId', '==', kidId))));
export const getWeekliesOnce = async (kidId) => docs(await getDocs(query(fcol('weeklyJournals'), where('kidId', '==', kidId))));
