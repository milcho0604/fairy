import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  affectionAllowed,
  BUBBLES,
  bubbleAlive,
  bubbleAt,
  bubbleCoins,
  bubbleField,
  bubbleHit,
  chaseRunnerX,
  chaseX,
  fleeX,
  grantCoins,
  HANDS,
  isMiniGame,
  LASER,
  laserCaught,
  makeBubble,
  PLAY_AFFECTION_DAILY,
  PLAY_COIN,
  type PlayGate,
  pickHand,
  playBlock,
  playsOn,
  rpsResult,
  samePlayground,
  silentBlock,
  tagged,
  treatCaught,
  treatX,
} from './minigames.ts';

const area = { x: 0, y: 0, width: 1440, height: 900 };
const pet = { x: 600, y: 740, width: 160, height: 160 };
const seq = (...xs: number[]) => {
  let i = 0;
  return () => xs[i++ % xs.length] ?? 0;
};

test('놀이 이름', () => {
  for (const g of ['bubbles', 'laser', 'treats', 'rps', 'tag']) assert.ok(isMiniGame(g), g);
  for (const g of ['ball', 'walk', 'seek', '', undefined, 3]) assert.equal(isMiniGame(g), false, String(g));
});

test('놀이 코인은 하루 상한을 넘지 않고, 음수나 소수가 없다', () => {
  assert.equal(grantCoins(1, 0), 1);
  assert.equal(grantCoins(2, PLAY_COIN.dailyLimit - 1), 1);
  assert.equal(grantCoins(2, PLAY_COIN.dailyLimit), 0);
  assert.equal(grantCoins(2, PLAY_COIN.dailyLimit + 5), 0);
  assert.equal(grantCoins(1.7, 0), 1);
  assert.equal(grantCoins(-3, 0), 0);
  // 하루 내내 이겨도 상한까지만
  let earned = 0;
  for (let i = 0; i < 50; i++) earned += grantCoins(1, earned);
  assert.equal(earned, PLAY_COIN.dailyLimit);
});

test('친밀도는 하루 정한 판 수까지만 오른다', () => {
  assert.equal(affectionAllowed(0), true);
  assert.equal(affectionAllowed(PLAY_AFFECTION_DAILY - 1), true);
  assert.equal(affectionAllowed(PLAY_AFFECTION_DAILY), false);
});

test('하루 판 수 기록: 날이 다르거나 깨졌으면 0', () => {
  assert.equal(playsOn({ day: '2026-10-08', n: 4 }, '2026-10-08'), 4);
  assert.equal(playsOn({ day: '2026-10-07', n: 4 }, '2026-10-08'), 0);
  for (const bad of [
    undefined,
    null,
    'x',
    { day: '2026-10-08', n: 'a' },
    { day: '2026-10-08', n: -1 },
    { n: 3 },
  ])
    assert.equal(playsOn(bad, '2026-10-08'), 0, JSON.stringify(bad));
});

const free: PlayGate = {
  hidden: false,
  focus: false,
  locked: false,
  held: false,
  resting: false,
  playing: false,
  hungry: false,
  friend: true,
};

test('시작 막기: 숨음, 잠금, 들림, 노는 중은 조용히, 집중, 쉬는 중, 배고픔, 친구 없음은 말해 준다', () => {
  assert.equal(playBlock('bubbles', free), undefined);
  for (const [key, block] of [
    ['hidden', 'hidden'],
    ['locked', 'locked'],
    ['held', 'held'],
    ['playing', 'playing'],
  ] as const) {
    assert.equal(playBlock('rps', { ...free, [key]: true }), block);
    assert.equal(silentBlock(block), true, block);
  }
  assert.equal(playBlock('rps', { ...free, focus: true }), 'focus');
  assert.equal(playBlock('rps', { ...free, resting: true }), 'resting');
  for (const b of ['focus', 'resting', 'hungry', 'noFriend'] as const) assert.equal(silentBlock(b), false, b);
  // 숨음이 집중보다 먼저 (숨은 펫이 말하지 않게)
  assert.equal(playBlock('rps', { ...free, hidden: true, focus: true }), 'hidden');
});

test('배고프면 뛰는 놀이(레이저, 술래잡기)만 막고, 간식과 방울, 가위바위보는 한다', () => {
  const hungry = { ...free, hungry: true };
  assert.equal(playBlock('laser', hungry), 'hungry');
  assert.equal(playBlock('tag', hungry), 'hungry');
  assert.equal(playBlock('treats', hungry), undefined);
  assert.equal(playBlock('bubbles', hungry), undefined);
  assert.equal(playBlock('rps', hungry), undefined);
});

test('술래잡기는 친구가 있어야', () => {
  assert.equal(playBlock('tag', { ...free, friend: false }), 'noFriend');
  assert.equal(playBlock('laser', { ...free, friend: false }), undefined);
});

test('방울은 아래에서 위로 오르며 좌우로 흔들리고, 시간이 지나거나 창 위로 나가면 사라진다', () => {
  const b = makeBubble(seq(0.5, 0, 0.25));
  assert.equal(b.y0, BUBBLES.height - BUBBLES.size);
  const a0 = bubbleAt(b, 0);
  const a1 = bubbleAt(b, 2000);
  assert.ok(a1.y < a0.y, '오른다');
  assert.ok(Math.abs(a1.x - b.x0) <= BUBBLES.sway + 0.001, '흔들림 폭 안');
  assert.ok(bubbleAlive(b, 0));
  assert.equal(bubbleAlive(b, BUBBLES.lifeMs), false);
  // 가장 빠른 방울도 수명 안에 창 위로 다 나가거나 그 전에 끝난다
  const fast = { ...b, speed: 1000 };
  assert.equal(bubbleAlive(fast, 600), false);
  // 처음 자리는 창 안
  for (let i = 0; i < 20; i++) {
    const r = makeBubble(Math.random);
    assert.ok(r.x0 - BUBBLES.size / 2 >= 0 && r.x0 + BUBBLES.size / 2 <= BUBBLES.width, String(r.x0));
  }
});

test('방울 누르기 판정은 그림보다 조금 넉넉하다', () => {
  const at = { x: 100, y: 100 };
  assert.ok(bubbleHit({ x: 100, y: 100 }, at));
  assert.ok(bubbleHit({ x: 100 + BUBBLES.size / 2 + 3, y: 100 }, at));
  assert.equal(bubbleHit({ x: 100 + BUBBLES.size / 2 + 6, y: 100 }, at), false);
});

test('방울 코인: 3개부터 1, 다 터뜨리면 2', () => {
  assert.equal(bubbleCoins(0, 7), 0);
  assert.equal(bubbleCoins(2, 7), 0);
  assert.equal(bubbleCoins(3, 7), 1);
  assert.equal(bubbleCoins(6, 7), 1);
  assert.equal(bubbleCoins(7, 7), 2);
  assert.equal(bubbleCoins(0, 0), 0);
});

test('방울 놀이 창은 펫 위 가운데, 화면 밖으로 나가지 않는다', () => {
  const f = bubbleField(pet, area);
  assert.equal(f.x + f.width / 2, pet.x + pet.width / 2);
  assert.ok(f.y + f.height <= pet.y + pet.height);
  // 화면 왼쪽 위 구석의 펫
  const corner = bubbleField({ x: -40, y: 0, width: 160, height: 160 }, area);
  assert.ok(corner.x >= area.x && corner.y >= area.y);
  // 옆 모니터 (음수 좌표)
  const left = { x: -1920, y: 0, width: 1920, height: 1080 };
  const g = bubbleField({ x: -1900, y: 920, width: 160, height: 160 }, left);
  assert.ok(g.x >= left.x && g.x + g.width <= left.x + left.width);
});

test('레이저: 점 쪽으로 달리되 펫 화면 안에서만, 바닥 가까이 대야 잡는다', () => {
  assert.equal(chaseX({ x: 1000 }, pet, area), 1000 - pet.width / 2);
  assert.equal(chaseX({ x: -500 }, pet, area), area.x);
  assert.equal(chaseX({ x: 99_999 }, pet, area), area.x + area.width - pet.width);
  const cx = pet.x + pet.width / 2;
  assert.ok(laserCaught({ x: cx + 10, y: pet.y + 120 }, pet));
  assert.equal(laserCaught({ x: cx + LASER.catchPx + 1, y: pet.y + 120 }, pet), false);
  // 머리보다 높으면 못 잡는다
  assert.equal(laserCaught({ x: cx, y: pet.y - 50 }, pet), false);
});

test('간식: 펫에서 조금 떨어진 화면 안 자리에 떨어지고, 입 높이에서 받아먹는다', () => {
  for (const r of [0, 0.3, 0.49, 0.5, 0.99]) {
    const x = treatX(pet, area, seq(r, r));
    assert.ok(x >= area.x + pet.width / 2 && x <= area.x + area.width - pet.width / 2, String(x));
    assert.ok(Math.abs(x - (pet.x + pet.width / 2)) >= 89, `너무 가깝다 ${x}`);
  }
  // 화면 왼쪽 끝 펫: 왼쪽으로 던지면 반대쪽으로
  const edge = { ...pet, x: 0 };
  const x = treatX(edge, area, seq(0.1, 0.9));
  assert.ok(x > edge.x + edge.width / 2, String(x));
  const cx = pet.x + pet.width / 2;
  assert.ok(treatCaught({ x: cx, y: pet.y + 80 }, pet));
  assert.equal(treatCaught({ x: cx, y: pet.y + 10 }, pet), false, '아직 머리 위');
  assert.equal(treatCaught({ x: cx + pet.width, y: pet.y + 80 }, pet), false, '옆');
});

test('가위바위보 규칙', () => {
  assert.equal(rpsResult('rock', 'scissors'), 'win');
  assert.equal(rpsResult('scissors', 'paper'), 'win');
  assert.equal(rpsResult('paper', 'rock'), 'win');
  assert.equal(rpsResult('rock', 'paper'), 'lose');
  for (const h of HANDS) assert.equal(rpsResult(h, h), 'draw');
  assert.equal(
    pickHand(() => 0),
    'rock',
  );
  assert.equal(
    pickHand(() => 0.999),
    'paper',
  );
  assert.equal(
    pickHand(() => 1),
    'rock',
  );
});

test('술래잡기: 술래 반대쪽 끝으로 도망가고, 가까우면 잡는다', () => {
  const chaser = { x: 300, y: 740, width: 160, height: 160 };
  const runner = { x: 600, y: 740, width: 160, height: 160 };
  assert.equal(fleeX(chaser, runner, area), area.x + area.width - runner.width - 6);
  assert.equal(fleeX(runner, chaser, area), area.x + 6);
  assert.equal(tagged(chaser, runner), false);
  assert.ok(tagged({ ...chaser, x: 520 }, runner));
  // 쫓아갈 자리는 도망가는 펫 바로 옆 (술래 쪽)
  const x = chaseRunnerX(chaser, runner);
  assert.ok(x < runner.x && tagged({ ...chaser, x }, runner));
  const y = chaseRunnerX({ ...chaser, x: 1100 }, runner);
  assert.ok(y > runner.x && tagged({ ...chaser, x: y }, runner));
});

test('같이 뛸 수 있는 친구: 같은 화면, 같은 바닥', () => {
  assert.ok(samePlayground(pet, { ...pet, x: 100 }, true));
  assert.equal(samePlayground(pet, { ...pet, x: 100 }, false), false);
  assert.equal(samePlayground(pet, { ...pet, y: 300 }, true), false, '창 위에 앉은 친구');
});
