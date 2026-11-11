import { configured, auth, signInAnonymously, onAuthStateChanged } from './firebase.js';
import { state, setState, onState, allowedProfiles, isMom, KIDS } from './state.js';
import { parseRoute, go } from './router.js';
import { watchMyDevice } from './store/devices.js';
import { watchMembers, watchSettings } from './store/family.js';
import { showError, esc } from './ui.js';
import { mountShell } from './views/shell.js';
import { mountPair } from './views/pair.js';
import { mountRoles } from './views/roles.js';
import { mountHome } from './views/home.js';
import { mountChecklist } from './views/checklist.js';
import { mountSchedule } from './views/schedule.js';
import { mountPoints } from './views/points.js';
import { mountSettings } from './views/settings.js';
import { mountMessages } from './views/messages.js';
import { mountWords } from './views/words.js';
import { initNet, showUpdateBar } from './net.js';
import { refreshPushToken } from './push.js';

const appEl = document.getElementById('app');
const VIEWS = { home: mountHome, checklist: mountChecklist, schedule: mountSchedule, messages: mountMessages, words: mountWords, points: mountPoints, settings: mountSettings };

let page = { key: null, cleanup: null };      // 全頁畫面（配對、選身分）或 shell
let shell = null;                             // { key, viewEl, setRoute, refresh, cleanup }
let view = { key: null, cleanup: null };
let familyUnsubs = [];
let autoEntered = false;

/** 選擇身分後進入 */
export function enterProfile(p) {
  setState({ profile: p });
  autoEntered = true;
  const kid = p === 'mom' ? (localStorage.getItem('kp.momKid') || 'kidA') : p;
  go(`/k/${kid}/home`);
}

function startFamilyWatchers() {
  stopFamilyWatchers();
  familyUnsubs = [
    watchMembers((members) => setState({ members, membersReady: true }), (e) => { showError(e, '讀取成員'); setState({ membersReady: true }); }),
    watchSettings((s) => setState({ settings: { bonusAllDone: 0, defaultTaskPoints: 1, ...s }, settingsReady: true }), (e) => { showError(e, '讀取設定'); setState({ settingsReady: true }); })
  ];
}
function stopFamilyWatchers() { familyUnsubs.forEach((u) => u()); familyUnsubs = []; state.membersReady = false; state.settingsReady = false; }

/** 名字、頭像、顏色改變時，畫面要重畫 */
const membersSig = () => JSON.stringify(Object.entries(state.members).sort().map(([k, m]) => [k, m.name, m.emoji, m.color, m.goal || null])) + JSON.stringify(state.settings.subjects || null);

let devUnsub = null;
function watchDevice(uid) {
  devUnsub && devUnsub();
  devUnsub = watchMyDevice(uid, (dev) => {
    if (dev && !state.device) { startFamilyWatchers(); refreshPushToken(); }
    if (!dev) stopFamilyWatchers();
    setState(dev ? { device: dev } : { device: null, profile: null });
  }, (e) => { showError(e, '讀取裝置'); setState({ device: null }); });
}

function clearView() { view.cleanup && view.cleanup(); view = { key: null, cleanup: null }; }
function clearShell() { clearView(); shell && shell.cleanup(); shell = null; }
function clearPage() { page.cleanup && page.cleanup(); page = { key: null, cleanup: null }; }

/** 換一個全新的容器（舊容器上的事件監聽會一併移除） */
function freshRoot() {
  const host = document.createElement('div');
  appEl.replaceChildren(host);
  return host;
}

function showPage(key, mountFn) {
  if (page.key === key) return;
  clearShell(); clearPage();
  page = { key, cleanup: mountFn(freshRoot()) || null };
}

function render() {
  const route = parseRoute();
  if (!state.authReady || state.device === undefined || (state.device && !(state.membersReady && state.settingsReady))) {
    return showPage('splash', (el) => { el.innerHTML = `<div class="splash"><div class="splash-logo">⭐</div><p>載入中…</p></div>`; });
  }
  if (!state.device) return showPage('pair', mountPair);

  const allowed = allowedProfiles();
  if (state.profile && !allowed.includes(state.profile)) return setState({ profile: null });

  if (!state.profile || route.name === 'roles') {
    if (!state.profile && !autoEntered && allowed.length === 1) return enterProfile(allowed[0]);
    if (route.name !== 'roles') return go('/');
    return showPage('roles:' + allowed.join() + membersSig(), (el) => mountRoles(el, { enterProfile, appVersion, checkForUpdate }));
  }

  // ---- 已選擇身分：權限保護 ----
  if (route.name === 'settings' && !isMom()) return go(`/k/${state.profile}/home`);
  if (route.name !== 'settings') {
    if (!isMom() && route.kid !== state.profile) return go(`/k/${state.profile}/${VIEWS[route.name] ? route.name : 'home'}`);
    if (!KIDS.includes(route.kid)) return go(`/k/kidA/home`);
    if (!VIEWS[route.name]) return go(`/k/${route.kid}/home`);
    if (isMom()) localStorage.setItem('kp.momKid', route.kid);
  }

  const shellKey = `${state.profile}|${state.device.isMom}|${(state.device.kids || []).join()}|${membersSig()}`;
  if (!shell || shell.key !== shellKey) {
    clearPage(); clearShell();
    shell = mountShell(freshRoot());
    shell.key = shellKey;
    page.key = 'shell';
  }
  shell.setRoute(route);

  const viewKey = location.hash + membersSig();
  if (view.key !== viewKey) {
    clearView();
    // 每個畫面用全新的容器，離開時事件監聽會跟著容器一起消失（避免重複觸發）
    const host = document.createElement('div');
    host.className = 'view-host';
    shell.viewEl.replaceChildren(host);
    window.scrollTo(0, 0);
    view = { key: viewKey, cleanup: VIEWS[route.name](host, route) || null };
  } else {
    shell.refresh();
  }
}

function renderNotConfigured() {
  appEl.innerHTML = `
    <div class="center-page"><div class="card narrow">
      <h1>⚙️ 尚未設定 Firebase</h1>
      <p>請打開 <code>config.js</code>，貼上 Firebase 專案的設定後重新整理。</p>
      <p class="muted">詳細步驟請看 <code>docs/SETUP.md</code>。<br>開發測試可在網址後加上 <code>?emulator</code> 改用本機模擬器。</p>
    </div></div>`;
}

let swReg = null;

/** 目前執行中的版本（例如 v23）；沒有 Service Worker 時回傳 null */
export function appVersion() {
  return new Promise((resolve) => {
    const sw = navigator.serviceWorker && navigator.serviceWorker.controller;
    if (!sw) return resolve(null);
    const ch = new MessageChannel();
    ch.port1.onmessage = (e) => resolve(e.data);
    setTimeout(() => resolve(null), 1500);
    sw.postMessage('version', [ch.port2]);
  });
}

/** 手動檢查新版。回傳 'found'（已找到，會出現更新按鈕）｜'latest'｜'offline'｜'unsupported' */
export async function checkForUpdate() {
  if (!swReg) return 'unsupported';
  if (!navigator.onLine) return 'offline';
  if (swReg.waiting) return 'found';
  await swReg.update();
  if (swReg.installing || swReg.waiting) return 'found';
  return 'latest';
}

/** Service Worker：有新版本時顯示「更新」，按下後才換版並重新載入 */
function registerSW() {
  let updating = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (updating) location.reload(); });
  // 點了通知、App 已經開著時，跳到通知對應的頁面
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'navigate') location.href = e.data.url;
  });
  // updateViaCache: 'none' → 檢查新版時不使用瀏覽器快取（GitHub Pages 會讓檔案快取 10 分鐘）
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then((reg) => {
    swReg = reg;
    const offer = (w) => showUpdateBar(() => { updating = true; w.postMessage('skipWaiting'); });
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w && w.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w);
      });
    });
    // 檢查新版的時機：App 回到前景、切換畫面、開著的時候每 5 分鐘
    const check = () => { if (document.visibilityState === 'visible' && navigator.onLine) reg.update().catch(() => {}); };
    document.addEventListener('visibilitychange', check);
    window.addEventListener('hashchange', check);
    setInterval(check, 5 * 60000);
  }).catch((e) => console.warn('SW', e));
}

function boot() {
  initNet();
  if ('serviceWorker' in navigator && !location.search.includes('nosw')) registerSW();
  if (!configured) return renderNotConfigured();

  onAuthStateChanged(auth, (user) => {
    if (!user) {
      signInAnonymously(auth).catch((e) => {
        appEl.innerHTML = `<div class="center-page"><div class="card narrow"><h1>無法登入</h1>
          <p>${esc(e.message)}</p><p class="muted">請確認 Firebase 已啟用「匿名登入」。</p></div></div>`;
      });
      return;
    }
    if (state.uid === user.uid) return;
    setState({ uid: user.uid, authReady: true });
    watchDevice(user.uid);
  });
  window.addEventListener('hashchange', render);
  onState(render);
  render();
}

boot();
