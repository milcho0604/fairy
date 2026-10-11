// 2D 기본 펫의 철마다 옷 (shared/wear.ts). draw.ts 가 몸 좌표(몸 가운데가 0, 가로 반지름 58, 세로 반지름 50)에서 부른다.
// 모자와 꽃, 리본은 머리(몸 위쪽)에, 목도리는 입 아래에 두른다. 손은 이것 다음에 그려 늘 보인다.
// 귀는 몸보다 먼저 그려지니 모자 위로 귀 끝이 나온다 (토순이 긴 귀, 냥이 세모 귀)
import type { Outfit } from '../../shared/wear.ts';

const RX = 58;
const RY = 50;
const STROKE = 'rgba(70, 50, 40, 0.55)';

/** 몸 테두리의 가로 자리 (몸 좌표 y 에서) */
const edge = (y: number) => RX * Math.sqrt(Math.max(0, 1 - (y / RY) ** 2));

function blob(ctx: CanvasRenderingContext2D, fill: string, stroke = STROKE, width = 1.6) {
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = width;
  ctx.strokeStyle = stroke;
  ctx.stroke();
}

function beanie(ctx: CanvasRenderingContext2D, santa: boolean) {
  const knit = santa ? '#d94a3f' : '#7fb0dc';
  const trim = santa ? '#ffffff' : '#f6ecd9';
  // 둥근 모자: 몸 위쪽을 덮는 반 타원
  ctx.beginPath();
  ctx.ellipse(0, -38, 41, 27, 0, Math.PI, Math.PI * 2);
  ctx.closePath();
  blob(ctx, knit);
  // 뜨개 골
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
  ctx.lineWidth = 2;
  for (let x = -32; x <= 32; x += 9) {
    ctx.beginPath();
    ctx.moveTo(x, -38);
    ctx.quadraticCurveTo(x * 0.92, -54, x * 0.6, -66);
    ctx.stroke();
  }
  ctx.restore();
  if (santa) {
    // 산타 모자 끝: 오른쪽으로 처진 끝과 하얀 방울
    ctx.beginPath();
    ctx.moveTo(-14, -62);
    ctx.quadraticCurveTo(22, -82, 46, -58);
    ctx.quadraticCurveTo(26, -64, 16, -50);
    ctx.closePath();
    blob(ctx, knit);
    ctx.beginPath();
    ctx.arc(47, -56, 7.5, 0, Math.PI * 2);
    blob(ctx, trim);
  } else {
    ctx.beginPath();
    ctx.arc(0, -66, 8, 0, Math.PI * 2);
    blob(ctx, trim);
  }
  // 접은 단: 몸 둘레를 따라 조금 휜 띠
  const w = edge(-36) + 4;
  ctx.beginPath();
  ctx.moveTo(-w, -42);
  ctx.quadraticCurveTo(0, -46, w, -42);
  ctx.lineTo(w, -31);
  ctx.quadraticCurveTo(0, -35, -w, -31);
  ctx.closePath();
  blob(ctx, trim);
}

function straw(ctx: CanvasRenderingContext2D) {
  // 챙 (뒤쪽 반은 머리 뒤로 숨는다: 앞 반만 진하게)
  ctx.beginPath();
  ctx.ellipse(0, -44, 64, 10, 0, 0, Math.PI * 2);
  blob(ctx, '#efcf86', 'rgba(150, 110, 40, 0.6)');
  // 모자 몸통
  ctx.beginPath();
  ctx.moveTo(-30, -45);
  ctx.lineTo(-27, -68);
  ctx.quadraticCurveTo(0, -76, 27, -68);
  ctx.lineTo(30, -45);
  ctx.quadraticCurveTo(0, -40, -30, -45);
  ctx.closePath();
  blob(ctx, '#f2d695', 'rgba(150, 110, 40, 0.6)');
  // 빨간 띠
  ctx.beginPath();
  ctx.moveTo(-29.5, -51);
  ctx.quadraticCurveTo(0, -46, 29.5, -51);
  ctx.lineTo(29, -57);
  ctx.quadraticCurveTo(0, -52, -29, -57);
  ctx.closePath();
  blob(ctx, '#e2504c', 'rgba(140, 40, 30, 0.5)', 1.2);
  // 짚 결
  ctx.strokeStyle = 'rgba(170, 120, 40, 0.35)';
  ctx.lineWidth = 1;
  for (const x of [-18, -6, 6, 18]) {
    ctx.beginPath();
    ctx.moveTo(x, -58);
    ctx.lineTo(x * 0.95, -70);
    ctx.stroke();
  }
}

function flower(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.save();
  ctx.translate(x, y);
  // 잎
  ctx.beginPath();
  ctx.ellipse(-9, 8, 8, 3.6, -0.6, 0, Math.PI * 2);
  blob(ctx, '#7cc46a', 'rgba(50, 110, 40, 0.6)', 1.2);
  ctx.rotate(0.25);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    ctx.beginPath();
    ctx.ellipse(Math.cos(a) * 6.2, Math.sin(a) * 6.2, 5, 5, 0, 0, Math.PI * 2);
    blob(ctx, '#ff9ec2', '#e0708f', 1.2);
  }
  ctx.beginPath();
  ctx.arc(0, 0, 3.8, 0, Math.PI * 2);
  blob(ctx, '#ffd45c', 'rgba(200, 140, 30, 0.7)', 1);
  ctx.restore();
}

function ribbon(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-0.25);
  // 늘어진 끈 둘
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(side * 2, 2);
    ctx.lineTo(side * 7, 15);
    ctx.lineTo(side * 3, 13);
    ctx.lineTo(side * 1, 16);
    ctx.closePath();
    blob(ctx, '#e0413b', 'rgba(130, 30, 25, 0.6)', 1.2);
  }
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(side * 9, -1, 9, 6, side * 0.25, 0, Math.PI * 2);
    blob(ctx, '#e0413b', 'rgba(130, 30, 25, 0.6)', 1.2);
  }
  ctx.beginPath();
  ctx.arc(0, 0, 4, 0, Math.PI * 2);
  blob(ctx, '#f4c54a', 'rgba(150, 100, 20, 0.7)', 1);
  ctx.restore();
}

function scarf(ctx: CanvasRenderingContext2D, back: boolean) {
  const top = 19;
  const bottom = 31;
  const wt = edge(top) + 2;
  const wb = edge(bottom) + 2;
  ctx.beginPath();
  ctx.moveTo(-wt, top);
  ctx.quadraticCurveTo(0, top + 7, wt, top);
  ctx.lineTo(wb, bottom);
  ctx.quadraticCurveTo(0, bottom + 7, -wb, bottom);
  ctx.closePath();
  blob(ctx, '#e8784a', 'rgba(140, 60, 30, 0.6)');
  // 줄무늬
  ctx.save();
  ctx.clip();
  ctx.fillStyle = 'rgba(255, 230, 190, 0.7)';
  for (let x = -60; x <= 60; x += 14) ctx.fillRect(x, top - 2, 4, bottom - top + 10);
  ctx.restore();
  if (back) return;
  // 매듭과 늘어진 끝 (가운데에서 조금 오른쪽, 손과 겹치지 않게)
  ctx.beginPath();
  ctx.moveTo(10, 30);
  ctx.lineTo(24, 30);
  ctx.lineTo(27, 47);
  ctx.lineTo(13, 48);
  ctx.closePath();
  blob(ctx, '#e8784a', 'rgba(140, 60, 30, 0.6)');
  ctx.fillStyle = 'rgba(255, 230, 190, 0.7)';
  ctx.fillRect(13, 38, 13, 3);
  ctx.strokeStyle = 'rgba(140, 60, 30, 0.6)';
  ctx.lineWidth = 1.2;
  for (const x of [15, 19, 23]) {
    ctx.beginPath();
    ctx.moveTo(x + 0.6, 48);
    ctx.lineTo(x + 0.9, 52);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.ellipse(17, 27, 8, 6.5, 0, 0, Math.PI * 2);
  blob(ctx, '#e06a3e', 'rgba(140, 60, 30, 0.6)');
}

/**
 * 옷 그리기 (몸 좌표). back 은 등 돌린 모습(토라짐 3단계): 목도리 매듭은 안 보인다.
 * 머리 장식(꽃, 리본)은 귀 앞쪽 아래, 몸 위쪽 테두리 근처
 */
export function drawWear2D(ctx: CanvasRenderingContext2D, outfit: Outfit, back = false) {
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  switch (outfit) {
    case 'beanie':
    case 'santa':
      beanie(ctx, outfit === 'santa');
      break;
    case 'straw':
      straw(ctx);
      break;
    case 'scarf':
      scarf(ctx, back);
      break;
    case 'flower':
      flower(ctx, back ? -30 : 30, -38);
      break;
    case 'ribbon':
      ribbon(ctx, back ? 30 : -30, -38);
      break;
  }
  ctx.restore();
}
