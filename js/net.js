// 網路狀態與新版提示：畫面上方的小橫條
import { db, waitForPendingWrites } from './firebase.js';

let netBar = null;
let hideTimer = null;

function bar() {
  if (!netBar) {
    netBar = document.createElement('div');
    netBar.className = 'net-bar';
    netBar.setAttribute('role', 'status');
    netBar.hidden = true;
    document.body.appendChild(netBar);
  }
  return netBar;
}
function show(text, kind, ms) {
  const b = bar();
  clearTimeout(hideTimer);
  b.className = `net-bar net-${kind}`;
  b.textContent = text;
  b.hidden = false;
  if (ms) hideTimer = setTimeout(() => { b.hidden = true; }, ms);
}

const OFFLINE = '📴 目前離線：勾選、留言、排程會先存在這台裝置，連上網路後自動同步';

export function initNet() {
  window.addEventListener('offline', () => show(OFFLINE, 'off'));
  window.addEventListener('online', async () => {
    show('🔄 已連上網路，同步中…', 'sync');
    try {
      await waitForPendingWrites(db);
      show('✓ 已同步', 'ok', 2000);
    } catch { bar().hidden = true; }
  });
  if (!navigator.onLine) show(OFFLINE, 'off');
}

/** 核可、兌換、配對這類動作需要即時確認伺服器資料，離線時先擋下並說明 */
export function needOnline(what) {
  if (!navigator.onLine) throw new Error(`需要網路連線才能${what}，請連上網路後再試一次`);
}

/** 有新版本時顯示「更新」按鈕 */
export function showUpdateBar(onUpdate) {
  if (document.querySelector('.update-bar')) return;
  const b = document.createElement('div');
  b.className = 'update-bar';
  b.innerHTML = '<span>✨ 有新版本</span><button class="btn btn-sm btn-primary" type="button">立即更新</button>';
  b.querySelector('button').onclick = () => { b.querySelector('button').disabled = true; onUpdate(); };
  document.body.appendChild(b);
}
