import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setLang } from '../shared/i18n/index.ts';
import { PLAY_COIN } from '../shared/minigames.ts';
import { WORD_CHAIN } from '../shared/word-chain.ts';
import { KO_WORDS } from '../shared/word-chain-words.ts';
import { chainDayOf, createTickle, createWordChain } from './fun.ts';

function harness(opts: { playCoins?: number; rand?: () => number } = {}) {
  let now = new Date(2026, 9, 12, 10).getTime();
  let file: unknown;
  const given: number[] = [];
  let played = 0;
  let playCoins = opts.playCoins ?? 0;
  const chain = createWordChain({
    coinsToday: () => playCoins,
    giveCoins: (c) => {
      given.push(c);
      playCoins += c;
    },
    played: () => played++,
    load: () => file,
    save: (v) => {
      file = v;
    },
    log: () => {},
    now: () => now,
    rand: opts.rand ?? (() => 0),
  });
  return {
    chain,
    given,
    played: () => played,
    file: () => file,
    tick: (ms: number) => {
      now += ms;
    },
  };
}

test('채팅: "끝말잇기"라고 하면 펫이 먼저 말하고, 판이 없으면 보통 대화', () => {
  setLang('ko');
  const h = harness();
  assert.equal(h.chain.turn('사과'), undefined, '판이 없으면 AI 로');
  assert.equal(h.chain.turn('그만'), undefined, '판이 없으면 그만도 AI 로');
  const first = h.chain.turn('끝말잇기 하자');
  assert.ok(first?.includes(KO_WORDS[0] ?? 'x'), String(first));
  assert.ok(first?.includes('"그만"'), String(first));
  assert.equal(h.chain.state()?.last, KO_WORDS[0]);
});

test('사용자가 이기면 코인 1, 끝말잇기 코인은 하루 둘, 놀이 상한도 지킨다', () => {
  setLang('ko');
  const h = harness();
  for (let round = 0; round < 3; round++) {
    h.chain.start();
    // 펫 목록에 없는 끝 글자(뷁)로 끝나는 말을 하면 펫이 진다
    const last = h.chain.state()?.last ?? '';
    const ans = h.chain.turn(`${last.at(-1)}뷁`);
    assert.ok(ans?.includes('네가 이겼어'), String(ans));
  }
  assert.deepEqual(h.given, [1, 1], '세 번 이겨도 코인은 둘');
  assert.deepEqual(h.file(), { day: '2026-10-12', coins: 2, plays: 3 });
  assert.equal(h.played(), 3);
  assert.equal(h.chain.state(), undefined);
  // 놀이 하루 상한이 다 찼으면 끝말잇기도 코인이 없다
  const full = harness({ playCoins: PLAY_COIN.dailyLimit });
  full.chain.start();
  const ans = full.chain.turn(`${full.chain.state()?.last.at(-1)}뷁`);
  assert.ok(ans && !ans.includes('코인'), String(ans));
  assert.deepEqual(full.given, []);
});

test('날이 바뀌면 끝말잇기 코인을 다시 받는다, 펫이 이기면 코인 없음', () => {
  setLang('ko');
  const h = harness();
  for (let i = 0; i < 2; i++) {
    h.chain.start();
    h.chain.turn(`${h.chain.state()?.last.at(-1)}뷁`);
  }
  h.tick(24 * 3600_000);
  h.chain.start();
  assert.ok(h.chain.turn('몰라')?.includes('내가 이겼다'));
  h.chain.start();
  h.chain.turn(`${h.chain.state()?.last.at(-1)}뷁`);
  assert.deepEqual(h.given, [1, 1, 1]);
});

test('틀리면 다시 기회, 말이 아니면 판을 접고 AI 로, 오래 쉬면 판이 끝난다', () => {
  setLang('ko');
  const h = harness();
  h.chain.start();
  assert.ok(h.chain.turn('뷁뷁')?.includes('시작해야 해'));
  assert.ok(h.chain.state());
  assert.equal(h.chain.turn('오늘 뭐부터 할까?'), undefined);
  assert.equal(h.chain.state(), undefined);
  h.chain.start();
  h.tick(WORD_CHAIN.idleMs + 1);
  assert.equal(h.chain.turn('방울'), undefined, '쉬다 온 말은 보통 대화');
  h.chain.start();
  h.chain.reset();
  assert.equal(h.chain.state(), undefined);
});

test('영어 판: 끝 알파벳으로 잇는다', () => {
  setLang('en');
  try {
    const h = harness();
    const first = h.chain.turn('word chain');
    assert.ok(first?.startsWith("Let's play word chain!"), String(first));
    const last = h.chain.state()?.last ?? '';
    const ans = h.chain.turn(`${last.at(-1)}gg`);
    assert.ok(ans && /Now|Next|Your turn/.test(ans), String(ans));
  } finally {
    setLang('ko');
  }
});

test('하루 기록 파일: 다른 날이나 깨진 값은 0', () => {
  assert.deepEqual(chainDayOf(undefined, '2026-10-12'), { coins: 0, plays: 0 });
  assert.deepEqual(chainDayOf({ day: '2026-10-11', coins: 2 }, '2026-10-12'), { coins: 0, plays: 0 });
  assert.deepEqual(chainDayOf({ day: '2026-10-12', coins: -1, plays: 'x' }, '2026-10-12'), {
    coins: 0,
    plays: 0,
  });
  assert.deepEqual(chainDayOf({ day: '2026-10-12', coins: 2, plays: 3 }, '2026-10-12'), {
    coins: 2,
    plays: 3,
  });
});

test('간지럼: 바쁘면 세지 않고, 오래 문지르면 한 번 깔깔', () => {
  setLang('ko');
  let now = 0;
  let busy = false;
  const said: string[] = [];
  const tk = createTickle({ busy: () => busy, giggle: (s) => said.push(s), log: () => {}, now: () => now });
  busy = true;
  for (const t of [0, 2000, 4000]) {
    now = t;
    assert.equal(tk.petted(), false);
  }
  busy = false;
  for (const t of [10_000, 12_000]) {
    now = t;
    assert.equal(tk.petted(), false);
  }
  now = 14_000;
  assert.equal(tk.petted(), true);
  now = 16_000;
  assert.equal(tk.petted(), false);
  assert.equal(said.length, 1);
  assert.ok(/[하히깔]/.test(said[0] ?? ''), String(said[0]));
});
