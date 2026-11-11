// Service Worker：快取 App 外殼（離線也能打開）、顯示推播通知。
// 資料同步由 Firestore 自己處理（含離線快取）。
// ⚠️ 每次更新程式後，把 VERSION 加 1，裝置才會抓到新版。
const VERSION = 'v16';
const CACHE = `kids-progress-${VERSION}`;
const SHELL = [
  './', './index.html', './manifest.json', './config.js',
  './css/base.css', './css/components.css',
  './js/app.js', './js/firebase.js', './js/state.js', './js/router.js', './js/ui.js',
  './js/utils/date.js', './js/utils/crypto.js',
  './js/store/paths.js', './js/store/family.js', './js/store/devices.js', './js/store/tasks.js',
  './js/store/routines.js', './js/store/checklist.js', './js/store/ledger.js',
  './js/store/events.js', './js/store/rewards.js', './js/store/messages.js',
  './js/views/shell.js', './js/views/pair.js', './js/views/roles.js', './js/views/home.js',
  './js/views/checklist-panel.js', './js/views/checklist.js', './js/views/schedule.js',
  './js/views/points.js', './js/views/settings.js', './js/views/messages.js', './js/views/goal.js',
  './js/push.js', './js/net.js', './js/views/push-card.js', './js/views/calendar.js', './js/views/words.js', './js/store/words.js', './js/utils/speak.js', './js/utils/srs.js',
  './icons/icon-192.png', './icons/apple-touch-icon.png'
];

// Firebase SDK 也在安裝時一起存起來，第一次離線打開也能用
const SDK = ['app', 'auth', 'firestore', 'messaging'].map((n) => `https://www.gstatic.com/firebasejs/12.19.0/firebase-${n}.js`);

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(async (c) => {
    await c.addAll(SHELL);
    await Promise.all(SDK.map((u) => c.add(u).catch(() => {})));
  }));
  // 不自動接手：等使用者在畫面上按「更新」（見 js/app.js）
});

self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('kids-progress-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Firebase SDK（版本號固定在網址裡，內容不會變）→ 快取優先
  if (url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/')) {
    e.respondWith(caches.open(CACHE).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    }));
    return;
  }
  if (url.origin !== location.origin) return;  // Firestore 等其他連線不攔截

  // 自己的檔案 → 網路優先（拿到最新版），離線時用快取
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
      return res;
    }).catch(async () => (await caches.match(req, { ignoreSearch: true })) || caches.match('./index.html'))
  );
});

// ---------- 推播通知 ----------
// 伺服器（functions/）送來的是 data 訊息：{ title, body, url, tag }
self.addEventListener('push', (e) => {
  let payload = {};
  try { payload = e.data ? e.data.json() : {}; } catch { payload = { data: { title: '親子進度', body: e.data && e.data.text() } }; }
  const d = payload.data || payload.notification || payload;
  e.waitUntil(self.registration.showNotification(d.title || '親子進度', {
    body: d.body || '',
    tag: d.tag || undefined,
    data: { url: d.url || '' },
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png'
  }));
});

// 點通知 → 打開 App 並跳到相關頁面
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL('./' + ((e.notification.data && e.notification.data.url) || ''), self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) {
      if ('focus' in c) {
        c.postMessage({ type: 'navigate', url });
        return c.focus();
      }
    }
    return self.clients.openWindow(url);
  }));
});
