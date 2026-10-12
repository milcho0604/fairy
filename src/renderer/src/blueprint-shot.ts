// 설계도를 정면에서 한 장 그린다 (PNG data URL). 만들기 창의 미리보기와 저장할 펫 그림, 그리고 걸음새로 몸을
// 다시 만든 뒤 펫 화면이 새 펫 그림을 그릴 때 같이 쓴다 (메인이 받아 저장한다, maker.ts remake).
// three.js 가 든 pet3d.ts 는 부르는 쪽이 넘긴다 (펫 화면은 입체를 쓸 때만 그 모듈을 불러온다)
import type { Blueprint } from '../../shared/pet3d/blueprint.ts';
import { CANVAS_SIZE } from './draw.ts';
import type { Pet3D } from './pet3d.ts';

/**
 * 기본은 흰 바탕 320px (사진과 견주기 좋다). clear 면 바탕 없이 그려 그림 둘레를 잘라 낸다 (펫 그림: 평면 보기,
 * 보관함, 갤러리 작은 그림). 그린 뒤 pet 을 비운다. 못 그리면 undefined
 */
export function shotOf(
  pet: Pet3D,
  model: Blueprint,
  opts: { side?: number; clear?: boolean } = {},
): string | undefined {
  const side = opts.side ?? 320;
  const canvas = document.createElement('canvas');
  canvas.width = side;
  canvas.height = side;
  const ctx = canvas.getContext('2d', { willReadFrequently: !!opts.clear });
  if (!ctx) return undefined;
  try {
    pet.setBlueprint(model);
    pet.spin = 0;
    pet.tilt = 0;
    if (!opts.clear) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, side, side);
    }
    const k = side / CANVAS_SIZE;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    pet.draw(ctx, { mood: 'idle', elapsed: 0, blink: -1 }, 0, 1, 1, undefined);
    return opts.clear ? trimmed(canvas) : canvas.toDataURL('image/png');
  } catch {
    return undefined;
  } finally {
    pet.clear();
  }
}

/** 투명한 둘레를 잘라 낸 PNG (조금 여백을 둔다). 다 비었으면 undefined */
export function trimmed(canvas: HTMLCanvasElement): string | undefined {
  const g = canvas.getContext('2d');
  if (!g) return undefined;
  const { width: w, height: h } = canvas;
  const d = g.getImageData(0, 0, w, h).data;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if ((d[(y * w + x) * 4 + 3] ?? 0) > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (x1 < 0) return undefined;
  const pad = 4;
  x0 = Math.max(0, x0 - pad);
  y0 = Math.max(0, y0 - pad);
  x1 = Math.min(w - 1, x1 + pad);
  y1 = Math.min(h - 1, y1 + pad);
  const out = document.createElement('canvas');
  out.width = x1 - x0 + 1;
  out.height = y1 - y0 + 1;
  out.getContext('2d')?.drawImage(canvas, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out.toDataURL('image/png');
}
