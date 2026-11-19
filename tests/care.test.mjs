// 照顧紀錄的邏輯測試：cd tests && node --test care.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { careSettings, sleepMinutes, fmtDuration, morningDone, eveningDone, watchItems, careCsv } from '../js/utils/care.js';
import { careSettings as srvSettings, morningDone as srvMorning, eveningDone as srvEvening } from '../functions/care.js';

const cfg = careSettings({});

test('預設：利長能（早上）、艾敏釋（睡前）；副作用清單', () => {
  assert.deepEqual(cfg.meds.map((m) => [m.name, m.when]), [['利長能', 'morning'], ['艾敏釋鼻用噴液懸浮劑', 'bedtime']]);
  assert.deepEqual(watchItems(cfg), ['胃口不佳', '情緒低落', '不易入睡']);
  assert.equal(cfg.morningTime, '07:30');
  assert.equal(cfg.eveningTime, '22:00');
  assert.deepEqual(srvSettings({}), cfg);
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
