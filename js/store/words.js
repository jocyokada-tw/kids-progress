import { db, query, where, onSnapshot, getDocs, getDoc, addDoc, setDoc, updateDoc, writeBatch, collection, doc, arrayUnion, serverTimestamp } from '../firebase.js';
import { fcol, fdoc, docs, tsMillis } from './paths.js';
export { INTERVALS, wordKey, sameSpelling, parseWords, wordsToText, planToday, nextProgress } from '../utils/srs.js';

// 每日單字
// wordLists/{id}            字庫：name, kind: 'cram'（補習班，有考試日）| 'general'（一般字庫）, kids[], testDate, count, active
// wordLists/{id}/chunks/{n} 單字內容，每 200 個一份：{ words: [{ w, zh, ex }] }
// wordProgress/{kidId}      學習進度：{ w: { [單字]: { b: 熟練度 0-6, d: 下次複習日, n: 練習次數, x: 答錯次數, t: 學會日期 } } }
// wordSessions/{kidId}_{日期} 當天的練習：newWords, reviewWords, wrong[], finished, perfect
export const WORD_DEFAULTS = { perDay: 5, points: 2, perfectBonus: 2, order: 'random' };
const CHUNK = 200;


// ---------- 字庫 ----------
export function watchWordLists(cb, onErr) {
  return onSnapshot(fcol('wordLists'), (s) => cb(docs(s).filter((l) => l.active !== false)
    .sort((a, b) => tsMillis(a.createdAt) - tsMillis(b.createdAt))), onErr);
}
export function saveWordList(id, { name, kind, kids, testDate }) {
  const data = { name, kind, kids, testDate: kind === 'cram' ? testDate || '' : '' };
  if (id) return updateDoc(fdoc('wordLists', id), data).then(() => id);
  return addDoc(fcol('wordLists'), { ...data, count: 0, active: true, createdAt: serverTimestamp() }).then((r) => r.id);
}
export const archiveWordList = (id) => updateDoc(fdoc('wordLists', id), { active: false });

const chunkCol = (listId) => collection(fdoc('wordLists', listId), 'chunks');
export async function loadListWords(listId) {
  const s = await getDocs(chunkCol(listId));
  return s.docs.sort((a, b) => Number(a.id) - Number(b.id)).flatMap((d) => d.data().words || []);
}
/** 整份取代字庫內容 */
export async function saveListWords(listId, words) {
  const old = await getDocs(chunkCol(listId));
  const b = writeBatch(db);
  const n = Math.ceil(words.length / CHUNK);
  for (let i = 0; i < n; i++) b.set(doc(chunkCol(listId), String(i)), { words: words.slice(i * CHUNK, (i + 1) * CHUNK) });
  old.docs.filter((d) => Number(d.id) >= n).forEach((d) => b.delete(d.ref));
  b.update(fdoc('wordLists', listId), { count: words.length });
  await b.commit();
}

// ---------- 進度 ----------
export function watchProgress(kidId, cb, onErr) {
  return onSnapshot(fdoc('wordProgress', kidId), (s) => cb((s.exists() && s.data().w) || {}), onErr);
}
export const saveProgress = (kidId, patch) => setDoc(fdoc('wordProgress', kidId), { w: patch }, { merge: true });

// ---------- 當天的練習 ----------
export const sessionId = (kidId, date) => `${kidId}_${date}`;
export function watchSession(kidId, date, cb, onErr) {
  return onSnapshot(fdoc('wordSessions', sessionId(kidId, date)), (s) => cb(s.exists() ? s.data() : null), onErr);
}
export async function getSession(kidId, date) {
  const s = await getDoc(fdoc('wordSessions', sessionId(kidId, date)));
  return s.exists() ? s.data() : null;
}
export function watchSessions(kidId, cb, onErr) {
  return onSnapshot(query(fcol('wordSessions'), where('kidId', '==', kidId)),
    (s) => cb(docs(s).sort((a, b) => b.date.localeCompare(a.date))), onErr);
}
export const startSession = (kidId, date, newWords, reviewWords) => setDoc(fdoc('wordSessions', sessionId(kidId, date)), {
  kidId, date, newWords, reviewWords, wrong: [], finished: false, perfect: false, startedAt: serverTimestamp()
});
/** 第一次答錯就記下來（中途離開重來也不會消失，「一次全過」才算數） */
export const recordWrong = (kidId, date, key) => updateDoc(fdoc('wordSessions', sessionId(kidId, date)), { wrong: arrayUnion(key) });
export const finishSession = (kidId, date, perfect) => updateDoc(fdoc('wordSessions', sessionId(kidId, date)), { finished: true, perfect, finishedAt: serverTimestamp() });

/** 載入某個小孩的所有字庫（含單字） */
export async function loadKidLists(lists, kidId) {
  const mine = lists.filter((l) => (l.kids || []).includes(kidId) && l.count > 0);
  return Promise.all(mine.map(async (l) => ({ ...l, words: await loadListWords(l.id) })));
}
