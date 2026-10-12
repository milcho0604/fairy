// 기본 펫의 입체 설계도 (6단계). 2D 그림(draw.ts)과 같은 색에서 시작했다.
// 콩이, 삐약이처럼 동그란 몸 하나가 곧 얼굴인 모양이 기본이다 (토순이만 머리와 몸이 따로인 피규어).
import type { PetKind } from '../settings.ts';
import type { Blueprint } from './blueprint.ts';

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
const BEAR = '#b98559';
const BEAR_MUZZLE = '#f6e3c9';
const BEAR_PAW = '#e9c49c';

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
  // 냥이: 콩이처럼 동그란 몸 하나가 곧 얼굴 (2026-10-12, 예전 큰 머리와 작은 몸 피규어는 화면에서 작고 흐릿했다).
  // 끝이 둥근 세모 귀(안쪽 분홍), 흰 배와 흰 발, 분홍 세모 코와 고양이 입, 짧은 수염. 두 발로 서서 짧은 팔(흰 발 손)이 있다
  // (모든 펫은 손이 있어야 한다, 2026-10-11 사용자 규칙: 흔들고, 들고, 춤춘다)
  cat: {
    v: 2,
    // 복슬복슬 모습의 털 (blueprint.ts Fur)
    fur: { length: 0.6, clump: 0.35 },
    parts: [
      {
        slot: 'body',
        shape: 'sphere',
        at: [0, 0.46, 0],
        size: [0.55, 0.45, 0.47],
        color: CAT,
        finish: 'fuzzy',
        pattern: { type: 'split', side: 'bottom', color: WHITE, amount: 0.32 },
      },
      {
        slot: 'earL',
        shape: 'cone',
        at: [-0.3, 0.9, -0.02],
        size: [0.13, 0.13, 0.08],
        rot: [0, 0, 24],
        color: CAT,
        finish: 'fuzzy',
        inner: '#ffb3c4',
        mirror: true,
      },
      {
        slot: 'armL',
        shape: 'sphere',
        at: [-0.52, 0.37, 0.07],
        size: [0.085, 0.125, 0.085],
        rot: [0, 0, 25],
        color: WHITE,
        finish: 'fuzzy',
        mirror: true,
      },
      {
        slot: 'legL',
        shape: 'sphere',
        at: [-0.21, 0.06, 0.17],
        size: [0.12, 0.07, 0.14],
        color: WHITE,
        finish: 'fuzzy',
        mirror: true,
      },
      {
        slot: 'tail',
        shape: 'capsule',
        at: [0, 0.34, -0.5],
        size: [0.055, 0.2, 0.055],
        rot: [-35, 0, 0],
        color: CAT,
        finish: 'fuzzy',
      },
      { slot: 'tail', shape: 'sphere', at: [0, 0.51, -0.62], size: [0.065, 0.065, 0.065], color: CAT_POINT },
    ],
    face: {
      slot: 'body',
      eyeY: 0.52,
      eyeGap: 0.19,
      eyeSize: 0.052,
      mouth: 'cat',
      mouthY: 0.42,
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
  // 멍멍이: 콩이처럼 동그란 몸 하나가 곧 얼굴 (2026-10-12, 예전 시바 피규어는 목줄, 이름표, 주둥이로 어수선하고 작았다).
  // 크림빛 흰 강아지에 머리 위에서 늘어진 캐러멜 귀, 한쪽 눈 얼룩, 까만 코, 짧게 선 꼬리.
  // 두 발로 서서 짧은 팔(흰 발 손)이 있다 (모든 펫은 손이 있어야 한다, 2026-10-11 사용자 규칙)
  dog: {
    v: 2,
    // 복슬복슬 모습의 털 (blueprint.ts Fur)
    fur: { length: 0.45, clump: 0.25 },
    parts: [
      {
        slot: 'body',
        shape: 'sphere',
        at: [0, 0.46, 0],
        size: [0.56, 0.46, 0.48],
        color: DOG,
        finish: 'fuzzy',
      },
      // 보는 사람 왼쪽 눈의 얼룩 (눈이 이 위에 붙는다)
      {
        slot: 'body',
        shape: 'sphere',
        at: [-0.19, 0.535, 0.4],
        size: [0.13, 0.11, 0.07],
        rot: [0, 0, -12],
        color: DOG_SPOT,
        finish: 'fuzzy',
      },
      {
        slot: 'earL',
        shape: 'capsule',
        at: [-0.44, 0.7, 0.05],
        size: [0.1, 0.18, 0.09],
        rot: [0, 0, -26],
        color: DOG_SPOT,
        finish: 'fuzzy',
        mirror: true,
      },
      {
        slot: 'armL',
        shape: 'sphere',
        at: [-0.53, 0.37, 0.06],
        size: [0.09, 0.13, 0.09],
        rot: [0, 0, 25],
        color: CREAM,
        finish: 'fuzzy',
        mirror: true,
      },
      {
        slot: 'legL',
        shape: 'sphere',
        at: [-0.22, 0.06, 0.16],
        size: [0.13, 0.07, 0.15],
        color: CREAM,
        finish: 'fuzzy',
        mirror: true,
      },
      {
        slot: 'tail',
        shape: 'capsule',
        at: [0, 0.42, -0.5],
        size: [0.06, 0.13, 0.06],
        rot: [-40, 0, 0],
        color: DOG_SPOT,
        finish: 'fuzzy',
      },
    ],
    face: {
      slot: 'body',
      eyeY: 0.52,
      eyeGap: 0.19,
      eyeSize: 0.052,
      mouth: 'smile',
      mouthY: 0.4,
      blush: '#ff9e8f',
      nose: { shape: 'oval', color: '#3a2c28', y: 0.455 },
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
  // 햄찌: 노릇한 황금빛 동그란 몸에 흰 볼 주머니와 흰 배, 작은 동그란 귀(안쪽 분홍), 분홍 코와 고양이 입, 배 앞에 모은 분홍 손
  hamster: {
    v: 2,
    // 복슬복슬 모습의 털 (blueprint.ts Fur)
    fur: { length: 0.4, clump: 0.2 },
    parts: [
      {
        slot: 'body',
        shape: 'sphere',
        at: [0, 0.44, 0],
        size: [0.58, 0.44, 0.5],
        color: HAMSTER,
        finish: 'fuzzy',
        pattern: { type: 'split', side: 'bottom', color: WHITE, amount: 0.42 },
      },
      // 볼 주머니 (통통한 볼)
      {
        slot: 'body',
        shape: 'sphere',
        at: [-0.27, 0.37, 0.3],
        size: [0.2, 0.15, 0.16],
        color: WHITE,
        finish: 'fuzzy',
        mirror: true,
      },
      {
        slot: 'earL',
        shape: 'sphere',
        at: [-0.3, 0.86, -0.02],
        size: [0.1, 0.1, 0.045],
        color: HAMSTER,
        finish: 'fuzzy',
        inner: '#ffb3c1',
        mirror: true,
      },
      {
        slot: 'armL',
        shape: 'sphere',
        at: [-0.17, 0.27, 0.45],
        size: [0.06, 0.055, 0.05],
        color: PINK_PAW,
        mirror: true,
      },
      {
        slot: 'legL',
        shape: 'sphere',
        at: [-0.22, 0.04, 0.2],
        size: [0.1, 0.045, 0.12],
        color: PINK_PAW,
        mirror: true,
      },
      { slot: 'tail', shape: 'sphere', at: [0, 0.2, -0.5], size: [0.05, 0.05, 0.05], color: HAMSTER },
    ],
    face: {
      slot: 'body',
      eyeY: 0.55,
      eyeGap: 0.2,
      eyeSize: 0.05,
      mouth: 'cat',
      mouthY: 0.44,
      blush: '#ff9fae',
      nose: { shape: 'dot', color: '#f08aa0' },
    },
  },
  // 뒤뚱이: 남색 동그란 몸에 흰 얼굴과 배, 작은 주황 부리와 발, 양옆 날개(손). 두 발로 뒤뚱 걷는다
  penguin: {
    v: 2,
    // 복슬복슬 모습의 털 (blueprint.ts Fur)
    fur: { length: 0.3, clump: 0.1 },
    parts: [
      { slot: 'body', shape: 'sphere', at: [0, 0.47, 0], size: [0.5, 0.47, 0.46], color: PENGUIN },
      // 흰 얼굴과 배 (눈과 부리가 여기 붙는다)
      { slot: 'body', shape: 'sphere', at: [0, 0.43, 0.13], size: [0.42, 0.39, 0.35], color: WHITE },
      {
        slot: 'wingL',
        shape: 'sphere',
        at: [-0.47, 0.42, 0],
        size: [0.07, 0.21, 0.15],
        rot: [0, 0, -18],
        color: PENGUIN_WING,
        mirror: true,
      },
      {
        slot: 'legL',
        shape: 'sphere',
        at: [-0.15, 0.025, 0.14],
        size: [0.1, 0.025, 0.12],
        color: '#ffad4d',
        mirror: true,
      },
      {
        slot: 'tail',
        shape: 'cone',
        at: [0, 0.16, -0.44],
        size: [0.09, 0.09, 0.045],
        rot: [-70, 0, 0],
        color: PENGUIN,
      },
    ],
    face: {
      slot: 'body',
      eyeY: 0.56,
      eyeGap: 0.17,
      eyeSize: 0.05,
      mouth: 'beak',
      mouthY: 0.47,
      mouthColor: '#ffad4d',
      blush: '#ff9fae',
    },
  },
  // 곰돌이: 밀크초코 동그란 몸에 크림 주둥이와 까만 코, 머리 위 동그란 귀(안쪽 크림), 짧은 팔, 작은 동그란 꼬리
  bear: {
    v: 2,
    // 복슬복슬 모습의 털 (blueprint.ts Fur)
    fur: { length: 0.5, clump: 0.3 },
    parts: [
      {
        slot: 'body',
        shape: 'sphere',
        at: [0, 0.46, 0],
        size: [0.56, 0.46, 0.48],
        color: BEAR,
        finish: 'fuzzy',
      },
      // 주둥이 (코와 입이 여기 붙는다)
      {
        slot: 'body',
        shape: 'sphere',
        at: [0, 0.405, 0.4],
        size: [0.18, 0.12, 0.1],
        color: BEAR_MUZZLE,
        finish: 'fuzzy',
      },
      {
        slot: 'earL',
        shape: 'sphere',
        at: [-0.35, 0.84, -0.02],
        size: [0.14, 0.14, 0.07],
        color: BEAR,
        finish: 'fuzzy',
        inner: BEAR_MUZZLE,
        mirror: true,
      },
      {
        slot: 'armL',
        shape: 'sphere',
        at: [-0.53, 0.38, 0.05],
        size: [0.09, 0.14, 0.09],
        rot: [0, 0, 25],
        color: BEAR,
        finish: 'fuzzy',
        mirror: true,
      },
      {
        slot: 'legL',
        shape: 'sphere',
        at: [-0.22, 0.06, 0.16],
        size: [0.13, 0.07, 0.15],
        color: BEAR_PAW,
        finish: 'fuzzy',
        mirror: true,
      },
      {
        slot: 'tail',
        shape: 'sphere',
        at: [0, 0.22, -0.48],
        size: [0.08, 0.08, 0.08],
        color: BEAR,
        finish: 'fuzzy',
      },
    ],
    face: {
      slot: 'body',
      eyeY: 0.545,
      eyeGap: 0.2,
      eyeSize: 0.05,
      mouth: 'smile',
      mouthY: 0.385,
      blush: '#ff9e8f',
      nose: { shape: 'oval', color: '#3a2c28', y: 0.45, size: 1.15 },
    },
  },
};
