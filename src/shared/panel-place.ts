// 패널 자리. 기본은 펫 옆이고, 사용자가 끌어 옮기면 펫에서 떨어진 거리(펫 왼쪽 위 기준)를 기억한다.
// 펫은 혼자 걸어 다니고 끌려 다니니 화면 위 절대 자리가 아니라 펫과의 거리로 기억해야 다음에 열어도 펫 곁에 뜬다.
import { clampIntoAreas, nearestArea, type Point, type Rect } from './geometry.ts';

export interface Size {
  width: number;
  height: number;
}

/** 처음 크기. 크기를 바꾼 적이 없으면 이 크기로 열고, 되돌리기도 이 크기로 */
export const PANEL_DEFAULT: Size = { width: 360, height: 540 };
/** 사용자가 바꿀 수 있는 범위. 높이의 위쪽 끝은 작업 영역 높이 */
export const PANEL_MIN: Size = { width: 320, height: 420 };
export const PANEL_MAX_WIDTH = 560;

/** 펫과 패널 사이 틈 */
const GAP = 6;
/** 기본 자리에서 이만큼 안쪽에 놓으면 옮긴 것으로 치지 않는다 (살짝 밀린 것까지 기억하지 않게) */
export const SNAP_PX = 24;
/** 저장된 거리가 이보다 크면 깨진 값으로 본다 (모니터 몇 대를 건너뛰는 값) */
const MAX_OFFSET = 20_000;

/**
 * 패널 크기를 범위 안으로. 너비 320~560, 높이 420 이상이고 둘 다 작업 영역보다 크지 않게
 * (작업 영역이 최소보다 작으면 작업 영역이 이긴다: 창이 통째로 보이는 쪽이 먼저)
 */
export function clampPanelSize(size: Size, area: Rect): Size {
  const num = (v: number, fallback: number) => (Number.isFinite(v) ? Math.round(v) : fallback);
  const w = Math.min(Math.max(num(size.width, PANEL_DEFAULT.width), PANEL_MIN.width), PANEL_MAX_WIDTH);
  const h = Math.max(num(size.height, PANEL_DEFAULT.height), PANEL_MIN.height);
  return { width: Math.min(w, area.width), height: Math.min(h, area.height) };
}

/**
 * 끌어서 바꾸는 중의 새 모습. 왼쪽 위는 그대로 두고 크기만 범위 안으로 바꾸되, 오른쪽이나 아래가 작업 영역을
 * 넘으면 위치를 안쪽으로 민다 (펫이 화면 아래에 있으면 패널 아래 끝이 거기라 아래로는 못 늘기 때문)
 */
export function resizePanelRect(rect: Rect, want: Size, area: Rect): Rect {
  return clampIntoAreas({ ...rect, ...clampPanelSize(want, area) }, [area]);
}

/** 기본 자리: 펫 왼쪽(자리가 없으면 오른쪽), 아래 끝을 펫과 맞춘다. 펫이 있는 화면 안으로. */
export function defaultPanelBounds(pet: Rect, size: Size, petArea: Rect): Rect {
  const left = pet.x - size.width - GAP;
  const x = left >= petArea.x ? left : pet.x + pet.width + GAP;
  const y = pet.y + pet.height - size.height;
  return clampIntoAreas({ x, y, ...size }, [petArea]);
}

/** 저장 파일 내용이 패널 거리로 쓸 만한지. 없거나 깨졌으면 undefined (기본 자리) */
export function parsePanelOffset(saved: unknown): Point | undefined {
  if (typeof saved !== 'object' || saved === null) return undefined;
  const { dx, dy } = saved as Record<string, unknown>;
  const ok = (v: unknown): v is number =>
    typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= MAX_OFFSET;
  if (!ok(dx) || !ok(dy)) return undefined;
  return { x: Math.round(dx), y: Math.round(dy) };
}

/**
 * 열 때 자리. 기억한 거리가 있으면 펫에서 그만큼, 없으면 기본 자리.
 * 어느 쪽이든 지금 보이는 화면 안으로 끌어온다 (모니터를 뺐거나 배치가 바뀌었거나 펫이 화면 끝으로 걸어갔을 때).
 */
export function placePanel(
  pet: Rect,
  size: Size,
  petArea: Rect,
  areas: readonly Rect[],
  offset: Point | undefined,
): Rect {
  // 화면이 작으면 위치만 옮기지 않고 크기를 먼저 줄인다 (창이 통째로 보이게)
  const fit = (s: Size, area: Rect): Size => ({
    width: Math.min(s.width, area.width),
    height: Math.min(s.height, area.height),
  });
  if (!offset) return defaultPanelBounds(pet, fit(size, petArea), petArea);
  const list = areas.length ? areas : [petArea];
  const want = { x: pet.x + offset.x, y: pet.y + offset.y, ...size };
  const area = nearestArea(want, list) ?? petArea;
  return clampIntoAreas({ ...want, ...fit(size, area) }, list);
}

/**
 * 사용자가 패널을 놓은 자리에서 기억할 거리. 기본 자리 가까이(SNAP_PX 안) 놓았으면 undefined (기억을 지우고 기본으로).
 * 기본 자리는 지금 펫 기준으로 다시 계산해 넘긴다.
 */
export function panelOffsetAfterMove(panel: Rect, pet: Rect, defaultRect: Rect): Point | undefined {
  if (Math.abs(panel.x - defaultRect.x) <= SNAP_PX && Math.abs(panel.y - defaultRect.y) <= SNAP_PX)
    return undefined;
  return { x: panel.x - pet.x, y: panel.y - pet.y };
}
