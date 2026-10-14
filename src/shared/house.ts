// 펫 집 자리 계산 (v2 집 옮기기). 화면 좌표는 모니터 배치에 따라 음수일 수 있다 (L7).
import { nearestArea, type Point, type Rect } from './geometry.ts';
import { ART, type HouseStyle, hitsAt, houseLayout } from './house-art.ts';
import { artToScreen, doorSprite } from './house-room.ts';

/** 단계별 집 크기 (px). 업그레이드하면 조금씩 커진다. 그림은 120 칸 기준으로 그려 늘린다 (house-art.ts) */
const SIZES = [104, 120, 136, 148, 160] as const;
/** 처음 자리: 모니터 왼쪽 아래 구석에서 이만큼 띄운다 */
const EDGE_GAP = 12;

export function houseSize(level: number): number {
  return SIZES[Math.min(Math.max(level, 1), SIZES.length) - 1] ?? SIZES[0];
}

/**
 * 저장하는 집 자리: 집 아래 가운데 점. 크기가 바뀌어도(업그레이드) 이 점을 지키면
 * 바닥에 선 채로 양옆으로 고르게 커진다.
 */
export interface HouseSpot {
  cx: number;
  bottom: number;
}

/** 저장 파일 내용 검사. 깨졌으면 undefined (처음 자리로) */
export function parseHouseSpot(value: unknown): HouseSpot | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const { cx, bottom } = value as Record<string, unknown>;
  if (typeof cx !== 'number' || typeof bottom !== 'number') return undefined;
  if (!Number.isFinite(cx) || !Number.isFinite(bottom)) return undefined;
  return { cx, bottom };
}

export function spotOf(rect: Rect): HouseSpot {
  return { cx: rect.x + rect.width / 2, bottom: rect.y + rect.height };
}

export function rectAtSpot(spot: HouseSpot, size: number): Rect {
  return { x: Math.round(spot.cx - size / 2), y: Math.round(spot.bottom - size), width: size, height: size };
}

/** 옮긴 적 없을 때 자리: 펫이 있는 모니터 왼쪽 아래 구석 */
export function defaultHouseRect(area: Rect, size: number): Rect {
  return { x: area.x + EDGE_GAP, y: area.y + area.height - size, width: size, height: size };
}

/**
 * 집은 바닥에 선다. 가운데가 걸친 모니터(없으면 가장 가까운 모니터) 안으로 가로를 맞추고
 * 그 모니터 작업 영역 바닥(독 위)에 붙인다. 펫이 집에 갈 때 바닥을 걸어가기 때문이다.
 */
export function settleHouse(rect: Rect, areas: readonly Rect[]): Rect {
  const area = nearestArea(rect, areas);
  if (!area) return rect;
  const max = area.x + area.width - rect.width;
  const x = Math.round(Math.min(Math.max(rect.x, area.x), Math.max(area.x, max)));
  return { ...rect, x, y: area.y + area.height - rect.height };
}

/**
 * 창 안 점 (x, y) 이 집 그림 위인지. 모양과 단계마다 그림과 같은 숫자로 적은 자리(지붕, 벽, 탑, 마당)를 본다.
 * 투명한 곳(지붕 옆 하늘, 벽 옆)은 아래 앱으로 마우스를 넘긴다.
 */
export function houseHit(style: HouseStyle, level: number, size: number, p: Point): boolean {
  const k = ART / size;
  return hitsAt(houseLayout(style, level).hits, p.x * k, p.y * k);
}

/** 집 옆에 설 때 펫 가운데가 집 끝에서 떨어지는 만큼 (펫 너비에 대한 비율). 그려진 몸은 펫 칸의 약 0.76 이라 몸 끝이 집 끝에 살짝 닿는다 */
export const STAND_GAP = 0.3;

/**
 * 펫이 집에 갈 때 설 자리 (펫 가운데 x). 집 바로 오른쪽 옆이 기본이라 펫이 집과 문을 가리지 않고,
 * 거기서 문까지 걸어가며 집 크기로 줄어 들어간다 (house-rest.ts doorFrame).
 * 집이 모니터 오른쪽 끝에 붙어 펫이 화면 밖으로 나가면 왼쪽 옆에 선다.
 */
export function doorStandX(house: Rect, area: Rect, petWidth: number): number {
  const gap = Math.round(petWidth * STAND_GAP);
  const half = petWidth / 2;
  const right = house.x + house.width + gap;
  if (right + half <= area.x + area.width) return right;
  const left = house.x - gap;
  return Math.max(area.x + half, left);
}

/**
 * 집 창을 어떻게 맞출지. remove 없앤다(0 단계), place 같은 그림이라 자리만, rebuild 그림이 바뀌어(단계나 모양) 창을 새로.
 * 창이 죽었으면 다시 만든다
 */
export function houseChange(
  shown: { alive: boolean; level: number; style: HouseStyle },
  want: { level: number; style: HouseStyle },
): 'remove' | 'place' | 'rebuild' {
  if (want.level <= 0) return 'remove';
  if (shown.alive && shown.level === want.level && shown.style === want.style) return 'place';
  return 'rebuild';
}

/** 집 창이 보이는 화면 밖에 반 넘게 나가 있다 (모니터가 바뀌는 사이 맥이 화면 아래로 밀어 둔 경우). 화면 목록이 비면 모른다 */
export function houseOffScreen(rect: Rect, areas: readonly Rect[]): boolean {
  if (areas.length === 0 || rect.width <= 0 || rect.height <= 0) return false;
  let seen = 0;
  for (const a of areas) {
    const w = Math.min(rect.x + rect.width, a.x + a.width) - Math.max(rect.x, a.x);
    const h = Math.min(rect.y + rect.height, a.y + a.height) - Math.max(rect.y, a.y);
    if (w > 0 && h > 0) seen += w * h;
  }
  return seen * 2 < rect.width * rect.height;
}

/**
 * 집이 있어야 하는데 사라졌을 때 살리는 법 (#74). rebuild 창이 없거나 그림 화면이 죽어 새로 만든다,
 * show 감출 까닭이 없는데 창이 내려가 있어 다시 띄운다, place 화면 밖이라 보이는 바닥으로, none 그대로.
 * 감춰 둔 집(사용자가 숨김, 펫과 같이 숨음)은 창만 살리고 띄우지 않는다
 */
export function houseRepair(
  s: {
    level: number;
    alive: boolean;
    crashed: boolean;
    wantVisible: boolean;
    isVisible: boolean;
    bounds?: Rect;
  },
  areas: readonly Rect[],
): 'none' | 'rebuild' | 'show' | 'place' {
  if (s.level <= 0) return 'none';
  if (!s.alive || s.crashed) return 'rebuild';
  if (!s.wantVisible) return 'none';
  if (!s.isVisible) return 'show';
  if (s.bounds && houseOffScreen(s.bounds, areas)) return 'place';
  return 'none';
}

/** 지금 보이는 집(화면 자리 house, 모양, 단계)의 문간 펫 그림 자리 (화면 좌표) */
export function houseDoorSprite(house: Rect, style: HouseStyle, level: number): Rect {
  return artToScreen(house, doorSprite(houseLayout(style, level).door), ART);
}
