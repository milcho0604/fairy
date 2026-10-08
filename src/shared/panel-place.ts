// 패널 자리. 기본은 펫 옆이고, 사용자가 끌어 옮기면 펫에서 떨어진 거리(펫 왼쪽 위 기준)를 기억한다.
// 펫은 혼자 걸어 다니고 끌려 다니니 화면 위 절대 자리가 아니라 펫과의 거리로 기억해야 다음에 열어도 펫 곁에 뜬다.
import { clampIntoAreas, type Point, type Rect } from './geometry.ts';

export interface Size {
  width: number;
  height: number;
}

/** 펫과 패널 사이 틈 */
const GAP = 6;
/** 기본 자리에서 이만큼 안쪽에 놓으면 옮긴 것으로 치지 않는다 (살짝 밀린 것까지 기억하지 않게) */
export const SNAP_PX = 24;
/** 저장된 거리가 이보다 크면 깨진 값으로 본다 (모니터 몇 대를 건너뛰는 값) */
const MAX_OFFSET = 20_000;

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
  if (!offset) return defaultPanelBounds(pet, size, petArea);
  return clampIntoAreas(
    { x: pet.x + offset.x, y: pet.y + offset.y, ...size },
    areas.length ? areas : [petArea],
  );
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
