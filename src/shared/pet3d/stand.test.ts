import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type Blueprint, type Part, parseBlueprint, rotateVec } from './blueprint.ts';
import { DEFAULT_BLUEPRINTS } from './defaults.ts';
import { EXAMPLE_CAT, EXAMPLE_PLUSH } from './examples.ts';
import { canStand, catLike, oddBody, shade, standingBlueprint } from './stand.ts';

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
  // 코가 있는 사진 동물은 그대로 세운다 (긴 귀 토끼는 코가 있어도 몸이 맞지 않아 아래 시험)
  assert.ok(
    canStand({
      ...capCat,
      face: { ...capCat.face, nose: { shape: 'triangle', color: '#e88d8a' } },
    }),
  );
});

// 진짜 동물 사진이라도 고양이(밀크)나 강아지(초코) 뼈대에 맞지 않는 몸. 세우면 토끼 귀가 처진 강아지 귀가 되고
// 햄스터가 세모 귀 고양이가 되어 그 동물로 보이지 않았다
const realRabbit: Blueprint = {
  v: 2,
  gait: 'quadruped',
  parts: [
    { slot: 'body', shape: 'sphere', at: [0, 0.34, -0.04], size: [0.34, 0.32, 0.4], color: '#9a8270' },
    { slot: 'head', shape: 'sphere', at: [0, 0.76, 0.14], size: [0.34, 0.3, 0.32], color: '#a08874' },
    {
      slot: 'earL',
      shape: 'capsule',
      at: [-0.1, 1.2, 0.06],
      size: [0.07, 0.26, 0.04],
      color: '#9a8270',
      inner: '#e9b4b4',
      mirror: true,
    },
    { slot: 'tail', shape: 'sphere', at: [0, 0.3, -0.44], size: [0.09, 0.09, 0.08], color: '#f6f2ea' },
  ],
  face: {
    slot: 'head',
    eyeY: 0.8,
    eyeGap: 0.16,
    eyeSize: 0.05,
    mouth: 'cat',
    mouthY: 0.63,
    nose: { shape: 'triangle', color: '#d98c94' },
    whiskers: '#efe8de',
  },
};
const roundEar = (p: Part): Part =>
  p.slot === 'earL' ? { ...p, shape: 'sphere', at: [-0.22, 1.04, 0.02], size: [0.08, 0.08, 0.04] } : p;
const hamster: Blueprint = {
  ...realRabbit,
  gait: 'biped',
  parts: realRabbit.parts.map((p) => (p.slot === 'tail' ? { ...p, size: [0.04, 0.04, 0.04] } : roundEar(p))),
};

test('네 발로 서기: 고양이, 강아지 뼈대에 맞지 않는 몸(토끼, 햄스터, 기니피그, 곰)은 세우지 않는다', () => {
  // 길게 선 귀 토끼
  assert.equal(oddBody(realRabbit), true);
  assert.equal(canStand(realRabbit), false);
  assert.equal(standingBlueprint(realRabbit), undefined);
  // 귀가 처진 토끼(롭이어)도 솜뭉치 꼬리에 고양이 입
  const lop: Blueprint = {
    ...realRabbit,
    parts: realRabbit.parts.map((p) =>
      p.slot === 'earL' ? { ...p, at: [-0.24, 0.66, 0.1], rot: [0, 0, -12] } : p,
    ),
  };
  assert.equal(canStand(lop), false);
  // 작은 둥근 귀에 꼬리가 거의 없는 햄스터, 꼬리가 없는 기니피그
  assert.equal(canStand(hamster), false);
  assert.equal(
    canStand({ ...hamster, gait: 'quadruped', parts: hamster.parts.filter((p) => p.slot !== 'tail') }),
    false,
  );
  // 둥근 귀, 짧은 꼬리 곰 (웃는 입, 타원 코라도)
  const bear: Blueprint = {
    ...hamster,
    face: { ...hamster.face, mouth: 'smile', nose: { shape: 'oval', color: '#2a2220' }, whiskers: undefined },
  };
  assert.equal(canStand(bear), false);
  // 기본 토끼 페어리 몸도 같다
  assert.equal(canStand(DEFAULT_BLUEPRINTS.bunny), false);
});

test('네 발로 서기: 여우, 너구리(긴 꼬리), 처진 귀 짧은 꼬리 강아지, 꼬리 짧은 고양이는 그대로 세운다', () => {
  const fox: Blueprint = {
    ...prickEarDog,
    parts: prickEarDog.parts.map((p) =>
      p.slot === 'tail'
        ? {
            ...p,
            size: [0.1, 0.1, 0.1],
            path: [
              [0, 0.36, -0.42],
              [0.24, 0.2, -0.7],
            ],
          }
        : p,
    ),
  };
  assert.equal(oddBody(fox), false);
  assert.equal(catLike(fox), false);
  assert.ok(standingBlueprint(fox));
  // 둥근 귀라도 긴 꼬리면 (너구리)
  assert.equal(canStand({ ...fox, parts: fox.parts.map(roundEar) }), true);
  // 처진 귀에 방울 꼬리만 있는 강아지 (푸들)
  const poodle: Blueprint = {
    ...DEFAULT_BLUEPRINTS.dog,
    gait: 'quadruped',
    parts: DEFAULT_BLUEPRINTS.dog.parts.filter((p) => !(p.slot === 'tail' && p.shape === 'capsule')),
  };
  assert.equal(canStand(poodle), true);
  // 세모 귀 고양이는 꼬리가 짧거나 없어도
  const bobtail: Blueprint = {
    ...EXAMPLE_CAT,
    gait: 'quadruped',
    parts: EXAMPLE_CAT.parts.filter((p) => p.slot !== 'tail'),
  };
  assert.equal(canStand(bobtail), true);
  assert.equal(canStand(EXAMPLE_CAT), true);
  assert.equal(canStand(DEFAULT_BLUEPRINTS.dog), true);
});

// 선 세모 귀 강아지 (시바견처럼): 웃는 입, 타원 코, 수염 없음. 크림색 배 (아래쪽 나누기 무늬)
const prickEarDog: Blueprint = {
  v: 2,
  gait: 'quadruped',
  fur: { length: 0.3 },
  parts: [
    {
      slot: 'body',
      shape: 'sphere',
      at: [0, 0.36, 0],
      size: [0.34, 0.33, 0.4],
      color: '#d2894a',
      finish: 'soft',
      pattern: { type: 'split', color: '#f4e6cf', side: 'bottom', amount: 0.4 },
    },
    { slot: 'head', shape: 'sphere', at: [0, 0.8, 0.12], size: [0.38, 0.33, 0.34], color: '#d48c4c' },
    {
      slot: 'earL',
      shape: 'cone',
      at: [-0.22, 1.1, 0.08],
      size: [0.11, 0.14, 0.07],
      color: '#d2894a',
      mirror: true,
    },
    {
      slot: 'legL',
      shape: 'capsule',
      at: [-0.15, 0.1, 0.24],
      size: [0.075, 0.1, 0.075],
      color: '#f4e6cf',
      mirror: true,
    },
    {
      slot: 'tail',
      shape: 'tube',
      at: [0, 0.55, -0.35],
      size: [0.07, 0.07, 0.07],
      color: '#d2894a',
      path: [
        [0, 0.5, -0.38],
        [0.1, 0.78, -0.26],
      ],
    },
  ],
  face: {
    slot: 'head',
    eyeY: 0.83,
    eyeGap: 0.14,
    eyeSize: 0.05,
    mouth: 'smile',
    mouthY: 0.66,
    nose: { shape: 'oval', color: '#2a2220' },
  },
};

test('네 발로 서기: 선 세모 귀라도 웃는 입, 수염 없는 강아지는 강아지 몸', () => {
  assert.equal(catLike(prickEarDog), false);
  const bp = standingBlueprint(prickEarDog);
  assert.ok(bp);
  assert.equal(bp.face.whiskers, undefined);
  assert.equal(bp.face.mouth, 'grin');
  // 고양이(세모 귀, 고양이 입)는 그대로 고양이
  assert.ok(catLike(EXAMPLE_CAT));
});

test('네 발로 서기: 흰 배(아래쪽 무늬)는 눕힌 몸통에서도 배 쪽에 온다', () => {
  for (const src of [prickEarDog, { ...prickEarDog, face: { ...prickEarDog.face, mouth: 'cat' as const } }]) {
    const bp = standingBlueprint(src);
    assert.ok(bp);
    const torso = bp.parts.find((p) => p.slot === 'body' && p.pattern);
    assert.ok(torso?.pattern?.side);
    // 몸통의 그 쪽 방향을 돌려 보면 세상 아래(-y)다
    const dir = {
      top: [0, 1, 0],
      bottom: [0, -1, 0],
      front: [0, 0, 1],
      back: [0, 0, -1],
      left: [-1, 0, 0],
      right: [1, 0, 0],
    }[torso.pattern.side] as [number, number, number];
    const [rx, ry, rz] = torso.rot ?? [0, 0, 0];
    const w = rotateVec(dir, rx, ry, rz);
    assert.ok(w[1] < -0.9, `${torso.pattern.side} -> ${w.map((v) => v.toFixed(2))}`);
  }
});

test('네 발로 서기: 볼 털은 고양이 뼈대만 (강아지 옆모습에서 주둥이 앞에 떠 보였다)', () => {
  const fluffyDog: Blueprint = {
    ...DEFAULT_BLUEPRINTS.dog,
    gait: 'quadruped',
    face: { ...DEFAULT_BLUEPRINTS.dog.face, fluff: '#f5f1ea' },
  };
  const dog = standingBlueprint(fluffyDog);
  assert.ok(dog);
  assert.ok(!catLike(fluffyDog));
  assert.equal(dog.face.fluff, undefined);
  const cat = standingBlueprint(EXAMPLE_CAT);
  assert.ok(cat?.face.fluff);
});

test('색 밝히기, 어둡게', () => {
  assert.equal(shade('#000000', 0.5), '#808080');
  assert.equal(shade('#ffffff', -0.5), '#808080');
  assert.equal(shade('nope', 0.2), 'nope');
});
