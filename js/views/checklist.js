import { go } from '../router.js';
import { memberName } from '../state.js';
import { esc } from '../ui.js';
import { todayStr, addDays, labelMD, labelRelative, isDateStr } from '../utils/date.js';
import { mountChecklistPanel } from './checklist-panel.js';

export function mountChecklist(el, { kid, arg }) {
  const today = todayStr();
  const date = isDateStr(arg) && arg <= today ? arg : today;
  const rel = labelRelative(date);
  el.innerHTML = `
    <div class="page-head">
      <h1>✅ ${esc(memberName(kid))}的清單</h1>
    </div>
    <div class="date-nav card">
      <button class="icon-btn big" data-d="${addDays(date, -1)}" aria-label="前一天">‹</button>
      <div class="date-nav-label">${labelMD(date)}${rel ? `<span class="rel">${rel}</span>` : ''}</div>
      <button class="icon-btn big" data-d="${addDays(date, 1)}" ${date >= today ? 'disabled' : ''} aria-label="後一天">›</button>
      ${date !== today ? `<button class="btn btn-sm btn-ghost" data-d="${today}">回到今天</button>` : ''}
    </div>
    <section class="card" id="panel"></section>`;
  el.querySelector('.date-nav').addEventListener('click', (e) => {
    const b = e.target.closest('[data-d]');
    if (b && !b.disabled) go(`/k/${kid}/checklist/${b.dataset.d}`);
  });
  return mountChecklistPanel(el.querySelector('#panel'), { kid, date });
}
