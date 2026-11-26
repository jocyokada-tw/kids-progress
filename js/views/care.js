import { state, isMom, member } from '../state.js';
import { esc, toast, showError, modal, saveFile, copyText } from '../ui.js';
import { go } from '../router.js';
import { todayStr, addDays, labelMD, labelRelative, isDateStr } from '../utils/date.js';
import { careSettings, usesCare, medsAt, watchItems, sleepMinutes, fmtDuration, morningDone, eveningDone, careCsv, careReportData, careReportParts, careReportHtml, SCORE_LABEL, SCORE_EMOJI } from '../utils/care.js';
import { watchLog, watchLogs, saveLog, daySummary, getLogsOnce } from '../store/care.js';
import { journalSettings, catsOn, classLevels, categoryOf } from '../utils/journal.js';

const LV = { basic: '基本', advanced: '進階', full: '完整' };
const nowHM = () => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
const verb = (m) => (/噴/.test(`${m.name}${m.dose}`) ? '噴' : '吃');

/** 照顧紀錄（只有媽媽）：早上（早上的藥、昨晚起床時間）、晚上（睡前的藥、情緒、學習、觀察、上床時間）、兩週一覽、匯出 */
export function mountCare(el, { kid, arg }) {
  const today = todayStr();
  const date = isDateStr(arg) && arg <= today ? arg : today;
  const prevDate = addDays(date, -1);
  const cfg = careSettings(state.care);
  const name = member(kid).name;

  if (!isMom()) { go(`/k/${kid}/home`); return () => {}; }
  if (!state.care || !usesCare(cfg, kid)) {
    el.innerHTML = `<div class="page-head"><h1>🩺 照顧紀錄</h1></div>
      <section class="card"><p class="empty">還沒有為${esc(name)}開啟照顧紀錄<br><button class="btn btn-primary" data-go="/settings">到設定開啟</button></p></section>`;
    el.querySelector('[data-go]').addEventListener('click', () => go('/settings'));
    return () => {};
  }

  let log, prev, logs = null, sum = null, pending = false;

  el.innerHTML = `
    <div class="page-head"><h1>🩺 ${esc(name)}的照顧紀錄</h1></div>
    <p class="muted small">只有媽媽的裝置看得到這些紀錄。</p>
    <div class="range-nav care-nav">
      <button class="icon-btn big" data-act="day" data-d="${addDays(date, -1)}" aria-label="前一天">‹</button>
      <strong>${labelMD(date)}${labelRelative(date) ? ` ${labelRelative(date)}` : ''}</strong>
      <button class="icon-btn big" data-act="day" data-d="${addDays(date, 1)}" aria-label="後一天" ${date >= today ? 'disabled' : ''}>›</button>
      ${date !== today ? `<button class="btn btn-sm btn-ghost" data-act="day" data-d="${today}">今天</button>` : ''}
    </div>
    <div id="cBody"><p class="empty">載入中…</p></div>
    <div id="cTable"></div>`;
  const body = el.querySelector('#cBody');

  // 打字中不要整個重畫（會跳出文字框）：等離開文字框再畫
  const typing = () => { const a = document.activeElement; return a && el.contains(a) && /^(INPUT|TEXTAREA)$/.test(a.tagName) && a.type !== 'button'; };
  function draw() {
    if (log === undefined || prev === undefined) return;
    if (typing()) { pending = true; return; }
    pending = false;
    body.innerHTML = morningCard() + eveningCard();
  }
  el.addEventListener('focusout', () => setTimeout(() => { if (pending && !typing()) draw(); }, 0));

  // ---------- 早上 ----------
  const v = (o, k) => esc((o && o[k]) || '');
  function medRow(m, l) {
    const x = (l && l.meds && l.meds[m.id]) || {};
    const head = `<div class="grow"><strong>💊 ${esc(m.name)}</strong><br><span class="muted small">${esc(m.dose || '')}</span></div>`;
    if (x.status === 'taken') {
      return `<div class="cmed">${head}<span class="tag tag-ok">✓ 已${verb(m)}</span>
        <input type="time" class="ctime" data-f="medAt" data-id="${m.id}" value="${v(x, 'at')}" aria-label="時間">
        <button class="btn btn-sm btn-ghost" data-act="medClear" data-id="${m.id}">改</button></div>`;
    }
    if (x.status === 'skipped') {
      return `<div class="cmed">${head}<span class="tag tag-bad">沒有${verb(m)}</span>
        <button class="btn btn-sm btn-ghost" data-act="medClear" data-id="${m.id}">改</button>
        <input class="cnote" data-f="medNote" data-id="${m.id}" value="${v(x, 'note')}" placeholder="原因（選填）" maxlength="200"></div>`;
    }
    return `<div class="cmed">${head}
      <button class="btn btn-primary" data-act="medTaken" data-id="${m.id}">已${verb(m)} ✓</button>
      <button class="btn btn-ghost" data-act="medSkipped" data-id="${m.id}">沒有${verb(m)}</button></div>`;
  }

  function morningCard() {
    const meds = medsAt(cfg, 'morning');
    const s = (prev && prev.sleep) || {};
    const mins = sleepMinutes(s.bed, s.wake);
    return `<section class="card ccard">
      <div class="card-head"><h2>🌅 早上</h2>${morningDone(log, cfg) ? '<span class="tag tag-ok">✓ 記好了</span>' : ''}</div>
      ${meds.map((m) => medRow(m, log)).join('')}
      <div class="csub"><strong>😴 昨晚 ${labelMD(prevDate)} 的睡眠</strong>
        <div class="field-row">
          <label class="field"><span>上床</span><input type="time" data-f="sleepBed" data-on="prev" value="${v(s, 'bed')}"></label>
          <label class="field"><span>起床</span><input type="time" data-f="sleepWake" data-on="prev" value="${v(s, 'wake')}"></label>
        </div>
        ${mins != null ? `<p class="muted small">睡了 ${fmtDuration(mins)}</p>` : ''}
        <label class="field"><span>睡眠狀況（有特殊狀況才寫）</span><input data-f="sleepNote" data-on="prev" value="${v(s, 'note')}" maxlength="200" placeholder="例如：半夜醒來一次"></label>
      </div></section>`;
  }

  // ---------- 晚上 ----------
  const scoreRow = (f, cur) => `<div class="cscore">${[1, 2, 3, 4, 5].map((n) => `
    <button type="button" class="jchoice ${cur === n ? 'on' : ''}" data-act="score" data-f="${f}" data-v="${n}" aria-pressed="${cur === n}"><span class="cscore-emoji">${SCORE_EMOJI[n]}</span><span>${n} ${SCORE_LABEL[n]}</span></button>`).join('')}</div>`;

  function summaryHtml() {
    if (!sum) return '<p class="muted small">讀取當天的紀錄…</p>';
    const lines = [];
    const items = sum.items.filter((i) => !i.missed);
    if (items.length) {
      const done = items.filter((i) => i.done || i.review === 'approved').length;
      const ok = items.filter((i) => i.review === 'approved').length;
      lines.push(`✅ 清單 ${done}/${items.length} 完成${ok && ok < done ? `（已核可 ${ok}）` : ''}`);
    }
    const s = sum.sess;
    if (s) lines.push(`📖 單字：${!s.finished ? '做到一半' : s.perfect ? '完成，一次全對 🎯' : `完成，答錯 ${(s.wrong || []).length} 個字`}${s.practice ? `・額外練習 ${s.practice} 次` : ''}`);
    const jcfg = journalSettings(state.settings);
    const cats = catsOn(jcfg, kid, date);
    if ((jcfg.kids || []).includes(kid) && cats.length) {
      const n = sum.note;
      if (!n) lines.push('📝 課後小記：還沒寫');
      else if (n.skipped) lines.push('📝 課後小記：選擇休息');
      else { const lv = classLevels(n, cats); lines.push(`📝 課後小記：${cats.map((c) => `${categoryOf(c).label} ${lv[c] ? LV[lv[c]] : '還沒寫'}`).join('、')}`); }
    }
    return lines.length ? `<ul class="csum">${lines.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="muted small">這天 App 裡沒有學習紀錄</p>';
  }

  function eveningCard() {
    const meds = medsAt(cfg, 'bedtime');
    const obs = (log && log.observed) || {};
    const list = obs.list || [];
    const items = watchItems(cfg);
    return `<section class="card ccard">
      <div class="card-head"><h2>🌙 晚上</h2>${eveningDone(log, cfg) ? '<span class="tag tag-ok">✓ 記好了</span>' : ''}</div>
      ${meds.map((m) => medRow(m, log)).join('')}
      <div class="csub"><strong>🙂 情緒</strong>${scoreRow('mood', log && log.mood && log.mood.score)}
        <input class="cnote" data-f="moodNote" value="${v(log && log.mood, 'note')}" maxlength="200" placeholder="一句話（選填）"></div>
      <div class="csub"><strong>📚 學習</strong>${summaryHtml()}${scoreRow('learning', log && log.learning && log.learning.score)}
        <input class="cnote" data-f="learningNote" value="${v(log && log.learning, 'note')}" maxlength="200" placeholder="一句話（選填）"></div>
      ${items.length ? `<div class="csub"><strong>⚠️ 今天有沒有觀察到</strong>
        <div class="chips-row">${items.map((x) => `<button type="button" class="jchoice ${list.includes(x) ? 'on' : ''}" data-act="obs" data-v="${esc(x)}" aria-pressed="${list.includes(x)}">${esc(x)}</button>`).join('')}</div>
        <input class="cnote" data-f="obsNote" value="${v(obs, 'note')}" maxlength="200" placeholder="補充（選填）"></div>` : ''}
      <div class="csub"><label class="field"><span>🛏️ 上床時間</span><input type="time" data-f="sleepBed" value="${v(log && log.sleep, 'bed')}"></label>
        <p class="muted small">起床時間明天早上補。</p></div>
    </section>`;
  }

  // ---------- 兩週一覽 ----------
  function drawTable() {
    if (!logs) return;
    const by = new Map(logs.map((l) => [l.date, l]));
    const days = Array.from({ length: 14 }, (_, i) => addDays(today, -i));
    const meds = cfg.meds || [];
    const mark = (l, m) => { const st = l && l.meds && l.meds[m.id] && l.meds[m.id].status; return st === 'taken' ? '✓' : st === 'skipped' ? '✗' : '–'; };
    el.querySelector('#cTable').innerHTML = `<section class="card"><div class="card-head"><h2>📋 最近兩週</h2>
        <button class="btn btn-sm btn-ghost" data-act="export">📤 匯出／分享</button></div>
      <div class="ctable-wrap"><table class="ctable">
        <thead><tr><th>日期</th>${meds.map((m) => `<th title="${esc(m.name)}">${esc(m.name.slice(0, 3))}</th>`).join('')}<th>情緒</th><th>學習</th><th>睡眠</th><th>觀察</th></tr></thead>
        <tbody>${days.map((d) => {
          const l = by.get(d);
          const s = (l && l.sleep) || {};
          const mins = sleepMinutes(s.bed, s.wake);
          const obs = (l && l.observed && l.observed.list) || [];
          return `<tr class="${d === date ? 'on' : ''}" data-act="day" data-d="${d}">
            <td>${labelMD(d).replace(/（(.)）/, ' $1')}</td>${meds.map((m) => `<td class="c">${mark(l, m)}</td>`).join('')}
            <td class="c">${l && l.mood && l.mood.score ? SCORE_EMOJI[l.mood.score] + l.mood.score : ''}</td>
            <td class="c">${l && l.learning && l.learning.score ? l.learning.score : ''}</td>
            <td>${s.bed ? `${esc(s.bed)}–${esc(s.wake || '?')}` : ''}${mins != null ? `<br><span class="muted small">${(mins / 60).toFixed(1)} 小時</span>` : ''}${s.note ? ' 📝' : ''}</td>
            <td class="small">${obs.map(esc).join('、')}</td></tr>`;
        }).join('')}</tbody></table></div>
      <p class="muted small">✓ 有用藥　✗ 沒有　– 沒記錄。點一列可以看或修改那一天。</p></section>`;
  }

  // ---------- 儲存 ----------
  const save = (d, patch) => saveLog(kid, d, patch).catch((e) => showError(e, '儲存'));
  el.addEventListener('change', (e) => {
    const t = e.target, f = t.dataset && t.dataset.f;
    if (!f) return;
    const val = t.value.trim();
    const d = t.dataset.on === 'prev' ? prevDate : date;
    const map = {
      medAt: { meds: { [t.dataset.id]: { at: val } } },
      medNote: { meds: { [t.dataset.id]: { note: val } } },
      sleepBed: { sleep: { bed: val } }, sleepWake: { sleep: { wake: val } }, sleepNote: { sleep: { note: val } },
      moodNote: { mood: { note: val } }, learningNote: { learning: { note: val } }, obsNote: { observed: { note: val } }
    };
    if (map[f]) save(d, map[f]);
  });

  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const id = b.dataset.id;
    try {
      switch (b.dataset.act) {
        case 'day': if (b.dataset.d <= today) go(`/k/${kid}/care/${b.dataset.d}`); return;
        case 'medTaken': await save(date, { meds: { [id]: { status: 'taken', at: date === today ? nowHM() : '', note: '' } } }); break;
        case 'medSkipped': await save(date, { meds: { [id]: { status: 'skipped', at: '' } } }); break;
        case 'medClear': await save(date, { meds: { [id]: { status: '', at: '', note: '' } } }); break;
        case 'score': {
          const f = b.dataset.f, n = Number(b.dataset.v);
          const cur = log && log[f] && log[f].score;
          await save(date, { [f]: { score: cur === n ? 0 : n } });
          break;
        }
        case 'obs': {
          const list = new Set((log && log.observed && log.observed.list) || []);
          list.has(b.dataset.v) ? list.delete(b.dataset.v) : list.add(b.dataset.v);
          await save(date, { observed: { list: [...list] } });
          break;
        }
        case 'export': await exportCsv(); break;
      }
    } catch (err) { showError(err); }
  });

  // 匯出：文字摘要（傳 LINE 用，太長自動分段）、PDF（用列印產生）、Excel 檔（CSV）
  async function exportCsv() {
    const meds = cfg.meds || [];
    const def = (meds.find((m) => m.when === 'morning') || meds[0] || {}).id || '';
    const r = await modal({
      title: '📤 匯出／分享',
      html: `<div class="field-row"><label class="field"><span>從</span><input type="date" name="from" value="${addDays(today, -13)}"></label>
        <label class="field"><span>到</span><input type="date" name="to" value="${today}"></label></div>
        ${meds.length ? `<label class="field"><span>用哪個藥分「有用藥／沒用藥」</span><select class="select" name="groupMed">${meds.map((m) => `<option value="${esc(m.id)}" ${m.id === def ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></label>` : ''}
        <label class="switch-row"><span>附上每日紀錄</span><span class="switch"><input type="checkbox" name="daily"><span></span></span></label>
        <p class="muted small">內容：區間重點統計、有用藥和沒用藥時的特別紀錄（情緒或學習有寫文字、或 2 分以下）。<br>
          「文字」：直接傳到 LINE，太長會自動分成幾則。<br>「PDF」：排好版的報告，用列印存成 PDF，適合回診。<br>「Excel 檔」：所有欄位的表格，給試算表用。</p>`,
      buttons: [{ id: 'cancel', label: '取消' }, { id: 'csv', label: 'Excel 檔' }, { id: 'pdf', label: 'PDF' }, { id: 'text', label: '文字', kind: 'primary' }],
      validate: (id, d) => (id !== 'cancel' && !(d.from && d.to && d.from <= d.to) ? '請選擇正確的日期範圍' : null)
    });
    if (r.id === 'cancel') return;
    const all = await getLogsOnce(kid);
    if (r.id === 'csv') return saveFile(`${name}_照顧紀錄_${r.data.from}_${r.data.to}.csv`, careCsv(all, cfg, r.data.from, r.data.to));
    const data = careReportData(all, cfg, { name, from: r.data.from, to: r.data.to, groupMed: r.data.groupMed, daily: r.data.daily === 'on' });
    if (r.id === 'pdf') return showPdf(data, `${name}_照顧紀錄_${r.data.from}_${r.data.to}`);
    await showText(careReportParts(data));
  }

  /** 預覽文字摘要。太長時分成幾段，每段各自「複製」「分享」（分享會叫出手機的分享選單，LINE 收到的是文字訊息） */
  function showText(parts) {
    const many = parts.length > 1;
    return modal({
      title: '📝 文字摘要',
      html: `${many ? `<p class="muted small">內容比較長，分成 ${parts.length} 則（LINE 一則訊息最多約 5,000 字）。請依序傳送。</p>` : ''}
        ${parts.map((t, i) => `<div class="report-part">
          ${many ? `<strong>第 ${i + 1} 則</strong>` : ''}<textarea class="report-text ${many ? 'short' : ''}" readonly rows="${many ? 8 : 16}">${esc(t)}</textarea>
          <div class="btn-row"><span class="muted small grow">${t.length} 字</span>
            <button type="button" class="btn btn-ghost" data-r="copy" data-i="${i}">📋 複製${many ? `第 ${i + 1} 則` : ''}</button>
            ${navigator.share ? `<button type="button" class="btn btn-primary" data-r="share" data-i="${i}">📤 分享${many ? `第 ${i + 1} 則` : ''}</button>` : ''}</div></div>`).join('')}`,
      buttons: [{ id: 'cancel', label: '關閉' }],
      onOpen: (w) => {
        w.addEventListener('click', async (e) => {
          const b = e.target.closest('[data-r]');
          if (!b) return;
          const text = parts[Number(b.dataset.i)];
          if (b.dataset.r === 'copy') { toast((await copyText(text)) ? '已複製，可以貼到 LINE' : '無法複製', 'ok'); return; }
          // 在點按的當下呼叫分享（iPhone 要求分享必須直接由點按觸發）
          navigator.share({ text }).then(() => b.classList.add('done')).catch((err) => { if (err && err.name !== 'AbortError') toast('無法分享，請改用「複製」', 'error'); });
        });
      }
    });
  }

  /**
   * PDF：把排好版的報告放到頁面上，按「列印／存成 PDF」叫出列印畫面。
   * iPhone：列印畫面右上角的分享按鈕可以存成 PDF 或傳到 LINE；電腦：目的地選「另存為 PDF」。
   */
  function showPdf(data, title) {
    let root = document.getElementById('print-root');
    if (!root) { root = document.createElement('div'); root.id = 'print-root'; document.body.appendChild(root); }
    root.innerHTML = careReportHtml(data, { generated: todayStr() });
    const old = document.title;
    const done = () => { document.body.classList.remove('print-report'); document.title = old; window.removeEventListener('afterprint', done); };
    return modal({
      title: '📄 PDF 報告',
      html: `<div class="report-preview">${root.innerHTML}</div>
        <p class="muted small">按「列印／存成 PDF」後：<br>・iPhone：在列印畫面按右上角的分享按鈕，就能存成 PDF 或傳到 LINE。<br>・電腦：目的地選「另存為 PDF」。</p>
        <div class="btn-row"><button type="button" class="btn btn-primary" data-r="print">🖨️ 列印／存成 PDF</button></div>`,
      buttons: [{ id: 'cancel', label: '關閉' }],
      onOpen: (w) => {
        w.querySelector('[data-r=print]').addEventListener('click', () => {
          document.body.classList.add('print-report');
          document.title = title;          // 存成 PDF 時的預設檔名
          window.addEventListener('afterprint', done);
          window.print();   // print-report 只影響列印，不影響畫面；列印結束或關閉視窗時才移除
        });
      }
    }).then(done);
  }

  const unsubs = [
    watchLog(kid, date, (l) => { log = l; draw(); }, (e) => showError(e, '讀取紀錄')),
    watchLog(kid, prevDate, (l) => { prev = l; draw(); }, (e) => showError(e, '讀取紀錄')),
    watchLogs(kid, addDays(today, -13), today, (l) => { logs = l; drawTable(); }, (e) => showError(e, '讀取紀錄'))
  ];
  daySummary(kid, date).then((s) => { sum = s; draw(); }).catch(() => { sum = { items: [], sess: null, note: null }; draw(); });
  return () => unsubs.forEach((u) => u());
}
