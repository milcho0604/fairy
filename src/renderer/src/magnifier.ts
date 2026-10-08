// 같이 보기 돋보기 그리기 (shared/look-motion.ts 가 자세를 정한다).
// 렌즈 안은 이미 그린 펫을 그대로 확대해 보인다: 2D, 사진, 입체 어느 펫이든 같은 방법이라 눈이 커 보인다.
import { LENS_R, LENS_ZOOM, type MagnifierPose } from '../../shared/look-motion.ts';

const RIM = '#f2b84b';
const RIM_LINE = '#8a5a1a';
const WOOD = '#b0703c';
const WOOD_LINE = '#6b4220';
const SPARK = '#ffd54a';

export interface MagnifierDraw {
  pose: MagnifierPose;
  /** 렌즈를 댈 자리 (눈, 160 기준 좌표) */
  x: number;
  y: number;
  /** 손잡이를 쥐는 앞발 색 (기본 펫만. 사진과 입체는 앞발 없이) */
  paw?: { body: string; line: string };
}

/** 확대할 부분을 잠깐 옮겨 두는 곳. 한 번 만들어 다시 쓴다 */
let scratch: HTMLCanvasElement | undefined;

export function drawMagnifier(ctx: CanvasRenderingContext2D, m: MagnifierDraw): void {
  const { pose } = m;
  if (pose.alpha <= 0) return;
  const cx = m.x + pose.dx;
  const cy = m.y + pose.dy;
  const r = LENS_R * pose.scale;
  ctx.save();
  ctx.globalAlpha = pose.alpha;
  drawHandle(ctx, cx, cy, r, pose.angle, m.paw);
  zoomInto(ctx, cx, cy, r - 2);
  drawGlass(ctx, cx, cy, r);
  if (pose.sparkle >= 0) drawSparkles(ctx, cx, cy, r, pose.sparkle, pose.angle);
  ctx.restore();
}

/** 렌즈 안: 이미 그린 그림의 가운데 부분을 키워 다시 그린다 */
function zoomInto(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  const t = ctx.getTransform();
  const k = t.a || 1;
  const canvas = ctx.canvas;
  const src = (r / LENS_ZOOM) * k;
  const sx = Math.round(cx * k + t.e - src);
  const sy = Math.round(cy * k + t.f - src);
  const size = Math.max(1, Math.round(src * 2));
  scratch ??= document.createElement('canvas');
  if (scratch.width !== size || scratch.height !== size) {
    scratch.width = size;
    scratch.height = size;
  }
  const s = scratch.getContext('2d');
  if (!s) return;
  s.clearRect(0, 0, size, size);
  s.drawImage(canvas, sx, sy, size, size, 0, 0, size, size);
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  // 렌즈 자리를 비우고(작은 원래 그림이 비치지 않게) 키운 그림을 넣는다. 내리며 흐려질 때는 둘이 섞인다
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(scratch, cx - r, cy - r, r * 2, r * 2);
  ctx.restore();
}

function drawGlass(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  // 유리: 아주 옅은 하늘색, 왼쪽 위가 밝게
  const glass = ctx.createRadialGradient(cx - r * 0.4, cy - r * 0.45, r * 0.1, cx, cy, r);
  glass.addColorStop(0, 'rgba(255, 255, 255, 0.34)');
  glass.addColorStop(0.55, 'rgba(214, 236, 255, 0.14)');
  glass.addColorStop(1, 'rgba(160, 205, 245, 0.26)');
  ctx.beginPath();
  ctx.arc(cx, cy, r - 2, 0, Math.PI * 2);
  ctx.fillStyle = glass;
  ctx.fill();
  // 반짝 줄 (왼쪽 위)
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.66, Math.PI * 1.08, Math.PI * 1.36);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx - r * 0.12, cy - r * 0.64, 1.1, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.fill();
  // 테: 금색 굵은 고리에 짙은 테두리 (밝은 화면, 어두운 화면 둘 다에서 보이게)
  ctx.lineWidth = 4.4;
  ctx.strokeStyle = RIM;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = RIM_LINE;
  for (const rr of [r + 2.3, r - 2.3]) {
    ctx.beginPath();
    ctx.arc(cx, cy, rr, 0, Math.PI * 2);
    ctx.stroke();
  }
}

/** 손잡이: 테에서 짧은 금속 목, 나무 자루. 기본 펫이면 자루를 쥔 둥근 앞발 */
function drawHandle(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  angle: number,
  paw: MagnifierDraw['paw'],
) {
  const k = r / LENS_R;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.lineWidth = 1.2;
  // 목
  ctx.beginPath();
  ctx.roundRect(r, -2.6 * k, 5 * k, 5.2 * k, 1.5 * k);
  ctx.fillStyle = RIM;
  ctx.fill();
  ctx.strokeStyle = RIM_LINE;
  ctx.stroke();
  // 자루
  ctx.beginPath();
  ctx.roundRect(r + 4.5 * k, -3.4 * k, 20 * k, 6.8 * k, 3.4 * k);
  ctx.fillStyle = WOOD;
  ctx.fill();
  ctx.strokeStyle = WOOD_LINE;
  ctx.stroke();
  // 자루 결 한 줄
  ctx.beginPath();
  ctx.moveTo(r + 8 * k, -1 * k);
  ctx.lineTo(r + 14 * k, -1 * k);
  ctx.strokeStyle = 'rgba(255, 230, 200, 0.55)';
  ctx.lineCap = 'round';
  ctx.stroke();
  if (paw) {
    ctx.beginPath();
    ctx.ellipse(r + 19 * k, 1.5 * k, 5.4 * k, 4.8 * k, 0, 0, Math.PI * 2);
    ctx.fillStyle = paw.body;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = paw.line;
    ctx.stroke();
  }
  ctx.restore();
}

/** 찾았다: 렌즈 둘레 (손잡이 반대쪽)에서 별 셋이 차례로 반짝 */
function drawSparkles(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  t: number,
  angle: number,
) {
  const away = angle + Math.PI;
  for (const [i, [da, dist, size]] of (
    [
      [-0.55, 1.45, 4.2],
      [0.15, 1.6, 5.2],
      [0.8, 1.4, 3.6],
    ] as const
  ).entries()) {
    const local = (t - i * 0.16) / 0.55;
    if (local <= 0 || local >= 1) continue;
    const grow = Math.sin(local * Math.PI);
    const a = away + da;
    star(ctx, cx + Math.cos(a) * r * dist, cy + Math.sin(a) * r * dist, size * grow);
  }
}

function star(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  if (s <= 0.2) return;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4 - Math.PI / 2;
    const rr = i % 2 === 0 ? s : s * 0.36;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fillStyle = SPARK;
  ctx.fill();
  ctx.lineWidth = 0.9;
  ctx.strokeStyle = RIM_LINE;
  ctx.stroke();
}
