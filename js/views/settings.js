import { state, setState, KIDS, COLORS, EMOJIS, member, memberName, memberColor } from '../state.js';
import { esc, modal, toast, showError, chipChecks, chipRadios, confirmDialog } from '../ui.js';
import { go } from '../router.js';
import { saveMember, saveSettings, changePin, forgetMomOnThisDevice } from '../store/family.js';
import { watchRoutines, saveRoutine, archiveRoutine } from '../store/routines.js';
import { watchPairRequests, approvePair, rejectPair, watchDevices, removeDevice } from '../store/devices.js';
import { WEEKDAYS } from '../utils/date.js';
import { isValidPin } from '../utils/crypto.js';

const WD_ORDER = [1, 2, 3, 4, 5, 6, 0];
const wdLabel = (wds) => {
  const s = [...wds].sort((a, b) => WD_ORDER.indexOf(a) - WD_ORDER.indexOf(b));
  if (s.length === 7) return '每天';
  if (s.join() === '1,2,3,4,5') return '週一到週五';
  if (s.join() === '6,0') return '週末';
  return s.map((d) => '週' + WEEKDAYS[d]).join('、');
};

export function mountSettings(el) {
  let routineKid = localStorage.getItem('kp.momKid') || 'kidA';
  let routines = null, requests = [], devices = [];
  el.innerHTML = `
    <div class="page-head"><h1>⚙️ 設定</h1></div>
    <section class="card"><h2>🔗 裝置管理</h2><div id="sReq"></div><div id="sDev"></div></section>
    <section class="card"><h2>📋 每日固定事項</h2>
      <p class="muted small">這些事項會依星期自動出現在每日清單，例如「刷牙」「閱讀 20 分鐘」。</p>
      <div id="sRoutines"></div></section>
    <div class="grid-2">
      <section class="card"><h2>⭐ 點數規則</h2><div id="sRules"></div></section>
      <section class="card"><h2>🔒 安全</h2>
        <button class="btn btn-ghost btn-block" data-act="pin">變更媽媽 PIN</button>
        <button class="btn btn-ghost btn-block" data-act="lock">鎖定此裝置（下次進入要輸入 PIN）</button>
      </section>
    </div>
    <section class="card"><h2>👧 家人資料</h2><div id="sKids"></div></section>`;
  const $ = (s) => el.querySelector(s);

  // ---------- 家人資料 ----------
  function drawKids() {
    $('#sKids').innerHTML = ['mom', ...KIDS].map((id) => {
      const m = member(id);
      return `<form class="kid-form" data-id="${id}">
        <div class="kid-form-head"><span class="avatar lg" style="background:${memberColor(id)}">${esc(m.emoji)}</span>
          <label class="field grow"><span>名字</span><input name="name" maxlength="12" value="${esc(m.name)}" required></label></div>
        <div class="field"><span>頭像</span>${chipRadios('emoji', EMOJIS.concat(id === 'mom' ? ['👩'] : []).map((e) => ({ value: e, label: e })), m.emoji)}</div>
        <div class="field"><span>顏色</span><div class="chips">${Object.entries(COLORS).map(([k, v]) => `
          <label class="chip swatch"><input type="radio" name="color" value="${k}" ${m.color === k ? 'checked' : ''}><span style="background:${v}" aria-label="${k}"></span></label>`).join('')}</div></div>
        <button class="btn btn-primary" type="submit">儲存${esc(m.name)}的資料</button>
      </form>`;
    }).join('<hr>');
  }

  // ---------- 點數規則 ----------
  function drawRules() {
    const s = state.settings;
    $('#sRules').innerHTML = `
      <form id="rulesForm">
        <label class="field"><span>當天全部完成的額外獎勵</span><input name="bonusAllDone" type="number" inputmode="numeric" min="0" max="999" value="${s.bonusAllDone ?? 0}"></label>
        <label class="field"><span>新增進度時的預設點數</span><input name="defaultTaskPoints" type="number" inputmode="numeric" min="0" max="999" value="${s.defaultTaskPoints ?? 1}"></label>
        <button class="btn btn-primary" type="submit">儲存規則</button>
      </form>
      <p class="muted small">每個項目的點數，在「排程」或「每日固定事項」中個別設定。</p>`;
  }

  // ---------- 每日固定事項 ----------
  let unsubRoutines = null;
  function subRoutines() {
    unsubRoutines && unsubRoutines();
    routines = null; drawRoutines();
    unsubRoutines = watchRoutines(routineKid, (l) => { routines = l.filter((r) => r.active !== false); drawRoutines(); }, (e) => showError(e));
  }
  function drawRoutines() {
    $('#sRoutines').innerHTML = `
      <div class="seg">${KIDS.map((k) => `<button class="${k === routineKid ? 'active' : ''}" data-act="rkid" data-kid="${k}">${esc(memberName(k))}</button>`).join('')}</div>
      ${routines === null ? '<p class="empty">載入中…</p>' : routines.length ? `<ul class="rows">${routines.map((r) => `
        <li><button class="row-btn" data-act="editRoutine" data-id="${r.id}">
          <span class="grow"><strong>${esc(r.title)}</strong><br><span class="muted small">${wdLabel(r.weekdays || [])}</span></span>
          <span class="pts">+${r.points}</span></button></li>`).join('')}</ul>` : '<p class="empty">還沒有固定事項</p>'}
      <button class="btn btn-primary" data-act="newRoutine">＋ 新增固定事項</button>`;
  }
  async function editRoutine(r) {
    const res = await modal({
      title: r ? '修改固定事項' : `新增 ${memberName(routineKid)} 的固定事項`,
      multi: ['weekdays'],
      html: `
        <label class="field"><span>事項</span><input name="title" maxlength="60" value="${esc(r?.title || '')}" placeholder="例如：刷牙、整理書包"></label>
        <label class="field"><span>完成可得點數</span><input name="points" type="number" inputmode="numeric" min="0" max="999" value="${r?.points ?? 1}"></label>
        <div class="field"><span>哪幾天要做？</span>${chipChecks('weekdays', WD_ORDER.map((d) => ({ value: String(d), label: WEEKDAYS[d] })), (r?.weekdays || [1, 2, 3, 4, 5, 6, 0]).map(String))}</div>`,
      buttons: [...(r ? [{ id: 'delete', label: '刪除', kind: 'danger' }] : [{ id: 'cancel', label: '取消' }]), { id: 'ok', label: '儲存', kind: 'primary' }],
      validate: (id, d) => {
        if (id !== 'ok') return null;
        if (!d.title) return '請輸入事項';
        if (!(Number(d.points) >= 0)) return '點數必須是 0 以上';
        if (!d.weekdays.length) return '請至少選一天';
        return null;
      }
    });
    try {
      if (res.id === 'delete') {
        if (await confirmDialog(`刪除「${r.title}」？已入帳的紀錄會保留。`, { danger: true, okLabel: '刪除' })) await archiveRoutine(r.id);
      } else if (res.id === 'ok') {
        await saveRoutine(r?.id, routineKid, {
          title: res.data.title, points: Math.round(Number(res.data.points)),
          weekdays: res.data.weekdays.map(Number), order: r?.order ?? (routines?.length || 0)
        });
        toast('已儲存', 'ok');
      }
    } catch (e) { showError(e); }
  }

  // ---------- 裝置管理 ----------
  const roleOptions = () => [
    { value: 'mom', label: '媽媽的裝置（全部權限）' },
    ...KIDS.map((k) => ({ value: k, label: `${memberName(k)}的裝置` })),
    { value: 'kids', label: '兩個小孩共用' }
  ];
  const roleOf = (v) => (v === 'mom' ? { isMom: true, kids: [...KIDS] } : v === 'kids' ? { isMom: false, kids: [...KIDS] } : { isMom: false, kids: [v] });
  const describe = (d) => (d.isMom ? '媽媽的裝置' : (d.kids || []).map(memberName).join('、') + ' 使用');

  function drawRequests() {
    $('#sReq').innerHTML = requests.length ? `
      <div class="notice"><strong>有 ${requests.length} 台裝置等待配對</strong>，請核對對方畫面上的代碼。</div>
      ${requests.map((r) => `
        <form class="pair-req" data-id="${r.id}">
          <div class="pair-req-head"><span class="pair-code sm">${esc(r.code)}</span><strong>${esc(r.label)}</strong></div>
          <div class="field"><span>這台裝置給誰用？</span>${chipRadios('role', roleOptions(), null)}</div>
          <div class="btn-row">
            <button class="btn btn-ghost" type="button" data-act="rejectReq" data-id="${r.id}">拒絕</button>
            <button class="btn btn-primary" type="submit">核可配對</button>
          </div>
        </form>`).join('')}` : '';
  }
  function drawDevices() {
    $('#sDev').innerHTML = `
      <ul class="rows">${devices.map((d) => `
        <li class="row"><span class="grow"><strong>${esc(d.label || '未命名')}</strong>${d.id === state.uid ? ' <span class="tag tag-ok">本機</span>' : ''}<br>
          <span class="muted small">${esc(describe(d))}</span></span>
          ${d.id === state.uid ? '' : `<button class="btn btn-sm btn-ghost" data-act="removeDev" data-id="${d.id}">移除</button>`}</li>`).join('')}</ul>
      <p class="muted small">要加入新裝置：在新裝置上打開這個網址（建議先「加入主畫面」再打開），按「產生配對代碼」，代碼就會出現在這裡。</p>`;
  }

  // ---------- 事件 ----------
  el.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const d = Object.fromEntries(new FormData(f));
    const btn = f.querySelector('[type=submit]');
    btn.disabled = true;
    try {
      if (f.classList.contains('kid-form')) {
        if (!d.name.trim()) throw new Error('請輸入名字');
        await saveMember(f.dataset.id, { name: d.name.trim(), emoji: d.emoji, color: d.color });
        toast('已儲存', 'ok');
        drawKids();
      } else if (f.id === 'rulesForm') {
        const bonus = Math.round(Number(d.bonusAllDone)), def = Math.round(Number(d.defaultTaskPoints));
        if (!(bonus >= 0 && def >= 0)) throw new Error('請輸入 0 以上的數字');
        await saveSettings({ bonusAllDone: bonus, defaultTaskPoints: def });
        toast('規則已儲存', 'ok');
      } else if (f.classList.contains('pair-req')) {
        if (!d.role) throw new Error('請選擇這台裝置給誰用');
        const req = requests.find((r) => r.id === f.dataset.id);
        await approvePair(f.dataset.id, { ...roleOf(d.role), label: req?.label || '裝置' });
        toast('配對完成 🎉', 'ok');
      }
    } catch (err) { showError(err, '無法儲存'); } finally { btn.disabled = false; }
  });

  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    try {
      switch (b.dataset.act) {
        case 'rkid': routineKid = b.dataset.kid; subRoutines(); break;
        case 'newRoutine': editRoutine(null); break;
        case 'editRoutine': editRoutine(routines.find((r) => r.id === b.dataset.id)); break;
        case 'rejectReq': await rejectPair(b.dataset.id); break;
        case 'removeDev': {
          const d = devices.find((x) => x.id === b.dataset.id);
          if (await confirmDialog(`移除「${d.label}」？這台裝置將無法再讀取資料，需要重新配對。`, { danger: true, okLabel: '移除' })) await removeDevice(d.id);
          break;
        }
        case 'pin': {
          const r = await modal({
            title: '變更媽媽 PIN',
            html: `<label class="field"><span>新 PIN（4～6 位數字）</span><input name="pin" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password"></label>
                   <label class="field"><span>再輸入一次</span><input name="pin2" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password"></label>
                   <p class="muted small">其他媽媽裝置下次進入時需要輸入新 PIN。</p>`,
            buttons: [{ id: 'cancel', label: '取消' }, { id: 'ok', label: '變更', kind: 'primary' }],
            validate: (id, d) => (id !== 'ok' ? null : !isValidPin(d.pin) ? 'PIN 必須是 4～6 位數字' : d.pin !== d.pin2 ? '兩次輸入不一樣' : null)
          });
          if (r.id === 'ok') { await changePin(r.data.pin); toast('PIN 已變更', 'ok'); }
          break;
        }
        case 'lock':
          forgetMomOnThisDevice();
          setState({ profile: null });
          toast('已鎖定，下次進入媽媽模式需要 PIN');
          go('/');
          break;
      }
    } catch (err) { showError(err); }
  });

  drawKids(); drawRules(); subRoutines();
  const unsubs = [
    watchPairRequests((l) => { requests = l; drawRequests(); }, (e) => showError(e, '讀取配對申請')),
    watchDevices((l) => { devices = l; drawDevices(); }, (e) => showError(e, '讀取裝置'))
  ];
  return () => { unsubs.forEach((u) => u()); unsubRoutines && unsubRoutines(); };
}
