import { state, isMom, member } from '../state.js';
import { esc, showError } from '../ui.js';
import { go } from '../router.js';
import { watchLedger } from '../store/ledger.js';
import { watchPendingItems } from '../store/checklist.js';
import { watchTasksRange, watchPendingTasks } from '../store/tasks.js';
import { todayStr, addDays, labelMD, labelRelative } from '../utils/date.js';
import { mountChecklistPanel } from './checklist-panel.js';

export const TASK_STATUS = {
  pending: '<span class="tag tag-wait">待媽媽確認</span>',
  rejected: '<span class="tag tag-bad">已退回</span>',
  approved: ''
};

/** 儀表板：目前點數、今日清單、一個月內的行程 */
export function mountHome(el, { kid }) {
  const today = todayStr();
  const m = member(kid);
  el.innerHTML = `
    <section class="hero card">
      <div class="hero-hi">${isMom() ? `${esc(m.emoji)} ${esc(m.name)}` : `嗨，${esc(m.name)}！${esc(m.emoji)}`}</div>
      <button class="hero-points" data-go="/k/${kid}/points">
        <span class="hero-num" id="balance">–</span><span class="hero-unit">點 ⭐</span>
      </button>
      <div class="hero-sub" id="pendingPts"></div>
      <div id="momTodo"></div>
    </section>
    <div class="grid-2">
      <section class="card">
        <div class="card-head"><h2>今日清單 <span class="muted small">${labelMD(today)}</span></h2>
          <button class="btn btn-sm btn-ghost" data-go="/k/${kid}/checklist">查看</button></div>
        <div id="today"></div>
      </section>
      <section class="card">
        <div class="card-head"><h2>一個月內的行程</h2>
          <button class="btn btn-sm btn-ghost" data-go="/k/${kid}/schedule">排程</button></div>
        <div id="month"><p class="empty">載入中…</p></div>
      </section>
    </div>`;

  const $ = (s) => el.querySelector(s);
  let pendingItems = [], pendingTasks = [];
  const drawPending = () => {
    const pts = pendingItems.reduce((s, i) => s + (i.points || 0), 0);
    $('#pendingPts').textContent = pts ? `另有 ${pts} 點等待媽媽核可` : '';
    if (isMom()) {
      const parts = [];
      if (pendingItems.length) parts.push(`<button class="todo-pill" data-go="/k/${kid}/checklist">✅ ${pendingItems.length} 項待核可</button>`);
      if (pendingTasks.length) parts.push(`<button class="todo-pill" data-go="/k/${kid}/schedule">📅 ${pendingTasks.length} 項進度待確認</button>`);
      $('#momTodo').innerHTML = parts.length ? `<div class="todo-row">${parts.join('')}</div>` : '';
    }
  };

  const unsubs = [
    watchLedger(kid, ({ balance }) => { $('#balance').textContent = balance; }, (e) => showError(e, '讀取點數')),
    watchPendingItems(kid, (l) => { pendingItems = l; drawPending(); }, (e) => showError(e, '讀取待核可')),
    watchTasksRange(kid, today, addDays(today, 30), (tasks) => {
      const list = tasks.filter((t) => t.status !== 'rejected');
      if (!list.length) { $('#month').innerHTML = '<p class="empty">接下來一個月還沒有安排 ☀️</p>'; return; }
      const byDate = new Map();
      list.forEach((t) => { if (!byDate.has(t.date)) byDate.set(t.date, []); byDate.get(t.date).push(t); });
      $('#month').innerHTML = `<ul class="agenda">${[...byDate].map(([d, ts]) => `
        <li><div class="agenda-date">${labelMD(d)}${labelRelative(d) ? `<span class="rel">${labelRelative(d)}</span>` : ''}</div>
          <ul>${ts.map((t) => `<li class="agenda-item">${esc(t.title)} ${TASK_STATUS[t.status] || ''}${t.points ? `<span class="pts sm">+${t.points}</span>` : ''}</li>`).join('')}</ul></li>`).join('')}</ul>`;
    }, (e) => showError(e, '讀取行程'))
  ];
  if (isMom()) unsubs.push(watchPendingTasks(kid, (l) => { pendingTasks = l; drawPending(); }, (e) => showError(e)));

  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-go]');
    if (b) go(b.dataset.go);
  });

  const cleanPanel = mountChecklistPanel($('#today'), { kid, date: today });
  return () => { unsubs.forEach((u) => u()); cleanPanel(); };
}
