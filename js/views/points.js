import { isMom, memberName } from '../state.js';
import { esc, modal, toast, showError, chipRadios } from '../ui.js';
import { watchLedger, addAdjustment, LEDGER_TYPES } from '../store/ledger.js';
import { watchPendingItems } from '../store/checklist.js';
import { labelMD, labelTime } from '../utils/date.js';

/** 點數：目前點數＋流水帳查詢 */
export function mountPoints(el, { kid }) {
  let data = null;
  let pending = [];
  let type = 'all';
  let month = 'all';

  function draw() {
    if (!data) { el.innerHTML = '<p class="empty">載入中…</p>'; return; }
    const months = [...new Set(data.list.map((e) => (e.date || '').slice(0, 7)).filter(Boolean))].sort().reverse();
    const list = data.list.filter((e) => (type === 'all' || e.type === type) && (month === 'all' || (e.date || '').startsWith(month)));
    const sumIn = list.filter((e) => e.amount > 0).reduce((s, e) => s + e.amount, 0);
    const sumOut = list.filter((e) => e.amount < 0).reduce((s, e) => s + e.amount, 0);
    const pendingPts = pending.reduce((s, i) => s + (i.points || 0), 0);

    el.innerHTML = `
      <div class="page-head">
        <h1>⭐ ${esc(memberName(kid))}的點數</h1>
        ${isMom() ? '<button class="btn btn-ghost" data-act="adjust">± 手動調整</button>' : ''}
      </div>
      <section class="card hero">
        <div class="hero-points static"><span class="hero-num">${data.balance}</span><span class="hero-unit">點 ⭐</span></div>
        <div class="hero-sub">${pendingPts ? `另有 ${pendingPts} 點等待媽媽核可` : '所有點數都已入帳'}</div>
      </section>
      <section class="card">
        <div class="filters">
          ${chipRadios('type', [{ value: 'all', label: '全部' }, ...Object.entries(LEDGER_TYPES).map(([value, label]) => ({ value, label }))], type)}
          <select name="month" class="select" aria-label="月份">
            <option value="all">全部月份</option>
            ${months.map((m) => `<option value="${m}" ${m === month ? 'selected' : ''}>${m.replace('-', ' 年 ')} 月</option>`).join('')}
          </select>
        </div>
        <p class="muted small">共 ${list.length} 筆｜獲得 +${sumIn}${sumOut ? `｜扣除 ${sumOut}` : ''}</p>
        ${list.length ? `<ul class="ledger">${list.map((e) => `
          <li class="ledger-row">
            <div class="ledger-main">
              <div class="ledger-title">${esc(e.title)}</div>
              <div class="muted small">${e.date ? labelMD(e.date) : ''}・${LEDGER_TYPES[e.type] || e.type}・入帳 ${labelTime(e.createdAt)}</div>
            </div>
            <span class="amount ${e.amount < 0 ? 'neg' : 'pos'}">${e.amount > 0 ? '+' : ''}${e.amount}</span>
          </li>`).join('')}</ul>` : '<p class="empty">沒有紀錄</p>'}
      </section>`;
  }

  el.addEventListener('change', (e) => {
    if (e.target.name === 'type') { type = e.target.value; draw(); }
    if (e.target.name === 'month') { month = e.target.value; draw(); }
  });
  el.addEventListener('click', async (e) => {
    if (!e.target.closest('[data-act=adjust]')) return;
    const r = await modal({
      title: `調整 ${memberName(kid)} 的點數`,
      html: `
        ${chipRadios('sign', [{ value: '+', label: '＋ 加點' }, { value: '-', label: '－ 扣點' }], '+')}
        <label class="field"><span>點數</span><input name="amount" type="number" inputmode="numeric" min="1" max="9999" required></label>
        <label class="field"><span>原因（會留在紀錄裡）</span><input name="title" maxlength="60" required placeholder="例如：主動幫忙洗碗"></label>`,
      buttons: [{ id: 'cancel', label: '取消' }, { id: 'ok', label: '確定', kind: 'primary' }],
      validate: (id, d) => {
        if (id !== 'ok') return null;
        if (!(Number(d.amount) >= 1)) return '請輸入 1 以上的點數';
        if (!d.title) return '請寫下原因';
        return null;
      }
    });
    if (r.id !== 'ok') return;
    const amount = Math.round(Number(r.data.amount)) * (r.data.sign === '-' ? -1 : 1);
    try { await addAdjustment(kid, amount, r.data.title); toast('已記錄', 'ok'); } catch (err) { showError(err); }
  });

  const unsubs = [
    watchLedger(kid, (d) => { data = d; draw(); }, (e) => showError(e, '讀取點數')),
    watchPendingItems(kid, (l) => { pending = l; draw(); }, (e) => showError(e))
  ];
  draw();
  return () => unsubs.forEach((u) => u());
}
