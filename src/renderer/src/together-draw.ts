// 같이 지내는 느낌 그리기 (shared/together.ts): 같이 타자 치기의 작은 키보드와 두드리는 앞발, 같이 일하는 연필과
// 반짝이, 집중한 눈썹, 매일 쪽지(접은 종이, 특별한 편지 봉투). 2D, 사진, 입체 펫이 같이 쓴다 (160 기준 좌표).
// 펫 몸은 그리지 않는다: 2D 손은 draw.ts, 입체 팔은 pet3d.ts 가 같은 박자(tapPaws)로 움직인다.
import type { NoteLook } from '../../shared/together.ts';

/** 한 번 두드리는 데 걸리는 시간 (양발 번갈아 한 번씩이면 두 배) */
export const TAP_BEAT_MS = 190;
/** 키보드가 나오고 들어가는 시간 */
export const TAP_IN_MS = 260;
export const TAP_OUT_MS = 520;
/** 두드리는 동안 그리는 빠르기 (부스트면 두 배) */
export const TAP_FPS = 12;

/**
 * 앞발 [왼, 오른]을 내리누른 정도 0~1. 번갈아 두드리고(봉고 고양이처럼), 가끔 두 발을 같이 한 번 (스페이스 키).
 * calm(움직임 줄이기)이면 두 발 다 키보드 위에 가만히 얹는다
 */
export function tapPaws(ms: number, calm = false): [number, number] {
  if (calm) return [0.35, 0.35];
  const beat = ms / TAP_BEAT_MS;
  const i = Math.floor(beat);
  const f = beat - i;
  // 누르는 곡선: 빨리 내려갔다 천천히 올라온다
  const press = f < 0.35 ? f / 0.35 : 1 - (f - 0.35) / 0.65;
  // 여덟 박마다 한 번 두 발 같이 (스페이스)
  if (i % 8 === 7) return [press, press];
  return i % 2 === 0 ? [press, 0.12] : [0.12, press];
}

const KEY_TOP = '#fbfcfd';
const KEY_BASE = '#aab2bc';
const KEY_LINE = '#6f7781';
const KEY_DARK = '#565d67';
const KEY_LIT = '#ffd54a';

/**
 * 작은 키보드 (바닥 앞). cx 가운데, y 윗면 위쪽 끝, w 너비. k 는 나온 정도 0~1 (아래에서 올라오며 짙어진다).
 * pressed 는 앞발이 누른 쪽 [왼, 오른] (0.6 넘으면 그 아래 키에 불이 들어온다)
 */
export function drawKeyboard(
  ctx: CanvasRenderingContext2D,
  cx: number,
  y: number,
  w: number,
  k: number,
  pressed: readonly [number, number] = [0, 0],
): void {
  if (k <= 0) return;
  const h = w * 0.2;
  const x = cx - w / 2;
  ctx.save();
  ctx.globalAlpha = Math.min(1, k * 1.4);
  ctx.translate(0, (1 - k) * 10);
  // 몸통 (옆면이 아래로 조금 보인다)
  round(ctx, x, y + 2, w, h + 2, 4);
  ctx.fillStyle = KEY_DARK;
  ctx.fill();
  round(ctx, x, y, w, h, 4);
  ctx.fillStyle = KEY_BASE;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = KEY_LINE;
  ctx.stroke();
  // 키: 두 줄과 스페이스
  const cols = 7;
  const pad = w * 0.06;
  const gap = 1.6;
  const kw = (w - pad * 2 - gap * (cols - 1)) / cols;
  const kh = (h - pad * 2 - gap * 2) / 3;
  const lit = (row: number, col: number) => {
    if (row !== 1) return false;
    if (pressed[0] > 0.6 && col === 2) return true;
    return pressed[1] > 0.6 && col === 4;
  };
  for (let row = 0; row < 2; row++)
    for (let col = 0; col < cols; col++) {
      round(ctx, x + pad + col * (kw + gap), y + pad + row * (kh + gap), kw, kh, 1.4);
      ctx.fillStyle = lit(row, col) ? KEY_LIT : KEY_TOP;
      ctx.fill();
    }
  const space = Math.min(pressed[0], pressed[1]) > 0.6;
  round(ctx, cx - w * 0.22, y + pad + 2 * (kh + gap), w * 0.44, kh, 1.4);
  ctx.fillStyle = space ? KEY_LIT : KEY_TOP;
  ctx.fill();
  ctx.restore();
}

/**
 * 키보드 위 앞발 둘 (사진 펫처럼 손이 따로 없는 몸). 두드리면 내려와 키를 누른다.
 * 색은 따뜻한 크림색과 갈색 선 (사진 색을 모르니 어느 몸에나 어울리게)
 */
export function drawTapPaws(
  ctx: CanvasRenderingContext2D,
  cx: number,
  keyY: number,
  w: number,
  k: number,
  press: readonly [number, number],
  color = { body: '#fff1de', line: '#9c7b5c' },
): void {
  if (k <= 0) return;
  ctx.save();
  ctx.globalAlpha = Math.min(1, k * 1.4);
  ctx.lineWidth = 1.8;
  for (const side of [-1, 1] as const) {
    const p = press[side < 0 ? 0 : 1];
    const x = cx + side * w * 0.17;
    const y = keyY - 7 + p * 5 + (1 - k) * 8;
    ctx.beginPath();
    ctx.ellipse(x, y, 7.5, 6, 0, 0, Math.PI * 2);
    ctx.fillStyle = color.body;
    ctx.fill();
    ctx.strokeStyle = color.line;
    ctx.stroke();
    // 발가락 홈 둘
    ctx.beginPath();
    for (const dx of [-2.3, 2.3]) {
      ctx.moveTo(x + dx, y + 2.5);
      ctx.lineTo(x + dx, y + 5);
    }
    ctx.stroke();
  }
  ctx.restore();
}

/** 연필 (같이 일하는 표정). x, y 는 쥔 자리, angle 은 기울기(라디안, 0 이면 위로 선다) */
export function drawPencil(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  len = 24,
): void {
  const w = 5;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.lineWidth = 1.2;
  ctx.lineJoin = 'round';
  // 몸통 (쥔 자리에서 위로 len 의 0.62, 아래로 나머지)
  const top = -len * 0.62;
  const bottom = len * 0.38;
  // 지우개와 쇠 띠
  ctx.fillStyle = '#ff9aa8';
  round(ctx, -w / 2, top - 5, w, 5, 1.5);
  ctx.fill();
  ctx.strokeStyle = '#b8606e';
  ctx.stroke();
  ctx.fillStyle = '#c9ced6';
  ctx.fillRect(-w / 2, top - 1.5, w, 2.5);
  ctx.fillStyle = '#ffcc4d';
  ctx.fillRect(-w / 2, top + 1, w, bottom - top - 1);
  ctx.strokeStyle = '#9a6b00';
  ctx.strokeRect(-w / 2, top - 1.5, w, bottom - top + 1.5);
  // 깎은 나무와 심
  ctx.beginPath();
  ctx.moveTo(-w / 2, bottom);
  ctx.lineTo(w / 2, bottom);
  ctx.lineTo(0, bottom + 7);
  ctx.closePath();
  ctx.fillStyle = '#f2d2a0';
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-1.3, bottom + 5);
  ctx.lineTo(1.3, bottom + 5);
  ctx.lineTo(0, bottom + 7.2);
  ctx.closePath();
  ctx.fillStyle = '#3b3f45';
  ctx.fill();
  ctx.restore();
}

/** 집중한 눈썹 하나. x, y 는 눈 가운데, side 는 -1 왼눈 1 오른눈. r 은 눈 크기 (160 기준 2D 눈은 4.5) */
export function drawBrow(ctx: CanvasRenderingContext2D, x: number, y: number, side: -1 | 1, r = 4.5): void {
  const up = r * 2;
  const half = r * 0.95;
  ctx.save();
  ctx.strokeStyle = '#1f2328';
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(1.4, r * 0.4);
  ctx.beginPath();
  // 살짝 둥글고 안쪽이 아주 조금 내려온다: "집중"으로 읽히고 화난 얼굴은 아니게
  ctx.moveTo(x - side * half, y - up + r * 0.14);
  ctx.quadraticCurveTo(x, y - up - r * 0.32, x + side * half, y - up - r * 0.06);
  ctx.stroke();
  ctx.restore();
}

/** 머리 옆 반짝이 둘 (같이 일하는 중). ms 는 흐른 시간, calm 이면 가만히 */
export function drawWorkSparkle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ms: number,
  calm = false,
): void {
  ctx.save();
  ctx.fillStyle = '#ffc94d';
  const tw = calm ? 1 : 0.75 + 0.25 * Math.sin(ms / 260);
  const tw2 = calm ? 1 : 0.7 + 0.3 * Math.sin(ms / 260 + 2.1);
  star(ctx, x, y, 6 * tw);
  ctx.globalAlpha = 0.85;
  star(ctx, x + 9, y + 9, 3.6 * tw2);
  ctx.restore();
}

/**
 * 든 쪽지. 접은 종이(note)는 크림색 쪽지에 접힌 귀퉁이와 글 줄, 특별한 편지(letter)는 분홍 봉투에 하트 스티커.
 * cx, cy 가운데, s 배율 (1 이면 너비 28)
 */
export function drawHeldNote(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  look: NoteLook,
  s = 1,
): void {
  const w = 28 * s;
  const h = 19 * s;
  const x = cx - w / 2;
  const y = cy - h / 2;
  ctx.save();
  ctx.lineWidth = 1.4;
  ctx.lineJoin = 'round';
  // 살짝 기울여 손에 쥔 느낌
  ctx.translate(cx, cy);
  ctx.rotate(-0.08);
  ctx.translate(-cx, -cy);
  if (look === 'letter') {
    round(ctx, x, y, w, h, 2.5);
    ctx.fillStyle = '#ffe1ea';
    ctx.fill();
    ctx.strokeStyle = '#c9849a';
    ctx.stroke();
    // 봉투 덮개
    ctx.beginPath();
    ctx.moveTo(x + 1, y + 1);
    ctx.lineTo(cx, y + h * 0.58);
    ctx.lineTo(x + w - 1, y + 1);
    ctx.stroke();
    // 하트 스티커
    ctx.fillStyle = '#ff6b8a';
    heart(ctx, cx, y + h * 0.6, 5.2 * s);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.stroke();
  } else {
    const fold = 6 * s;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + w - fold, y);
    ctx.lineTo(x + w, y + fold);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x, y + h);
    ctx.closePath();
    ctx.fillStyle = '#fffaf0';
    ctx.fill();
    ctx.strokeStyle = '#b8a27a';
    ctx.stroke();
    // 접힌 귀퉁이
    ctx.beginPath();
    ctx.moveTo(x + w - fold, y);
    ctx.lineTo(x + w - fold, y + fold);
    ctx.lineTo(x + w, y + fold);
    ctx.fillStyle = '#efe3c8';
    ctx.fill();
    ctx.stroke();
    // 글 줄
    ctx.strokeStyle = '#d6c4a0';
    ctx.lineWidth = 1.2;
    ctx.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      const ly = y + h * (0.38 + i * 0.2);
      ctx.beginPath();
      ctx.moveTo(x + 4 * s, ly);
      ctx.lineTo(x + w - (i === 2 ? 11 : 5) * s, ly);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function round(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.quadraticCurveTo(x + r * 0.18, y - r * 0.18, x + r, y);
  ctx.quadraticCurveTo(x + r * 0.18, y + r * 0.18, x, y + r);
  ctx.quadraticCurveTo(x - r * 0.18, y + r * 0.18, x - r, y);
  ctx.quadraticCurveTo(x - r * 0.18, y - r * 0.18, x, y - r);
  ctx.fill();
}

function heart(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x, y + r * 0.9);
  ctx.bezierCurveTo(x - r * 1.5, y - r * 0.1, x - r * 0.7, y - r * 1.2, x, y - r * 0.45);
  ctx.bezierCurveTo(x + r * 0.7, y - r * 1.2, x + r * 1.5, y - r * 0.1, x, y + r * 0.9);
  ctx.closePath();
}
