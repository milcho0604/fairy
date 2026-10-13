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

/**
 * 크기를 재기 전 말풍선 자리를 어림할 때 쓰는 크기. pet.css #bubble 의 가장 넓은 폭(240)에 여백,
 * 두세 줄 높이. 두 펫이 같이 말할 때 겹치는지 미리 볼 때만 쓴다
 */
export const BUBBLE_GUESS = { width: 260, height: 96 } as const;

/** 화면 좌표의 말풍선 사각형 (layoutBubble 의 창 위치 + 창 안 말풍선 위치) */
export function bubbleRectOf(pet: Rect, size: { width: number; height: number }, area: Rect): Rect {
  const l = layoutBubble(pet, size, area);
  return {
    x: l.window.x + (l.bubble?.x ?? 0),
    y: l.window.y + (l.bubble?.y ?? 0),
    width: Math.ceil(size.width),
    height: Math.ceil(size.height),
  };
}

/** 두 말풍선 사이에 이만큼은 띄운다 (붙어 있어도 한 덩어리로 읽힌다) */
export const BUBBLE_APART = 6;

/**
 * 이 펫이 지금 말하면 다른 펫의 떠 있는 말풍선(others, 화면 좌표)과 겹치는지 (이슈 #65: 기본 펫과 친구 펫이 같이
 * 말하면 말풍선이 포개졌다). 이 펫 말풍선은 아직 크기를 모르니 가장 클 때(BUBBLE_GUESS)로 어림한다
 */
export function bubbleClashes(
  pet: Rect,
  area: Rect,
  others: readonly Rect[],
  size: { width: number; height: number } = BUBBLE_GUESS,
): boolean {
  const mine = bubbleRectOf(pet, size, area);
  return others.some(
    (o) =>
      mine.x < o.x + o.width + BUBBLE_APART &&
      o.x < mine.x + mine.width + BUBBLE_APART &&
      mine.y < o.y + o.height + BUBBLE_APART &&
      o.y < mine.y + mine.height + BUBBLE_APART,
  );
}
