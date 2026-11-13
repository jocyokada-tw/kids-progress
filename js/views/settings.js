import { state, setState, KIDS, COLORS, EMOJIS, member, memberName, memberColor, subjects, notifySettings } from '../state.js';
import { mountPushCard } from './push-card.js';
import { esc, modal, toast, showError, chipChecks, chipRadios, confirmDialog, saveFile } from '../ui.js';
import { go } from '../router.js';
import { saveMember, saveSettings, saveGoal, changePin, forgetMomOnThisDevice } from '../store/family.js';
import { watchRewards, saveReward, archiveReward } from '../store/rewards.js';
import { watchRoutines, saveRoutine, archiveRoutine } from '../store/routines.js';
import { watchPairRequests, approvePair, rejectPair, watchDevices, removeDevice } from '../store/devices.js';
import { WEEKDAYS } from '../utils/date.js';
import { isValidPin } from '../utils/crypto.js';
import { needOnline } from '../net.js';
import { REVIEW_TYPES, WORD_DEFAULTS, watchWordLists, saveWordList, archiveWordList, loadListWords, saveListWords, parseWords, wordsToText } from '../store/words.js';
import { todayStr, addDays, labelMD, weekday } from '../utils/date.js';
import { journalSettings, CATEGORIES, MOOD_EMOJI } from '../utils/journal.js';
import { semesterRange, notesCsv, weekliesCsv } from '../utils/weekly.js';
import { loadPrompts, savePrompts, resetPrompts, getNotesOnce, getWeekliesOnce } from '../store/journal.js';

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
    <section class="card"><h2>🔔 通知</h2>
      <div id="sPushDevice"></div><hr>
      <div id="sNotify"></div></section>
    <section class="card"><h2>🔗 裝置管理</h2><div id="sReq"></div><div id="sDev"></div></section>
    <section class="card"><h2>📋 每日固定事項</h2>
      <p class="muted small">這些事項會依星期自動出現在每日清單，例如「刷牙」「閱讀 20 分鐘」。</p>
      <div id="sRoutines"></div></section>
    <section class="card"><h2>📖 每日單字</h2>
      <p class="muted small">每天學幾個新單字，並依遺忘曲線自動安排複習（答對後隔 1、2、4、7、15、30、60 天再考）。補習班單字會優先學，考前一天和當天整份複習。</p>
      <div id="sWordLists"></div><hr><div id="sWordCfg"></div></section>
    <section class="card"><h2>📝 課後小記</h2><div id="sJournal"></div></section>
    <section class="card"><h2>🎁 兌換項目</h2>
      <p class="muted small">孩子申請兌換時會先預留點數，媽媽核可後才正式扣點。</p>
      <div id="sRewards"></div></section>
    <section class="card"><h2>🎯 孩子的目標</h2>
      <p class="muted small">和孩子討論好後在這裡設定，孩子的首頁會顯示還差多少點。</p>
      <div id="sGoals"></div></section>
    <section class="card"><h2>🎨 科目與顏色</h2>
      <p class="muted small">用在進度與課程上。顏色可以點色塊修改。</p>
      <div id="sSubjects"></div></section>
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
          <span class="grow"><strong>${esc(r.title)}</strong><br><span class="muted small">${wdLabel(r.weekdays || [])}${r.dueTime ? `・⏰ ${esc(r.dueTime)} 前` : ''}</span></span>
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
        <div class="field"><span>哪幾天要做？</span>${chipChecks('weekdays', WD_ORDER.map((d) => ({ value: String(d), label: WEEKDAYS[d] })), (r?.weekdays || [1, 2, 3, 4, 5, 6, 0]).map(String))}</div>
        <label class="field"><span>指定完成時間（選填）</span><input name="dueTime" type="time" value="${esc(r?.dueTime || '')}"><span class="field-hint">超過這個時間才送出：點數減半，當天也不能拿全部完成的獎勵。時間前 30 分鐘會提醒孩子。</span></label>`,
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
          weekdays: res.data.weekdays.map(Number), order: r?.order ?? (routines?.length || 0), dueTime: res.data.dueTime || ''
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

  // ---------- 兌換項目 ----------
  let rewards = null;
  const REWARD_EMOJIS = ['🎁', '🍦', '🎮', '📺', '🧸', '📚', '🍰', '🎬', '🛝', '🏊', '💰', '⏰', '🍕', '🎨', '⚽', '🌟'];
  function drawRewards() {
    $('#sRewards').innerHTML = `
      ${rewards === null ? '<p class="empty">載入中…</p>' : rewards.length ? `<ul class="rows">${rewards.map((r) => `
        <li><button class="row-btn" data-act="editReward" data-id="${r.id}">
          <span class="req-emoji">${esc(r.emoji || '🎁')}</span><span class="grow"><strong>${esc(r.title)}</strong></span>
          <span class="pts">${r.cost} 點</span></button></li>`).join('')}</ul>` : '<p class="empty">還沒有兌換項目</p>'}
      <button class="btn btn-primary" data-act="newReward">＋ 新增兌換項目</button>`;
  }
  async function editReward(r) {
    const res = await modal({
      title: r ? '修改兌換項目' : '新增兌換項目',
      html: `
        <label class="field"><span>名稱</span><input name="title" maxlength="40" value="${esc(r?.title || '')}" placeholder="例如：看卡通 30 分鐘"></label>
        <label class="field"><span>需要點數</span><input name="cost" type="number" inputmode="numeric" min="1" max="99999" value="${r?.cost ?? 20}"></label>
        <div class="field"><span>圖示</span>${chipRadios('emoji', REWARD_EMOJIS.map((e) => ({ value: e, label: e })), r?.emoji || '🎁')}</div>`,
      buttons: [...(r ? [{ id: 'delete', label: '刪除', kind: 'danger' }] : [{ id: 'cancel', label: '取消' }]), { id: 'ok', label: '儲存', kind: 'primary' }],
      validate: (id, d) => (id !== 'ok' ? null : !d.title ? '請輸入名稱' : !(Number(d.cost) >= 1) ? '點數要 1 以上' : null)
    });
    try {
      if (res.id === 'delete') {
        if (await confirmDialog(`刪除「${r.title}」？已兌換的紀錄會保留。`, { danger: true, okLabel: '刪除' })) await archiveReward(r.id);
      } else if (res.id === 'ok') {
        await saveReward(r?.id, { title: res.data.title, cost: Math.round(Number(res.data.cost)), emoji: res.data.emoji || '🎁' });
        toast('已儲存', 'ok');
      }
    } catch (e) { showError(e); }
  }

  // ---------- 目標 ----------
  function drawGoals() {
    $('#sGoals').innerHTML = KIDS.map((k) => {
      const g = member(k).goal;
      return `<div class="row"><span class="avatar" style="background:${memberColor(k)}">${esc(member(k).emoji)}</span>
        <span class="grow"><strong>${esc(memberName(k))}</strong><br>
          <span class="muted small">${g ? `${esc(g.emoji || '🎯')} ${esc(g.title)}・${g.points} 點` : '尚未設定目標'}</span></span>
        <button class="btn btn-sm btn-ghost" data-act="editGoal" data-kid="${k}">${g ? '修改' : '設定'}</button></div>`;
    }).join('');
  }
  async function editGoal(kid) {
    const g = member(kid).goal;
    const opts = (rewards || []).map((r) => `<option value="${r.id}">${esc(r.emoji || '🎁')} ${esc(r.title)}（${r.cost} 點）</option>`).join('');
    const res = await modal({
      title: `${memberName(kid)}的目標`,
      html: `
        ${opts ? `<label class="field"><span>從兌換項目帶入（選填）</span><select class="select" name="pick"><option value="">— 自訂 —</option>${opts}</select></label>` : ''}
        <label class="field"><span>目標名稱</span><input name="title" maxlength="40" value="${esc(g?.title || '')}" placeholder="例如：新的樂高"></label>
        <label class="field"><span>需要累積到幾點</span><input name="points" type="number" inputmode="numeric" min="1" max="99999" value="${g?.points ?? 100}"></label>
        <div class="field"><span>圖示</span>${chipRadios('emoji', ['🎯', ...REWARD_EMOJIS].map((e) => ({ value: e, label: e })), g?.emoji || '🎯')}</div>`,
      buttons: [...(g ? [{ id: 'clear', label: '清除目標', kind: 'danger' }] : [{ id: 'cancel', label: '取消' }]), { id: 'ok', label: '儲存', kind: 'primary' }],
      onOpen: (w) => {
        const pick = w.querySelector('select[name=pick]');
        if (!pick) return;
        pick.addEventListener('change', () => {
          const r = rewards.find((x) => x.id === pick.value);
          if (!r) return;
          w.querySelector('input[name=title]').value = r.title;
          w.querySelector('input[name=points]').value = r.cost;
          const em = w.querySelector(`input[name=emoji][value="${CSS.escape(r.emoji || '🎁')}"]`);
          if (em) em.checked = true;
        });
      },
      validate: (id, d) => (id !== 'ok' ? null : !d.title ? '請輸入目標名稱' : !(Number(d.points) >= 1) ? '點數要 1 以上' : null)
    });
    try {
      if (res.id === 'clear') { await saveGoal(kid, null); toast('已清除目標'); }
      if (res.id === 'ok') {
        await saveGoal(kid, { title: res.data.title, points: Math.round(Number(res.data.points)), emoji: res.data.emoji || '🎯', rewardId: res.data.pick || '' });
        toast('目標已設定 🎯', 'ok');
      }
    } catch (e) { showError(e); }
  }

  // ---------- 科目與顏色 ----------
  function drawSubjects() {
    $('#sSubjects').innerHTML = `
      <form id="subjForm">
        <div id="subjRows">${subjects().map(subjRow).join('')}</div>
        <div class="btn-row">
          <button class="btn btn-ghost" type="button" data-act="addSubject">＋ 新增科目</button>
          <button class="btn btn-primary" type="submit">儲存科目</button>
        </div>
      </form>`;
  }
  const subjRow = (s) => `
    <div class="subj-row" data-id="${esc(s.id)}">
      <input type="color" name="color" value="${esc(s.color)}" aria-label="顏色">
      <input type="text" name="name" maxlength="12" value="${esc(s.name)}" aria-label="科目名稱">
      <button class="icon-btn" type="button" data-act="removeSubject" aria-label="刪除">🗑️</button>
    </div>`;

  // ---------- 每日單字 ----------
  let wordLists = null;
  const wordCfg = () => ({ ...WORD_DEFAULTS, ...(state.settings.words || {}) });
  function drawWordCfg() {
    const c = wordCfg();
    $('#sWordCfg').innerHTML = `
      <form id="wordCfgForm">
        <div class="field-row">
          <label class="field"><span>每天新單字</span><input name="perDay" type="number" inputmode="numeric" min="1" max="20" value="${c.perDay}"></label>
          <label class="field"><span>完成點數</span><input name="points" type="number" inputmode="numeric" min="0" max="99" value="${c.points}"></label>
          <label class="field"><span>一次全對加點</span><input name="perfectBonus" type="number" inputmode="numeric" min="0" max="99" value="${c.perfectBonus}"></label>
        </div>
        <div class="field"><span>複習的題型（隨機搭配；「看中文拼字」固定會有）</span>${chipChecks('types', [
            { value: 'cloze', label: '例句填空（拼字）' }, { value: 'clozeMc', label: '例句填空（選擇）' }, { value: 'listen', label: '聽音拼字' },
            { value: 'scramble', label: '字母重組' }, { value: 'match', label: '配對' }], c.types || REVIEW_TYPES)}
          <span class="field-hint">新單字固定考「選意思」和「拼字」。補習班單字在考試前一律出「聽音拼字」（和老師唸、孩子寫的考法一樣）。提示要點了才會出現；看了提示，那個字下次會照原本的間隔再複習。</span></div>
        <div class="field"><span>新單字的順序（一般字庫）</span>${chipRadios('order', [{ value: 'random', label: '🎲 隨機抽選' }, { value: 'list', label: '照字庫順序' }], c.order === 'list' ? 'list' : 'random')}
          <span class="field-hint">補習班單字固定照你輸入的順序，並且優先學。</span></div>
        <button class="btn btn-primary" type="submit">儲存單字設定</button>
      </form>`;
  }
  // 考試日已過的補習班單字收起來（每週新增一份，全部列出會很長）。它們不能刪：學過的字還要靠它們繼續複習
  let showPastWordLists = false;
  function drawWordLists() {
    const today = todayStr();
    const isPast = (l) => l.kind === 'cram' && l.testDate && l.testDate < today;
    const row = (l) => `
        <li><button class="row-btn" data-act="editWordList" data-id="${l.id}">
          <span class="grow"><strong>${esc(l.name)}</strong> <span class="tag">${l.kind === 'cram' ? '補習班' : '字庫'}</span><br>
            <span class="muted small">${(l.kids || []).length ? l.kids.map(memberName).join('、') : '<span class="tag tag-wait">尚未指定孩子</span>'}${l.kind === 'cram' && l.testDate ? `・${labelMD(l.testDate)} 考試` : ''}</span></span>
          <span class="pts">${l.count || 0} 字</span></button></li>`;
    const current = (wordLists || []).filter((l) => !isPast(l));
    const past = (wordLists || []).filter(isPast).sort((a, b) => b.testDate.localeCompare(a.testDate));
    $('#sWordLists').innerHTML = `
      ${wordLists === null ? '<p class="empty">載入中…</p>' : wordLists.length ? `<ul class="rows">${current.map(row).join('')}
        ${past.length ? `<li><button class="row-btn" data-act="togglePastLists" aria-expanded="${showPastWordLists}">
          <span class="grow"><strong>📚 考過的補習班單字</strong><br><span class="muted small">${past.length} 份・${past.reduce((a, l) => a + (l.count || 0), 0)} 字・仍會照常複習</span></span>
          <span class="muted">${showPastWordLists ? '▲ 收起' : '▼ 展開'}</span></button></li>
          ${showPastWordLists ? past.map(row).join('') : ''}` : ''}</ul>` : '<p class="empty">還沒有字庫</p>'}
      <div class="btn-row" style="justify-content:flex-start">
        <button class="btn btn-primary" data-act="newWordList" data-kind="cram">＋ 補習班單字</button>
        <button class="btn btn-ghost" data-act="newWordList" data-kind="general">＋ 字庫（Flyers 等）</button>
      </div>`;
  }
  async function editWordList(l, kind) {
    const k = l ? l.kind : kind;
    const today = todayStr();
    // 補習班預設考試日：至少三天後的第一個週三（週五拿到 → 下週三考）
    let nextWed = addDays(today, 3);
    while (weekday(nextWed) !== 3) nextWed = addDays(nextWed, 1);
    const text = l && l.count ? wordsToText(await loadListWords(l.id)) : '';
    const res = await modal({
      title: l ? '修改字庫' : k === 'cram' ? '新增補習班單字' : '新增字庫',
      multi: ['kids'],
      html: `
        <label class="field"><span>名稱</span><input name="name" maxlength="30" value="${esc(l?.name || (k === 'cram' ? `補習班 ${labelMD(today)}` : ''))}" placeholder="例如：Flyers"></label>
        <div class="field"><span>給誰學？</span>${chipChecks('kids', KIDS.map((id) => ({ value: id, label: memberName(id) })), l?.kids || [])}
          <span class="field-hint">可以先不選，等孩子學完目前的字庫再指定。沒有指定的字庫不會出現在練習裡。</span></div>
        ${k === 'cram' ? `<label class="field"><span>考試日（考前一天和當天會整份複習）</span><input name="testDate" type="date" value="${esc(l ? l.testDate || '' : nextWed)}"></label>` : ''}
        <label class="field"><span>單字（每行一個：英文, 詞性, 中文, 例句）</span>
          <textarea name="words" rows="9" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="apple, n., 蘋果, I eat an apple every day.&#10;run, v., 跑&#10;banana, 香蕉&#10;library 圖書館">${esc(text)}</textarea>
          <span class="field-hint">可以直接從 Excel 或筆記貼上。用逗號、Tab 或空白分開都可以；詞性（n.、v.、adj.…）和例句可以不寫。整份內容會以這裡為準。</span></label>`,
      buttons: [...(l ? [{ id: 'delete', label: '刪除', kind: 'danger' }] : [{ id: 'cancel', label: '取消' }]), { id: 'ok', label: '儲存', kind: 'primary' }],
      validate: (id, d) => (id !== 'ok' ? null : !d.name ? '請輸入名稱' : null)
    });
    try {
      if (res.id === 'delete') {
        if (await confirmDialog(`刪除字庫「${l.name}」？\n這份字庫裡學過的字之後就不會再出現在複習裡（學習紀錄會保留）。考過的補習班單字建議留著，畫面上會自動收起來。`, { danger: true, okLabel: '刪除' })) await archiveWordList(l.id);
        return;
      }
      if (res.id !== 'ok') return;
      needOnline('儲存字庫');
      const { words, skipped } = parseWords(res.data.words);
      if (!state.settings.words) await saveSettings({ words: WORD_DEFAULTS });
      const id = await saveWordList(l?.id, { name: res.data.name, kind: k, kids: res.data.kids, testDate: res.data.testDate });
      await saveListWords(id, words);
      toast(`已儲存 ${words.length} 個單字${skipped.length ? `（${skipped.length} 行看不懂，已略過）` : ''}${res.data.kids.length ? '' : '。還沒指定孩子，所以先不會出現在練習裡'}`, skipped.length ? 'info' : 'ok', 4500);
    } catch (e) { showError(e, '儲存字庫'); }
  }

  // ---------- 課後小記 ----------
  const jRow = (c) => `<div class="jsched-row">
      <select class="select" name="wd">${WD_ORDER.map((d) => `<option value="${d}" ${Number(c.weekday) === d ? 'selected' : ''}>週${WEEKDAYS[d]}</option>`).join('')}</select>
      <select class="select" name="cat">${CATEGORIES.map((x) => `<option value="${x.id}" ${c.category === x.id ? 'selected' : ''}>${x.emoji} ${x.label}</option>`).join('')}</select>
      <input name="cnt" type="number" inputmode="numeric" min="1" max="9" value="${Number(c.count) || 1}" aria-label="堂數">
      <button type="button" class="btn btn-sm btn-ghost" data-act="jRemove" aria-label="刪除">✕</button></div>`;
  function drawJournal() {
    const c = journalSettings(state.settings);
    $('#sJournal').innerHTML = `
      <form id="journalForm">
        <div class="field"><span>誰要寫課後小記</span>${chipChecks('kids', KIDS.map((k) => ({ value: k, label: memberName(k) })), c.kids)}</div>
        ${KIDS.map((k) => `<div class="field jsched" data-kid="${k}"><span>${esc(memberName(k))}的課表（星期・類別・堂數）</span>
          <div class="jsched-rows">${(c.schedule[k] || []).map(jRow).join('')}</div>
          <button type="button" class="btn btn-sm btn-ghost" data-act="jAdd">＋ 新增一堂</button></div>`).join('')}
        <div class="field-row">
          <label class="field"><span>基本版點數</span><input name="basic" type="number" inputmode="numeric" min="0" max="99" value="${c.points.basic}"></label>
          <label class="field"><span>進階版</span><input name="advanced" type="number" inputmode="numeric" min="0" max="99" value="${c.points.advanced}"></label>
          <label class="field"><span>完整版</span><input name="full" type="number" inputmode="numeric" min="0" max="99" value="${c.points.full}"></label>
        </div>
        <div class="field-row">
          <label class="field"><span>補寫少給幾點</span><input name="lateDeduct" type="number" inputmode="numeric" min="0" max="99" value="${c.lateDeduct}"></label>
          <label class="field"><span>溫和提醒時間</span>${timeSelect('reminderTime', c.reminderTime)}</label>
        </div>
        <div class="field-row">
          <label class="field"><span>週末記事錄整理點數</span><input name="weeklyPoints" type="number" inputmode="numeric" min="0" max="99" value="${c.weeklyPoints}"></label>
          <label class="field"><span>連續幾週提示我</span><input name="hintWeeks" type="number" inputmode="numeric" min="1" max="8" value="${c.hintWeeks}"></label>
        </div>
        <div class="field"><span>輕鬆版的日子（只顯示基本版，可按「想多寫一點」）</span>${chipChecks('light', WD_ORDER.map((d) => ({ value: String(d), label: '週' + WEEKDAYS[d] })), (c.lightWeekdays || []).map(String))}</div>
        <p class="field-hint">基本＝心情＋學到；進階＝再寫「有趣的是」或「我想知道」其中一項；完整＝兩項都寫。點數只看有沒有填，送出後自動入帳，不用核可。補寫可以補同一週的上課日。</p>
        <button class="btn btn-primary" type="submit">儲存課後小記設定</button>
      </form>
      <p class="field-hint">「連續幾週提示我」：同一類課連續幾週都出現「沒興趣／不喜歡／跟不上」的回應時，在小記頁的「這週摘要」提示你（孩子看不到）。</p>
      <hr><div class="btn-row" style="justify-content:flex-start">
        <button class="btn btn-ghost" data-act="jPrompts">✏️ 編輯提示文字</button>
        <button class="btn btn-ghost" data-act="jExport">📤 匯出（CSV）</button></div>`;
  }

  // 提示文字：存在 meta/journalPrompts（沒有就用 data/journalPrompts.json）
  async function editPrompts() {
    const P = structuredClone(await loadPrompts());
    delete P.updatedAt;
    const inp = (name, label, v) => `<label class="field"><span>${label}</span><input name="${name}" maxlength="120" value="${esc(v || '')}"></label>`;
    const area = (name, label, v, rows = 4) => `<label class="field"><span>${label}</span><textarea name="${name}" rows="${rows}">${esc(v || '')}</textarea></label>`;
    const tiredMsg = (f) => f.message || (f.note || '').replace(/^.*只顯示：/, '');
    const bf = P.boringFlow || {};
    const POOL = { humanities: '📜 人文', math_science: '🔬 數理', project: '🧭 專題研究', general: '通用（不夠時使用）', lowPressure: '低壓力（覺得難或沒興趣時）' };
    const wp = P.weeklyPage || {};
    const html = `
      <p class="muted small">孩子看到的文字都在這裡。說法盡量正向、不責備。</p>
      <h3>心情與追問</h3>
      ${(P.feelings || []).map((f) => `<fieldset class="pe"><legend>${MOOD_EMOJI[f.id] || ''} ${esc(f.label)}</legend>
        ${inp(`f.${f.id}.label`, '名稱', f.label)}
        ${f.followUp !== null ? inp(`f.${f.id}.ref`, '細分（用「、」分開，可空白）', (f.refinements || []).join('、')) + inp(`f.${f.id}.fu`, '追問', f.followUp) + inp(`f.${f.id}.ss`, '提示句', f.sentenceStarter) : ''}
        ${f.id === 'tired' ? inp('f.tired.msg', '顯示的話（不追問）', tiredMsg(f)) : ''}
        ${f.useBoringFlow ? '<p class="muted small">追問在下方「覺得無聊時」</p>' : ''}</fieldset>`).join('')}
      <h3>覺得無聊時</h3>
      ${inp('b.q', '第一層問題', bf.firstLevelQuestion)}${inp('b.resp', '選了原因後的回應', bf.responseMessage)}
      ${(bf.reasons || []).map((r) => `<fieldset class="pe"><legend>${esc(r.label)}</legend>${inp(`r.${r.id}.label`, '選項', r.label)}${r.secondLevel !== null ? inp(`r.${r.id}.sec`, '第二層問題', r.secondLevel) : ''}</fieldset>`).join('')}
      ${area('b.hint', '給媽媽的提示（孩子看不到）', bf.parentHint, 2)}
      <h3>週末整理的開頭句（一行一句）</h3>
      ${Object.keys(P.weeklyStarters || {}).map((k) => area(`s.${k}`, POOL[k] || k, (P.weeklyStarters[k] || []).map((x) => x.text).join('\n'), 5)).join('')}
      <h3>週末整理頁</h3>
      ${area('w.recall', '這週沒寫小記時的回想問題（一行一個）', (wp.recallPrompts || []).join('\n'), 3)}
      ${inp('w.done', '完成後的話', wp.doneMessage)}`;
    const r = await modal({
      title: '✏️ 課後小記的提示文字', html,
      buttons: [{ id: 'cancel', label: '取消' }, { id: 'reset', label: '恢復預設', kind: 'danger' }, { id: 'ok', label: '儲存', kind: 'primary' }],
      validate: (id, d) => {
        if (id !== 'ok') return null;
        if ((P.feelings || []).some((f) => !d[`f.${f.id}.label`])) return '心情名稱不能空白';
        if ((bf.reasons || []).some((x) => !d[`r.${x.id}.label`])) return '無聊的選項不能空白';
        if (Object.keys(P.weeklyStarters || {}).some((k) => !lines(d[`s.${k}`]).length)) return '每一組開頭句至少要一句';
        return null;
      }
    });
    if (r.id === 'reset') {
      if (await confirmDialog('把所有提示文字恢復成預設？', { okLabel: '恢復預設', danger: true })) { await resetPrompts(); toast('已恢復預設', 'ok'); }
      return;
    }
    if (r.id !== 'ok') return;
    const d = r.data;
    for (const f of P.feelings || []) {
      f.label = d[`f.${f.id}.label`];
      if (f.followUp !== null) {
        f.refinements = (d[`f.${f.id}.ref`] || '').split(/[、,，]/).map((x) => x.trim()).filter(Boolean);
        f.followUp = d[`f.${f.id}.fu`] || '';
        f.sentenceStarter = d[`f.${f.id}.ss`] || '';
      }
      if (f.id === 'tired') f.message = d['f.tired.msg'] || '';
    }
    Object.assign(bf, { firstLevelQuestion: d['b.q'], responseMessage: d['b.resp'], parentHint: d['b.hint'] });
    for (const x of bf.reasons || []) { x.label = d[`r.${x.id}.label`]; if (x.secondLevel !== null) x.secondLevel = d[`r.${x.id}.sec`] || null; }
    P.boringFlow = bf;
    for (const k of Object.keys(P.weeklyStarters || {})) {
      const old = P.weeklyStarters[k] || [];
      P.weeklyStarters[k] = lines(d[`s.${k}`]).map((text, i) => {
        const hit = old.find((x) => x.text === text);
        if (hit) return hit;
        const id = `${k[0]}${Date.now().toString(36)}${i}`;
        return { id, type: `edited_${id}`, text };   // 新句子：自己一個類型
      });
    }
    P.weeklyPage = { ...wp, recallPrompts: lines(d['w.recall']), doneMessage: d['w.done'] || '' };
    await savePrompts(P);
    toast('提示文字已儲存', 'ok');
  }
  const lines = (t) => String(t || '').split(/\n/).map((x) => x.trim()).filter(Boolean);

  async function exportJournal() {
    const c = journalSettings(state.settings);
    const [from, to] = semesterRange(todayStr());
    const kids = c.kids.length ? c.kids : KIDS;
    const r = await modal({
      title: '📤 匯出課後小記',
      html: `${kids.length > 1 ? `<div class="field"><span>孩子</span>${chipRadios('kid', kids.map((k) => ({ value: k, label: memberName(k) })), kids[0])}</div>` : `<input type="hidden" name="kid" value="${kids[0]}">`}
        <div class="field"><span>內容</span>${chipRadios('what', [{ value: 'notes', label: '每日小記' }, { value: 'weekly', label: '記事錄整理' }], 'notes')}</div>
        <div class="field-row"><label class="field"><span>從</span><input type="date" name="from" value="${from}"></label>
          <label class="field"><span>到</span><input type="date" name="to" value="${to}"></label></div>
        <p class="muted small">預設是這學期。CSV 可以用 Excel、Numbers、Google 試算表打開。</p>`,
      buttons: [{ id: 'cancel', label: '取消' }, { id: 'ok', label: '匯出', kind: 'primary' }],
      validate: (id, d) => (id === 'ok' && !(d.from && d.to && d.from <= d.to) ? '請選擇正確的日期範圍' : null)
    });
    if (r.id !== 'ok') return;
    needOnline('匯出');
    const { kid, what, from: f, to: t } = r.data;
    const name = `${memberName(kid)}_${what === 'notes' ? '課後小記' : '記事錄整理'}_${f}_${t}.csv`;
    const text = what === 'notes'
      ? notesCsv(await getNotesOnce(kid), await loadPrompts(), c, kid, f, t)
      : weekliesCsv(await getWeekliesOnce(kid), f, t);
    await saveFile(name, text);
  }

  // ---------- 通知 ----------
  const HALF_HOURS = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`);
  const timeSelect = (name, val) => `<select class="select" name="${name}">${HALF_HOURS.map((t) => `<option ${t === val ? 'selected' : ''}>${t}</option>`).join('')}</select>`;
  const sw = (name, on, label) => `<label class="switch-row"><span>${label}</span><span class="switch"><input type="checkbox" name="${name}" ${on ? 'checked' : ''}><span></span></span></label>`;
  function drawNotify() {
    const n = notifySettings();
    $('#sNotify').innerHTML = `
      <form id="notifyForm">
        <h3 class="small muted">媽媽會收到</h3>
        ${sw('mom.kidTask', n.mom.kidTask, '📅 孩子自己安排了進度')}
        ${sw('mom.itemDone', n.mom.itemDone, '✅ 孩子勾選完成，等你核可（同一天合併成一則）')}
        ${sw('mom.redeem', n.mom.redeem, '🎁 孩子申請兌換')}
        ${sw('mom.message', n.mom.message, '💬 孩子的留言')}
        ${sw('mom.carry', n.mom.carry, '⏰ 孩子前一天沒完成、自動順延的作業（早上）')}
        ${sw('mom.due', n.mom.due, '⚠️ 作業過了期限還沒完成（早上）')}
        <h3 class="small muted">孩子會收到</h3>
        ${sw('kid.taskReview', n.kid.taskReview, '✅ 進度被確認或退回（含建議）')}
        ${sw('kid.itemReview', n.kid.itemReview, '⭐ 點數入帳、被退回、額外獎勵')}
        ${sw('kid.redeem', n.kid.redeem, '🎁 兌換核可或退回')}
        ${sw('kid.message', n.kid.message, '💬 媽媽的留言')}
        ${sw('kid.weekly', n.kid.weekly, '📦 媽媽新增了本週進度')}
        ${sw('kid.daily', n.kid.daily, '🌙 每日提醒：今天還沒完成的項目')}
        ${sw('kid.carry', n.kid.carry, '⏰ 放學後提醒：昨天沒完成、順延到今天的作業')}
        ${sw('kid.due', n.kid.due, '📅 放學後提醒：2 天內到期的作業')}
        ${sw('kid.timed', n.kid.timed, '⏰ 指定時間的事項：時間前 30 分鐘提醒')}
        ${sw('kid.journal', n.kid.journal, '📝 課後小記：上課日還沒寫時溫和提醒一次')}
        ${sw('kid.journalComment', n.kid.journalComment, '💬 媽媽回應了課後小記')}
        <div class="field-row" style="margin-top:12px">
          <label class="field"><span>放學後提醒時間</span>${timeSelect('afterSchoolTime', n.afterSchoolTime)}</label>
          <label class="field"><span>每日提醒時間</span>${timeSelect('dailyTime', n.dailyTime)}</label>
        </div>
        <div class="field-row">
          <label class="field"><span>勿擾時段：從</span>${timeSelect('quietStart', n.quietStart)}</label>
          <label class="field"><span>到</span>${timeSelect('quietEnd', n.quietEnd)}</label>
        </div>
        <p class="muted small">勿擾時段內的通知會先保留，時段結束後再一起送出（同類只送最新一則）。</p>
        <button class="btn btn-primary" type="submit">儲存通知設定</button>
      </form>`;
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
      } else if (f.id === 'wordCfgForm') {
        const n = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(v) || 0)));
        await saveSettings({ words: { perDay: n(d.perDay, 1, 20), points: n(d.points, 0, 99), perfectBonus: n(d.perfectBonus, 0, 99), order: d.order === 'list' ? 'list' : 'random',
          types: new FormData(f).getAll('types').filter((t) => REVIEW_TYPES.includes(t)) } });
        toast('單字設定已儲存', 'ok');
      } else if (f.id === 'journalForm') {
        const fd = new FormData(f);
        const n = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(v) || 0)));
        const schedule = {};
        for (const blk of f.querySelectorAll('.jsched')) {
          schedule[blk.dataset.kid] = [...blk.querySelectorAll('.jsched-row')].map((r) => ({
            weekday: Number(r.querySelector('[name=wd]').value), category: r.querySelector('[name=cat]').value, count: n(r.querySelector('[name=cnt]').value, 1, 9)
          }));
        }
        await saveSettings({ journal: { ...(state.settings.journal || {}),
          kids: fd.getAll('kids').filter((k) => KIDS.includes(k)), schedule,
          points: { basic: n(d.basic, 0, 99), advanced: n(d.advanced, 0, 99), full: n(d.full, 0, 99) },
          lateDeduct: n(d.lateDeduct, 0, 99), weeklyPoints: n(d.weeklyPoints, 0, 99), hintWeeks: n(d.hintWeeks, 1, 8), reminderTime: d.reminderTime, lightWeekdays: fd.getAll('light').map(Number) } });
        toast('課後小記設定已儲存', 'ok');
      } else if (f.id === 'notifyForm') {
        const fd = new FormData(f);
        const n = notifySettings();
        const notify = { mom: {}, kid: {}, quietStart: fd.get('quietStart'), quietEnd: fd.get('quietEnd'), dailyTime: fd.get('dailyTime'), afterSchoolTime: fd.get('afterSchoolTime') };
        for (const g of ['mom', 'kid']) for (const k of Object.keys(n[g])) notify[g][k] = fd.get(`${g}.${k}`) === 'on';
        await saveSettings({ notify });
        toast('通知設定已儲存', 'ok');
      } else if (f.id === 'subjForm') {
        const list = [...f.querySelectorAll('.subj-row')].map((row) => ({
          id: row.dataset.id, name: row.querySelector('[name=name]').value.trim(), color: row.querySelector('[name=color]').value
        })).filter((x) => x.name);
        if (new Set(list.map((x) => x.name)).size !== list.length) throw new Error('科目名稱不能重複');
        await saveSettings({ subjects: list });
        toast('科目已儲存', 'ok');
      } else if (f.classList.contains('pair-req')) {
        if (!d.role) throw new Error('請選擇這台裝置給誰用');
        needOnline('配對');
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
        case 'newWordList': editWordList(null, b.dataset.kind); break;
        case 'togglePastLists': showPastWordLists = !showPastWordLists; drawWordLists(); break;
        case 'editWordList': editWordList(wordLists.find((x) => x.id === b.dataset.id)); break;
        case 'newReward': editReward(null); break;
        case 'editReward': editReward(rewards.find((r) => r.id === b.dataset.id)); break;
        case 'editGoal': editGoal(b.dataset.kid); break;
        case 'addSubject':
          $('#subjRows').insertAdjacentHTML('beforeend', subjRow({ id: 's' + Date.now().toString(36), name: '', color: '#7c6cf0' }));
          $('#subjRows .subj-row:last-child input[name=name]').focus();
          break;
        case 'removeSubject': b.closest('.subj-row').remove(); break;
        case 'jAdd': b.closest('.jsched').querySelector('.jsched-rows').insertAdjacentHTML('beforeend', jRow({ weekday: 1, category: 'humanities', count: 1 })); break;
        case 'jRemove': b.closest('.jsched-row').remove(); break;
        case 'jPrompts': await editPrompts(); break;
        case 'jExport': await exportJournal(); break;
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

  drawKids(); drawRules(); subRoutines(); drawGoals(); drawSubjects(); drawRewards(); drawNotify(); drawWordCfg(); drawWordLists(); drawJournal();
  mountPushCard($('#sPushDevice'));
  const unsubs = [
    watchRewards((l) => { rewards = l; drawRewards(); }, (e) => showError(e, '讀取兌換項目')),
    watchWordLists((l) => { wordLists = l; drawWordLists(); }, (e) => showError(e, '讀取字庫')),
    watchPairRequests((l) => { requests = l; drawRequests(); }, (e) => showError(e, '讀取配對申請')),
    watchDevices((l) => { devices = l; drawDevices(); }, (e) => showError(e, '讀取裝置'))
  ];
  return () => { unsubs.forEach((u) => u()); unsubRoutines && unsubRoutines(); };
}
