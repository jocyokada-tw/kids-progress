import { db, getDoc, getDocs, query, limit, onSnapshot, writeBatch, setDoc, serverTimestamp } from '../firebase.js';
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
  b.set(fdoc('meta', 'settings'), { bonusAllDone: 5, defaultTaskPoints: 2, defaultsVersion: DEFAULTS_VERSION });
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

/** 媽媽設定小孩的目標：{ title, emoji, points, rewardId }，傳 null 代表清除 */
export const saveGoal = (kidId, goal) => setDoc(fdoc('members', kidId), { goal: goal || null }, { merge: true });

// ---- 預設值版本 ----
// 第 2 版起，課後小記預設不開、預設科目不含特定家庭的才藝課。
// 之前就在使用的家庭，如果沒有存過這些設定，原本是靠舊的預設值運作；第一次打開新版時把舊的預設值寫進設定，原本的使用方式不變。
export const DEFAULTS_VERSION = 2;
const LEGACY = {
  journal: {
    kids: ['kidA'],
    schedule: { kidA: [
      { weekday: 2, category: 'math_science', count: 1 }, { weekday: 2, category: 'project', count: 1 },
      { weekday: 4, category: 'project', count: 1 }, { weekday: 4, category: 'humanities', count: 2 },
      { weekday: 5, category: 'math_science', count: 1 }
    ] }
  },
  subjects: [
    { id: 'chinese', name: '國語', color: '#3d7be0' }, { id: 'math', name: '數學', color: '#e5484d' },
    { id: 'social', name: '社會', color: '#b08060' }, { id: 'science', name: '自然', color: '#2f9e44' },
    { id: 'english', name: '英文', color: '#ff9f80' }, { id: 'jusmile', name: '朱宗慶', color: '#a3d65c' }
  ]
};
/** 媽媽裝置載入設定後呼叫一次。回傳寫入的內容（沒有要做的事回傳 null） */
export async function migrateDefaults(settings) {
  if ((settings.defaultsVersion || 0) >= DEFAULTS_VERSION) return null;
  // 已經用過的家庭（有清單項目）才需要保留舊的預設值；新建的家庭直接用新的預設值
  const used = !(await getDocs(query(fcol('items'), limit(1)))).empty;
  const patch = { defaultsVersion: DEFAULTS_VERSION };
  if (used && !settings.journal) patch.journal = LEGACY.journal;
  if (used && !Array.isArray(settings.subjects)) patch.subjects = LEGACY.subjects;
  await setDoc(fdoc('meta', 'settings'), patch, { merge: true });
  return patch;
}

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
