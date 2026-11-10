import { state, isMom, memberName } from '../state.js';
import { esc, toast, showError } from '../ui.js';
import { go } from '../router.js';
import { todayStr, addDays, labelMD } from '../utils/date.js';
import { speak, canSpeak } from '../utils/speak.js';
import {
  WORD_DEFAULTS, watchWordLists, loadKidLists, watchProgress, saveProgress, watchSession, watchSessions,
  startSession, recordWrong, finishSession, planToday, nextProgress, wordKey, sameSpelling
} from '../store/words.js';
import { markWordsDone } from '../store/checklist.js';

const shuffle = (a) => { const r = [...a]; for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; } return r; };

/** 每日單字：小孩 → 學習與測驗；媽媽 → 學習狀況 */
export function mountWords(el, { kid }) {
  const today = todayStr();
  const mom = isMom();
  const cfg = { ...WORD_DEFAULTS, ...(state.settings.words || {}) };
  let lists = null;          // 這個小孩的字庫（含單字）
  let progress = null;
  let session;               // undefined=讀取中, null=今天還沒開始
  let sessions = [];
  let run = null;            // 進行中的練習（只在這個畫面裡）
  let loadSeq = 0;

  const ready = () => lists && progress && session !== undefined;
  const dictOf = () => { const m = new Map(); (lists || []).forEach((l) => l.words.forEach((x) => { const k = wordKey(x.w); if (!m.has(k)) m.set(k, x); })); return m; };

  function plan() {
    const dict = dictOf();
    if (session && !session.finished) {
      // 今天已經開始過：沿用同一批單字
      return { newWords: session.newWords.filter((k) => dict.has(k)), reviewWords: session.reviewWords.filter((k) => dict.has(k)), dict };
    }
    return planToday(lists, progress, today, cfg.perDay);
  }

  // ---------- 畫面 ----------
  function draw() {
    if (run) return drawRun();
    if (!ready()) { el.innerHTML = '<p class="empty">載入中…</p>'; return; }
    const learned = Object.keys(progress).length;
    const head = `<div class="page-head"><h1>📖 ${esc(memberName(kid))}的每日單字</h1>
      ${mom ? '<button class="btn btn-ghost" data-act="manage">管理字庫</button>' : ''}</div>`;
    if (!lists.length) {
      el.innerHTML = `${head}<section class="card"><p class="empty">${mom ? '還沒有給這個孩子的字庫。到「設定 → 每日單字」新增字庫並貼上單字。' : '媽媽還沒有準備單字喔 📚'}</p></section>`;
      return;
    }
    el.innerHTML = head + (mom ? momHtml(learned) : kidHtml(learned));
  }

  function kidHtml(learned) {
    const p = plan();
    const streak = streakDays();
    if (session && session.finished) {
      const words = [...session.newWords, ...session.reviewWords].map((k) => p.dict.get(k)).filter(Boolean);
      return `
        <section class="card hero">
          <div style="font-size:3rem">${session.perfect ? '🎯' : '🎉'}</div>
          <div class="hero-hi">今天的單字完成了！</div>
          <div class="hero-sub">${session.perfect ? `一次全對！媽媽核可後多 +${cfg.perfectBonus} 點` : `有 ${session.wrong.length} 個字要再加油，之後會再複習`}</div>
          <p class="muted small">已經學過 ${learned} 個字${streak > 1 ? `・連續 ${streak} 天 🔥` : ''}</p>
        </section>
        <section class="card"><h2>今天的單字</h2>${wordRows(words, session.wrong)}</section>`;
    }
    const total = p.newWords.length + p.reviewWords.length;
    return `
      <section class="card hero">
        <div class="hero-hi">${session ? '繼續今天的單字' : '今天的單字'}</div>
        <div class="word-plan"><span><strong>${p.newWords.length}</strong> 個新單字</span><span><strong>${p.reviewWords.length}</strong> 個複習</span></div>
        ${total ? `<button class="btn btn-primary btn-lg" data-act="start">${session ? '繼續 ▶' : '開始 ▶'}</button>` : '<p class="muted">今天沒有要學的字</p>'}
        <p class="muted small">完成可得 ${cfg.points} 點；測驗一次全對再加 ${cfg.perfectBonus} 點<br>已經學過 ${learned} 個字${streak > 1 ? `・連續 ${streak} 天 🔥` : ''}</p>
      </section>`;
  }

  function wordRows(words, wrong = []) {
    return `<ul class="word-list">${words.map((x) => `
      <li><button class="icon-btn speak" data-say="${esc(x.w)}" aria-label="聽發音">🔊</button>
        <span class="grow"><strong>${esc(x.w)}</strong> <span class="muted">${esc(x.zh)}</span>${x.ex ? `<br><span class="muted small">${esc(x.ex)}</span>` : ''}</span>
        ${wrong.includes(wordKey(x.w)) ? '<span class="tag tag-bad">再加油</span>' : ''}</li>`).join('')}</ul>`;
  }

  function streakDays() {
    const done = new Set(sessions.filter((s) => s.finished).map((s) => s.date));
    let d = done.has(today) ? today : addDays(today, -1);
    let n = 0;
    while (done.has(d)) { n++; d = addDays(d, -1); }
    return n;
  }

  function momHtml(learned) {
    const dict = dictOf();
    const due = Object.entries(progress).filter(([k, p]) => dict.has(k) && p.d && p.d <= today).length;
    const hard = Object.entries(progress).filter(([k, p]) => dict.has(k) && p.x > 0).sort((a, b) => b[1].x - a[1].x).slice(0, 10);
    const todayState = !session ? '還沒開始' : !session.finished ? '進行中' : session.perfect ? '完成，一次全對 🎯' : `完成，答錯 ${session.wrong.length} 個字`;
    return `
      <section class="card">
        <div class="stat-row">
          <div class="stat"><span class="stat-num">${learned}</span><span class="muted small">已學過</span></div>
          <div class="stat"><span class="stat-num">${due}</span><span class="muted small">今天到期複習</span></div>
          <div class="stat"><span class="stat-num">${streakDays()}</span><span class="muted small">連續天數</span></div>
        </div>
        <p><strong>今天：</strong>${todayState}</p>
        ${session && session.wrong.length ? wordRows(session.wrong.map((k) => dict.get(k)).filter(Boolean)) : ''}
      </section>
      <section class="card"><h2>字庫進度</h2>
        ${lists.map((l) => {
          const n = l.words.filter((x) => progress[wordKey(x.w)]).length;
          return `<div class="list-prog"><div><strong>${esc(l.name)}</strong> <span class="tag">${l.kind === 'cram' ? `補習班${l.testDate ? `・${labelMD(l.testDate)} 考` : ''}` : '字庫'}</span>
            <span class="muted small">${n}／${l.words.length}</span></div>
            <div class="goal-bar"><div class="goal-fill" style="width:${l.words.length ? (n / l.words.length) * 100 : 0}%"></div></div></div>`;
        }).join('')}
      </section>
      <section class="card"><h2>最常答錯的字</h2>
        ${hard.length ? `<ul class="word-list">${hard.map(([k, p]) => { const x = dict.get(k); return `<li><button class="icon-btn speak" data-say="${esc(x.w)}" aria-label="聽發音">🔊</button><span class="grow"><strong>${esc(x.w)}</strong> <span class="muted">${esc(x.zh)}</span></span><span class="tag tag-bad">錯 ${p.x} 次</span></li>`; }).join('')}</ul>` : '<p class="empty">目前沒有</p>'}
      </section>
      <section class="card"><h2>最近的練習</h2>
        ${sessions.length ? `<ul class="rows">${sessions.slice(0, 10).map((s) => `<li class="row"><span class="grow">${labelMD(s.date)}<br><span class="muted small">新字 ${s.newWords.length}・複習 ${s.reviewWords.length}</span></span>
          <span class="tag ${!s.finished ? 'tag-wait' : s.perfect ? 'tag-ok' : ''}">${!s.finished ? '未完成' : s.perfect ? '一次全對' : `錯 ${s.wrong.length} 個`}</span></li>`).join('')}</ul>` : '<p class="empty">還沒有紀錄</p>'}
      </section>`;
  }

  // ---------- 練習流程 ----------
  async function start() {
    const p = plan();
    if (!session) await startSession(kid, today, p.newWords, p.reviewWords);
    const mc = p.newWords.filter((k) => p.dict.get(k).zh && p.dict.size >= 3).map((k) => ({ k, type: 'mc' }));
    const spell = shuffle([...p.newWords, ...p.reviewWords]).map((k) => ({ k, type: 'spell' }));
    run = {
      dict: p.dict, newWords: p.newWords, reviewWords: p.reviewWords,
      study: [...p.newWords], queue: [...shuffle(mc), ...spell], total: mc.length + spell.length, done: 0,
      wrong: new Set((session && session.wrong) || []), feedback: null, options: null
    };
    draw();
  }

  function drawRun() {
    const r = run;
    const bar = (n, t) => `<div class="progress"><div class="progress-bar" style="width:${t ? (n / t) * 100 : 0}%"></div><span class="progress-text">${n} / ${t}</span></div>`;
    const quit = '<button class="btn btn-sm btn-ghost" data-act="quit">先休息</button>';
    if (r.study.length) {
      const x = r.dict.get(r.study[0]);
      const i = r.newWords.length - r.study.length;
      el.innerHTML = `<div class="page-head"><h1>📖 新單字</h1>${quit}</div>${bar(i, r.newWords.length)}
        <section class="card word-card">
          <button class="speak-big" data-say="${esc(x.w)}" aria-label="聽發音">🔊</button>
          <div class="word-big">${esc(x.w)}</div>
          <div class="word-zh">${esc(x.zh || '')}</div>
          ${x.ex ? `<button class="word-ex" data-say="${esc(x.ex)}">🔊 ${esc(x.ex)}</button>` : ''}
          <div class="btn-row center"><button class="btn btn-ghost" data-say="${esc(x.w)}" data-slow="1">🐢 慢慢唸</button>
            <button class="btn btn-primary btn-lg" data-act="studyNext">${r.study.length > 1 ? '下一個 ▶' : '開始測驗 ▶'}</button></div>
        </section>`;
      speak(x.w);
      return;
    }
    const q = r.queue[0];
    const x = r.dict.get(q.k);
    const fb = r.feedback;
    let body;
    if (q.type === 'mc') {
      if (!r.options) {
        const others = shuffle([...r.dict.values()].filter((o) => o.zh && o.zh !== x.zh)).slice(0, 3);
        r.options = shuffle([x, ...others]).map((o) => o.zh);
      }
      body = `<p class="q-title">這個字是什麼意思？</p>
        <button class="speak-big" data-say="${esc(x.w)}" aria-label="聽發音">🔊</button>
        <div class="word-big">${esc(x.w)}</div>
        <div class="mc">${r.options.map((o) => `<button class="mc-opt ${fb ? (o === x.zh ? 'right' : o === fb.picked ? 'wrong' : '') : ''}" data-act="pick" data-v="${esc(o)}" ${fb ? 'disabled' : ''}>${esc(o)}</button>`).join('')}</div>`;
    } else {
      body = `<p class="q-title">拼出這個字</p>
        <button class="speak-big" data-say="${esc(x.w)}" aria-label="聽發音">🔊</button>
        <div class="word-zh">${esc(x.zh || '（聽發音拼字）')}</div>
        ${fb ? `<div class="spell-answer ${fb.ok ? 'right' : 'wrong'}">${fb.ok ? '' : `<span class="muted small">你寫的：${esc(fb.picked || '（沒有寫）')}</span><br>`}<strong>${esc(x.w)}</strong></div>` : `
        <form id="spell" autocomplete="off"><input class="spell-input" name="a" type="text" inputmode="text" autocapitalize="none" autocorrect="off" spellcheck="false" autocomplete="off" aria-label="拼字" placeholder="在這裡拼字">
          <div class="btn-row center"><button class="btn btn-ghost" type="button" data-say="${esc(x.w)}" data-slow="1">🐢 慢慢唸</button><button class="btn btn-primary btn-lg" type="submit">送出</button></div></form>`}`;
    }
    el.innerHTML = `<div class="page-head"><h1>📝 測驗</h1>${quit}</div>${bar(r.done, r.total)}
      <section class="card word-card">${body}
        ${fb ? `<p class="fb ${fb.ok ? 'ok' : 'bad'}">${fb.ok ? '答對了！👍' : '再記一次，等一下會再考喔'}</p><button class="btn btn-primary btn-lg" data-act="qNext">繼續 ▶</button>` : ''}
      </section>`;
    if (!fb) { speak(x.w); const inp = el.querySelector('.spell-input'); inp && inp.focus({ preventScroll: true }); }
  }

  function answer(ok, picked) {
    const r = run;
    const q = r.queue[0];
    r.feedback = { ok, picked };
    if (!ok && !r.wrong.has(q.k)) {
      r.wrong.add(q.k);
      recordWrong(kid, today, q.k).catch((e) => showError(e, '記錄'));
    }
    draw();
    if (!ok) speak(r.dict.get(q.k).w, true);
  }

  async function nextQuestion() {
    const r = run;
    const q = r.queue.shift();
    if (r.feedback.ok) r.done++; else r.queue.push(q);
    r.feedback = null; r.options = null;
    if (r.queue.length) return draw();
    // 全部完成
    const firstTryOk = new Set([...r.newWords, ...r.reviewWords].filter((k) => !r.wrong.has(k)));
    const sess = { newWords: r.newWords, reviewWords: r.reviewWords };
    const perfect = r.wrong.size === 0;
    run = null;
    el.innerHTML = '<p class="empty">儲存中…</p>';
    try {
      await saveProgress(kid, nextProgress(sess, progress, firstTryOk, today));
      await finishSession(kid, today, perfect);
      await markWordsDone(kid, today, cfg.points);
      toast(perfect ? '一次全對！太厲害了 🎯' : '完成了！👏', 'ok');
    } catch (e) { showError(e, '儲存'); }
    draw();
  }

  el.addEventListener('submit', (e) => {
    if (e.target.id !== 'spell') return;
    e.preventDefault();
    const a = new FormData(e.target).get('a');
    answer(sameSpelling(a, run.dict.get(run.queue[0].k).w), String(a).trim());
  });
  el.addEventListener('click', (e) => {
    const s = e.target.closest('[data-say]');
    if (s) { if (!canSpeak()) toast('這台裝置不支援發音'); speak(s.dataset.say, !!s.dataset.slow); return; }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    switch (b.dataset.act) {
      case 'manage': go('/settings'); break;
      case 'start': b.disabled = true; start().catch((err) => { showError(err); b.disabled = false; }); break;
      case 'studyNext': run.study.shift(); draw(); break;
      case 'pick': answer(b.dataset.v === run.dict.get(run.queue[0].k).zh, b.dataset.v); break;
      case 'qNext': nextQuestion(); break;
      case 'quit': run = null; draw(); break;
    }
  });

  const unsubs = [
    watchWordLists((all) => {
      const seq = ++loadSeq;
      loadKidLists(all, kid).then((l) => { if (seq === loadSeq) { lists = l; if (!run) draw(); } }).catch((e) => showError(e, '讀取字庫'));
    }, (e) => showError(e, '讀取字庫')),
    watchProgress(kid, (p) => { progress = p; if (!run) draw(); }, (e) => showError(e, '讀取進度')),
    watchSession(kid, today, (s) => { session = s; if (!run) draw(); }, (e) => showError(e, '讀取練習')),
    watchSessions(kid, (s) => { sessions = s; if (!run) draw(); }, (e) => showError(e, '讀取紀錄'))
  ];
  draw();
  return () => { unsubs.forEach((u) => u()); if (canSpeak()) speechSynthesis.cancel(); };
}
