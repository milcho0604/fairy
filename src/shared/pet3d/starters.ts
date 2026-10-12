// 그림으로 들어 있는 기본 캐릭터(밀크, 초코, shared/starter-pets.ts)의 입체 설계도.
// 그림(resources/pets/*.png)에서 색을 뽑아 진짜 네 발 동물처럼 몸통을 눕혀 네 다리로 선 모양으로 만들었다(stance: 'stand').
// 앱이 앉히고, 엎드리게 하고, 옆으로 돌아 네 발로 걷게 한다 (renderer pet3d-stance.ts).
// 좌표: 바닥 y=0, 앞(머리)이 +z, 네 발 가운데가 x=0, z=0 근처. 크기는 반지름
import { type StarterId, starterOf } from '../starter-pets.ts';
import type { Blueprint, Part } from './blueprint.ts';

// 밀크: 긴 털 흰 고양이 (조금 크림빛). 그림의 밝은 털 #f2efea, 가슴 #ece7e2, 그늘 #d8cfca
const MILK = '#f3eee8';
const MILK_EAR = '#efc9be';
const MILK_NOSE = '#e9a294';
const MILK_EYE = '#d99a45';

// 초코: 곱슬 털 갈색 토이 푸들. 그림의 털 가운데 #73412b, 밝은 털 #a46d51, 그늘 #3d2313. 빛을 받으면 밝아져
// 그림 가운데 빛보다 조금 어둡게 둔다 (밝게 두면 피규어는 분홍빛, 실사는 주황빛이 돌았다)
const CHOCO = '#6a3418';
const CHOCO_LIGHT = '#8a4f2e';
const CHOCO_DARK = '#542918';
const CHOCO_NOSE = '#2b2220';

export const STARTER_BLUEPRINTS: Record<StarterId, Blueprint> = {
  milk: {
    v: 2,
    stance: 'stand',
    gait: 'quadruped',
    // 긴 털이 다발로 갈라진다 (복슬복슬, 실사 모습)
    fur: { length: 0.85, clump: 0.55, curl: 0 },
    // 고양이는 얌전하게: 덜 튀고 꼬리는 천천히
    motion: { bounce: 0.55, tailWag: 0.8, earWiggle: 1 },
    parts: [
      // 몸통: 매끈한 한 덩이 (옆으로 누운 캡슐), 앞에 풍성한 목털(갈기)
      {
        slot: 'body',
        shape: 'capsule',
        at: [0, 0.42, -0.03],
        size: [0.172, 0.31, 0.19],
        rot: [90, 0, 0],
        color: MILK,
        finish: 'fuzzy',
      },
      {
        slot: 'body',
        shape: 'sphere',
        at: [0, 0.47, 0.19],
        size: [0.19, 0.21, 0.15],
        color: MILK,
        finish: 'fuzzy',
      },
      // 머리
      {
        slot: 'head',
        shape: 'sphere',
        at: [0, 0.66, 0.35],
        size: [0.15, 0.135, 0.13],
        color: MILK,
        finish: 'fuzzy',
      },
      // 볼 털 (얼굴이 둥글고 넓게)
      {
        slot: 'head',
        shape: 'sphere',
        at: [0, 0.61, 0.36],
        size: [0.165, 0.09, 0.11],
        color: MILK,
        finish: 'fuzzy',
      },
      // 주둥이 (입과 코가 여기 붙는다)
      {
        slot: 'head',
        shape: 'sphere',
        at: [0, 0.61, 0.45],
        size: [0.065, 0.045, 0.04],
        color: '#fbf8f4',
        finish: 'fuzzy',
      },
      // 귀: 세모 귀, 안쪽 분홍, 끝에 털
      {
        slot: 'earL',
        shape: 'cone',
        at: [-0.085, 0.79, 0.33],
        size: [0.055, 0.075, 0.032],
        rot: [-8, 0, 24],
        color: MILK,
        finish: 'fuzzy',
        inner: MILK_EAR,
        mirror: true,
      },
      // 앞다리: 어깨 쪽 윗마디(아래로 가늘어진다), 팔꿈치 공, 아랫마디, 발
      {
        slot: 'legL',
        shape: 'capsule',
        at: [-0.085, 0.31, 0.19],
        size: [0.062, 0.11, 0.062],
        rot: [0, 0, 180],
        taper: 0.74,
        color: MILK,
        finish: 'fuzzy',
        mirror: true,
      },
      {
        slot: 'legL',
        shape: 'sphere',
        at: [-0.085, 0.21, 0.185],
        size: [0.046, 0.046, 0.046],
        color: MILK,
        finish: 'fuzzy',
        knee: true,
        mirror: true,
      },
      {
        slot: 'legL',
        shape: 'capsule',
        at: [-0.085, 0.125, 0.195],
        size: [0.044, 0.09, 0.044],
        color: MILK,
        finish: 'fuzzy',
        knee: true,
        mirror: true,
      },
      {
        slot: 'legL',
        shape: 'sphere',
        at: [-0.085, 0.04, 0.215],
        size: [0.052, 0.04, 0.064],
        color: '#f7f3ee',
        finish: 'fuzzy',
        knee: true,
        mirror: true,
      },
      // 뒷다리: 넓적다리(엉덩이 털), 무릎 공, 정강이, 발
      {
        slot: 'legL',
        shape: 'sphere',
        at: [-0.1, 0.35, -0.2],
        size: [0.085, 0.13, 0.115],
        color: MILK,
        finish: 'fuzzy',
        mirror: true,
      },
      {
        slot: 'legL',
        shape: 'sphere',
        at: [-0.1, 0.21, -0.15],
        size: [0.047, 0.047, 0.047],
        color: MILK,
        finish: 'fuzzy',
        knee: true,
        mirror: true,
      },
      {
        slot: 'legL',
        shape: 'capsule',
        at: [-0.1, 0.125, -0.2],
        size: [0.044, 0.1, 0.044],
        rot: [28, 0, 0],
        color: MILK,
        finish: 'fuzzy',
        knee: true,
        mirror: true,
      },
      {
        slot: 'legL',
        shape: 'sphere',
        at: [-0.1, 0.04, -0.235],
        size: [0.052, 0.04, 0.066],
        color: '#f7f3ee',
        finish: 'fuzzy',
        knee: true,
        mirror: true,
      },
      // 꼬리: 위로 휘어 올라간 풍성한 깃털 꼬리
      {
        slot: 'tail',
        shape: 'tube',
        at: [0, 0.48, -0.34],
        size: [0.078, 0.078, 0.078],
        path: [
          [0, 0.48, -0.34],
          [0, 0.58, -0.46],
          [0, 0.74, -0.5],
          [0, 0.86, -0.44],
        ],
        taper: 0.62,
        color: MILK,
        finish: 'fuzzy',
      },
    ],
    face: {
      slot: 'head',
      eyeY: 0.685,
      eyeGap: 0.062,
      eyeSize: 0.036,
      eyeColor: MILK_EYE,
      pupil: 'round',
      catchlight: 'big',
      mouth: 'cat',
      mouthY: 0.6,
      nose: { shape: 'triangle', color: MILK_NOSE, y: 0.632, size: 0.85 },
      whiskers: '#d8d0c8',
      blush: '#ffb5ba',
      fluff: MILK,
    },
  },
  choco: {
    v: 2,
    stance: 'stand',
    gait: 'quadruped',
    // 곱슬 털 (동글동글한 털 뭉치)
    fur: { length: 0.55, clump: 0.3, curl: 0.95 },
    motion: { bounce: 1, tailWag: 1.4, earWiggle: 1.2 },
    parts: [
      // 몸통: 짧고 통통한 몸 (토이 푸들), 가슴 털은 조금 밝다. 다리가 길다
      {
        slot: 'body',
        shape: 'capsule',
        at: [0, 0.44, -0.0],
        size: [0.158, 0.25, 0.168],
        rot: [90, 0, 0],
        color: CHOCO,
        finish: 'fuzzy',
      },
      {
        slot: 'body',
        shape: 'sphere',
        at: [0, 0.47, 0.16],
        size: [0.145, 0.165, 0.12],
        // 밝은 털은 가슴 앞에만. 공 전체를 밝게 하면 몸통 옆으로 솟은 가장자리가 옆모습에서 비스듬한 밝은 경계로 보였다
        color: CHOCO,
        pattern: { type: 'split', color: CHOCO_LIGHT, side: 'front', amount: 0.3 },
        finish: 'fuzzy',
      },
      // 목: 머리 아래를 어깨에 잇는다. 뒤에서 보면 머리가 몸 위에 얹힌 공처럼 떠 보였다.
      // 어깨에서 머리 뒤로 비스듬히 올라간다 (옆에서는 목덜미가 조금 채워진다)
      {
        slot: 'body',
        shape: 'capsule',
        at: [0, 0.64, 0.17],
        size: [0.105, 0.15, 0.095],
        rot: [50, 0, 0],
        color: CHOCO,
        finish: 'fuzzy',
      },
      // 머리: 곱슬 털 머리 (위가 봉긋)
      {
        slot: 'head',
        shape: 'sphere',
        at: [0, 0.7, 0.3],
        size: [0.15, 0.145, 0.14],
        color: CHOCO,
        finish: 'fuzzy',
      },
      {
        slot: 'head',
        shape: 'sphere',
        at: [0, 0.79, 0.27],
        size: [0.12, 0.08, 0.11],
        color: CHOCO,
        finish: 'fuzzy',
      },
      // 주둥이 (조금 길다), 입과 코가 여기 붙는다
      {
        slot: 'head',
        shape: 'sphere',
        at: [0, 0.64, 0.42],
        size: [0.08, 0.065, 0.075],
        color: CHOCO_LIGHT,
        finish: 'fuzzy',
      },
      // 처진 곱슬 귀
      {
        slot: 'earL',
        shape: 'capsule',
        at: [-0.152, 0.63, 0.25],
        size: [0.06, 0.12, 0.07],
        rot: [0, 0, -10],
        color: CHOCO_DARK,
        finish: 'fuzzy',
        mirror: true,
      },
      // 앞다리
      {
        slot: 'legL',
        shape: 'capsule',
        at: [-0.08, 0.32, 0.15],
        size: [0.06, 0.1, 0.06],
        rot: [0, 0, 180],
        taper: 0.8,
        color: CHOCO,
        finish: 'fuzzy',
        mirror: true,
      },
      {
        slot: 'legL',
        shape: 'sphere',
        at: [-0.08, 0.22, 0.145],
        size: [0.048, 0.048, 0.048],
        color: CHOCO,
        finish: 'fuzzy',
        knee: true,
        mirror: true,
      },
      {
        slot: 'legL',
        shape: 'capsule',
        at: [-0.08, 0.13, 0.155],
        size: [0.048, 0.095, 0.048],
        color: CHOCO,
        finish: 'fuzzy',
        knee: true,
        mirror: true,
      },
      {
        slot: 'legL',
        shape: 'sphere',
        at: [-0.08, 0.045, 0.17],
        size: [0.055, 0.045, 0.065],
        color: CHOCO_LIGHT,
        finish: 'fuzzy',
        knee: true,
        mirror: true,
      },
      // 뒷다리
      {
        slot: 'legL',
        shape: 'sphere',
        at: [-0.09, 0.35, -0.17],
        size: [0.075, 0.11, 0.095],
        color: CHOCO,
        finish: 'fuzzy',
        mirror: true,
      },
      {
        slot: 'legL',
        shape: 'sphere',
        at: [-0.09, 0.22, -0.12],
        size: [0.048, 0.048, 0.048],
        color: CHOCO,
        finish: 'fuzzy',
        knee: true,
        mirror: true,
      },
      {
        slot: 'legL',
        shape: 'capsule',
        at: [-0.09, 0.13, -0.17],
        size: [0.046, 0.1, 0.046],
        rot: [26, 0, 0],
        color: CHOCO,
        finish: 'fuzzy',
        knee: true,
        mirror: true,
      },
      {
        slot: 'legL',
        shape: 'sphere',
        at: [-0.09, 0.045, -0.2],
        size: [0.055, 0.045, 0.065],
        color: CHOCO_LIGHT,
        finish: 'fuzzy',
        knee: true,
        mirror: true,
      },
      // 꼬리: 위로 선 짧은 꼬리 끝에 털 방울
      {
        slot: 'tail',
        shape: 'capsule',
        at: [0, 0.55, -0.3],
        size: [0.035, 0.08, 0.035],
        rot: [-35, 0, 0],
        color: CHOCO,
        finish: 'fuzzy',
      },
      {
        slot: 'tail',
        shape: 'sphere',
        at: [0, 0.63, -0.35],
        size: [0.07, 0.07, 0.07],
        color: CHOCO,
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
      mouth: 'grin',
      mouthY: 0.605,
      nose: { shape: 'oval', color: CHOCO_NOSE, y: 0.648, size: 1.35 },
    },
  },
};

/**
 * 그림(사진)을 닮게 하는 덧붙임. 뼈대(STARTER_BLUEPRINTS)는 사진 동물을 네 발로 세울 때도 쓰니(stand.ts) 거기에는
 * 넣지 않는다 (짧은 털 고양이에 갈기가 붙지 않게). 밀크: 목둘레 갈기, 가슴으로 늘어진 털 다발, 굵고 풍성한 꼬리.
 * 초코: 아래가 넓게 퍼진 곱슬 귀, 내민 혀
 */
const LOOK: Record<StarterId, { add: Part[]; tail?: Partial<Part>; tongue?: boolean }> = {
  milk: {
    add: [
      // 목둘레 갈기: 머리 아래를 둘러 얼굴보다 넓게 (사진처럼 턱 아래가 하얀 털로 부푼다)
      {
        slot: 'body',
        shape: 'sphere',
        at: [0, 0.53, 0.26],
        size: [0.205, 0.135, 0.13],
        color: MILK,
        finish: 'fuzzy',
      },
      // 가슴으로 늘어진 털 다발 (아래로 뻗는 털 뭉치)
      {
        slot: 'body',
        shape: 'tuft',
        at: [0, 0.4, 0.33],
        size: [0.075, 0.1, 0.035],
        rot: [-12, 0, 180],
        color: MILK,
        finish: 'fuzzy',
      },
      {
        slot: 'body',
        shape: 'tuft',
        at: [-0.085, 0.43, 0.3],
        size: [0.065, 0.09, 0.035],
        rot: [-12, -25, 165],
        color: MILK,
        finish: 'fuzzy',
        mirror: true,
      },
    ],
    // 꼬리: 굵고 끝까지 풍성하게 (사진의 깃털 꼬리)
    tail: { size: [0.1, 0.1, 0.1], taper: 0.78 },
  },
  choco: {
    add: [
      // 곱슬 귀 아래쪽이 넓게 퍼진다 (사진의 귀는 턱까지 내려오는 곱슬 덩이)
      {
        slot: 'earL',
        shape: 'sphere',
        at: [-0.158, 0.55, 0.255],
        size: [0.072, 0.075, 0.072],
        color: CHOCO_DARK,
        finish: 'fuzzy',
        mirror: true,
      },
    ],
    tongue: true,
  },
};

function withLook(bp: Blueprint, look: (typeof LOOK)[StarterId]): Blueprint {
  const parts = bp.parts.map((p) =>
    p.slot === 'tail' && p.shape === 'tube' && look.tail ? { ...p, ...look.tail } : p,
  );
  return {
    ...bp,
    parts: [...parts, ...look.add],
    face: look.tongue ? { ...bp.face, tongue: true } : bp.face,
  };
}

/** 앱이 그리는 밀크, 초코 (뼈대 + 사진을 닮게 하는 덧붙임) */
export const STARTER_LOOKS: Record<StarterId, Blueprint> = {
  milk: withLook(STARTER_BLUEPRINTS.milk, LOOK.milk),
  choco: withLook(STARTER_BLUEPRINTS.choco, LOOK.choco),
};

/**
 * 펫 그림 파일이 밀크, 초코 복사본이면 그 입체 설계도. 아니면 null.
 * 사진 펫에 AI 가 만든 설계도가 있으면 그것이 먼저다 (부르는 쪽이 정한다). 입체로 보기를 끄면 그림 그대로 보인다
 */
export function starterModelOf(image: string | null | undefined): Blueprint | null {
  const id = starterOf(image);
  return id ? STARTER_LOOKS[id] : null;
}
