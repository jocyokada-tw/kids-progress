import { isMom, member, memberName, memberColor } from '../state.js';
import { esc, showError } from '../ui.js';
import { watchThread, watchMessages, sendMessage, markRead, isReadByOther } from '../store/messages.js';
import { labelMD, labelTime } from '../utils/date.js';

const dateKey = (ts) => (ts && ts.toDate ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(ts.toDate()) : null);

/** 留言板：媽媽與一個小孩的對話串 */
export function mountMessages(el, { kid }) {
  const me = isMom() ? 'mom' : 'kid';
  const other = me === 'mom' ? kid : 'mom';
  let thread = {}, messages = null;
  let lastMarked = 0;

  el.innerHTML = `
    <div class="page-head"><h1>💬 ${me === 'mom' ? `和${esc(memberName(kid))}的留言` : '和媽媽的留言'}</h1></div>
    <section class="card chat"><div class="chat-list" aria-live="polite"><p class="empty">載入中…</p></div></section>
    <form class="composer">
      <textarea name="text" rows="1" maxlength="500" placeholder="${me === 'mom' ? '寫點什麼給孩子…' : '想跟媽媽說什麼？'}" aria-label="留言內容"></textarea>
      <button class="btn btn-primary" type="submit">送出</button>
    </form>`;
  const list = el.querySelector('.chat-list');
  const form = el.querySelector('.composer');
  const input = form.querySelector('textarea');

  const avatar = (who) => {
    const id = who === 'mom' ? 'mom' : kid;
    return `<span class="avatar sm" style="background:${memberColor(id)}">${esc(member(id).emoji)}</span>`;
  };

  function draw() {
    if (!messages) return;
    if (!messages.length) {
      list.innerHTML = `<p class="empty">還沒有留言，說聲嗨吧 👋</p>`;
      return;
    }
    let prevDate = null;
    list.innerHTML = messages.map((m) => {
      const d = dateKey(m.createdAt);
      const sep = d && d !== prevDate ? `<div class="chat-date">${labelMD(d)}</div>` : '';
      if (d) prevDate = d;
      const mine = (m.from === 'mom') === (me === 'mom');
      return `${sep}
        <div class="msg ${mine ? 'mine' : 'theirs'}">
          ${mine ? '' : avatar(m.from)}
          <div class="msg-body">
            <div class="bubble">${esc(m.text)}</div>
            <div class="msg-meta">${m.createdAt ? labelTime(m.createdAt).split(' ').pop() : '傳送中…'}${mine && isReadByOther(m, thread) ? ' ・已讀' : ''}</div>
          </div>
        </div>`;
    }).join('');
    list.scrollTop = list.scrollHeight;
    window.scrollTo(0, document.body.scrollHeight);
  }

  // 有對方的新訊息、而且畫面正在看時，標記已讀
  function maybeMarkRead() {
    if (!messages || document.visibilityState !== 'visible') return;
    const latest = messages.filter((m) => m.from !== me && m.createdAt).pop();
    const t = latest ? latest.createdAt.toMillis() : 0;
    if (t > lastMarked || lastMarked === 0) {
      lastMarked = Math.max(t, 1);
      markRead(kid, me).catch((e) => showError(e, '更新已讀'));
    }
  }
  const onVis = () => maybeMarkRead();
  document.addEventListener('visibilitychange', onVis);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    autoSize();
    try { await sendMessage(kid, me, text); } catch (err) { input.value = text; showError(err, '送出失敗'); }
  });
  const autoSize = () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 140) + 'px'; };
  input.addEventListener('input', autoSize);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) form.requestSubmit();
  });

  const unsubs = [
    watchThread(kid, (t) => { thread = t; draw(); }, (e) => showError(e, '讀取留言')),
    watchMessages(kid, (m) => { messages = m; draw(); maybeMarkRead(); }, (e) => showError(e, '讀取留言'))
  ];
  return () => { unsubs.forEach((u) => u()); document.removeEventListener('visibilitychange', onVis); };
}
