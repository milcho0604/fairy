// 말풍선이 뜰 때 펫 창을 어떻게 키울지. 펫은 화면에서 제자리에 있고, 창만 위(또는 아래)로 넓어진다.
import type { Rect } from './geometry.ts';

/** 말풍선과 펫 사이 간격 (꼬리 높이 포함) */
export const BUBBLE_GAP = 10;

export interface BubbleLayout {
  window: Rect;
  /** 창 안에서 펫(캔버스) 위치 */
  pet: { x: number; y: number; size: number };
  bubble?: {
    x: number;
    y: number;
    /** 위면 꼬리가 아래를 향한다 */
    side: 'above' | 'below';
    /** 말풍선 안에서 꼬리 끝의 x (펫 가운데를 가리킨다) */
    tailX: number;
  };
}

/**
 * pet: 화면 좌표의 펫 사각형. size: 말풍선 크기. area: 펫이 있는 모니터 작업 영역.
 * 위에 자리가 없으면 아래로, 옆으로 넘치면 창을 안으로 민다(펫은 그대로).
 */
export function layoutBubble(
  pet: Rect,
  size: { width: number; height: number } | undefined,
  area: Rect,
): BubbleLayout {
  if (!size) return { window: { ...pet }, pet: { x: 0, y: 0, size: pet.width } };
  const width = Math.max(pet.width, Math.ceil(size.width));
  const height = pet.height + Math.ceil(size.height) + BUBBLE_GAP;
  const above = pet.y - (height - pet.height) >= area.y;
  const centerX = pet.x + pet.width / 2;
  let x = Math.round(centerX - width / 2);
  x = Math.min(Math.max(x, area.x), Math.max(area.x, area.x + area.width - width));
  const y = above ? pet.y - (height - pet.height) : pet.y;
  const window = { x, y, width, height };
  const petInWindow = { x: pet.x - x, y: pet.y - y, size: pet.width };
  // 말풍선은 펫 가운데 위에 두되 창 밖으로 나가지 않게 한다.
  const bubbleWidth = Math.ceil(size.width);
  const bx = Math.min(
    Math.max(0, Math.round(petInWindow.x + pet.width / 2 - bubbleWidth / 2)),
    width - bubbleWidth,
  );
  return {
    window,
    pet: petInWindow,
    bubble: {
      x: bx,
      y: above ? 0 : pet.height + BUBBLE_GAP,
      side: above ? 'above' : 'below',
      tailX: Math.round(petInWindow.x + pet.width / 2 - bx),
    },
  };
}
