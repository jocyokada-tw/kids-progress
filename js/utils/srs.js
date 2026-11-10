// 每日單字的純邏輯（不碰資料庫，方便測試）：解析貼上的單字、依遺忘曲線排複習
import { addDays } from './date.js';

/** 遺忘曲線：答對後隔幾天再複習（熟練度 0→6） */
export const INTERVALS = [1, 2, 4, 7, 15, 30, 60];
const MAX_REVIEW = 20;

// 分大小寫：May（五月）和 may（可以）是不同的字
export const wordKey = (w) => String(w || '').trim().replace(/\s+/g, ' ');

/** 拼字比對：不分大小寫，忽略「...」與多餘空白（as ... as 打成 as as 也算對），彎引號視為直引號 */
const normSpell = (s) => String(s || '').toLowerCase().replace(/[’`]/g, "'").replace(/\.{2,}|…/g, ' ').replace(/\s+/g, ' ').trim();
export const sameSpelling = (a, b) => normSpell(a) === normSpell(b);

/**
 * 把貼上的文字轉成單字。每行一個：「英文, 中文, 例句」（逗號、Tab、｜ 都可以；例句可省略），
 * 也接受「apple 蘋果」這種用空白分開的寫法。回傳 { words, skipped }
 */
export function parseWords(text) {
  const seen = new Set();
  const words = [];
  const skipped = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    let parts = line.split(/\t|\s*[,，|｜]\s*/);
    if (parts.length === 1) {
      const m = line.match(/^([A-Za-z][A-Za-z0-9'’ .\-/()?!]*?)\s+([^\x00-\x7F].*)$/);
      parts = m ? [m[1], m[2]] : [line];
    }
    const w = (parts[0] || '').trim().replace(/’/g, "'");
    const zh = (parts[1] || '').trim();
    const ex = parts.slice(2).join(', ').trim();
    const key = wordKey(w);
    if (!/^[A-Za-z]/.test(w) || w.length > 60) { skipped.push(line); continue; }
    if (seen.has(key)) continue;
    seen.add(key);
    words.push({ w, zh, ex });
  }
  return { words, skipped };
}
export const wordsToText = (words) => words.map((x) => [x.w, x.zh, x.ex].filter((v, i) => i < 2 || v).join(', ')).join('\n');

// ---------- 排出今天要學、要複習的字 ----------
/**
 * lists: [{ id, kind, testDate, words: [{w, zh, ex}] }]（只含這個小孩的字庫）
 * 回傳 { newWords: [key], reviewWords: [key], dict: Map(key → {w, zh, ex}) }
 */
export function planToday(lists, progress, today, perDay) {
  const dict = new Map();
  const ordered = [
    ...lists.filter((l) => l.kind === 'cram').sort((a, b) => (a.testDate || '9999').localeCompare(b.testDate || '9999')),
    ...lists.filter((l) => l.kind !== 'cram')
  ];
  ordered.forEach((l) => l.words.forEach((x) => { const k = wordKey(x.w); if (!dict.has(k)) dict.set(k, x); }));

  // 新單字：補習班單字優先（考試日還沒過的），再來是一般字庫
  const newWords = [];
  for (const l of ordered) {
    if (l.kind === 'cram' && l.testDate && l.testDate < today) continue;
    for (const x of l.words) {
      const k = wordKey(x.w);
      if (newWords.length < perDay && !progress[k] && !newWords.includes(k)) newWords.push(k);
    }
  }
  // 複習：到期的字；補習班考前一天與當天，整份都複習
  const forced = new Set();
  lists.filter((l) => l.kind === 'cram' && l.testDate && (l.testDate === today || l.testDate === addDays(today, 1)))
    .forEach((l) => l.words.forEach((x) => { const k = wordKey(x.w); if (progress[k]) forced.add(k); }));
  const due = Object.entries(progress).filter(([k, p]) => dict.has(k) && !forced.has(k) && p.d && p.d <= today)
    .sort((a, b) => a[1].d.localeCompare(b[1].d)).map(([k]) => k);
  let reviewWords = [...forced, ...due.slice(0, Math.max(0, MAX_REVIEW - forced.size))];
  // 今天沒有新字也沒有到期的字：挑 5 個最快到期的來複習
  if (!newWords.length && !reviewWords.length) {
    reviewWords = Object.entries(progress).filter(([k]) => dict.has(k))
      .sort((a, b) => (a[1].d || '').localeCompare(b[1].d || '')).slice(0, 5).map(([k]) => k);
  }
  return { newWords, reviewWords, dict };
}

/** 練習結束後計算新的進度。firstTryOk: Set(第一次就答對的字) */
export function nextProgress(session, progress, firstTryOk, today) {
  const patch = {};
  for (const k of session.newWords) {
    patch[k] = { b: 0, d: addDays(today, 1), n: 1, x: firstTryOk.has(k) ? 0 : 1, t: today };
  }
  for (const k of session.reviewWords) {
    const p = progress[k] || { b: 0, n: 0, x: 0, t: today };
    const ok = firstTryOk.has(k);
    const b = ok ? Math.min((p.b || 0) + 1, INTERVALS.length - 1) : 0;
    patch[k] = { ...p, b, d: addDays(today, ok ? INTERVALS[b] : 1), n: (p.n || 0) + 1, x: (p.x || 0) + (ok ? 0 : 1) };
  }
  return patch;
}

