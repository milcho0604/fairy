// 펫 집 자리 계산 (v2 집 옮기기). 화면 좌표는 모니터 배치에 따라 음수일 수 있다 (L7).
import { nearestArea, type Point, type Rect } from './geometry.ts';

/** 단계별 집 크기 (px). 업그레이드하면 조금씩 커진다. 그림은 120 칸 기준으로 그려 늘린다 */
const SIZES = [104, 120, 136] as const;
const ART = 120;
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
 * 창 안 점 (x, y) 이 집 그림 위인지. 지붕 세모, 벽, 3단계 마당을 본다.
 * 투명한 곳(지붕 옆 하늘, 벽 옆)은 아래 앱으로 마우스를 넘긴다.
 */
export function houseHit(level: number, size: number, p: Point): boolean {
  const k = ART / size;
  const x = p.x * k;
  const y = p.y * k;
  const pad = 3;
  // 벽
  if (x >= 22 - pad && x <= 98 + pad && y >= 52 - pad && y <= 110 + pad) return true;
  // 지붕: 꼭대기 (60, 18), 처마 (12, 56) ~ (108, 56)
  if (y >= 18 - pad && y <= 56 + pad) {
    const half = ((Math.min(y, 56) - 18) / (56 - 18)) * 48;
    if (Math.abs(x - 60) <= half + pad) return true;
  }
  // 3단계 마당: 잔디 줄, 덤불, 꽃
  if (level >= 3) {
    if (y >= 110 && y <= 120 && x >= 0 && x <= 120) return true;
    if (Math.hypot(x - 104, y - 104) <= 7 + pad) return true;
    if (Math.hypot(x - 14, y - 106) <= 5 + pad) return true;
  }
  return false;
}

/**
 * 펫이 집에 갈 때 설 자리 (펫 가운데 x). 집 오른쪽 문간이 기본이고,
 * 집이 모니터 오른쪽 끝에 붙어 펫이 화면 밖으로 나가면 왼쪽에 선다.
 */
export function doorStandX(house: Rect, area: Rect, petWidth: number): number {
  const inset = Math.round(house.width / 6);
  const half = petWidth / 2;
  const right = house.x + house.width - inset;
  if (right + half <= area.x + area.width) return right;
  const left = house.x + inset;
  return Math.max(area.x + half, left);
}
