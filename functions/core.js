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
  mom: { kidTask: true, itemDone: true, redeem: true, message: true },
  kid: { taskReview: true, itemReview: true, redeem: true, message: true, weekly: true, daily: true },
  quietStart: '22:00',
  quietEnd: '07:00',
  dailyTime: '20:00'
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
export async function notify(fid, who, category, msg, settings) {
  const s = settings || await loadSettings(fid);
  const group = who === 'mom' ? s.mom : s.kid;
  if (group[category] === false) return;
  const now = taipeiNow();
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

async function dailyReminder(fid, s, now) {
  const stateRef = db.doc(`families/${fid}/meta/pushState`);
  const st = (await stateRef.get()).data() || {};
  if (st.lastDaily === now.date || now.hm < (s.dailyTime || '20:00')) return;
  await stateRef.set({ lastDaily: now.date }, { merge: true });
  if (s.kid.daily === false) return;
  for (const kidId of ['kidA', 'kidB']) {
    const { left, unplanned } = await remainingToday(fid, kidId, now);
    if (!left.length && !unplanned) continue;
    const parts = [];
    if (left.length) parts.push(left.slice(0, 3).map((x) => x.title).join('、') + (left.length > 3 ? ` 等 ${left.length} 項` : ''));
    if (unplanned) parts.push(`本週還有 ${unplanned} 項進度沒排日期`);
    await deliver(fid, kidId, {
      title: left.length ? `🌙 今天還有 ${left.length} 項沒完成，加油！` : '📦 記得排本週進度',
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
    await flushQueue(f.id, s, now);
    await dailyReminder(f.id, s, now);
  }
}
