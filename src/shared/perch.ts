// 창 위에 올라앉기 (v1 추가 행동). 다른 앱 창의 윗변에 걸터앉는다. 창이 움직이거나 닫히면 떨어진다.
import type { Rect } from './geometry.ts';

/** 펫 발이 창 윗변에 조금 걸치게 (px) */
export const PERCH_SINK = 6;
const MIN_WIDTH = 220;
const EDGE_MARGIN = 24;

/**
 * 앉을 창을 고른다. windows 는 앞에 있는 창부터 (운영체제 순서).
 * - 펫이 있는 모니터 작업 영역 안, 펫이 올라설 자리(펫 높이)가 위에 있는 창
 * - 윗변 중 펫이 앉을 부분이 그 앞 창에 가려지지 않은 창
 * - 지금 펫과 가로로 가까운 것
 */
export function pickPerch(
  pet: Rect,
  windows: readonly Rect[],
  area: Rect,
): { x: number; y: number; win: Rect } | undefined {
  const cx = pet.x + pet.width / 2;
  let best: { x: number; y: number; win: Rect; d: number } | undefined;
  for (const [i, w] of windows.entries()) {
    if (w.width < MIN_WIDTH || w.height < 120) continue;
    const top = w.y;
    if (top - pet.height < area.y || top > area.y + area.height - 40) continue;
    if (w.x + w.width < area.x || w.x > area.x + area.width) continue;
    // 앉을 가로 자리: 창 안쪽, 화면 안쪽
    const lo = Math.max(w.x + EDGE_MARGIN, area.x) + pet.width / 2;
    const hi = Math.min(w.x + w.width - EDGE_MARGIN, area.x + area.width) - pet.width / 2;
    if (hi < lo) continue;
    const seat = Math.min(hi, Math.max(lo, cx));
    // 앞 창이 그 자리 윗변을 덮고 있으면 안 된다 (윗변 바로 위아래 띠를 본다)
    const strip = { x: seat - pet.width / 2, y: top - 4, width: pet.width, height: 8 };
    const covered = windows.slice(0, i).some((f) => overlaps(f, strip));
    if (covered) continue;
    // 펫 자리(창 위 빈 곳)를 다른 창이 덮어도 안 된다
    const body = {
      x: seat - pet.width / 2,
      y: top - pet.height + PERCH_SINK,
      width: pet.width,
      height: pet.height - PERCH_SINK,
    };
    if (windows.slice(0, i).some((f) => overlaps(f, body))) continue;
    const d = Math.abs(seat - cx) + Math.abs(top - (pet.y + pet.height)) * 0.5;
    if (!best || d < best.d)
      best = { x: Math.round(seat - pet.width / 2), y: top - pet.height + PERCH_SINK, win: w, d };
  }
  return best ? { x: best.x, y: best.y, win: best.win } : undefined;
}

/** 앉은 창이 그대로 있는지: 같은 자리(2px 안), 같은 크기의 창이 아직 있다. 옮기거나 닫거나 줄이면 아니다 */
export function perchHolds(win: Rect, windows: readonly Rect[]): boolean {
  const i = windows.findIndex(
    (w) =>
      Math.abs(w.x - win.x) <= 2 &&
      Math.abs(w.y - win.y) <= 2 &&
      Math.abs(w.width - win.width) <= 2 &&
      Math.abs(w.height - win.height) <= 2,
  );
  return i >= 0;
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** 깡충 뛰어 옮겨 가는 길: t(0~1) 에서 위치. 가운데에서 가장 높이 (포물선) */
export function hopAt(from: { x: number; y: number }, to: { x: number; y: number }, t: number) {
  const k = Math.min(1, Math.max(0, t));
  const lift = 60 + Math.abs(to.y - from.y) * 0.3;
  return {
    x: Math.round(from.x + (to.x - from.x) * k),
    y: Math.round(from.y + (to.y - from.y) * k - Math.sin(k * Math.PI) * lift),
  };
}
