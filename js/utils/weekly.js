// 週末「記事錄整理」、媽媽的每週摘要、匯出的純邏輯（不碰資料庫，方便測試）
import { addDays, weekStart, weekday } from './date.js';
import { CATEGORIES, classesOn, levelOf, categoryOf } from './journal.js';

// journalPrompts.json 沒有這段時用的預設文字
export const WEEKLY_PAGE_DEFAULTS = {
  recallPrompts: ['這週的課，還記得老師講了什麼嗎？', '有沒有做了什麼活動、看了什麼影片或實驗？', '下課後有跟同學聊到這堂課嗎？聊了什麼？'],
  doneMessage: '整理好了！可以照著抄到記事錄上 ✍️'
};
export const weeklyPage = (prompts) => ({ ...WEEKLY_PAGE_DEFAULTS, ...((prompts && prompts.weeklyPage) || {}) });

/** 週末（週六、週日）才能送出整理 */
export const weekendOf = (week) => [addDays(week, 5), addDays(week, 6)];
export const isWeekend = (week, today) => today >= addDays(week, 5) && today <= addDays(week, 6);

/** 這週每個類別上了幾堂：[{ category, count, dates }]（依類別順序） */
export function weekClasses(cfg, kidId, week) {
  const map = new Map();
  for (let i = 0; i < 7; i++) {
    const d = addDays(week, i);
    for (const c of classesOn(cfg, kidId, d)) {
      const x = map.get(c.category) || { category: c.category, count: 0, dates: [] };
      x.count += c.count; x.dates.push(d);
      map.set(c.category, x);
    }
  }
  return CATEGORIES.filter((c) => map.has(c.id)).map((c) => map.get(c.id));
}

const inWeek = (date, week) => date >= week && date <= addDays(week, 6);

/** 這週和某個類別有關的小記內容（最有印象的那堂、或「也想記另一堂」） */
export function notesFor(notes, week, category) {
  return notes.filter((n) => inWeek(n.date, week) && !n.skipped && (n.memorable === category || n.extraCategory === category))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** 這週這個類別有沒有「覺得難／不感興趣」之類的回應 → 開頭句加入低壓力的選項 */
export function needsLowPressure(notes, week, category, prompts) {
  const ids = (prompts.starterRules && prompts.starterRules.lowPressureTriggerReasonIds) || [];
  return notes.some((n) => inWeek(n.date, week) && n.memorable === category && ids.includes(n.boringReason));
}

function shuffle(list, rng) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/**
 * 挑一組開頭句。shown：這個類別已經出現過的 id（換一組時不重複，全部用完再從頭）。
 * 類別自己的句子＋孩子自訂的句子優先，不夠再用 fallbackPools；盡量挑不同類型。
 * lowPressure=true 時，第一組一定有一句低壓力的。回傳 { list, reset }（reset=true 表示已經從頭開始）
 */
export function pickStarters({ prompts, category, customs = [], lowPressure = false, shown = new Set(), rng = Math.random }) {
  const rules = prompts.starterRules || {};
  const n = rules.showPerRound || 3;
  const pools = prompts.weeklyStarters || {};
  const primary = [...(pools[category] || []), ...customs.filter((c) => c.category === category).map((c) => ({ id: c.id, type: 'custom', text: c.text }))];
  const fbNames = (rules.fallbackPools || ['general', 'lowPressure']).filter((p) => p !== 'lowPressure' || lowPressure);
  const fallback = fbNames.flatMap((p) => pools[p] || []);
  const low = lowPressure ? (pools.lowPressure || []) : [];
  let reset = false;
  let avail = primary.filter((s) => !shown.has(s.id));
  let fbAvail = fallback.filter((s) => !shown.has(s.id));
  if (avail.length + fbAvail.length < n && shown.size) { reset = true; avail = primary; fbAvail = fallback; }
  const firstRound = !shown.size || reset;
  const cands = [
    ...(firstRound && low.length ? shuffle(low.filter((s) => !avail.includes(s)), rng).slice(0, 1) : []),
    ...shuffle(avail, rng), ...shuffle(fbAvail, rng)
  ];
  const seen = new Set(), types = new Set(), out = [];
  const take = (s) => { out.push(s); seen.add(s.id); types.add(s.type); };
  for (const s of cands) if (out.length < n && !seen.has(s.id) && (!(rules.preferDifferentTypes ?? true) || s.type === 'custom' || !types.has(s.type))) take(s);
  for (const s of cands) if (out.length < n && !seen.has(s.id)) take(s);
  return { list: out, reset };
}

/** 開頭句插進文字框：去掉結尾的「……」，讓孩子接著寫 */
export const starterInsert = (text) => String(text || '').replace(/[…\.]+$/, '');

// ---------- 媽媽的每週摘要 ----------
export function weekSummary(cfg, kidId, notes, week, today) {
  const classDates = [];
  for (let i = 0; i < 7; i++) { const d = addDays(week, i); if (d <= today && classesOn(cfg, kidId, d).length) classDates.push(d); }
  const by = new Map(notes.filter((n) => inWeek(n.date, week)).map((n) => [n.date, n]));
  const moods = {}, levels = {}, questions = [];
  let written = 0, skipped = 0, points = 0;
  for (const d of classDates) {
    const n = by.get(d);
    if (!n) continue;
    if (n.skipped) { skipped++; } else {
      const lv = levelOf(n);
      if (lv) { written++; levels[lv] = (levels[lv] || 0) + 1; }
      if (n.mood) moods[n.mood] = (moods[n.mood] || 0) + 1;
      if (n.question && n.question.trim()) questions.push({ date: d, category: n.memorable || '', text: n.question.trim() });
    }
    points += Number(n.awarded) || 0;
  }
  return { classDays: classDates.length, written, skipped, missing: classDates.length - written - skipped, moods, levels, points, questions };
}

/**
 * 連續幾週（含本週）同一類課都出現「不感興趣／不喜歡／跟不上」之類的回應 → 提示媽媽（只給媽媽看）。
 * 回傳 [{ category, weeks }]
 */
export function sensitiveHints(notes, today, prompts, weeks = 2) {
  const ids = (prompts.boringFlow && prompts.boringFlow.sensitiveReasonIds) || [];
  const out = [];
  if (!ids.length || !(weeks > 0)) return out;
  const w0 = weekStart(today);
  for (const c of CATEGORIES) {
    let ok = true;
    for (let i = 0; i < weeks && ok; i++) {
      const w = addDays(w0, -7 * i);
      ok = notes.some((n) => inWeek(n.date, w) && n.memorable === c.id && !n.skipped && ids.includes(n.boringReason));
    }
    if (ok) out.push({ category: c.id, weeks });
  }
  return out;
}

// ---------- 匯出 ----------
/** 學期：8/1–1/31、2/1–7/31 */
export function semesterRange(today) {
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
  if (m >= 8) return [`${y}-08-01`, `${y + 1}-01-31`];
  if (m === 1) return [`${y - 1}-08-01`, `${y}-01-31`];
  return [`${y}-02-01`, `${y}-07-31`];
}

const cell = (v) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export const toCsv = (rows) => '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';   // BOM：Excel 才會用 UTF-8 開

const WD = ['日', '一', '二', '三', '四', '五', '六'];
const LV = { basic: '基本', advanced: '進階', full: '完整' };

/** 每日小記 → CSV（from～to 之間，日期排序） */
export function notesCsv(notes, prompts, cfg, kidId, from, to) {
  const feel = (id) => ((prompts.feelings || []).find((f) => f.id === id) || {}).label || id || '';
  const reason = (id) => (((prompts.boringFlow || {}).reasons || []).find((r) => r.id === id) || {}).label || id || '';
  const cat = (id) => (id ? categoryOf(id).label : '');
  const rows = [['日期', '星期', '當天的課', '最有印象', '心情', '細分', '追問的回答', '無聊的原因', '無聊追問的回答', '學到', '有趣的是', '我想知道', '專題進度', '另一堂', '另一堂內容', '完成程度', '點數', '補寫', '休息', '媽媽留言']];
  for (const n of [...notes].filter((x) => x.date >= from && x.date <= to).sort((a, b) => a.date.localeCompare(b.date))) {
    rows.push([n.date, WD[weekday(n.date)], classesOn(cfg, kidId, n.date).map((c) => cat(c.category) + (c.count > 1 ? `×${c.count}` : '')).join('、'),
      cat(n.memorable), feel(n.mood), n.moodDetail, n.followUpAnswer, reason(n.boringReason), n.boringAnswer, n.learned, n.interesting, n.question,
      n.projectProgress, cat(n.extraCategory), n.extraText, LV[levelOf(n)] || '', n.awarded || 0, n.onTheDay === false ? '是' : '', n.skipped ? '是' : '', n.momComment]);
  }
  return toCsv(rows);
}

/** 記事錄整理 → CSV */
export function weekliesCsv(weeklies, from, to) {
  const rows = [['週（週一）', '類別', '內容', '已完成', '點數']];
  for (const w of [...weeklies].filter((x) => x.week >= addDays(from, -6) && x.week <= to).sort((a, b) => a.week.localeCompare(b.week))) {
    for (const c of CATEGORIES) {
      const t = (((w.sections || {})[c.id] || {}).text || '').trim();
      if (t) rows.push([w.week, c.label, t, w.status === 'done' ? '是' : '', w.awarded || 0]);
    }
  }
  return toCsv(rows);
}
