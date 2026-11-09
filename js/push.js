// 推播通知（Firebase Cloud Messaging）。每台裝置各自開啟。
import { app, useEmulator, setDoc, deleteDoc, serverTimestamp } from './firebase.js';
import { vapidKey } from '../config.js';
import { fdoc } from './store/paths.js';
import { state } from './state.js';

const SDK = 'https://www.gstatic.com/firebasejs/12.19.0/firebase-messaging.js';
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1);
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

/**
 * 回傳這台裝置的通知狀態：
 * no-key（尚未設定金鑰）| need-install（iPhone/iPad 要先加入主畫面）| unsupported | denied | off | on
 */
export function pushStatus() {
  if (!vapidKey) return 'no-key';
  if (isIOS() && !isStandalone()) return 'need-install';
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission === 'granted' && localStorage.getItem('kp.push') === '1') return 'on';
  return 'off';
}

async function registerToken() {
  const { getMessaging, getToken, isSupported } = await import(SDK);
  if (!(await isSupported())) throw new Error('這個瀏覽器不支援推播通知');
  const reg = await navigator.serviceWorker.ready;
  const token = await getToken(getMessaging(app), { vapidKey, serviceWorkerRegistration: reg });
  if (!token) throw new Error('無法取得通知權杖');
  await setDoc(fdoc('pushTokens', state.uid), { token, ua: navigator.userAgent.slice(0, 120), updatedAt: serverTimestamp() });
  localStorage.setItem('kp.push', '1');
}

/** 必須在使用者點按鈕時呼叫（iOS 規定） */
export async function enablePush() {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error(perm === 'denied' ? '通知被拒絕了，請到「設定 → 通知」開啟' : '沒有允許通知');
  if (useEmulator) { localStorage.setItem('kp.push', '1'); return; }
  await registerToken();
}

export async function disablePush() {
  localStorage.removeItem('kp.push');
  try {
    const { getMessaging, deleteToken } = await import(SDK);
    await deleteToken(getMessaging(app));
  } catch (e) { console.warn('deleteToken', e); }
  await deleteDoc(fdoc('pushTokens', state.uid));
}

/** App 啟動時：已開啟通知的裝置更新一次權杖（權杖可能會變） */
export function refreshPushToken() {
  if (useEmulator || pushStatus() !== 'on' || !navigator.onLine) return;
  registerToken().catch((e) => console.warn('refresh push token', e));
}

export const PUSH_HELP = {
  'no-key': '通知功能尚未設定（需要在 config.js 填入推播金鑰）。',
  'need-install': '請先用 Safari「分享 → 加入主畫面」，再從主畫面的圖示打開，才能開啟通知。',
  unsupported: '這個瀏覽器不支援通知（iPhone／iPad 需要 iOS 16.4 以上）。',
  denied: '通知被關閉了。請到 iPhone「設定 → 通知 → 親子進度」重新允許。',
  off: '開啟後，媽媽確認、留言等消息會即時通知這台裝置。',
  on: '這台裝置已開啟通知 ✓'
};
