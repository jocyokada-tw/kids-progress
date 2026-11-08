// 小型 UI 工具：跳脫、提示訊息、對話框
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function toast(msg, type = 'info', ms = 2600) {
  const root = document.getElementById('toast-root');
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  root.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, ms);
}

export function showError(err, prefix = '發生錯誤') {
  console.error(err);
  const code = err && err.code;
  let msg = (err && err.message) || String(err);
  if (code === 'permission-denied') msg = '沒有權限（請確認此裝置已配對、或已部署安全規則）';
  else if (code === 'unavailable') msg = '目前離線，連上網路後會自動同步';
  else if (code === 'failed-precondition' && /index/i.test(msg)) msg = '資料庫缺少索引，請依 docs/SETUP.md 部署 firestore.indexes.json';
  toast(`${prefix}：${msg}`, 'error', 5000);
}

/**
 * 開啟對話框。buttons: [{id, label, kind}]，kind: primary | danger | ghost
 * validate(id, data, el) 回傳錯誤字串可阻止關閉。
 * 回傳 Promise<{id, data}>；按背景或「取消」時 id = 'cancel'
 */
export function modal({ title, html, buttons = [{ id: 'ok', label: '好', kind: 'primary' }], validate, onOpen, multi = [] }) {
  return new Promise((resolve) => {
    const root = document.getElementById('modal-root');
    const wrap = document.createElement('div');
    wrap.className = 'modal-wrap';
    wrap.innerHTML = `
      <form class="modal" novalidate>
        <div class="modal-head"><h2>${esc(title)}</h2>
          <button type="button" class="icon-btn" data-mid="cancel" aria-label="關閉">✕</button></div>
        <div class="modal-body">${html}</div>
        <p class="modal-error" hidden></p>
        <div class="modal-actions">${buttons.map((b) =>
          `<button type="${b.kind === 'primary' ? 'submit' : 'button'}" class="btn btn-${b.kind || 'ghost'}" data-mid="${b.id}">${esc(b.label)}</button>`).join('')}</div>
      </form>`;
    root.appendChild(wrap);
    document.body.classList.add('modal-open');
    const form = wrap.querySelector('form');
    const errEl = wrap.querySelector('.modal-error');
    let busy = false;

    const readData = () => {
      const fd = new FormData(form);
      const data = {};
      for (const [k, v] of fd.entries()) {
        if (multi.includes(k)) (data[k] ||= []).push(v);
        else data[k] = typeof v === 'string' ? v.trim() : v;
      }
      multi.forEach((k) => { data[k] ||= []; });
      return data;
    };
    const close = (id, data) => {
      wrap.remove();
      if (!root.children.length) document.body.classList.remove('modal-open');
      resolve({ id, data });
    };
    const act = async (id) => {
      if (busy) return;
      if (id === 'cancel') return close('cancel', null);
      const data = readData();
      if (validate) {
        busy = true;
        let err;
        try { err = await validate(id, data, wrap); } catch (e) { err = e.message || String(e); }
        busy = false;
        if (err) { errEl.textContent = err; errEl.hidden = false; return; }
      }
      close(id, data);
    };
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const btn = e.submitter && e.submitter.dataset.mid;
      act(btn || buttons.find((b) => b.kind === 'primary')?.id || 'ok');
    });
    wrap.addEventListener('click', (e) => {
      if (e.target === wrap) return act('cancel');
      const b = e.target.closest('button[data-mid]');
      if (b && b.type !== 'submit') act(b.dataset.mid);
    });
    onOpen && onOpen(wrap);
    const first = wrap.querySelector('input:not([type=checkbox]):not([type=radio]):not([type=hidden]), textarea');
    if (first && !first.readOnly && !matchMedia('(pointer: coarse)').matches) first.focus();
  });
}

export async function confirmDialog(message, { okLabel = '確定', danger = false } = {}) {
  const r = await modal({
    title: '請確認',
    html: `<p class="confirm-msg">${esc(message)}</p>`,
    buttons: [{ id: 'cancel', label: '取消' }, { id: 'ok', label: okLabel, kind: danger ? 'danger' : 'primary' }]
  });
  return r.id === 'ok';
}

/** 一排可多選的小方塊（例如日期、星期） */
export function chipChecks(name, options, selected = []) {
  return `<div class="chips">${options.map((o) => `
    <label class="chip"><input type="checkbox" name="${name}" value="${esc(o.value)}" ${selected.includes(o.value) ? 'checked' : ''}><span>${esc(o.label)}</span></label>`).join('')}</div>`;
}
export function chipRadios(name, options, selected) {
  return `<div class="chips">${options.map((o) => `
    <label class="chip"><input type="radio" name="${name}" value="${esc(o.value)}" ${selected === o.value ? 'checked' : ''}><span>${esc(o.label)}</span></label>`).join('')}</div>`;
}

/** 在元素旁邊冒出「+3 ⭐」的小動畫 */
export function popPoints(anchor, text) {
  const r = anchor.getBoundingClientRect();
  const p = document.createElement('div');
  p.className = 'pop-points';
  p.textContent = text;
  p.style.left = `${r.left + r.width / 2}px`;
  p.style.top = `${r.top}px`;
  document.body.appendChild(p);
  setTimeout(() => p.remove(), 1200);
}
