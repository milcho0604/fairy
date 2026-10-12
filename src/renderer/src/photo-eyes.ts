// 사진 펫 감은 눈 (2026-10-12 사용자 보고: 초코가 자도 눈을 감지 않는다).
// 사진은 얼굴을 다시 그릴 수 없어, 눈 자리를 아는 그림(밀크, 초코, shared/starter-pets.ts STARTER_EYES)만
// 눈 위를 바로 위 털로 덮고 감은 눈 선을 긋는다. 반쯤 감으면 위쪽만 덮는다 (눈꺼풀이 내려온 것처럼).
// 평면 사진(draw.ts drawPhoto), 2.5D 판(pet3d.ts), 집 안 잠 얼굴(pet-face.ts renderFace)이 같이 쓴다

import type { EnergyLook } from '../../shared/energy.ts';
import type { PetMood } from '../../shared/pet-mood.ts';
import type { PhotoEye, PhotoEyes } from '../../shared/starter-pets.ts';

export interface EyeCue {
  mood: PetMood;
  /** 깜빡임 진행 0~1, 아니면 -1 */
  blink: number;
  activity?: { type: string; t?: number };
  /** 몸짓이 정한 눈 (move-pose.ts MovePose.eyes) */
  moveEyes?: 'closed' | 'happy' | 'half' | 'wide';
  energy?: EnergyLook;
  /** 매운맛 토라짐 단계 (draw.ts sulkStage) */
  sulk?: number;
}

/**
 * 눈을 얼마나 뜨는지: 1 다 뜸, 0 다 감음. 입체 피규어 얼굴(pet3d.ts)과 같은 때 감는다:
 * 잠은 감고, 졸음은 반쯤, 하품 가운데와 감는 몸짓(몸 털기, 끄덕)은 감고, 흥(토라짐 2단계)과 졸린 기운은 반쯤 덮는다.
 * 깜빡임은 그 위에 더한다. 놀란 눈(wide)은 뜬다
 */
export function photoEyeOpen(c: EyeCue): number {
  if (c.mood === 'sleeping') return 0;
  let open = 1;
  if (c.mood === 'dozing') open = 0.35;
  if (c.activity?.type === 'yawn' && (c.activity.t ?? 0) > 0.15 && (c.activity.t ?? 0) < 0.85) open = 0;
  if (c.moveEyes === 'closed') open = 0;
  else if (c.moveEyes === 'half') open = Math.min(open, 0.5);
  else if (c.moveEyes === 'wide') return 1;
  if (c.mood === 'sulky' && (c.sulk ?? 0) >= 2) open = Math.min(open, 0.6);
  // 졸린 기운: 뜬 눈일 때만 감기 직전 눈 (pet3d restingEye 'drowsy')
  if (open === 1 && c.energy?.stage === 'sleepy') open = 0.55;
  if (c.blink >= 0) open = Math.min(open, Math.abs(1 - 2 * c.blink));
  return Math.max(0, Math.min(1, open));
}

/** 그림 픽셀로 바꾼 눈 하나 */
interface EyePx {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

const toPx = (e: PhotoEye, w: number, h: number): EyePx => ({
  cx: e.x * w,
  cy: e.y * h,
  rx: e.rx * w,
  ry: e.ry * h,
});

/**
 * 덮개(털 조각) 상자 반 너비, 반 높이: 반지름의 이 배수. 덮개는 눈 테두리(1 배)까지 꽉, 이 배수에서 투명해진다.
 * 1.6 배 넘게 넓히면 털을 그만큼 높이(이마 위쪽)에서 가져와, 밀크는 분홍 귀 뿌리 빛이 감은 눈 위에 점으로 실렸다
 */
const BOX = 1.4;
/**
 * 덮개로 가져올 털은 눈 위 이만큼(세로 반지름 배수) 떨어진 곳. 털 조각 아래 끝이 눈 위 테두리에 닿지 않게
 * (2.2 배였을 때 털 조각 아래 끝에 눈 위 테두리가 실려, 밀크 감은 눈 선 아래에 밝은 테두리가 비쳤다).
 * 너무 멀면(3 배 넘게) 밀크는 머리 위 투명한 곳이나 분홍 귀 뿌리까지 닿는다
 */
const FROM = 2.6;

/**
 * 눈꺼풀 선: 양 끝(x0, x1)이 같은 높이 y 이고, 가운데가 sag 만큼 아래로 처진 곡선 (2차 곡선 조절점 높이 y + sag).
 * 다 감으면 눈 가운데 높이에서 아래로 처진 선(웃듯 감은 눈), 뜰수록 위로 올라간다
 */
export function lidCurve(e: EyePx, open: number): { x0: number; x1: number; y: number; sag: number } {
  return { x0: e.cx - e.rx * 0.95, x1: e.cx + e.rx * 0.95, y: e.cy - e.ry * 1.05 * open, sag: e.ry * 0.9 };
}

/** 덮개로 가져올 털 자리 (그림 픽셀). 덮개 상자와 같은 크기로 눈 위에서 */
export function lidSource(e: EyePx): { x: number; y: number; w: number; h: number } {
  return { x: e.cx - e.rx * BOX, y: e.cy - e.ry * BOX - e.ry * FROM, w: e.rx * BOX * 2, h: e.ry * BOX * 2 };
}

let made: WeakMap<object, { look: PhotoEyes; open: number; canvas: HTMLCanvasElement }> | undefined;

/**
 * 눈을 open 만큼 감은 사진. 다 뜨거나 그릴 수 없으면 사진 그대로. 그림마다 캔버스 하나를 다시 쓰고,
 * 같은 사진, 같은 눈, 같은 뜬 정도면 다시 그리지 않는다 (깜빡임은 네 틀)
 */
export function eyedPhoto<T extends CanvasImageSource & { width: number; height: number }>(
  photo: T,
  look: PhotoEyes | undefined,
  open: number,
): T | HTMLCanvasElement {
  if (!look || open >= 1 || typeof document === 'undefined') return photo;
  made ??= new WeakMap();
  const got = made.get(photo);
  if (got && got.look === look && got.open === open) return got.canvas;
  const canvas = got?.canvas ?? document.createElement('canvas');
  const w = photo.width;
  const h = photo.height;
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d');
  if (!g) return photo;
  g.clearRect(0, 0, w, h);
  g.drawImage(photo, 0, 0, w, h);
  const line = Math.max(w, h) / 110;
  for (const eye of look.eyes) drawLid(g, photo, toPx(eye, w, h), open, look.ink, line);
  made.set(photo, { look, open, canvas });
  return canvas;
}

/** 눈 하나를 덮는다: 눈 위 털 조각을 둥글고 부드럽게 오려 눈 자리에 얹고(반쯤이면 위쪽만), 눈꺼풀 선을 긋는다 */
function drawLid(
  g: CanvasRenderingContext2D,
  photo: CanvasImageSource,
  e: EyePx,
  open: number,
  ink: string,
  line: number,
): void {
  const bw = Math.ceil(e.rx * BOX * 2);
  const bh = Math.ceil(e.ry * BOX * 2);
  const x = e.cx - e.rx * BOX;
  const y = e.cy - e.ry * BOX;
  const patch = document.createElement('canvas');
  patch.width = bw;
  patch.height = bh;
  const p = patch.getContext('2d');
  if (!p) return;
  const from = lidSource(e);
  p.drawImage(photo, from.x, from.y, bw, bh, 0, 0, bw, bh);
  // 눈 테두리(반지름 1 배)까지는 꽉, BOX 배 밖은 투명 (타원이라 세로로 눌러 그린다)
  p.globalCompositeOperation = 'destination-in';
  p.save();
  p.translate(bw / 2, bh / 2);
  p.scale(1, e.ry / e.rx);
  const fade = p.createRadialGradient(0, 0, e.rx, 0, 0, e.rx * BOX);
  fade.addColorStop(0, 'rgba(0,0,0,1)');
  fade.addColorStop(1, 'rgba(0,0,0,0)');
  p.fillStyle = fade;
  p.fillRect(-bw, -bh * (e.rx / e.ry), bw * 2, bh * 2 * (e.rx / e.ry));
  p.restore();
  const c = lidCurve(e, open);
  g.save();
  if (open > 0) {
    // 눈꺼풀 선 위쪽만 덮는다
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + bw, y);
    g.lineTo(x + bw, c.y);
    g.lineTo(c.x1, c.y);
    g.quadraticCurveTo(e.cx, c.y + c.sag, c.x0, c.y);
    g.lineTo(x, c.y);
    g.closePath();
    g.clip();
  }
  g.drawImage(patch, x, y);
  g.restore();
  g.save();
  g.strokeStyle = ink;
  g.lineWidth = line;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(c.x0, c.y);
  g.quadraticCurveTo(e.cx, c.y + c.sag, c.x1, c.y);
  g.stroke();
  g.restore();
}
