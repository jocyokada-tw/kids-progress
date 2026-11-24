// 課後小記的純邏輯（不碰資料庫，方便測試）。伺服器端 functions/journal.js 有同樣的層級／點數規則，兩邊要一起改。
import { weekday, weekStart, addDays } from './date.js';

export const CATEGORIES = [
  { id: 'humanities', label: '人文', emoji: '📜' },
  { id: 'math_science', label: '數理', emoji: '🔬' },
  { id: 'project', label: '專題研究', emoji: '🧭' }
];
export const categoryOf = (id) => CATEGORIES.find((c) => c.id === id) || { id, label: id, emoji: '📘' };

export const MOOD_EMOJI = { interesting: '🤩', fun: '😆', happy: '😊', okay: '🙂', tired: '😪', boring: '😐' };

/** 預設設定（媽媽可在設定中修改） */
export const JOURNAL_DEFAULTS = {
  // 預設不開：媽媽在設定裡勾選孩子、填課表後才會出現
  kids: [],
  schedule: {},
  points: { basic: 1, advanced: 2, full: 3 },
  lateDeduct: 0,          // 補寫時少給幾點（預設 0：和當天相同）
  weeklyPoints: 3,        // 週末整理（第二階段）
  reminderTime: '18:30',
  lightWeekdays: [5],     // 輕鬆版的日子（只顯示基本版）
  hintWeeks: 2            // 第二階段：連續幾週出現類似回應時提示媽媽
};

export function journalSettings(settings) {
  const j = (settings && settings.journal) || {};
  return {
    ...JOURNAL_DEFAULTS, ...j,
    points: { ...JOURNAL_DEFAULTS.points, ...(j.points || {}) },
    schedule: { ...JOURNAL_DEFAULTS.schedule, ...(j.schedule || {}) }
  };
}

import { feature } from '../features.js';
export const usesJournal = (cfg, kidId) => feature('journal') && (cfg.kids || []).includes(kidId);

/** 某個孩子某一天的課：[{ category, count }]（同類別合併，依類別順序） */
export function classesOn(cfg, kidId, date) {
  const wd = weekday(date);
  const map = new Map();
  for (const c of (cfg.schedule && cfg.schedule[kidId]) || []) {
    if (Number(c.weekday) === wd && Number(c.count) > 0) map.set(c.category, (map.get(c.category) || 0) + Number(c.count));
  }
  return CATEGORIES.filter((c) => map.has(c.id)).map((c) => ({ category: c.id, count: map.get(c.id) }));
}
export const isClassDay = (cfg, kidId, date) => usesJournal(cfg, kidId) && classesOn(cfg, kidId, date).length > 0;
export const isLightDay = (cfg, date) => (cfg.lightWeekdays || []).includes(weekday(date));

/** 可以填寫（或補寫）的日子：本週、今天以前的上課日 */
export function writableDates(cfg, kidId, today) {
  const out = [];
  for (let d = weekStart(today); d <= today; d = addDays(d, 1)) if (isClassDay(cfg, kidId, d)) out.push(d);
  return out;
}
export const canWrite = (cfg, kidId, date, today) => date <= today && date >= weekStart(today) && isClassDay(cfg, kidId, date);

const filled = (s) => typeof s === 'string' && s.trim().length > 0;

/** 完成層級：只看有沒有填。基本＝心情＋學到；進階＝再加有趣或想知道；完整＝三項都填 */
export function levelOf(note) {
  if (!note || note.skipped || !note.mood || !filled(note.learned)) return null;
  const n = [note.interesting, note.question].filter(filled).length;
  return n === 2 ? 'full' : n === 1 ? 'advanced' : 'basic';
}

/** 這個層級應得的點數。onTheDay=false 是補寫 */
export function pointsFor(level, onTheDay, cfg) {
  if (!level) return 0;
  const p = Number(cfg.points[level]) || 0;
  return onTheDay ? p : Math.max(0, p - (Number(cfg.lateDeduct) || 0));
}

/** 文字裡出現的感受詞（觸發追問用）。回傳 feeling id 或 null */
const KEYWORDS = [['boring', ['無聊']], ['tired', ['累']], ['interesting', ['有趣']], ['fun', ['好玩']], ['happy', ['開心']], ['okay', ['還好']]];
export function feelingInText(text) {
  const t = String(text || '');
  for (const [id, words] of KEYWORDS) if (words.some((w) => t.includes(w))) return id;
  return null;
}

// ---------- 每一類課各自紀錄 ----------
// 新格式：note.classes = { 類別: { mood, moodDetail, followUpAnswer, boringReason, boringAnswer, learned, interesting, question, projectProgress } }
// 舊格式（最有印象的一堂寫在最外層＋「也想記另一堂」一句話）讀取時轉成新格式，已入帳的點數不變。
export const CLASS_FIELDS = ['mood', 'moodDetail', 'followUpAnswer', 'boringReason', 'boringAnswer', 'learned', 'interesting', 'question', 'projectProgress'];

/** 每一類課的紀錄。cats：那天的類別（舊格式沒有記錄類別時用第一個） */
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

/** 那天每一類課的完成層級：{ 類別: level|null } */
export function classLevels(note, cats) {
  const c = noteClasses(note, cats);
  return Object.fromEntries(cats.map((k) => [k, note && !note.skipped ? levelOf(c[k]) : null]));
}

/** 那天應得的點數（每一類課分開算再加總） */
export function notePoints(note, cats, onTheDay, cfg) {
  return Object.values(classLevels(note, cats)).reduce((s, lv) => s + pointsFor(lv, onTheDay, cfg), 0);
}

/** 那天寫了幾類課：{ written, total } */
export function dayProgress(note, cats) {
  return { written: Object.values(classLevels(note, cats)).filter(Boolean).length, total: cats.length };
}

/** 某天的類別 id */
export const catsOn = (cfg, kidId, date) => classesOn(cfg, kidId, date).map((c) => c.category);

/** 還可以寫的日子：沒寫、或還有某一堂沒寫（選了休息的不算） */
export function needsWriting(note, cats) {
  if (!note) return true;
  if (note.skipped) return false;
  return dayProgress(note, cats).written < cats.length;
}
