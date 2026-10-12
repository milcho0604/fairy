// 기본 펫의 입체 설계도 (6단계). 2D 그림(draw.ts)과 같은 색에서 시작했다.
// 피규어, 게임: 콩이, 삐약이처럼 동그란 몸 하나가 곧 얼굴인 모양이 기본이다 (토순이만 머리와 몸이 따로인 피규어).
// 냥이, 멍멍이, 햄찌, 뒤뚱이, 곰돌이는 동그란 몸 아래에 짧은 다리와 발을 달아 걸을 때 번갈아 딛는 게 보인다.
// 실사, 복슬복슬: 그 다섯은 실제 동물 비율이다 (REAL_BLUEPRINTS. 네 발 동물은 밀크, 초코처럼 네 발로 서고 펭귄은 서서 뒤뚱).
// 2026-10-12 이슈 #53 사용자 결정: 피규어, 게임은 동그란 몸이 더 귀엽고, 실사는 실제처럼
import type { PetKind, PetStyle } from '../settings.ts';
import type { Blueprint, Finish, Part, Vec3 } from './blueprint.ts';

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
const BEAR_SOLE = '#6e4a30';
const PENGUIN_FEET = '#ffad4d';

/** 다리를 달기 전 동그란 몸 (피규어, 게임). 냥이, 멍멍이, 햄찌, 뒤뚱이, 곰돌이는 아래 onLegs 로 다리를 단다 */
const ROUND: Record<PetKind, Blueprint> = {
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
      // 이마 줄무늬: 가운데 하나와 양옆 짧은 둘 (2D 그림처럼)
      {
        slot: 'body',
        shape: 'capsule',
        at: [0, 0.74, 0.355],
        size: [0.03, 0.075, 0.02],
        rot: [-40, 0, 0],
        color: CAT_POINT,
        finish: 'fuzzy',
      },
      {
        slot: 'body',
        shape: 'capsule',
        at: [-0.095, 0.725, 0.345],
        size: [0.026, 0.056, 0.02],
        rot: [-38, 0, 16],
        color: CAT_POINT,
        finish: 'fuzzy',
        mirror: true,
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
      // 앞니 둘 (입 바로 아래)
      {
        slot: 'body',
        shape: 'box',
        at: [-0.018, 0.41, 0.49],
        size: [0.017, 0.028, 0.014],
        color: '#ffffff',
        finish: 'shiny',
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

const fin = (finish?: Finish) => (finish ? { finish } : {});
const up = (v: Vec3, dy: number): Vec3 => [v[0], v[1] + dy, v[2]];

/**
 * 동그란 몸을 lift 만큼 띄우고 그 아래에 짧은 다리(캡슐)와 앞으로 나온 발을 단다 (원래 납작한 발은 뺀다).
 * 다리 위쪽은 몸 속에 묻혀 붙어 보이고, 관절(다리 위)에서 발바닥까지 0.2 쯤이라 걸을 때 관절에서 돌려 번갈아 딛는다
 * (pet3d-gait.ts swingShare, bipedFoot). 예전 납작한 발은 몸 아래에 묻혀 걸어도 발끝만 보였다 (이슈 #53)
 */
function onLegs(
  bp: Blueprint,
  o: { lift: number; x: number; z: number; leg: string; foot: string; r?: number; finish?: Finish },
): Blueprint {
  const r = o.r ?? 0.075;
  const parts: Part[] = bp.parts
    .filter((p) => p.slot !== 'legL' && p.slot !== 'legR')
    .map((p) => ({
      ...p,
      at: up(p.at, o.lift),
      ...(p.path ? { path: p.path.map((v) => up(v, o.lift)) } : {}),
    }));
  parts.push(
    {
      slot: 'legL',
      shape: 'capsule',
      at: [-o.x, 0.12, o.z],
      size: [r, 0.09, r],
      color: o.leg,
      ...fin(o.finish),
      mirror: true,
    },
    {
      slot: 'legL',
      shape: 'sphere',
      at: [-o.x, 0.045, o.z + 0.05],
      size: [r * 1.3, 0.05, r * 1.6],
      color: o.foot,
      ...fin(o.finish),
      mirror: true,
    },
  );
  const f = bp.face;
  return {
    ...bp,
    parts,
    face: {
      ...f,
      eyeY: f.eyeY + o.lift,
      mouthY: f.mouthY + o.lift,
      ...(f.nose?.y !== undefined ? { nose: { ...f.nose, y: f.nose.y + o.lift } } : {}),
      ...(f.brows?.y !== undefined ? { brows: { ...f.brows, y: f.brows.y + o.lift } } : {}),
    },
  };
}

/** 피규어, 게임 모습의 기본 펫 설계도 */
export const DEFAULT_BLUEPRINTS: Record<PetKind, Blueprint> = {
  ...ROUND,
  cat: onLegs(ROUND.cat, { lift: 0.09, x: 0.2, z: 0.12, leg: CAT, foot: WHITE, finish: 'fuzzy' }),
  dog: onLegs(ROUND.dog, { lift: 0.09, x: 0.2, z: 0.12, leg: DOG, foot: CREAM, finish: 'fuzzy' }),
  hamster: onLegs(ROUND.hamster, {
    lift: 0.09,
    x: 0.21,
    z: 0.13,
    leg: HAMSTER,
    foot: PINK_PAW,
    finish: 'fuzzy',
  }),
  penguin: onLegs(ROUND.penguin, {
    lift: 0.09,
    x: 0.16,
    z: 0.1,
    leg: PENGUIN_FEET,
    foot: PENGUIN_FEET,
    r: 0.055,
  }),
  bear: onLegs(ROUND.bear, { lift: 0.09, x: 0.2, z: 0.12, leg: BEAR, foot: BEAR_PAW, finish: 'fuzzy' }),
};

/**
 * 네 발로 선 몸의 네 다리 (밀크 뼈대를 본뜬다, starters.ts). 앞다리는 어깨 윗마디, 팔꿈치 공, 아랫마디, 발.
 * 뒷다리는 넓적다리, 무릎 공, 정강이, 발. knee 칸이 있는 것이 무릎 아래 마디다 (pet3d.ts buildStance 가 다리를 다시 짠다).
 * k 는 다리 높이 배율(발은 그대로 바닥에), t 는 굵기 배율
 */
function quadLegs(o: {
  x: number;
  xb: number;
  zf: number;
  zb: number;
  k: number;
  t: number;
  color: string;
  paw: string;
  finish?: Finish;
}): Part[] {
  const { k, t, color } = o;
  const leg = (p: Omit<Part, 'slot' | 'mirror'>): Part => ({
    slot: 'legL',
    ...p,
    ...fin(o.finish),
    mirror: true,
  });
  return [
    leg({
      shape: 'capsule',
      at: [-o.x, 0.31 * k, o.zf],
      size: [0.062 * t, 0.11 * k, 0.062 * t],
      rot: [0, 0, 180],
      taper: 0.76,
      color,
    }),
    leg({
      shape: 'sphere',
      at: [-o.x, 0.21 * k, o.zf - 0.005],
      size: [0.047 * t, 0.047 * t, 0.047 * t],
      color,
      knee: true,
    }),
    leg({
      shape: 'capsule',
      at: [-o.x, 0.125 * k, o.zf + 0.005],
      size: [0.045 * t, 0.09 * k, 0.045 * t],
      color,
      knee: true,
    }),
    leg({
      shape: 'sphere',
      at: [-o.x, 0.04, o.zf + 0.025],
      size: [0.053 * t, 0.04, 0.065 * t],
      color: o.paw,
      knee: true,
    }),
    leg({ shape: 'sphere', at: [-o.xb, 0.35 * k, o.zb], size: [0.085 * t, 0.13 * k, 0.115 * t], color }),
    leg({
      shape: 'sphere',
      at: [-o.xb, 0.21 * k, o.zb + 0.05],
      size: [0.047 * t, 0.047 * t, 0.047 * t],
      color,
      knee: true,
    }),
    leg({
      shape: 'capsule',
      at: [-o.xb, 0.125 * k, o.zb],
      size: [0.045 * t, 0.1 * k, 0.045 * t],
      rot: [28, 0, 0],
      color,
      knee: true,
    }),
    leg({
      shape: 'sphere',
      at: [-o.xb, 0.04, o.zb - 0.035],
      size: [0.053 * t, 0.04, 0.066 * t],
      color: o.paw,
      knee: true,
    }),
  ];
}

type RealKind = 'cat' | 'dog' | 'hamster' | 'penguin' | 'bear';

/**
 * 실사, 복슬복슬 모습의 냥이, 멍멍이, 햄찌, 뒤뚱이, 곰돌이: 실제 동물 비율. 색과 특징은 동그란 몸과 같다
 * (냥이 이마 줄무늬, 멍멍이 늘어진 귀와 눈 얼룩, 햄찌 앞니와 볼, 뒤뚱이 흰 얼굴, 곰돌이 둥근 귀와 주둥이)
 */
export const REAL_BLUEPRINTS: Record<RealKind, Blueprint> = {
  // 고양이: 밀크 뼈대에 짧은 털, 하늘빛 회색, 흰 가슴과 발, 끝이 진한 긴 꼬리
  cat: {
    v: 2,
    stance: 'stand',
    gait: 'quadruped',
    fur: { length: 0.5, clump: 0.3 },
    motion: { bounce: 0.55, tailWag: 0.8, earWiggle: 1 },
    parts: [
      {
        slot: 'body',
        shape: 'capsule',
        at: [0, 0.42, -0.03],
        size: [0.18, 0.3, 0.19],
        rot: [90, 0, 0],
        color: CAT,
        finish: 'fuzzy',
      },
      {
        slot: 'body',
        shape: 'sphere',
        at: [0, 0.46, 0.19],
        size: [0.18, 0.2, 0.145],
        color: CAT,
        finish: 'fuzzy',
        pattern: { type: 'split', side: 'front', color: WHITE, amount: 0.35 },
      },
      {
        slot: 'head',
        shape: 'sphere',
        at: [0, 0.66, 0.35],
        size: [0.15, 0.135, 0.13],
        color: CAT,
        finish: 'fuzzy',
      },
      // 볼 털 (얼굴이 둥글고 넓게)
      {
        slot: 'head',
        shape: 'sphere',
        at: [0, 0.61, 0.36],
        size: [0.16, 0.085, 0.105],
        color: CAT,
        finish: 'fuzzy',
      },
      // 흰 주둥이 (입과 코가 여기 붙는다)
      {
        slot: 'head',
        shape: 'sphere',
        at: [0, 0.61, 0.45],
        size: [0.065, 0.045, 0.04],
        color: WHITE,
        finish: 'fuzzy',
      },
      // 이마 줄무늬 셋
      {
        slot: 'head',
        shape: 'capsule',
        at: [0, 0.752, 0.44],
        size: [0.014, 0.034, 0.01],
        rot: [-55, 0, 0],
        color: CAT_POINT,
        finish: 'fuzzy',
      },
      {
        slot: 'head',
        shape: 'capsule',
        at: [-0.034, 0.744, 0.437],
        size: [0.012, 0.027, 0.01],
        rot: [-55, 0, 18],
        color: CAT_POINT,
        finish: 'fuzzy',
        mirror: true,
      },
      {
        slot: 'earL',
        shape: 'cone',
        at: [-0.085, 0.79, 0.33],
        size: [0.055, 0.075, 0.032],
        rot: [-8, 0, 24],
        color: CAT,
        finish: 'fuzzy',
        inner: '#ffb3c4',
        mirror: true,
      },
      ...quadLegs({
        x: 0.085,
        xb: 0.1,
        zf: 0.19,
        zb: -0.2,
        k: 1,
        t: 1,
        color: CAT,
        paw: WHITE,
        finish: 'fuzzy',
      }),
      {
        slot: 'tail',
        shape: 'tube',
        at: [0, 0.47, -0.33],
        size: [0.056, 0.056, 0.056],
        path: [
          [0, 0.47, -0.33],
          [0, 0.56, -0.45],
          [0, 0.72, -0.5],
          [0, 0.84, -0.45],
        ],
        taper: 0.7,
        color: CAT,
        finish: 'fuzzy',
      },
      {
        slot: 'tail',
        shape: 'sphere',
        at: [0, 0.85, -0.445],
        size: [0.04, 0.045, 0.04],
        color: CAT_POINT,
        finish: 'fuzzy',
      },
    ],
    face: {
      slot: 'head',
      eyeY: 0.685,
      eyeGap: 0.062,
      eyeSize: 0.036,
      eyeColor: '#a8bf6a',
      pupil: 'round',
      catchlight: 'big',
      mouth: 'cat',
      mouthY: 0.6,
      nose: { shape: 'triangle', color: '#f39aac', y: 0.632, size: 0.85 },
      whiskers: '#a3aac0',
      blush: '#ffa0b4',
      fluff: CAT,
    },
  },
  // 강아지: 초코 뼈대에 크림빛 흰 털, 늘어진 캐러멜 귀, 왼쪽 눈 얼룩, 크림 주둥이와 까만 코, 위로 선 캐러멜 꼬리
  dog: {
    v: 2,
    stance: 'stand',
    gait: 'quadruped',
    fur: { length: 0.45, clump: 0.25 },
    motion: { bounce: 1, tailWag: 1.4, earWiggle: 1.2 },
    parts: [
      {
        slot: 'body',
        shape: 'capsule',
        at: [0, 0.44, 0],
        size: [0.158, 0.25, 0.168],
        rot: [90, 0, 0],
        color: DOG,
        finish: 'fuzzy',
      },
      {
        slot: 'body',
        shape: 'sphere',
        at: [0, 0.47, 0.16],
        size: [0.145, 0.165, 0.12],
        color: DOG,
        finish: 'fuzzy',
      },
      // 목: 머리 아래를 어깨에 잇는다
      {
        slot: 'body',
        shape: 'capsule',
        at: [0, 0.64, 0.17],
        size: [0.105, 0.15, 0.095],
        rot: [50, 0, 0],
        color: DOG,
        finish: 'fuzzy',
      },
      {
        slot: 'head',
        shape: 'sphere',
        at: [0, 0.7, 0.3],
        size: [0.15, 0.145, 0.14],
        color: DOG,
        finish: 'fuzzy',
      },
      {
        slot: 'head',
        shape: 'sphere',
        at: [0, 0.79, 0.27],
        size: [0.12, 0.08, 0.11],
        color: DOG,
        finish: 'fuzzy',
      },
      // 주둥이 (입과 코가 여기 붙는다)
      {
        slot: 'head',
        shape: 'sphere',
        at: [0, 0.64, 0.42],
        size: [0.08, 0.065, 0.075],
        color: CREAM,
        finish: 'fuzzy',
      },
      // 보는 사람 왼쪽 눈의 얼룩 (눈이 이 위에 붙는다)
      {
        slot: 'head',
        shape: 'sphere',
        at: [-0.07, 0.715, 0.4],
        size: [0.055, 0.047, 0.03],
        rot: [0, 0, -12],
        color: DOG_SPOT,
        finish: 'fuzzy',
      },
      {
        slot: 'earL',
        shape: 'capsule',
        at: [-0.152, 0.64, 0.26],
        size: [0.062, 0.13, 0.075],
        rot: [0, 0, -10],
        color: DOG_SPOT,
        finish: 'fuzzy',
        mirror: true,
      },
      ...quadLegs({
        x: 0.08,
        xb: 0.09,
        zf: 0.15,
        zb: -0.17,
        k: 1,
        t: 1,
        color: DOG,
        paw: CREAM,
        finish: 'fuzzy',
      }),
      {
        slot: 'tail',
        shape: 'tube',
        at: [0, 0.5, -0.26],
        size: [0.04, 0.04, 0.04],
        path: [
          [0, 0.5, -0.26],
          [0, 0.6, -0.34],
          [0, 0.69, -0.33],
        ],
        taper: 0.65,
        color: DOG_SPOT,
        finish: 'fuzzy',
      },
    ],
    face: {
      slot: 'head',
      eyeY: 0.71,
      eyeGap: 0.07,
      eyeSize: 0.034,
      catchlight: 'big',
      pupil: 'round',
      mouth: 'smile',
      mouthY: 0.605,
      nose: { shape: 'oval', color: '#3a2c28', y: 0.648, size: 1.35 },
    },
  },
  // 햄스터: 둥글고 낮은 몸에 아주 짧은 네 다리, 머리가 몸에 붙어 있다. 흰 배와 볼, 앞니, 분홍 발
  hamster: {
    v: 2,
    stance: 'stand',
    gait: 'quadruped',
    fur: { length: 0.4, clump: 0.2 },
    motion: { bounce: 0.8, tailWag: 0.5, earWiggle: 1.2 },
    parts: [
      {
        slot: 'body',
        shape: 'sphere',
        at: [0, 0.25, -0.02],
        size: [0.2, 0.18, 0.26],
        color: HAMSTER,
        finish: 'fuzzy',
        pattern: { type: 'split', side: 'bottom', color: WHITE, amount: 0.35 },
      },
      {
        slot: 'head',
        shape: 'sphere',
        at: [0, 0.33, 0.2],
        size: [0.15, 0.14, 0.13],
        color: HAMSTER,
        finish: 'fuzzy',
      },
      // 볼 주머니
      {
        slot: 'head',
        shape: 'sphere',
        at: [-0.095, 0.28, 0.25],
        size: [0.075, 0.07, 0.075],
        color: WHITE,
        finish: 'fuzzy',
        mirror: true,
      },
      // 앞니 둘 (입 바로 아래)
      {
        slot: 'head',
        shape: 'box',
        at: [-0.009, 0.255, 0.31],
        size: [0.008, 0.014, 0.006],
        color: '#ffffff',
        finish: 'shiny',
        mirror: true,
      },
      {
        slot: 'earL',
        shape: 'sphere',
        at: [-0.085, 0.45, 0.17],
        size: [0.04, 0.04, 0.018],
        color: HAMSTER,
        finish: 'fuzzy',
        inner: '#ffb3c1',
        mirror: true,
      },
      ...quadLegs({ x: 0.1, xb: 0.11, zf: 0.13, zb: -0.16, k: 0.38, t: 0.85, color: HAMSTER, paw: PINK_PAW }),
      { slot: 'tail', shape: 'sphere', at: [0, 0.22, -0.27], size: [0.03, 0.03, 0.03], color: HAMSTER },
    ],
    face: {
      slot: 'head',
      eyeY: 0.36,
      eyeGap: 0.075,
      eyeSize: 0.03,
      catchlight: 'big',
      mouth: 'cat',
      mouthY: 0.27,
      nose: { shape: 'dot', color: '#f08aa0', y: 0.295 },
      whiskers: '#e8c9a8',
      blush: '#ff9fae',
    },
  },
  // 펭귄: 서서 뒤뚱 걷는 달걀 몸, 남색 머리 앞 흰 얼굴, 흰 배, 몸 옆 긴 날개, 짧은 다리에 넓적한 주황 발
  penguin: {
    v: 2,
    fur: { length: 0.2, clump: 0.05 },
    parts: [
      { slot: 'body', shape: 'sphere', at: [0, 0.45, 0], size: [0.27, 0.38, 0.25], color: PENGUIN },
      { slot: 'body', shape: 'sphere', at: [0, 0.42, 0.08], size: [0.22, 0.32, 0.19], color: WHITE },
      { slot: 'head', shape: 'sphere', at: [0, 0.86, 0.02], size: [0.18, 0.17, 0.17], color: PENGUIN },
      // 흰 얼굴 (눈과 부리가 여기 붙는다)
      { slot: 'head', shape: 'sphere', at: [0, 0.84, 0.08], size: [0.14, 0.12, 0.12], color: WHITE },
      {
        slot: 'wingL',
        shape: 'sphere',
        at: [-0.27, 0.5, 0],
        size: [0.035, 0.2, 0.09],
        rot: [0, 0, -12],
        color: PENGUIN_WING,
        mirror: true,
      },
      {
        slot: 'legL',
        shape: 'capsule',
        at: [-0.09, 0.06, 0.04],
        size: [0.04, 0.05, 0.04],
        color: PENGUIN_FEET,
        mirror: true,
      },
      {
        slot: 'legL',
        shape: 'sphere',
        at: [-0.09, 0.02, 0.1],
        size: [0.08, 0.02, 0.11],
        color: PENGUIN_FEET,
        mirror: true,
      },
      {
        slot: 'tail',
        shape: 'cone',
        at: [0, 0.12, -0.24],
        size: [0.07, 0.07, 0.035],
        rot: [-70, 0, 0],
        color: PENGUIN,
      },
    ],
    face: {
      slot: 'head',
      eyeY: 0.88,
      eyeGap: 0.065,
      eyeSize: 0.03,
      catchlight: 'big',
      mouth: 'beak',
      mouthY: 0.83,
      mouthColor: PENGUIN_FEET,
      blush: '#ff9fae',
    },
  },
  // 곰 새끼: 통통한 몸에 굵고 짧은 다리, 낮게 내민 큰 머리, 둥근 귀(안쪽 크림), 크림 주둥이와 까만 코
  bear: {
    v: 2,
    stance: 'stand',
    gait: 'quadruped',
    fur: { length: 0.45, clump: 0.3 },
    motion: { bounce: 0.7, tailWag: 0.4, earWiggle: 0.8 },
    parts: [
      {
        slot: 'body',
        shape: 'capsule',
        at: [0, 0.42, -0.02],
        size: [0.19, 0.24, 0.2],
        rot: [90, 0, 0],
        color: BEAR,
        finish: 'fuzzy',
      },
      {
        slot: 'body',
        shape: 'sphere',
        at: [0, 0.44, 0.17],
        size: [0.18, 0.19, 0.15],
        color: BEAR,
        finish: 'fuzzy',
      },
      {
        slot: 'head',
        shape: 'sphere',
        at: [0, 0.56, 0.34],
        size: [0.155, 0.145, 0.145],
        color: BEAR,
        finish: 'fuzzy',
      },
      // 주둥이 (코와 입이 여기 붙는다)
      {
        slot: 'head',
        shape: 'sphere',
        at: [0, 0.52, 0.46],
        size: [0.075, 0.06, 0.07],
        color: BEAR_MUZZLE,
        finish: 'fuzzy',
      },
      {
        slot: 'earL',
        shape: 'sphere',
        at: [-0.11, 0.68, 0.3],
        size: [0.05, 0.05, 0.025],
        color: BEAR,
        finish: 'fuzzy',
        inner: BEAR_MUZZLE,
        mirror: true,
      },
      ...quadLegs({
        x: 0.11,
        xb: 0.12,
        zf: 0.17,
        zb: -0.2,
        k: 0.95,
        t: 1.35,
        color: BEAR,
        paw: BEAR_SOLE,
        finish: 'fuzzy',
      }),
      {
        slot: 'tail',
        shape: 'sphere',
        at: [0, 0.45, -0.27],
        size: [0.045, 0.045, 0.045],
        color: BEAR,
        finish: 'fuzzy',
      },
    ],
    face: {
      slot: 'head',
      eyeY: 0.6,
      eyeGap: 0.068,
      eyeSize: 0.032,
      catchlight: 'big',
      pupil: 'round',
      mouth: 'smile',
      mouthY: 0.495,
      nose: { shape: 'oval', color: '#3a2c28', y: 0.535, size: 1.3 },
    },
  },
};

/** 모습에 맞는 기본 펫 설계도: 피규어, 게임은 동그란 몸, 실사와 복슬복슬(실사 위에 털을 덮는다)은 실제 동물 몸 */
export function defaultBlueprint(kind: PetKind, style: PetStyle): Blueprint {
  if (style === 'real' || style === 'fluffy')
    return (REAL_BLUEPRINTS as Partial<Record<PetKind, Blueprint>>)[kind] ?? DEFAULT_BLUEPRINTS[kind];
  return DEFAULT_BLUEPRINTS[kind];
}
