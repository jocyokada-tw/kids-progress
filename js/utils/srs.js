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
 * 把貼上的文字轉成單字。每行一個：「英文, 詞性, 中文, 例句」（逗號、Tab、｜ 都可以；詞性與例句可省略），
 * 也接受「apple 蘋果」這種用空白分開的寫法。回傳 { words, skipped }
 */
// 詞性縮寫（可用 / 或 、 連接多個，例如 n./v.）
const POS_ONE = '(?:n|v|adj|adv|prep|conj|pron|det|art|aux|modal|num|int|interj|excl|phr|abbr)\\.?';
const POS_RE = new RegExp(`^${POS_ONE}(?:\\s*[/、&]\\s*${POS_ONE})*$`, 'i');
/** 統一寫法：小寫、每個縮寫後面加句點、用 / 連接 */
const normPos = (s) => s.toLowerCase().split(/\s*[/、&]\s*/).map((p) => p.replace(/\.$/, '') + '.').join('/');

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
    // 第二欄如果是詞性（n.、v.、adj.…），後面才是中文與例句
    const hasPos = parts.length >= 2 && POS_RE.test((parts[1] || '').trim());
    const pos = hasPos ? normPos(parts[1].trim()) : '';
    const rest = parts.slice(hasPos ? 2 : 1);
    const zh = (rest[0] || '').trim();
    const ex = rest.slice(1).join(', ').trim();
    const key = wordKey(w);
    if (!/^[A-Za-z]/.test(w) || w.length > 60) { skipped.push(line); continue; }
    if (seen.has(key)) continue;
    seen.add(key);
    words.push(pos ? { w, pos, zh, ex } : { w, zh, ex });
  }
  return { words, skipped };
}
export const wordsToText = (words) => words.map((x) => [x.w, ...(x.pos ? [x.pos] : []), x.zh, ...(x.ex ? [x.ex] : [])].join(', ')).join('\n');

// ---------- 排出今天要學、要複習的字 ----------
/**
 * lists: [{ id, kind, testDate, words: [{w, zh, ex}] }]（只含這個小孩的字庫）
 * 回傳 { newWords: [key], reviewWords: [key], dict: Map(key → {w, zh, ex}) }
 */
/**
 * 把一個小孩的所有字庫合成一本字典：Map(單字 → { w, pos, zh, ex })
 * 同一個字出現在好幾個字庫時，以補習班單字為主；它缺的詞性、中文、例句，自動從其他字庫補齊。
 */
export function buildDict(lists) {
  const ordered = [
    ...lists.filter((l) => l.kind === 'cram').sort((a, b) => (a.testDate || '9999').localeCompare(b.testDate || '9999')),
    ...lists.filter((l) => l.kind !== 'cram')
  ];
  const dict = new Map();
  for (const l of ordered) {
    for (const x of l.words) {
      const k = wordKey(x.w);
      const have = dict.get(k);
      if (!have) { dict.set(k, { ...x }); continue; }
      for (const f of ['pos', 'zh', 'ex']) if (!have[f] && x[f]) have[f] = x[f];
    }
  }
  return dict;
}

/** 依種子產生固定的亂數（同一個小孩同一天抽到的字相同，不會每次打開都變） */
function seededRandom(seed) {
  let h = 2166136261;
  for (const c of String(seed)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return () => {
    h += 0x6D2B79F5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffled(arr, rand) {
  const r = [...arr];
  for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; }
  return r;
}

/**
 * opts.random：一般字庫的新單字是否隨機抽選（預設是；補習班單字固定照順序）
 * opts.seed：亂數種子（通常是「小孩＋日期」）
 */
export function planToday(lists, progress, today, perDay, opts = {}) {
  const random = opts.random !== false;
  const rand = seededRandom(opts.seed || today);
  const dict = buildDict(lists);
  const ordered = [
    ...lists.filter((l) => l.kind === 'cram').sort((a, b) => (a.testDate || '9999').localeCompare(b.testDate || '9999')),
    ...lists.filter((l) => l.kind !== 'cram')
  ];

  // 新單字：補習班單字優先（考試日還沒過的），再來是一般字庫
  const newWords = [];
  for (const l of ordered) {
    if (l.kind === 'cram' && l.testDate && l.testDate < today) continue;
    const fresh = l.words.map((x) => wordKey(x.w)).filter((k) => !progress[k]);
    for (const k of (random && l.kind !== 'cram' ? shuffled(fresh, rand) : fresh)) {
      if (newWords.length < perDay && !newWords.includes(k)) newWords.push(k);
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

/**
 * 練習結束後計算新的進度。
 * firstTryOk: Set(第一次就答對的字)；hinted: Set(看過提示才答對的字，熟練度不升級、照原本的間隔再複習)
 */
export function nextProgress(session, progress, firstTryOk, today, hinted = new Set()) {
  const patch = {};
  for (const k of session.newWords) {
    patch[k] = { b: 0, d: addDays(today, 1), n: 1, x: firstTryOk.has(k) ? 0 : 1, t: today };
  }
  for (const k of session.reviewWords) {
    const p = progress[k] || { b: 0, n: 0, x: 0, t: today };
    const ok = firstTryOk.has(k);
    const b = !ok ? 0 : hinted.has(k) ? (p.b || 0) : Math.min((p.b || 0) + 1, INTERVALS.length - 1);
    patch[k] = { ...p, b, d: addDays(today, ok ? INTERVALS[b] : 1), n: (p.n || 0) + 1, x: (p.x || 0) + (ok ? 0 : 1) };
  }
  return patch;
}


// ---------- 例句填空 ----------
const reEsc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const CLEAN_SUFFIX = ['s', 'es', 'd', 'ed', 'ing', 'ly', 'er', 'est', 'r', 'n', "'s"];
const NOT_LETTER_BEFORE = '(?<![A-Za-z])';
const NOT_LETTER_AFTER = '(?![A-Za-z])';

/**
 * 把例句裡的單字挖空。回傳 { pre, suffix, post, shown } 或 null（例句裡找不到這個字）
 * - 字尾只是多了 s／ed／ing 等：只挖掉原形，字尾留在畫面上（A rainbow ______ed in the sky.）
 * - 去 e、重複字尾、y 變 i 等變化，或片語：整個挖掉（shown 是句子裡實際的寫法）
 * - 不規則變化（fall → fell）找不到，回傳 null，改出其他題型
 */
export function makeCloze(word, ex) {
  const w = String(word || '').trim();
  const s = String(ex || '');
  if (!w || !s || /\.\.\.|…/.test(w)) return null;
  const flags = /^[A-Z]/.test(w) ? '' : 'i';      // 專有名詞（May）要大小寫相符；一般的字句首大寫也算
  const parts = w.split(/\s+/);
  const out = (m, baseLen, suffix) => {
    const start = m.index;
    const r = { pre: s.slice(0, start), suffix: suffix || '', post: s.slice(start + m[0].length), shown: m[0] };
    if (baseLen != null) r.post = s.slice(start + baseLen + r.suffix.length);
    return /[A-Za-z]/.test(r.pre + r.post) ? r : null;
  };
  let m;
  if (parts.length === 1) {
    const b = reEsc(w);
    m = new RegExp(`${NOT_LETTER_BEFORE}(${b})(${CLEAN_SUFFIX.map(reEsc).join('|')})?${NOT_LETTER_AFTER}`, flags).exec(s);
    if (m) return out(m, m[1].length, m[2]);
    const last = w.slice(-1);
    const variants = [];
    if (/e$/i.test(w)) variants.push(`${reEsc(w.slice(0, -1))}(?:ing|ed|es|er|est)`);
    if (/y$/i.test(w)) variants.push(`${reEsc(w.slice(0, -1))}(?:ies|ied|ier|iest|ily)`);
    if (/[b-df-hj-np-tv-z]$/i.test(w)) variants.push(`${reEsc(w + last)}(?:ing|ed|er|est)`);
    for (const v of variants) {
      m = new RegExp(`${NOT_LETTER_BEFORE}${v}${NOT_LETTER_AFTER}`, flags).exec(s);
      if (m) return out(m);
    }
    return null;
  }
  const [first, ...rest] = parts.map(reEsc);
  m = new RegExp(`${NOT_LETTER_BEFORE}${first}(?:s|es|d|ed|ing)?\\s+${rest.join('\\s+')}${NOT_LETTER_AFTER}`, flags).exec(s);
  return m ? out(m) : null;
}

/** 例句填空的答案：原形、原形＋畫面上的字尾、句子裡實際的寫法都算對 */
export function clozeAccepts(answer, word, cz) {
  return sameSpelling(answer, word) || sameSpelling(answer, cz.shown) || (!!cz.suffix && sameSpelling(answer, word + cz.suffix));
}

// ---------- 複習的題型 ----------
// spell 看中文拼字｜cloze 例句填空（拼字）｜listen 聽音拼字｜clozeMc 例句填空（選擇）｜scramble 字母重組｜match 配對
export const REVIEW_TYPES = ['cloze', 'clozeMc', 'listen', 'scramble', 'match'];
// 依熟練度決定各題型出現的機會：剛學的字多給一點提示，熟的字提示少
const WEIGHTS = [
  { max: 1, w: { spell: 3, scramble: 3, clozeMc: 2, cloze: 1, listen: 0 } },
  { max: 3, w: { spell: 2, scramble: 1, clozeMc: 2, cloze: 3, listen: 1 } },
  { max: 99, w: { spell: 1, scramble: 0, clozeMc: 1, cloze: 3, listen: 3 } }
];

/**
 * 幫今天要複習的字各出一題。回傳 [{ type, k }]，配對題是 { type: 'match', ks: [...] }
 * opts.enabled：開放的題型（陣列，預設全部）；opts.dictation：一律出「聽音拼字」的字（快考試的補習班單字：考試是老師唸、孩子拼）
 */
export function buildReviewQuestions(keys, dict, progress, opts = {}) {
  const rand = opts.rand || Math.random;
  const enabled = new Set(['spell', ...(opts.enabled || REVIEW_TYPES)]);
  const dictation = opts.dictation || new Set();
  const pick = (weights) => {
    const entries = Object.entries(weights).filter(([, v]) => v > 0);
    let r = rand() * entries.reduce((a, [, v]) => a + v, 0);
    for (const [t, v] of entries) { r -= v; if (r < 0) return t; }
    return entries.length ? entries[entries.length - 1][0] : 'spell';
  };
  let rest = [...keys];
  const out = [];
  // 配對：挑 4～5 個有中文、中文不重複的字一起考
  if (enabled.has('match')) {
    const seenZh = new Set();
    const eligible = shuffled(rest.filter((k) => !dictation.has(k)), rand).filter((k) => {
      const zh = dict.get(k) && dict.get(k).zh;
      if (!zh || seenZh.has(zh)) return false;
      seenZh.add(zh);
      return true;
    });
    const groups = eligible.length >= 15 ? 2 : eligible.length >= 4 ? 1 : 0;
    for (let g = 0; g < groups; g++) {
      const ks = eligible.slice(g * 5, g * 5 + 5);
      if (ks.length < 4) break;
      out.push({ type: 'match', ks });
      rest = rest.filter((k) => !ks.includes(k));
    }
  }
  for (const k of rest) {
    if (dictation.has(k)) { out.push({ type: 'listen', k }); continue; }
    const x = dict.get(k);
    const b = (progress[k] && progress[k].b) || 0;
    const cz = makeCloze(x.w, x.ex);
    const avail = { spell: true, listen: true, cloze: !!cz, clozeMc: !!cz && dict.size >= 4, scramble: !!x.zh && /^[A-Za-z]{3,12}$/.test(x.w) };
    const w = {};
    for (const [t, v] of Object.entries(WEIGHTS.find((r) => b <= r.max).w)) {
      if (enabled.has(t) && avail[t]) w[t] = v;
    }
    if (!Object.values(w).some((v) => v > 0)) w.spell = 1;
    out.push({ type: pick(w), k });
  }
  return shuffled(out, rand);
}

/** 提示用：只露出第一個字母，其餘用底線表示（apple → a _ _ _ _；片語保留空白） */
export function letterHint(word) {
  let first = true;
  return [...String(word)].map((ch) => {
    if (!/[A-Za-z]/.test(ch)) return ch === ' ' ? '\u00a0\u00a0' : ch;
    if (first) { first = false; return ch; }
    return '_';
  }).join(' ');
}

/** 字母重組用：把字母打亂（保證和原本的順序不同） */
export function scrambleLetters(word, rand = Math.random) {
  const letters = [...word];
  for (let i = 0; i < 20; i++) {
    const s = shuffled(letters, rand);
    if (s.join('') !== word) return s;
  }
  return letters.reverse();
}
