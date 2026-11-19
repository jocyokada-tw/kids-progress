// 照顧紀錄（只有媽媽看得到）的純邏輯：預設值、睡眠時數、早晚是否填完、CSV。
// 伺服器端 functions/care.js 的「早上／晚上是否填完」規則和這裡相同，tests/care.test.mjs 會比對。

/** 預設設定（存在 private/care，只有媽媽裝置讀得到） */
export const CARE_DEFAULTS = {
  kids: ['kidA'],
  morningTime: '07:30',
  eveningTime: '22:00',
  meds: [
    { id: 'concerta', name: '利長能', dose: '早上一顆', when: 'morning', sideEffects: ['胃口不佳', '情緒低落', '不易入睡'] },
    { id: 'avamys', name: '艾敏釋鼻用噴液懸浮劑', dose: '睡前兩個鼻孔各噴 2 下', when: 'bedtime', sideEffects: [] }
  ]
};
export const WHEN_LABEL = { morning: '早上', bedtime: '睡前' };
export const SCORE_LABEL = { 1: '很差', 2: '不太好', 3: '普通', 4: '不錯', 5: '很好' };
export const SCORE_EMOJI = { 1: '😞', 2: '🙁', 3: '😐', 4: '🙂', 5: '😄' };

export function careSettings(c) {
  const x = c || {};
  return { ...CARE_DEFAULTS, ...x, kids: Array.isArray(x.kids) ? x.kids : CARE_DEFAULTS.kids, meds: Array.isArray(x.meds) ? x.meds : CARE_DEFAULTS.meds };
}
export const usesCare = (cfg, kidId) => (cfg.kids || []).includes(kidId);
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
