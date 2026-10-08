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
  burrowFrame,
  chaseRunnerX,
  chaseX,
  decoyHole,
  fleeX,
  grantCoins,
  HANDS,
  isMiniGame,
  LASER,
  laserCaught,
  MOLE,
  makeBubble,
  moleCoins,
  moleField,
  moleFoot,
  moleHit,
  molePace,
  moleScore,
  nearestHole,
  nextHole,
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
  for (const g of ['bubbles', 'laser', 'treats', 'rps', 'tag', 'mole']) assert.ok(isMiniGame(g), g);
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

test('두더지 구멍: 3x2, 화면 안, 펫 발밑이 아래 줄 가운데 구멍', () => {
  const f = moleField(pet, area);
  assert.equal(f.holes.length, MOLE.cols * MOLE.rows);
  const inside = (r: { x: number; y: number; width: number; height: number }, a: typeof area) =>
    r.x >= a.x && r.y >= a.y && r.x + r.width <= a.x + a.width && r.y + r.height <= a.y + a.height;
  assert.ok(inside(f.rect, area));
  // 펫 발밑에서 가장 가까운 구멍은 아래 줄 가운데, 그 구멍에 선 펫은 화면 안
  const home = nearestHole(f, { x: pet.x + pet.width / 2, y: pet.y + pet.height });
  assert.equal(home, 4);
  for (let i = 0; i < f.holes.length; i++) {
    const foot = moleFoot(f, i);
    const stand = { x: foot.x - pet.width / 2, y: foot.y - pet.height, width: pet.width, height: pet.height };
    assert.ok(inside(stand, f.rect), `구멍 ${i} 의 펫이 놀이 창 밖`);
  }
  // 위 줄과 아래 줄, 왼쪽에서 오른쪽
  const [h0, h1, h2, h3] = f.holes.map((h) => h);
  assert.ok(h0 && h1 && h2 && h3);
  assert.ok(h0.y < h3.y);
  assert.ok(h0.x < h1.x && h1.x < h2.x);
  // 구석에 있으면 화면 안으로 민다
  for (const p of [
    { ...pet, x: 0 },
    { ...pet, x: area.width - pet.width },
    { ...pet, y: 0 },
  ]) {
    const g = moleField(p, area);
    assert.ok(inside(g.rect, area), JSON.stringify(g.rect));
  }
  // 좁은 화면이면 칸을 줄여 들어간다
  const narrow = { x: 100, y: 0, width: 300, height: 900 };
  assert.ok(inside(moleField({ ...pet, x: 120 }, narrow).rect, narrow));
});

test('두더지: 같은 구멍에 연달아 안 나오고, 갈수록 빨라진다', () => {
  for (let prev = 0; prev < 6; prev++)
    for (const r of [0, 0.2, 0.5, 0.8, 0.9999]) {
      const i = nextHole(prev, 6, () => r);
      assert.ok(i >= 0 && i < 6 && i !== prev, `${prev} ${r} ${i}`);
    }
  const early = molePace(0, () => 0.5);
  const late = molePace(MOLE.ms, () => 0.5);
  assert.equal(early.upMs, MOLE.upMs[0]);
  assert.equal(late.upMs, MOLE.upMs[1]);
  assert.ok(late.gapMs < early.gapMs);
  assert.equal(molePace(MOLE.ms * 3, () => 0.5).upMs, MOLE.upMs[1]);
});

test('두더지 가짜: 처음 몇 번은 안 나오고, 펫과 다른 세로 칸에', () => {
  assert.equal(
    decoyHole(1, 0, () => 0),
    undefined,
  );
  assert.equal(
    decoyHole(1, MOLE.decoyAfter, () => 0.99),
    undefined,
  );
  for (let p = 0; p < 6; p++)
    for (const r of [0, 0.1, 0.2]) {
      const d = decoyHole(p, MOLE.decoyAfter, seq(0, r));
      assert.ok(d !== undefined && d % MOLE.cols !== p % MOLE.cols, `${p} ${d}`);
    }
});

test('두더지 잡기 판정, 점수, 코인', () => {
  assert.equal(moleHit({ state: 'up', downAt: 0, hit: false }, 5000), true);
  assert.equal(moleHit({ state: 'up', downAt: 0, hit: true }, 5000), false);
  assert.equal(moleHit({ state: 'down', downAt: 1000, hit: false }, 1000 + MOLE.graceMs), true);
  assert.equal(moleHit({ state: 'down', downAt: 1000, hit: false }, 1001 + MOLE.graceMs), false);
  assert.equal(moleHit(undefined, 0), false);
  assert.equal(moleScore(4, 1), 3);
  assert.equal(moleScore(1, 3), 0);
  assert.equal(moleCoins(4), 0);
  assert.equal(moleCoins(5), 1);
  assert.equal(moleCoins(9), 1);
  assert.equal(moleCoins(10), 2);
  assert.equal(moleCoins(30), 2);
});

test('구멍에서 솟기: 발밑은 그대로, 작게 시작해 다 솟으면 원래 크기', () => {
  const stand = { x: 100, y: 200, width: 160, height: 160 };
  for (const u of [0, 0.3, 0.7, 0.95, 1]) {
    const r = burrowFrame(stand, u);
    assert.equal(r.y + r.height, 360, `발밑 ${u}`);
    assert.ok(Math.abs(r.x + r.width / 2 - 180) <= 1, `가운데 ${u}`);
    assert.ok(r.width <= 160 * 1.07, `넘침 ${u}`);
  }
  assert.ok(burrowFrame(stand, 0).width < 30);
  assert.deepEqual(burrowFrame(stand, 1), stand);
  assert.ok(burrowFrame(stand, 0.3).width < burrowFrame(stand, 0.7).width);
});
