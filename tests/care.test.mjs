// 照顧紀錄的邏輯測試：cd tests && node --test care.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { careSettings, sleepMinutes, fmtDuration, morningDone, eveningDone, watchItems, careCsv } from '../js/utils/care.js';
import { careSettings as srvSettings, morningDone as srvMorning, eveningDone as srvEvening } from '../functions/care.js';

// 預設沒有藥物；測試用兩種：早上一種（有副作用）、睡前一種
const MEDS = [
  { id: 'concerta', name: '利長能', dose: '早上一顆', when: 'morning', sideEffects: ['胃口不佳', '情緒低落', '不易入睡'] },
  { id: 'avamys', name: '艾敏釋鼻用噴液懸浮劑', dose: '睡前兩個鼻孔各噴 2 下', when: 'bedtime', sideEffects: [] }];
const cfg = careSettings({ meds: MEDS });

test('預設沒有藥物；設定的藥物與副作用清單', () => {
  assert.deepEqual(careSettings({}).meds, []);
  assert.deepEqual(srvSettings({}).meds, []);
  assert.deepEqual(cfg.meds.map((m) => [m.name, m.when]), [['利長能', 'morning'], ['艾敏釋鼻用噴液懸浮劑', 'bedtime']]);
  assert.deepEqual(watchItems(cfg), ['胃口不佳', '情緒低落', '不易入睡']);
  assert.equal(cfg.morningTime, '07:30');
  assert.equal(cfg.eveningTime, '22:00');
  assert.deepEqual(srvSettings({ meds: MEDS }), cfg);
});

test('睡眠時數：跨午夜、午夜後才睡、缺資料', () => {
  assert.equal(sleepMinutes('22:15', '07:00'), 525);
  assert.equal(sleepMinutes('00:30', '07:00'), 390);
  assert.equal(sleepMinutes('21:00', '06:30'), 570);
  assert.equal(sleepMinutes('22:00', ''), null);
  assert.equal(sleepMinutes('', '07:00'), null);
  assert.equal(fmtDuration(525), '8 小時 45 分');
  assert.equal(fmtDuration(480), '8 小時');
});

test('早上／晚上是否記好了（網頁和伺服器一致）', () => {
  const cases = [
    [null, false, false],
    [{ meds: { concerta: { status: 'taken' } } }, true, false],
    [{ meds: { concerta: { status: 'skipped' } } }, true, false],
    [{ meds: { concerta: { status: '' } } }, false, false],
    [{ meds: { avamys: { status: 'taken' } } }, false, false],
    [{ meds: { avamys: { status: 'taken' } }, mood: { score: 4 } }, false, true],
    [{ meds: { avamys: { status: 'taken' } }, mood: { score: 0 } }, false, false]
  ];
  for (const [log, m, e] of cases) {
    assert.equal(morningDone(log, cfg), m, JSON.stringify(log));
    assert.equal(eveningDone(log, cfg), e, JSON.stringify(log));
    assert.equal(srvMorning(log, cfg), m);
    assert.equal(srvEvening(log, cfg), e);
  }
});

test('CSV', () => {
  const csv = careCsv([
    { date: '2026-11-19', meds: { concerta: { status: 'taken', at: '07:42' }, avamys: { status: 'skipped', note: '忘了' } },
      mood: { score: 4, note: '開心' }, learning: { score: 3 }, observed: { list: ['胃口不佳'], note: '午餐吃一半' }, sleep: { bed: '22:15', wake: '07:00', note: '' } },
    { date: '2026-10-01', mood: { score: 1 } }
  ], cfg, '2026-11-01', '2026-11-30');
  const lines = csv.trim().split('\r\n');
  assert.ok(csv.startsWith('\ufeff日期,星期,利長能（早上）,利長能 時間,利長能 備註,艾敏釋鼻用噴液懸浮劑（睡前）'));
  assert.equal(lines.length, 2);
  assert.equal(lines[1], '2026-11-19,四,有,07:42,,沒有,,忘了,4,開心,3,,有,,,午餐吃一半,22:15,07:00,8.8,');
});

test('文字摘要：重點統計、有用藥／沒用藥時的特別紀錄、每日紀錄可選', async () => {
  const { careReport, isNotable } = await import('../js/utils/care.js');
  const T = { status: 'taken' };
  const logs = [
    { date: '2026-11-19', meds: { concerta: T, avamys: T }, mood: { score: 2, note: '下午有點低落' }, learning: { score: 4 }, observed: { list: ['胃口不佳'] }, sleep: { bed: '21:45', wake: '06:50' } },
    { date: '2026-11-20', meds: { concerta: { status: 'skipped', note: '忘了' }, avamys: T }, mood: { score: 4 }, learning: { score: 2, note: '分心' } },
    { date: '2026-11-21', meds: { concerta: T }, mood: { score: 3 }, learning: { score: 4 } },          // 沒有特別紀錄
    { date: '2026-11-22', mood: { score: 3, note: '去公園' } },                                         // 利長能沒記錄
    { date: '2026-10-01', meds: { concerta: T }, mood: { score: 1, note: '區間外' } }
  ];
  assert.deepEqual(logs.map(isNotable), [true, true, false, true, true]);
  const t = careReport(logs, cfg, { name: '小明', from: '2026-11-19', to: '2026-11-25', groupMed: 'concerta' });
  assert.match(t, /^小明 照顧紀錄 11\/19–11\/25（7 天，有紀錄 4 天）/);
  assert.match(t, /💊 利長能（早上）：吃了 2 天，沒吃 1 天（11\/20），沒記錄 4 天/);
  assert.match(t, /🙂 情緒：平均 3（4 天有分數），最低 2（11\/19）/);
  assert.match(t, /🔍 利長能：有用藥時 情緒 2\.5、學習 4；沒用藥時 情緒 4、學習 2/);
  assert.match(t, /⚠️ 觀察到：胃口不佳 1 天/);
  const sec = (title) => { const i = t.indexOf(`【${title}】`); assert.ok(i >= 0, title); return t.slice(i, t.indexOf('\n\n', i) > 0 ? t.indexOf('\n\n', i) : undefined); };
  assert.match(sec('有用利長能時的特別紀錄'), /11\/19（四）.*情緒2[\s\S]*情緒：下午有點低落｜觀察：胃口不佳/);
  assert.doesNotMatch(sec('有用利長能時的特別紀錄'), /11\/21/);
  assert.match(sec('沒用利長能時的特別紀錄'), /11\/20（五）[\s\S]*學習：分心｜沒吃利長能：忘了/);
  assert.match(sec('利長能沒記錄的日子的特別紀錄'), /11\/22（日）[\s\S]*去公園/);
  assert.doesNotMatch(t, /區間外/);
  assert.doesNotMatch(t, /【每日紀錄】/);
  const d = careReport(logs, cfg, { from: '2026-11-19', to: '2026-11-25', groupMed: 'concerta', daily: true });
  assert.match(d, /【每日紀錄】[\s\S]*11\/21（六） 利長能✓ 艾敏釋鼻用噴液懸浮劑– 情緒3 學習4/);
  // 沒有藥物時也能產生
  assert.match(careReport(logs, careSettings({}), { from: '2026-11-19', to: '2026-11-25' }), /【特別紀錄】/);
});
