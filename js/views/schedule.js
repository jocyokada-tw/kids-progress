import { state, isMom, memberName } from '../state.js';
import { esc, modal, toast, showError, chipChecks, confirmDialog } from '../ui.js';
import { watchTasksRange, createTasks, kidUpdateTask, momSaveTask, deleteTask } from '../store/tasks.js';
import { todayStr, addDays, weekStart, range, labelMD, weekday, isDateStr } from '../utils/date.js';
import { TASK_STATUS } from './home.js';

/** 進度排程：週視圖／兩週視圖 */
export function mountSchedule(el, { kid }) {
  const today = todayStr();
  let span = Number(localStorage.getItem('kp.span')) === 14 ? 14 : 7;
  let start = weekStart(today);
  let tasks = null;
  let unsub = null;
  const mom = isMom();

  const days = () => range(start, span);

  function subscribe() {
    unsub && unsub();
    tasks = null;
    draw();
    unsub = watchTasksRange(kid, start, addDays(start, span - 1), (list) => { tasks = list; draw(); }, (e) => showError(e, '讀取排程'));
  }

  function draw() {
    const ds = days();
    const end = ds[ds.length - 1];
    el.innerHTML = `
      <div class="page-head">
        <h1>📅 ${esc(memberName(kid))}的進度</h1>
        <button class="btn btn-primary" data-act="new" data-date="${today >= start && today <= end ? today : start}">＋ 新增進度</button>
      </div>
      <div class="sched-bar card">
        <button class="icon-btn big" data-act="prev" aria-label="上一段">‹</button>
        <div class="sched-range">${labelMD(start)} – ${labelMD(end)}</div>
        <button class="icon-btn big" data-act="next" aria-label="下一段">›</button>
        <div class="seg">
          <button class="${span === 7 ? 'active' : ''}" data-act="span" data-span="7">一週</button>
          <button class="${span === 14 ? 'active' : ''}" data-act="span" data-span="14">兩週</button>
        </div>
        ${!(today >= start && today <= end) ? '<button class="btn btn-sm btn-ghost" data-act="today">本週</button>' : ''}
      </div>
      ${mom ? '' : '<p class="muted small hint">你可以自己安排進度，送出後會等媽媽確認喔！</p>'}
      <div class="week-grid span-${span}">${ds.map(dayCard).join('')}</div>`;
  }

  function dayCard(d) {
    const list = (tasks || []).filter((t) => t.date === d);
    const wd = weekday(d);
    return `
      <div class="day ${d === today ? 'is-today' : ''} ${d < today ? 'is-past' : ''} ${wd === 0 || wd === 6 ? 'is-weekend' : ''}">
        <div class="day-head">
          <span class="day-label">${labelMD(d)}</span>
          <button class="icon-btn add" data-act="new" data-date="${d}" aria-label="在 ${labelMD(d)} 新增">＋</button>
        </div>
        ${tasks === null ? '<div class="day-empty">…</div>' : list.length ? `<ul class="day-tasks">${list.map((t) => `
          <li><button class="task task-${t.status}" data-act="open" data-id="${t.id}">
            <span class="task-title">${esc(t.title)}</span>
            <span class="task-meta">${TASK_STATUS[t.status] || ''}${t.points ? `<span class="pts sm">+${t.points}</span>` : ''}${t.momNote ? '<span title="媽媽的建議">💬</span>' : ''}${t.createdBy === 'kid' ? '<span class="tag">自己排</span>' : ''}</span>
          </button></li>`).join('')}</ul>` : '<div class="day-empty">—</div>'}
      </div>`;
  }

  // ---------- 對話框 ----------
  const dateOptions = () => days().map((d) => ({ value: d, label: labelMD(d) }));

  async function openNew(date) {
    const r = await modal({
      title: mom ? '安排新進度' : '我要安排進度',
      multi: ['dates'],
      html: `
        <label class="field"><span>要做什麼？</span><input name="title" maxlength="60" required placeholder="例如：數學習作 p.12-13"></label>
        <div class="field"><span>哪幾天？（可多選）</span>${chipChecks('dates', dateOptions(), [date])}</div>
        ${mom ? `<label class="field"><span>完成可得點數</span><input name="points" type="number" inputmode="numeric" min="0" max="999" value="${state.settings.defaultTaskPoints ?? 1}"></label>` : ''}
        <label class="field"><span>說明（選填）</span><textarea name="note" rows="2" maxlength="200"></textarea></label>`,
      buttons: [{ id: 'cancel', label: '取消' }, { id: 'ok', label: mom ? '新增' : '送出給媽媽確認', kind: 'primary' }],
      validate: (id, d) => {
        if (id !== 'ok') return null;
        if (!d.title) return '請輸入內容';
        if (!d.dates.length) return '請至少選一天';
        if (mom && !(Number(d.points) >= 0)) return '點數必須是 0 以上的數字';
        return null;
      }
    });
    if (r.id !== 'ok') return;
    try {
      await createTasks(kid, r.data.dates, { title: r.data.title, note: r.data.note, points: Math.round(Number(r.data.points) || 0) }, mom);
      toast(mom ? `已新增 ${r.data.dates.length} 天的進度` : '已送出，等媽媽確認 👍', 'ok');
    } catch (e) { showError(e, '新增失敗'); }
  }

  async function openTask(t) {
    if (mom) return openMomEdit(t);
    const editable = t.createdBy === 'kid' && t.status === 'pending';
    const advice = t.momNote ? `<div class="advice">💬 媽媽的建議：${esc(t.momNote)}</div>` : '';
    if (!editable) {
      await modal({
        title: t.title,
        html: `<p>${labelMD(t.date)} ${TASK_STATUS[t.status] || ''} ${t.points ? `<span class="pts">+${t.points}</span>` : ''}</p>
          ${t.note ? `<p class="pre">${esc(t.note)}</p>` : ''}${advice}`,
        buttons: [{ id: 'ok', label: '好', kind: 'primary' }]
      });
      return;
    }
    const r = await modal({
      title: '修改我的進度',
      html: `${advice}
        <label class="field"><span>要做什麼？</span><input name="title" maxlength="60" value="${esc(t.title)}"></label>
        <label class="field"><span>日期</span><input name="date" type="date" value="${t.date}"></label>
        <label class="field"><span>說明</span><textarea name="note" rows="2" maxlength="200">${esc(t.note)}</textarea></label>`,
      buttons: [{ id: 'delete', label: '刪除', kind: 'danger' }, { id: 'ok', label: '儲存', kind: 'primary' }],
      validate: (id, d) => (id === 'ok' && (!d.title || !isDateStr(d.date)) ? '請填寫內容與日期' : null)
    });
    try {
      if (r.id === 'ok') { await kidUpdateTask(t.id, r.data); toast('已更新', 'ok'); }
      if (r.id === 'delete' && await confirmDialog(`刪除「${t.title}」？`, { danger: true, okLabel: '刪除' })) await deleteTask(t.id);
    } catch (e) { showError(e); }
  }

  async function openMomEdit(t) {
    const statusText = { pending: '⏳ 小孩安排，等你確認', approved: '✓ 已確認', rejected: '↩ 已退回' }[t.status];
    const r = await modal({
      title: '進度詳情',
      html: `
        <p class="muted">${statusText}${t.createdBy === 'kid' ? '（小孩自己排的）' : ''}</p>
        <label class="field"><span>內容</span><input name="title" maxlength="60" value="${esc(t.title)}"></label>
        <div class="field-row">
          <label class="field"><span>日期</span><input name="date" type="date" value="${t.date}"></label>
          <label class="field"><span>點數</span><input name="points" type="number" inputmode="numeric" min="0" max="999" value="${t.points || (t.status === 'pending' ? state.settings.defaultTaskPoints ?? 1 : 0)}"></label>
        </div>
        <label class="field"><span>說明</span><textarea name="note" rows="2" maxlength="200">${esc(t.note)}</textarea></label>
        <label class="field"><span>💬 給孩子的建議（孩子看得到）</span><textarea name="momNote" rows="2" maxlength="200">${esc(t.momNote)}</textarea></label>`,
      buttons: [
        { id: 'delete', label: '刪除', kind: 'danger' },
        { id: 'reject', label: '退回' },
        { id: 'ok', label: t.status === 'approved' ? '儲存' : '確認並儲存', kind: 'primary' }
      ],
      validate: (id, d) => {
        if (id === 'delete') return null;
        if (!d.title || !isDateStr(d.date)) return '請填寫內容與日期';
        if (!(Number(d.points) >= 0)) return '點數必須是 0 以上的數字';
        return null;
      }
    });
    if (r.id === 'cancel') return;
    try {
      if (r.id === 'delete') {
        if (await confirmDialog(`刪除「${t.title}」？`, { danger: true, okLabel: '刪除' })) { await deleteTask(t.id); toast('已刪除'); }
        return;
      }
      const patch = { title: r.data.title, date: r.data.date, note: r.data.note, momNote: r.data.momNote, points: Math.round(Number(r.data.points) || 0) };
      await momSaveTask(t.id, patch, r.id === 'reject' ? 'rejected' : 'approved');
      toast(r.id === 'reject' ? '已退回' : '已確認', 'ok');
    } catch (e) { showError(e); }
  }

  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    switch (b.dataset.act) {
      case 'prev': start = addDays(start, -span); subscribe(); break;
      case 'next': start = addDays(start, span); subscribe(); break;
      case 'today': start = weekStart(today); subscribe(); break;
      case 'span': span = Number(b.dataset.span); localStorage.setItem('kp.span', span); subscribe(); break;
      case 'new': openNew(b.dataset.date); break;
      case 'open': { const t = (tasks || []).find((x) => x.id === b.dataset.id); if (t) openTask(t); break; }
    }
  });

  subscribe();
  return () => unsub && unsub();
}

