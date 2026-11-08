import { state } from '../state.js';
import { esc, showError } from '../ui.js';
import { familyExists, setupFamily } from '../store/family.js';
import { requestPairing, watchMyPairRequest, cancelPairRequest } from '../store/devices.js';
import { isValidPin } from '../utils/crypto.js';

const guessLabel = () => {
  const ua = navigator.userAgent;
  if (/iPad|Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return 'iPad';
  if (/iPhone/.test(ua)) return 'iPhone';
  return '這台裝置';
};

// 尚未配對的裝置：第一次使用 → 建立家庭；否則 → 產生配對代碼等媽媽核可
export function mountPair(el) {
  let mode = 'loading';
  let request = null;
  let note = '';
  let hadRequest = false;

  const unsub = watchMyPairRequest(state.uid, (r) => {
    if (!r && hadRequest) note = '配對申請已被取消或拒絕，可以重新申請。';
    hadRequest = !!r;
    request = r;
    if (mode !== 'loading' && mode !== 'setup') { mode = r ? 'waiting' : 'pair'; draw(); }
  }, () => {});

  familyExists().then((exists) => {
    mode = !exists ? 'setup' : request ? 'waiting' : 'pair';
    draw();
  }).catch((e) => { showError(e, '連線'); mode = 'pair'; draw(); });

  function draw() {
    if (mode === 'loading') { el.innerHTML = `<div class="splash"><div class="splash-logo">⭐</div><p>載入中…</p></div>`; return; }
    if (mode === 'setup') {
      el.innerHTML = `
        <div class="center-page"><form class="card narrow" id="setup">
          <h1>👋 歡迎！第一次使用</h1>
          <p>這台裝置會成為<strong>媽媽的裝置</strong>。之後其他裝置用配對代碼加入。</p>
          <label class="field"><span>第一個小孩的名字</span><input name="kidA" required maxlength="12" value="小孩A"></label>
          <label class="field"><span>第二個小孩的名字</span><input name="kidB" required maxlength="12" value="小孩B"></label>
          <label class="field"><span>設定媽媽 PIN（4～6 位數字）</span><input name="pin" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password" required></label>
          <label class="field"><span>再輸入一次 PIN</span><input name="pin2" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password" required></label>
          <p class="form-error" hidden></p>
          <button class="btn btn-primary btn-block" type="submit">建立家庭</button>
          <button class="btn btn-ghost btn-block" type="button" data-act="toPair">我是要加入已建立的家庭</button>
        </form></div>`;
      const form = el.querySelector('#setup');
      const err = form.querySelector('.form-error');
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const d = Object.fromEntries(new FormData(form));
        const fail = (m) => { err.textContent = m; err.hidden = false; };
        if (!d.kidA.trim() || !d.kidB.trim()) return fail('請輸入小孩的名字');
        if (!isValidPin(d.pin)) return fail('PIN 必須是 4～6 位數字');
        if (d.pin !== d.pin2) return fail('兩次輸入的 PIN 不一樣');
        const btn = form.querySelector('button[type=submit]');
        btn.disabled = true; btn.textContent = '建立中…';
        try {
          await setupFamily({ uid: state.uid, pin: d.pin, kidAName: d.kidA.trim(), kidBName: d.kidB.trim() });
        } catch (ex) {
          showError(ex, '建立失敗');
          btn.disabled = false; btn.textContent = '建立家庭';
        }
      });
      form.querySelector('[data-act=toPair]').onclick = () => { mode = 'pair'; draw(); };
      return;
    }
    if (mode === 'pair') {
      el.innerHTML = `
        <div class="center-page"><form class="card narrow" id="pair">
          <h1>🔗 配對這台裝置</h1>
          <p>為了保護小孩的資料，每台裝置都要先由媽媽核可。</p>
          ${note ? `<p class="notice">${esc(note)}</p>` : ''}
          <label class="field"><span>幫這台裝置取個名字</span><input name="label" maxlength="30" required value="${esc(guessLabel())}"></label>
          <button class="btn btn-primary btn-block" type="submit">產生配對代碼</button>
        </form></div>`;
      el.querySelector('#pair').addEventListener('submit', async (e) => {
        e.preventDefault();
        const label = new FormData(e.target).get('label').trim() || guessLabel();
        note = '';
        try { await requestPairing(state.uid, label); } catch (ex) { showError(ex, '申請失敗'); }
      });
      return;
    }
    // waiting
    el.innerHTML = `
      <div class="center-page"><div class="card narrow center">
        <h1>等待媽媽核可…</h1>
        <p>配對代碼</p>
        <div class="pair-code">${esc(request?.code || '----')}</div>
        <p>請媽媽在她的裝置打開<br><strong>⚙️ 設定 → 裝置管理</strong><br>核對代碼並選擇這台裝置給誰用。</p>
        <p class="muted small">裝置名稱：${esc(request?.label || '')}</p>
        <button class="btn btn-ghost" data-act="cancel">取消申請</button>
      </div></div>`;
    el.querySelector('[data-act=cancel]').onclick = () => { hadRequest = false; cancelPairRequest(state.uid).catch(showError); };
  }

  draw();
  return unsub;
}
