import { state, isMom, member } from '../state.js';
import { esc, toast, showError, confirmDialog } from '../ui.js';
import { go } from '../router.js';
import { todayStr, labelMD, labelRelative, weekStart, addDays } from '../utils/date.js';
import { journalSettings, usesJournal, classesOn, isClassDay, isLightDay, writableDates, canWrite, levelOf, pointsFor, feelingInText, categoryOf, MOOD_EMOJI } from '../utils/journal.js';
import { watchNotes, saveNote, setMomComment, loadPrompts, noteId } from '../store/journal.js';
import { weekSummary, sensitiveHints, isWeekend } from '../utils/weekly.js';

export const LEVEL_LABEL = { basic: '基本', advanced: '進階', full: '完整' };
const filled = (s) => typeof s === 'string' && s.trim().length > 0;

/** 每一天的狀態（清單、首頁共用） */
export function noteStatus(note) {
  if (!note) return { text: '還沒寫', cls: '' };
  if (note.skipped) return { text: '今天休息 🌙', cls: '' };
  const lv = levelOf(note);
  if (!lv) return { text: '寫到一半', cls: 'tag-wait' };
  return { text: `✓ ${LEVEL_LABEL[lv]}${note.awarded ? ` +${note.awarded}` : ''}`, cls: 'tag-ok' };
}

/** 課後小記：孩子填寫（含補寫、休息），媽媽查看與留言 */
export function mountJournal(el, { kid, arg }) {
  const today = todayStr();
  const mom = isMom();
  const cfg = journalSettings(state.settings);
  const dates = writableDates(cfg, kid, today);
  let prompts = null, notes = null;
  let date = arg && canWrite(cfg, kid, arg, today) ? arg : (isClassDay(cfg, kid, today) ? today : null);
  let editing = false, draft = null, more = false, extraOpen = false, showOld = false;

  if (!usesJournal(cfg, kid)) {
    el.innerHTML = `<div class="page-head"><h1>📝 課後小記</h1></div>
      <section class="card"><p class="empty">${esc(member(kid).name)}沒有開啟課後小記${mom ? '<br><span class="small">可到「設定 → 課後小記」開啟</span>' : ''}</p></section>`;
    return () => {};
  }

  el.innerHTML = `<div class="page-head"><h1>📝 課後小記</h1>
      <button class="btn btn-sm ${!mom && isWeekend(weekStart(today), today) ? 'btn-primary' : 'btn-ghost'}" data-go="/k/${kid}/weekly">📒 記事錄整理</button></div>
    <div id="jBody"><p class="empty">載入中…</p></div>`;
  el.querySelector('[data-go]').addEventListener('click', (e) => go(e.currentTarget.dataset.go));
  const body = el.querySelector('#jBody');
  const noteOf = (d) => (notes || []).find((n) => n.date === d) || null;

  // ---- 草稿（還沒送出前，關掉 App 也不會不見；只存在這台裝置） ----
  const draftKey = (d) => `kp.jdraft.${kid}.${d}`;
  const saveDraft = () => { try { localStorage.setItem(draftKey(date), JSON.stringify(draft)); } catch {} };
  const loadDraft = (d) => { try { return JSON.parse(localStorage.getItem(draftKey(d)) || 'null'); } catch { return null; } };
  const clearDraft = (d) => { try { localStorage.removeItem(draftKey(d)); } catch {} };

  function startEdit(d) {
    date = d;
    const n = noteOf(d);
    draft = { ...(n || {}), ...(loadDraft(d) || {}), skipped: false };
    const cls = classesOn(cfg, kid, d);
    if (!draft.memorable && cls.length === 1) draft.memorable = cls[0].category;
    more = !isLightDay(cfg, d) || filled(draft.interesting) || filled(draft.question) || filled(draft.projectProgress);
    extraOpen = filled(draft.extraText);
    editing = true;
    lastSig = kwSig();
  }

  function pickDefault() {
    if (date) return;
    // 本週還沒寫的上課日（最近的優先），都寫了就看最近一天
    const open = [...dates].reverse().find((d) => !noteOf(d));
    date = open || dates[dates.length - 1] || null;
  }

  function draw() {
    if (!notes || !prompts) return;
    pickDefault();
    if (!mom && date && !editing && !noteOf(date) && canWrite(cfg, kid, date, today)) startEdit(date);
    body.innerHTML = `
      ${weekStrip()}
      ${mom ? momView() : date ? (editing ? form() : summary(noteOf(date), true)) : `<section class="card"><p class="empty">這週還沒有資優班的課 🎈</p></section>`}
      ${mom ? '' : history()}`;
  }

  // ---- 本週上課日 ----
  function weekStrip() {
    if (!dates.length) return '';
    return `<div class="jweek">${dates.map((d) => {
      const st = noteStatus(noteOf(d));
      return `<button class="jday ${d === date && !mom ? 'active' : ''}" data-act="pickDate" data-date="${d}">
        <strong>${labelRelative(d) || labelMD(d)}</strong><span class="small">${classesOn(cfg, kid, d).map((c) => categoryOf(c.category).emoji).join('')}</span>
        <span class="tag ${st.cls}">${st.text}</span></button>`;
    }).join('')}</div>`;
  }

  // ---- 孩子填寫 ----
  const feeling = (id) => (prompts.feelings || []).find((f) => f.id === id);
  const bf = () => prompts.boringFlow || {};
  const input = (name, label, ph = '', hint = '') => `
    <label class="field"><span>${label}</span><textarea name="${name}" rows="2" maxlength="500" placeholder="${esc(ph)}">${esc(draft[name] || '')}</textarea>${hint ? `<span class="field-hint">${hint}</span>` : ''}</label>`;
  const choice = (act, value, label, on) => `<button type="button" class="jchoice ${on ? 'on' : ''}" data-act="${act}" data-v="${esc(value)}" aria-pressed="${on}">${label}</button>`;

  function moodBlock() {
    const f = feeling(draft.mood);
    const showBoring = draft.mood === 'boring' || (draft.mood && feelingInText(`${draft.learned || ''} ${draft.interesting || ''}`) === 'boring');
    let html = '';
    if (f && (f.refinements || []).length) html += `<div class="chips-row">${f.refinements.map((r) => choice('detail', r, esc(r), draft.moodDetail === r)).join('')}</div>`;
    if (f && f.followUp) html += input('followUpAnswer', `💭 ${esc(f.followUp)}`, f.sentenceStarter || '', '可以不寫');
    if (draft.mood === 'tired' || (draft.mood && draft.mood !== 'tired' && feelingInText(draft.learned) === 'tired')) {
      html += `<p class="jnote">😪 ${esc((f && f.id === 'tired' ? f.message || (f.note || '').replace(/^.*只顯示：/, '') : '') || '累的時候也記得留下一句，很棒')}</p>`;
    }
    if (showBoring) {
      const reason = (bf().reasons || []).find((r) => r.id === draft.boringReason);
      html += `<div class="field"><span>${esc(bf().firstLevelQuestion || '是哪一種呢？')}</span>
        <div class="chips-col">${(bf().reasons || []).map((r) => choice('reason', r.id, esc(r.label), draft.boringReason === r.id)).join('')}</div></div>`;
      if (reason) {
        html += `<p class="jnote">🙏 ${esc(bf().responseMessage || '')}</p>`;
        if (reason.secondLevel) html += input('boringAnswer', esc(reason.secondLevel), '', '可以不寫');
        else if (reason.allowFreeText) html += input('boringAnswer', '想說說看嗎？', '', '可以不寫');
      }
    }
    return html;
  }

  function form() {
    const cls = classesOn(cfg, kid, date);
    const light = isLightDay(cfg, date);
    const late = date !== today;
    const lv = levelOf(draft);
    const p = (l) => pointsFor(l, !late, cfg);
    const hasProject = cls.some((c) => c.category === 'project');
    const others = cls.filter((c) => c.category !== draft.memorable);
    return `
      <section class="card jform">
        <div class="card-head"><h2>${labelMD(date)} ${late ? '<span class="tag tag-wait">補寫</span>' : ''}</h2>
          <button class="btn btn-sm btn-ghost" data-act="skip">今天休息</button></div>
        <p class="muted small">今天的課：${cls.map((c) => `${categoryOf(c.category).emoji} ${esc(categoryOf(c.category).label)}${c.count > 1 ? ` ×${c.count}` : ''}`).join('、')}</p>
        ${cls.length > 1 ? `<div class="field"><span>哪一堂最有印象？</span><div class="chips-row">${cls.map((c) => choice('memorable', c.category, `${categoryOf(c.category).emoji} ${esc(categoryOf(c.category).label)}`, draft.memorable === c.category)).join('')}</div></div>` : ''}
        <div class="field"><span>上完課的感覺？</span>
          <div class="moods">${(prompts.feelings || []).map((f) => `
            <button type="button" class="mood ${draft.mood === f.id ? 'on' : ''}" data-act="mood" data-v="${f.id}" aria-pressed="${draft.mood === f.id}">
              <span class="mood-emoji">${MOOD_EMOJI[f.id] || '🙂'}</span><span>${esc(f.label)}</span></button>`).join('')}</div></div>
        ${moodBlock()}
        ${input('learned', '📚 今天學到了什麼？', '一句話就好')}
        ${more ? `
          <div class="jmore">
            <p class="muted small">多寫一項 +${p('advanced')}，兩項都寫 +${p('full')}（都可以不寫）</p>
            ${input('interesting', '✨ 我覺得有趣的是…')}
            ${input('question', '❓ 我想知道…')}
            ${hasProject ? input('projectProgress', '🧭 專題：今天做到哪裡？', '', '可以不寫') : ''}
          </div>` : `<button type="button" class="btn btn-ghost btn-block" data-act="more">✏️ 想多寫一點</button>`}
        ${others.length && draft.memorable ? (extraOpen ? `
          <div class="jmore"><div class="field"><span>也想記另一堂</span><div class="chips-row">${others.map((c) => choice('extraCat', c.category, `${categoryOf(c.category).emoji} ${esc(categoryOf(c.category).label)}`, draft.extraCategory === c.category)).join('')}</div></div>
            ${input('extraText', '一句話就好', '')}</div>` : `<button type="button" class="btn btn-ghost btn-sm" data-act="extra">＋ 也想記另一堂</button>`) : ''}
        <div class="jsubmit">
          <span class="muted small">${lv ? `${LEVEL_LABEL[lv]}版 +${p(lv)} 點` : !draft.mood ? '選一個感覺，再寫一句學到的' : '再寫一句學到的就完成了'}</span>
          <button class="btn btn-primary" data-act="save" ${lv ? '' : 'disabled'}>完成 ✓</button>
        </div>
      </section>`;
  }

  // ---- 已完成的小記 ----
  function summary(n, main, day) {
    const d = n ? n.date : day || date;
    const writable = !mom && canWrite(cfg, kid, d, today);
    const cls = classesOn(cfg, kid, d);
    if (!n) {
      return `<section class="card jcard"><div class="card-head"><h2>${labelMD(d)}</h2></div>
        <p class="muted small">${cls.map((c) => `${categoryOf(c.category).emoji} ${esc(categoryOf(c.category).label)}`).join('、')}</p>
        <p class="empty">還沒寫</p></section>`;
    }
    const lv = levelOf(n);
    const f = feeling(n.mood);
    const reason = (bf().reasons || []).find((r) => r.id === n.boringReason);
    const line = (icon, label, v) => (filled(v) ? `<p><span class="muted small">${icon} ${label}</span><br>${esc(v)}</p>` : '');
    return `
      <section class="card jcard">
        <div class="card-head"><h2>${labelMD(d)} ${n.memorable ? `<span class="tag">${categoryOf(n.memorable).emoji} ${esc(categoryOf(n.memorable).label)}</span>` : ''}</h2>
          ${n.skipped ? '<span class="tag">今天休息 🌙</span>' : lv ? `<span class="tag tag-ok">${LEVEL_LABEL[lv]}${n.awarded ? ` +${n.awarded} ⭐` : ''}</span>` : '<span class="tag tag-wait">寫到一半</span>'}</div>
        ${n.skipped ? `<p class="muted">${mom ? '這天選擇休息' : '休息一下沒關係，下次再記 🙂'}</p>` : `
          ${f ? `<p class="jmood">${MOOD_EMOJI[n.mood] || ''} ${esc(f.label)}${n.moodDetail ? `・${esc(n.moodDetail)}` : ''}</p>` : ''}
          ${f && f.followUp ? line('💭', esc(f.followUp), n.followUpAnswer) : ''}
          ${reason ? `<p><span class="muted small">😐 ${esc(reason.label)}</span>${filled(n.boringAnswer) ? `<br>${esc(n.boringAnswer)}` : ''}</p>` : ''}
          ${line('📚', '學到', n.learned)}
          ${line('✨', '有趣的是', n.interesting)}
          ${line('❓', '我想知道', n.question)}
          ${line('🧭', '專題進度', n.projectProgress)}
          ${n.extraCategory && filled(n.extraText) ? line(categoryOf(n.extraCategory).emoji, esc(categoryOf(n.extraCategory).label), n.extraText) : ''}`}
        ${filled(n.momComment) ? `<div class="jcomment">💬 媽媽：${esc(n.momComment)}</div>` : ''}
        ${mom ? `<form class="jcomment-form" data-id="${esc(n.id)}"><textarea name="c" rows="2" maxlength="300" placeholder="回應孩子（選填）">${esc(n.momComment || '')}</textarea>
          <button class="btn btn-sm btn-primary" type="submit">${filled(n.momComment) ? '更新留言' : '留言'}</button></form>` : ''}
        ${main && writable ? `<div class="btn-row"><button class="btn btn-ghost" data-act="edit" data-date="${d}">${n.skipped ? '改成要寫' : '✏️ 修改'}</button></div>` : ''}
      </section>`;
  }

  function history() {
    const old = (notes || []).filter((n) => !dates.includes(n.date));
    if (!old.length) return '';
    return `<section class="card"><button class="row-btn" data-act="toggleOld" aria-expanded="${showOld}">
      <span class="grow"><strong>📚 以前的小記</strong> <span class="muted small">${old.length} 篇</span></span><span class="muted">${showOld ? '▲ 收起' : '▼ 展開'}</span></button></section>
      ${showOld ? old.map((n) => summary(n, false)).join('') : ''}`;
  }

  // 媽媽的每週摘要（含連續幾週的提示，只有媽媽看得到）
  function momSummary() {
    const w = weekStart(today);
    const s = weekSummary(cfg, kid, notes, w, today);
    const hints = sensitiveHints(notes, today, prompts, Number(cfg.hintWeeks) || 2);
    const hintText = (prompts.boringFlow || {}).parentHint || '這類課程近幾週有較多類似回應，可以找時間聊聊';
    const moods = Object.entries(s.moods).sort((a, b) => b[1] - a[1]).map(([m, n]) => `${MOOD_EMOJI[m] || ''}${esc((feeling(m) || {}).label || m)} ${n}`).join('　');
    const lv = ['full', 'advanced', 'basic'].filter((l) => s.levels[l]).map((l) => `${LEVEL_LABEL[l]} ${s.levels[l]}`).join('・');
    return `<section class="card jsummary">
      <div class="card-head"><h2>📊 這週摘要</h2><span class="muted small">${labelMD(w)} 起</span></div>
      ${s.classDays ? `<p>上課 ${s.classDays} 天：寫了 <strong>${s.written}</strong> 天${s.skipped ? `、休息 ${s.skipped} 天` : ''}${s.missing ? `、還沒寫 ${s.missing} 天` : ''}${s.points ? `・小記 +${s.points} 點` : ''}</p>
        ${lv ? `<p class="muted small">完成程度：${lv}</p>` : ''}
        ${moods ? `<p>${moods}</p>` : ''}
        ${s.questions.length ? `<p class="muted small">❓ 孩子想知道的</p><ul class="wnotes">${s.questions.map((q) => `<li>${esc(q.text)} <span class="muted small">${labelMD(q.date)}${q.category ? `・${esc(categoryOf(q.category).label)}` : ''}</span></li>`).join('')}</ul>` : ''}` : '<p class="muted">這週還沒有上課</p>'}
      ${hints.map((h) => `<div class="jhint">💡 ${categoryOf(h.category).emoji} ${esc(categoryOf(h.category).label)}：${esc(hintText)}<br><span class="muted small">連續 ${h.weeks} 週都有「沒興趣／不喜歡／跟不上」的回應（只有你看得到）</span></div>`).join('')}
    </section>`;
  }

  function momView() {
    const thisWeek = dates.map((d) => summary(noteOf(d), false, d)).reverse().join('');
    const old = (notes || []).filter((n) => !dates.includes(n.date));
    return `${momSummary()}${thisWeek || '<section class="card"><p class="empty">這週還沒有資優班的課</p></section>'}
      ${old.length ? `<h2 class="section-title">以前的小記</h2>${old.slice(0, 30).map((n) => summary(n, false)).join('')}` : ''}`;
  }

  // ---- 事件 ----
  body.addEventListener('input', (e) => {
    if (!editing || !e.target.name || !(e.target.name in { followUpAnswer: 1, boringAnswer: 1, learned: 1, interesting: 1, question: 1, projectProgress: 1, extraText: 1 })) return;
    draft[e.target.name] = e.target.value;
    saveDraft();
    // 只更新送出列（不重畫整張表單，避免打字時失去焦點）
    const lv = levelOf(draft);
    const sub = body.querySelector('.jsubmit');
    if (sub) {
      const late = date !== today;
      sub.querySelector('span').textContent = lv ? `${LEVEL_LABEL[lv]}版 +${pointsFor(lv, !late, cfg)} 點` : !draft.mood ? '選一個感覺，再寫一句學到的' : '再寫一句學到的就完成了';
      sub.querySelector('button').disabled = !lv;
    }
  });
  // 打完字離開欄位時，若出現「無聊」「累」等字，補上對應的追問
  // 只有追問真的要改變時才重畫（重畫會讓剛按下的按鈕失效，例如打完字直接按「完成」）
  const kwSig = () => `${feelingInText(`${draft.learned || ''} ${draft.interesting || ''}`) === 'boring'}|${feelingInText(draft.learned) === 'tired'}`;
  let lastSig = '';
  body.addEventListener('change', (e) => {
    if (!editing || !['learned', 'interesting'].includes(e.target.name) || !draft.mood) return;
    const sig = kwSig();
    if (sig !== lastSig) { lastSig = sig; redraw(); }
  });
  const redraw = () => { const y = window.scrollY; draw(); window.scrollTo(0, y); };

  body.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target.closest('.jcomment-form');
    if (!f) return;
    const btn = f.querySelector('button');
    btn.disabled = true;
    try { await setMomComment(f.dataset.id, f.querySelector('textarea').value); toast('已留言', 'ok'); } catch (err) { showError(err, '留言'); } finally { btn.disabled = false; }
  });

  body.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const v = b.dataset.v;
    try {
      switch (b.dataset.act) {
        case 'pickDate':
          if (!mom) go(`/k/${kid}/journal/${b.dataset.date}`);
          return;
        case 'mood':
          if (draft.mood !== v) { draft.moodDetail = ''; draft.followUpAnswer = ''; if (v !== 'boring') { draft.boringReason = ''; draft.boringAnswer = ''; } }
          draft.mood = v; break;
        case 'detail': draft.moodDetail = draft.moodDetail === v ? '' : v; break;
        case 'reason': if (draft.boringReason !== v) draft.boringAnswer = ''; draft.boringReason = v; break;
        case 'memorable': draft.memorable = v; if (draft.extraCategory === v) draft.extraCategory = ''; break;
        case 'extraCat': draft.extraCategory = v; break;
        case 'more': more = true; break;
        case 'extra': extraOpen = true; break;
        case 'toggleOld': showOld = !showOld; break;
        case 'edit': startEdit(b.dataset.date); break;
        case 'skip': {
          if (!(await confirmDialog('今天休息，不寫小記？\n休息不會扣點，這週內想寫還是可以回來寫。', { okLabel: '今天休息' }))) return;
          await saveNote(kid, date, { skipped: true });
          editing = false;
          toast('好好休息 🌙');
          break;
        }
        case 'save': {
          const lv = levelOf(draft);
          if (!lv) return;
          b.disabled = true;
          const data = { ...draft, skipped: false };
          if (!(data.extraCategory && filled(data.extraText))) { data.extraCategory = ''; data.extraText = ''; }
          await saveNote(kid, date, data);
          clearDraft(date);
          editing = false;
          toast(`完成了！${LEVEL_LABEL[lv]}版 +${pointsFor(lv, date === today, cfg)} ⭐`, 'ok');
          break;
        }
        default: return;
      }
      if (editing) { saveDraft(); lastSig = kwSig(); }
      redraw();
    } catch (err) { showError(err, '儲存小記'); b.disabled = false; }
  });

  const unsub = watchNotes(kid, (l) => { notes = l; draw(); }, (e) => showError(e, '讀取小記'));
  loadPrompts().then((p) => { prompts = p; draw(); }).catch((e) => showError(e, '讀取提示'));
  return () => unsub();
}
