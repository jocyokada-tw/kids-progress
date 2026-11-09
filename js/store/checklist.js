import { db, query, where, onSnapshot, getDocs, runTransaction, updateDoc, deleteDoc, serverTimestamp } from '../firebase.js';
import { fcol, fdoc, docs } from './paths.js';
import { watchRoutines } from './routines.js';
import { watchTasksOnDate } from './tasks.js';
import { todayStr, weekday } from '../utils/date.js';

// 每日清單項目：items/{kidId}_{date}_{sourceId}
// 由「當天已確認的進度」＋「符合星期的固定事項」自動產生。文件 ID 固定，所以不會重複產生。
// review: none（未完成）| pending（已勾選，待媽媽核可）| approved（已入帳）| returned（媽媽退回）
export const itemId = (kidId, date, sourceId) => `${kidId}_${date}_${sourceId}`;

function expectedFor(kidId, date, routines, tasks) {
  const wd = weekday(date);
  const list = [
    ...routines.filter((r) => r.active !== false && (r.weekdays || []).includes(wd))
      .map((r, i) => ({ sourceType: 'routine', sourceId: r.id, title: r.title, points: r.points, order: i, subject: '' })),
    ...tasks.filter((t) => t.status === 'approved')
      .map((t, i) => ({ sourceType: 'task', sourceId: t.id, title: t.title, points: t.points, order: 1000 + i, subject: t.subject || '' }))
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
  let routines = null, tasks = null, items = null;
  const tried = new Set();
  const isPastOrToday = date <= todayStr();

  const update = () => {
    if (!routines || !tasks || !items) return;
    const expected = expectedFor(kidId, date, routines, tasks);
    const visible = items
      .filter((it) => it.review === 'approved' || expected.has(it.id))
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.title.localeCompare(b.title));
    onItems(visible);
    if (!isPastOrToday) return;

    const have = new Map(items.map((it) => [it.id, it]));
    for (const [id, e] of expected) {
      if (have.has(id) || tried.has('c' + id)) continue;
      tried.add('c' + id);
      createItem(id, kidId, date, e).catch((err) => console.warn('create item', id, err));
    }
    if (!canReconcile) return;
    for (const it of items) {
      if (it.review === 'approved') continue;
      const e = expected.get(it.id);
      if (!e) {
        if (!tried.has('d' + it.id)) { tried.add('d' + it.id); deleteDoc(fdoc('items', it.id)).catch(onError); }
      } else if (e.title !== it.title || e.points !== it.points || e.order !== it.order || e.subject !== (it.subject || '')) {
        const key = `u${it.id}|${e.title}|${e.points}|${e.order}|${e.subject}`;
        if (!tried.has(key)) { tried.add(key); updateDoc(fdoc('items', it.id), { title: e.title, points: e.points, order: e.order, subject: e.subject }).catch(onError); }
      }
    }
  };

  const unsubs = [
    watchRoutines(kidId, (r) => { routines = r; update(); }, onError),
    watchTasksOnDate(kidId, date, (t) => { tasks = t; update(); }, onError),
    onSnapshot(query(fcol('items'), where('kidId', '==', kidId), where('date', '==', date)),
      (s) => { items = docs(s); update(); }, onError)
  ];
  return () => unsubs.forEach((u) => u());
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
  await runTransaction(db, async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists()) throw new Error('項目不存在');
    const it = s.data();
    if (it.review === 'approved') return;
    const l = await tx.get(lref);
    tx.update(ref, { done: true, review: 'approved', returnNote: '', approvedAt: serverTimestamp() });
    if (!l.exists()) {
      tx.set(lref, {
        kidId: it.kidId, amount: it.points, type: 'task', title: it.title, date: it.date,
        refId: id, createdAt: serverTimestamp(), createdBy: 'mom'
      });
    }
  });
}

/** 當天全部項目都核可後，發放「全部完成」額外獎勵（每天最多一次） */
export async function grantBonusIfComplete(kidId, date, bonus) {
  if (!(bonus > 0)) return false;
  const snap = await getDocs(query(fcol('items'), where('kidId', '==', kidId), where('date', '==', date)));
  const list = docs(snap);
  if (!list.length || !list.every((it) => it.review === 'approved')) return false;
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
