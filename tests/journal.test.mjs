// 課後小記邏輯測試：cd tests && node --test journal.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JOURNAL_DEFAULTS as D, journalSettings, classesOn, isClassDay, isLightDay, writableDates, canWrite, levelOf, pointsFor, feelingInText, noteClasses, classLevels, notePoints, dayProgress, catsOn, needsWriting } from '../js/utils/journal.js';
import { levelOf as srvLevel, pointsFor as srvPoints, classDay as srvClassDay, classLevels as srvClassLevels, notePoints as srvNotePoints, catsOn as srvCatsOn } from '../functions/journal-logic.js';

const cfg = journalSettings({});
// 2026-11-10 週二、11-11 週三、11-12 週四、11-13 週五

test('預設課表：週二、四、五是上課日，其他不是；只有指定的孩子', () => {
  assert.deepEqual(classesOn(cfg, 'kidA', '2026-11-10'), [{ category: 'math_science', count: 1 }, { category: 'project', count: 1 }]);
  assert.deepEqual(classesOn(cfg, 'kidA', '2026-11-12'), [{ category: 'humanities', count: 2 }, { category: 'project', count: 1 }]);
  assert.deepEqual(classesOn(cfg, 'kidA', '2026-11-13'), [{ category: 'math_science', count: 1 }]);
  for (const d of ['2026-11-09', '2026-11-11', '2026-11-14', '2026-11-15']) assert.equal(isClassDay(cfg, 'kidA', d), false, d);
  assert.equal(isClassDay(cfg, 'kidB', '2026-11-10'), false);
  assert.equal(isLightDay(cfg, '2026-11-13'), true);
  assert.equal(isLightDay(cfg, '2026-11-12'), false);
});

test('補寫：同一週、今天以前的上課日', () => {
  assert.deepEqual(writableDates(cfg, 'kidA', '2026-11-12'), ['2026-11-10', '2026-11-12']);
  assert.equal(canWrite(cfg, 'kidA', '2026-11-10', '2026-11-15'), true);   // 週日還能補週二
  assert.equal(canWrite(cfg, 'kidA', '2026-11-13', '2026-11-16'), false);  // 下週一就不能補上週
  assert.equal(canWrite(cfg, 'kidA', '2026-11-13', '2026-11-12'), false);  // 未來
});

test('層級只看有沒有填', () => {
  assert.equal(levelOf({ mood: 'fun' }), null);
  assert.equal(levelOf({ learned: '分數' }), null);
  assert.equal(levelOf({ mood: 'fun', learned: '  ' }), null);
  assert.equal(levelOf({ mood: 'fun', learned: '分數' }), 'basic');
  assert.equal(levelOf({ mood: 'fun', learned: '分數', question: '為什麼' }), 'advanced');
  assert.equal(levelOf({ mood: 'fun', learned: '分數', interesting: '原來', question: '為什麼' }), 'full');
  assert.equal(levelOf({ mood: 'fun', learned: '分數', interesting: '原來', question: '為什麼', skipped: true }), null);
  // 專題的推進、追問不影響層級
  assert.equal(levelOf({ mood: 'tired', learned: 'x', projectProgress: 'y', followUpAnswer: 'z' }), 'basic');
});

test('點數：預設 1／2／3，補寫預設相同、可設定少給，不會變負數', () => {
  assert.deepEqual(['basic', 'advanced', 'full', null].map((l) => pointsFor(l, true, cfg)), [1, 2, 3, 0]);
  assert.deepEqual(['basic', 'full'].map((l) => pointsFor(l, false, cfg)), [1, 3]);
  const late = journalSettings({ journal: { lateDeduct: 1 } });
  assert.deepEqual(['basic', 'advanced', 'full'].map((l) => pointsFor(l, false, late)), [0, 1, 2]);
});

test('文字裡的感受詞', () => {
  assert.equal(feelingInText('今天很無聊'), 'boring');
  assert.equal(feelingInText('有點累'), 'tired');
  assert.equal(feelingInText('實驗好玩'), 'fun');
  assert.equal(feelingInText('學到分數'), null);
});

test('伺服器和網頁的規則一致', () => {
  const notes = [{}, { mood: 'fun', learned: 'a' }, { mood: 'x', learned: 'a', interesting: 'b' }, { mood: 'x', learned: 'a', interesting: 'b', question: 'c' }, { mood: 'x', learned: 'a', interesting: 'b', question: 'c', skipped: true }];
  for (const n of notes) assert.equal(srvLevel(n), levelOf(n));
  for (const s of [{}, { journal: { lateDeduct: 2, points: { basic: 2, advanced: 3, full: 5 } } }]) {
    const c = journalSettings(s);
    for (const l of ['basic', 'advanced', 'full', null]) for (const on of [true, false]) assert.equal(srvPoints(l, on, c), pointsFor(l, on, c));
  }
  for (const d of ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14']) assert.equal(srvClassDay(cfg, 'kidA', d), isClassDay(cfg, 'kidA', d), d);
});

test('兩類課各自紀錄、各自算點數；舊格式照樣讀得到', () => {
  const thu = catsOn(cfg, 'kidA', '2026-11-12');
  assert.deepEqual(thu, ['humanities', 'project']);
  const note = { classes: { humanities: { mood: 'fun', learned: 'a', interesting: 'b', question: 'c' }, project: { mood: 'okay', learned: 'd' } } };
  assert.deepEqual(classLevels(note, thu), { humanities: 'full', project: 'basic' });
  assert.equal(notePoints(note, thu, true, cfg), 4);
  assert.deepEqual(dayProgress(note, thu), { written: 2, total: 2 });
  const half = { classes: { humanities: { mood: 'fun', learned: 'a' }, project: { mood: 'okay' } } };
  assert.deepEqual(dayProgress(half, thu), { written: 1, total: 2 });
  assert.equal(needsWriting(half, thu), true);
  assert.equal(needsWriting(note, thu), false);
  assert.equal(needsWriting({ skipped: true }, thu), false);
  assert.equal(needsWriting(null, thu), true);
  assert.equal(notePoints({ ...note, skipped: true }, thu, true, cfg), 0);
  // 課表上沒有的類別不算
  assert.equal(notePoints({ classes: { math_science: { mood: 'fun', learned: 'x' } } }, thu, true, cfg), 0);
  // 舊格式：最有印象那堂照原本的層級；「另一堂一句話」沒有心情，不算點數
  const old = { memorable: 'humanities', mood: 'fun', learned: 'a', question: 'q', extraCategory: 'project', extraText: '一句話' };
  assert.deepEqual(noteClasses(old, thu), { humanities: { mood: 'fun', learned: 'a', question: 'q' }, project: { learned: '一句話', short: true } });
  assert.equal(notePoints(old, thu, true, cfg), 2);
  // 伺服器規則一致
  const late = journalSettings({ journal: { lateDeduct: 1 } });
  for (const n of [note, half, old, { skipped: true, ...note }]) {
    assert.deepEqual(srvClassLevels(n, thu), classLevels(n, thu));
    assert.equal(srvNotePoints(n, thu, false, late), notePoints(n, thu, false, late));
  }
  for (const d of ['2026-11-09', '2026-11-10', '2026-11-12', '2026-11-13']) assert.deepEqual(srvCatsOn(cfg, 'kidA', d), catsOn(cfg, 'kidA', d));
});
