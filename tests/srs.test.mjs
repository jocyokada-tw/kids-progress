// 每日單字邏輯測試：cd tests && node --test srs.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWords, wordsToText, planToday, nextProgress, sameSpelling, buildDict, INTERVALS,
  makeCloze, clozeAccepts, buildReviewQuestions, scrambleLetters, letterHint } from '../js/utils/srs.js';

const W = (...ws) => ws.map((w) => ({ w, zh: w + '中', ex: '' }));

test('解析貼上的單字：逗號、Tab、空白、全形逗號，略過重複與看不懂的行', () => {
  const { words, skipped } = parseWords(`apple, 蘋果, I eat an apple, every day.
banana\t香蕉
library 圖書館
ice cream　冰淇淋
don’t，不要
apple, 重複
May, 五月
may, 可以
as ... as, 和…一樣
蘋果
`);
  assert.deepEqual(words.map((x) => x.w), ['apple', 'banana', 'library', 'ice cream', "don't", 'May', 'may', 'as ... as']);
  assert.equal(words[0].ex, 'I eat an apple, every day.');
  assert.equal(words[2].zh, '圖書館');
  assert.equal(words[3].zh, '冰淇淋');
  assert.deepEqual(skipped, ['蘋果']);
  assert.deepEqual(parseWords(wordsToText(words)).words, words);
});

test('詞性：第二欄是 n.、v.、adj. 等縮寫時當成詞性，可省略、可多個', () => {
  const { words, skipped } = parseWords(`apple, n., 蘋果, I eat an apple.
brush\tN/V\t刷子、刷
quickly, adv, 很快地
a.m., abbr., 上午
banana, 香蕉, No pos here.
at the moment, phr., 此刻
v, 字母V`);
  assert.deepEqual(skipped, []);
  assert.deepEqual(words[0], { w: 'apple', pos: 'n.', zh: '蘋果', ex: 'I eat an apple.' });
  assert.deepEqual(words[1], { w: 'brush', pos: 'n./v.', zh: '刷子、刷', ex: '' });
  assert.equal(words[2].pos, 'adv.');
  assert.equal(words[3].pos, 'abbr.');
  assert.deepEqual(words[4], { w: 'banana', zh: '香蕉', ex: 'No pos here.' });
  assert.equal(words[5].pos, 'phr.');
  assert.deepEqual(words[6], { w: 'v', zh: '字母V', ex: '' });
  assert.deepEqual(parseWords(wordsToText(words)).words, words);
});

test('新單字：補習班優先，再用一般字庫補滿到每天的數量', () => {
  const lists = [
    { kind: 'general', words: W('g1', 'g2', 'g3', 'g4', 'g5', 'g6') },
    { kind: 'cram', testDate: '2026-11-18', words: W('c1', 'c2', 'c3') }
  ];
  const p = planToday(lists, {}, '2026-11-13', 5, { random: false });
  assert.deepEqual(p.newWords, ['c1', 'c2', 'c3', 'g1', 'g2']);
  assert.deepEqual(p.reviewWords, []);
});

test('考試日已過的補習班單字不再當新字', () => {
  const lists = [{ kind: 'cram', testDate: '2026-11-11', words: W('old') }, { kind: 'general', words: W('g1') }];
  assert.deepEqual(planToday(lists, {}, '2026-11-13', 5, { random: false }).newWords, ['g1']);
});

test('複習：只排到期的字，最久沒複習的排前面', () => {
  const lists = [{ kind: 'general', words: W('a', 'b', 'c', 'd') }];
  const progress = { a: { b: 1, d: '2026-11-13' }, b: { b: 2, d: '2026-11-10' }, c: { b: 3, d: '2026-11-20' } };
  const p = planToday(lists, progress, '2026-11-13', 5, { random: false });
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

test('拼字比對：不分大小寫、忽略「...」與多餘空白、彎引號', () => {
  assert.ok(sameSpelling(' MAY ', 'May'));
  assert.ok(sameSpelling('as as', 'as ... as'));
  assert.ok(sameSpelling('as...as', 'as ... as'));
  assert.ok(sameSpelling('ice  cream', 'ice cream'));
  assert.ok(sameSpelling('don’t', "don't"));
  assert.ok(sameSpelling('a.m.', 'a.m.'));
  assert.ok(!sameSpelling('am', 'a.m.'));
  assert.ok(!sameSpelling('xray', 'x-ray'));
  assert.ok(!sameSpelling('aple', 'apple'));
});

test('隨機抽選：一般字庫隨機、同一天結果固定、不同天不同、不重複抽已學過的；補習班仍照順序優先', () => {
  const g = Array.from({ length: 100 }, (_, i) => 'w' + String(i).padStart(3, '0'));
  const lists = [{ kind: 'general', words: W(...g) }, { kind: 'cram', testDate: '2026-11-18', words: W('c1', 'c2') }];
  const a = planToday(lists, {}, '2026-11-13', 5, { seed: 'kidA|2026-11-13' }).newWords;
  const a2 = planToday(lists, {}, '2026-11-13', 5, { seed: 'kidA|2026-11-13' }).newWords;
  const b = planToday(lists, {}, '2026-11-14', 5, { seed: 'kidA|2026-11-14' }).newWords;
  const k = planToday(lists, {}, '2026-11-13', 5, { seed: 'kidB|2026-11-13' }).newWords;
  assert.deepEqual(a.slice(0, 2), ['c1', 'c2']);
  assert.deepEqual(a, a2);
  assert.notDeepEqual(a, b);
  assert.notDeepEqual(a, k);
  assert.notDeepEqual(a.slice(2), ['w000', 'w001', 'w002']);
  assert.equal(new Set(a).size, 5);
  // 連續 20 天：每天 5 個，不重複，最後剛好學完 100 個
  const only = [{ kind: 'general', words: W(...g) }];
  const progress = {}; const seen = [];
  for (let d = 0; d < 20; d++) {
    const day = `2026-12-${String(d + 1).padStart(2, '0')}`;
    const nw = planToday(only, progress, day, 5, { seed: 'kidA|' + day }).newWords;
    assert.equal(nw.length, 5);
    nw.forEach((x) => { assert.ok(!progress[x]); progress[x] = { b: 0, d: '2099-01-01' }; seen.push(x); });
  }
  assert.equal(new Set(seen).size, 100);
  // 分布：前 5 天抽到的字不會都集中在字庫前段
  assert.ok(seen.slice(0, 25).some((x) => x > 'w050'));
});

test('自動補齊：補習班單字缺的詞性、例句、中文，從字庫帶過來；補習班自己寫的優先', () => {
  const flyers = { kind: 'general', words: [
    { w: 'library', pos: 'n.', zh: '圖書館', ex: 'We read books in the library.' },
    { w: 'bright', pos: 'adj.', zh: '明亮的、聰明的', ex: 'The sun is bright.' },
    { w: 'May', pos: 'n.', zh: '五月', ex: 'It is May.' },
    { w: 'only', pos: 'adv.', zh: '只有', ex: 'Only me.' }
  ] };
  const cram = { kind: 'cram', testDate: '2026-11-18', words: [
    { w: 'library', zh: '圖書館', ex: '' },
    { w: 'bright', zh: '聰明的', ex: 'She is a bright girl.' },
    { w: 'may', zh: '可以', ex: '' },
    { w: 'giraffe', zh: '', ex: '' }
  ] };
  const d = buildDict([flyers, cram]);
  assert.deepEqual(d.get('library'), { w: 'library', zh: '圖書館', ex: 'We read books in the library.', pos: 'n.' });
  assert.deepEqual(d.get('bright'), { w: 'bright', zh: '聰明的', ex: 'She is a bright girl.', pos: 'adj.' });
  assert.equal(d.get('may').pos, undefined);          // 大小寫不同是不同的字，不會拿 May 的資料來補
  assert.equal(d.get('May').zh, '五月');
  assert.deepEqual(d.get('giraffe'), { w: 'giraffe', zh: '', ex: '' });
  assert.equal(d.get('only').pos, 'adv.');
  assert.equal(cram.words[0].pos, undefined);         // 不會改到原本的字庫資料
  // planToday 用的是同一本字典；學過 library 之後，不會再從 Flyers 當新字抽出來
  const p = planToday([flyers, cram], {}, '2026-11-13', 5, { random: false });
  assert.equal(p.dict.get('library').pos, 'n.');
  assert.equal(p.newWords.filter((k) => k === 'library').length, 1);
});

test('例句填空：挖空、字尾留在畫面上、變化形整個挖掉、找不到就不出', () => {
  const c = (w, ex) => { const r = makeCloze(w, ex); return r && `${r.pre}___${r.suffix}${r.post}|${r.shown}`; };
  assert.equal(c('across', 'The bank is across the street.'), 'The bank is ___ the street.|across');
  assert.equal(c('appear', 'A rainbow appeared in the sky.'), 'A rainbow ___ed in the sky.|appeared');
  assert.equal(c('glove', 'I wear gloves in winter.'), 'I wear ___s in winter.|gloves');
  assert.equal(c('arrive', 'We are arriving now.'), 'We are ___ now.|arriving');
  assert.equal(c('hurry', 'She hurries to school.'), 'She ___ to school.|hurries');
  assert.equal(c('stop', 'He stopped the car.'), 'He ___ the car.|stopped');
  assert.equal(c('hurry', 'Hurry up or we will be late.'), '___ up or we will be late.|Hurry');
  assert.equal(c('look after', 'She looks after him.'), 'She ___ him.|looks after');
  assert.equal(c('May', 'My sister was born in May.'), 'My sister was born in ___.|May');
  assert.equal(c('May', 'You may go.'), null);                 // 專有名詞要大小寫相符
  assert.equal(c('art', 'We have a party and art class.'), 'We have a party and ___ class.|art');   // 不會挖到 party 裡的 art
  assert.equal(c('a.m.', 'I get up at 7 a.m. every day.'), 'I get up at 7 ___ every day.|a.m.');
  assert.equal(c('fall', 'Leaves fell down.'), null);
  assert.equal(c('as ... as', 'She is as tall as her mother.'), null);
  assert.equal(c('apple', 'Apple.'), null);
  assert.equal(c('apple', ''), null);
  const cz = makeCloze('appear', 'A rainbow appeared in the sky.');
  assert.ok(clozeAccepts('appear', 'appear', cz));
  assert.ok(clozeAccepts(' Appeared ', 'appear', cz));
  assert.ok(!clozeAccepts('appears', 'appear', cz));
  assert.ok(clozeAccepts('arriving', 'arrive', makeCloze('arrive', 'We are arriving now.')));
});

test('複習題型：每個字剛好一題、可關閉題型、快考試的補習班單字一律聽音拼字、配對一組 4～5 個', () => {
  const words = ['apple', 'banana', 'cherry', 'donut', 'eagle', 'flower', 'guitar', 'hammer', 'island', 'jacket'];
  const dict = new Map(words.map((w) => [w, { w, pos: 'n.', zh: w + '中', ex: `I like the ${w} very much.` }]));
  dict.set('look after', { w: 'look after', pos: 'phr.', zh: '照顧', ex: 'I look after him.' });
  dict.set('spend', { w: 'spend', pos: 'v.', zh: '花', ex: 'I spent ten dollars.' });
  const keys = [...dict.keys()];
  const progress = Object.fromEntries(keys.map((k, i) => [k, { b: i % 7 }]));
  const cover = (qs) => qs.flatMap((q) => q.ks || [q.k]).sort();
  const seenTypes = new Set();
  for (let i = 0; i < 200; i++) {
    const qs = buildReviewQuestions(keys, dict, progress);
    assert.deepEqual(cover(qs), [...keys].sort());
    for (const q of qs) {
      seenTypes.add(q.type);
      if (q.type === 'match') assert.ok(q.ks.length >= 4 && q.ks.length <= 5);
      if (q.type === 'scramble') assert.ok(/^[A-Za-z]{3,12}$/.test(q.k));          // 片語不出字母重組
      if (q.type === 'cloze' || q.type === 'clozeMc') assert.notEqual(q.k, 'spend'); // 例句是 spent，不能出填空
    }
  }
  assert.deepEqual([...seenTypes].sort(), ['cloze', 'clozeMc', 'listen', 'match', 'scramble', 'spell']);
  // 只開放例句填空（拼字）
  for (let i = 0; i < 50; i++) {
    const qs = buildReviewQuestions(keys, dict, progress, { enabled: ['cloze'] });
    assert.ok(qs.every((q) => q.type === 'cloze' || q.type === 'spell'));
    assert.equal(qs.find((q) => q.k === 'spend').type, 'spell');
  }
  // 全部關閉 → 只有看中文拼字
  assert.ok(buildReviewQuestions(keys, dict, progress, { enabled: [] }).every((q) => q.type === 'spell'));
  // 快考試的補習班單字一律聽音拼字，也不會被放進配對（即使媽媽把聽音拼字關掉）
  const dictation = new Set(['apple', 'banana', 'cherry']);
  for (let i = 0; i < 100; i++) {
    const qs = buildReviewQuestions(keys, dict, progress, { dictation, enabled: i % 2 ? ['match', 'scramble'] : undefined });
    assert.deepEqual(cover(qs), [...keys].sort());
    for (const k of dictation) assert.equal(qs.find((q) => q.k === k).type, 'listen');
  }
  // 字太少不出配對
  assert.ok(buildReviewQuestions(['apple', 'banana', 'cherry'], dict, progress).every((q) => q.type !== 'match'));
});

test('字母提示：只露出第一個字母', () => {
  const plain = (w) => letterHint(w).replace(/\u00a0/g, '~');
  assert.equal(plain('apple'), 'a _ _ _ _');
  assert.equal(plain('ice cream'), 'i _ _ ~~ _ _ _ _ _');
  assert.equal(plain('x-ray'), 'x - _ _ _');
  assert.equal(plain('a.m.'), 'a . _ .');
});

test('字母重組：字母相同、順序一定不同', () => {
  for (const w of ['cat', 'apple', 'library', 'aab']) {
    for (let i = 0; i < 30; i++) {
      const t = scrambleLetters(w);
      assert.equal([...t].sort().join(''), [...w].sort().join(''));
      assert.notEqual(t.join(''), w);
    }
  }
});

test('看提示才答對：熟練度不升級，照原本的間隔再複習；沒看提示照常升級；答錯仍回到隔天', () => {
  const today = '2026-11-13';
  const progress = { a: { b: 3, d: today, n: 4, x: 0 }, b: { b: 3, d: today, n: 4, x: 0 }, c: { b: 3, d: today, n: 4, x: 0 } };
  const patch = nextProgress({ newWords: [], reviewWords: ['a', 'b', 'c'] }, progress, new Set(['a', 'b']), today, new Set(['b', 'c']));
  assert.deepEqual([patch.a.b, patch.a.d], [4, '2026-11-28']);   // 沒看提示 → 升級，隔 15 天
  assert.deepEqual([patch.b.b, patch.b.d], [3, '2026-11-20']);   // 看了提示 → 維持，隔 7 天
  assert.deepEqual([patch.c.b, patch.c.d], [0, '2026-11-14']);   // 答錯 → 隔天
});
