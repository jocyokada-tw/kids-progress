import { isMom, member } from '../state.js';
import { esc, showError } from '../ui.js';
import { go } from '../router.js';
import { watchLedger } from '../store/ledger.js';
import { watchPendingItems } from '../store/checklist.js';
import { watchPendingTasks, watchUnscheduled } from '../store/tasks.js';
import { todayStr, labelMD } from '../utils/date.js';
import { mountChecklistPanel } from './checklist-panel.js';
import { mountEventCalendar } from './calendar.js';
import { goalHtml } from './goal.js';
import { watchPendingRedemptions } from '../store/rewards.js';
import { mountPushCard, shouldPromptPush } from './push-card.js';

export const TASK_STATUS = {
  pending: '<span class="tag tag-wait">待媽媽確認</span>',
  rejected: '<span class="tag tag-bad">已退回</span>',
  approved: ''
};

/** 儀表板：目前點數、目標、今日清單、行程月曆（只有課程） */
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
    <section class="card" id="pushPrompt" hidden></section>
    <section class="card" id="goal" hidden></section>
    <div class="grid-2">
      <section class="card">
        <div class="card-head"><h2>今日清單 <span class="muted small">${labelMD(today)}</span></h2>
          <button class="btn btn-sm btn-ghost" data-go="/k/${kid}/checklist">查看</button></div>
        <div id="today"></div>
      </section>
      <section class="card">
        <div class="card-head"><h2>📆 行程月曆</h2>
          <button class="btn btn-sm btn-ghost" data-go="/k/${kid}/schedule">排程</button></div>
        <div id="calendar"></div>
      </section>
    </div>`;

  const $ = (s) => el.querySelector(s);
  let pendingItems = [], pendingTasks = [], pendingRedeem = [], unscheduled = [];
  const drawPending = () => {
    const pts = pendingItems.reduce((s, i) => s + (i.points || 0), 0);
    $('#pendingPts').textContent = pts ? `另有 ${pts} 點等待媽媽核可` : '';
    if (isMom()) {
      const parts = [];
      if (pendingItems.length) parts.push(`<button class="todo-pill" data-go="/k/${kid}/checklist">✅ ${pendingItems.length} 項待核可</button>`);
      if (pendingTasks.length) parts.push(`<button class="todo-pill" data-go="/k/${kid}/schedule">📅 ${pendingTasks.length} 項進度待確認</button>`);
      if (pendingRedeem.length) parts.push(`<button class="todo-pill" data-go="/k/${kid}/points">🎁 ${pendingRedeem.length} 項兌換申請</button>`);
      const overdue = unscheduled.filter((t) => t.weekEnd < today).length;
      const open = unscheduled.length - overdue;
      if (open) parts.push(`<button class="todo-pill" data-go="/k/${kid}/schedule">📦 ${open} 項本週進度還沒排</button>`);
      if (overdue) parts.push(`<button class="todo-pill bad" data-go="/k/${kid}/schedule">⚠️ ${overdue} 項逾期未安排</button>`);
      $('#momTodo').innerHTML = parts.length ? `<div class="todo-row">${parts.join('')}</div>` : '';
    } else {
      const open = unscheduled.filter((t) => t.weekEnd >= today && t.week <= today).length;
      $('#momTodo').innerHTML = open ? `<div class="todo-row"><button class="todo-pill" data-go="/k/${kid}/schedule">📦 本週還有 ${open} 項進度要安排</button></div>` : '';
    }
  };

  const goal = member(kid).goal;
  const unsubs = [
    watchLedger(kid, ({ balance }) => {
      $('#balance').textContent = balance;
      const g = goalHtml(goal, balance);
      $('#goal').hidden = !g;
      $('#goal').innerHTML = g;
    }, (e) => showError(e, '讀取點數')),
    watchPendingItems(kid, (l) => { pendingItems = l; drawPending(); }, (e) => showError(e, '讀取待核可'))
  ];
  unsubs.push(watchUnscheduled(kid, (l) => { unscheduled = l; drawPending(); }, (e) => showError(e)));
  if (isMom()) {
    unsubs.push(watchPendingTasks(kid, (l) => { pendingTasks = l; drawPending(); }, (e) => showError(e)));
    unsubs.push(watchPendingRedemptions(kid, (l) => { pendingRedeem = l; drawPending(); }, (e) => showError(e)));
  }

  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-go]');
    if (b) go(b.dataset.go);
  });

  if (shouldPromptPush()) mountPushCard($('#pushPrompt'), { compact: true });
  const cleanPanel = mountChecklistPanel($('#today'), { kid, date: today });
  const cleanCal = mountEventCalendar($('#calendar'), { kid });
  return () => { unsubs.forEach((u) => u()); cleanPanel(); cleanCal(); };
}
