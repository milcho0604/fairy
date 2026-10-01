// 펫을 켤 때 어디에 둘지 정한다. 저장된 자리가 있으면 거기, 없으면 기본 자리.
import { clampIntoAreas, type Point, type Rect } from './geometry.ts';

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
