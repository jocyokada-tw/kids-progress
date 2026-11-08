import { state, isMom, KIDS, member, memberColor } from '../state.js';
import { go } from '../router.js';
import { esc, showError } from '../ui.js';
import { watchPendingTasks } from '../store/tasks.js';
import { watchPendingItems } from '../store/checklist.js';

const TABS = [
  { name: 'home', icon: '🏠', label: '首頁' },
  { name: 'checklist', icon: '✅', label: '清單' },
  { name: 'schedule', icon: '📅', label: '排程' },
  { name: 'points', icon: '⭐', label: '點數' }
];

export function mountShell(root) {
  root.innerHTML = `
    <div class="shell">
      <header class="topbar"></header>
      <div class="shell-body">
        <nav class="tabs" aria-label="主選單"></nav>
        <main class="view"></main>
      </div>
    </div>`;
  const topbar = root.querySelector('.topbar');
  const tabsEl = root.querySelector('.tabs');
  const viewEl = root.querySelector('.view');
  let route = null;

  // 媽媽：即時顯示每個小孩有幾項待處理
  const badges = Object.fromEntries(KIDS.map((k) => [k, { tasks: 0, items: 0 }]));
  const unsubs = [];
  if (isMom()) {
    for (const k of KIDS) {
      unsubs.push(watchPendingTasks(k, (l) => { badges[k].tasks = l.length; draw(); }, (e) => showError(e, '讀取待確認')));
      unsubs.push(watchPendingItems(k, (l) => { badges[k].items = l.length; draw(); }, (e) => showError(e, '讀取待核可')));
    }
  }

  const badge = (n) => (n > 0 ? `<span class="badge">${n}</span>` : '');

  function draw() {
    if (!route) return;
    const me = member(state.profile);
    const kid = route.kid || localStorage.getItem('kp.momKid') || 'kidA';
    root.querySelector('.shell').style.setProperty('--kid', memberColor(isMom() ? kid : state.profile));

    topbar.innerHTML = `
      <button class="who" data-go="/" aria-label="切換身分">
        <span class="avatar" style="background:${memberColor(state.profile)}">${esc(me.emoji)}</span>
        <span class="who-name">${esc(me.name)}</span><span class="who-switch">切換</span>
      </button>
      ${isMom() ? `<div class="kid-switch" role="tablist">${KIDS.map((k) => {
        const m = member(k);
        const n = badges[k].tasks + badges[k].items;
        const tab = route.name === 'settings' ? 'home' : route.name;
        return `<button role="tab" class="kid-chip ${k === route.kid ? 'active' : ''}" style="--c:${memberColor(k)}" data-go="/k/${k}/${tab}">
          <span>${esc(m.emoji)}</span><span class="kid-chip-name">${esc(m.name)}</span>${badge(n)}</button>`;
      }).join('')}</div>` : ''}`;

    const tabs = [...TABS, ...(isMom() ? [{ name: 'settings', icon: '⚙️', label: '設定' }] : [])];
    tabsEl.innerHTML = tabs.map((t) => {
      const path = t.name === 'settings' ? '/settings' : `/k/${kid}/${t.name}`;
      let n = 0;
      if (isMom() && t.name === 'checklist') n = badges[kid].items;
      if (isMom() && t.name === 'schedule') n = badges[kid].tasks;
      return `<button class="tab ${route.name === t.name ? 'active' : ''}" data-go="${path}">
        <span class="tab-icon">${t.icon}</span><span class="tab-label">${t.label}</span>${badge(n)}</button>`;
    }).join('');
  }

  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-go]');
    if (b && root.contains(b) && !b.closest('.view')) go(b.dataset.go);
  });

  return {
    viewEl,
    setRoute(r) { route = r; draw(); },
    refresh: draw,
    cleanup() { unsubs.forEach((u) => u()); }
  };
}
