import { isMom, member, memberName } from '../state.js';
import { esc, modal, toast, showError, chipRadios, confirmDialog } from '../ui.js';
import { go } from '../router.js';
import { watchLedger, addAdjustment, LEDGER_TYPES } from '../store/ledger.js';
import { watchPendingItems } from '../store/checklist.js';
import { watchRewards, watchRedemptions, requestRedemption, cancelRedemption, approveRedemption, rejectRedemption } from '../store/rewards.js';
import { labelMD, labelTime } from '../utils/date.js';
import { goalHtml } from './goal.js';

const STATUS = { pending: '申請中', approved: '已兌換', rejected: '媽媽退回', cancelled: '已取消' };

/** 點數：目前點數、目標、兌換、紀錄查詢 */
export function mountPoints(el, { kid }) {
  const mom = isMom();
  let ledger = null, pendingItems = [], rewards = [], redemptions = [];
  let tab = 'ledger', type = 'all', month = 'all';

  const reservedSum = () => redemptions.filter((r) => r.status === 'pending').reduce((s, r) => s + r.cost, 0);

  function draw() {
    if (!ledger) { el.innerHTML = '<p class="empty">載入中…</p>'; return; }
    const balance = ledger.balance;
    const reserved = reservedSum();
    const available = balance - reserved;
    const pendingPts = pendingItems.reduce((s, i) => s + (i.points || 0), 0);
    const pending = redemptions.filter((r) => r.status === 'pending');
    const goal = goalHtml(member(kid).goal, balance);

    el.innerHTML = `
      <div class="page-head">
        <h1>⭐ ${esc(memberName(kid))}的點數</h1>
        ${mom ? '<button class="btn btn-ghost" data-act="adjust">± 手動調整</button>' : ''}
      </div>
      <section class="card hero">
        <div class="hero-points static"><span class="hero-num">${balance}</span><span class="hero-unit">點 ⭐</span></div>
        <div class="hero-sub">${reserved ? `可用 <strong>${available}</strong> 點（${reserved} 點兌換申請中）` : ''}${reserved && pendingPts ? '<br>' : ''}${pendingPts ? `另有 ${pendingPts} 點等待媽媽核可` : ''}${!reserved && !pendingPts ? '所有點數都已入帳' : ''}</div>
      </section>
      ${goal ? `<section class="card">${goal}</section>` : ''}

      ${pending.length ? `<section class="card"><h2>⏳ 兌換申請中</h2>${pending.map((r) => reqRow(r, true)).join('')}</section>` : ''}

      <section class="card">
        <div class="card-head"><h2>🎁 兌換</h2>${mom ? '<button class="btn btn-sm btn-ghost" data-act="manage">管理兌換項目</button>' : ''}</div>
        ${rewards.length ? `<div class="reward-grid">${rewards.map((rw) => {
          const ok = available >= rw.cost;
          return `<button class="reward ${ok ? '' : 'cant'}" data-act="redeem" data-id="${rw.id}" ${mom ? 'disabled' : ''}>
            <span class="reward-emoji">${esc(rw.emoji || '🎁')}</span>
            <span class="reward-title">${esc(rw.title)}</span>
            <span class="reward-cost">${rw.cost} 點</span>
            ${!mom ? `<span class="reward-need">${ok ? '可以兌換！' : `還差 ${rw.cost - available} 點`}</span>` : ''}
          </button>`;
        }).join('')}</div>` : `<p class="empty">${mom ? '還沒有兌換項目，按「管理兌換項目」新增。' : '媽媽還沒有設定兌換項目'}</p>`}
      </section>

      <section class="card">
        <div class="seg">
          <button class="${tab === 'ledger' ? 'active' : ''}" data-act="tab" data-tab="ledger">點數紀錄</button>
          <button class="${tab === 'redeem' ? 'active' : ''}" data-act="tab" data-tab="redeem">兌換紀錄</button>
        </div>
        ${tab === 'ledger' ? ledgerHtml() : redeemHtml()}
      </section>`;
  }

  function reqRow(r, actions) {
    return `
      <div class="req-row">
        <span class="req-emoji">${esc(r.emoji || '🎁')}</span>
        <div class="grow">
          <div><strong>${esc(r.title)}</strong> <span class="pts sm">${r.cost} 點</span> <span class="status-pill st-${r.status}">${STATUS[r.status]}</span></div>
          <div class="muted small">申請 ${labelTime(r.createdAt)}${r.decidedAt ? `・處理 ${labelTime(r.decidedAt)}` : ''}</div>
          ${r.momNote ? `<div class="item-note">💬 ${esc(r.momNote)}</div>` : ''}
        </div>
        ${actions && r.status === 'pending' ? (mom
          ? `<div class="btn-row"><button class="btn btn-sm btn-ghost" data-act="rejectReq" data-id="${r.id}">退回</button><button class="btn btn-sm btn-ok" data-act="approveReq" data-id="${r.id}">核可並扣點</button></div>`
          : `<button class="btn btn-sm btn-ghost" data-act="cancelReq" data-id="${r.id}">取消申請</button>`) : ''}
      </div>`;
  }

  function ledgerHtml() {
    const months = [...new Set(ledger.list.map((e) => (e.date || '').slice(0, 7)).filter(Boolean))].sort().reverse();
    const list = ledger.list.filter((e) => (type === 'all' || e.type === type) && (month === 'all' || (e.date || '').startsWith(month)));
    const sumIn = list.filter((e) => e.amount > 0).reduce((s, e) => s + e.amount, 0);
    const sumOut = list.filter((e) => e.amount < 0).reduce((s, e) => s + e.amount, 0);
    return `
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
        </li>`).join('')}</ul>` : '<p class="empty">沒有紀錄</p>'}`;
  }

  function redeemHtml() {
    return redemptions.length ? redemptions.map((r) => reqRow(r, false)).join('') : '<p class="empty">還沒有兌換紀錄</p>';
  }

  el.addEventListener('change', (e) => {
    if (e.target.name === 'type') { type = e.target.value; draw(); }
    if (e.target.name === 'month') { month = e.target.value; draw(); }
  });

  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    const id = b.dataset.id;
    try {
      switch (b.dataset.act) {
        case 'tab': tab = b.dataset.tab; draw(); break;
        case 'manage': go('/settings'); break;
        case 'redeem': {
          const rw = rewards.find((x) => x.id === id);
          const available = ledger.balance - reservedSum();
          if (available < rw.cost) return toast(`還差 ${rw.cost - available} 點喔，繼續加油！💪`);
          if (!(await confirmDialog(`用 ${rw.cost} 點兌換「${rw.title}」？\n送出後要等媽媽核可。`, { okLabel: '申請兌換' }))) return;
          await requestRedemption(kid, rw);
          toast('已送出申請，等媽媽核可 🎁', 'ok');
          break;
        }
        case 'cancelReq':
          if (await confirmDialog('取消這筆兌換申請？點數會還給你。', { okLabel: '取消申請' })) await cancelRedemption(id);
          break;
        case 'approveReq': {
          const r = redemptions.find((x) => x.id === id);
          if (ledger.balance < r.cost) return toast(`點數不足（目前 ${ledger.balance} 點），無法扣點`, 'error');
          b.disabled = true;
          await approveRedemption(id);
          toast(`已兌換：${r.title}（-${r.cost}）`, 'ok');
          break;
        }
        case 'rejectReq': {
          const r = await modal({
            title: '退回兌換申請',
            html: `<label class="field"><span>告訴孩子原因（選填）</span><textarea name="note" rows="3" maxlength="200" placeholder="例如：這週末再一起兌換喔"></textarea></label>`,
            buttons: [{ id: 'cancel', label: '取消' }, { id: 'ok', label: '退回', kind: 'danger' }]
          });
          if (r.id === 'ok') { await rejectRedemption(id, r.data.note); toast('已退回，點數已釋放'); }
          break;
        }
        case 'adjust': {
          const r = await modal({
            title: `調整 ${memberName(kid)} 的點數`,
            html: `
              ${chipRadios('sign', [{ value: '+', label: '＋ 加點' }, { value: '-', label: '－ 扣點' }], '+')}
              <label class="field"><span>點數</span><input name="amount" type="number" inputmode="numeric" min="1" max="9999" required></label>
              <label class="field"><span>原因（會留在紀錄裡）</span><input name="title" maxlength="60" required placeholder="例如：主動幫忙洗碗"></label>`,
            buttons: [{ id: 'cancel', label: '取消' }, { id: 'ok', label: '確定', kind: 'primary' }],
            validate: (id2, d) => {
              if (id2 !== 'ok') return null;
              if (!(Number(d.amount) >= 1)) return '請輸入 1 以上的點數';
              if (!d.title) return '請寫下原因';
              return null;
            }
          });
          if (r.id !== 'ok') return;
          const amount = Math.round(Number(r.data.amount)) * (r.data.sign === '-' ? -1 : 1);
          await addAdjustment(kid, amount, r.data.title);
          toast('已記錄', 'ok');
          break;
        }
      }
    } catch (err) { showError(err); } finally { b.disabled = false; }
  });

  const unsubs = [
    watchLedger(kid, (d) => { ledger = d; draw(); }, (e) => showError(e, '讀取點數')),
    watchPendingItems(kid, (l) => { pendingItems = l; draw(); }, (e) => showError(e)),
    watchRewards((l) => { rewards = l; draw(); }, (e) => showError(e, '讀取兌換項目')),
    watchRedemptions(kid, (l) => { redemptions = l; draw(); }, (e) => showError(e, '讀取兌換紀錄'))
  ];
  draw();
  return () => unsubs.forEach((u) => u());
}
