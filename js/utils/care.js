// 照顧紀錄（只有媽媽看得到）的純邏輯：預設值、睡眠時數、早晚是否填完、CSV。
// 伺服器端 functions/care.js 的「早上／晚上是否填完」規則和這裡相同，tests/care.test.mjs 會比對。

/** 預設設定（存在 private/care，只有媽媽裝置讀得到） */
export const CARE_DEFAULTS = {
  kids: ['kidA'],
  morningTime: '07:30',
  eveningTime: '22:00',
  // 預設沒有藥物：在設定裡新增（藥名、用法、早上／睡前、要觀察的副作用）
  meds: []
};
export const WHEN_LABEL = { morning: '早上', bedtime: '睡前' };
export const SCORE_LABEL = { 1: '很差', 2: '不太好', 3: '普通', 4: '不錯', 5: '很好' };
export const SCORE_EMOJI = { 1: '😞', 2: '🙁', 3: '😐', 4: '🙂', 5: '😄' };

export function careSettings(c) {
  const x = c || {};
  return { ...CARE_DEFAULTS, ...x, kids: Array.isArray(x.kids) ? x.kids : CARE_DEFAULTS.kids, meds: Array.isArray(x.meds) ? x.meds : CARE_DEFAULTS.meds };
}
import { feature } from '../features.js';
export const usesCare = (cfg, kidId) => feature('care') && (cfg.kids || []).includes(kidId);
export const medsAt = (cfg, when) => (cfg.meds || []).filter((m) => m.when === when);
/** 所有藥物列出的副作用（不重複，照順序） */
export const watchItems = (cfg) => [...new Set((cfg.meds || []).flatMap((m) => m.sideEffects || []))];

const isHM = (s) => typeof s === 'string' && /^\d\d:\d\d$/.test(s);
const toMin = (hm) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));

/**
 * 睡了多久（分鐘）。上床時間記在上床那天的紀錄；中午以前的上床時間視為過了午夜。
 * 例：22:15 → 07:00 = 525；00:30 → 07:00 = 390。缺一個就回傳 null
 */
export function sleepMinutes(bed, wake) {
  if (!isHM(bed) || !isHM(wake)) return null;
  const b = toMin(bed) + (toMin(bed) < 12 * 60 ? 24 * 60 : 0);
  const w = toMin(wake) + 24 * 60;
  const d = w - b;
  return d > 0 && d < 20 * 60 ? d : null;
}
export const fmtDuration = (m) => (m == null ? '' : `${Math.floor(m / 60)} 小時${m % 60 ? ` ${m % 60} 分` : ''}`);

/** 早上那份填完了嗎：早上的藥都記了（吃了或沒吃） */
export const morningDone = (log, cfg) => medsAt(cfg, 'morning').every((m) => !!(log && log.meds && log.meds[m.id] && log.meds[m.id].status));
/** 晚上那份填完了嗎：睡前的藥都記了，情緒也打了分數 */
export const eveningDone = (log, cfg) => medsAt(cfg, 'bedtime').every((m) => !!(log && log.meds && log.meds[m.id] && log.meds[m.id].status))
  && !!(log && log.mood && log.mood.score);

// ---------- 匯出 ----------
const cell = (v) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const WD = ['日', '一', '二', '三', '四', '五', '六'];
const wdOf = (d) => WD[new Date(d + 'T00:00:00Z').getUTCDay()];

export function careCsv(logs, cfg, from, to) {
  const meds = cfg.meds || [];
  const items = watchItems(cfg);
  const head = ['日期', '星期', ...meds.flatMap((m) => [`${m.name}（${WHEN_LABEL[m.when] || m.when}）`, `${m.name} 時間`, `${m.name} 備註`]),
    '情緒分數', '情緒', '學習分數', '學習', ...items.map((x) => `觀察：${x}`), '觀察備註', '上床', '起床', '睡眠時數', '睡眠備註'];
  const rows = [head];
  for (const l of [...logs].filter((x) => x.date >= from && x.date <= to).sort((a, b) => a.date.localeCompare(b.date))) {
    const med = (m) => { const x = (l.meds || {})[m.id] || {}; return [x.status === 'taken' ? '有' : x.status === 'skipped' ? '沒有' : '', x.at || '', x.note || '']; };
    const obs = (l.observed && l.observed.list) || [];
    const s = l.sleep || {};
    const mins = sleepMinutes(s.bed, s.wake);
    rows.push([l.date, wdOf(l.date), ...meds.flatMap(med), (l.mood || {}).score || '', (l.mood || {}).note || '', (l.learning || {}).score || '', (l.learning || {}).note || '',
      ...items.map((x) => (obs.includes(x) ? '有' : '')), (l.observed || {}).note || '', s.bed || '', s.wake || '', mins == null ? '' : (mins / 60).toFixed(1), s.note || '']);
  }
  return '\ufeff' + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

// ---------- 文字摘要（傳 LINE 用） ----------
const MD = (d) => `${+d.slice(5, 7)}/${+d.slice(8, 10)}`;
const MDW = (d) => `${MD(d)}（${wdOf(d)}）`;
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const f1 = (x) => (x == null ? '–' : (Math.round(x * 10) / 10).toString());
const hmOf = (m) => { const x = ((Math.round(m) % 1440) + 1440) % 1440; return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`; };
const filledText = (s) => typeof s === 'string' && s.trim().length > 0;

/** 那天的情緒或學習有沒有特別紀錄：有寫文字，或分數 ≤ 2 */
export function isNotable(l) {
  const m = l.mood || {}, s = l.learning || {};
  return filledText(m.note) || filledText(s.note) || (m.score > 0 && m.score <= 2) || (s.score > 0 && s.score <= 2);
}
/** 某個藥那天的狀態：taken | skipped | ''（沒記錄） */
export const medStatus = (l, medId) => ((l && l.meds && l.meds[medId]) || {}).status || '';

/** 一天的一行（或兩行）文字 */
function dayLine(l, cfg, { withMeds = true } = {}) {
  const meds = cfg.meds || [];
  const parts = [];
  if (withMeds) parts.push(meds.map((m) => `${m.name}${{ taken: '✓', skipped: '✗' }[medStatus(l, m.id)] || '–'}`).join(' '));
  if (l.mood && l.mood.score) parts.push(`情緒${l.mood.score}`);
  if (l.learning && l.learning.score) parts.push(`學習${l.learning.score}`);
  const s = l.sleep || {};
  const mins = sleepMinutes(s.bed, s.wake);
  if (s.bed) parts.push(`睡${s.bed}–${s.wake || '?'}${mins != null ? `（${(mins / 60).toFixed(1)}h）` : ''}`);
  const notes = [];
  if (filledText((l.mood || {}).note)) notes.push(`情緒：${l.mood.note.trim()}`);
  if (filledText((l.learning || {}).note)) notes.push(`學習：${l.learning.note.trim()}`);
  const obs = (l.observed && l.observed.list) || [];
  if (obs.length || filledText((l.observed || {}).note)) notes.push(`觀察：${[obs.join('、'), (l.observed || {}).note].filter(filledText).join('，')}`);
  for (const m of meds) { const x = (l.meds || {})[m.id] || {}; if (x.status === 'skipped' && filledText(x.note)) notes.push(`沒${/噴/.test(m.name + m.dose) ? '噴' : '吃'}${m.name}：${x.note.trim()}`); }
  if (filledText(s.note)) notes.push(`睡眠：${s.note.trim()}`);
  return `${MDW(l.date)} ${parts.join(' ')}${notes.length ? `\n　└ ${notes.join('｜')}` : ''}`;
}

/**
 * 給 LINE 的文字摘要。
 * opts: { name, from, to, groupMed（用哪個藥分「有用藥／沒用藥」）, daily（是否附每日紀錄） }
 * 內容：① 區間重點統計 ② 有用藥時的特別紀錄 ③ 沒用藥時的特別紀錄（沒記錄用藥的另外列）④ 每日紀錄（選用）
 */
export function careReport(logs, cfg, { name = '', from, to, groupMed, daily = false }) {
  const list = [...logs].filter((l) => l.date >= from && l.date <= to).sort((a, b) => a.date.localeCompare(b.date));
  const days = Math.round((new Date(to + 'T00:00:00Z') - new Date(from + 'T00:00:00Z')) / 86400000) + 1;
  const meds = cfg.meds || [];
  const gm = meds.find((m) => m.id === groupMed) || meds.find((m) => m.when === 'morning') || meds[0] || null;
  const out = [`${name ? `${name} ` : ''}照顧紀錄 ${MD(from)}–${MD(to)}（${days} 天，有紀錄 ${list.length} 天）`];

  // ① 區間重點統計
  out.push('', '【重點統計】');
  for (const m of meds) {
    const taken = list.filter((l) => medStatus(l, m.id) === 'taken').length;
    const skipped = list.filter((l) => medStatus(l, m.id) === 'skipped');
    const none = days - taken - skipped.length;
    const v = /噴/.test(m.name + m.dose) ? '噴' : '吃';
    out.push(`💊 ${m.name}（${WHEN_LABEL[m.when] || m.when}）：${v}了 ${taken} 天${skipped.length ? `，沒${v} ${skipped.length} 天（${skipped.map((l) => MD(l.date)).join('、')}）` : ''}${none ? `，沒記錄 ${none} 天` : ''}`);
  }
  const moods = list.map((l) => (l.mood || {}).score).filter((x) => x > 0);
  const learns = list.map((l) => (l.learning || {}).score).filter((x) => x > 0);
  const lowMood = list.filter((l) => (l.mood || {}).score > 0).sort((a, b) => a.mood.score - b.mood.score)[0];
  out.push(`🙂 情緒：平均 ${f1(avg(moods))}${moods.length ? `（${moods.length} 天有分數）` : ''}${lowMood ? `，最低 ${lowMood.mood.score}（${MD(lowMood.date)}）` : ''}`);
  out.push(`📚 學習：平均 ${f1(avg(learns))}${learns.length ? `（${learns.length} 天有分數）` : ''}`);
  if (gm) {
    const on = list.filter((l) => medStatus(l, gm.id) === 'taken'), off = list.filter((l) => medStatus(l, gm.id) === 'skipped');
    const sc = (ls, k) => avg(ls.map((l) => (l[k] || {}).score).filter((x) => x > 0));
    if (on.length && off.length) out.push(`🔍 ${gm.name}：有用藥時 情緒 ${f1(sc(on, 'mood'))}、學習 ${f1(sc(on, 'learning'))}；沒用藥時 情緒 ${f1(sc(off, 'mood'))}、學習 ${f1(sc(off, 'learning'))}`);
  }
  const sl = list.map((l) => l.sleep || {}).filter((s) => sleepMinutes(s.bed, s.wake) != null);
  if (sl.length) {
    const bedM = avg(sl.map((s) => { const b = Number(s.bed.slice(0, 2)) * 60 + Number(s.bed.slice(3)); return b < 720 ? b + 1440 : b; }));
    const wakeM = avg(sl.map((s) => Number(s.wake.slice(0, 2)) * 60 + Number(s.wake.slice(3))));
    out.push(`😴 睡眠：平均 ${fmtDuration(Math.round(avg(sl.map((s) => sleepMinutes(s.bed, s.wake)))))}（上床約 ${hmOf(bedM)}，起床約 ${hmOf(wakeM)}，${sl.length} 晚）`);
  } else out.push('😴 睡眠：沒有完整的上床、起床紀錄');
  const items = watchItems(cfg);
  const obsCount = items.map((x) => [x, list.filter((l) => ((l.observed && l.observed.list) || []).includes(x)).length]).filter(([, n]) => n);
  out.push(`⚠️ 觀察到：${obsCount.length ? obsCount.map(([x, n]) => `${x} ${n} 天`).join('、') : '沒有'}`);

  // ②③ 依用藥分組的特別紀錄
  const notable = list.filter(isNotable);
  if (gm) {
    const sec = (title, ls) => out.push('', `【${title}】`, ...(ls.length ? ls.map((l) => dayLine(l, cfg)) : ['（沒有）']));
    sec(`有用${gm.name}時的特別紀錄`, notable.filter((l) => medStatus(l, gm.id) === 'taken'));
    sec(`沒用${gm.name}時的特別紀錄`, notable.filter((l) => medStatus(l, gm.id) === 'skipped'));
    const unknown = notable.filter((l) => !medStatus(l, gm.id));
    if (unknown.length) sec(`${gm.name}沒記錄的日子的特別紀錄`, unknown);
  } else {
    out.push('', '【特別紀錄】', ...(notable.length ? notable.map((l) => dayLine(l, cfg)) : ['（沒有）']));
  }
  out.push('（特別紀錄：情緒或學習有寫文字，或分數在 2 分以下）');

  // ④ 每日紀錄
  if (daily) out.push('', '【每日紀錄】', ...(list.length ? list.map((l) => dayLine(l, cfg)) : ['（沒有）']));
  return out.join('\n');
}
