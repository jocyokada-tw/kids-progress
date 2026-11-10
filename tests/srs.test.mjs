// 每日單字邏輯測試：cd tests && node --test srs.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWords, wordsToText, planToday, nextProgress, INTERVALS } from '../js/utils/srs.js';

const W = (...ws) => ws.map((w) => ({ w, zh: w + '中', ex: '' }));

test('解析貼上的單字：逗號、Tab、空白、全形逗號，略過重複與看不懂的行', () => {
  const { words, skipped } = parseWords(`apple, 蘋果, I eat an apple, every day.
banana\t香蕉
library 圖書館
ice cream　冰淇淋
don’t，不要
Apple, 重複
蘋果
`);
  assert.deepEqual(words.map((x) => x.w), ['apple', 'banana', 'library', 'ice cream', "don't"]);
  assert.equal(words[0].ex, 'I eat an apple, every day.');
  assert.equal(words[2].zh, '圖書館');
  assert.equal(words[3].zh, '冰淇淋');
  assert.deepEqual(skipped, ['蘋果']);
  assert.deepEqual(parseWords(wordsToText(words)).words, words);
});

test('新單字：補習班優先，再用一般字庫補滿到每天的數量', () => {
  const lists = [
    { kind: 'general', words: W('g1', 'g2', 'g3', 'g4', 'g5', 'g6') },
    { kind: 'cram', testDate: '2026-11-18', words: W('c1', 'c2', 'c3') }
  ];
  const p = planToday(lists, {}, '2026-11-13', 5);
  assert.deepEqual(p.newWords, ['c1', 'c2', 'c3', 'g1', 'g2']);
  assert.deepEqual(p.reviewWords, []);
});

test('考試日已過的補習班單字不再當新字', () => {
  const lists = [{ kind: 'cram', testDate: '2026-11-11', words: W('old') }, { kind: 'general', words: W('g1') }];
  assert.deepEqual(planToday(lists, {}, '2026-11-13', 5).newWords, ['g1']);
});

test('複習：只排到期的字，最久沒複習的排前面', () => {
  const lists = [{ kind: 'general', words: W('a', 'b', 'c', 'd') }];
  const progress = { a: { b: 1, d: '2026-11-13' }, b: { b: 2, d: '2026-11-10' }, c: { b: 3, d: '2026-11-20' } };
  const p = planToday(lists, progress, '2026-11-13', 5);
  assert.deepEqual(p.reviewWords, ['b', 'a']);
  assert.deepEqual(p.newWords, ['d']);
});

test('補習班考前一天與當天：學過的字整份複習（即使還沒到期）', () => {
  const lists = [{ kind: 'cram', testDate: '2026-11-18', words: W('c1', 'c2') }];
  const progress = { c1: { b: 3, d: '2026-11-30' }, c2: { b: 3, d: '2026-11-30' } };
  assert.deepEqual(planToday(lists, progress, '2026-11-17', 5).reviewWords, ['c1', 'c2']);
  assert.deepEqual(planToday(lists, progress, '2026-11-18', 5).reviewWords, ['c1', 'c2']);
  assert.deepEqual(planToday(lists, progress, '2026-11-19', 5).reviewWords.length, 2); // 沒新字也沒到期 → 挑最快到期的來練
});

test('遺忘曲線：答對就拉長間隔，答錯回到隔天', () => {
  const today = '2026-11-13';
  const session = { newWords: ['n1', 'n2'], reviewWords: ['r1', 'r2', 'r3'] };
  const progress = { r1: { b: 0, d: today, n: 1, x: 0 }, r2: { b: 3, d: today, n: 4, x: 1 }, r3: { b: 6, d: today, n: 9, x: 0 } };
  const patch = nextProgress(session, progress, new Set(['n1', 'r1', 'r3']), today);
  assert.deepEqual(patch.n1, { b: 0, d: '2026-11-14', n: 1, x: 0, t: today });
  assert.equal(patch.n2.x, 1);
  assert.deepEqual([patch.r1.b, patch.r1.d], [1, '2026-11-15']);            // 隔 2 天
  assert.deepEqual([patch.r2.b, patch.r2.d, patch.r2.x], [0, '2026-11-14', 2]); // 答錯 → 隔天
  assert.deepEqual([patch.r3.b, patch.r3.d], [6, '2027-01-12']);            // 最高熟練度，隔 60 天
  assert.deepEqual(INTERVALS, [1, 2, 4, 7, 15, 30, 60]);
});

test('一路答對的複習日期：隔 1、2、4、7、15、30、60 天', () => {
  let p = {}; let day = '2026-01-01';
  p = nextProgress({ newWords: ['w'], reviewWords: [] }, p, new Set(['w']), day);
  const gaps = [];
  for (let i = 0; i < 6; i++) {
    const prev = day; day = p.w.d;
    gaps.push(Math.round((new Date(day) - new Date(prev)) / 86400000));
    p = { w: nextProgress({ newWords: [], reviewWords: ['w'] }, p, new Set(['w']), day).w };
  }
  assert.deepEqual(gaps, [1, 2, 4, 7, 15, 30]);
});
