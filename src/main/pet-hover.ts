import type { Point, Rect } from '../shared/geometry.ts';

// 펫 창은 펫이나 말풍선 위가 아니면 마우스를 통과시킨다(setIgnoreMouseEvents). 위인지는 화면이 마우스 움직임으로 알려 주는데,
// 마우스가 가만히 있는 채 펫이 걸어 비켜 가면 움직임이 없어 "위" 표시가 남고, 그 투명한 자리가 아래 패널의 클릭을 먹었다.

/** 가장자리에서 깜박이지 않게 둘레에 두는 여유(px). 안쪽 픽셀 판정은 화면이 다음 움직임 때 다시 한다 */
export const HOVER_SLACK = 6;

const inside = (p: Point, r: Rect, slack: number): boolean =>
  p.x >= r.x - slack && p.x < r.x + r.width + slack && p.y >= r.y - slack && p.y < r.y + r.height + slack;

/** 커서가 아직 펫이나 말풍선 근처인가 */
export function stillNearPet(cursor: Point, pet: Rect, bubble?: Rect): boolean {
  return inside(cursor, pet, HOVER_SLACK) || (bubble !== undefined && inside(cursor, bubble, HOVER_SLACK));
}

export interface HoverGuardDeps {
  /** 펫 위에 있다고 알고 있나 */
  isOver: () => boolean;
  /** 끌기, 보기, 휠 통과 중처럼 통과 상태를 다른 곳이 쥐고 있나 */
  busy: () => boolean;
  cursor: () => Point;
  pet: () => Rect;
  bubble: () => Rect | undefined;
  /** 위 표시를 거두고 마우스를 통과시킨다 (화면에도 알린다) */
  release: () => void;
}

/** 펫이 움직이거나 모양이 바뀔 때마다 부른다. 위 표시가 없으면 비용이 없다 */
export function createHoverGuard(d: HoverGuardDeps): () => boolean {
  return () => {
    if (!d.isOver() || d.busy()) return false;
    if (stillNearPet(d.cursor(), d.pet(), d.bubble())) return false;
    d.release();
    return true;
  };
}
