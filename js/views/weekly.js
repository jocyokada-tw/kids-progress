import { state, isMom, member } from '../state.js';
import { esc, toast, showError, modal, copyText } from '../ui.js';
import { go } from '../router.js';
import { todayStr, labelMD, weekStart, addDays, isDateStr } from '../utils/date.js';
import { journalSettings, usesJournal, categoryOf } from '../utils/journal.js';
import { weekClasses, notesFor, needsLowPressure, pickStarters, starterInsert, isWeekend, weeklyPage } from '../utils/weekly.js';
import { watchNotes, loadPrompts, watchWeekly, watchWeeklies, saveWeeklyText, setWeeklyStatus, watchCustomStarters, saveCustomStarters } from '../store/journal.js';

const filled = (s) => typeof s === 'string' && s.trim().length > 0;
export const weekLabel = (w) => `${labelMD(w).replace(/（.）/, '')}–${labelMD(addDays(w, 6)).replace(/（.）/, '')}`;

/** 週末記事錄整理：把這週每一類課的小記整理成幾句話，可以照著抄到學校的記事錄 */
export function mountWeekly(el, { kid, arg }) {
  const today = todayStr();
  const mom = isMom();
  const cfg = journalSettings(state.settings);
  const week = isDateStr(arg) && weekStart(arg) === arg && arg <= today ? arg : weekStart(today);
  const cats = weekClasses(cfg, kid, week);
  const current = week === weekStart(today);
  let prompts = null, notes = null, weekly, weeklies = [], customs = [];
  let built = false;
  const texts = {};            // 類別 → 目前文字（打字中以這裡為準，不被資料庫的快照蓋掉）
  const starters = {};         // 類別 → { list, shown }
  const timers = {};

  el.innerHTML = `<div class="page-head"><h1>📒 記事錄整理</h1>
      <button class="btn btn-sm btn-ghost no-print" data-act="toJournal">📝 小記</button></div>
    <p class="muted no-print">${weekLabel(week)}${current ? '（這週）' : ''}</p>
    <div id="wBody"><p class="empty">載入中…</p></div>`;
  const body = el.querySelector('#wBody');
  if (!usesJournal(cfg, kid)) {
    body.innerHTML = `<section class="card"><p class="empty">${esc(member(kid).name)}沒有開啟課後小記</p></section>`;
    return () => {};
  }

  const editable = () => !mom && current;
  const textOf = (c) => (c in texts ? texts[c] : (((weekly && weekly.sections) || {})[c] || {}).text || '');

  function refresh(c, reset) {
    const s = starters[c] ||= { list: [], shown: new Set() };
    if (reset) s.shown = new Set();
    const r = pickStarters({ prompts, category: c, customs, lowPressure: needsLowPressure(notes, week, c, prompts), shown: s.shown });
    if (r.reset) s.shown = new Set();
    r.list.forEach((x) => s.shown.add(x.id));
    s.list = r.list;
  }

  const recall = (c) => {
    const list = notesFor(notes, week, c);
    if (!list.length) {
      return `<div class="wrecall"><p class="muted small">這週這堂課沒有寫小記，想一想：</p>
        <ul class="wprompts">${weeklyPage(prompts).recallPrompts.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></div>`;
    }
    return `<div class="wrecall"><p class="muted small">這週的小記</p><ul class="wnotes">${list.map((n) => {
      const parts = n.extraCategory === c && n.memorable !== c ? [['✏️', n.extraText]]
        : [['📚', n.learned], ['✨', n.interesting], ['❓', n.question], ['🧭', n.projectProgress]];
      return `<li><span class="muted small">${labelMD(n.date)}</span> ${parts.filter(([, v]) => filled(v)).map(([i, v]) => `${i} ${esc(v)}`).join('　')}</li>`;
    }).join('')}</ul></div>`;
  };

  const starterHtml = (c) => `
    <div class="chips-row">${(starters[c].list || []).map((s) => `<button type="button" class="jchoice wstarter" data-act="use" data-cat="${c}" data-text="${esc(s.text)}">${esc(s.text)}</button>`).join('')}</div>
    <div class="btn-row" style="justify-content:flex-start">
      <button type="button" class="btn btn-sm btn-ghost" data-act="refresh" data-cat="${c}">🔄 換一組</button>
      <button type="button" class="btn btn-sm btn-ghost" data-act="addStarter" data-cat="${c}">＋ 我的開頭</button></div>`;

  function sectionHtml({ category: c, count }) {
    const cat = categoryOf(c);
    return `<section class="card wsec" data-cat="${c}">
      <h2>${cat.emoji} ${esc(cat.label)} <span class="muted small">這週 ${count} 堂</span></h2>
      ${recall(c)}
      ${editable() ? `<p class="muted small" style="margin-top:12px">可以這樣開頭（點一下放進去）</p><div class="wstarters" data-cat="${c}">${starterHtml(c)}</div>
        <label class="field"><span class="sr-only">${esc(cat.label)}的整理</span><textarea name="w-${c}" data-cat="${c}" rows="5" maxlength="3000" placeholder="寫幾句這週學到、覺得有趣、或想知道的">${esc(textOf(c))}</textarea></label>`
        : `<div class="wtext">${filled(textOf(c)) ? esc(textOf(c)).replace(/\n/g, '<br>') : '<span class="muted">（沒有寫）</span>'}</div>`}
    </section>`;
  }

  function statusHtml() {
    const any = cats.some((c) => filled(textOf(c.category)));
    const done = weekly && weekly.status === 'done';
    const weekend = isWeekend(week, today);
    const pts = Number(cfg.weeklyPoints) || 0;
    let msg;
    if (done) msg = `<p><strong>✓ 整理好了${weekly.awarded ? `　+${weekly.awarded} ⭐` : ''}</strong></p><p class="muted small">${esc(weeklyPage(prompts).doneMessage)}</p>`;
    else if (!editable()) msg = `<p class="muted">${mom ? '還沒完成' : '這週已經過去了'}</p>`;
    else if (!weekend) msg = `<p class="muted small">週六、週日可以按「完成」${pts ? `（+${pts} 點）` : ''}。現在可以先寫，會自動存起來。</p>`;
    else msg = `<p class="muted small">${any ? `寫好了就按完成${pts ? `，+${pts} 點` : ''}` : '至少寫一類課就可以完成'}</p>`;
    return `<section class="card wstatus no-print">${msg}
      <div class="btn-row">
        ${any ? '<button class="btn btn-ghost" data-act="copy">📋 複製</button><button class="btn btn-ghost" data-act="print">🖨️ 列印</button>' : ''}
        ${editable() && weekend && !done ? `<button class="btn btn-primary" data-act="done" ${any ? '' : 'disabled'}>完成 ✓</button>` : ''}
      </div></section>`;
  }

  const printHtml = () => `<div class="print-only"><h2>${esc(member(kid).name)}　記事錄整理　${weekLabel(week)}</h2>
    ${cats.filter((c) => filled(textOf(c.category))).map((c) => `<h3>${esc(categoryOf(c.category).label)}</h3><p>${esc(textOf(c.category)).replace(/\n/g, '<br>')}</p>`).join('')}</div>`;

  const otherWeeks = () => {
    const list = weeklies.filter((w) => w.week !== week && Object.values(w.sections || {}).some((s) => filled(s && s.text)));
    if (!list.length && current) return '';
    return `<section class="card no-print"><h2>其他週</h2><ul class="rows">
      ${!current ? `<li><button class="row-btn" data-act="week" data-week="${weekStart(today)}"><span class="grow">這週</span><span>›</span></button></li>` : ''}
      ${list.map((w) => `<li><button class="row-btn" data-act="week" data-week="${w.week}"><span class="grow">${weekLabel(w.week)}</span>
        ${w.status === 'done' ? `<span class="tag tag-ok">✓${w.awarded ? ` +${w.awarded}` : ''}</span>` : '<span class="tag">草稿</span>'}</button></li>`).join('')}</ul></section>`;
  };

  function draw() {
    if (!prompts || !notes || weekly === undefined) return;
    if (!built) {
      built = true;
      if (editable()) cats.forEach((c) => refresh(c.category));
      body.innerHTML = cats.length
        ? `<div id="wSecs">${cats.map(sectionHtml).join('')}</div><div id="wStatus"></div><div id="wPrint"></div><div id="wOther"></div>`
        : `<section class="card"><p class="empty">這週沒有資優班的課 🎈</p></section><div id="wOther"></div>`;
    } else if (!editable()) {
      // 只能看：文字可能更新了，整個重畫
      const secs = body.querySelector('#wSecs');
      if (secs) secs.innerHTML = cats.map(sectionHtml).join('');
    }
    const st = body.querySelector('#wStatus'); if (st) st.innerHTML = statusHtml();
    const pr = body.querySelector('#wPrint'); if (pr) pr.innerHTML = printHtml();
    body.querySelector('#wOther').innerHTML = otherWeeks();
  }

  const save = (c) => {
    clearTimeout(timers[c]);
    timers[c] = setTimeout(() => saveWeeklyText(kid, week, c, texts[c]).catch((e) => showError(e, '儲存')), 800);
  };

  body.addEventListener('input', (e) => {
    const c = e.target.dataset && e.target.dataset.cat;
    if (!c || e.target.tagName !== 'TEXTAREA') return;
    texts[c] = e.target.value;
    save(c);
    const st = body.querySelector('#wStatus'); if (st) st.innerHTML = statusHtml();
    body.querySelector('#wPrint').innerHTML = printHtml();
  });

  const fullText = () => `${member(kid).name} 記事錄整理 ${weekLabel(week)}\n\n` + cats.filter((c) => filled(textOf(c.category)))
    .map((c) => `【${categoryOf(c.category).label}】\n${textOf(c.category).trim()}`).join('\n\n');

  body.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const c = b.dataset.cat;
    try {
      switch (b.dataset.act) {
        case 'use': {
          const ta = body.querySelector(`textarea[data-cat="${c}"]`);
          const add = starterInsert(b.dataset.text);
          ta.value = ta.value.trim() ? `${ta.value.replace(/\s+$/, '')}\n${add}` : add;
          texts[c] = ta.value;
          ta.focus();
          ta.setSelectionRange(ta.value.length, ta.value.length);
          save(c);
          body.querySelector('#wStatus').innerHTML = statusHtml();
          break;
        }
        case 'refresh':
          refresh(c);
          body.querySelector(`.wstarters[data-cat="${c}"]`).innerHTML = starterHtml(c);
          break;
        case 'addStarter': {
          const r = await modal({
            title: `我的開頭（${categoryOf(c).label}）`,
            html: `<label class="field"><span>自己想用的開頭</span><input name="t" maxlength="60" placeholder="例如：今天讓我想不通的是……"></label>
              <p class="muted small">之後整理${esc(categoryOf(c).label)}時，也會出現這句。</p>`,
            buttons: [{ id: 'cancel', label: '取消' }, { id: 'ok', label: '加入', kind: 'primary' }],
            validate: (id, d) => (id === 'ok' && !d.t ? '請輸入開頭' : null)
          });
          if (r.id !== 'ok') return;
          const item = { id: 'c' + Date.now().toString(36), category: c, text: r.data.t };
          await saveCustomStarters(kid, [...customs, item]);
          const s = starters[c];
          s.list = [{ ...item, type: 'custom' }, ...s.list].slice(0, Math.max(3, s.list.length));
          s.shown.add(item.id);
          body.querySelector(`.wstarters[data-cat="${c}"]`).innerHTML = starterHtml(c);
          toast('加入了 ✓', 'ok');
          break;
        }
        case 'done':
          b.disabled = true;
          for (const k of Object.keys(timers)) { clearTimeout(timers[k]); await saveWeeklyText(kid, week, k, texts[k]); }
          await setWeeklyStatus(kid, week, 'done');
          toast(`整理好了！${cfg.weeklyPoints ? ` +${cfg.weeklyPoints} ⭐` : ''}`, 'ok');
          break;
        case 'copy':
          toast((await copyText(fullText())) ? '已複製，可以貼到備忘錄或傳給自己' : '無法複製', 'ok');
          break;
        case 'print': window.print(); break;
        case 'week': go(`/k/${kid}/weekly/${b.dataset.week}`); break;
        case 'toJournal': go(`/k/${kid}/journal`); break;
      }
    } catch (err) { showError(err); b.disabled = false; }
  });
  el.querySelector('[data-act=toJournal]').addEventListener('click', () => go(`/k/${kid}/journal`));

  const flush = () => { for (const k of Object.keys(timers)) { clearTimeout(timers[k]); saveWeeklyText(kid, week, k, texts[k]).catch(() => {}); } };
  const unsubs = [
    watchNotes(kid, (l) => { notes = l; draw(); }, (e) => showError(e, '讀取小記')),
    watchWeekly(kid, week, (w) => { weekly = w; draw(); }, (e) => showError(e, '讀取整理')),
    watchWeeklies(kid, (l) => { weeklies = l; if (built) draw(); }, (e) => showError(e, '讀取整理')),
    watchCustomStarters(kid, (l) => { customs = l; }, () => {})
  ];
  loadPrompts().then((p) => { prompts = p; draw(); }).catch((e) => showError(e, '讀取提示'));
  return () => { flush(); unsubs.forEach((u) => u()); };
}
