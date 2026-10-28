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
  // 서기 그림에서 눈만 바꾼 장: 깜빡임(감은 눈), 커서 바라보기(눈동자를 왼쪽, 오른쪽으로). cuteEyes 가 고른다
  'blink',
  'look-l',
  'look-r',
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
  /**
   * 머리와 몸이 한 덩어리인 모양(콩이)은 머리 상자 대신 이 찹쌀떡 모양(그림 좌표)과 그 위 상자(새싹)로 자른다.
   * 상자와 둥근 턱으로는 콩의 넓은 아랫배 가장자리가 잘렸다
   */
  faceShape?(pose: CutePose): CuteBlob;
  /** 목도리를 코드 그림 몸 좌표에서 이만큼 내려 그림 속 목에 두른다 */
  scarfDrop: number;
  /**
   * 가져온 그림 세트(sprite-geom.ts)만: 그림 크기와 가운데 x, 자세마다 바닥선 y. 없으면 손그림 값
   * (512x512, ART_CX, ART_GROUND)
   */
  size?: { w: number; h: number };
  cx?: number;
  ground?(pose: CutePose): number;
}

/** 찹쌀떡 모양 (scripts/cute2d/bear/gen.py blob): 가운데, 위 반지름(가로 rx, 세로 ryT), 아래(가로 rxB, 세로 ryB), 휨 kT, kB */
export interface CuteBlob {
  cx: number;
  cy: number;
  rx: number;
  rxB: number;
  ryT: number;
  ryB: number;
  kT: number;
  kB: number;
}

/** 찹쌀떡 모양 테두리를 그리는 베지어 네 조각 (blob 과 같은 순서): 시작점과 [제어1, 제어2, 끝] 넷 */
export function blobCurves(b: CuteBlob): { start: [number, number]; curves: number[][] } {
  const { cx, cy, rx, rxB, ryT, ryB, kT, kB } = b;
  const t = cy - ryT;
  const bt = cy + ryB;
  return {
    start: [cx, t],
    curves: [
      [cx + rx * kT, t, cx + rx, cy - ryT * kT, cx + rx, cy],
      [cx + rx, cy + ryB * kB, cx + rxB * kB, bt, cx, bt],
      [cx - rxB * kB, bt, cx - rx, cy + ryB * kB, cx - rx, cy],
      [cx - rx, cy - ryT * kT, cx - rx * kT, t, cx, t],
    ],
  };
}

/**
 * 콩이 콩 한 덩어리 (scripts/cute2d/kong/gen.py bean): 곰 몸 자리(가운데 y, 가로 반지름, 아래 반지름)에서 머리까지 덮는다.
 * grow 만큼 바깥으로 (테두리 두께 반과 손그림 흔들림)
 */
export function kongBean(cy: number, rx: number, ryB: number, grow = 0): CuteBlob {
  const top = cy - 214;
  const bot = cy + ryB;
  const c = top + (bot - top) * 0.52;
  const R = 136 + (rx - 80) * 0.6;
  return {
    cx: ART_CX,
    cy: c,
    rx: R + grow,
    rxB: R * 1.04 + grow,
    ryT: c - top + grow,
    ryB: bot - c + grow,
    kT: 0.57,
    kB: 0.66,
  };
}

/** 걷기 그림에서 두 발이 다 땅에 있을 때 머리가 서기보다 올라가는 높이 (scripts/cute2d/bear/gen.py WALK_BOB) */
export const WALK_BOB = 4;

/**
 * 곰돌이 골격 (scripts/cute2d/bear/gen.py. 냥이도 이 골격에 귀, 코입, 꼬리, 색만 바꿨다).
 * 배율 0.34: 가장 키 큰 그림(들림, 꼭대기 y 62)이 바닥 154 에서 캔버스 안에 들고, 신나서 18 뛰는 기쁨 그림(꼭대기 y 80)도
 * 잘리지 않는 값. 예전 코드 그림(몸 높이 약 110)과 키가 비슷하다. 머리는 head_front(가로 126, 위 100, 아래 94),
 * 걷기도 서기와 같은 높이 (몸 아래를 줄여 다리를 보인다. 걸음마다 0~4 위). 얼굴 자르기 가로는 귀 바깥(곰 귀 160 - 35 - 테두리,
 * 냥이 귀 끝 122)까지, 옆에 올라온 냥이 꼬리 끝은 빠진다
 */
export const BEAR_GEOM: CuteGeom = {
  scale: 0.34,
  top(pose) {
    if (pose.startsWith('walk-')) return 94;
    const top: Partial<Record<CutePose, number>> = { sit: 124, sleep: 180, happy: 80, grab: 62, doze: 118 };
    return top[pose] ?? 102;
  },
  head(pose) {
    if (pose.startsWith('walk-')) {
      const ph = (2 * Math.PI * Number(pose.slice(5))) / CUTE_WALK_FRAMES;
      return { x: 256, y: 236 - WALK_BOB * Math.abs(Math.cos(ph)), rot: 0 };
    }
    const at: Partial<Record<CutePose, { x: number; y: number; rot: number }>> = {
      sit: { x: 256, y: 258, rot: 0 },
      sleep: { x: 236, y: 338, rot: -6 },
      happy: { x: 256, y: 214, rot: 0 },
      grab: { x: 256, y: 196, rot: 0 },
      // 졸기는 머리를 (256, 322) 축으로 12도 기울이고 10 내린다 (bear/gen.py doze): 머리 가운데가 오른쪽 아래로 간다
      doze: { x: 266, y: 273, rot: 12 },
    };
    return at[pose] ?? { x: 256, y: 236, rot: 0 };
  },
  headR: { x: 126, y: 97 },
  eye: { dx: 58, dy: 24 },
  mouthDy: 56,
  faceCut: { x0: 110, x1: 402, up: 236, rx: 134, ry: 102 },
  scarfDrop: 20,
};

/** 눈만 바꾼 서기 그림 (꼭대기와 머리 자리는 서기와 같다) */
const IDLE_EYES = ['blink', 'look-l', 'look-r'] as const satisfies readonly CutePose[];
const isIdleEyes = (pose: CutePose): boolean => (IDLE_EYES as readonly CutePose[]).includes(pose);
/** 자세 이름에서 걷기 여섯 장은 하나로, 눈만 바꾼 서기는 서기로 (꼭대기 표) */
type TopKey = Exclude<CutePose, `walk-${number}` | (typeof IDLE_EYES)[number]> | 'walk';
/** 그림에서 잰 꼭대기 표(자세마다 불투명한 맨 위 y)로 곰돌이 골격 값을 덮는다 */
function measured(top: Record<TopKey, number>, more: Partial<CuteGeom> = {}): CuteGeom {
  return {
    ...BEAR_GEOM,
    top: (pose) => top[pose.startsWith('walk-') ? 'walk' : isIdleEyes(pose) ? 'idle' : (pose as TopKey)],
    ...more,
  };
}
/** 귀 없는 머리 (삐약이 깃털, 멍멍이 늘어진 귀, 햄찌 작은 귀, 뒤뚱이): 꼭대기만 다르고 머리 자리는 곰돌이와 같다 */
const EARLESS_TOP = { sit: 151, sleep: 180, happy: 105, grab: 83, doze: 149, walk: 125 } as const;
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
 * (scratchpad 측정, 냥이와 곰돌이는 둘 중 높은 쪽). 토순이는 긴 귀가 y 16 까지 올라와 조금 작게(0.32) 그린다.
 * 콩이는 머리와 몸이 한 덩어리 콩이라 머리 자리를 콩 가운데(곰 머리보다 84 아래), 반지름을 콩(136x148)으로,
 * 얼굴(눈, 입)은 곰 얼굴보다 12 아래 (scripts/cute2d/kong/gen.py FACE_DY), 얼굴 아이콘은 발만 뺀 콩 전체
 */
export const CUTE_GEOM: Record<CuteKind, CuteGeom> = {
  cat: BEAR_GEOM,
  bear: BEAR_GEOM,
  chick: measured(flat(89, { sit: 111, sleep: 180, happy: 67, grab: 49, doze: 129, walk: 85 })),
  dog: measured(flat(129, EARLESS_TOP)),
  hamster: measured(
    flat(125, { hungry: 131, sit: 147, sleep: 180, happy: 103, grab: 85, doze: 143, walk: 119 }),
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
      doze: 46,
      walk: 17,
    }),
    { scale: 0.32 },
  ),
  // 콩이는 머리 위 새싹까지 (자세마다 새싹이 서고 눕는다)
  kong: measured(
    flat(119, {
      hungry: 131,
      sulky: 144,
      wave: 101,
      sit: 141,
      sleep: 180,
      happy: 79,
      grab: 62,
      doze: 149,
      walk: 112,
    }),
    {
      head: (pose) => {
        const h = BEAR_GEOM.head(pose);
        return { ...h, y: h.y + 84 };
      },
      // 얼굴 아이콘은 서기(콩 386, 80, 70)와 졸기(앉은 콩 408, 98, 56) 두 장만 쓴다
      faceShape: (pose) =>
        pose === 'doze' || pose === 'sit' ? kongBean(408, 98, 56, 4) : kongBean(386, 80, 70, 4),
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
export function cutePose(s: CuteInput, walkFrames = CUTE_WALK_FRAMES): CutePick {
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
    const i = walkFrameIndex(act.steps ?? act.phase * 2, walkFrames);
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

/** 커서가 이만큼 옆(gazeOf 의 x, -1~1)이면 눈동자를 그쪽으로 옮긴 그림 */
export const LOOK_SIDE = 0.35;
/** 그림 세트: 커서가 이만큼 위나 아래(gazeOf 의 y, 아래가 +)면 그쪽을 보는 그림 */
export const LOOK_UPDOWN = 0.35;

/**
 * 서기 그림의 눈: 깜빡이는 중이면 감은 눈, 아니면 커서 쪽을 보는 눈 (예전 2D 펫처럼: 깜빡임은 pet.ts 가 주는 blink 0~1,
 * 커서 방향은 draw.ts gazeOf 가 기본 상태에서만 준다). 깜빡임은 네 틀(반쯤 감음, 감음, 반쯤 뜸, 뜸) 가운데 앞 셋을 감은 눈으로.
 * 서기가 아닌 자세는 그대로
 */
export function cuteEyes(pose: CutePose, blink: number, gazeX: number | undefined): CutePose {
  if (pose !== 'idle') return pose;
  if (blink > 0.15 && blink < 0.85) return 'blink';
  if (gazeX !== undefined && gazeX <= -LOOK_SIDE) return 'look-l';
  if (gazeX !== undefined && gazeX >= LOOK_SIDE) return 'look-r';
  return pose;
}

/**
 * 가져온 그림 세트의 서기 눈 (cuteEyes 에 위, 아래, 위쪽 대각선을 더한 것). 깜빡임이 먼저, 커서가 위쪽이면 look-u(옆으로도 치우쳤으면
 * look-ul, look-ur), 아래쪽이면 look-d, 옆뿐이면 look-l, look-r. 아래쪽 대각선은 옆 그림으로 (그림 세트에 없다).
 * 그림 세트의 그림은 pet-sprites.ts SPRITE_NAMES 전부 있다(없는 자세는 fillSprites 가 채움). 기본 손그림에는 이 자세가 없어
 * 기본 손그림에는 쓰지 않는다 (draw.ts drawCute 의 sheet 값이 있을 때만)
 */
export function sheetEyes(
  pose: CutePose,
  blink: number,
  gaze: { x: number; y: number } | undefined,
): CutePose {
  if (pose !== 'idle') return pose;
  if (blink > 0.15 && blink < 0.85) return 'blink';
  if (!gaze) return pose;
  const side = gaze.x <= -LOOK_SIDE ? 'l' : gaze.x >= LOOK_SIDE ? 'r' : '';
  if (gaze.y <= -LOOK_UPDOWN) return (side ? `look-u${side}` : 'look-u') as CutePose;
  if (side) return `look-${side}` as CutePose;
  if (gaze.y >= LOOK_UPDOWN) return 'look-d' as CutePose;
  return pose;
}
