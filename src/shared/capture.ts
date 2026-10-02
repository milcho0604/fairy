// 같이 보기: 화면 위 드래그를 캡처할 영역으로 바꾼다. 좌표는 모니터 왼쪽 위 기준 DIP.
import type { Point, Rect } from './geometry.ts';

/** 이보다 작게 끌면 클릭으로 보고 모니터 전체를 찍는다. */
export const MIN_DRAG = 8;

/** 시작점과 끝점으로 사각형. 거꾸로 끌어도 된다. 모니터 밖으로 끌면 모니터 안으로 자른다. */
export function dragRect(a: Point, b: Point, size: { width: number; height: number }): Rect {
  const clampX = (v: number) => Math.min(Math.max(v, 0), size.width);
  const clampY = (v: number) => Math.min(Math.max(v, 0), size.height);
  const x1 = clampX(Math.min(a.x, b.x));
  const y1 = clampY(Math.min(a.y, b.y));
  const x2 = clampX(Math.max(a.x, b.x));
  const y2 = clampY(Math.max(a.y, b.y));
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

export function isClick(r: Rect): boolean {
  return r.width < MIN_DRAG || r.height < MIN_DRAG;
}

/**
 * DIP 사각형을 캡처 그림의 픽셀 사각형으로. 캡처 그림 크기는 모니터 배율과 다를 수 있어서
 * (여러 모니터를 한 번에 찍으면 같은 크기 상자에 맞춰 늘거나 준다) 비율로 계산한다.
 */
export function toPixels(
  r: Rect,
  display: { width: number; height: number },
  image: { width: number; height: number },
): Rect {
  const kx = image.width / display.width;
  const ky = image.height / display.height;
  const x = Math.max(0, Math.floor(r.x * kx));
  const y = Math.max(0, Math.floor(r.y * ky));
  return {
    x,
    y,
    width: Math.min(image.width - x, Math.ceil(r.width * kx)),
    height: Math.min(image.height - y, Math.ceil(r.height * ky)),
  };
}

/** 긴 변이 max 를 넘으면 줄일 크기. 넘지 않으면 undefined. */
export function fitWithin(size: { width: number; height: number }, max: number) {
  const k = max / Math.max(size.width, size.height);
  if (k >= 1) return undefined;
  return { width: Math.max(1, Math.round(size.width * k)), height: Math.max(1, Math.round(size.height * k)) };
}
