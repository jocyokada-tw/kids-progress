// 推播通知觸發條件的測試（直接呼叫函式，用 Firestore 模擬器；模擬器模式下不真的發送，而是寫到 _pushLog）
// 執行：先啟動 Firestore 模擬器，然後
//   cd functions && npm install && cd ../tests
//   GCLOUD_PROJECT=demo-kids FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FUNCTIONS_EMULATOR=true node --test functions.test.mjs
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fn from '../functions/index.js';
import { db, runPeriodic, tokensFor, taipeiNow, inQuiet, carryOverDay, afterSchoolList } from '../functions/core.js';
import { ttsHandler, ttsId, DAILY_CAP } from '../functions/tts.js';

const F = 'families/home';
const snap = (data) => ({ data: () => data });
const created = (params, data) => ({ params: { fid: 'home', ...params }, data: snap(data) });
const updated = (params, before, after) => ({ params: { fid: 'home', ...params }, data: { before: snap(before), after: snap(after) } });
const logs = async () => (await db.collection(`${F}/_pushLog`).get()).docs.map((d) => d.data());
const queue = async () => (await db.collection(`${F}/pushQueue`).get()).docs.map((d) => d.data());
const NO_QUIET = { quietStart: '00:00', quietEnd: '00:00' };

async function reset(notify = NO_QUIET) {
  await fetch('http://127.0.0.1:8080/emulator/v1/projects/demo-kids/databases/(default)/documents', { method: 'DELETE' });
  await db.doc(F).set({ setupBy: 'mom' });
  await db.doc(`${F}/members/kidA`).set({ name: '小明' });
  await db.doc(`${F}/members/kidB`).set({ name: '小美' });
  await db.doc(`${F}/meta/settings`).set({ notify });
}
beforeEach(() => reset());

test('勿擾時段判斷（可跨午夜）', () => {
  assert.equal(inQuiet('22:00', '22:00', '07:00'), true);
  assert.equal(inQuiet('03:00', '22:00', '07:00'), true);
  assert.equal(inQuiet('07:00', '22:00', '07:00'), false);
  assert.equal(inQuiet('21:59', '22:00', '07:00'), false);
  assert.equal(inQuiet('12:00', '12:00', '12:00'), false);
  assert.equal(taipeiNow(new Date('2026-11-09T14:05:00Z')).hm, '22:05');
});

test('通知送到正確的裝置：媽媽裝置、小孩裝置、共用裝置', async () => {
  await db.doc(`${F}/devices/mom`).set({ isMom: true, kids: ['kidA', 'kidB'] });
  await db.doc(`${F}/devices/a`).set({ isMom: false, kids: ['kidA'] });
  await db.doc(`${F}/devices/shared`).set({ isMom: false, kids: ['kidA', 'kidB'] });
  await db.doc(`${F}/devices/noToken`).set({ isMom: false, kids: ['kidB'] });
  for (const id of ['mom', 'a', 'shared']) await db.doc(`${F}/pushTokens/${id}`).set({ token: `t-${id}` });
  await db.doc(`${F}/pushTokens/ghost`).set({ token: 't-ghost' }); // 已移除的裝置
  const ids = async (who) => (await tokensFor('home', who)).map((t) => t.token).sort();
  assert.deepEqual(await ids('mom'), ['t-mom']);
  assert.deepEqual(await ids('kidA'), ['t-a', 't-shared']);
  assert.deepEqual(await ids('kidB'), ['t-shared']);
});

test('小孩自己排進度 → 通知媽媽；本週進度 → 通知小孩', async () => {
  await fn.onTaskCreated.run(created({ id: 't1' }, { kidId: 'kidA', date: '2026-11-10', title: '練琴', createdBy: 'kid', status: 'pending' }));
  await fn.onTaskCreated.run(created({ id: 't2' }, { kidId: 'kidA', kind: 'weekly', date: '', title: '數學習作', createdBy: 'mom', status: 'approved' }));
  await fn.onTaskCreated.run(created({ id: 't3' }, { kidId: 'kidA', date: '2026-11-10', title: '一般', createdBy: 'mom', status: 'approved' }));
  const l = await logs();
  assert.equal(l.length, 2);
  assert.deepEqual(l.find((x) => x.who === 'mom'), { ...l.find((x) => x.who === 'mom'), title: '📅 小明安排了新進度', body: '11/10 練琴' });
  assert.match(l.find((x) => x.who === 'kidA').title, /本週進度/);
});

test('媽媽確認／退回進度 → 通知小孩（附建議）', async () => {
  const base = { kidId: 'kidB', date: '2026-11-10', title: '國語', points: 2, momNote: '字再整齊一點' };
  await fn.onTaskUpdated.run(updated({ id: 't1' }, { ...base, status: 'pending' }, { ...base, status: 'approved' }));
  await fn.onTaskUpdated.run(updated({ id: 't2' }, { ...base, status: 'pending' }, { ...base, status: 'rejected' }));
  await fn.onTaskUpdated.run(updated({ id: 't3' }, { ...base, status: 'approved' }, { ...base, status: 'approved', date: '2026-11-11' }));
  let l = await logs();
  assert.equal(l.length, 2);
  // 媽媽把本週進度退回重排 → 通知小孩
  await fn.onTaskUpdated.run(updated({ id: 'w' }, { ...base, kind: 'weekly', status: 'approved' }, { ...base, kind: 'weekly', status: 'approved', date: '' }));
  l = await logs();
  assert.equal(l.length, 3);
  assert.ok(l.some((x) => x.title.includes('退回了本週進度')));
  l = l.filter((x) => !x.title.includes('退回了本週進度'));
  assert.ok(l.every((x) => x.who === 'kidB' && x.body.includes('字再整齊一點')));
});

test('勾選完成 → 媽媽收到「共有 N 項等你核可」（同一天同一個 tag）', async () => {
  for (const id of ['i1', 'i2']) await db.doc(`${F}/items/${id}`).set({ kidId: 'kidA', date: '2026-11-09', review: 'pending', title: id });
  await fn.onItemUpdated.run(updated({ id: 'i2' }, { kidId: 'kidA', date: '2026-11-09', review: 'none', title: '刷牙' }, { kidId: 'kidA', date: '2026-11-09', review: 'pending', title: '刷牙' }));
  const [m] = await logs();
  assert.equal(m.who, 'mom');
  assert.match(m.body, /共有 2 項/);
  assert.equal(m.tag, 'items-kidA-2026-11-09');
});

test('入帳、退回、獎勵 → 通知小孩', async () => {
  const it = { kidId: 'kidA', date: '2026-11-09', title: '刷牙', points: 1 };
  await fn.onItemUpdated.run(updated({ id: 'i1' }, { ...it, review: 'pending' }, { ...it, review: 'approved' }));
  await fn.onItemUpdated.run(updated({ id: 'i2' }, { ...it, review: 'pending' }, { ...it, review: 'returned', returnNote: '再刷一次' }));
  await fn.onLedgerCreated.run(created({ id: 'b' }, { kidId: 'kidA', type: 'bonus', amount: 5 }));
  await fn.onLedgerCreated.run(created({ id: 'x' }, { kidId: 'kidA', type: 'task', amount: 1 }));
  const l = await logs();
  assert.equal(l.length, 3);
  assert.ok(l.some((x) => x.title === '⭐ +1 點！'));
  assert.ok(l.some((x) => x.body.includes('再刷一次')));
  assert.ok(l.some((x) => x.title.includes('額外獎勵 +5')));
});

test('兌換申請 → 媽媽；核可 → 小孩', async () => {
  const r = { kidId: 'kidA', title: '看卡通', cost: 20 };
  await fn.onRedemptionCreated.run(created({ id: 'q' }, { ...r, status: 'pending' }));
  await fn.onRedemptionUpdated.run(updated({ id: 'q' }, { ...r, status: 'pending' }, { ...r, status: 'approved' }));
  await fn.onRedemptionUpdated.run(updated({ id: 'q2' }, { ...r, status: 'pending' }, { ...r, status: 'cancelled' }));
  const l = await logs();
  assert.equal(l.length, 2);
  assert.ok(l.some((x) => x.who === 'mom' && x.title.includes('小明想兌換')));
  assert.ok(l.some((x) => x.who === 'kidA' && x.title.includes('兌換成功')));
});

test('留言 → 通知對方', async () => {
  await fn.onMessageCreated.run(created({ kidId: 'kidB', id: 'm1' }, { from: 'kid', text: '媽媽我寫完了' }));
  await fn.onMessageCreated.run(created({ kidId: 'kidB', id: 'm2' }, { from: 'mom', text: '好棒' }));
  const l = await logs();
  assert.ok(l.some((x) => x.who === 'mom' && x.title === '💬 小美' && x.body === '媽媽我寫完了'));
  assert.ok(l.some((x) => x.who === 'kidB' && x.body === '好棒'));
});

test('媽媽關掉的通知類別不會送出', async () => {
  await reset({ ...NO_QUIET, mom: { message: false } });
  await fn.onMessageCreated.run(created({ kidId: 'kidA', id: 'm1' }, { from: 'kid', text: 'hi' }));
  await fn.onMessageCreated.run(created({ kidId: 'kidA', id: 'm2' }, { from: 'mom', text: 'hi' }));
  const l = await logs();
  assert.equal(l.length, 1);
  assert.equal(l[0].who, 'kidA');
});

test('勿擾時段：先排隊，時段結束後補發（同 tag 只發最新一則）', async () => {
  await reset({ quietStart: '00:00', quietEnd: '23:59' });
  await fn.onMessageCreated.run(created({ kidId: 'kidA', id: 'm1' }, { from: 'kid', text: '第一則' }));
  await fn.onMessageCreated.run(created({ kidId: 'kidA', id: 'm2' }, { from: 'kid', text: '第二則' }));
  await fn.onRedemptionCreated.run(created({ id: 'q' }, { kidId: 'kidA', title: '看卡通', cost: 20, status: 'pending' }));
  assert.equal((await logs()).length, 0);
  assert.equal((await queue()).length, 3);
  await runPeriodic(new Date('2026-11-09T04:00:00Z')); // 台灣 12:00，仍在勿擾時段
  assert.equal((await logs()).length, 0);
  await db.doc(`${F}/meta/settings`).set({ notify: { ...NO_QUIET, kid: { daily: false } } });
  await runPeriodic(new Date('2026-11-09T04:00:00Z'));
  const l = await logs();
  assert.equal(l.length, 2);
  assert.ok(l.some((x) => x.body === '第二則'));
  assert.ok(!l.some((x) => x.body === '第一則'));
  assert.equal((await queue()).length, 0);
});

test('每日提醒：到時間後，提醒還沒完成的項目與沒排的本週進度，每天只發一次', async () => {
  await reset({ ...NO_QUIET, dailyTime: '20:00' });
  const now = new Date('2026-11-09T12:30:00Z'); // 台灣 11/9（一）20:30
  await db.doc(`${F}/routines/r1`).set({ kidId: 'kidA', title: '刷牙', points: 1, weekdays: [1], active: true });
  await db.doc(`${F}/routines/r2`).set({ kidId: 'kidA', title: '閱讀', points: 1, weekdays: [1], active: true });
  await db.doc(`${F}/routines/r3`).set({ kidId: 'kidA', title: '週二才有', points: 1, weekdays: [2], active: true });
  await db.doc(`${F}/tasks/t1`).set({ kidId: 'kidA', date: '2026-11-09', title: '數學習作', status: 'approved' });
  await db.doc(`${F}/tasks/t2`).set({ kidId: 'kidA', date: '2026-11-09', title: '待確認的', status: 'pending' });
  await db.doc(`${F}/tasks/w1`).set({ kidId: 'kidA', kind: 'weekly', week: '2026-11-09', weekEnd: '2026-11-15', date: '', title: '英文', status: 'approved' });
  await db.doc(`${F}/items/kidA_2026-11-09_r1`).set({ kidId: 'kidA', date: '2026-11-09', sourceId: 'r1', done: true, review: 'pending' });
  await runPeriodic(new Date('2026-11-09T11:00:00Z')); // 19:00，還沒到
  assert.equal((await logs()).length, 0);
  await runPeriodic(now);
  await runPeriodic(new Date('2026-11-09T13:00:00Z')); // 21:00，不重複
  const l = await logs();
  assert.equal(l.length, 1);
  assert.equal(l[0].who, 'kidA');
  assert.equal(l[0].title, '🌙 今天還有 2 項沒完成，加油！');
  assert.match(l[0].body, /閱讀、數學習作/);
  assert.match(l[0].body, /本週還有 1 項進度沒排日期/);
});

test('每日提醒可以關閉', async () => {
  await reset({ ...NO_QUIET, dailyTime: '20:00', kid: { daily: false } });
  await db.doc(`${F}/routines/r1`).set({ kidId: 'kidA', title: '刷牙', points: 1, weekdays: [1], active: true });
  await runPeriodic(new Date('2026-11-09T12:30:00Z'));
  assert.equal((await logs()).length, 0);
});

// ---------- 雲端語音 ----------
test('雲端語音：只給已配對裝置、只接受英文，合成一次後走快取', async () => {
  await db.doc(`${F}/devices/a`).set({ isMom: false, kids: ['kidA'] });
  let calls = 0;
  const synth = async (t) => { calls++; return Buffer.from('mp3:' + t).toString('base64'); };
  await assert.rejects(ttsHandler({ uid: null, fid: 'home', text: 'apple' }, synth), /需要登入/);
  await assert.rejects(ttsHandler({ uid: 'stranger', fid: 'home', text: 'apple' }, synth), /尚未配對/);
  await assert.rejects(ttsHandler({ uid: 'a', fid: '../x', text: 'apple' }, synth), /fid/);
  for (const bad of ['', '   ', '蘋果', '<script>', '12345', 'a'.repeat(161)]) {
    await assert.rejects(ttsHandler({ uid: 'a', fid: 'home', text: bad }, synth), /文字格式不符/);
  }
  assert.equal(calls, 0);
  const r1 = await ttsHandler({ uid: 'a', fid: 'home', text: '  ice   cream ' }, synth);
  assert.equal(r1.cached, false);
  assert.equal(Buffer.from(r1.audio, 'base64').toString(), 'mp3:ice cream');
  const r2 = await ttsHandler({ uid: 'a', fid: 'home', text: 'ice cream' }, synth);
  assert.equal(r2.cached, true);
  assert.equal(r2.audio, r1.audio);
  assert.equal(calls, 1);
  for (const ok of ["I can't see anything.", 'a.m.', 'as ... as', 'x-ray', 'What a lovely day!', 'Taipei 101 is a skyscraper.']) {
    await ttsHandler({ uid: 'a', fid: 'home', text: ok }, synth);
  }
  assert.equal(calls, 7);
  assert.ok((await db.doc(`${F}/tts/${ttsId('ice cream')}`).get()).exists);
  assert.equal(ttsId('ice cream').length, 40);
});

test('雲端語音：超過每日上限就拒絕；隔天重新計算', async () => {
  await db.doc(`${F}/devices/a`).set({ isMom: false, kids: ['kidA'] });
  const today = taipeiNow().date;
  await db.doc(`${F}/meta/ttsUsage`).set({ date: today, chars: DAILY_CAP - 3 });
  const synth = async () => 'QUJD';
  await assert.rejects(ttsHandler({ uid: 'a', fid: 'home', text: 'apple' }, synth), /上限/);
  await ttsHandler({ uid: 'a', fid: 'home', text: 'cat' }, synth);
  await db.doc(`${F}/meta/ttsUsage`).set({ date: '2000-01-01', chars: DAILY_CAP });
  await ttsHandler({ uid: 'a', fid: 'home', text: 'apple' }, synth);
  assert.equal((await db.doc(`${F}/meta/ttsUsage`).get()).data().chars, 5);
});

// ---------- 自動順延 ----------
async function seedCarry() {
  const Y = '2026-11-11';   // 週三
  const t = (id, o) => db.doc(`${F}/tasks/${id}`).set({ kidId: 'kidA', date: Y, title: id, subject: '', points: 2, createdBy: 'mom', status: 'approved', momNote: '', ...o });
  const it = (id, o) => db.doc(`${F}/items/kidA_${Y}_${id}`).set({ kidId: 'kidA', date: Y, sourceType: 'task', sourceId: id, title: id, points: 2, done: false, review: 'none', ...o });
  await t('notOpened');                                      // 那天沒打開清單（沒有項目）→ 順延
  await t('notDone'); await it('notDone');                   // 沒勾 → 順延
  await t('returned'); await it('returned', { review: 'returned' });   // 被退回沒重做 → 順延
  await t('pending'); await it('pending', { done: true, review: 'pending' });     // 已勾待核可 → 不順延
  await t('approved'); await it('approved', { done: true, review: 'approved' }); // 已入帳 → 不順延
  await t('kidPending', { status: 'pending', createdBy: 'kid', points: 0 });     // 還沒確認的不動
  await t('weeklyMid', { kind: 'weekly', week: '2026-11-09', weekEnd: '2026-11-15' });
  await t('weeklyEnd', { kind: 'weekly', week: '2026-11-09', weekEnd: '2026-11-15', date: '2026-11-15' });
  await db.doc(`${F}/tasks/otherDay`).set({ kidId: 'kidA', date: '2026-11-10', title: 'otherDay', points: 1, status: 'approved' });
  return Y;
}

test('自動順延：沒完成的進度移到隔天，前一天留下「已順延」的項目', async () => {
  const Y = await seedCarry();
  const moved = await carryOverDay('home', Y);
  assert.deepEqual(moved.kidA.map((x) => x.title).sort(), ['notDone', 'notOpened', 'returned', 'weeklyMid']);
  const task = async (id) => (await db.doc(`${F}/tasks/${id}`).get()).data();
  const item = async (id, d = Y) => (await db.doc(`${F}/items/kidA_${d}_${id}`).get()).data();
  for (const id of ['notOpened', 'notDone', 'returned', 'weeklyMid']) {
    const t = await task(id);
    assert.equal(t.date, '2026-11-12', id);
    assert.deepEqual(t.carriedFrom, [Y]);
    assert.equal(t.carryCount, 1);
    const i = await item(id);
    assert.equal(i.missed, true, id); assert.equal(i.carriedTo, '2026-11-12');
  }
  assert.equal((await item('notOpened')).review, 'none');            // 沒有項目的會被建立
  for (const id of ['pending', 'approved', 'kidPending']) { assert.equal((await task(id)).date, Y, id); assert.equal((await task(id)).carryCount, undefined); }
  assert.equal((await task('otherDay')).date, '2026-11-10');
  // 週日那天的本週進度沒做 → 逾期未安排
  const m2 = await carryOverDay('home', '2026-11-15');
  assert.deepEqual(m2.kidA.map(({ title, to }) => ({ title, to })), [{ title: 'weeklyEnd', to: '' }]);
  assert.equal((await task('weeklyEnd')).date, '');
  assert.equal((await item('weeklyEnd', '2026-11-15')).carriedTo, 'overdue');
  // 再跑一次不會重複處理
  assert.deepEqual(await carryOverDay('home', Y), {});
});

test('自動順延：排程在隔天 0 點後執行一次、通知孩子與媽媽（勿擾時段排到早上）、可連續順延', async () => {
  await reset({ quietStart: '22:00', quietEnd: '07:00', kid: { daily: false } });
  const Y = await seedCarry();
  await db.doc(`${F}/meta/pushState`).set({ lastCarry: '2026-11-10' });
  await runPeriodic(new Date('2026-11-11T15:00:00Z'));   // 台灣 11/11 23:00：還沒過午夜，不處理 11/11
  assert.equal((await db.doc(`${F}/tasks/notDone`).get()).data().date, Y);
  await runPeriodic(new Date('2026-11-11T16:30:00Z'));   // 台灣 11/12 00:30
  assert.equal((await db.doc(`${F}/tasks/notDone`).get()).data().date, '2026-11-12');
  const q = await queue();
  assert.equal(q.length, 1);                              // 半夜只通知媽媽（排到早上）
  assert.ok(q.some((m) => m.who === 'mom' && m.title.includes('小明昨天有 4 項沒完成')));
  await runPeriodic(new Date('2026-11-11T17:00:00Z'));   // 同一晚再跑：不重複
  assert.equal((await queue()).length, 1);
  await runPeriodic(new Date('2026-11-11T23:00:00Z'));   // 台灣 07:00 → 補發
  assert.equal((await logs()).length, 1);
  await runPeriodic(new Date('2026-11-12T08:30:00Z'));   // 台灣 16:30 放學後 → 提醒孩子
  const kidMsg = (await logs()).find((m) => m.who === 'kidA');
  assert.ok(kidMsg && kidMsg.title.includes('昨天沒完成') && kidMsg.body.includes('notDone'), JSON.stringify(kidMsg));
  // 隔天又沒做 → 再順延一次
  await runPeriodic(new Date('2026-11-12T16:30:00Z'));
  const t = (await db.doc(`${F}/tasks/notDone`).get()).data();
  assert.equal(t.date, '2026-11-13'); assert.equal(t.carryCount, 2); assert.deepEqual(t.carriedFrom, [Y, '2026-11-12']);
});

test('自動順延：通知可以關閉；順延時不會另外發「媽媽退回本週進度」的通知', async () => {
  await reset({ ...NO_QUIET, mom: { carry: false }, kid: { carry: false, daily: false } });
  await seedCarry();
  await db.doc(`${F}/meta/pushState`).set({ lastCarry: '2026-11-10' });
  await runPeriodic(new Date('2026-11-11T16:30:00Z'));
  assert.equal((await logs()).length, 0);
  const before = { kidId: 'kidA', kind: 'weekly', status: 'approved', date: '2026-11-15', title: 'w', carryCount: 0 };
  await fn.onTaskUpdated.run(updated({ id: 'w' }, before, { ...before, date: '', carryCount: 1 }));
  assert.equal((await logs()).length, 0);
});

// ---------- 期限 ----------
test('放學後提醒：順延的作業與 2 天內到期的作業；已勾選的不提醒；每天一次', async () => {
  await reset({ ...NO_QUIET, afterSchoolTime: '16:30', kid: { daily: false } });
  const T = '2026-11-12';
  const t = (id, o) => db.doc(`${F}/tasks/${id}`).set({ kidId: 'kidA', title: id, points: 2, status: 'approved', createdBy: 'mom', momNote: '', ...o });
  await t('carried', { date: T, carriedFrom: ['2026-11-11'], carryCount: 1 });
  await t('dueTomorrow', { date: '2026-11-13', due: '2026-11-13' });
  await t('dueIn2', { kind: 'weekly', date: '', week: '2026-11-09', weekEnd: '2026-11-15', due: '2026-11-14' });
  await t('dueIn3', { date: '2026-11-15', due: '2026-11-15' });
  await t('dueDone', { date: T, due: '2026-11-13' });
  await db.doc(`${F}/items/kidA_${T}_dueDone`).set({ kidId: 'kidA', date: T, sourceId: 'dueDone', done: true, review: 'pending' });
  await t('dueApproved', { date: T, due: T, itemApproved: true });
  await t('otherKid', { kidId: 'kidB', date: T, due: T });
  const r = await afterSchoolList('home', 'kidA', T);
  assert.deepEqual(r.carried, ['carried']);
  assert.deepEqual(r.soon.map((x) => x.title), ['dueTomorrow', 'dueIn2']);
  await runPeriodic(new Date('2026-11-12T08:00:00Z'));   // 16:00 還沒到
  assert.equal((await logs()).length, 0);
  await runPeriodic(new Date('2026-11-12T08:30:00Z'));   // 16:30
  await runPeriodic(new Date('2026-11-12T09:00:00Z'));   // 17:00 不重複
  const l = await logs();
  assert.equal(l.filter((m) => m.who === 'kidA').length, 1);
  const m = l.find((x) => x.who === 'kidA');
  assert.equal(m.title, '📚 今天要先完成的作業');
  assert.match(m.body, /昨天沒完成：carried/);
  assert.match(m.body, /dueTomorrow（明天截止）/);
  assert.match(m.body, /dueIn2（後天截止）/);
  assert.equal(l.filter((x) => x.who === 'kidB').length, 1);   // 小美也有一項今天截止
});

test('過了期限還沒完成：照樣順延，期限當天結束時通知媽媽一次', async () => {
  await reset({ ...NO_QUIET, kid: { daily: false } });
  await db.doc(`${F}/members/kidA`).set({ name: '小明' });
  await db.doc(`${F}/tasks/p`).set({ kidId: 'kidA', date: '2026-11-13', due: '2026-11-13', title: '科展報告', points: 5, status: 'approved' });
  await db.doc(`${F}/meta/pushState`).set({ lastCarry: '2026-11-12', lastAfterSchool: '2026-11-14', lastDaily: '2026-11-14' });
  await runPeriodic(new Date('2026-11-13T16:30:00Z'));   // 台灣 11/14 00:30
  assert.equal((await db.doc(`${F}/tasks/p`).get()).data().date, '2026-11-14');
  const l = await logs();
  assert.ok(l.some((m) => m.who === 'mom' && m.title === '⚠️ 小明有 1 項作業過了期限' && m.body.includes('科展報告（11/13 截止）')), JSON.stringify(l));
  await runPeriodic(new Date('2026-11-14T16:30:00Z'));   // 隔天又沒做：再順延，但不再發過期通知
  assert.equal((await db.doc(`${F}/tasks/p`).get()).data().date, '2026-11-15');
  assert.equal((await logs()).filter((m) => m.title.includes('過了期限')).length, 1);
});
