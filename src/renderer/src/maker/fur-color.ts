// 털 다듬기 뒤 털색 확인 (서버, 내 Mac 둘 다). klein 이 털을 풍성하게 하며 색을 바꿀 때가 있어서,
// 다듬기 전 그림과 견줘 많이 바뀌었으면 앞 그림을 쓰고, 조금이면 앞 그림 색에 맞춘다. 계산은 shared/color-match.ts (시험함),
// 여기는 그림 풀기와 다시 묶기만
import { colorShift, MAX_FUR_SHIFT, matchColors, type Rgba } from '../../../shared/color-match.ts';

/** data URL 그림을 w x h 캔버스에 그린다 (앞 그림은 털 그림 크기로 늘이거나 줄인다) */
async function pixels(
  url: string,
  size?: { w: number; h: number },
): Promise<{ rgba: Rgba; image: ImageData; canvas: HTMLCanvasElement }> {
  const bitmap = await createImageBitmap(await (await fetch(url)).blob());
  const w = size?.w ?? bitmap.width;
  const h = size?.h ?? bitmap.height;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('no canvas');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const image = ctx.getImageData(0, 0, w, h);
  // rgba.data 는 image.data 와 같은 배열이라 matchColors 가 고치면 image 도 바뀐다
  return { rgba: { w, h, data: image.data }, image, canvas };
}

/**
 * 털 그림과 다듬기 전 그림으로 쓸 그림을 고른다. 색이 크게 바뀌었으면 before, 아니면 색을 맞춘 털 그림(PNG).
 * 풀기가 실패하면 털 그림 그대로 (색 맞추기는 덤이라 그리기를 실패로 만들지 않는다)
 */
export async function settleFur(fur: string, before: string): Promise<string> {
  try {
    const f = await pixels(fur);
    const b = await pixels(before, { w: f.rgba.w, h: f.rgba.h });
    const shift = colorShift(f.rgba, b.rgba);
    if (shift > MAX_FUR_SHIFT) {
      console.info(`[maker] fur pass changed colors (${Math.round(shift)}), using the drawing before it`);
      return before;
    }
    if (!matchColors(f.rgba, b.rgba)) return fur;
    const ctx = f.canvas.getContext('2d');
    if (!ctx) return fur;
    ctx.putImageData(f.image, 0, 0);
    return f.canvas.toDataURL('image/png');
  } catch (err) {
    console.warn('[maker] fur color check failed', err);
    return fur;
  }
}
