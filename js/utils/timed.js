// 指定完成時間：在指定時間前送出算準時；之後才送出算逾時（點數減半、當天不能拿全部完成獎勵）
const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });

/** Date／Firestore Timestamp → 台灣時間「YYYY-MM-DD HH:MM」 */
export function taipeiStamp(t) {
  const d = t && t.toDate ? t.toDate() : t instanceof Date ? t : new Date();
  const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour === '24' ? '00' : p.hour}:${p.minute}`;
}

export const isTime = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s || '');
export const deadlineOf = (it) => (it && isTime(it.dueTime) ? `${it.date} ${it.dueTime}` : null);

/** 已送出的項目是不是逾時（doneAt 還沒寫到伺服器時以現在時間判斷） */
export function isLateDone(it) {
  const dl = deadlineOf(it);
  if (!dl || !(it.done || it.review === 'pending' || it.review === 'approved')) return false;
  if (it.late != null) return !!it.late;           // 核可時已經判定過
  return taipeiStamp(it.doneAt || new Date()) > dl;
}

/** 還沒送出、而且已經超過指定時間 */
export function isOverdueNow(it, now = new Date()) {
  const dl = deadlineOf(it);
  return !!dl && !(it.done || it.review === 'pending' || it.review === 'approved') && taipeiStamp(now) > dl;
}

/** 逾時的點數：一半，無條件捨去 */
export const latePoints = (points) => Math.floor((Number(points) || 0) / 2);
