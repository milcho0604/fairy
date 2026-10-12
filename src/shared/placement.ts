// 펫을 켤 때 어디에 둘지 정한다. 저장된 자리가 있으면 거기, 없으면 기본 자리.
import { clampIntoAreas, type Point, type Rect } from './geometry.ts';
import { clampScale } from './size.ts';

export interface DisplayInfo {
  workArea: Rect;
  internal: boolean;
  primary: boolean;
}

/** 기본 자리에서 오른쪽 끝과 띄우는 거리. */
const EDGE_MARGIN = 40;

/**
 * 처음 켤 때 자리: 노트북 내장 화면 오른쪽 아래. 내장 화면이 없으면 주 모니터.
 * 외장 모니터를 여러 대 써도 펫은 늘 눈앞(노트북 화면)에서 시작한다.
 */
export function defaultPetBounds(displays: readonly DisplayInfo[], size: number): Rect {
  const display = displays.find((d) => d.internal) ?? displays.find((d) => d.primary) ?? displays[0];
  const area = display?.workArea ?? { x: 0, y: 0, width: size, height: size };
  return {
    x: area.x + area.width - size - EDGE_MARGIN,
    y: area.y + area.height - size,
    width: size,
    height: size,
  };
}

/** 저장 파일 내용이 펫 위치로 쓸 만한지. 깨졌거나 옛 형식이면 undefined. */
export function parseSavedPosition(saved: unknown): Point | undefined {
  if (typeof saved !== 'object' || saved === null) return undefined;
  const { x, y } = saved as Record<string, unknown>;
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) {
    return undefined;
  }
  return { x: Math.round(x), y: Math.round(y) };
}

/** 켤 때 자리: 저장된 자리를 지금 모니터 배치 안으로 맞춘다. 없으면 기본 자리. */
export function restorePetBounds(saved: unknown, displays: readonly DisplayInfo[], size: number): Rect {
  const position = parseSavedPosition(saved);
  if (!position) return defaultPetBounds(displays, size);
  return clampIntoAreas(
    { ...position, width: size, height: size },
    displays.map((d) => d.workArea),
  );
}

/** 저장된 크기 배율. 없거나 깨졌으면 100%. */
export function parseSavedScale(saved: unknown): number {
  if (typeof saved !== 'object' || saved === null) return 1;
  const { scale } = saved as Record<string, unknown>;
  return typeof scale === 'number' ? clampScale(scale) : 1;
}

/** 친구 펫이 기본 펫과 겹쳐 서는 폭 (예전 140px 간격과 같다: 160 - 140) */
const FRIEND_OVERLAP = 20;

/**
 * 처음 오는 친구 펫(index 번째)의 자리. 기본 펫과 같은 바닥 선에 서고, 왼쪽부터 줄을 서며 왼쪽에 자리가 모자라면
 * 오른쪽에 선다. 예전에는 기본 펫 윗변(y)에 맞추고 왼쪽으로만 서서, 기본 펫이 크면 친구가 공중에 떠 있었고
 * 기본 펫이 화면 왼쪽 끝이면 친구가 모두 같은 자리(왼쪽 끝)로 밀려 기본 펫과 한 덩어리로 겹쳤다
 */
export function friendSpot(main: Rect, index: number, size: number, area: Rect): Point {
  const step = size - FRIEND_OVERLAP;
  const leftAt = (i: number) => main.x + FRIEND_OVERLAP - size - i * step;
  let left = 0;
  while (left < 8 && leftAt(left) >= area.x) left++;
  const x = index < left ? leftAt(index) : main.x + main.width - FRIEND_OVERLAP + (index - left) * step;
  const spot = clampIntoAreas({ x, y: main.y + main.height - size, width: size, height: size }, [area]);
  return { x: spot.x, y: spot.y };
}
