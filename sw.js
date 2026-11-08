// Service Worker：快取 App 外殼，讓啟動更快、短暫斷線也能打開。
// 資料同步由 Firestore 自己處理（含離線快取）。
// ⚠️ 每次更新程式後，把 VERSION 加 1，裝置才會抓到新版。
const VERSION = 'v1';
const CACHE = `kids-progress-${VERSION}`;
const SHELL = [
  './', './index.html', './manifest.json', './config.js',
  './css/base.css', './css/components.css',
  './js/app.js', './js/firebase.js', './js/state.js', './js/router.js', './js/ui.js',
  './js/utils/date.js', './js/utils/crypto.js',
  './js/store/paths.js', './js/store/family.js', './js/store/devices.js', './js/store/tasks.js',
  './js/store/routines.js', './js/store/checklist.js', './js/store/ledger.js',
  './js/views/shell.js', './js/views/pair.js', './js/views/roles.js', './js/views/home.js',
  './js/views/checklist-panel.js', './js/views/checklist.js', './js/views/schedule.js',
  './js/views/points.js', './js/views/settings.js',
  './icons/icon-192.png', './icons/apple-touch-icon.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
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
