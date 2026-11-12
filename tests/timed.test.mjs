// 指定完成時間的判斷：cd tests && node --test timed.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { taipeiStamp, isLateDone, isOverdueNow, latePoints, isTime } from '../js/utils/timed.js';

const at = (iso) => new Date(iso);   // UTC；台灣時間 = +8
const ts = (iso) => ({ toDate: () => at(iso) });

test('台灣時間', () => {
  assert.equal(taipeiStamp(at('2026-11-12T10:29:00Z')), '2026-11-12 18:29');
  assert.equal(taipeiStamp(ts('2026-11-12T16:05:00Z')), '2026-11-13 00:05');
});

test('準時與逾時（以送出時間判斷）', () => {
  const it = { date: '2026-11-12', dueTime: '18:30', done: true, review: 'pending' };
  assert.equal(isLateDone({ ...it, doneAt: ts('2026-11-12T10:00:00Z') }), false);   // 18:00
  assert.equal(isLateDone({ ...it, doneAt: ts('2026-11-12T10:30:59Z') }), false);   // 18:30 整也算準時
  assert.equal(isLateDone({ ...it, doneAt: ts('2026-11-12T10:31:00Z') }), true);    // 18:31
  assert.equal(isLateDone({ ...it, doneAt: ts('2026-11-12T12:00:00Z') }), true);    // 20:00
  assert.equal(isLateDone({ ...it, doneAt: ts('2026-11-13T01:00:00Z') }), true);    // 隔天補做
  assert.equal(isLateDone({ ...it, dueTime: '', doneAt: ts('2026-11-12T12:00:00Z') }), false);  // 沒指定時間
  assert.equal(isLateDone({ ...it, done: false, review: 'none' }), false);          // 還沒送出
  assert.equal(isLateDone({ ...it, review: 'approved', late: false, doneAt: ts('2026-11-12T12:00:00Z') }), false);  // 核可時的判定為準
});

test('還沒送出、已經過了時間', () => {
  const it = { date: '2026-11-12', dueTime: '18:30', done: false, review: 'none' };
  assert.equal(isOverdueNow(it, at('2026-11-12T10:00:00Z')), false);
  assert.equal(isOverdueNow(it, at('2026-11-12T10:31:00Z')), true);
  assert.equal(isOverdueNow({ ...it, done: true, review: 'pending' }, at('2026-11-12T12:00:00Z')), false);
  assert.equal(isOverdueNow({ ...it, dueTime: '' }, at('2026-11-12T12:00:00Z')), false);
});

test('逾時點數：一半，無條件捨去', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(latePoints), [0, 0, 1, 1, 2, 2]);
  assert.ok(isTime('18:30')); assert.ok(!isTime('25:00')); assert.ok(!isTime(''));
});
