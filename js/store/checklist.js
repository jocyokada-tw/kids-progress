import { db, query, where, onSnapshot, getDoc, runTransaction, updateDoc, deleteDoc, serverTimestamp } from '../firebase.js';
import { fcol, fdoc, docs } from './paths.js';
import { watchRoutines } from './routines.js';
import { watchTasksOnDate } from './tasks.js';
import { todayStr, weekday } from '../utils/date.js';
import { state } from '../state.js';
import { watchWordLists, WORD_DEFAULTS } from './words.js';

// 每日清單項目：items/{kidId}_{date}_{sourceId}
// 由「當天已確認的進度」＋「符合星期的固定事項」自動產生。文件 ID 固定，所以不會重複產生。
// review: none（未完成）| pending（已勾選，待媽媽核可）| approved（已入帳）| returned（媽媽退回）
export const itemId = (kidId, date, sourceId) => `${kidId}_${date}_${sourceId}`;

const WORDS_TITLE = '📖 每日單字';
const wordPoints = () => ({ ...WORD_DEFAULTS, ...(state.settings.words || {}) }).points;

function expectedFor(kidId, date, routines, tasks, hasWords) {
  const wd = weekday(date);
  const list = [
    ...routines.filter((r) => r.active !== false && (r.weekdays || []).includes(wd))
      .map((r, i) => ({ sourceType: 'routine', sourceId: r.id, title: r.title, points: r.points, order: i, subject: '' })),
    ...tasks.filter((t) => t.status === 'approved')
      .map((t, i) => ({ sourceType: 'task', sourceId: t.id, title: t.title, points: t.points, order: 1000 + i, subject: t.subject || '', carriedFrom: (t.carriedFrom || []).slice(-1)[0] || '' })),
    // 每日單字：有字庫的小孩，當天自動多一項（只在當天產生）
    ...(hasWords && date === todayStr() ? [{ sourceType: 'words', sourceId: 'words', title: WORDS_TITLE, points: wordPoints(), order: 500, subject: '' }] : [])
  ];
  return new Map(list.map((e) => [itemId(kidId, date, e.sourceId), e]));
}

async function createItem(id, kidId, date, e) {
  const ref = fdoc('items', id);
  await runTransaction(db, async (tx) => {
    const s = await tx.get(ref);
    if (s.exists()) return;
    tx.set(ref, {
      kidId, date, sourceType: e.sourceType, sourceId: e.sourceId, title: e.title, points: e.points, order: e.order, subject: e.subject,
      done: false, doneAt: null, review: 'none', returnNote: '', createdAt: serverTimestamp()
    });
  });
}

/**
 * 即時監聽某個小孩某一天的清單，並自動補齊缺少的項目。
 * canReconcile=true（媽媽裝置）時，也會更新已改名／改點數的項目、移除來源已不存在的項目。
 */
export function watchChecklist(kidId, date, { canReconcile, onItems, onError }) {
  let routines = null, tasks = null, items = null, wordLists = null;
  const tried = new Set();
  const isPastOrToday = date <= todayStr();

  const update = () => {
    if (!routines || !tasks || !items || !wordLists) return;
    const hasWords = wordLists.some((l) => (l.kids || []).includes(kidId) && l.count > 0);
    const expected = expectedFor(kidId, date, routines, tasks, hasWords);
    // 今天和過去的日子：已經出現在清單上的項目都要留著顯示。
    // 之後被改期、退回重排或刪掉來源的項目，標成「已改期／取消」但仍算在當天，避免那天被誤判為全部完成。
    const visible = items
      .filter((it) => isPastOrToday || it.review === 'approved' || expected.has(it.id))
      .map((it) => (expected.get(it.id)?.carriedFrom ? { ...it, carriedFrom: expected.get(it.id).carriedFrom } : it))
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.title.localeCompare(b.title));
    // 「全部完成」的判斷以畫面上看到的清單為準：每個應該有的項目都已建立而且已核可
    const have0 = new Map(items.map((it) => [it.id, it]));
    const complete = visible.length > 0 && visible.every((it) => it.review === 'approved')
      && [...expected.keys()].every((id) => have0.get(id)?.review === 'approved');
    onItems(visible, complete);
    if (!isPastOrToday) return;

    const have = new Map(items.map((it) => [it.id, it]));
    for (const [id, e] of expected) {
      if (have.has(id) || tried.has('c' + id) || !navigator.onLine) continue; // 離線時不建立（需要交易確認）
      tried.add('c' + id);
      createItem(id, kidId, date, e).catch((err) => console.warn('create item', id, err));
    }
    if (!canReconcile) return;
    for (const it of items) {
      if (it.review === 'approved') continue;
      const e = expected.get(it.id);
      if (!e) {
        // 來源不見了（改期、退回重排、刪除）：不刪掉，標成「已改期／取消」；每日單字只是當天沒做，不用標
        if (it.sourceType !== 'words' && !it.missed && !tried.has('m' + it.id)) {
          tried.add('m' + it.id);
          updateDoc(fdoc('items', it.id), { missed: true }).catch(onError);
        }
        continue;
      }
      if (it.missed && !tried.has('r' + it.id)) { tried.add('r' + it.id); updateDoc(fdoc('items', it.id), { missed: false }).catch(onError); }
      if (e.title !== it.title || e.points !== it.points || e.order !== it.order || e.subject !== (it.subject || '')) {
        const key = `u${it.id}|${e.title}|${e.points}|${e.order}|${e.subject}`;
        if (!tried.has(key)) { tried.add(key); updateDoc(fdoc('items', it.id), { title: e.title, points: e.points, order: e.order, subject: e.subject }).catch(onError); }
      }
    }
  };

  const unsubs = [
    watchRoutines(kidId, (r) => { routines = r; update(); }, onError),
    watchTasksOnDate(kidId, date, (t) => { tasks = t; update(); }, onError),
    watchWordLists((l) => { wordLists = l; update(); }, onError),
    onSnapshot(query(fcol('items'), where('kidId', '==', kidId), where('date', '==', date)),
      (s) => { items = docs(s); update(); }, onError)
  ];
  return () => unsubs.forEach((u) => u());
}

/** 每日單字練習完成：確保清單項目存在，並標成「待核可」 */
export async function markWordsDone(kidId, date, points) {
  const id = itemId(kidId, date, 'words');
  await createItem(id, kidId, date, { sourceType: 'words', sourceId: 'words', title: WORDS_TITLE, points, order: 500, subject: '' });
  const s = await getDoc(fdoc('items', id));
  if (s.exists() && ['none', 'returned'].includes(s.data().review)) await setItemDone(id, true);
}

/** 媽媽把「已改期／取消」的項目從那天的清單移除（移除後不算在那天，可能讓那天變成全部完成） */
export const removeItem = (id) => deleteDoc(fdoc('items', id));

/** 讀一次某個清單項目（不存在回傳 null） */
export async function getItemOnce(kidId, date, sourceId) {
  const s = await getDoc(fdoc('items', itemId(kidId, date, sourceId)));
  return s.exists() ? s.data() : null;
}

export function watchPendingItems(kidId, cb, onErr) {
  const q = query(fcol('items'), where('kidId', '==', kidId), where('review', '==', 'pending'));
  return onSnapshot(q, (s) => cb(docs(s)), onErr);
}

/** 勾選／取消勾選（小孩或媽媽） */
export const setItemDone = (id, done) => updateDoc(fdoc('items', id), {
  done, doneAt: done ? serverTimestamp() : null, review: done ? 'pending' : 'none'
});

/** 媽媽退回 */
export const returnItem = (id, note) => updateDoc(fdoc('items', id), {
  done: false, doneAt: null, review: 'returned', returnNote: note || ''
});

/**
 * 媽媽核可：同一個交易內把項目標成 approved，並寫入一筆點數流水帳。
 * 流水帳 ID 固定為 task_{itemId}，所以重複按也只會入帳一次。
 */
export async function approveItem(id) {
  const ref = fdoc('items', id);
  const lref = fdoc('ledger', `task_${id}`);
  const bref = fdoc('ledger', `wordbonus_${id}`);
  const perfectBonus = ({ ...WORD_DEFAULTS, ...(state.settings.words || {}) }).perfectBonus;
  await runTransaction(db, async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists()) throw new Error('項目不存在');
    const it = s.data();
    if (it.review === 'approved') return;
    const l = await tx.get(lref);
    // 進度入帳後鎖定日期（本週進度不能再改天）
    const tref = it.sourceType === 'task' ? fdoc('tasks', it.sourceId) : null;
    const t = tref ? await tx.get(tref) : null;
    // 每日單字：測驗一次全對，另外加一筆獎勵
    let wordBonus = false;
    if (it.sourceType === 'words' && perfectBonus > 0) {
      const sess = await tx.get(fdoc('wordSessions', `${it.kidId}_${it.date}`));
      wordBonus = sess.exists() && sess.data().finished && sess.data().perfect && !(await tx.get(bref)).exists();
    }
    tx.update(ref, { done: true, review: 'approved', returnNote: '', approvedAt: serverTimestamp() });
    if (t && t.exists()) tx.update(tref, { itemApproved: true });
    if (wordBonus) {
      tx.set(bref, { kidId: it.kidId, amount: perfectBonus, type: 'bonus', title: '每日單字一次全對 🎯', date: it.date, refId: id, createdAt: serverTimestamp(), createdBy: 'mom' });
    }
    if (!l.exists()) {
      tx.set(lref, {
        kidId: it.kidId, amount: it.points, type: 'task', title: it.title, date: it.date,
        refId: id, createdAt: serverTimestamp(), createdBy: 'mom'
      });
    }
  });
}

/** 發放「全部完成」額外獎勵（流水帳 ID 固定，每天最多一次；是否全部完成由 watchChecklist 判斷） */
export async function grantBonus(kidId, date, bonus) {
  if (!(bonus > 0)) return false;
  const lref = fdoc('ledger', `bonus_${kidId}_${date}`);
  return runTransaction(db, async (tx) => {
    const l = await tx.get(lref);
    if (l.exists()) return false;
    tx.set(lref, {
      kidId, amount: bonus, type: 'bonus', title: '全部完成獎勵 🎉', date,
      refId: `${kidId}_${date}`, createdAt: serverTimestamp(), createdBy: 'mom'
    });
    return true;
  });
}
