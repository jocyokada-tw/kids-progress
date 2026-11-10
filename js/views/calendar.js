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

  // 畫面分成三塊：月份列、月曆格、當天行程。點日期時只更新「選取框」和「當天行程」，
  // 不重畫整個月曆，畫面就不會因為暫時變短而跳動。
  el.innerHTML = '<div class="cal-nav"></div><div class="cal" role="grid"></div><div class="cal-detail"></div>';
  const navEl = el.querySelector('.cal-nav');
  const gridEl = el.querySelector('.cal');
  const detailEl = el.querySelector('.cal-detail');

  function drawNav() {
    navEl.innerHTML = `
      <button class="icon-btn big" data-cal="prev" aria-label="上個月">‹</button>
      <div class="cal-title">${+month.slice(0, 4)} 年 ${+month.slice(5, 7)} 月</div>
      <button class="icon-btn big" data-cal="next" aria-label="下個月">›</button>
      <button class="btn btn-sm btn-ghost" data-cal="today" ${month === firstOfMonth(today) ? 'hidden' : ''}>本月</button>`;
  }

  function drawGrid() {
    if (!events) { gridEl.innerHTML = '<p class="empty" style="grid-column:1/-1">載入中…</p>'; return; }
    const next = shiftMonth(month, 1);
    const lastDay = addDays(next, -1);
    const start = weekStart(month);
    const end = addDays(weekStart(lastDay), 6);
    const days = [];
    for (let d = start; d <= end; d = addDays(d, 1)) days.push(d);
    gridEl.innerHTML = `
      ${WD_HEAD.map((w) => `<div class="cal-wd ${w === 0 || w === 6 ? 'we' : ''}" role="columnheader">${WEEKDAYS[w]}</div>`).join('')}
      ${days.map((d) => {
        const evs = eventsOn(events, d);
        const cls = [d.slice(0, 7) !== month.slice(0, 7) ? 'out' : '', d === today ? 'today' : '', d === selected ? 'sel' : '', d < today ? 'past' : ''].join(' ');
        return `<button type="button" class="cal-day ${cls}" data-day="${d}" aria-pressed="${d === selected}" aria-label="${labelMD(d)}${evs.length ? `，${evs.length} 個行程` : ''}">
          <span class="cal-num">${+d.slice(8, 10)}</span>
          <span class="cal-evs">${evs.slice(0, 3).map((e) => `<span class="cal-ev" style="--s:${esc(subjectOf(e.subject).color)}"><span class="cal-ev-t">${esc(e.title)}</span></span>`).join('')}${evs.length > 3 ? `<span class="cal-more">+${evs.length - 3}</span>` : ''}</span>
        </button>`;
      }).join('')}`;
  }

  // 下方清單只會變高、不會變矮：換到行程較少的日子時頁面不會縮短（否則 iPhone 會把畫面往上拉）
  let detailMin = 0;
  function keepDetailHeight() {
    detailEl.style.minHeight = '';
    detailMin = Math.max(detailMin, detailEl.offsetHeight);
    detailEl.style.minHeight = detailMin + 'px';
  }

  function drawDetail() {
    if (!events) { detailEl.innerHTML = ''; return; }
    const sel = eventsOn(events, selected);
    const rel = labelRelative(selected);
    detailEl.innerHTML = `
      <div class="cal-detail-date">${labelMD(selected)}${rel ? `<span class="rel">${rel}</span>` : ''}</div>
      ${sel.length ? `<ul class="cal-list">${sel.map((e) => `
        <li style="--s:${esc(subjectOf(e.subject).color)}">
          <span class="cal-time">${esc(timeRange(e))}</span>
          <span class="grow"><strong>${esc(e.title)}</strong>${e.note ? `<br><span class="muted small">📝 ${esc(e.note)}</span>` : ''}</span>
        </li>`).join('')}</ul>` : '<p class="muted small">這天沒有行程</p>'}`;
    keepDetailHeight();
  }

  /** 換選取的日期：只移動選取框、更新下方清單 */
  function select(d) {
    selected = d;
    gridEl.querySelectorAll('.cal-day.sel').forEach((b) => { b.classList.remove('sel'); b.setAttribute('aria-pressed', 'false'); });
    const b = gridEl.querySelector(`.cal-day[data-day="${d}"]`);
    if (b) { b.classList.add('sel'); b.setAttribute('aria-pressed', 'true'); }
    drawDetail();
  }

  /** 換月份：保持高度不變再重畫，避免畫面跳動 */
  function changeMonth(m, sel) {
    const h = el.offsetHeight;
    el.style.minHeight = h + 'px';
    month = m;
    selected = sel;
    drawNav(); drawGrid(); drawDetail();
    requestAnimationFrame(() => { el.style.minHeight = ''; });
  }

  el.addEventListener('click', (e) => {
    const c = e.target.closest('[data-cal]');
    if (c) {
      e.preventDefault();
      if (c.dataset.cal === 'today') return changeMonth(firstOfMonth(today), today);
      const m = shiftMonth(month, c.dataset.cal === 'prev' ? -1 : 1);
      return changeMonth(m, m === firstOfMonth(today) ? today : m);
    }
    const d = e.target.closest('[data-day]');
    if (!d) return;
    e.preventDefault();
    const day = d.dataset.day;
    if (day.slice(0, 7) !== month.slice(0, 7)) changeMonth(firstOfMonth(day), day);
    else select(day);
  });

  const unsub = watchEvents(kid, (list) => { events = list; drawGrid(); drawDetail(); }, (e) => showError(e, '讀取行程'));
  drawNav(); drawGrid(); drawDetail();
  return unsub;
}
