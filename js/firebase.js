// 集中載入 Firebase（CDN 版 modular SDK）。其他檔案一律從這裡 import，
// 升級版本時只要改這個檔案的版本號。
import { firebaseConfig } from '../config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {
  getAuth, connectAuthEmulator
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  memoryLocalCache, connectFirestoreEmulator
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

export * from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
export { signInAnonymously, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';

// 本機測試：網址加上 ?emulator 會改連 Firebase 模擬器（不碰正式資料）
const params = new URLSearchParams(location.search);
if (params.has('emulator')) sessionStorage.setItem('kp.emu', '1');
export const useEmulator = sessionStorage.getItem('kp.emu') === '1';

export const configured = useEmulator || !!(firebaseConfig && firebaseConfig.apiKey && firebaseConfig.projectId);

export let app = null;
export let auth = null;
export let db = null;

if (configured) {
  app = initializeApp(useEmulator
    ? { apiKey: 'demo-key', projectId: 'demo-kids', appId: 'demo-app' }
    : firebaseConfig);
  auth = getAuth(app);
  db = initializeFirestore(app, {
    localCache: useEmulator
      ? memoryLocalCache()
      : persistentLocalCache({ tabManager: persistentMultipleTabManager() })
  });
  if (useEmulator) {
    const host = location.hostname;
    connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
    connectFirestoreEmulator(db, host, 8080);
  }
}
