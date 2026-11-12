// 所有日期都用台灣時間，並以 'YYYY-MM-DD' 字串儲存，避免時區錯亂。
const TZ = 'Asia/Taipei';
const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

export const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

export function todayStr() { return fmt.format(new Date()); }

function toDate(s) { return new Date(s + 'T00:00:00Z'); }
function toStr(d) { return d.toISOString().slice(0, 10); }

export function addDays(s, n) { const d = toDate(s); d.setUTCDate(d.getUTCDate() + n); return toStr(d); }
export function weekday(s) { return toDate(s).getUTCDay(); }

/** 該日期所在週的週一 */
export function weekStart(s) { const wd = weekday(s); return addDays(s, wd === 0 ? -6 : 1 - wd); }

export function range(from, count) { return Array.from({ length: count }, (_, i) => addDays(from, i)); }

export function diffDays(a, b) { return Math.round((toDate(b) - toDate(a)) / 86400000); }

/** 11/8（日） */
export function labelMD(s) {
  const [, m, d] = s.split('-');
  return `${+m}/${+d}（${WEEKDAYS[weekday(s)]}）`;
}

export function labelRelative(s) {
  const n = diffDays(todayStr(), s);
  if (n === 0) return '今天';
  if (n === 1) return '明天';
  if (n === -1) return '昨天';
  return '';
}

export function isDateStr(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s || ''); }

/** Firestore Timestamp → 「11/8 14:05」 */
export function labelTime(ts) {
  if (!ts) return '剛剛';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return new Intl.DateTimeFormat('zh-TW', { timeZone: TZ, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
}

/** 期限標籤：{ text, level }；level: 'over'（已過期限）| 'soon'（今天或明天）| 'ok' */
export function dueInfo(due, today = todayStr()) {
  if (!isDateStr(due)) return null;
  const n = diffDays(today, due);
  if (n < 0) return { text: `⚠️ 已過期限（${labelMD(due)}）`, level: 'over' };
  if (n === 0) return { text: '📅 今天截止', level: 'soon' };
  if (n === 1) return { text: '📅 明天截止', level: 'soon' };
  return { text: `📅 ${labelMD(due)} 截止・還有 ${n} 天`, level: n <= 2 ? 'soon' : 'ok' };
}
export const dueTag = (due, today) => { const d = dueInfo(due, today); return d ? `<span class="tag ${d.level === 'ok' ? 'tag-wait' : 'tag-bad'}">${d.text}</span>` : ''; };
