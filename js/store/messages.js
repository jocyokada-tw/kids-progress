import { query, orderBy, limit, onSnapshot, addDoc, setDoc, serverTimestamp, collection } from '../firebase.js';
import { fdoc, docs } from './paths.js';

// 留言板：threads/{kidId}（記錄雙方最後讀取時間）＋ threads/{kidId}/messages/{id}
// from: 'mom' | 'kid'
const msgCol = (kidId) => collection(fdoc('threads', kidId), 'messages');

export function watchThread(kidId, cb, onErr) {
  return onSnapshot(fdoc('threads', kidId), (s) => cb(s.exists() ? s.data() : {}), onErr);
}
export function watchMessages(kidId, cb, onErr, max = 200) {
  const q = query(msgCol(kidId), orderBy('createdAt', 'desc'), limit(max));
  return onSnapshot(q, (s) => cb(docs(s).reverse()), onErr);
}
export const sendMessage = (kidId, from, text) => addDoc(msgCol(kidId), { from, text, createdAt: serverTimestamp() });

/** 標記為已讀（媽媽寫 momReadAt，小孩寫 kidReadAt） */
export const markRead = (kidId, who) => setDoc(fdoc('threads', kidId), { [who === 'mom' ? 'momReadAt' : 'kidReadAt']: serverTimestamp() }, { merge: true });

const ms = (ts) => (ts && ts.toMillis ? ts.toMillis() : 0);
/** 對方傳來、我還沒讀的則數 */
export function unreadCount(messages, thread, me) {
  const myRead = ms(me === 'mom' ? thread.momReadAt : thread.kidReadAt);
  return messages.filter((m) => m.from !== me && m.createdAt && ms(m.createdAt) > myRead).length;
}
/** 我傳的這則，對方讀過了嗎 */
export function isReadByOther(msg, thread) {
  if (!msg.createdAt) return false;
  const other = ms(msg.from === 'mom' ? thread.kidReadAt : thread.momReadAt);
  return other >= ms(msg.createdAt);
}
