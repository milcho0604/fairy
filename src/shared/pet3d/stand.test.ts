import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type Blueprint, parseBlueprint } from './blueprint.ts';
import { DEFAULT_BLUEPRINTS } from './defaults.ts';
import { EXAMPLE_CAT, EXAMPLE_PLUSH } from './examples.ts';
import { canStand, catLike, shade, standingBlueprint } from './stand.ts';

test('네 발로 서기: 사진 고양이 피규어는 밀크 뼈대에 원래 색과 눈, 코, 무늬를 입힌다', () => {
  const bp = standingBlueprint(EXAMPLE_CAT);
  assert.ok(bp);
  assert.equal(bp.stance, 'stand');
  assert.equal(bp.gait, 'quadruped');
  assert.ok(catLike(EXAMPLE_CAT));
  // 다리마다 무릎 아래 마디가 있다
  assert.ok(bp.parts.filter((p) => p.knee).length >= 6);
  const body = EXAMPLE_CAT.parts.find((p) => p.slot === 'body');
  assert.ok(bp.parts.some((p) => p.slot === 'body' && p.color === body?.color));
  assert.equal(bp.face.eyeColor, EXAMPLE_CAT.face.eyeColor ?? bp.face.eyeColor);
  // 저장했다 다시 읽어도 네 발로 선 몸이다
  const back = parseBlueprint(JSON.parse(JSON.stringify(bp)));
  assert.equal(back?.stance, 'stand');
  assert.equal(back?.parts.filter((p) => p.knee).length, bp.parts.filter((p) => p.knee).length);
});

test('네 발로 서기: 처진 귀 강아지는 초코 뼈대, 무늬와 털 느낌을 옮긴다', () => {
  const dog: Blueprint = {
    ...DEFAULT_BLUEPRINTS.dog,
    gait: 'quadruped',
    fur: { length: 0.3, curl: 0.1, clump: 0.2 },
    parts: DEFAULT_BLUEPRINTS.dog.parts.map((p) =>
      p.slot === 'body' ? { ...p, color: '#d9a066', pattern: { type: 'spots', color: '#5a3b22' } } : p,
    ),
  };
  assert.ok(canStand(dog));
  const bp = standingBlueprint(dog);
  assert.ok(bp);
  assert.ok(!catLike(dog));
  assert.deepEqual(bp.fur, dog.fur);
  const torso = bp.parts.find((p) => p.slot === 'body');
  assert.equal(torso?.color, '#d9a066');
  assert.equal(torso?.pattern?.type, 'spots');
});

test('네 발로 서기: 인형, 새, 이미 선 몸은 그대로 둔다', () => {
  assert.equal(canStand(EXAMPLE_PLUSH), false);
  assert.equal(standingBlueprint(EXAMPLE_PLUSH), undefined);
  assert.equal(standingBlueprint(DEFAULT_BLUEPRINTS.chick), undefined);
  const milk = standingBlueprint(EXAMPLE_CAT);
  assert.ok(milk);
  assert.equal(standingBlueprint(milk), undefined);
});

test('색 밝히기, 어둡게', () => {
  assert.equal(shade('#000000', 0.5), '#808080');
  assert.equal(shade('#ffffff', -0.5), '#808080');
  assert.equal(shade('nope', 0.2), 'nope');
});
