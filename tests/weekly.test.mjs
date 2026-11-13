// 記事錄整理、每週摘要、匯出的邏輯測試：cd tests && node --test weekly.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { journalSettings } from '../js/utils/journal.js';
import { weekClasses, notesFor, needsLowPressure, pickStarters, starterInsert, weekSummary, sensitiveHints, semesterRange, notesCsv, weekliesCsv, isWeekend } from '../js/utils/weekly.js';

const prompts = JSON.parse(readFileSync(new URL('../data/journalPrompts.json', import.meta.url), 'utf8'));
const cfg = journalSettings({});
const W = '2026-11-09';   // 週一
let seed = 1;
const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

test('這週的課與週末', () => {
  assert.deepEqual(weekClasses(cfg, 'kidA', W).map((c) => [c.category, c.count]), [['humanities', 2], ['math_science', 2], ['project', 2]]);
  assert.deepEqual(weekClasses(cfg, 'kidB', W), []);
  assert.equal(isWeekend(W, '2026-11-13'), false);
  assert.equal(isWeekend(W, '2026-11-14'), true);
  assert.equal(isWeekend(W, '2026-11-15'), true);
  assert.equal(isWeekend(W, '2026-11-16'), false);
});

test('開頭句：一次 3 句、類型不同、換一組不重複、用完從頭；自訂的句子也會出現', () => {
  for (let k = 0; k < 20; k++) {
    const { list } = pickStarters({ prompts, category: 'math_science', rng });
    assert.equal(list.length, 3);
    assert.equal(new Set(list.map((s) => s.type)).size, 3);
    assert.ok(list.every((s) => s.id.startsWith('m')));
  }
  const shown = new Set();
  const seen = [];
  for (let r = 0; r < 2; r++) { const { list, reset } = pickStarters({ prompts, category: 'project', shown, rng }); assert.equal(reset, false); list.forEach((s) => { assert.ok(!shown.has(s.id)); shown.add(s.id); seen.push(s.id); }); }
  assert.equal(new Set(seen).size, 6);
  const third = pickStarters({ prompts, category: 'project', shown, rng });   // 類別用完 → 用通用的
  assert.ok(third.list.every((s) => s.id.startsWith('g')), JSON.stringify(third.list));
  const customs = [{ id: 'c1', category: 'humanities', text: '我自己的開頭……' }];
  let hit = false;
  for (let k = 0; k < 30 && !hit; k++) hit = pickStarters({ prompts, category: 'humanities', customs, rng }).list.some((s) => s.id === 'c1');
  assert.ok(hit);
  assert.equal(starterInsert('我發現了一個規律：……'), '我發現了一個規律：');
});

test('這週覺得難或沒興趣 → 第一組一定有低壓力的開頭句', () => {
  const notes = [{ date: '2026-11-10', memorable: 'math_science', mood: 'boring', boringReason: 'too_hard' }];
  assert.equal(needsLowPressure(notes, W, 'math_science', prompts), true);
  assert.equal(needsLowPressure(notes, W, 'project', prompts), false);
  assert.equal(needsLowPressure([{ ...notes[0], boringReason: 'already_know' }], W, 'math_science', prompts), false);
  for (let k = 0; k < 20; k++) {
    const { list } = pickStarters({ prompts, category: 'math_science', lowPressure: true, rng });
    assert.ok(list.some((s) => s.id.startsWith('l')), JSON.stringify(list));
  }
});

test('這週和某類課有關的小記：最有印象的、也想記另一堂的', () => {
  const notes = [
    { date: '2026-11-10', memorable: 'math_science', learned: 'a', extraCategory: 'project', extraText: 'b' },
    { date: '2026-11-12', memorable: 'humanities', learned: 'c' },
    { date: '2026-11-13', memorable: 'math_science', skipped: true },
    { date: '2026-11-03', memorable: 'math_science', learned: 'old' }
  ];
  assert.deepEqual(notesFor(notes, W, 'math_science').map((n) => n.learned), ['a']);
  assert.deepEqual(notesFor(notes, W, 'project').map((n) => n.extraText), ['b']);
});

test('每週摘要', () => {
  const notes = [
    { date: '2026-11-10', memorable: 'math_science', mood: 'fun', learned: 'a', question: '為什麼', awarded: 2 },
    { date: '2026-11-12', skipped: true },
    { date: '2026-11-03', mood: 'boring', learned: 'x', awarded: 1 }
  ];
  const s = weekSummary(cfg, 'kidA', notes, W, '2026-11-14');
  assert.deepEqual([s.classDays, s.written, s.skipped, s.missing, s.points], [3, 1, 1, 1, 2]);
  assert.deepEqual(s.moods, { fun: 1 });
  assert.deepEqual(s.questions, [{ date: '2026-11-10', category: 'math_science', text: '為什麼' }]);
  assert.equal(weekSummary(cfg, 'kidA', notes, W, '2026-11-10').classDays, 1);   // 還沒上的課不算
});

test('連續兩週同一類課都有「沒興趣／不喜歡／跟不上」→ 提示媽媽', () => {
  const n = (date, memorable, boringReason) => ({ date, memorable, mood: 'boring', boringReason, learned: 'x' });
  const notes = [n('2026-11-05', 'humanities', 'dislike'), n('2026-11-12', 'humanities', 'too_hard'), n('2026-11-10', 'math_science', 'not_interested'), n('2026-11-13', 'project', 'already_know'), n('2026-11-06', 'project', 'dislike')];
  assert.deepEqual(sensitiveHints(notes, '2026-11-14', prompts, 2), [{ category: 'humanities', weeks: 2 }]);
  assert.deepEqual(sensitiveHints(notes, '2026-11-14', prompts, 3), []);
  assert.deepEqual(sensitiveHints(notes, '2026-11-14', prompts, 1).map((h) => h.category), ['humanities', 'math_science']);
});

test('學期範圍與 CSV', () => {
  assert.deepEqual(semesterRange('2026-11-14'), ['2026-08-01', '2027-01-31']);
  assert.deepEqual(semesterRange('2027-01-10'), ['2026-08-01', '2027-01-31']);
  assert.deepEqual(semesterRange('2027-03-01'), ['2027-02-01', '2027-07-31']);
  const csv = notesCsv([
    { date: '2026-11-10', memorable: 'math_science', mood: 'boring', boringReason: 'too_hard', learned: '分數, "通分"', awarded: 1, onTheDay: false },
    { date: '2026-07-01', learned: 'old' }
  ], prompts, cfg, 'kidA', '2026-08-01', '2027-01-31');
  assert.ok(csv.startsWith('﻿日期,星期'));
  const lines = csv.trim().split('\r\n');
  assert.equal(lines.length, 2);
  assert.ok(lines[1].startsWith('2026-11-10,二,數理、專題研究,數理,無聊,,,這個有點難，我跟不太上,,"分數, ""通分""",'), lines[1]);
  assert.ok(lines[1].includes(',基本,1,是,,'));
  const w = weekliesCsv([{ week: W, status: 'done', awarded: 3, sections: { humanities: { text: '朝代' }, project: { text: ' ' } } }], '2026-08-01', '2027-01-31');
  assert.deepEqual(w.trim().split('\r\n').slice(1), ['2026-11-09,人文,朝代,是,3']);
});
