import { t } from '../../../shared/i18n/index.ts';
import type { OutgoingImage } from '../../../shared/ipc.ts';

/** AI 에 보낼 그림의 긴 변 최대값. 이보다 크면 줄인다 (글자는 읽히고 토큰은 덜 쓰는 크기). */
const MAX_SIDE = 2000;
/** 이보다 큰 PNG 는 JPEG 로 바꾼다 (claude 이미지 한 장 5MB 제한보다 여유 있게). */
const MAX_BYTES = 3_500_000;
/** 대화 기록에 남길 작은 그림. 배율 2 화면에서 220px 로 보여도 선명하도록 두 배로 만든다. */
const THUMB_SIDE = 480;

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
    const big = draw(img, MAX_SIDE);
    let full = big.toDataURL('image/png');
    let mediaType = 'image/png';
    if (full.length * 0.75 > MAX_BYTES) {
      full = big.toDataURL('image/jpeg', 0.9);
      mediaType = 'image/jpeg';
    }
    const thumb = draw(img, THUMB_SIDE).toDataURL('image/jpeg', 0.8);
    return { full: { mediaType, data: base64Of(full) }, thumb: { thumb } };
  } finally {
    if (typeof source !== 'string') URL.revokeObjectURL(url);
  }
}
