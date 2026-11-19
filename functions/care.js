// 照顧紀錄的早晚提醒（只發給媽媽）。設定在 private/care，紀錄在 momLogs/{kidId}_{日期}。
// 這是媽媽自己要收的提醒，所以不受勿擾時段限制（晚上 22:00 剛好是勿擾時段開始）。
import { db, deliver, kidName } from './core.js';

export const CARE_DEFAULTS = { kids: ['kidA'], morningTime: '07:30', eveningTime: '22:00', meds: [
  { id: 'concerta', name: '利長能', dose: '早上一顆', when: 'morning', sideEffects: ['胃口不佳', '情緒低落', '不易入睡'] },
  { id: 'avamys', name: '艾敏釋鼻用噴液懸浮劑', dose: '睡前兩個鼻孔各噴 2 下', when: 'bedtime', sideEffects: [] }
] };
export function careSettings(c) {
  const x = c || {};
  return { ...CARE_DEFAULTS, ...x, kids: Array.isArray(x.kids) ? x.kids : CARE_DEFAULTS.kids, meds: Array.isArray(x.meds) ? x.meds : CARE_DEFAULTS.meds };
}
const medsAt = (cfg, when) => (cfg.meds || []).filter((m) => m.when === when);
export const morningDone = (log, cfg) => medsAt(cfg, 'morning').every((m) => !!(log && log.meds && log.meds[m.id] && log.meds[m.id].status));
export const eveningDone = (log, cfg) => medsAt(cfg, 'bedtime').every((m) => !!(log && log.meds && log.meds[m.id] && log.meds[m.id].status))
  && !!(log && log.mood && log.mood.score);

/** 到了提醒時間、那份還沒填，就提醒媽媽一次（早晚各一次）。回傳送出的 [{ kidId, part }] */
export async function careReminder(fid, s, now) {
  if (s.mom.care === false) return [];
  const fam = db.doc(`families/${fid}`);
  const cfgDoc = await fam.collection('private').doc('care').get();
  if (!cfgDoc.exists) return [];                       // 媽媽還沒開啟照顧紀錄
  const cfg = careSettings(cfgDoc.data());
  const stateRef = fam.collection('meta').doc('pushState');
  const st = (await stateRef.get()).data() || {};
  const sent = [];
  for (const part of ['morning', 'evening']) {
    const key = part === 'morning' ? 'lastCareMorning' : 'lastCareEvening';
    const time = part === 'morning' ? cfg.morningTime : cfg.eveningTime;
    if (st[key] === now.date || now.hm < (time || '99:99')) continue;
    await stateRef.set({ [key]: now.date }, { merge: true });
    for (const kidId of cfg.kids || []) {
      const log = (await fam.collection('momLogs').doc(`${kidId}_${now.date}`).get()).data() || null;
      if (part === 'morning' ? morningDone(log, cfg) : eveningDone(log, cfg)) continue;
      const name = await kidName(fid, kidId);
      const meds = medsAt(cfg, part === 'morning' ? 'morning' : 'bedtime').map((m) => m.name);
      await deliver(fid, 'mom', part === 'morning'
        ? { title: `🩺 ${name}早上的紀錄`, body: `${meds.length ? `${meds.join('、')}吃了嗎？` : ''}也記一下昨晚幾點起床`, url: `#/k/${kidId}/care`, tag: `care-${kidId}` }
        : { title: `🩺 ${name}今天的紀錄`, body: `${meds.length ? `${meds.join('、')}用了嗎？` : ''}記一下情緒、學習和上床時間`, url: `#/k/${kidId}/care`, tag: `care-${kidId}` });
      sent.push({ kidId, part });
    }
  }
  return sent;
}
