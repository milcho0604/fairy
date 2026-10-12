// 기본 펫의 입체 설계도 (6단계). 2D 그림(draw.ts)과 같은 색에서 시작했다.
// 콩이, 삐약이는 동그란 몸 하나가 곧 얼굴이다. 냥이, 멍멍이, 햄찌, 뒤뚱이, 곰돌이, 토순이는 머리와 몸이 따로인 인형 몸에
// 팔다리가 있다 (2026-10-12 이슈 #53: 동그란 몸 하나로 바꿨더니 입체에서 다리가 안 보이고 특징이 사라져 되돌렸다).
import type { PetKind } from '../settings.ts';
import type { Blueprint, Finish, Part } from './blueprint.ts';

const KONG = '#ffd8a8';
const CAT = '#e1e7f3';
const CAT_POINT = '#a9b2c9';
const CHICK = '#ffe27a';
const DOG = '#fff1de';
const DOG_SPOT = '#e3a66a';
const CREAM = '#fffaf2';
const BUNNY = '#f6eef1';
const WHITE = '#fffbf5';
const HAMSTER = '#f6c88e';
const PINK_PAW = '#ffd3cb';
const PENGUIN = '#56668a';
const PENGUIN_WING = '#475674';
const PENGUIN_FEET = '#ffad4d';
const BEAR = '#b98559';
const BEAR_MUZZLE = '#f6e3c9';
const BEAR_PAW = '#e9c49c';

/**
 * 인형 몸의 자리 (냥이, 멍멍이, 햄찌, 뒤뚱이, 곰돌이). 몸 아래가 바닥에서 떠 있어 그 밑으로 다리가 보이고,
 * 머리는 몸 위에 얹혀 몸보다 크다 (아기 비율)
 */
const DOLL_BODY_AT: [number, number, number] = [0, 0.37, 0];
const DOLL_HEAD_AT: [number, number, number] = [0, 0.77, 0.03];

const fin = (finish?: Finish) => (finish ? { finish } : {});

/** 인형 몸의 팔: 어깨에서 조금 바깥으로 늘어뜨린 짧은 팔 끝에 발 손. 거울로 오른팔도 (흔들고, 들고, 춤춘다) */
function dollArms(color: string, paw: string, finish?: Finish): Part[] {
  return [
    {
      slot: 'armL',
      shape: 'capsule',
      at: [-0.33, 0.37, 0.08],
      size: [0.06, 0.11, 0.06],
      rot: [0, 0, -14],
      color,
      ...fin(finish),
      mirror: true,
    },
    {
      slot: 'armL',
      shape: 'sphere',
      at: [-0.385, 0.215, 0.12],
      size: [0.072, 0.064, 0.072],
      color: paw,
      ...fin(finish),
      mirror: true,
    },
  ];
}

/**
 * 인형 몸의 다리: 몸 아래로 보이는 짧은 다리와 앞으로 나온 발. 관절(다리 위)에서 발바닥까지 0.2 쯤이라
 * 걸을 때 관절에서 돌려 딛는다 (pet3d-gait.ts swingShare, bipedFoot)
 */
function dollLegs(color: string, foot: string, finish?: Finish): Part[] {
  return [
    {
      slot: 'legL',
      shape: 'capsule',
      at: [-0.13, 0.12, 0.05],
      size: [0.068, 0.085, 0.068],
      color,
      ...fin(finish),
      mirror: true,
    },
    {
      slot: 'legL',
      shape: 'sphere',
      at: [-0.13, 0.045, 0.1],
      size: [0.085, 0.05, 0.105],
      color: foot,
      ...fin(finish),
      mirror: true,
    },
  ];
}

export const DEFAULT_BLUEPRINTS: Record<PetKind, Blueprint> = {
  // 콩: 동그란 콩 몸에 짧은 팔다리, 머리에 새싹
  kong: {
    v: 1,
    // 복슬복슬 모습의 털 (blueprint.ts Fur)
    fur: { length: 0.1, clump: 0 },
    parts: [
      { slot: 'body', shape: 'sphere', at: [0, 0.46, 0], size: [0.56, 0.46, 0.48], color: KONG },
      {
        slot: 'legL',
        shape: 'sphere',
        at: [-0.22, 0.06, 0.16],
        size: [0.13, 0.07, 0.15],
        color: '#f5c08a',
        mirror: true,
      },
      {
        slot: 'armL',
        shape: 'sphere',
        at: [-0.53, 0.4, 0.05],
        size: [0.09, 0.14, 0.09],
        rot: [0, 0, 25],
        color: KONG,
        mirror: true,
      },
      { slot: 'top', shape: 'cylinder', at: [0, 0.96, 0], size: [0.018, 0.06, 0.018], color: '#6bbf59' },
      {
        slot: 'top',
        shape: 'sphere',
        at: [-0.075, 1.03, 0],
        size: [0.08, 0.026, 0.045],
        rot: [0, 0, -25],
        color: '#8fd16f',
        finish: 'shiny',
        mirror: true,
      },
    ],
    face: {
      slot: 'body',
      eyeY: 0.52,
      eyeGap: 0.19,
      eyeSize: 0.052,
      mouth: 'smile',
      mouthY: 0.42,
      blush: '#ff8c8c',
    },
  },
  // 냥이: 하늘빛 회색 인형 몸. 큰 머리에 끝이 둥근 세모 귀(안쪽 분홍), 이마 줄무늬 셋, 흰 주둥이에 분홍 세모 코와 고양이 입,
  // 짧은 수염. 흰 배, 흰 발 손과 흰 발, 끝이 진한 꼬리. 두 발로 선다
  cat: {
    v: 2,
    // 복슬복슬 모습의 털 (blueprint.ts Fur)
    fur: { length: 0.6, clump: 0.35 },
    parts: [
      {
        slot: 'body',
        shape: 'sphere',
        at: DOLL_BODY_AT,
        size: [0.31, 0.26, 0.28],
        color: CAT,
        finish: 'fuzzy',
      },
      // 흰 배
      {
        slot: 'body',
        shape: 'sphere',
        at: [0, 0.35, 0.13],
        size: [0.2, 0.19, 0.16],
        color: WHITE,
        finish: 'fuzzy',
      },
      {
        slot: 'head',
        shape: 'sphere',
        at: DOLL_HEAD_AT,
        size: [0.4, 0.33, 0.35],
        color: CAT,
        finish: 'fuzzy',
      },
      // 흰 주둥이 (코와 입이 여기 붙는다)
      {
        slot: 'head',
        shape: 'sphere',
        at: [0, 0.675, 0.31],
        size: [0.15, 0.085, 0.07],
        color: WHITE,
        finish: 'fuzzy',
      },
      // 이마 줄무늬: 가운데 하나와 양옆 짧은 둘
      {
        slot: 'head',
        shape: 'capsule',
        at: [0, 0.955, 0.31],
        size: [0.028, 0.07, 0.018],
        rot: [-42, 0, 0],
        color: CAT_POINT,
        finish: 'fuzzy',
      },
      {
        slot: 'head',
        shape: 'capsule',
        at: [-0.085, 0.94, 0.305],
        size: [0.024, 0.052, 0.018],
        rot: [-40, 0, 16],
        color: CAT_POINT,
        finish: 'fuzzy',
        mirror: true,
      },
      {
        slot: 'earL',
        shape: 'cone',
        at: [-0.25, 1.03, 0],
        size: [0.12, 0.14, 0.07],
        rot: [0, 0, 22],
        color: CAT,
        finish: 'fuzzy',
        inner: '#ffb3c4',
        mirror: true,
      },
      ...dollArms(CAT, WHITE, 'fuzzy'),
      ...dollLegs(CAT, WHITE, 'fuzzy'),
      {
        slot: 'tail',
        shape: 'capsule',
        at: [0, 0.36, -0.36],
        size: [0.05, 0.2, 0.05],
        rot: [-35, 0, 0],
        color: CAT,
        finish: 'fuzzy',
      },
      { slot: 'tail', shape: 'sphere', at: [0, 0.53, -0.48], size: [0.062, 0.062, 0.062], color: CAT_POINT },
    ],
    face: {
      slot: 'head',
      eyeY: 0.79,
      eyeGap: 0.15,
      eyeSize: 0.05,
      mouth: 'cat',
      mouthY: 0.67,
      blush: '#ffa0b4',
      whiskers: '#a3aac0',
      nose: { shape: 'triangle', color: '#f39aac' },
    },
    // 두 발로 선다: 팔은 흔들고 뒷발로 걷는다 (네 발 걷기는 설정에서 고를 수 있다)
    gait: 'biped',
  },
  // 삐약이: 동그란 병아리, 날개, 주황 부리와 발, 머리 깃털
  chick: {
    v: 1,
    // 복슬복슬 모습의 털 (blueprint.ts Fur)
    fur: { length: 0.45, clump: 0.15 },
    parts: [
      { slot: 'body', shape: 'sphere', at: [0, 0.44, 0], size: [0.48, 0.44, 0.45], color: CHICK },
      {
        slot: 'wingL',
        shape: 'sphere',
        at: [-0.46, 0.42, -0.02],
        size: [0.08, 0.19, 0.15],
        rot: [0, 0, -20],
        color: '#ffd24d',
        mirror: true,
      },
      {
        slot: 'legL',
        shape: 'sphere',
        at: [-0.14, 0.025, 0.12],
        size: [0.09, 0.025, 0.1],
        color: '#ff9f43',
        mirror: true,
      },
      { slot: 'top', shape: 'capsule', at: [0, 0.93, 0], size: [0.016, 0.06, 0.016], color: '#f2c200' },
      {
        slot: 'top',
        shape: 'capsule',
        at: [-0.04, 0.91, 0],
        size: [0.016, 0.05, 0.016],
        rot: [0, 0, 28],
        color: '#f2c200',
        mirror: true,
      },
      {
        slot: 'tail',
        shape: 'cone',
        at: [0, 0.36, -0.44],
        size: [0.1, 0.1, 0.05],
        rot: [-70, 0, 0],
        color: '#ffd24d',
      },
    ],
    face: {
      slot: 'body',
      eyeY: 0.56,
      eyeGap: 0.17,
      eyeSize: 0.05,
      mouth: 'beak',
      mouthY: 0.46,
      mouthColor: '#ff9f43',
      blush: '#ff9a8a',
    },
  },
  // 멍멍이: 크림빛 흰 강아지 인형 몸. 머리 옆에서 늘어진 캐러멜 귀, 한쪽 눈 얼룩, 도톰한 주둥이에 까만 코, 짧게 선 캐러멜 꼬리.
  // 두 발로 선다
  dog: {
    v: 2,
    // 복슬복슬 모습의 털 (blueprint.ts Fur)
    fur: { length: 0.45, clump: 0.25 },
    parts: [
      {
        slot: 'body',
        shape: 'sphere',
        at: DOLL_BODY_AT,
        size: [0.31, 0.26, 0.28],
        color: DOG,
        finish: 'fuzzy',
      },
      {
        slot: 'head',
        shape: 'sphere',
        at: DOLL_HEAD_AT,
        size: [0.41, 0.33, 0.35],
        color: DOG,
        finish: 'fuzzy',
      },
      // 주둥이 (코와 입이 여기 붙는다)
      {
        slot: 'head',
        shape: 'sphere',
        at: [0, 0.665, 0.3],
        size: [0.16, 0.1, 0.095],
        color: CREAM,
        finish: 'fuzzy',
      },
      // 보는 사람 왼쪽 눈의 얼룩 (눈이 이 위에 붙는다)
      {
        slot: 'head',
        shape: 'sphere',
        at: [-0.15, 0.8, 0.31],
        size: [0.105, 0.09, 0.06],
        rot: [0, 0, -12],
        color: DOG_SPOT,
        finish: 'fuzzy',
      },
      {
        slot: 'earL',
        shape: 'capsule',
        at: [-0.37, 0.82, 0.02],
        size: [0.085, 0.18, 0.1],
        rot: [0, 0, -20],
        color: DOG_SPOT,
        finish: 'fuzzy',
        mirror: true,
      },
      ...dollArms(DOG, CREAM, 'fuzzy'),
      ...dollLegs(DOG, CREAM, 'fuzzy'),
      {
        slot: 'tail',
        shape: 'capsule',
        at: [0, 0.42, -0.34],
        size: [0.05, 0.12, 0.05],
        rot: [-40, 0, 0],
        color: DOG_SPOT,
        finish: 'fuzzy',
      },
    ],
    face: {
      slot: 'head',
      eyeY: 0.8,
      eyeGap: 0.15,
      eyeSize: 0.052,
      mouth: 'smile',
      mouthY: 0.635,
      blush: '#ff9e8f',
      nose: { shape: 'oval', color: '#3a2c28', y: 0.7 },
    },
    // 두 발로 선다: 팔은 흔들고 뒷발로 걷는다 (네 발 걷기는 설정에서 고를 수 있다)
    gait: 'biped',
  },
  // 토순이: 긴 귀(안쪽 분홍), 큰 발, 배 앞에 모은 앞발, 솜뭉치 꼬리
  bunny: {
    v: 1,
    // 복슬복슬 모습의 털 (blueprint.ts Fur)
    fur: { length: 0.55, clump: 0.2 },
    parts: [
      {
        slot: 'body',
        shape: 'sphere',
        at: [0, 0.3, 0],
        size: [0.34, 0.3, 0.31],
        color: BUNNY,
        finish: 'fuzzy',
      },
      {
        slot: 'body',
        shape: 'sphere',
        at: [0, 0.27, 0.17],
        size: [0.2, 0.19, 0.14],
        color: '#fffafa',
        finish: 'fuzzy',
      },
      {
        slot: 'head',
        shape: 'sphere',
        at: [0, 0.7, 0.03],
        size: [0.4, 0.33, 0.35],
        color: BUNNY,
        finish: 'fuzzy',
      },
      {
        slot: 'earL',
        shape: 'capsule',
        at: [-0.13, 1.12, -0.02],
        size: [0.075, 0.24, 0.05],
        rot: [0, 0, 10],
        color: BUNNY,
        finish: 'fuzzy',
        mirror: true,
      },
      {
        slot: 'earL',
        shape: 'capsule',
        at: [-0.135, 1.13, 0.025],
        size: [0.04, 0.18, 0.02],
        rot: [0, 0, 10],
        color: '#ffb8c6',
        mirror: true,
      },
      {
        slot: 'armL',
        shape: 'sphere',
        at: [-0.15, 0.4, 0.25],
        size: [0.065, 0.06, 0.06],
        color: BUNNY,
        finish: 'fuzzy',
        mirror: true,
      },
      {
        slot: 'legL',
        shape: 'sphere',
        at: [-0.15, 0.05, 0.15],
        size: [0.1, 0.06, 0.14],
        color: BUNNY,
        finish: 'fuzzy',
        mirror: true,
      },
      {
        slot: 'tail',
        shape: 'sphere',
        at: [0, 0.22, -0.32],
        size: [0.1, 0.1, 0.1],
        color: '#fffafa',
        finish: 'fuzzy',
      },
    ],
    face: {
      slot: 'head',
      eyeY: 0.72,
      eyeGap: 0.15,
      eyeSize: 0.05,
      mouth: 'cat',
      mouthY: 0.62,
      blush: '#ffa3b5',
      whiskers: '#c9b9bf',
    },
    // 네 발 동물: 걸을 때 앞으로 숙여 네 발로 걷는다 (뒷발은 앞발을 본떠 그린다, pet3d.ts)
    gait: 'quadruped',
  },
  // 햄찌: 노릇한 황금빛 인형 몸. 큰 머리에 통통한 흰 볼, 작은 동그란 귀(안쪽 분홍), 분홍 코와 고양이 입 아래 앞니 둘.
  // 흰 배, 분홍 손과 발, 작은 꼬리
  hamster: {
    v: 2,
    // 복슬복슬 모습의 털 (blueprint.ts Fur)
    fur: { length: 0.4, clump: 0.2 },
    parts: [
      {
        slot: 'body',
        shape: 'sphere',
        at: DOLL_BODY_AT,
        size: [0.34, 0.27, 0.3],
        color: HAMSTER,
        finish: 'fuzzy',
      },
      // 흰 배
      {
        slot: 'body',
        shape: 'sphere',
        at: [0, 0.35, 0.14],
        size: [0.23, 0.2, 0.17],
        color: WHITE,
        finish: 'fuzzy',
      },
      {
        slot: 'head',
        shape: 'sphere',
        at: [0, 0.76, 0.03],
        size: [0.43, 0.34, 0.36],
        color: HAMSTER,
        finish: 'fuzzy',
      },
      // 볼 주머니 (통통한 볼)
      {
        slot: 'head',
        shape: 'sphere',
        at: [-0.22, 0.66, 0.25],
        size: [0.15, 0.11, 0.1],
        color: WHITE,
        finish: 'fuzzy',
        mirror: true,
      },
      // 앞니 둘 (입 바로 아래)
      {
        slot: 'head',
        shape: 'box',
        at: [-0.017, 0.625, 0.372],
        size: [0.016, 0.026, 0.014],
        color: '#ffffff',
        finish: 'shiny',
        mirror: true,
      },
      {
        slot: 'earL',
        shape: 'sphere',
        at: [-0.27, 1.0, -0.02],
        size: [0.09, 0.09, 0.04],
        color: HAMSTER,
        finish: 'fuzzy',
        inner: '#ffb3c1',
        mirror: true,
      },
      ...dollArms(HAMSTER, PINK_PAW, 'fuzzy'),
      ...dollLegs(HAMSTER, PINK_PAW, 'fuzzy'),
      { slot: 'tail', shape: 'sphere', at: [0, 0.25, -0.3], size: [0.045, 0.045, 0.045], color: HAMSTER },
    ],
    face: {
      slot: 'head',
      eyeY: 0.79,
      eyeGap: 0.17,
      eyeSize: 0.05,
      mouth: 'cat',
      mouthY: 0.66,
      blush: '#ff9fae',
      nose: { shape: 'dot', color: '#f08aa0' },
    },
  },
  // 뒤뚱이: 남색 인형 몸. 머리 앞 흰 얼굴에 작은 주황 부리, 흰 배, 양옆 짧은 날개(손), 짧은 주황 다리와 넓적한 발
  penguin: {
    v: 2,
    // 복슬복슬 모습의 털 (blueprint.ts Fur)
    fur: { length: 0.3, clump: 0.1 },
    parts: [
      { slot: 'body', shape: 'sphere', at: DOLL_BODY_AT, size: [0.32, 0.27, 0.29], color: PENGUIN },
      // 흰 배
      { slot: 'body', shape: 'sphere', at: [0, 0.35, 0.1], size: [0.24, 0.22, 0.21], color: WHITE },
      { slot: 'head', shape: 'sphere', at: DOLL_HEAD_AT, size: [0.4, 0.33, 0.35], color: PENGUIN },
      // 흰 얼굴 (눈과 부리가 여기 붙는다)
      { slot: 'head', shape: 'sphere', at: [0, 0.73, 0.13], size: [0.32, 0.27, 0.27], color: WHITE },
      {
        slot: 'wingL',
        shape: 'sphere',
        at: [-0.34, 0.38, 0],
        size: [0.06, 0.17, 0.12],
        rot: [0, 0, -18],
        color: PENGUIN_WING,
        mirror: true,
      },
      {
        slot: 'legL',
        shape: 'capsule',
        at: [-0.12, 0.11, 0.04],
        size: [0.05, 0.07, 0.05],
        color: PENGUIN_FEET,
        mirror: true,
      },
      {
        slot: 'legL',
        shape: 'sphere',
        at: [-0.12, 0.03, 0.1],
        size: [0.095, 0.03, 0.12],
        color: PENGUIN_FEET,
        mirror: true,
      },
      {
        slot: 'tail',
        shape: 'cone',
        at: [0, 0.17, -0.28],
        size: [0.08, 0.08, 0.04],
        rot: [-70, 0, 0],
        color: PENGUIN,
      },
    ],
    face: {
      slot: 'head',
      eyeY: 0.78,
      eyeGap: 0.14,
      eyeSize: 0.05,
      mouth: 'beak',
      mouthY: 0.7,
      mouthColor: PENGUIN_FEET,
      blush: '#ff9fae',
    },
  },
  // 곰돌이: 밀크초코 인형 몸. 머리 위 동그란 귀(안쪽 크림), 크림 주둥이에 까만 코, 크림 배, 짧은 팔다리, 작은 동그란 꼬리
  bear: {
    v: 2,
    // 복슬복슬 모습의 털 (blueprint.ts Fur)
    fur: { length: 0.5, clump: 0.3 },
    parts: [
      {
        slot: 'body',
        shape: 'sphere',
        at: DOLL_BODY_AT,
        size: [0.32, 0.27, 0.29],
        color: BEAR,
        finish: 'fuzzy',
      },
      // 크림 배
      {
        slot: 'body',
        shape: 'sphere',
        at: [0, 0.35, 0.14],
        size: [0.2, 0.18, 0.16],
        color: BEAR_MUZZLE,
        finish: 'fuzzy',
      },
      {
        slot: 'head',
        shape: 'sphere',
        at: DOLL_HEAD_AT,
        size: [0.41, 0.33, 0.35],
        color: BEAR,
        finish: 'fuzzy',
      },
      // 주둥이 (코와 입이 여기 붙는다)
      {
        slot: 'head',
        shape: 'sphere',
        at: [0, 0.67, 0.31],
        size: [0.16, 0.105, 0.085],
        color: BEAR_MUZZLE,
        finish: 'fuzzy',
      },
      {
        slot: 'earL',
        shape: 'sphere',
        at: [-0.29, 1.0, -0.02],
        size: [0.12, 0.12, 0.06],
        color: BEAR,
        finish: 'fuzzy',
        inner: BEAR_MUZZLE,
        mirror: true,
      },
      ...dollArms(BEAR, BEAR_PAW, 'fuzzy'),
      ...dollLegs(BEAR, BEAR_PAW, 'fuzzy'),
      {
        slot: 'tail',
        shape: 'sphere',
        at: [0, 0.25, -0.29],
        size: [0.07, 0.07, 0.07],
        color: BEAR,
        finish: 'fuzzy',
      },
    ],
    face: {
      slot: 'head',
      eyeY: 0.8,
      eyeGap: 0.16,
      eyeSize: 0.05,
      mouth: 'smile',
      mouthY: 0.655,
      blush: '#ff9e8f',
      nose: { shape: 'oval', color: '#3a2c28', y: 0.71, size: 1.15 },
    },
  },
};
