// 화면 좌표 계산. 모니터 배치에 따라 x, y 는 음수가 될 수 있다 (L7).

export interface Point {
  x: number;
  y: number;
}

export interface Rect extends Point {
  width: number;
  height: number;
}

function center(r: Rect): Point {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

function contains(area: Rect, p: Point): boolean {
  return p.x >= area.x && p.x < area.x + area.width && p.y >= area.y && p.y < area.y + area.height;
}

/** 점에서 영역까지 거리의 제곱. 영역 안이면 0. */
function distanceSq(area: Rect, p: Point): number {
  const dx = Math.max(area.x - p.x, 0, p.x - (area.x + area.width));
  const dy = Math.max(area.y - p.y, 0, p.y - (area.y + area.height));
  return dx * dx + dy * dy;
}

/** 사각형 가운데가 들어 있는 영역, 없으면 가장 가까운 영역. */
export function nearestArea(rect: Rect, areas: readonly Rect[]): Rect | undefined {
  const c = center(rect);
  let best: Rect | undefined;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const area of areas) {
    if (contains(area, c)) return area;
    const d = distanceSq(area, c);
    if (d < bestDist) {
      best = area;
      bestDist = d;
    }
  }
  return best;
}

/**
 * 사각형이 한 영역(모니터 작업 영역) 안에 다 보이도록 위치를 옮긴다.
 * 가운데가 걸친 모니터, 없으면 가장 가까운 모니터 안으로 넣는다. 크기는 바꾸지 않는다.
 */
export function clampIntoAreas(rect: Rect, areas: readonly Rect[]): Rect {
  const area = nearestArea(rect, areas);
  if (!area) return rect;
  const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), Math.max(min, max));
  return {
    ...rect,
    x: clamp(rect.x, area.x, area.x + area.width - rect.width),
    y: clamp(rect.y, area.y, area.y + area.height - rect.height),
  };
}
