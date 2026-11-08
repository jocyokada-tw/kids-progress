import { db, onSnapshot, setDoc, deleteDoc, writeBatch, serverTimestamp } from '../firebase.js';
import { fcol, fdoc, docs, tsMillis } from './paths.js';

export function watchMyDevice(uid, cb, onErr) {
  // 只採用伺服器確認過的狀態：剛建立家庭時，本機寫入還沒被伺服器接受前不要當作已配對
  return onSnapshot(fdoc('devices', uid), { includeMetadataChanges: true }, (s) => {
    if (s.metadata.hasPendingWrites) return;
    cb(s.exists() ? { id: s.id, ...s.data() } : null);
  }, onErr);
}

/** 未配對的裝置送出配對申請，回傳 4 位數代碼讓媽媽核對 */
export async function requestPairing(uid, label) {
  const code = String(Math.floor(1000 + Math.random() * 9000));
  await setDoc(fdoc('pairRequests', uid), { code, label, createdAt: serverTimestamp() });
  return code;
}
export function watchMyPairRequest(uid, cb, onErr) {
  return onSnapshot(fdoc('pairRequests', uid), (s) => cb(s.exists() ? s.data() : null), onErr);
}
export const cancelPairRequest = (uid) => deleteDoc(fdoc('pairRequests', uid));

// ---- 以下只有媽媽裝置可以呼叫 ----
export function watchPairRequests(cb, onErr) {
  return onSnapshot(fcol('pairRequests'), (snap) => cb(docs(snap).sort((a, b) => tsMillis(a.createdAt) - tsMillis(b.createdAt))), onErr);
}
export async function approvePair(reqId, { isMom, kids, label }) {
  const b = writeBatch(db);
  b.set(fdoc('devices', reqId), { isMom, kids, label, pairedAt: serverTimestamp() });
  b.delete(fdoc('pairRequests', reqId));
  await b.commit();
}
export const rejectPair = (reqId) => deleteDoc(fdoc('pairRequests', reqId));

export function watchDevices(cb, onErr) {
  return onSnapshot(fcol('devices'), (snap) => cb(docs(snap).sort((a, b) => tsMillis(a.pairedAt) - tsMillis(b.pairedAt))), onErr);
}
export const removeDevice = (id) => deleteDoc(fdoc('devices', id));
