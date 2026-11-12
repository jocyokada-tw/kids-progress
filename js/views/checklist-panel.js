import { state, isMom, subjectOf } from '../state.js';
import { esc, toast, showError, modal, popPoints, confirmDialog } from '../ui.js';
import { watchChecklist, setItemDone, approveItem, returnItem, grantBonus, removeItem } from '../store/checklist.js';
import { todayStr, labelMD } from '../utils/date.js';
import { needOnline } from '../net.js';
import { go } from '../router.js';
import { getSession, WORD_DEFAULTS } from '../store/words.js';

const STATUS = {
  pending: '<span class="tag tag-wait">⏳ 待核可</span>',
  approved: '<span class="tag tag-ok">✓ 已入帳</span>',
  returned: '<span class="tag tag-bad">↩ 退回</span>'
};

/** 某個小孩某一天的檢查清單（儀表板與清單頁共用） */
export function mountChecklistPanel(el, { kid, date }) {
  let items = null;
  let complete = false;
  let bonusTried = false;
  const mom = isMom();
  const future = date > todayStr();

  const unsub = future ? null : watchChecklist(kid, date, {
    canReconcile: !!state.device.isMom,
    onItems: (list, isComplete) => { items = list; complete = isComplete; draw(); maybeBonus(); },
    onError: (e) => showError(e, '讀取清單')
  });

  function draw() {
    if (future) { el.innerHTML = `<p class="empty">還沒到這一天喔 🌙</p>`; return; }
    if (!items) { el.innerHTML = `<p class="empty">載入中…</p>`; return; }
    if (!items.length) {
      el.innerHTML = `<p class="empty">${navigator.onLine ? '' : '📴 離線中：連上網路後會產生這天的清單。<br>'}這天沒有項目 🎈${mom ? '<br><span class="small">可到「設定」新增每日固定事項，或到「排程」安排進度。</span>' : ''}</p>`;
      return;
    }
    const total = items.length;
    const doneN = items.filter((i) => i.done || i.review === 'approved').length;
    const approvedAll = complete;
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

  // 每日單字的測驗結果（給媽媽核可時參考）
  const wordResult = {};
  function wordsTag(it) {
    const s = wordResult[it.id];
    if (!it.done && it.review !== 'approved') return `<span class="tag">單字</span>${mom ? '' : '<span class="tag tag-wait">點一下開始 ▶</span>'}`;
    if (s === undefined) {
      wordResult[it.id] = null;
      getSession(kid, it.date).then((r) => { wordResult[it.id] = r || false; draw(); }).catch(() => {});
    }
    if (!s) return '<span class="tag">單字</span>';
    const bonus = ({ ...WORD_DEFAULTS, ...(state.settings.words || {}) }).perfectBonus;
    return `<span class="tag">單字</span>${s.perfect ? `<span class="tag tag-ok">🎯 一次全對${bonus ? ` +${bonus}` : ''}</span>` : `<span class="tag">答錯 ${(s.wrong || []).length} 個字</span>`}`;
  }

  function row(it) {
    const checked = it.done || it.review === 'approved';
    return `
      <li class="item item-${it.review} ${it.missed ? 'item-missed' : ''} ${it.carriedFrom && !it.missed && it.review !== 'approved' ? 'item-carried' : ''}">
        <button class="check ${checked ? 'checked' : ''}" data-act="toggle" data-id="${it.id}" aria-pressed="${checked}" aria-label="${esc(it.title)}">${checked ? '✓' : ''}</button>
        <div class="item-main">
          <div class="item-title">${esc(it.title)}</div>
          <div class="item-meta">
            ${it.sourceType === 'words' ? wordsTag(it) : it.sourceType === 'routine' ? '<span class="tag">每日</span>' : `<span class="subj-tag" style="--s:${esc(subjectOf(it.subject).color)}">${esc(subjectOf(it.subject).name)}</span>`}
            ${it.missed ? (it.carriedTo ? `<span class="tag tag-bad">⏰ ${it.carriedTo === 'overdue' ? '沒完成，本週進度已逾期' : `沒完成，已順延到 ${labelMD(it.carriedTo)}`}</span>` : '<span class="tag tag-bad">↪ 已改期／取消</span>') : STATUS[it.review] || ''}
            ${it.carriedFrom && !it.missed ? `<span class="tag tag-bad">⏰ 順延自 ${labelMD(it.carriedFrom)}</span>` : ''}
          </div>
          ${it.missed && mom ? `<div class="item-note">${it.carriedTo ? '這天沒有完成' : '這一項改到其他天或取消了'}，還是算在這天的清單裡，所以這天不算全部完成。</div>` : ''}
          ${it.carriedFrom && !it.missed && !it.done && it.review !== 'approved' ? `<div class="item-note">⏰ ${labelMD(it.carriedFrom)} 沒完成的作業，今天記得要完成喔！</div>` : ''}
          ${it.review === 'returned' && it.returnNote ? `<div class="item-note">💬 ${esc(it.returnNote)}</div>` : ''}
        </div>
        <span class="pts">+${it.points || 0}</span>
        ${mom && it.missed && it.review !== 'approved' ? `
          <div class="item-actions"><button class="btn btn-sm btn-ghost" data-act="removeMissed" data-id="${it.id}">從這天移除</button></div>` : ''}
        ${mom && it.review === 'pending' && !it.missed ? `
          <div class="item-actions">
            <button class="btn btn-sm btn-ok" data-act="approve" data-id="${it.id}">核可</button>
            <button class="btn btn-sm btn-ghost" data-act="return" data-id="${it.id}">退回</button>
          </div>` : ''}
      </li>`;
  }

  // 媽媽裝置看到「全部完成」時發放額外獎勵。
  // 不只在按下核可的當下檢查：之前漏發的日子，媽媽打開那天的清單也會補發（每天最多一次）。
  async function maybeBonus() {
    const bonus = Number(state.settings.bonusAllDone) || 0;
    if (!mom || !complete || bonusTried || !(bonus > 0) || !navigator.onLine) return;
    bonusTried = true;
    try {
      if (await grantBonus(kid, date, bonus)) toast(`🎉 全部完成！額外獎勵 +${bonus}`, 'ok');
    } catch (e) { bonusTried = false; showError(e, '發放獎勵'); }
  }
  const afterApprove = () => maybeBonus();

  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || !items) return;
    const it = items.find((i) => i.id === b.dataset.id);
    try {
      switch (b.dataset.act) {
        case 'toggle': {
          if (it.review === 'approved') return toast('已經入帳囉，不能取消 ✓');
          if (it.missed) return toast(it.carriedTo && it.carriedTo !== 'overdue' ? `這一項已經順延到 ${labelMD(it.carriedTo)}，請在那天勾選` : '這一項已經改到其他天了');
          // 小孩送出後就鎖定，只有媽媽可以退回
          if (!mom && it.sourceType === 'words' && it.review !== 'pending') return go(`/k/${kid}/words`);
          if (!mom && it.review === 'pending') return toast('已經送出等媽媽核可囉 🔒 要取消的話請媽媽退回');
          const done = !it.done;
          b.disabled = true;
          await setItemDone(it.id, done);
          if (done) popPoints(b, `+${it.points || 0} ⭐`);
          break;
        }
        case 'removeMissed':
          if (await confirmDialog(`把「${it.title}」從 ${date} 的清單移除？\n移除後就不算在這天，如果其他項目都已核可，這天會算全部完成並發放額外獎勵。`, { okLabel: '移除', danger: true })) {
            await removeItem(it.id);
            toast('已移除');
          }
          break;
        case 'approve':
          needOnline('核可');
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
          needOnline('核可');
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
