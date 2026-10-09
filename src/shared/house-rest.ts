// 집에서 쉬기: 집 우클릭으로 펫을 집에 들여보내 쉬게 하고, 부르면 나온다. 상태 바뀜과 자리 계산만 (화면 없이 시험한다)
import type { Rect } from './geometry.ts';
import { ART } from './house-art.ts';

/**
 * 밖(out) → 집으로 가는 중(going) → 집 안(inside) → 나오는 중(leaving) → 밖.
 * 가는 중에 부르거나 끌면 그 자리에서 그만둔다(out). 저장하지 않는다: 다시 켜면 늘 밖이다.
 */
export type RestPhase = 'out' | 'going' | 'inside' | 'leaving';

/** go 들어가라, enter 문으로 들어갔다, call 불렀다, exit 다 나왔다, cancel 가다가 끊겼다 */
export type RestEvent = 'go' | 'enter' | 'call' | 'exit' | 'cancel';

/** 다음 상태. 이 상태에서 받지 않는 일이면 undefined (무시한다) */
export function nextRest(phase: RestPhase, event: RestEvent): RestPhase | undefined {
  switch (phase) {
    case 'out':
      return event === 'go' ? 'going' : undefined;
    case 'going':
      if (event === 'enter') return 'inside';
      // 가는 중에 부르면 들어가지 않고 그 자리에 남는다
      if (event === 'cancel' || event === 'call') return 'out';
      return undefined;
    case 'inside':
      return event === 'call' ? 'leaving' : undefined;
    case 'leaving':
      return event === 'exit' ? 'out' : undefined;
  }
}

/** 집에서 쉬게 할 수 없는 까닭. 없으면 undefined */
export type RestBlock = 'noHouse' | 'hidden' | 'playing' | 'busy';

export function restBlock(o: {
  hasHouse: boolean;
  /** 사용자가 숨겼거나 발표 중 (집도 같이 숨는다) */
  hidden: boolean;
  /** 공놀이, 산책, 숨바꼭질 */
  playing: boolean;
  phase: RestPhase;
}): RestBlock | undefined {
  if (!o.hasHouse) return 'noHouse';
  if (o.hidden) return 'hidden';
  if (o.phase !== 'out') return 'busy';
  if (o.playing) return 'playing';
  return undefined;
}

/**
 * 쉬는 중에 온 말을 어떻게 할지.
 * - 일정 알림은 나와서 알린다 (놓치면 회의를 놓친다. 펫 집은 그림뿐이라 말풍선을 띄울 자리가 없다)
 * - 놓치면 안 되는 다른 말(업적, 친밀도)은 집에 편지 표시만 하고 나올 때 말한다
 * - 나머지(혼잣말, 답 알림 등)는 나올 때 가장 최근 것 하나만 (숨김과 같다)
 */
export function restWake(kind: string, important: boolean): 'come-out' | 'mail' | 'wait' {
  if (kind === 'schedule') return 'come-out';
  return important ? 'mail' : 'wait';
}

/**
 * 화면 좌표의 문 아래 가운데 점 (펫이 작아지며 들어가고 커지며 나오는 자리).
 * door 는 집 그림(120 칸)의 문 가운데 x 와 문턱 y. 모양과 단계마다 다르다 (house-art.ts houseLayout)
 */
export function doorPoint(house: Rect, door: { x: number; bottom: number }): { x: number; y: number } {
  return {
    x: Math.round(house.x + (house.width * door.x) / ART),
    y: Math.round(house.y + (house.height * door.bottom) / ART),
  };
}

/**
 * 문 드나들기 시간 (ms). 들어가기: 문이 열리고(DOOR_OPEN) 펫이 문간까지 걸으며 문 크기로 줄고(approachMs),
 * 집 창이 넘겨받아 문 안 어둠 속으로 걸어 들어간 뒤(WALK_IN, play.ts HOUSE_CSS .wkg 와 같다) 문이 닫히고(DOOR_CLOSE)
 * 앞벽이 걷히며 방이 보인다(ROOM, .room 과 같다). 나오기는 거꾸로: 방이 닫히고 문이 열리고 문간까지 걸어 나와
 * 펫 창이 넘겨받아 커지며 걸어 나오고(OUT) 기지개(STRETCH)
 */
export const DOOR_OPEN_MS = 300;
/** 문간까지 걸어가며 줄기: 거리에 맞춰 이 사이 (초속 약 130px, 집 옆에서 문까지 보통 0.7~1초) */
export const APPROACH_MIN_MS = 650;
export const APPROACH_MAX_MS = 1200;
/** 집 창이 펫 그림을 그린 뒤 펫 창을 숨기기까지 (사이에 펫이 깜빡 사라지지 않게) */
export const HANDOFF_MS = 70;
export const WALK_IN_MS = 560;
export const DOOR_CLOSE_MS = 300;
export const ROOM_MS = 500;
/** 나온 뒤 600ms 에 모아 둔 말을 꺼내니(pet-window setHidden) 그보다 짧게 */
export const OUT_MS = 520;
export const STRETCH_MS = 1700;

/** 문간에 선 펫(stand)에서 문 안 그림 자리(end)까지 걸어가는 시간 */
export function approachMs(stand: Rect, end: Rect): number {
  const d = Math.abs(end.x + end.width / 2 - (stand.x + stand.width / 2));
  return Math.round(Math.min(APPROACH_MAX_MS, Math.max(APPROACH_MIN_MS, d / 0.13)));
}

/**
 * 문 드나들기 u(0~1) 때 펫 사각형. stand 는 문간에 선 펫, end 는 문 안 펫 그림과 같은 자리(작다).
 * 들어갈 때는 문 쪽으로 걸어가며 줄고, 펫 아래 가운데가 바닥을 따라 문턱으로 간다. 나올 때는 이것을 거꾸로(u 를 1→0) 쓴다.
 * 걸음은 고르게, 크기는 처음과 끝에 천천히 (멀어지는 것처럼)
 */
export function doorFrame(stand: Rect, end: Rect, u: number): Rect {
  const k = Math.min(1, Math.max(0, u));
  const ease = k * k * (3 - 2 * k);
  const size = Math.max(4, Math.round(stand.width + (end.width - stand.width) * ease));
  const cx = stand.x + stand.width / 2 + (end.x + end.width / 2 - (stand.x + stand.width / 2)) * k;
  const bottom = stand.y + stand.height + (end.y + end.height - (stand.y + stand.height)) * k;
  return { x: Math.round(cx - size / 2), y: Math.round(bottom - size), width: size, height: size };
}

/** 나왔을 때 한마디. 쉰 시간(ms)에 따라 */
export function restBackKey(ms: number): 'pet.home.backShort' | 'pet.home.backOk' | 'pet.home.backLong' {
  if (ms < 2 * 60_000) return 'pet.home.backShort';
  if (ms < 30 * 60_000) return 'pet.home.backOk';
  return 'pet.home.backLong';
}
