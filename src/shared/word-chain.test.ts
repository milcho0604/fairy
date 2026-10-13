import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type ChainState,
  chainCoinsAllowed,
  chainExpired,
  chainTurn,
  dueum,
  isChainStart,
  isGiveUp,
  pickWord,
  readWord,
  startChain,
  startChars,
  WORD_CHAIN,
} from './word-chain.ts';
import { EN_WORDS, KO_WORDS } from './word-chain-words.ts';

const first = () => 0;
const ko = (last: string, used: string[] = [last], turns = 0): ChainState => ({
  lang: 'ko',
  used,
  last,
  turns,
  at: 0,
});

test('두음법칙: ㄹ 은 ㅇ 이나 ㄴ 으로, ㄴ 은 ㅇ 으로 (받침은 그대로)', () => {
  assert.equal(dueum('력'), '역');
  assert.equal(dueum('리'), '이');
  assert.equal(dueum('료'), '요');
  assert.equal(dueum('류'), '유');
  assert.equal(dueum('례'), '예');
  assert.equal(dueum('라'), '나');
  assert.equal(dueum('래'), '내');
  assert.equal(dueum('로'), '노');
  assert.equal(dueum('뢰'), '뇌');
  assert.equal(dueum('루'), '누');
  assert.equal(dueum('름'), '늠');
  assert.equal(dueum('녀'), '여');
  assert.equal(dueum('뇨'), '요');
  assert.equal(dueum('뉴'), '유');
  assert.equal(dueum('니'), '이');
  // 바뀌지 않는 것
  for (const ch of ['나', '노', '과', '기', '루a', 'a', '', 'ㄹ']) assert.equal(dueum(ch), undefined, ch);
  assert.deepEqual(startChars('력', 'ko'), ['력', '역']);
  assert.deepEqual(startChars('과', 'ko'), ['과']);
  assert.deepEqual(startChars('e', 'en'), ['e']);
});

test('말 읽기: 한국어는 한글 두 글자 넘게, 영어는 알파벳만 (끝 문장 부호는 뗀다)', () => {
  assert.deepEqual(readWord(' 사과! ', 'ko'), { kind: 'word', word: '사과' });
  assert.deepEqual(readWord('과자~', 'ko'), { kind: 'word', word: '과자' });
  assert.deepEqual(readWord('과', 'ko'), { kind: 'short' });
  assert.deepEqual(readWord('사과 줘', 'ko'), { kind: 'other' });
  assert.deepEqual(readWord('오늘 뭐부터 할까?', 'ko'), { kind: 'other' });
  assert.deepEqual(readWord('apple', 'ko'), { kind: 'other' });
  assert.deepEqual(readWord('ㅋㅋㅋ', 'ko'), { kind: 'other' });
  assert.deepEqual(readWord('가나다라마바사아자', 'ko'), { kind: 'other' });
  assert.deepEqual(readWord('Apple!', 'en'), { kind: 'word', word: 'apple' });
  assert.deepEqual(readWord('a', 'en'), { kind: 'short' });
  assert.deepEqual(readWord('ice cream', 'en'), { kind: 'other' });
  assert.deepEqual(readWord('사과', 'en'), { kind: 'other' });
});

test('시작하자는 말과 그만하자는 말', () => {
  for (const s of [
    '끝말잇기',
    '끝말 잇기 하자!',
    '끝말잇기 할래?',
    '끝말잇기ㄱㄱ',
    'word chain',
    "Let's play word chain!",
  ])
    assert.ok(isChainStart(s), s);
  for (const s of ['끝말잇기 규칙이 뭐야?', '사과', 'chain', '']) assert.equal(isChainStart(s), false, s);
  for (const s of ['그만', '몰라!', '졌다', '항복', 'stop', 'I give up', 'idk']) assert.ok(isGiveUp(s), s);
  for (const s of ['그만두기', '사과', 'stopwatch']) assert.equal(isGiveUp(s), false, s);
});

test('맞는 말이면 펫이 끝 글자로 잇는다. 사용자 말과 펫 말이 다 나온 말에 든다', () => {
  const step = chainTurn(ko('사과'), '과자', ['자두', '과자', '두부'], first, 5);
  assert.equal(step.kind, 'next');
  if (step.kind !== 'next') return;
  assert.equal(step.word, '자두');
  assert.deepEqual(step.need, ['두']);
  assert.deepEqual(step.state.used, ['사과', '과자', '자두']);
  assert.equal(step.state.last, '자두');
  assert.equal(step.state.turns, 1);
  assert.equal(step.state.at, 5);
});

test('두음법칙으로 이어도 된다 (력 → 역사), 펫도 두음으로 잇는다', () => {
  const s = ko('달력');
  const step = chainTurn(s, '역사', ['사자'], first, 1);
  assert.equal(step.kind, 'next');
  // 펫이 "리"로 끝나면 사용자는 "이"로
  const s2 = ko('다리');
  assert.equal(chainTurn(s2, '이불', ['불꽃'], first, 1).kind, 'next');
  // 펫 차례: 사용자가 "라"로 끝내면 펫은 "나"로 시작하는 말도 쓴다
  const step3 = chainTurn(ko('기차'), '차라', ['나무'], first, 1);
  assert.equal(step3.kind, 'next');
  if (step3.kind === 'next') assert.equal(step3.word, '나무');
});

test('틀린 첫 글자, 이미 나온 말, 한 글자는 다시 기회 (판은 그대로, 시각만)', () => {
  const s = ko('사과', ['사과', '과자', '자두', '두부'], 2);
  const wrong = chainTurn({ ...s, last: '두부' }, '사자', KO_WORDS, first, 9);
  assert.equal(wrong.kind, 'wrongStart');
  if (wrong.kind === 'wrongStart') {
    assert.deepEqual(wrong.need, ['부']);
    assert.equal(wrong.state.at, 9);
    assert.equal(wrong.state.turns, 2);
  }
  const used = chainTurn({ ...s, last: '자두' }, '두부', KO_WORDS, first, 9);
  assert.equal(used.kind, 'used');
  const short = chainTurn(s, '과', KO_WORDS, first, 9);
  assert.equal(short.kind, 'short');
});

test('말이 아니면 판을 떠나고 (보통 대화), 그만이면 펫이 이긴다', () => {
  assert.equal(chainTurn(ko('사과'), '오늘 날씨 어때?', KO_WORDS, first, 1).kind, 'leave');
  assert.equal(chainTurn(ko('사과'), '그만', KO_WORDS, first, 1).kind, 'giveUp');
});

test('펫이 이을 말이 없으면 지고, 많이 이으면 지친다', () => {
  const stumped = chainTurn(ko('사과'), '과녁', ['과자'], first, 1);
  assert.equal(stumped.kind, 'stumped');
  if (stumped.kind === 'stumped') assert.deepEqual(stumped.need, ['녁', '역']);
  const tired = chainTurn(ko('사과', ['사과'], WORD_CHAIN.maxTurns), '과자', ['자두'], first, 1);
  assert.deepEqual(tired, { kind: 'tired', turns: WORD_CHAIN.maxTurns });
});

test('영어는 끝 알파벳으로 잇는다', () => {
  const s: ChainState = { lang: 'en', used: ['apple'], last: 'apple', turns: 0, at: 0 };
  const step = chainTurn(s, 'Egg', ['goat', 'grape'], first, 1);
  assert.equal(step.kind, 'next');
  if (step.kind === 'next') {
    assert.equal(step.word, 'goat');
    assert.deepEqual(step.need, ['t']);
    assert.ok(step.state.used.includes('egg'));
  }
  assert.equal(chainTurn(s, 'banana', EN_WORDS, first, 1).kind, 'wrongStart');
});

test('펫 첫 말, 고르기, 오래 쉬면 끝', () => {
  const s = startChain('ko', KO_WORDS, first, 100);
  assert.equal(s.last, KO_WORDS[0]);
  assert.deepEqual(s.used, [KO_WORDS[0]]);
  assert.equal(
    pickWord('과', [], ['사과', '과자'], 'ko', () => 0.99),
    '과자',
  );
  assert.equal(pickWord('과', ['과자'], ['과자'], 'ko', first), undefined);
  assert.equal(chainExpired(s, 100 + WORD_CHAIN.idleMs), false);
  assert.equal(chainExpired(s, 101 + WORD_CHAIN.idleMs), true);
  assert.equal(startChain('en', EN_WORDS, first, 0).last, EN_WORDS[0]);
  // 첫 말은 이을 말이 있는 끝 글자로 (이웃은 '웃'으로 이을 말이 없어 고르지 않는다)
  assert.equal(startChain('ko', ['이웃', '가방', '방울'], first, 0).last, '가방');
});

test('끝말잇기 코인은 하루 둘까지', () => {
  assert.equal(chainCoinsAllowed(1, 0), 1);
  assert.equal(chainCoinsAllowed(1, WORD_CHAIN.coinDaily - 1), 1);
  assert.equal(chainCoinsAllowed(1, WORD_CHAIN.coinDaily), 0);
  assert.equal(chainCoinsAllowed(1, 99), 0);
});

test('내장 단어: 겹치지 않고, 모양이 맞고, 흔한 끝 글자로 이을 말이 있다', () => {
  const dup = (a: readonly string[]) => a.filter((w, i) => a.indexOf(w) !== i);
  assert.deepEqual(dup(KO_WORDS), []);
  assert.deepEqual(dup(EN_WORDS), []);
  assert.ok(KO_WORDS.length >= 500, String(KO_WORDS.length));
  assert.ok(EN_WORDS.length >= 200, String(EN_WORDS.length));
  for (const w of KO_WORDS) assert.equal(readWord(w, 'ko').kind, 'word', w);
  for (const w of EN_WORDS) assert.equal(readWord(w, 'en').kind, 'word', w);
  // 흔한 끝 글자 (사용자가 자주 끝낼 글자)
  for (const ch of [
    '기',
    '이',
    '리',
    '지',
    '자',
    '수',
    '사',
    '고',
    '구',
    '도',
    '무',
    '마',
    '나',
    '다',
    '개',
    '서',
    '시',
    '주',
    '장',
    '물',
    '일',
  ])
    assert.ok(pickWord(ch, [], KO_WORDS, 'ko', first), ch);
  for (const ch of 'abcdefghijklmnopqrstuvwyz') assert.ok(pickWord(ch, [], EN_WORDS, 'en', first), ch);
});
