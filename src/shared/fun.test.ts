import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  highFiveResult,
  JOKE_COUNT,
  JOKE_RECENT,
  jokeMove,
  pickJoke,
  pickLine,
  rememberJoke,
  TICKLE,
  TICKLE_START,
  tickle,
} from './fun.ts';
import { dicts } from './i18n/index.ts';

test('웃겨 줘: 최근에 한 것은 다시 고르지 않고, 다 돌면 처음부터', () => {
  let recent: number[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < 40; i++) {
    const n = pickJoke(recent, Math.random);
    assert.ok(n >= 1 && n <= JOKE_COUNT, String(n));
    assert.ok(!recent.includes(n), `${n} 가 최근 ${recent}`);
    recent = rememberJoke(recent, n);
    assert.ok(recent.length <= JOKE_RECENT);
    seen.add(n);
  }
  assert.ok(seen.size > JOKE_RECENT, '여러 가지가 나온다');
  // rand 끝값도 범위 안
  assert.equal(
    pickJoke([], () => 0),
    1,
  );
  assert.equal(
    pickJoke([], () => 0.9999),
    JOKE_COUNT,
  );
});

test('웃음마다 문제와 펀치 글이 두 말 다 있고, 몸짓이 정해져 있다', () => {
  for (let n = 1; n <= JOKE_COUNT; n++)
    for (const d of [dicts.ko, dicts.en] as Record<string, unknown>[]) {
      assert.equal(typeof d[`fun.joke.${n}.q`], 'string', `${n}.q`);
      assert.equal(typeof d[`fun.joke.${n}.a`], 'string', `${n}.a`);
    }
  assert.equal((dicts.ko as Record<string, unknown>)[`fun.joke.${JOKE_COUNT + 1}.q`], undefined);
  assert.equal(jokeMove(11), 'dance');
  assert.equal(jokeMove(1), 'happy');
  assert.equal(jokeMove(14), 'wave');
});

test('하이파이브: 단추면 짝, 시간 끝이나 닫기면 허공, 그만이나 안 뜸이면 안 한 것', () => {
  assert.equal(highFiveResult('five', false), 'hit');
  assert.equal(highFiveResult('timeout', false), 'miss');
  assert.equal(highFiveResult('dismiss', false), 'miss');
  assert.equal(highFiveResult('cleared', false), 'stop');
  assert.equal(highFiveResult('replaced', false), 'stop');
  assert.equal(highFiveResult(undefined, false), 'stop');
  assert.equal(highFiveResult('five', true), 'stop');
});

test('간지럼: 짧은 사이 쓰다듬기 세 번이면 깔깔, 한 번 웃으면 한동안 안 웃는다', () => {
  let s: { pats: readonly number[]; lastAt: number } = TICKLE_START;
  const pat = (t: number) => {
    const r = tickle(s, t);
    s = { pats: r.pats, lastAt: r.lastAt };
    return r.tickled;
  };
  // 쓰다듬기 한두 번은 그냥 쓰다듬기
  assert.equal(pat(0), false);
  assert.equal(pat(2000), false);
  assert.equal(pat(4000), true);
  // 계속 문질러도 쉬는 동안은 다시 안 웃는다
  for (let t = 6000; t < 4000 + TICKLE.cooldownMs; t += 2000) assert.equal(pat(t), false, String(t));
  // 쉬는 시간이 지나면 다시
  assert.equal(pat(4000 + TICKLE.cooldownMs), true);
});

test('간지럼: 띄엄띄엄 쓰다듬으면 웃지 않는다', () => {
  let s: { pats: readonly number[]; lastAt: number } = TICKLE_START;
  for (let i = 0; i < 10; i++) {
    const r = tickle(s, i * (TICKLE.windowMs / 2 + 1));
    s = { pats: r.pats, lastAt: r.lastAt };
    assert.equal(r.tickled, false, String(i));
  }
});

test('간지럼 글, 하이파이브 글 가짓수가 사전과 맞다', () => {
  const ko = dicts.ko as Record<string, unknown>;
  for (let n = 1; n <= TICKLE.lines; n++) assert.equal(typeof ko[`fun.tickle.${n}`], 'string');
  assert.equal(ko[`fun.tickle.${TICKLE.lines + 1}`], undefined);
  for (let n = 1; n <= 3; n++) assert.equal(typeof ko[`fun.five.hit.${n}`], 'string');
  for (let i = 0; i < 50; i++) {
    const n = pickLine(4, Math.random);
    assert.ok(n >= 1 && n <= 4);
  }
  assert.equal(
    pickLine(4, () => 0.99999),
    4,
  );
});
