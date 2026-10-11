// 기본 그림 캐릭터(밀크, 초코)의 뼈대 (photo-rig.ts). resources/pets/ 그림 위에 사람이 한 번 짚은 자리다.
// 두 그림 모두 앞을 보고 앉은 모습이라 뼈도 같은 모양: 몸(뿌리), 머리, 두 귀, 두 앞발, 보이는 뒷발, 꼬리.
// 좌표는 그림 픽셀 (milk.png 303x512, choco.png 340x512). 그림을 바꾸면 이 값도 다시 짚어야 한다
// (크기가 다르면 뼈대를 쓰지 않고 예전처럼 한 장으로 그린다).
import type { StarterId } from '../../shared/starter-pets.ts';
import type { RigDef } from './photo-rig.ts';

const LEG_RAMP = [0.15, 0.75] as const;

/** 밀크: 긴 털 흰 고양이. 오른쪽 아래에 감은 꼬리와 뒷발이 보인다 */
const MILK: RigDef = {
  w: 303,
  h: 512,
  cell: 32,
  ground: 492,
  bones: [
    { id: 'body', pivot: [150, 492] },
    {
      id: 'head',
      parent: 'body',
      pivot: [145, 238],
      grip: [
        { a: [100, 130], b: [190, 130], r: 85, soft: 38 },
        { a: [80, 80], b: [58, 22], r: 30, soft: 10 },
        { a: [212, 80], b: [237, 22], r: 30, soft: 10 },
      ],
    },
    { id: 'earL', parent: 'head', pivot: [88, 90], grip: [{ a: [84, 82], b: [58, 22], r: 22, soft: 12 }] },
    { id: 'earR', parent: 'head', pivot: [208, 90], grip: [{ a: [212, 82], b: [237, 22], r: 22, soft: 12 }] },
    {
      id: 'legL',
      parent: 'body',
      pivot: [90, 470],
      grip: [{ a: [92, 318], b: [90, 495], r: 34, soft: 12 }],
      ramp: LEG_RAMP,
    },
    {
      id: 'legR',
      parent: 'body',
      pivot: [212, 470],
      grip: [{ a: [205, 318], b: [212, 495], r: 34, soft: 12 }],
      ramp: LEG_RAMP,
    },
    {
      id: 'hindR',
      parent: 'body',
      pivot: [250, 455],
      grip: [{ a: [250, 400], b: [250, 465], r: 16, soft: 10 }],
      ramp: [0.2, 0.7],
    },
    {
      id: 'tail',
      parent: 'body',
      pivot: [248, 428],
      grip: [{ a: [256, 410], b: [282, 345], r: 22, soft: 14 }],
    },
  ],
  motion: { paw: 36, hind: 14, rise: 22, bob: 8, settle: 10, tail: 0.22, ear: 0.05 },
};

/** 초코: 곱슬 털 갈색 푸들. 늘어진 귀, 양옆 뒷발, 오른쪽 아래 말린 꼬리 */
const CHOCO: RigDef = {
  w: 340,
  h: 512,
  cell: 32,
  ground: 492,
  bones: [
    { id: 'body', pivot: [170, 492] },
    {
      id: 'head',
      parent: 'body',
      pivot: [170, 270],
      grip: [
        { a: [110, 135], b: [230, 135], r: 95, soft: 45 },
        { a: [60, 110], b: [45, 210], r: 36, soft: 10 },
        { a: [280, 110], b: [295, 210], r: 36, soft: 10 },
      ],
    },
    { id: 'earL', parent: 'head', pivot: [80, 100], grip: [{ a: [72, 112], b: [45, 210], r: 30, soft: 12 }] },
    {
      id: 'earR',
      parent: 'head',
      pivot: [260, 100],
      grip: [{ a: [268, 112], b: [295, 210], r: 30, soft: 12 }],
    },
    {
      id: 'legL',
      parent: 'body',
      pivot: [105, 468],
      grip: [{ a: [105, 315], b: [105, 495], r: 42, soft: 10 }],
      ramp: LEG_RAMP,
    },
    {
      id: 'legR',
      parent: 'body',
      pivot: [228, 468],
      grip: [{ a: [225, 315], b: [228, 495], r: 40, soft: 10 }],
      ramp: LEG_RAMP,
    },
    {
      id: 'hindL',
      parent: 'body',
      pivot: [42, 440],
      grip: [{ a: [45, 340], b: [40, 465], r: 26, soft: 10 }],
      ramp: [0.1, 0.6],
    },
    {
      id: 'hindR',
      parent: 'body',
      pivot: [282, 440],
      grip: [{ a: [278, 340], b: [282, 458], r: 14, soft: 8 }],
      ramp: [0.1, 0.6],
    },
    {
      id: 'tail',
      parent: 'body',
      pivot: [276, 425],
      grip: [{ a: [285, 420], b: [324, 408], r: 20, soft: 10 }],
    },
  ],
  motion: { paw: 36, hind: 14, rise: 22, bob: 8, settle: 10, tail: 0.35, ear: 0.14 },
};

export const STARTER_RIGS: Readonly<Record<StarterId, RigDef>> = { milk: MILK, choco: CHOCO };
