import { state, isMom, memberName, subjects, subjectOf, OTHER_SUBJECT } from '../state.js';
import { esc, modal, toast, showError, chipChecks, chipRadios, subjectChips, confirmDialog } from '../ui.js';
import { watchTasksRange, createTasks, kidUpdateTask, momSaveTask, deleteTask } from '../store/tasks.js';
import { watchEvents, eventsOn, saveEvent, skipEventOn, deleteEvent } from '../store/events.js';
import { todayStr, addDays, weekStart, range, labelMD, weekday, isDateStr, WEEKDAYS } from '../utils/date.js';
import { TASK_STATUS } from './home.js';

const WD_ORDER = [1, 2, 3, 4, 5, 6, 0];
export const timeRange = (e) => (e.start ? `${e.start}${e.end ? '–' + e.end : ''}` : '');
const subjectList = () => [...subjects(), OTHER_SUBJECT];

/** 進度排程：週視圖／兩週視圖，含課程（沒有點數）與科目顏色 */
export function mountSchedule(el, { kid }) {
  const today = todayStr();
  let span = Number(localStorage.getItem('kp.span')) === 14 ? 14 : 7;
  let start = weekStart(today);
  let tasks = null;
  let events = [];
  let unsubTasks = null;
  const mom = isMom();

  const days = () => range(start, span);

  function subscribe() {
    unsubTasks && unsubTasks();
    tasks = null;
    draw();
    unsubTasks = watchTasksRange(kid, start, addDays(start, span - 1), (list) => { tasks = list; draw(); }, (e) => showError(e, '讀取排程'));
  }
  const unsubEvents = watchEvents(kid, (l) => { events = l; draw(); }, (e) => showError(e, '讀取課程'));

  function draw() {
    const ds = days();
    const end = ds[ds.length - 1];
    const inRange = today >= start && today <= end;
    el.innerHTML = `
      <div class="page-head">
        <h1>📅 ${esc(memberName(kid))}的行程</h1>
        <div class="btn-row">
          ${mom ? `<button class="btn btn-ghost" data-act="newEvent" data-date="${inRange ? today : start}">＋ 課程</button>` : ''}
          <button class="btn btn-primary" data-act="new" data-date="${inRange ? today : start}">＋ 進度</button>
        </div>
      </div>
      <div class="sched-bar card">
        <button class="icon-btn big" data-act="prev" aria-label="上一段">‹</button>
        <div class="sched-range">${labelMD(start)} – ${labelMD(end)}</div>
        <button class="icon-btn big" data-act="next" aria-label="下一段">›</button>
        <div class="seg">
          <button class="${span === 7 ? 'active' : ''}" data-act="span" data-span="7">一週</button>
          <button class="${span === 14 ? 'active' : ''}" data-act="span" data-span="14">兩週</button>
        </div>
        ${!inRange ? '<button class="btn btn-sm btn-ghost" data-act="today">本週</button>' : ''}
      </div>
      <div class="legend">${subjects().map((s) => `<span class="legend-item"><i class="dot" style="background:${esc(s.color)}"></i>${esc(s.name)}</span>`).join('')}
        <span class="legend-item"><i class="dot ring"></i>課程（無點數）</span></div>
      ${mom ? '' : '<p class="muted small hint">你可以自己安排進度，送出後會等媽媽確認喔！</p>'}
      <div class="week-grid span-${span}">${ds.map(dayCard).join('')}</div>`;
  }

  function dayCard(d) {
    const list = (tasks || []).filter((t) => t.date === d);
    const evs = eventsOn(events, d);
    const wd = weekday(d);
    const empty = !list.length && !evs.length;
    return `
      <div class="day ${d === today ? 'is-today' : ''} ${d < today ? 'is-past' : ''} ${wd === 0 || wd === 6 ? 'is-weekend' : ''}">
        <div class="day-head">
          <span class="day-label">${labelMD(d)}</span>
          <button class="icon-btn add" data-act="${mom ? 'addMenu' : 'new'}" data-date="${d}" aria-label="在 ${labelMD(d)} 新增">＋</button>
        </div>
        ${tasks === null ? '<div class="day-empty">…</div>' : empty ? '<div class="day-empty">—</div>' : `
          <ul class="day-tasks">
            ${evs.map((e) => `<li><button class="event" style="--s:${esc(subjectOf(e.subject).color)}" data-act="openEvent" data-id="${e.id}" data-date="${d}">
              <span class="event-time">🕒 ${esc(timeRange(e))}</span><span class="task-title">${esc(e.title)}</span></button></li>`).join('')}
            ${list.map((t) => `<li><button class="task task-${t.status}" style="--s:${esc(subjectOf(t.subject).color)}" data-act="open" data-id="${t.id}">
              <span class="task-title">${esc(t.title)}</span>
              <span class="task-meta"><span class="subj-tag">${esc(subjectOf(t.subject).name)}</span>${TASK_STATUS[t.status] || ''}${t.points ? `<span class="pts sm">+${t.points}</span>` : ''}${t.momNote ? '<span title="媽媽的建議">💬</span>' : ''}${t.createdBy === 'kid' ? '<span class="tag">自己排</span>' : ''}</span>
            </button></li>`).join('')}
          </ul>`}
      </div>`;
  }

  // ---------- 進度 ----------
  const dateOptions = () => days().map((d) => ({ value: d, label: labelMD(d) }));

  async function openNew(date) {
    const r = await modal({
      title: mom ? '安排新進度' : '我要安排進度',
      multi: ['dates'],
      html: `
        <div class="field"><span>科目</span>${subjectChips('subject', subjectList(), '')}</div>
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
      await createTasks(kid, r.data.dates, { title: r.data.title, note: r.data.note, subject: r.data.subject || '', points: Math.round(Number(r.data.points) || 0) }, mom);
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
        html: `<p><span class="subj-tag" style="--s:${esc(subjectOf(t.subject).color)}">${esc(subjectOf(t.subject).name)}</span> ${labelMD(t.date)} ${TASK_STATUS[t.status] || ''} ${t.points ? `<span class="pts">+${t.points}</span>` : ''}</p>
          ${t.note ? `<p class="pre">${esc(t.note)}</p>` : ''}${advice}`,
        buttons: [{ id: 'ok', label: '好', kind: 'primary' }]
      });
      return;
    }
    const r = await modal({
      title: '修改我的進度',
      html: `${advice}
        <div class="field"><span>科目</span>${subjectChips('subject', subjectList(), t.subject || '')}</div>
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
        <div class="field"><span>科目</span>${subjectChips('subject', subjectList(), t.subject || '')}</div>
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
      const patch = { title: r.data.title, date: r.data.date, note: r.data.note, momNote: r.data.momNote, subject: r.data.subject || '', points: Math.round(Number(r.data.points) || 0) };
      await momSaveTask(t.id, patch, r.id === 'reject' ? 'rejected' : 'approved');
      toast(r.id === 'reject' ? '已退回' : '已確認', 'ok');
    } catch (e) { showError(e); }
  }

  // ---------- 課程 ----------
  async function openEventForm(ev, date) {
    const repeat = ev ? ev.repeat : 'weekly';
    const wds = ev ? (ev.weekdays || []) : [weekday(date)];
    const r = await modal({
      title: ev ? '修改課程' : `新增${memberName(kid)}的課程`,
      multi: ['weekdays'],
      html: `
        <p class="muted small">課程是固定的行程（例如才藝課），不會有點數，也不會出現在每日清單。</p>
        <div class="field"><span>科目／類別</span>${subjectChips('subject', subjectList(), ev ? ev.subject || '' : '')}</div>
        <label class="field"><span>課程名稱</span><input name="title" maxlength="40" value="${esc(ev?.title || '')}" placeholder="例如：朱宗慶打擊樂"></label>
        <div class="field-row">
          <label class="field"><span>開始時間</span><input name="start" type="time" value="${esc(ev?.start || '16:00')}"></label>
          <label class="field"><span>結束時間</span><input name="end" type="time" value="${esc(ev?.end || '17:00')}"></label>
        </div>
        <div class="field"><span>重複</span>${chipRadios('repeat', [{ value: 'weekly', label: '每週固定' }, { value: 'once', label: '只有一天' }], repeat)}</div>
        <div class="when-weekly">
          <div class="field"><span>每週哪幾天？</span>${chipChecks('weekdays', WD_ORDER.map((d) => ({ value: String(d), label: WEEKDAYS[d] })), wds.map(String))}</div>
          <div class="field-row">
            <label class="field"><span>從哪天開始</span><input name="from" type="date" value="${esc(ev?.from || date)}"></label>
            <label class="field"><span>到哪天結束（選填）</span><input name="until" type="date" value="${esc(ev?.until || '')}"></label>
          </div>
        </div>
        <label class="field when-once"><span>日期</span><input name="date" type="date" value="${esc(ev?.date || date)}"></label>
        <label class="field"><span>備註（選填）</span><input name="note" maxlength="100" value="${esc(ev?.note || '')}" placeholder="例如：記得帶鼓棒"></label>`,
      buttons: [...(ev ? [{ id: 'delete', label: '刪除', kind: 'danger' }] : [{ id: 'cancel', label: '取消' }]), { id: 'ok', label: '儲存', kind: 'primary' }],
      onOpen: (w) => {
        const sync = () => {
          const once = w.querySelector('input[name=repeat]:checked')?.value === 'once';
          w.querySelector('.when-weekly').hidden = once;
          w.querySelector('.when-once').hidden = !once;
        };
        w.addEventListener('change', (e) => {
          if (e.target.name === 'repeat') sync();
          const title = w.querySelector('input[name=title]');
          if (e.target.name === 'subject' && !title.value) title.value = subjectOf(e.target.value).id ? subjectOf(e.target.value).name : '';
        });
        sync();
      },
      validate: (id, d) => {
        if (id !== 'ok') return null;
        if (!d.title) return '請輸入課程名稱';
        if (!d.start) return '請輸入開始時間';
        if (d.end && d.end <= d.start) return '結束時間要比開始時間晚';
        if (d.repeat === 'weekly' && !d.weekdays.length) return '請選擇每週哪幾天';
        if (d.repeat === 'weekly' && !isDateStr(d.from)) return '請選擇開始日期';
        if (d.repeat === 'weekly' && d.until && d.until < d.from) return '結束日期要在開始日期之後';
        if (d.repeat === 'once' && !isDateStr(d.date)) return '請選擇日期';
        return null;
      }
    });
    try {
      if (r.id === 'delete') {
        if (await confirmDialog(`刪除整個課程「${ev.title}」？（所有日期都會移除）`, { danger: true, okLabel: '刪除' })) { await deleteEvent(ev.id); toast('已刪除'); }
      } else if (r.id === 'ok') {
        const d = r.data;
        await saveEvent(ev?.id, kid, d.repeat === 'once'
          ? { title: d.title, subject: d.subject || '', start: d.start, end: d.end, note: d.note, repeat: 'once', date: d.date, weekdays: [], from: '', until: '' }
          : { title: d.title, subject: d.subject || '', start: d.start, end: d.end, note: d.note, repeat: 'weekly', date: '', weekdays: d.weekdays.map(Number), from: d.from, until: d.until || '' });
        toast('課程已儲存', 'ok');
      }
    } catch (e) { showError(e, '儲存失敗'); }
  }

  async function openEvent(ev, date) {
    const info = `
      <p><span class="subj-tag" style="--s:${esc(subjectOf(ev.subject).color)}">${esc(subjectOf(ev.subject).name)}</span>
        ${labelMD(date)} 🕒 ${esc(timeRange(ev))}</p>
      <p class="muted small">${ev.repeat === 'weekly' ? `每週${(ev.weekdays || []).sort((a, b) => WD_ORDER.indexOf(a) - WD_ORDER.indexOf(b)).map((d) => WEEKDAYS[d]).join('、')}` : '單次課程'}</p>
      ${ev.note ? `<p class="pre">📝 ${esc(ev.note)}</p>` : ''}`;
    if (!mom) {
      await modal({ title: ev.title, html: info, buttons: [{ id: 'ok', label: '好', kind: 'primary' }] });
      return;
    }
    const r = await modal({
      title: ev.title,
      html: info,
      buttons: [
        ...(ev.repeat === 'weekly' ? [{ id: 'skip', label: '只取消這一次' }] : []),
        { id: 'edit', label: '修改', kind: 'primary' }
      ]
    });
    try {
      if (r.id === 'edit') await openEventForm(ev, date);
      if (r.id === 'skip' && await confirmDialog(`取消 ${labelMD(date)} 這一次的「${ev.title}」？`, { okLabel: '取消這一次' })) {
        await skipEventOn(ev.id, date);
        toast('已取消這一次');
      }
    } catch (e) { showError(e); }
  }

  async function addMenu(date) {
    const r = await modal({
      title: `${labelMD(date)} 要新增什麼？`,
      html: `<p class="muted small">進度：可以得到點數，會出現在每日清單。<br>課程：固定的才藝課或行程，沒有點數。</p>`,
      buttons: [{ id: 'event', label: '🕒 課程' }, { id: 'task', label: '📝 進度', kind: 'primary' }]
    });
    if (r.id === 'task') openNew(date);
    if (r.id === 'event') openEventForm(null, date);
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
      case 'newEvent': openEventForm(null, b.dataset.date); break;
      case 'addMenu': addMenu(b.dataset.date); break;
      case 'open': { const t = (tasks || []).find((x) => x.id === b.dataset.id); if (t) openTask(t); break; }
      case 'openEvent': { const ev = events.find((x) => x.id === b.dataset.id); if (ev) openEvent(ev, b.dataset.date); break; }
    }
  });

  subscribe();
  return () => { unsubTasks && unsubTasks(); unsubEvents(); };
}
