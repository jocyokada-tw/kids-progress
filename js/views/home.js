import { state, isMom, member } from '../state.js';
import { esc, showError } from '../ui.js';
import { go } from '../router.js';
import { watchLedger } from '../store/ledger.js';
import { watchPendingItems } from '../store/checklist.js';
import { watchPendingTasks, watchUnscheduled, watchDue } from '../store/tasks.js';
import { getItemOnce } from '../store/checklist.js';
import { todayStr, labelMD, addDays, dueTag } from '../utils/date.js';
import { mountChecklistPanel } from './checklist-panel.js';
import { mountEventCalendar } from './calendar.js';
import { watchWordLists, watchSession } from '../store/words.js';
import { goalHtml } from './goal.js';
import { watchPendingRedemptions } from '../store/rewards.js';
import { mountPushCard, shouldPromptPush } from './push-card.js';
import { journalSettings, usesJournal, writableDates, isClassDay } from '../utils/journal.js';
import { watchNotes } from '../store/journal.js';
import { noteStatus } from './journal.js';

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
    <section class="card due-card" id="dueCard" hidden></section>
    <section class="card" id="goal" hidden></section>
    <section class="card" id="wordsCard" hidden></section>
    <section class="card" id="journalCard" hidden></section>
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

  // 快到期的作業：2 天內到期、或已經過期還沒完成的
  let dueSeq = 0;
  unsubs.push(watchDue(kid, addDays(today, -30), addDays(today, 2), async (list) => {
    const seq = ++dueSeq;
    const rows = await Promise.all(list.map(async (t) => {
      const it = t.date ? await getItemOnce(kid, t.date, t.id).catch(() => null) : null;
      return { t, waiting: !!(it && (it.done || it.review === 'pending')) };
    }));
    if (seq !== dueSeq) return;
    const c = $('#dueCard');
    c.hidden = !rows.length;
    c.innerHTML = rows.length ? `<h2>⏳ 快到期的作業</h2><ul class="rows">${rows.map(({ t, waiting }) => `
      <li class="row"><span class="grow"><strong>${esc(t.title)}</strong><br>${dueTag(t.due, today)}
        <span class="muted small">${waiting ? '✓ 已完成，等媽媽核可' : t.date ? `排在 ${labelMD(t.date)}` : '📦 還沒排日期'}</span></span></li>`).join('')}</ul>` : '';
  }, (e) => showError(e, '讀取期限')));

  // 每日單字入口
  let hasWords = false, wordSession;
  const drawWords = () => {
    const c = $('#wordsCard');
    c.hidden = !hasWords;
    if (!hasWords) return;
    const s = wordSession;
    const status = !s ? (isMom() ? '今天還沒開始' : '今天的單字還沒學喔') : !s.finished ? '進行中' : s.perfect ? '今天完成了，一次全對 🎯' : `今天完成了（${(s.wrong || []).length} 個字要再加油）`;
    c.innerHTML = `<div class="push-card"><span style="font-size:2rem">📖</span>
      <div class="grow"><strong>每日單字</strong><br><span class="muted small">${status}</span></div>
      <button class="btn ${s && s.finished ? 'btn-ghost' : 'btn-primary'}" data-go="/k/${kid}/words">${isMom() ? '查看' : s && s.finished ? '看單字' : s ? '繼續 ▶' : '開始 ▶'}</button></div>`;
  };
  unsubs.push(watchWordLists((l) => { hasWords = l.some((x) => (x.kids || []).includes(kid) && x.count > 0); drawWords(); }, (e) => showError(e, '讀取字庫')));
  unsubs.push(watchSession(kid, today, (s) => { wordSession = s; drawWords(); }, (e) => showError(e, '讀取單字')));

  // 課後小記入口：上課日、或本週還有沒寫的上課日才出現。不催促，只是溫和提醒
  const jcfg = journalSettings(state.settings);
  if (usesJournal(jcfg, kid)) {
    const jdates = writableDates(jcfg, kid, today);
    unsubs.push(watchNotes(kid, (notes) => {
      const by = new Map(notes.map((n) => [n.date, n]));
      const open = jdates.filter((d) => !by.has(d));
      const classToday = isClassDay(jcfg, kid, today);
      const c = $('#journalCard');
      c.hidden = !classToday && !open.length;
      if (c.hidden) return;
      const hm = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
      const st = classToday ? noteStatus(by.get(today)) : null;
      const gentle = !isMom() && classToday && !by.has(today) && hm >= (jcfg.reminderTime || '18:30');
      const status = classToday ? `今天：${st.text}` : '';
      const makeup = open.filter((d) => d !== today).length;
      c.innerHTML = `<div class="push-card"><span style="font-size:2rem">📝</span>
        <div class="grow"><strong>課後小記</strong><br><span class="muted small">${[status, makeup ? `這週還有 ${makeup} 天可以補寫` : ''].filter(Boolean).join('・')}</span>
          ${gentle ? '<br><span class="small">上完課了嗎？花 30 秒記一下就好 🙂</span>' : ''}</div>
        <button class="btn ${!isMom() && open.length ? 'btn-primary' : 'btn-ghost'}" data-go="/k/${kid}/journal">${isMom() ? '查看' : open.length ? '寫一下 ▶' : '看小記'}</button></div>`;
    }, (e) => showError(e, '讀取小記')));
  }

  if (shouldPromptPush()) mountPushCard($('#pushPrompt'), { compact: true });
  const cleanPanel = mountChecklistPanel($('#today'), { kid, date: today });
  const cleanCal = mountEventCalendar($('#calendar'), { kid });
  return () => { unsubs.forEach((u) => u()); cleanPanel(); cleanCal(); };
}
