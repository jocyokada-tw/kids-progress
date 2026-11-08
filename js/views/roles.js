import { state, allowedProfiles, member, memberColor } from '../state.js';
import { esc, modal, showError, toast } from '../ui.js';
import { momRemembered, verifyPin, pinExists, changePin } from '../store/family.js';
import { isValidPin } from '../utils/crypto.js';

export function mountRoles(el, { enterProfile }) {
  const profiles = allowedProfiles();
  el.innerHTML = `
    <div class="center-page roles-page">
      <h1 class="roles-title">你是誰呢？</h1>
      <div class="role-grid">${profiles.map((p) => {
        const m = member(p);
        return `<button class="role-card" data-p="${p}" style="--c:${memberColor(p)}">
          <span class="role-emoji">${esc(m.emoji)}</span>
          <span class="role-name">${esc(m.name)}</span>
          ${p === 'mom' ? '<span class="role-lock">🔒 PIN</span>' : ''}
        </button>`;
      }).join('')}</div>
      <p class="muted small">此裝置：${esc(state.device.label || '')}</p>
    </div>`;

  el.querySelector('.role-grid').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-p]');
    if (!b) return;
    const p = b.dataset.p;
    if (p !== 'mom') return enterProfile(p);
    b.disabled = true;
    try {
      if (await momRemembered()) return enterProfile('mom');
      if (!(await pinExists())) {
        const n = await modal({
          title: '設定新的媽媽 PIN',
          html: `<label class="field"><span>新 PIN（4～6 位數字）</span><input name="pin" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password"></label>
                 <label class="field"><span>再輸入一次</span><input name="pin2" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password"></label>`,
          buttons: [{ id: 'cancel', label: '取消' }, { id: 'ok', label: '設定', kind: 'primary' }],
          validate: (id, d) => (id !== 'ok' ? null : !isValidPin(d.pin) ? 'PIN 必須是 4～6 位數字' : d.pin !== d.pin2 ? '兩次輸入不一樣' : null)
        });
        if (n.id === 'ok') { await changePin(n.data.pin); enterProfile('mom'); }
        return;
      }
      const r = await modal({
        title: '請輸入媽媽 PIN',
        html: `<input class="pin-input" name="pin" type="password" inputmode="numeric" autocomplete="off" maxlength="6" placeholder="••••" aria-label="PIN">
               <p class="muted small">此裝置驗證一次後就會記住。</p>`,
        buttons: [{ id: 'cancel', label: '取消' }, { id: 'ok', label: '進入', kind: 'primary' }],
        validate: async (id, d) => (id === 'ok' && !(await verifyPin(d.pin)) ? 'PIN 不正確' : null)
      });
      if (r.id === 'ok') { toast('歡迎回來 👋'); enterProfile('mom'); }
    } catch (err) { showError(err); } finally { b.disabled = false; }
  });
}
