// 가져온 페어리의 2D 그림 세트 자리 재기 (2026-10-13, shared/pet-sprites.ts). 기본 페어리 손그림은 그림마다 자리 값을 손으로 적었지만
// (cute2d.ts CUTE_GEOM), 가져온 그림은 누가 어떻게 그렸는지 모른다. 그림의 불투명한 상자를 재서 같은 값(CuteGeom)을 만든다:
// 자세마다 바닥선(상자 아래)과 꼭대기, 서기 그림의 가운데와 키로 배율, 머리 자리는 서기 키에 비례해 어림한다.
// 그리기는 기본 페어리와 같은 draw.ts drawCute 가 한다

import { CUTE_POSES, type CuteGeom, type CutePose } from './cute2d.ts';

/** 그림 속 불투명한 상자 (그림 좌표, bottom 과 right 는 마지막 칸 다음) */
export interface AlphaBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** 이 값보다 진한 알파만 그림으로 본다 (손그림 테두리 둘레 흐린 가장자리는 뺀다) */
const ALPHA_MIN = 24;

/** RGBA 바이트(getImageData)에서 불투명한 상자. 다 투명하면 undefined */
export function alphaBox(data: ArrayLike<number>, w: number, h: number): AlphaBox | undefined {
  let left = w;
  let top = h;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    for (let x = 0; x < w; x++) {
      if ((data[row + x * 4 + 3] ?? 0) < ALPHA_MIN) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      bottom = y;
    }
  }
  return right < 0 ? undefined : { left, top, right: right + 1, bottom: bottom + 1 };
}

/** 서기 그림 키를 펫 캔버스에서 이만큼으로 (곰돌이 손그림 서기 368 x 0.34 = 125) */
const IDLE_TALL = 125;
/** 가장 키 큰 자세(들림, 기쁨)도 바닥 154 에서 캔버스 위로 잘리지 않게 */
const MAX_TALL = 140;
/** 가장 넓은 자세도 캔버스 160 안에 */
const MAX_WIDE = 156;

/**
 * 자세마다 잰 상자로 그림 자리 값. 서기 상자가 없으면 undefined (세트로 쓰지 않는다).
 * 빠진 자세는 서기 상자로 (pet-sprites.ts fillSprites 와 같이 서기 그림을 쓴다)
 */
export function spriteGeom(
  boxes: Partial<Record<CutePose, AlphaBox>>,
  size: { w: number; h: number },
): CuteGeom | undefined {
  const idle = boxes.idle;
  if (!idle) return undefined;
  const box = (pose: CutePose): AlphaBox => boxes[pose] ?? idle;
  const cx = (idle.left + idle.right) / 2;
  const idleTall = Math.max(1, idle.bottom - idle.top);
  // 가운데에서 가장 먼 쪽 두 배가 폭 (좌우로 뒤집어 걸어도 캔버스 안에)
  let tallest = 0;
  let widest = 0;
  for (const pose of CUTE_POSES) {
    const b = box(pose);
    tallest = Math.max(tallest, b.bottom - b.top);
    widest = Math.max(widest, 2 * Math.max(cx - b.left, b.right - cx));
  }
  const scale = Math.min(
    IDLE_TALL / idleTall,
    MAX_TALL / Math.max(1, tallest),
    MAX_WIDE / Math.max(1, widest),
  );
  // 머리는 서기 키에 비례해 어림한다 (곰돌이 손그림: 서기 키 368 에 머리 세로 반지름 97, 가로 126)
  const headR = {
    x: Math.min((idle.right - idle.left) / 2, idleTall * 0.34),
    y: idleTall * 0.26,
  };
  const head = (pose: CutePose) => {
    const b = box(pose);
    // 누운 잠은 키가 낮아 머리가 몸 높이 가운데쯤
    const y = Math.min(b.top + headR.y * 1.15, (b.top + b.bottom) / 2);
    return { x: (b.left + b.right) / 2, y, rot: 0 };
  };
  const idleHead = head('idle');
  return {
    scale,
    top: (pose) => box(pose).top,
    head,
    headR,
    eye: { dx: headR.x * 0.45, dy: headR.y * 0.2 },
    mouthDy: headR.y * 0.55,
    faceCut: {
      x0: idle.left,
      x1: idle.right,
      up: Math.max(1, idleHead.y - idle.top),
      rx: headR.x * 1.05,
      ry: headR.y * 1.1,
    },
    scarfDrop: 0,
    size,
    cx,
    ground: (pose) => box(pose).bottom,
  };
}
