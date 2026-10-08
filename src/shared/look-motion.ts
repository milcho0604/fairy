// 같이 보기 돋보기 모션. 영역을 고르는 동안(aim) 펫이 돋보기를 들고 커서 쪽을 들여다보고,
// 찍은 뒤(found) 고른 쪽을 보며 "찾았다" 하고 돋보기를 내린다. 그림이 붙은 질문에 AI 가 답하는 동안(study)은
// 돋보기로 그림을 읽듯 천천히 훑는다. 화면 찍는 순간에는 펫 창을 가린다 (main/look-together.ts).
// 여기는 계산만 한다 (시험한다). 그리기는 renderer/src/magnifier.ts.
import type { Gaze } from './gaze.ts';
import type { Point, Rect } from './geometry.ts';
import type { PetMood } from './pet-mood.ts';

/** 메인이 알려 주는 단계. study 는 펫 화면이 AI 상태로 스스로 정한다 */
export type LookPhase = 'aim' | 'found';

/** 메인 → 펫 화면 (IPC.look). null 이면 같이 보기가 끝났다 */
export interface LookMotion {
  phase: LookPhase;
  /** 들여다볼 쪽 (gaze 와 같은 칸: x -1~1, y -1~1) */
  dir: Gaze;
  /** 돋보기를 드는지. 친구 펫은 들지 않고 같은 쪽만 본다 */
  tool: boolean;
}

/** 그릴 때 쓰는 단계 */
export type MagnifierKind = LookPhase | 'study';

/** 찾았다 동작 시간. 끝나면 메인이 같이 보기를 끝내고, 펫 화면도 이 시간이 지나면 스스로 지운다 */
export const FOUND_MS = 2600;
/** 영역을 고르는 동안 커서를 보는 간격 */
export const LOOK_POLL_MS = 100;
/** 찍기 전에 펫 창을 지우는 시간 (창 불투명도를 몇 번에 나눠 내린다) */
export const VEIL_MS = 64;
/** 찍은 뒤 펫 창이 다시 나타나는 시간 */
export const REVEAL_MS = 180;
/** 돋보기가 커 보이게 하는 배율 */
export const LENS_ZOOM = 1.6;
/** 렌즈 반지름 (160 기준 좌표) */
export const LENS_R = 16;

/**
 * 펫 머리에서 target 쪽 방향 칸. gazeAt 과 달리 멀어도 본다 (화면 어디를 고르든 그쪽을 본다).
 * 가로 0.25, 세로 0.5 단위로 끊어 칸이 바뀔 때만 보낸다
 */
export function lookDir(pet: Rect, target: Point): Gaze {
  const dx = target.x - (pet.x + pet.width / 2);
  const dy = target.y - (pet.y + pet.height * 0.45);
  const step = (v: number, n: number) => Math.round(Math.max(-1, Math.min(1, v)) * n) / n + 0;
  return {
    x: step(dx / Math.max(1, pet.width * 1.2), 4),
    y: step(dy / Math.max(1, pet.height * 1.2), 2),
  };
}

export function sameDir(a: Gaze | undefined, b: Gaze | undefined): boolean {
  if (!a || !b) return a === b;
  return a.x === b.x && a.y === b.y;
}

/** 고른 영역(모니터 기준 DIP)의 가운데를 화면 좌표로. 그냥 누른 것(전체)이면 모니터 가운데 */
export function targetOf(displayBounds: Rect, rect: Rect, whole: boolean): Point {
  const r = whole ? { x: 0, y: 0, width: displayBounds.width, height: displayBounds.height } : rect;
  return { x: displayBounds.x + r.x + r.width / 2, y: displayBounds.y + r.y + r.height / 2 };
}

/**
 * 돋보기를 들 수 있는 기분. 잠(집중 모드 포함), 조는 중, 바쁨, 잡힘, 숨김은 그대로 둔다:
 * 집중 중에는 조용히 자기로 약속했고, 바쁠 때는 움직이지 않기로 했다 (L10)
 */
export function canMagnify(mood: PetMood): boolean {
  return (
    mood === 'idle' || mood === 'sulky' || mood === 'excited' || mood === 'talking' || mood === 'thinking'
  );
}

/** 돋보기를 드는 쪽: 보는 쪽 눈 앞. 가운데면 오른쪽 */
export function lensSide(dir: Gaze): -1 | 1 {
  return dir.x < 0 ? -1 : 1;
}

export interface MagnifierPose {
  /** 얼굴(눈) 기준 렌즈 가운데 이동 (160 기준 좌표) */
  dx: number;
  dy: number;
  /** 손잡이 방향 (라디안, 0 이 오른쪽, 아래가 +) */
  angle: number;
  /** 크기 (나타날 때 톡 커진다) */
  scale: number;
  alpha: number;
  /** 반짝이 진행 0~1. 없으면 -1 */
  sparkle: number;
  /** 몸이 살짝 뛰는 높이 */
  hop: number;
}

const easeOutBack = (t: number) => {
  const c = 1.7;
  const u = t - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
};
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** 들어 올리는 시간 */
const RAISE_MS = 260;
/** 찾았다에서 톡 커지는 시간, 반짝이 시간, 내리는 시간 */
const POP_MS = 320;
const SPARKLE_MS = 1100;
const LOWER_MS = 420;
/** 찾았다에서 몸이 한 번 톡 뛰는 시간 */
const HOP_MS = 360;
/** 고르는 동안 흔들리는 주기, 그림을 훑는 주기 */
const SWAY_MS = 1600;
const READ_MS = 2400;

/**
 * 단계와 흐른 시간으로 돋보기 자세. 끝난 찾았다(FOUND_MS 넘음)는 undefined (모션이 남지 않게).
 * calm(움직임 줄이기)이면 흔들림, 뜀, 톡 커짐 없이 자리만 잡는다
 */
export function magnifierPose(
  kind: MagnifierKind,
  ms: number,
  dir: Gaze,
  calm = false,
): MagnifierPose | undefined {
  if (ms < 0) return undefined;
  const side = lensSide(dir);
  const handle = side > 0 ? 0.9 : Math.PI - 0.9;
  if (kind === 'found') {
    if (ms >= FOUND_MS) return undefined;
    const pop = calm ? 1 : 0.7 + 0.3 * easeOutBack(clamp01(ms / POP_MS));
    const lower = clamp01((ms - (FOUND_MS - LOWER_MS)) / LOWER_MS);
    return {
      dx: dir.x * 7,
      dy: dir.y * 5 - 2 + lower * 6,
      angle: handle,
      scale: pop,
      alpha: 1 - lower,
      sparkle: ms < SPARKLE_MS ? ms / SPARKLE_MS : -1,
      hop: calm || ms >= HOP_MS ? 0 : Math.sin((Math.PI * ms) / HOP_MS) * 5,
    };
  }
  const raise = clamp01(ms / RAISE_MS);
  const appear = { scale: calm ? 1 : 0.6 + 0.4 * easeOutBack(raise), alpha: raise };
  if (kind === 'study') {
    const read = calm ? 0 : Math.sin((ms / READ_MS) * Math.PI * 2);
    return {
      dx: read * 7,
      dy: 4 + (calm ? 0 : Math.abs(read) * -1.5),
      angle: handle + read * 0.08,
      ...appear,
      sparkle: -1,
      hop: 0,
    };
  }
  const sway = calm ? 0 : Math.sin((ms / SWAY_MS) * Math.PI * 2);
  return {
    dx: dir.x * 5 + sway * 2.5,
    dy: dir.y * 4 + (calm ? 0 : Math.cos((ms / SWAY_MS) * Math.PI * 4) * 1.2),
    angle: handle + sway * 0.06,
    ...appear,
    sparkle: -1,
    hop: 0,
  };
}

/** 단계마다 그리는 빠르기 (fps). 고르는 중 흔들림 20, 찾았다 30, 그림 훑기 12. 움직임 줄이기면 들어 올린 뒤 멈춘다 */
export function magnifierFps(kind: MagnifierKind, ms: number, calm = false): number {
  if (calm) return kind === 'found' ? (ms < FOUND_MS ? 30 : 0) : ms < RAISE_MS ? 30 : 0;
  if (kind === 'found') return ms < FOUND_MS ? 30 : 0;
  return kind === 'aim' ? 20 : 12;
}
