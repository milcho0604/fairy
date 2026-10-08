import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  bodyOfParts,
  isMove,
  MOVE_SPECS,
  MOVES,
  type MoveContext,
  type MoveHistory,
  type MoveType,
  moveAskOf,
  moveWeights,
  PLAIN_ASK,
  pickMove,
  rememberMove,
} from './moves.ts';
import { DEFAULT_BLUEPRINTS } from './pet3d/defaults.ts';

const ctx = (patch: Partial<MoveContext> = {}): MoveContext => ({
  ask: PLAIN_ASK,
  recent: { at: {} },
  now: 1_000_000,
  ...patch,
});
const names = (c: MoveContext) => moveWeights(c).map(([t]) => t);
const weight = (c: MoveContext, type: MoveType) => moveWeights(c).find(([t]) => t === type)?.[1];

test('꼬리, 귀 몸짓은 그 부위가 있는 펫만', () => {
  assert.ok(!names(ctx()).includes('wag'));
  assert.ok(!names(ctx()).includes('ears'));
  assert.ok(names(ctx({ ask: { ...PLAIN_ASK, tail: true } })).includes('wag'));
  assert.ok(!names(ctx({ ask: { ...PLAIN_ASK, tail: true } })).includes('ears'));
  assert.ok(names(ctx({ ask: { ...PLAIN_ASK, ears: true } })).includes('ears'));
});

test('바로 전 몸짓은 다시 고르지 않는다', () => {
  assert.ok(!names(ctx({ recent: { last: 'scan', at: {} } })).includes('scan'));
});

test('쿨다운 동안은 빼고, 지나면 다시 넣는다', () => {
  const now = 1_000_000;
  const recent: MoveHistory = { last: 'tilt', at: { roll: now - 60_000, hop: now - 61_000 } };
  const list = names(ctx({ recent, now }));
  assert.ok(!list.includes('roll'), '뒹굴기는 5분');
  assert.ok(list.includes('hop'), '점프는 1분이 지났다');
  const later = names(ctx({ recent, now: now + MOVE_SPECS.roll.cooldownMs }));
  assert.ok(later.includes('roll'));
});

test('움직임 줄이기면 몸을 크게 흔드는 몸짓(털기, 점프, 뒹굴기)은 안 한다', () => {
  const list = names(ctx({ ask: { ...PLAIN_ASK, calm: true } }));
  for (const big of ['shake', 'hop', 'roll'] as const) assert.ok(!list.includes(big), big);
  assert.ok(list.includes('tilt'));
});

test('사진 펫과 창 위에 앉은 펫은 뒹굴지 않는다', () => {
  assert.ok(!names(ctx({ ask: { ...PLAIN_ASK, photo: true } })).includes('roll'));
  assert.ok(!names(ctx({ perched: true })).includes('roll'));
  assert.ok(names(ctx()).includes('roll'));
});

test('배고프면 점프, 뒹굴기는 안 하고 킁킁이 잦다', () => {
  const hungry = ctx({ ask: { ...PLAIN_ASK, hungry: true } });
  assert.ok(!names(hungry).includes('hop'));
  assert.ok(!names(hungry).includes('roll'));
  assert.equal(weight(hungry, 'sniff'), MOVE_SPECS.sniff.weight * 2);
});

test('밤(22시~6시)에는 하품, 꾸벅이 두 배, 기운 쓰는 몸짓은 반', () => {
  for (const hour of [23, 2]) {
    const night = ctx({ hour });
    assert.equal(weight(night, 'yawn'), MOVE_SPECS.yawn.weight * 2);
    assert.equal(weight(night, 'nod'), MOVE_SPECS.nod.weight * 2);
    assert.equal(weight(night, 'hop'), MOVE_SPECS.hop.weight * 0.5);
  }
  assert.equal(weight(ctx({ hour: 14 }), 'yawn'), MOVE_SPECS.yawn.weight);
});

test('무게대로 고른다. 할 것이 없으면 undefined', () => {
  const c = ctx();
  const list = moveWeights(c);
  assert.equal(
    pickMove(c, () => 0),
    list[0]?.[0],
  );
  assert.equal(
    pickMove(c, () => 0.999999),
    list.at(-1)?.[0],
  );
  const at = Object.fromEntries(MOVES.map((m) => [m, c.now]));
  assert.equal(
    pickMove(ctx({ recent: { at } }), () => 0.5),
    undefined,
  );
});

test('오래 돌려도 같은 몸짓이 연달아 나오지 않고 쿨다운을 지킨다', () => {
  // 고정 난수로 몸짓 2000번 (37초 간격). 꼬리, 귀 있는 펫
  let seed = 7;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  let recent: MoveHistory = { at: {} };
  let now = 0;
  const counts = new Map<MoveType, number>();
  let prev: MoveType | undefined;
  for (let i = 0; i < 2000; i++) {
    now += 37_000;
    const c = ctx({ ask: { ...PLAIN_ASK, tail: true, ears: true }, recent, now });
    const m = pickMove(c, rand);
    assert.ok(m, '늘 무엇인가는 고른다');
    if (!m) continue;
    assert.notEqual(m, prev);
    const last = recent.at[m];
    if (last !== undefined) assert.ok(now - last >= MOVE_SPECS[m].cooldownMs, `${m} 쿨다운`);
    counts.set(m, (counts.get(m) ?? 0) + 1);
    recent = rememberMove(recent, m, now);
    prev = m;
  }
  // 모든 몸짓이 나온다. 가장 흔한 것도 전체의 1/4 을 넘지 않는다 (한두 가지만 되풀이하지 않는다)
  for (const m of MOVES) assert.ok((counts.get(m) ?? 0) > 0, `${m} 가 한 번도 안 나왔다`);
  assert.ok(Math.max(...counts.values()) < 500, JSON.stringify(Object.fromEntries(counts)));
  // 뒹굴기는 5분 쿨다운이라 37초 간격이면 많아야 8.1번에 한 번
  assert.ok((counts.get('roll') ?? 0) <= 2000 / 8);
});

test('화면이 보낸 몸 정보는 참거짓만 받는다', () => {
  assert.deepEqual(moveAskOf(undefined), PLAIN_ASK);
  assert.deepEqual(moveAskOf('x'), PLAIN_ASK);
  assert.deepEqual(moveAskOf({ tail: 1, ears: 'yes', photo: true, calm: true, hungry: false, extra: 1 }), {
    tail: false,
    ears: false,
    photo: true,
    calm: true,
    hungry: false,
  });
});

test('몸짓 길이는 짧게 (3.5초 안), 모든 몸짓에 쿨다운', () => {
  for (const m of MOVES) {
    assert.ok(MOVE_SPECS[m].ms > 0 && MOVE_SPECS[m].ms <= 3500, m);
    assert.ok(MOVE_SPECS[m].cooldownMs >= 20_000, m);
  }
  assert.ok(isMove('wag'));
  assert.ok(!isMove('walk'));
  assert.ok(!isMove('sit'));
});

test('입체 기본 펫: 냥이, 멍멍이, 삐약이는 꼬리를 흔들고 토순이 솜꼬리와 콩이는 안 흔든다', () => {
  const body = (k: keyof typeof DEFAULT_BLUEPRINTS) => bodyOfParts(DEFAULT_BLUEPRINTS[k].parts);
  assert.deepEqual(body('cat'), { tail: true, ears: true });
  assert.deepEqual(body('dog'), { tail: true, ears: true });
  assert.deepEqual(body('chick'), { tail: true, ears: false });
  assert.deepEqual(body('bunny'), { tail: false, ears: true });
  assert.deepEqual(body('kong'), { tail: false, ears: false });
});
