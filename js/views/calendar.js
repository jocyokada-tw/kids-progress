import { subjectOf } from '../state.js';
import { esc, showError } from '../ui.js';
import { watchEvents, eventsOn } from '../store/events.js';
import { todayStr, addDays, weekStart, labelMD, labelRelative, WEEKDAYS } from '../utils/date.js';

const WD_HEAD = [1, 2, 3, 4, 5, 6, 0];
const firstOfMonth = (d) => d.slice(0, 8) + '01';
function shiftMonth(first, n) {
  let y = +first.slice(0, 4), m = +first.slice(5, 7) + n;
  while (m > 12) { m -= 12; y++; }
  while (m < 1) { m += 12; y--; }
  return `${y}-${String(m).padStart(2, '0')}-01`;
}
const timeRange = (e) => (e.start ? `${e.start}${e.end ? '–' + e.end : ''}` : '');

/** 行程月曆：只顯示課程（行程），不顯示每日進度。點日期看當天的詳細行程 */
export function mountEventCalendar(el, { kid }) {
  const today = todayStr();
  let month = firstOfMonth(today);
  let selected = today;
  let events = null;

  function draw() {
    if (!events) { el.innerHTML = '<p class="empty">載入中…</p>'; return; }
    const next = shiftMonth(month, 1);
    const lastDay = addDays(next, -1);
    const start = weekStart(month);
    const end = addDays(weekStart(lastDay), 6);
    const days = [];
    for (let d = start; d <= end; d = addDays(d, 1)) days.push(d);
    const sel = eventsOn(events, selected);
    const rel = labelRelative(selected);

    el.innerHTML = `
      <div class="cal-nav">
        <button class="icon-btn big" data-cal="prev" aria-label="上個月">‹</button>
        <div class="cal-title">${+month.slice(0, 4)} 年 ${+month.slice(5, 7)} 月</div>
        <button class="icon-btn big" data-cal="next" aria-label="下個月">›</button>
        ${month !== firstOfMonth(today) ? '<button class="btn btn-sm btn-ghost" data-cal="today">本月</button>' : ''}
      </div>
      <div class="cal" role="grid">
        ${WD_HEAD.map((w) => `<div class="cal-wd ${w === 0 || w === 6 ? 'we' : ''}" role="columnheader">${WEEKDAYS[w]}</div>`).join('')}
        ${days.map((d) => {
          const evs = eventsOn(events, d);
          const cls = [d.slice(0, 7) !== month.slice(0, 7) ? 'out' : '', d === today ? 'today' : '', d === selected ? 'sel' : '', d < today ? 'past' : ''].join(' ');
          return `<button class="cal-day ${cls}" data-day="${d}" aria-label="${labelMD(d)}${evs.length ? `，${evs.length} 個行程` : ''}">
            <span class="cal-num">${+d.slice(8, 10)}</span>
            <span class="cal-evs">${evs.slice(0, 3).map((e) => `<span class="cal-ev" style="--s:${esc(subjectOf(e.subject).color)}"><span class="cal-ev-t">${esc(e.title)}</span></span>`).join('')}${evs.length > 3 ? `<span class="cal-more">+${evs.length - 3}</span>` : ''}</span>
          </button>`;
        }).join('')}
      </div>
      <div class="cal-detail">
        <div class="cal-detail-date">${labelMD(selected)}${rel ? `<span class="rel">${rel}</span>` : ''}</div>
        ${sel.length ? `<ul class="cal-list">${sel.map((e) => `
          <li style="--s:${esc(subjectOf(e.subject).color)}">
            <span class="cal-time">${esc(timeRange(e))}</span>
            <span class="grow"><strong>${esc(e.title)}</strong>${e.note ? `<br><span class="muted small">📝 ${esc(e.note)}</span>` : ''}</span>
          </li>`).join('')}</ul>` : '<p class="muted small">這天沒有行程</p>'}
      </div>`;
  }

  el.addEventListener('click', (e) => {
    const c = e.target.closest('[data-cal]');
    if (c) {
      if (c.dataset.cal === 'prev') month = shiftMonth(month, -1);
      if (c.dataset.cal === 'next') month = shiftMonth(month, 1);
      if (c.dataset.cal === 'today') { month = firstOfMonth(today); selected = today; }
      if (c.dataset.cal !== 'today') selected = selected.slice(0, 7) === month.slice(0, 7) ? selected : month;
      draw();
      return;
    }
    const d = e.target.closest('[data-day]');
    if (d) {
      selected = d.dataset.day;
      if (selected.slice(0, 7) !== month.slice(0, 7)) month = firstOfMonth(selected);
      draw();
    }
  });

  const unsub = watchEvents(kid, (list) => { events = list; draw(); }, (e) => showError(e, '讀取行程'));
  draw();
  return unsub;
}
