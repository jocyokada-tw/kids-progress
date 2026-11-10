import { esc, toast, showError } from '../ui.js';
import { pushStatus, enablePush, disablePush, PUSH_HELP } from '../push.js';

/** 這台裝置的通知開關（設定頁與首頁提示共用） */
export function mountPushCard(el, { compact = false, onChange } = {}) {
  function draw() {
    const st = pushStatus();
    if (compact && !['off', 'need-install'].includes(st)) { el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = `
      <div class="push-card">
        <span style="font-size:2rem">${st === 'on' ? '🔔' : '🔕'}</span>
        <div class="grow"><strong>${compact ? '開啟通知，不錯過任何消息' : '這台裝置的通知'}</strong><br><span class="muted small">${esc(PUSH_HELP[st])}</span></div>
        ${st === 'off' ? '<button class="btn btn-primary" data-push="on">開啟通知</button>' : ''}
        ${st === 'on' && !compact ? '<button class="btn btn-ghost" data-push="off">關閉</button>' : ''}
        ${compact ? '<button class="icon-btn" data-push="dismiss" aria-label="稍後再說">✕</button>' : ''}
      </div>`;
  }
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-push]');
    if (!b) return;
    if (b.dataset.push === 'dismiss') { localStorage.setItem('kp.pushDismiss', String(Date.now())); el.hidden = true; return; }
    b.disabled = true;
    try {
      if (b.dataset.push === 'on') { await enablePush(); toast('通知已開啟 🔔', 'ok'); }
      else { await disablePush(); toast('已關閉這台裝置的通知'); }
    } catch (err) { showError(err, '通知'); } finally { draw(); onChange && onChange(); }
  });
  draw();
}

/** 首頁要不要提示開啟通知（按過 ✕ 的話 7 天內不再提示） */
export function shouldPromptPush() {
  const t = Number(localStorage.getItem('kp.pushDismiss') || 0);
  return Date.now() - t > 7 * 86400000 && ['off', 'need-install'].includes(pushStatus());
}
