import { state, isMom, subjectOf } from '../state.js';
import { esc, toast, showError, modal, popPoints } from '../ui.js';
import { watchChecklist, setItemDone, approveItem, returnItem, grantBonusIfComplete } from '../store/checklist.js';
import { todayStr } from '../utils/date.js';

const STATUS = {
  pending: '<span class="tag tag-wait">⏳ 待核可</span>',
  approved: '<span class="tag tag-ok">✓ 已入帳</span>',
  returned: '<span class="tag tag-bad">↩ 退回</span>'
};

/** 某個小孩某一天的檢查清單（儀表板與清單頁共用） */
export function mountChecklistPanel(el, { kid, date }) {
  let items = null;
  const mom = isMom();
  const future = date > todayStr();

  const unsub = future ? null : watchChecklist(kid, date, {
    canReconcile: !!state.device.isMom,
    onItems: (list) => { items = list; draw(); },
    onError: (e) => showError(e, '讀取清單')
  });

  function draw() {
    if (future) { el.innerHTML = `<p class="empty">還沒到這一天喔 🌙</p>`; return; }
    if (!items) { el.innerHTML = `<p class="empty">載入中…</p>`; return; }
    if (!items.length) {
      el.innerHTML = `<p class="empty">這天沒有項目 🎈${mom ? '<br><span class="small">可到「設定」新增每日固定事項，或到「排程」安排進度。</span>' : ''}</p>`;
      return;
    }
    const total = items.length;
    const doneN = items.filter((i) => i.done || i.review === 'approved').length;
    const approvedAll = items.every((i) => i.review === 'approved');
    const earned = items.filter((i) => i.review === 'approved').reduce((s, i) => s + (i.points || 0), 0);
    const waiting = items.filter((i) => i.review === 'pending').reduce((s, i) => s + (i.points || 0), 0);
    const bonus = Number(state.settings.bonusAllDone) || 0;
    const pendingCount = items.filter((i) => i.review === 'pending').length;

    el.innerHTML = `
      <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${doneN}">
        <div class="progress-bar" style="width:${(doneN / total) * 100}%"></div>
        <span class="progress-text">${doneN} / ${total} 完成</span>
      </div>
      <p class="checklist-sum">今天已入帳 <strong>${earned}</strong> 點${waiting ? `，待核可 <strong>${waiting}</strong> 點` : ''}</p>
      <ul class="items">${items.map(row).join('')}</ul>
      ${bonus > 0 ? `<p class="bonus ${approvedAll ? 'bonus-done' : ''}">${approvedAll ? `🎉 全部完成！獲得額外獎勵 +${bonus}` : `🎁 全部完成並核可，再加 <strong>+${bonus}</strong> 點`}</p>` : (approvedAll ? '<p class="bonus bonus-done">🎉 全部完成！</p>' : '')}
      ${mom && pendingCount > 1 ? `<button class="btn btn-primary btn-block" data-act="approveAll">✓ 全部核可（${pendingCount} 項）</button>` : ''}`;
  }

  function row(it) {
    const checked = it.done || it.review === 'approved';
    return `
      <li class="item item-${it.review}">
        <button class="check ${checked ? 'checked' : ''}" data-act="toggle" data-id="${it.id}" aria-pressed="${checked}" aria-label="${esc(it.title)}">${checked ? '✓' : ''}</button>
        <div class="item-main">
          <div class="item-title">${esc(it.title)}</div>
          <div class="item-meta">
            ${it.sourceType === 'routine' ? '<span class="tag">每日</span>' : `<span class="subj-tag" style="--s:${esc(subjectOf(it.subject).color)}">${esc(subjectOf(it.subject).name)}</span>`}
            ${STATUS[it.review] || ''}
          </div>
          ${it.review === 'returned' && it.returnNote ? `<div class="item-note">💬 ${esc(it.returnNote)}</div>` : ''}
        </div>
        <span class="pts">+${it.points || 0}</span>
        ${mom && it.review === 'pending' ? `
          <div class="item-actions">
            <button class="btn btn-sm btn-ok" data-act="approve" data-id="${it.id}">核可</button>
            <button class="btn btn-sm btn-ghost" data-act="return" data-id="${it.id}">退回</button>
          </div>` : ''}
      </li>`;
  }

  async function afterApprove() {
    const bonus = Number(state.settings.bonusAllDone) || 0;
    if (await grantBonusIfComplete(kid, date, bonus)) toast(`🎉 全部完成！額外獎勵 +${bonus}`, 'ok');
  }

  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || !items) return;
    const it = items.find((i) => i.id === b.dataset.id);
    try {
      switch (b.dataset.act) {
        case 'toggle': {
          if (it.review === 'approved') return toast('已經入帳囉，不能取消 ✓');
          const done = !it.done;
          b.disabled = true;
          await setItemDone(it.id, done);
          if (done) popPoints(b, `+${it.points || 0} ⭐`);
          break;
        }
        case 'approve':
          b.disabled = true;
          await approveItem(it.id);
          toast(`已核可：${it.title} +${it.points}`, 'ok');
          await afterApprove();
          break;
        case 'return': {
          const r = await modal({
            title: `退回「${it.title}」`,
            html: `<label class="field"><span>告訴孩子原因（選填）</span><textarea name="note" rows="3" maxlength="200" placeholder="例如：字要再寫整齊一點喔"></textarea></label>`,
            buttons: [{ id: 'cancel', label: '取消' }, { id: 'ok', label: '退回', kind: 'danger' }]
          });
          if (r.id === 'ok') await returnItem(it.id, r.data.note);
          break;
        }
        case 'approveAll': {
          b.disabled = true;
          const list = items.filter((i) => i.review === 'pending');
          for (const i of list) await approveItem(i.id);
          toast(`已核可 ${list.length} 項`, 'ok');
          await afterApprove();
          break;
        }
      }
    } catch (err) { showError(err); } finally { b.disabled = false; }
  });

  draw();
  return () => unsub && unsub();
}
