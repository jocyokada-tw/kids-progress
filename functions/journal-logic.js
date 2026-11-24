// 課後小記的層級與點數規則（伺服器端）。和網頁端 js/utils/journal.js 相同，兩邊要一起改；tests/journal.test.mjs 會比對。
export const JOURNAL_DEFAULTS = {
  // 預設不開：媽媽在設定裡勾選孩子、填課表後才會出現
  kids: [],
  schedule: {},
  points: { basic: 1, advanced: 2, full: 3 },
  lateDeduct: 0,
  weeklyPoints: 3,
  reminderTime: '18:30',
  lightWeekdays: [5],
  hintWeeks: 2
};
export function journalSettings(settings) {
  const j = (settings && settings.journal) || {};
  return { ...JOURNAL_DEFAULTS, ...j, points: { ...JOURNAL_DEFAULTS.points, ...(j.points || {}) }, schedule: { ...JOURNAL_DEFAULTS.schedule, ...(j.schedule || {}) } };
}
const filled = (s) => typeof s === 'string' && s.trim().length > 0;
export function levelOf(note) {
  if (!note || note.skipped || !note.mood || !filled(note.learned)) return null;
  const n = [note.interesting, note.question].filter(filled).length;
  return n === 2 ? 'full' : n === 1 ? 'advanced' : 'basic';
}
export function pointsFor(level, onTheDay, cfg) {
  if (!level) return 0;
  const p = Number(cfg.points[level]) || 0;
  return onTheDay ? p : Math.max(0, p - (Number(cfg.lateDeduct) || 0));
}
const weekdayOf = (d) => new Date(d + 'T00:00:00Z').getUTCDay();
export function classDay(cfg, kidId, date) {
  if (!(cfg.kids || []).includes(kidId)) return false;
  const wd = weekdayOf(date);
  return ((cfg.schedule && cfg.schedule[kidId]) || []).some((c) => Number(c.weekday) === wd && Number(c.count) > 0);
}
/** 該日期所在週的週一 */
export function weekStartOf(d) {
  const wd = weekdayOf(d);
  const x = new Date(d + 'T00:00:00Z');
  x.setUTCDate(x.getUTCDate() + (wd === 0 ? -6 : 1 - wd));
  return x.toISOString().slice(0, 10);
}
/** 這個孩子有開啟小記，而且課表裡有課 */
export const hasClasses = (cfg, kidId) => (cfg.kids || []).includes(kidId) && ((cfg.schedule && cfg.schedule[kidId]) || []).some((c) => Number(c.count) > 0);
/** week 是週一，today 是那週的週六或週日 */
export function weekendWindow(week, today) {
  if (weekStartOf(week) !== week) return false;
  const add = (n) => { const x = new Date(week + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  return today >= add(5) && today <= add(6);
}

// ---------- 每一類課各自紀錄（和 js/utils/journal.js 相同） ----------
const CATEGORY_ORDER = ['humanities', 'math_science', 'project'];
export const CLASS_FIELDS = ['mood', 'moodDetail', 'followUpAnswer', 'boringReason', 'boringAnswer', 'learned', 'interesting', 'question', 'projectProgress'];
/** 那天上的課的類別（依類別順序） */
export function catsOn(cfg, kidId, date) {
  if (!(cfg.kids || []).includes(kidId)) return [];
  const wd = weekdayOf(date);
  const set = new Set(((cfg.schedule && cfg.schedule[kidId]) || []).filter((c) => Number(c.weekday) === wd && Number(c.count) > 0).map((c) => c.category));
  return CATEGORY_ORDER.filter((c) => set.has(c));
}
export function noteClasses(note, cats = []) {
  if (!note) return {};
  if (note.classes && typeof note.classes === 'object') return note.classes;
  const out = {};
  if (note.mood || filled(note.learned)) {
    const e = {};
    for (const k of CLASS_FIELDS) if (note[k] != null) e[k] = note[k];
    out[note.memorable || cats[0] || 'project'] = e;
  }
  if (note.extraCategory && filled(note.extraText) && !out[note.extraCategory]) out[note.extraCategory] = { learned: note.extraText, short: true };
  return out;
}
export function classLevels(note, cats) {
  const c = noteClasses(note, cats);
  return Object.fromEntries(cats.map((k) => [k, note && !note.skipped ? levelOf(c[k]) : null]));
}
export function notePoints(note, cats, onTheDay, cfg) {
  return Object.values(classLevels(note, cats)).reduce((s, lv) => s + pointsFor(lv, onTheDay, cfg), 0);
}
