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

// 그림 캐릭터 (코 없이 그린 점 눈, 빗금 볼). 귀와 꼬리가 있어도 진짜 동물 뼈대로 세우면 호박색 고양이 눈과 수염이 붙고
// 긴 귀는 처진 강아지 귀가 된다
const W = '#f7f4ee';
const longEarBunny: Blueprint = {
  v: 2,
  gait: 'biped',
  parts: [
    { slot: 'body', shape: 'sphere', at: [0, 0.34, 0], size: [0.36, 0.34, 0.32], color: W, finish: 'soft' },
    {
      slot: 'head',
      shape: 'sphere',
      at: [0, 0.74, 0.02],
      size: [0.42, 0.34, 0.36],
      color: W,
      finish: 'soft',
    },
    {
      slot: 'earL',
      shape: 'capsule',
      at: [-0.14, 1.12, -0.02],
      size: [0.075, 0.2, 0.05],
      color: W,
      inner: '#f4c6cc',
      mirror: true,
    },
    { slot: 'tail', shape: 'sphere', at: [0, 0.2, -0.32], size: [0.08, 0.08, 0.07], color: W },
  ],
  face: {
    slot: 'head',
    eyeY: 0.72,
    eyeGap: 0.15,
    eyeSize: 0.04,
    mouth: 'cat',
    mouthY: 0.64,
    nose: { shape: 'none' },
    blush: '#f6a3b0',
  },
};

test('네 발로 서기: 코 없이 그린 캐릭터(긴 귀 흰 토끼 캐릭터, 머리 무늬 고양이 캐릭터)는 세우지 않는다', () => {
  assert.equal(canStand(longEarBunny), false);
  assert.equal(standingBlueprint(longEarBunny), undefined);
  const capCat: Blueprint = {
    ...longEarBunny,
    parts: [
      ...longEarBunny.parts.filter((p) => !p.slot.startsWith('ear')),
      {
        slot: 'earL',
        shape: 'cone',
        at: [-0.3, 1.14, 0],
        size: [0.12, 0.13, 0.07],
        color: '#6f8fc0',
        mirror: true,
      },
    ],
    face: { ...longEarBunny.face, blushLines: true },
  };
  assert.equal(canStand(capCat), false);
  // 코가 있는 사진 동물은 그대로 세운다
  assert.ok(
    canStand({
      ...longEarBunny,
      face: { ...longEarBunny.face, nose: { shape: 'triangle', color: '#e88d8a' } },
    }),
  );
});

test('색 밝히기, 어둡게', () => {
  assert.equal(shade('#000000', 0.5), '#808080');
  assert.equal(shade('#ffffff', -0.5), '#808080');
  assert.equal(shade('nope', 0.2), 'nope');
});
