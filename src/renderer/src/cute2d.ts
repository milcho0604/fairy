// 손그림 2D 기본 펫 (2026-10-13 사용자 요청: 예전 3D 와 코드 그림이 "F급 밤티"라 새로 그린 그림을 쓴다).
// 그림은 art/cute2d/<모양>/<자세>.svg (512x512, 바닥선 y=470, 가운데 x=256, 자세 13장 + 걷기 6장). 다시 만들기는 scripts/cute2d/README.md.
// 여기는 상태에서 자세 그림을 고르는 표와 모양마다 그림 자리 값(CUTE_GEOM)만 둔다
// (그림 불러오기는 cute2d-art.ts, 그리기는 draw.ts drawCute). 새 모양을 넣을 때는 그림 폴더를 두고 CUTE_KINDS 에 더하고,
// 골격이 곰돌이와 다르면 CUTE_GEOM 에 그 모양 값을 둔다

import type { PetMood } from '../../shared/pet-mood.ts';
import type { PetKind } from '../../shared/settings.ts';
import { walkFrameIndex } from './photo-walk.ts';

/** 손그림을 쓰는 기본 펫 모양 (2026-10-13 여덟 모두). 여기 없는 모양은 예전 코드 그림(draw.ts) 그대로 */
export const CUTE_KINDS = [
  'kong',
  'cat',
  'chick',
  'dog',
  'bunny',
  'hamster',
  'penguin',
  'bear',
] as const satisfies readonly PetKind[];
export type CuteKind = (typeof CUTE_KINDS)[number];
export const isCuteKind = (k: PetKind | undefined): k is CuteKind =>
  (CUTE_KINDS as readonly (PetKind | undefined)[]).includes(k);

/** 걷기 한 주기 그림 수 (정면 뒤뚱 걷기 walk-0..5) */
export const CUTE_WALK_FRAMES = 6;
export const CUTE_POSES = [
  'idle',
  'sit',
  'sleep',
  'happy',
  'hungry',
  'grab',
  'sulky',
  'doze',
  'wave',
  'yawn',
  'talk-0',
  'talk-1',
  'back',
  'walk-0',
  'walk-1',
  'walk-2',
  'walk-3',
  'walk-4',
  'walk-5',
] as const;
export type CutePose = (typeof CUTE_POSES)[number];

/** 그림 한 변 (원본 좌표) */
export const ART_SIDE = 512;
/** 그림 속 바닥선 y 와 가운데 x */
export const ART_GROUND = 470;
export const ART_CX = 256;
/** 말하기 입 그림(talk-0, talk-1)을 바꾸는 간격 (ms) */
export const TALK_FLIP_MS = 170;
/** 말하는 동안 입을 바꾸려고 그리는 빠르기 (fps) */
export const TALK_FPS = Math.ceil(1000 / TALK_FLIP_MS);

/** 모양마다 그림 자리 값 (그림 좌표) */
export interface CuteGeom {
  /** 그림 512 를 펫 캔버스 160 에 줄이는 배율 */
  scale: number;
  /** 자세마다 그림 꼭대기 y (귀, 별, 김 포함). 머리 위 표시를 이 위에 두고, 뛰어도 캔버스 위로 잘리지 않게 한다 */
  top(pose: CutePose): number;
  /** 자세마다 머리 가운데와 기울기(도). 옷, 눈(돋보기), 입(문 공), 얼굴 아이콘 자르기가 쓴다 */
  head(pose: CutePose): { x: number; y: number; rot: number };
  /** 머리 반지름 (가로, 세로). 옷 그림의 몸 반지름 58x50 을 이만큼으로 키운다 */
  headR: { x: number; y: number };
  /** 눈 가운데 (머리 가운데에서 dx 좌우, dy 아래), 입 (머리 가운데에서 아래) */
  eye: { dx: number; dy: number };
  mouthDy: number;
  /**
   * 얼굴 아이콘(이름 옆, 윈도우 알림 영역)은 머리와 귀만 (머리 가운데가 0 인 머리 좌표): 머리 가운데 줄 위로 up 까지는
   * x0..x1(그림 좌표) 상자, 그 아래는 머리 테두리를 따라 둥근 턱 (가로 rx, 세로 ry)
   */
  faceCut: { x0: number; x1: number; up: number; rx: number; ry: number };
  /** 목도리를 코드 그림 몸 좌표에서 이만큼 내려 그림 속 목에 두른다 */
  scarfDrop: number;
}

/**
 * 곰돌이 골격 (scripts/cute2d/bear/gen.py. 냥이도 이 골격에 귀, 코입, 꼬리, 색만 바꿨다).
 * 배율 0.34: 가장 키 큰 그림(걷기, 꼭대기 y 64)이 바닥 154 에서 캔버스 안에 들고, 신나서 18 뛰는 기쁨 그림(꼭대기 y 80)도
 * 잘리지 않는 값. 예전 코드 그림(몸 높이 약 110)과 키가 비슷하다. 머리는 head_front(가로 126, 위 100, 아래 94),
 * 걷기는 몸을 올린 만큼(26 + 걸음마다 0~12) 위. 얼굴 자르기 가로는 귀 바깥(곰 귀 160 - 35 - 테두리, 냥이 귀 끝 122)까지,
 * 옆에 올라온 냥이 꼬리 끝은 빠진다
 */
export const BEAR_GEOM: CuteGeom = {
  scale: 0.34,
  top(pose) {
    if (pose.startsWith('walk-')) return 64;
    const top: Partial<Record<CutePose, number>> = { sit: 124, sleep: 180, happy: 80, grab: 62, doze: 118 };
    return top[pose] ?? 102;
  },
  head(pose) {
    if (pose.startsWith('walk-')) {
      const ph = (2 * Math.PI * Number(pose.slice(5))) / CUTE_WALK_FRAMES;
      return { x: 256, y: 236 - 26 - 12 * Math.abs(Math.cos(ph)), rot: 0 };
    }
    const at: Partial<Record<CutePose, { x: number; y: number; rot: number }>> = {
      sit: { x: 256, y: 258, rot: 0 },
      sleep: { x: 236, y: 338, rot: -6 },
      happy: { x: 256, y: 214, rot: 0 },
      grab: { x: 256, y: 196, rot: 0 },
      doze: { x: 256, y: 262, rot: 12 },
    };
    return at[pose] ?? { x: 256, y: 236, rot: 0 };
  },
  headR: { x: 126, y: 97 },
  eye: { dx: 58, dy: 24 },
  mouthDy: 56,
  faceCut: { x0: 110, x1: 402, up: 236, rx: 134, ry: 102 },
  scarfDrop: 20,
};

/** 자세 이름에서 걷기 여섯 장은 하나로 (꼭대기 표) */
type TopKey = Exclude<CutePose, `walk-${number}`> | 'walk';
/** 그림에서 잰 꼭대기 표(자세마다 불투명한 맨 위 y)로 곰돌이 골격 값을 덮는다 */
function measured(top: Record<TopKey, number>, more: Partial<CuteGeom> = {}): CuteGeom {
  return {
    ...BEAR_GEOM,
    top: (pose) => top[pose.startsWith('walk-') ? 'walk' : (pose as TopKey)],
    ...more,
  };
}
/** 귀 없는 머리 (삐약이 깃털, 멍멍이 늘어진 귀, 햄찌 작은 귀, 뒤뚱이): 꼭대기만 다르고 머리 자리는 곰돌이와 같다 */
const EARLESS_TOP = { sit: 151, sleep: 180, happy: 105, grab: 84, doze: 150, walk: 91 } as const;
const flat = (base: number, o: Partial<Record<TopKey, number>>): Record<TopKey, number> => ({
  idle: base,
  hungry: base,
  sulky: base,
  wave: base,
  yawn: base,
  'talk-0': base,
  'talk-1': base,
  back: base,
  sit: base,
  sleep: base,
  happy: base,
  grab: base,
  doze: base,
  walk: base,
  ...o,
});

/**
 * 모양마다 그림 자리 값. 모두 곰돌이 골격(scripts/cute2d/bear/gen.py)이라 머리 자리는 같고, 꼭대기는 그림에서 쟀다
 * (scratchpad 측정, 냥이와 곰돌이는 둘 중 높은 쪽). 토순이는 긴 귀가 걷기에서 y 8 까지 올라와 조금 작게(0.32) 그린다.
 * 콩이는 머리와 몸이 한 덩어리 콩이라 머리 자리를 콩 가운데(곰 머리보다 84 아래), 반지름을 콩(136x148)으로,
 * 얼굴(눈, 입)은 곰 얼굴보다 12 아래 (scripts/cute2d/kong/gen.py FACE_DY), 얼굴 아이콘은 발만 뺀 콩 전체
 */
export const CUTE_GEOM: Record<CuteKind, CuteGeom> = {
  cat: BEAR_GEOM,
  bear: BEAR_GEOM,
  chick: measured(flat(89, { sit: 111, sleep: 180, happy: 67, grab: 49, doze: 129, walk: 51 })),
  dog: measured(flat(129, EARLESS_TOP)),
  hamster: measured(
    flat(125, { hungry: 131, sit: 147, sleep: 180, happy: 103, grab: 85, doze: 143, walk: 87 }),
  ),
  penguin: measured(flat(129, { ...EARLESS_TOP, grab: 89, happy: 107 })),
  bunny: measured(
    flat(23, {
      hungry: 31,
      sulky: 36,
      yawn: 25,
      sit: 45,
      sleep: 170,
      happy: 16,
      grab: 19,
      doze: 47,
      walk: 8,
    }),
    { scale: 0.32 },
  ),
  kong: measured(
    flat(165, { back: 168, sulky: 156, sit: 187, sleep: 180, happy: 114, grab: 123, doze: 150, walk: 127 }),
    {
      head: (pose) => {
        const h = BEAR_GEOM.head(pose);
        return { ...h, y: h.y + 84 };
      },
      headR: { x: 136, y: 148 },
      eye: { dx: 58, dy: 24 + 12 - 84 },
      mouthDy: 56 + 12 - 84,
      faceCut: { x0: 100, x1: 412, up: 320, rx: 150, ry: 124 },
      scarfDrop: 0,
    },
  ),
};

/** 그림을 고르는 데 쓰는 상태 (draw.ts DrawState 의 일부) */
export interface CuteInput {
  mood: PetMood;
  elapsed: number;
  hungry?: boolean;
  /** 삐진 세기 0~3 (draw.ts sulkStage) */
  stage: number;
  /** 지금 행동 (걷기는 steps 로 그림을 고른다) */
  act?:
    | { type: 'walk'; dir: -1 | 1; phase: number; steps?: number; facing?: 'away' | 'toward' }
    | { type: string; t?: number; dir?: -1 | 1 };
  /** 친밀도 몸짓 (draw.ts trickOf 를 지난 것) */
  trick?: { type: 'wave' | 'dance'; t: number };
}

/** 고른 그림과 좌우 뒤집기 (그림은 오른쪽으로 가는 모습: 꼬리가 왼쪽 뒤에) */
export interface CutePick {
  pose: CutePose;
  flip: boolean;
}

/**
 * 지금 상태에 맞는 손그림 자세. 그림이 없는 상태는 가장 가까운 그림으로 (보고 표: 생각 중, 바쁨은 서기, 기지개와 빙글 춤은
 * 기쁨, 두리번과 제자리 몸짓은 서기 그림에 몸 전체 움직임만). 숨김은 그리지 않는다 (draw.ts 가 먼저 돌아간다)
 */
export function cutePose(s: CuteInput): CutePick {
  const act = s.act;
  const still = (pose: CutePose): CutePick => ({ pose, flip: false });
  switch (s.mood) {
    case 'grabbed':
      return still('grab');
    case 'sleeping':
      return still('sleep');
    case 'dozing':
      return still('doze');
    case 'excited':
      return still('happy');
    case 'talking': {
      const k = Math.floor(Math.max(0, s.elapsed) / TALK_FLIP_MS) % 2;
      return still(k === 0 ? 'talk-0' : 'talk-1');
    }
    case 'thinking':
    case 'busy':
    case 'hidden':
      return still('idle');
    default:
      break;
  }
  // 기본(idle)과 삐짐(sulky): 걷기와 앉기, 몸짓
  // 매운맛 토라짐 3단계는 등 돌리고 앉아 있다 (draw.ts sulkStage, 메인이 앉기만 시킨다)
  if (s.mood === 'sulky' && s.stage >= 3) return still('back');
  if (act?.type === 'walk' && 'phase' in act) {
    // 집 문으로 들어갈 때는 등, 나올 때는 정면 걷기
    if (act.facing === 'away') return still('back');
    const i = walkFrameIndex(act.steps ?? act.phase * 2, CUTE_WALK_FRAMES);
    return { pose: `walk-${i}` as CutePose, flip: act.dir < 0 };
  }
  if (s.mood === 'sulky') return still('sulky');
  if (s.trick?.type === 'wave') return still('wave');
  if (s.trick?.type === 'dance') return still('happy');
  if (act?.type === 'sit') return still('sit');
  if (act?.type === 'yawn') {
    const t = act.t ?? 0;
    return still(t > 0.15 && t < 0.85 ? 'yawn' : 'idle');
  }
  if (act?.type === 'stretch') return still('happy');
  if (s.hungry) return still('hungry');
  return still('idle');
}
