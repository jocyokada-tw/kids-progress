import { state, isMom, memberName } from '../state.js';
import { esc, toast, showError, modal, confirmDialog } from '../ui.js';
import { go } from '../router.js';
import { todayStr, addDays, labelMD } from '../utils/date.js';
import { speak, canPlaySound, stopSpeaking, englishVoices, currentVoice, setVoice, voiceQuality, voiceMode, setVoiceMode, CLOUD } from '../utils/speak.js';
import { unlockAudio, prefetch } from '../utils/cloud-voice.js';
import {
  WORD_DEFAULTS, watchWordLists, loadKidLists, watchProgress, saveProgress, watchSession, watchSessions,
  startSession, recordWrong, finishSession, planToday, nextProgress, wordKey, sameSpelling, resetSession, INTERVALS, buildDict,
  makeCloze, clozeAccepts, buildReviewQuestions, scrambleLetters, letterHint
} from '../store/words.js';
import { markWordsDone } from '../store/checklist.js';

/** 詞性小標籤（只顯示，不考） */
const posTag = (x) => (x && x.pos ? `<span class="pos">${esc(x.pos)}</span> ` : '');
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
  const dictOf = () => buildDict(lists || []);

  function plan() {
    const dict = dictOf();
    if (session && !session.finished) {
      // 今天已經開始過：沿用同一批單字
      return { newWords: session.newWords.filter((k) => dict.has(k)), reviewWords: session.reviewWords.filter((k) => dict.has(k)), dict };
    }
    return planToday(lists, progress, today, cfg.perDay, { random: cfg.order !== 'list', seed: `${kid}|${today}` });
  }

  // ---------- 畫面 ----------
  function draw() {
    if (run) return drawRun();
    if (!ready()) { el.innerHTML = '<p class="empty">載入中…</p>'; return; }
    const learned = Object.keys(progress).length;
    const head = `<div class="page-head"><h1>📖 ${esc(memberName(kid))}的每日單字</h1>
      <div class="btn-row"><button class="btn btn-ghost" data-act="voice">🔈 聲音</button>${mom ? '<button class="btn btn-ghost" data-act="manage">管理字庫</button>' : ''}</div></div>`;
    if (!lists.length) {
      el.innerHTML = `${head}<section class="card"><p class="empty">${mom ? '還沒有給這個孩子的字庫。到「設定 → 每日單字」新增字庫並貼上單字。' : '媽媽還沒有準備單字喔 📚'}</p></section>`;
      return;
    }
    el.innerHTML = head + (mom ? momHtml(learned) : kidHtml(learned) + listsProgressHtml()) + learnedHtml();
    // 畫面上列出的單字先把發音準備好，按 🔊 時才能立刻播放自然語音
    prefetch([...el.querySelectorAll('.word-list [data-say]')].map((b) => b.dataset.say));
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
        <span class="grow"><strong>${esc(x.w)}</strong> ${posTag(x)}<span class="muted">${esc(x.zh)}</span>${x.ex ? `<br><span class="muted small">${esc(x.ex)}</span>` : ''}</span>
        ${wrong.includes(wordKey(x.w)) ? '<span class="tag tag-bad">再加油</span>' : ''}</li>`).join('')}</ul>`;
  }

  // 每份字庫的進度：學完會顯示 🎉（孩子和媽媽都看得到）
  function listsProgressHtml() {
    if (!lists || !lists.length) return '';
    const rows = lists.map((l) => {
      const n = l.words.filter((x) => progress[wordKey(x.w)]).length;
      return { l, n, total: l.words.length, done: l.words.length > 0 && n >= l.words.length };
    }).sort((a, b) => Number(a.done) - Number(b.done));
    return `<section class="card"><h2>字庫進度</h2>
      ${rows.map(({ l, n, total, done }) => `<div class="list-prog ${done ? 'list-done' : ''}">
        <div><strong>${esc(l.name)}</strong> <span class="tag">${l.kind === 'cram' ? `補習班${l.testDate ? `・${labelMD(l.testDate)} 考` : ''}` : '字庫'}</span>
          ${done ? '<span class="tag tag-ok">🎉 學完了！</span>' : `<span class="muted small">${n}／${total}</span>`}</div>
        <div class="goal-bar"><div class="goal-fill" style="width:${total ? Math.min(100, (n / total) * 100) : 0}%"></div></div></div>`).join('')}
    </section>`;
  }

  // 學過的單字：隨時可以回來聽發音、看下次什麼時候複習
  let showAllLearned = false;
  function learnedHtml() {
    const dict = dictOf();
    const all = Object.entries(progress).filter(([k]) => dict.has(k))
      .sort((a, b) => (b[1].t || '').localeCompare(a[1].t || '') || a[0].localeCompare(b[0]));
    if (!all.length) return '';
    const list = showAllLearned ? all : all.slice(0, 20);
    const when = (p) => (!p.d ? '' : p.d <= today ? '今天複習' : `${labelMD(p.d)} 複習`);
    return `<section class="card"><h2>📚 學過的單字 <span class="muted small">${all.length} 個</span></h2>
      <ul class="word-list">${list.map(([k, p]) => { const x = dict.get(k); return `
        <li><button class="icon-btn speak" data-say="${esc(x.w)}" aria-label="聽發音">🔊</button>
          <span class="grow"><strong>${esc(x.w)}</strong> ${posTag(x)}<span class="muted">${esc(x.zh)}</span>${x.ex ? `<br><span class="muted small">${esc(x.ex)}</span>` : ''}</span>
          <span class="tag ${p.d && p.d <= today ? 'tag-wait' : ''}" title="熟練度 ${p.b || 0}／${INTERVALS.length - 1}">${when(p)}</span></li>`; }).join('')}</ul>
      ${all.length > 20 ? `<button class="btn btn-ghost btn-block" data-act="toggleLearned">${showAllLearned ? '收起' : `顯示全部 ${all.length} 個`}</button>` : ''}
    </section>`;
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
        <p><strong>今天：</strong>${todayState}${session ? ' <button class="btn btn-sm btn-ghost" data-act="reset">重設今天的練習</button>' : ''}</p>
        ${session && session.wrong.length ? wordRows(session.wrong.map((k) => dict.get(k)).filter(Boolean)) : ''}
      </section>
      ${listsProgressHtml()}
      <section class="card"><h2>最常答錯的字</h2>
        ${hard.length ? `<ul class="word-list">${hard.map(([k, p]) => { const x = dict.get(k); return `<li><button class="icon-btn speak" data-say="${esc(x.w)}" aria-label="聽發音">🔊</button><span class="grow"><strong>${esc(x.w)}</strong> ${posTag(x)}<span class="muted">${esc(x.zh)}</span></span><span class="tag tag-bad">錯 ${p.x} 次</span></li>`; }).join('')}</ul>` : '<p class="empty">目前沒有</p>'}
      </section>
      <section class="card"><h2>最近的練習</h2>
        ${sessions.length ? `<ul class="rows">${sessions.slice(0, 10).map((s) => `<li class="row"><span class="grow">${labelMD(s.date)}<br><span class="muted small">新字 ${s.newWords.length}・複習 ${s.reviewWords.length}</span></span>
          <span class="tag ${!s.finished ? 'tag-wait' : s.perfect ? 'tag-ok' : ''}">${!s.finished ? '未完成' : s.perfect ? '一次全對' : `錯 ${s.wrong.length} 個`}</span></li>`).join('')}</ul>` : '<p class="empty">還沒有紀錄</p>'}
      </section>`;
  }

  // ---------- 選擇發音的聲音（每台裝置各自設定） ----------
  const Q_LABEL = { 3: '高品質', 2: '優化', 1: '一般' };
  async function chooseVoice() {
    const voices = englishVoices();
    const cur = currentVoice();
    const mode = voiceMode();
    const r = await modal({
      title: '🔈 發音的聲音',
      html: `
        <div class="voice-list">
          <label class="voice-row"><input type="radio" name="voice" value="${CLOUD}" ${mode === CLOUD ? 'checked' : ''}>
            <span class="grow"><strong>☁️ 自然語音</strong><br><span class="muted small">最像真人。第一次聽某個字需要網路，聽過的字離線也能播。</span></span>
            <span class="tag tag-ok">建議</span>
            <button type="button" class="icon-btn speak" data-try="${CLOUD}" aria-label="試聽">🔊</button></label>
          ${voices.map((v) => `
          <label class="voice-row"><input type="radio" name="voice" value="${esc(v.voiceURI)}" ${mode !== CLOUD && cur && v.voiceURI === cur.voiceURI ? 'checked' : ''}>
            <span class="grow">📱 ${esc(v.name.replace(/\s*\(.*\)$/, ''))} <span class="muted small">${esc(v.lang)}</span></span>
            <span class="tag ${voiceQuality(v) > 1 ? 'tag-ok' : ''}">${Q_LABEL[voiceQuality(v)]}</span>
            <button type="button" class="icon-btn speak" data-try="${esc(v.voiceURI)}" aria-label="試聽">🔊</button></label>`).join('')}
        </div>
        <p class="muted small">按 🔊 試聽。這個設定只影響這台裝置。📱 是這台裝置內建的聲音，不需要網路，但比較像機器人。</p>
        <p class="muted small">如果「自然語音」試聽起來和內建聲音一樣，代表雲端語音還沒設定好或目前沒有網路，App 會自動改用內建聲音。</p>`,
      buttons: [{ id: 'cancel', label: '取消' }, { id: 'ok', label: '使用這個聲音', kind: 'primary' }],
      onOpen: (w) => w.addEventListener('click', (e) => {
        const t = e.target.closest('[data-try]');
        if (t) { e.preventDefault(); unlockAudio(); speak('Hello! This is how I sound.', false, t.dataset.try); }
      })
    });
    if (r.id !== 'ok' || !r.data.voice) return;
    if (r.data.voice === CLOUD) setVoiceMode(CLOUD);
    else { setVoiceMode('device'); setVoice(r.data.voice); }
    speak('Okay!');
    toast('已更換聲音', 'ok');
  }

  // ---------- 練習流程 ----------
  async function start() {
    const p = plan();
    if (!session) await startSession(kid, today, p.newWords, p.reviewWords);
    const mc = p.newWords.filter((k) => p.dict.get(k).zh && p.dict.size >= 3).map((k) => ({ k, type: 'mc' }));
    // 快考試的補習班單字一律「聽音拼字」：考試是老師唸、孩子拼
    const dictation = new Set(lists.filter((l) => l.kind === 'cram' && l.testDate && l.testDate >= today).flatMap((l) => l.words.map((x) => wordKey(x.w))));
    const spellNew = shuffle(p.newWords).map((k) => ({ k, type: dictation.has(k) ? 'listen' : 'spell' }));
    const review = buildReviewQuestions(p.reviewWords, p.dict, progress, { enabled: cfg.types, dictation });
    const queue = [...shuffle(mc), ...spellNew, ...review];
    run = {
      dict: p.dict, newWords: p.newWords, reviewWords: p.reviewWords,
      study: [...p.newWords], queue, total: queue.reduce((n, q) => n + (q.ks ? q.ks.length : 1), 0), done: 0,
      wrong: new Set((session && session.wrong) || []), hinted: new Set(), feedback: null, st: null
    };
    // 先把今天會用到的發音準備好（單字＋新字與填空題的例句），播放時就不用等
    const all = [...p.newWords, ...p.reviewWords].map((k) => p.dict.get(k));
    const clozeKs = review.filter((q) => q.type === 'cloze' || q.type === 'clozeMc').map((q) => q.k);
    prefetch([...all.map((x) => x.w), ...[...p.newWords, ...clozeKs].map((k) => p.dict.get(k).ex)]);
    draw();
  }

  const TITLES = {
    mc: '這個字是什麼意思？', spell: '拼出這個字', listen: '聽發音，拼出這個字', cloze: '填空：看句子和中文，拼出缺的字',
    clozeMc: '填空：選出句子裡缺的字', scramble: '把字母排回正確的順序', match: '配對：點一個英文，再點它的中文'
  };
  const AUTO_SPEAK = new Set(['mc', 'spell', 'listen', 'scramble']);
  const spellForm = (x) => `
    <form id="spell" autocomplete="off"><input class="spell-input" name="a" type="text" inputmode="text" autocapitalize="none" autocorrect="off" spellcheck="false" autocomplete="off" aria-label="拼字" placeholder="在這裡拼字">
      <div class="btn-row center">${x ? `<button class="btn btn-ghost" type="button" data-say="${esc(x.w)}" data-slow="1">🐢 慢慢唸</button>` : ''}<button class="btn btn-primary btn-lg" type="submit">送出</button></div></form>`;
  const answerBox = (x, fb) => `<div class="spell-answer ${fb.ok ? 'right' : 'wrong'}">${fb.ok || fb.picked == null ? '' : `<span class="muted small">你的答案：${esc(fb.picked || '（沒有寫）')}</span><br>`}<strong>${esc(x.w)}</strong></div>`;
  /** 提示：點了才看到（看過提示，這個字的複習間隔不會拉長）。kind: 'zh' 顯示中文；'letters' 顯示第一個字母與字數 */
  const hintBox = (x, shown, kind = 'zh') => (!shown
    ? '<button class="btn btn-ghost" type="button" data-act="hint">💡 看提示</button>'
    : kind === 'letters' ? `<div class="hint-box letters">${esc(letterHint(x.w))}</div>`
      : `<div class="hint-box">${posTag(x)}<span class="word-zh">${esc(x.zh || '（沒有中文）')}</span></div>`);
  const clozeSentence = (cz, x, fb) => (fb
    ? `<button class="cloze" data-say="${esc(x.ex)}">🔊 ${esc(cz.pre)}<mark>${esc(cz.shown)}</mark>${esc(cz.post)}</button>`
    : `<p class="cloze">${esc(cz.pre)}<span class="blank"></span>${esc(cz.suffix)}${esc(cz.post)}</p>`);

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
          ${posTag(x)}<div class="word-zh">${esc(x.zh || '')}</div>
          ${x.ex ? `<button class="word-ex" data-say="${esc(x.ex)}">🔊 ${esc(x.ex)}</button>` : ''}
          <div class="btn-row center"><button class="btn btn-ghost" data-say="${esc(x.w)}" data-slow="1">🐢 慢慢唸</button>
            <button class="btn btn-primary btn-lg" data-act="studyNext">${r.study.length > 1 ? '下一個 ▶' : '開始測驗 ▶'}</button></div>
        </section>`;
      speak(x.w);
      return;
    }
    const q = r.queue[0];
    const fb = r.feedback;
    const fresh = !r.st;
    if (fresh) r.st = initState(q);
    const st = r.st;
    const x = q.k ? r.dict.get(q.k) : null;
    const speakBtn = x ? `<button class="speak-big" data-say="${esc(x.w)}" aria-label="聽發音">🔊</button>` : '';
    let body = '';
    switch (q.type) {
      case 'mc':
        body = `${speakBtn}<div class="word-big">${esc(x.w)}</div>
          <div class="mc">${st.options.map((o) => `<button class="mc-opt ${fb ? (o === x.zh ? 'right' : o === fb.picked ? 'wrong' : '') : ''}" data-act="pick" data-v="${esc(o)}" ${fb ? 'disabled' : ''}>${esc(o)}</button>`).join('')}</div>`;
        break;
      case 'spell':
        body = `${speakBtn}${posTag(x)}<div class="word-zh">${esc(x.zh || '（聽發音拼字）')}</div>${fb ? answerBox(x, fb) : spellForm(x)}`;
        break;
      case 'listen':
        body = `${speakBtn}${fb ? `${posTag(x)}<div class="word-zh">${esc(x.zh)}</div>${answerBox(x, fb)}` : `${hintBox(x, st.hint)}${spellForm(x)}`}`;
        break;
      case 'cloze':
        // 句子常常不只一個字能填，所以中文直接顯示；提示是第一個字母和字數
        body = `${clozeSentence(st.cz, x, fb)}${posTag(x)}<div class="word-zh">${esc(x.zh || '')}</div>${fb ? answerBox(x, fb) : `${x.zh ? hintBox(x, st.hint, 'letters') : ''}${spellForm(null)}`}`;
        break;
      case 'clozeMc':
        body = `${clozeSentence(st.cz, x, fb)}${fb ? `${posTag(x)}<div class="word-zh">${esc(x.zh)}</div>` : hintBox(x, st.hint)}
          <div class="mc">${st.options.map((o) => `<button class="mc-opt ${fb ? (o === x.w ? 'right' : o === fb.picked ? 'wrong' : '') : ''}" data-act="pick" data-v="${esc(o)}" ${fb ? 'disabled' : ''}>${esc(o)}</button>`).join('')}</div>`;
        break;
      case 'scramble': {
        const built = st.picked.map((i) => st.tiles[i]).join('');
        body = `${speakBtn}${posTag(x)}<div class="word-zh">${esc(x.zh)}</div>
          ${fb ? answerBox(x, fb) : `
          <div class="tiles answer" aria-label="你排的字">${st.picked.map((i, n) => `<button class="tile" data-act="untile" data-n="${n}">${esc(st.tiles[i])}</button>`).join('') || '<span class="muted small">點下面的字母</span>'}</div>
          <div class="tiles pool">${st.tiles.map((ch, i) => `<button class="tile" data-act="tile" data-i="${i}" ${st.picked.includes(i) ? 'disabled' : ''}>${esc(ch)}</button>`).join('')}</div>
          <div class="btn-row center"><button class="btn btn-ghost" data-act="clearTiles" ${built ? '' : 'disabled'}>清除</button>
            <button class="btn btn-primary btn-lg" data-act="submitTiles" ${st.picked.length === st.tiles.length ? '' : 'disabled'}>送出</button></div>`}`;
        break;
      }
      case 'match':
        body = `<div class="match">
          <div class="match-col">${st.left.map((k) => `<button class="match-item ${st.done.has(k) ? 'done' : ''} ${st.sel === k ? 'sel' : ''} ${st.bad && st.bad[0] === k ? 'bad' : ''}" data-act="matchL" data-k="${esc(k)}" ${st.done.has(k) ? 'disabled' : ''}>${esc(r.dict.get(k).w)}</button>`).join('')}</div>
          <div class="match-col">${st.right.map((k) => `<button class="match-item zh ${st.done.has(k) ? 'done' : ''} ${st.bad && st.bad[1] === k ? 'bad' : ''}" data-act="matchR" data-k="${esc(k)}" ${st.done.has(k) ? 'disabled' : ''}>${esc(r.dict.get(k).zh)}</button>`).join('')}</div>
        </div>`;
        break;
    }
    el.innerHTML = `<div class="page-head"><h1>📝 測驗</h1>${quit}</div>${bar(r.done, r.total)}
      <section class="card word-card"><p class="q-title">${TITLES[q.type]}</p>${body}
        ${fb ? `<p class="fb ${fb.ok ? 'ok' : 'bad'}">${fb.ok ? '答對了！👍' : '再記一次，等一下會再考喔'}</p><button class="btn btn-primary btn-lg" data-act="qNext">繼續 ▶</button>` : ''}
      </section>`;
    if (!fb && fresh) {
      if (AUTO_SPEAK.has(q.type)) speak(x.w);
      const inp = el.querySelector('.spell-input');
      inp && inp.focus({ preventScroll: true });
    }
  }

  /** 每一題開始時準備它需要的東西（選項、挖空的句子、打亂的字母…） */
  function initState(q) {
    const r = run;
    const x = q.k ? r.dict.get(q.k) : null;
    const st = { hint: false };
    if (q.type === 'mc') {
      const others = shuffle([...r.dict.values()].filter((o) => o.zh && o.zh !== x.zh)).slice(0, 3);
      st.options = shuffle([x, ...others]).map((o) => o.zh);
    }
    if (q.type === 'cloze' || q.type === 'clozeMc') st.cz = makeCloze(x.w, x.ex);
    if (q.type === 'clozeMc') {
      // 干擾選項優先挑詞性相同的字，比較不會一眼看出來
      const pool = [...r.dict.values()].filter((o) => wordKey(o.w) !== q.k && !/\.\.\.|…/.test(o.w));
      const same = shuffle(pool.filter((o) => x.pos && o.pos === x.pos));
      const others = [...same, ...shuffle(pool.filter((o) => !same.includes(o)))].slice(0, 3);
      st.options = shuffle([x, ...others]).map((o) => o.w);
    }
    if (q.type === 'scramble') { st.tiles = scrambleLetters(x.w); st.picked = []; }
    if (q.type === 'match') { st.left = shuffle(q.ks); st.right = shuffle(q.ks); st.done = new Set(); st.sel = null; st.bad = null; }
    return st;
  }

  function markWrong(k) {
    if (run.wrong.has(k)) return;
    run.wrong.add(k);
    recordWrong(kid, today, k).catch((e) => showError(e, '記錄'));
  }

  function answer(ok, picked) {
    const r = run;
    const q = r.queue[0];
    r.feedback = { ok, picked };
    if (!ok) markWrong(q.k);
    draw();
    if (!ok) speak(r.dict.get(q.k).w, true);
  }

  /** 配對題：點英文再點中文 */
  function matchTap(side, k) {
    const st = run.st;
    if (side === 'L') { st.sel = k; st.bad = null; return draw(); }
    if (!st.sel) return toast('先點左邊的英文');
    if (st.sel === k) {
      st.done.add(k); st.sel = null; st.bad = null;
      speak(run.dict.get(k).w);
      if (st.done.size === st.left.length) run.feedback = { ok: true };
    } else {
      markWrong(st.sel);
      st.bad = [st.sel, k]; st.sel = null;
      setTimeout(() => { if (run && run.st === st && st.bad) { st.bad = null; draw(); } }, 700);
    }
    draw();
  }

  async function nextQuestion() {
    const r = run;
    const q = r.queue.shift();
    if (r.feedback.ok) r.done += q.ks ? q.ks.length : 1; else r.queue.push(q);
    r.feedback = null; r.st = null;
    if (r.queue.length) return draw();
    // 全部完成
    const firstTryOk = new Set([...r.newWords, ...r.reviewWords].filter((k) => !r.wrong.has(k)));
    const sess = { newWords: r.newWords, reviewWords: r.reviewWords };
    const perfect = r.wrong.size === 0;
    const hinted = r.hinted;
    run = null;
    el.innerHTML = '<p class="empty">儲存中…</p>';
    try {
      await saveProgress(kid, nextProgress(sess, progress, firstTryOk, today, hinted));
      await finishSession(kid, today, perfect);
      await markWordsDone(kid, today, cfg.points);
      toast(perfect ? '一次全對！太厲害了 🎯' : '完成了！👏', 'ok');
    } catch (e) { showError(e, '儲存'); }
    draw();
  }

  el.addEventListener('submit', (e) => {
    if (e.target.id !== 'spell') return;
    e.preventDefault();
    const a = String(new FormData(e.target).get('a') || '');
    const q = run.queue[0];
    const x = run.dict.get(q.k);
    answer(q.type === 'cloze' ? clozeAccepts(a, x.w, run.st.cz) : sameSpelling(a, x.w), a.trim());
  });
  el.addEventListener('click', (e) => {
    const s = e.target.closest('[data-say]');
    unlockAudio();   // iPhone：聲音要由點按啟動，之後換卡片才能自動發音
    if (s) { if (!canPlaySound()) toast('這台裝置不支援發音'); speak(s.dataset.say, !!s.dataset.slow); return; }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    switch (b.dataset.act) {
      case 'manage': go('/settings'); break;
      case 'voice': chooseVoice(); break;
      case 'toggleLearned': showAllLearned = !showAllLearned; draw(); break;
      case 'reset':
        confirmDialog(session.finished
          ? '重設今天的練習？\n今天新學的字會改回「還沒學過」，清單上的每日單字也會改回未完成，孩子可以重新做一次。\n（今天複習過的舊字，複習結果不會復原。）'
          : '重設今天的練習？\n孩子會重新開始，今天答錯的紀錄也會清掉。', { okLabel: '重設', danger: true })
          .then((ok) => ok && resetSession(kid, today, session).then(() => toast('已重設，孩子可以重新開始', 'ok')))
          .catch((err) => showError(err, '重設'));
        break;
      case 'start': b.disabled = true; start().catch((err) => { showError(err); b.disabled = false; }); break;
      case 'studyNext': run.study.shift(); draw(); break;
      case 'pick': {
        const q = run.queue[0];
        const x = run.dict.get(q.k);
        answer(b.dataset.v === (q.type === 'clozeMc' ? x.w : x.zh), b.dataset.v);
        break;
      }
      case 'hint': run.st.hint = true; run.hinted.add(run.queue[0].k); draw(); break;
      case 'tile': run.st.picked.push(Number(b.dataset.i)); draw(); break;
      case 'untile': run.st.picked.splice(Number(b.dataset.n), 1); draw(); break;
      case 'clearTiles': run.st.picked = []; draw(); break;
      case 'submitTiles': {
        const st = run.st;
        const built = st.picked.map((i) => st.tiles[i]).join('');
        answer(sameSpelling(built, run.dict.get(run.queue[0].k).w), built);
        break;
      }
      case 'matchL': matchTap('L', b.dataset.k); break;
      case 'matchR': matchTap('R', b.dataset.k); break;
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
  return () => { unsubs.forEach((u) => u()); stopSpeaking(); };
}
