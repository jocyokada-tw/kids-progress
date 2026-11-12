// 推播通知的共用邏輯（設定、勿擾時段、發送、每日提醒）。觸發條件在 index.js。
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { logger } from 'firebase-functions';

export const TZ = 'Asia/Taipei';
const EMULATOR = process.env.FUNCTIONS_EMULATOR === 'true';

initializeApp();
export const db = getFirestore();

// ---------- 設定 ----------
export const DEFAULT_NOTIFY = {
  mom: { kidTask: true, itemDone: true, redeem: true, message: true, carry: true, due: true },
  kid: { taskReview: true, itemReview: true, redeem: true, message: true, weekly: true, daily: true, carry: true, due: true, timed: true, journal: true, journalComment: true },
  quietStart: '22:00',
  quietEnd: '07:00',
  dailyTime: '20:00',
  afterSchoolTime: '16:30'
};

export async function loadSettings(fid) {
  const s = (await db.doc(`families/${fid}/meta/settings`).get()).data() || {};
  const n = s.notify || {};
  return {
    ...DEFAULT_NOTIFY, ...n,
    mom: { ...DEFAULT_NOTIFY.mom, ...(n.mom || {}) },
    kid: { ...DEFAULT_NOTIFY.kid, ...(n.kid || {}) }
  };
}

export async function kidName(fid, kidId) {
  const m = (await db.doc(`families/${fid}/members/${kidId}`).get()).data();
  return (m && m.name) || (kidId === 'kidA' ? '小孩A' : '小孩B');
}

// ---------- 時間 ----------
export function taipeiNow(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short'
  }).formatToParts(date).map((p) => [p.type, p.value]));
  const hm = `${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}`;
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hm, weekday: wd };
}

/** 是否在勿擾時段（可跨午夜，例如 22:00–07:00） */
export function inQuiet(hm, start, end) {
  if (!start || !end || start === end) return false;
  return start < end ? hm >= start && hm < end : hm >= start || hm < end;
}

// ---------- 發送 ----------
/** who: 'mom' 或 kidId。媽媽的通知送到媽媽裝置；小孩的通知送到配對給該小孩的非媽媽裝置 */
export async function tokensFor(fid, who) {
  const devCol = db.collection(`families/${fid}/devices`);
  const snap = who === 'mom'
    ? await devCol.where('isMom', '==', true).get()
    : await devCol.where('kids', 'array-contains', who).get();
  const ids = snap.docs.filter((d) => who === 'mom' || !d.data().isMom).map((d) => d.id);
  if (!ids.length) return [];
  const refs = ids.map((id) => db.doc(`families/${fid}/pushTokens/${id}`));
  const docs = await db.getAll(...refs);
  return docs.filter((d) => d.exists && d.data().token).map((d) => ({ ref: d.ref, token: d.data().token }));
}

export async function deliver(fid, who, msg) {
  if (EMULATOR) {
    // 模擬器裡不真的發送，記錄下來方便測試
    await db.collection(`families/${fid}/_pushLog`).add({ who, ...msg, at: FieldValue.serverTimestamp() });
    return;
  }
  const targets = await tokensFor(fid, who);
  if (!targets.length) return;
  const res = await getMessaging().sendEachForMulticast({
    tokens: targets.map((t) => t.token),
    data: { title: msg.title, body: msg.body || '', url: msg.url || '', tag: msg.tag || '' },
    webpush: { headers: { Urgency: 'high', TTL: '86400' } }
  });
  // 清掉已失效的裝置 token
  await Promise.all(res.responses.map((r, i) => {
    const code = r.error && r.error.code;
    if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') {
      return targets[i].ref.delete();
    }
    if (r.error) logger.warn('push failed', code, r.error.message);
    return null;
  }));
}

/**
 * 發通知（會檢查類別開關與勿擾時段；勿擾時段內先排隊，時段結束後再發）
 * category: mom.kidTask / kid.message …
 */
export async function notify(fid, who, category, msg, settings, at) {
  const s = settings || await loadSettings(fid);
  const group = who === 'mom' ? s.mom : s.kid;
  if (group[category] === false) return;
  const now = at || taipeiNow();
  if (inQuiet(now.hm, s.quietStart, s.quietEnd)) {
    await db.collection(`families/${fid}/pushQueue`).add({ who, ...msg, createdAt: FieldValue.serverTimestamp() });
    return;
  }
  await deliver(fid, who, msg);
}

export const clip = (s, n = 80) => (s && s.length > n ? s.slice(0, n) + '…' : s || '');
export const md = (d) => (d ? `${+d.slice(5, 7)}/${+d.slice(8, 10)}` : '');

// ---------- 每 30 分鐘：每日提醒、勿擾時段結束後補發 ----------
/** 今天還沒完成的項目（不需要有人先打開清單，直接從固定事項與已確認進度計算） */
export async function remainingToday(fid, kidId, now) {
  const [routines, tasks, items, weekly, wordLists] = await Promise.all([
    db.collection(`families/${fid}/routines`).where('kidId', '==', kidId).get(),
    db.collection(`families/${fid}/tasks`).where('kidId', '==', kidId).where('date', '==', now.date).get(),
    db.collection(`families/${fid}/items`).where('kidId', '==', kidId).where('date', '==', now.date).get(),
    db.collection(`families/${fid}/tasks`).where('kidId', '==', kidId).where('date', '==', '').get(),
    db.collection(`families/${fid}/wordLists`).where('kids', 'array-contains', kidId).get()
  ]);
  const doneIds = new Set(items.docs.filter((d) => d.data().done || d.data().review === 'approved').map((d) => d.data().sourceId));
  const expected = [
    ...routines.docs.filter((d) => d.data().active !== false && (d.data().weekdays || []).includes(now.weekday)).map((d) => ({ id: d.id, title: d.data().title })),
    ...tasks.docs.filter((d) => d.data().status === 'approved').map((d) => ({ id: d.id, title: d.data().title })),
    ...(wordLists.docs.some((d) => d.data().active !== false && d.data().count > 0) ? [{ id: 'words', title: '每日單字' }] : [])
  ];
  const left = expected.filter((e) => !doneIds.has(e.id));
  const unplanned = weekly.docs.filter((d) => {
    const t = d.data();
    return t.kind === 'weekly' && t.status !== 'rejected' && t.week <= now.date && t.weekEnd >= now.date;
  }).length;
  return { left, unplanned };
}

// ---------- 自動順延：前一天沒完成的進度移到隔天 ----------
export function addDays(d, n) {
  const x = new Date(d + 'T00:00:00Z');
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}

/**
 * 把 day 那天沒完成的「進度」順延到隔天（固定事項、每日單字不順延）。
 * - 沒完成 = 沒有清單項目，或項目還沒勾選／被退回（已勾選待核可、已入帳都算完成）
 * - 本週進度順延超過那週週日，就變成「逾期未安排」，由媽媽處理
 * - day 那天的項目留著並標成「已順延」，所以那天不會算全部完成
 * 回傳 { kidId: [{ title, to }] }
 */
export async function carryOverDay(fid, day) {
  const next = addDays(day, 1);
  const fam = db.doc(`families/${fid}`);
  const [tasks, items] = await Promise.all([
    fam.collection('tasks').where('date', '==', day).get(),
    fam.collection('items').where('date', '==', day).get()
  ]);
  const itemBy = new Map(items.docs.map((d) => [d.id, d]));
  const moved = {};
  const batch = db.batch();
  let n = 0;
  for (const t of tasks.docs) {
    const d = t.data();
    if (d.status !== 'approved') continue;
    const iid = `${d.kidId}_${day}_${t.id}`;
    const it = itemBy.get(iid);
    const review = it ? it.data().review : 'none';
    if (it && (it.data().done || review === 'pending' || review === 'approved')) continue;
    const overdue = d.kind === 'weekly' && d.weekEnd && next > d.weekEnd;
    const to = overdue ? '' : next;
    batch.update(t.ref, { date: to, carriedFrom: FieldValue.arrayUnion(day), carryCount: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() });
    const mark = { missed: true, carriedTo: to || 'overdue' };
    if (it) batch.update(it.ref, mark);
    else {
      batch.set(fam.collection('items').doc(iid), {
        kidId: d.kidId, date: day, sourceType: 'task', sourceId: t.id, title: d.title, subject: d.subject || '', points: d.points || 0,
        order: 1000, done: false, doneAt: null, review: 'none', returnNote: '', createdAt: FieldValue.serverTimestamp(), ...mark
      });
    }
    (moved[d.kidId] ||= []).push({ title: d.title, to, due: d.due || '', pastDue: !!d.due && d.due <= day });
    n++;
  }
  if (n) await batch.commit();
  return moved;
}

async function carryOver(fid, s, now) {
  const stateRef = db.doc(`families/${fid}/meta/pushState`);
  const st = (await stateRef.get()).data() || {};
  const yesterday = addDays(now.date, -1);
  // 第一次執行只處理昨天；之後從上次處理的隔天補到昨天（最多 7 天）
  let day = st.lastCarry ? addDays(st.lastCarry, 1) : yesterday;
  if (day < addDays(yesterday, -6)) day = addDays(yesterday, -6);
  const all = {};
  for (; day <= yesterday; day = addDays(day, 1)) {
    const moved = await carryOverDay(fid, day);
    for (const [k, list] of Object.entries(moved)) (all[k] ||= []).push(...list);
    await stateRef.set({ lastCarry: day }, { merge: true });
  }
  // 孩子的提醒改在放學後（afterSchool）；這裡只通知媽媽（勿擾時段內會排到早上）
  for (const [kidId, list] of Object.entries(all)) {
    const name = await kidName(fid, kidId);
    const overdue = list.filter((x) => !x.to);
    const names = list.slice(0, 3).map((x) => x.title).join('、') + (list.length > 3 ? ` 等 ${list.length} 項` : '');
    await notify(fid, 'mom', 'carry', {
      title: `⏰ ${name}昨天有 ${list.length} 項沒完成`,
      body: `${names}${list.length - overdue.length ? `\n${list.length - overdue.length} 項已順延到今天` : ''}${overdue.length ? `\n${overdue.length} 項本週進度已逾期，需要你處理` : ''}`,
      url: `#/k/${kidId}/${overdue.length ? 'schedule' : 'checklist'}`, tag: `carry-${kidId}`
    }, s, now);
    // 過了期限還沒完成（期限當天結束時通知一次；之後每天仍會順延）
    const pastDue = list.filter((x) => x.pastDue && x.due === addDays(now.date, -1));
    if (pastDue.length) {
      await notify(fid, 'mom', 'due', {
        title: `⚠️ ${name}有 ${pastDue.length} 項作業過了期限`,
        body: pastDue.map((x) => `${x.title}（${md(x.due)} 截止）`).join('、') + '\n還沒完成，已順延到今天',
        url: `#/k/${kidId}/checklist`, tag: `due-${kidId}`
      }, s, now);
    }
  }
}

// ---------- 放學後提醒（孩子）：順延到今天的作業、2 天內到期的作業 ----------
/** 這個孩子今天要特別提醒的作業 */
export async function afterSchoolList(fid, kidId, today) {
  const fam = db.doc(`families/${fid}`);
  const [todaysAll, dueAll] = await Promise.all([
    fam.collection('tasks').where('kidId', '==', kidId).where('date', '==', today).get(),
    fam.collection('tasks').where('due', '>=', today).where('due', '<=', addDays(today, 2)).get()   // 單一欄位範圍，不需要複合索引
  ]);
  const todays = todaysAll.docs;
  const dueSoon = dueAll.docs.filter((d) => d.data().kidId === kidId);
  // 有排日期的，看那天的清單項目是不是已經勾選
  const withDate = [...new Map([...todays, ...dueSoon].filter((d) => d.data().date).map((d) => [d.id, d])).values()];
  const itemDocs = withDate.length ? await db.getAll(...withDate.map((d) => fam.collection('items').doc(`${kidId}_${d.data().date}_${d.id}`))) : [];
  const done = new Set(itemDocs.filter((x) => x.exists && !x.data().missed && (x.data().done || ['pending', 'approved'].includes(x.data().review))).map((x) => x.data().sourceId));
  const ok = (d) => d.data().status === 'approved' && !d.data().itemApproved && !done.has(d.id);
  const carried = todays.filter((d) => ok(d) && (d.data().carriedFrom || []).length).map((d) => d.data().title);
  const soon = dueSoon.filter((d) => ok(d))
    .map((d) => ({ title: d.data().title, due: d.data().due })).sort((a, b) => a.due.localeCompare(b.due));
  return { carried, soon };
}

async function afterSchool(fid, s, now) {
  const stateRef = db.doc(`families/${fid}/meta/pushState`);
  const st = (await stateRef.get()).data() || {};
  if (st.lastAfterSchool === now.date || now.hm < (s.afterSchoolTime || '16:30')) return;
  await stateRef.set({ lastAfterSchool: now.date }, { merge: true });
  const left = (n) => (n === 0 ? '今天截止' : n === 1 ? '明天截止' : '後天截止');
  for (const kidId of ['kidA', 'kidB']) {
    const { carried, soon } = await afterSchoolList(fid, kidId, now.date);
    const useCarry = s.kid.carry !== false && carried.length;
    const useDue = s.kid.due !== false && soon.length;
    if (!useCarry && !useDue) continue;
    const lines = [];
    if (useCarry) lines.push(`⏰ 昨天沒完成：${carried.slice(0, 3).join('、')}${carried.length > 3 ? ` 等 ${carried.length} 項` : ''}`);
    if (useDue) lines.push(...soon.slice(0, 3).map((x) => `📅 ${x.title}（${left(Math.round((new Date(x.due) - new Date(now.date)) / 86400000))}）`));
    await deliver(fid, kidId, {
      title: useCarry && useDue ? '📚 今天要先完成的作業' : useCarry ? `⏰ 有 ${carried.length} 項昨天沒完成的作業` : `📅 有 ${soon.length} 項作業快到期了`,
      body: lines.join('\n'), url: `#/k/${kidId}/checklist`, tag: `school-${kidId}`
    });
  }
}

// ---------- 指定完成時間：時間前 30 分鐘提醒孩子 ----------
const toMin = (hm) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));

/** 指定時間落在「現在之後 30 分鐘內」、還沒送出的事項。排程每 30 分鐘跑一次，每個時間只會落在一次 */
export async function timedSoon(fid, kidId, now) {
  const fam = db.doc(`families/${fid}`);
  const [routines, tasks] = await Promise.all([
    fam.collection('routines').where('kidId', '==', kidId).get(),
    fam.collection('tasks').where('kidId', '==', kidId).where('date', '==', now.date).get()
  ]);
  const inWindow = (t) => /^\d\d:\d\d$/.test(t || '') && toMin(t) > toMin(now.hm) && toMin(t) - toMin(now.hm) <= 30;
  const cands = [
    ...routines.docs.filter((d) => { const r = d.data(); return r.active !== false && (r.weekdays || []).includes(now.weekday) && inWindow(r.dueTime); }),
    ...tasks.docs.filter((d) => d.data().status === 'approved' && inWindow(d.data().dueTime))
  ];
  if (!cands.length) return [];
  const items = await db.getAll(...cands.map((d) => fam.collection('items').doc(`${kidId}_${now.date}_${d.id}`)));
  return cands.filter((d, i) => { const x = items[i].exists ? items[i].data() : null; return !(x && (x.done || ['pending', 'approved'].includes(x.review))); })
    .map((d) => ({ title: d.data().title, dueTime: d.data().dueTime }));
}

async function timedReminder(fid, s, now) {
  if (s.kid.timed === false || inQuiet(now.hm, s.quietStart, s.quietEnd)) return;
  for (const kidId of ['kidA', 'kidB']) {
    const list = await timedSoon(fid, kidId, now);
    if (!list.length) continue;
    await deliver(fid, kidId, {
      title: `⏰ ${list[0].dueTime} 前要完成：${list.map((x) => x.title).join('、')}`,
      body: '準時完成才有全部點數，也才能拿今天的全部完成獎勵喔！',
      url: `#/k/${kidId}/checklist`, tag: `timed-${kidId}`
    });
  }
}

async function dailyReminder(fid, s, now) {
  const stateRef = db.doc(`families/${fid}/meta/pushState`);
  const st = (await stateRef.get()).data() || {};
  if (st.lastDaily === now.date || now.hm < (s.dailyTime || '20:00')) return;
  await stateRef.set({ lastDaily: now.date }, { merge: true });
  if (s.kid.daily === false) return;
  for (const kidId of ['kidA', 'kidB']) {
    const { left, unplanned } = await remainingToday(fid, kidId, now);
    const { soon } = s.kid.due !== false ? await afterSchoolList(fid, kidId, now.date) : { soon: [] };
    const tomorrow = soon.filter((x) => x.due === addDays(now.date, 1));
    if (!left.length && !unplanned && !tomorrow.length) continue;
    const parts = [];
    if (left.length) parts.push(left.slice(0, 3).map((x) => x.title).join('、') + (left.length > 3 ? ` 等 ${left.length} 項` : ''));
    if (unplanned) parts.push(`本週還有 ${unplanned} 項進度沒排日期`);
    if (tomorrow.length) parts.push(`📅 明天截止：${tomorrow.map((x) => x.title).join('、')}`);
    await deliver(fid, kidId, {
      title: left.length ? `🌙 今天還有 ${left.length} 項沒完成，加油！` : tomorrow.length ? '📅 明天有作業要交' : '📦 記得排本週進度',
      body: parts.join('\n'), url: left.length ? `#/k/${kidId}/checklist` : `#/k/${kidId}/schedule`, tag: `daily-${kidId}`
    });
  }
}

async function flushQueue(fid, s, now) {
  if (inQuiet(now.hm, s.quietStart, s.quietEnd)) return;
  const q = await db.collection(`families/${fid}/pushQueue`).orderBy('createdAt').get();
  if (q.empty) return;
  // 同一個 tag 只發最新的一則
  const latest = new Map();
  q.docs.forEach((d) => { const m = d.data(); latest.set(`${m.who}|${m.tag || d.id}`, m); });
  for (const m of latest.values()) {
    const { who, createdAt, ...msg } = m;
    await deliver(fid, who, msg);
  }
  const batch = db.batch();
  q.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
}

export async function runPeriodic(date = new Date()) {
  const now = taipeiNow(date);
  const fams = await db.collection('families').listDocuments();
  for (const f of fams) {
    const s = await loadSettings(f.id);
    await carryOver(f.id, s, now);
    await flushQueue(f.id, s, now);
    await afterSchool(f.id, s, now);
    await timedReminder(f.id, s, now);
    await dailyReminder(f.id, s, now);
    await (await import('./journal.js')).journalReminder(f.id, s, now);
  }
}
