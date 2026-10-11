// 요청문에 넣는 잘 만든 설계도 보기 (v2). 인형 하나, 진짜 고양이 하나. 둘 다 parseBlueprint 와 repairBlueprint 를
// 그대로 통과해야 한다 (blueprint.test.ts). 시험 그림 (scratch) 도 이 둘로 그린다
import type { Blueprint } from './blueprint.ts';

/**
 * 파란 머리, 흰 몸의 고양이 인형 (두 발, 짧은 팔). 머리:몸 = 1.15:1, 눈은 얼굴 아래쪽에 크게.
 * 파란 모자는 머리 위 42%, 이마 가운데로 흰 뾰족 무늬가 파고든다. 코 없이 ω 입, 빗금 볼
 */
export const EXAMPLE_PLUSH: Blueprint = {
  v: 2,
  gait: 'biped',
  fur: { length: 0.15, curl: 0, clump: 0 },
  parts: [
    {
      slot: 'body',
      shape: 'sphere',
      at: [0, 0.4, 0],
      size: [0.46, 0.4, 0.4],
      color: '#f7f4ee',
      finish: 'soft',
    },
    {
      slot: 'head',
      shape: 'sphere',
      at: [0, 0.86, 0.02],
      size: [0.54, 0.44, 0.46],
      color: '#f7f4ee',
      finish: 'soft',
      pattern: { type: 'split', color: '#4a8fd6', side: 'top', amount: 0.42 },
    },
    // 이마 가운데 흰 뾰족 무늬 (위로 파고든다). 겉면을 따라 조금 뒤로 눕힌다
    {
      slot: 'head',
      shape: 'cone',
      at: [0, 0.975, 0.445],
      size: [0.13, 0.09, 0.03],
      rot: [-16, 0, 0],
      color: '#f7f4ee',
    },
    {
      slot: 'earL',
      shape: 'cone',
      at: [-0.36, 1.25, -0.02],
      size: [0.14, 0.15, 0.08],
      rot: [0, 0, 28],
      color: '#4a8fd6',
      finish: 'soft',
      mirror: true,
    },
    {
      slot: 'armL',
      shape: 'capsule',
      at: [-0.47, 0.42, 0.08],
      size: [0.08, 0.13, 0.08],
      rot: [0, 0, 32],
      color: '#f7f4ee',
      mirror: true,
    },
    {
      slot: 'legL',
      shape: 'sphere',
      at: [-0.17, 0.06, 0.12],
      size: [0.11, 0.06, 0.12],
      color: '#f7f4ee',
      mirror: true,
    },
  ],
  face: {
    slot: 'head',
    eyeY: 0.79,
    eyeGap: 0.18,
    eyeSize: 0.066,
    mouth: 'cat',
    mouthY: 0.69,
    nose: { shape: 'none' },
    blush: '#f6a3b0',
    blushLines: true,
    brows: { color: '#4a3a38', y: 0.92 },
    catchlight: 'big',
  },
  motion: { bounce: 0.8, sway: 0.7 },
};

/** 긴 털의 흰 고양이, 호박색 눈 (네 발, 앉은 자세). 볼 털과 가슴 털 뭉치, 말린 꼬리, 분홍 귀 안과 코 */
export const EXAMPLE_CAT: Blueprint = {
  v: 2,
  gait: 'quadruped',
  fur: { length: 0.85, curl: 0, clump: 0.5 },
  parts: [
    {
      slot: 'body',
      shape: 'sphere',
      at: [0, 0.36, 0],
      size: [0.37, 0.36, 0.36],
      color: '#f4f2ee',
      finish: 'fuzzy',
    },
    // 가슴 털 (앞으로 볼록한 흰 턱받이. 털 뭉치를 가슴에 두면 모은 손처럼 보였다)
    {
      slot: 'body',
      shape: 'sphere',
      at: [0, 0.44, 0.24],
      size: [0.22, 0.2, 0.13],
      color: '#fbfaf8',
      finish: 'fuzzy',
    },
    {
      slot: 'head',
      shape: 'sphere',
      at: [0, 0.8, 0.04],
      size: [0.42, 0.37, 0.38],
      color: '#f6f4f0',
      finish: 'fuzzy',
    },
    // 입 둘레 (흰 주둥이)
    {
      slot: 'head',
      shape: 'sphere',
      at: [0, 0.68, 0.34],
      size: [0.15, 0.09, 0.08],
      color: '#fbfaf8',
      finish: 'fuzzy',
    },
    {
      slot: 'earL',
      shape: 'cone',
      at: [-0.25, 1.1, -0.02],
      size: [0.11, 0.15, 0.07],
      rot: [0, 0, 24],
      color: '#f1ece6',
      finish: 'fuzzy',
      inner: '#f3b7bd',
      mirror: true,
    },
    // 앞발 (z > 0), 뒷발 (z < 0)
    {
      slot: 'legL',
      shape: 'sphere',
      at: [-0.15, 0.07, 0.25],
      size: [0.09, 0.07, 0.1],
      color: '#f6f4f0',
      finish: 'fuzzy',
      mirror: true,
    },
    {
      slot: 'legL',
      shape: 'sphere',
      at: [-0.27, 0.08, -0.1],
      size: [0.1, 0.08, 0.11],
      color: '#f3f1ed',
      finish: 'fuzzy',
      mirror: true,
    },
    // 몸 옆으로 둥글게 말린 꼬리
    {
      slot: 'tail',
      shape: 'tube',
      at: [0.1, 0.12, -0.3],
      size: [0.065, 0.065, 0.065],
      path: [
        [0, 0.12, -0.32],
        [0.22, 0.1, -0.22],
        [0.36, 0.1, 0.02],
        [0.4, 0.14, 0.22],
      ],
      taper: 0.7,
      color: '#f3f1ed',
      finish: 'fuzzy',
    },
  ],
  face: {
    slot: 'head',
    eyeY: 0.82,
    eyeGap: 0.15,
    eyeSize: 0.058,
    eyeColor: '#e6a63a',
    eyeShape: 'oval',
    pupil: 'slit',
    mouth: 'cat',
    mouthY: 0.7,
    nose: { shape: 'triangle', color: '#f0a3ad' },
    blush: '#f5b6bd',
    whiskers: '#d8d2cc',
    fluff: '#f6f4f0',
  },
};
