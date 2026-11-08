import { db, getDoc, onSnapshot, writeBatch, setDoc, serverTimestamp } from '../firebase.js';
import { familyRef, fcol, fdoc } from './paths.js';
import { hashPin } from '../utils/crypto.js';

const MOM_KEY = 'kp.momKey';

export async function familyExists() {
  return (await getDoc(familyRef())).exists();
}

/** 第一次使用：建立家庭，並把這台裝置設為媽媽裝置（一次批次寫入，安全規則會檢查） */
export async function setupFamily({ uid, pin, kidAName, kidBName }) {
  const { hash, salt } = await hashPin(pin);
  const b = writeBatch(db);
  b.set(familyRef(), { setupBy: uid, createdAt: serverTimestamp() });
  b.set(fdoc('devices', uid), { isMom: true, kids: ['kidA', 'kidB'], label: '媽媽的裝置', pairedAt: serverTimestamp() });
  b.set(fdoc('members', 'mom'), { role: 'mom', name: '媽媽', emoji: '👩', color: 'rose' });
  b.set(fdoc('members', 'kidA'), { role: 'kid', name: kidAName, emoji: '🦊', color: 'orange' });
  b.set(fdoc('members', 'kidB'), { role: 'kid', name: kidBName, emoji: '🐳', color: 'blue' });
  b.set(fdoc('meta', 'settings'), { bonusAllDone: 5, defaultTaskPoints: 2 });
  b.set(fdoc('private', 'pin'), { hash, salt, updatedAt: serverTimestamp() });
  await b.commit();
  localStorage.setItem(MOM_KEY, hash);
}

export function watchMembers(cb, onErr) {
  return onSnapshot(fcol('members'), (snap) => {
    const m = {};
    snap.forEach((d) => { m[d.id] = d.data(); });
    cb(m);
  }, onErr);
}
export const saveMember = (id, data) => setDoc(fdoc('members', id), data, { merge: true });

export function watchSettings(cb, onErr) {
  return onSnapshot(fdoc('meta', 'settings'), (s) => cb(s.exists() ? s.data() : {}), onErr);
}
export const saveSettings = (data) => setDoc(fdoc('meta', 'settings'), data, { merge: true });

// ---- 媽媽 PIN（只有媽媽裝置能讀寫 private/pin） ----
async function readPin() {
  const s = await getDoc(fdoc('private', 'pin'));
  return s.exists() ? s.data() : null;
}

/** 這台裝置是否已經記住媽媽 PIN（PIN 改過就會失效） */
export async function momRemembered() {
  const saved = localStorage.getItem(MOM_KEY);
  if (!saved) return false;
  const p = await readPin();
  return !!p && p.hash === saved;
}

export async function verifyPin(pin) {
  const p = await readPin();
  if (!p) return false;
  const { hash } = await hashPin(pin, p.salt);
  if (hash !== p.hash) return false;
  localStorage.setItem(MOM_KEY, hash);
  return true;
}

/** 是否已設定 PIN（若在主控台刪除 private/pin，可重新設定） */
export async function pinExists() { return !!(await readPin()); }

export async function changePin(pin) {
  const { hash, salt } = await hashPin(pin);
  await setDoc(fdoc('private', 'pin'), { hash, salt, updatedAt: serverTimestamp() });
  localStorage.setItem(MOM_KEY, hash);
}

export const forgetMomOnThisDevice = () => localStorage.removeItem(MOM_KEY);
