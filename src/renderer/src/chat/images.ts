import {
  IMAGE_JPEG_QUALITY,
  IMAGE_MAX_SIDE,
  IMAGE_THUMB_SIDE,
  needsJpeg,
  THUMB_JPEG_QUALITY,
} from '../../../shared/capture.ts';
import { t } from '../../../shared/i18n/index.ts';
import type { OutgoingImage } from '../../../shared/ipc.ts';

// 크기 규칙은 같이 보기와 같이 쓴다 (shared/capture.ts)

function load(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(t('chat.imageReadFailed')));
    img.src = src;
  });
}

function draw(img: HTMLImageElement, maxSide: number): HTMLCanvasElement {
  const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * k));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * k));
  canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

const base64Of = (dataUrl: string) => dataUrl.slice(dataUrl.indexOf(',') + 1);

/** 파일이나 data URL 을 보낼 그림(원본 + 작은 그림)으로 만든다. */
export async function toOutgoing(source: Blob | string): Promise<OutgoingImage> {
  const url = typeof source === 'string' ? source : URL.createObjectURL(source);
  try {
    const img = await load(url);
    const big = draw(img, IMAGE_MAX_SIDE);
    let full = big.toDataURL('image/png');
    let mediaType = 'image/png';
    if (needsJpeg(base64Of(full).length * 0.75)) {
      full = big.toDataURL('image/jpeg', IMAGE_JPEG_QUALITY / 100);
      mediaType = 'image/jpeg';
    }
    const thumb = draw(img, IMAGE_THUMB_SIDE).toDataURL('image/jpeg', THUMB_JPEG_QUALITY / 100);
    return { full: { mediaType, data: base64Of(full) }, thumb: { thumb } };
  } finally {
    if (typeof source !== 'string') URL.revokeObjectURL(url);
  }
}
