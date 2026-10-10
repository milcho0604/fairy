// 같이 보기: 화면 위 드래그를 캡처할 영역으로 바꾼다. 좌표는 모니터 왼쪽 위 기준 DIP.
import type { Point, Rect } from './geometry.ts';

/** 이보다 작게 끌면 클릭으로 보고 모니터 전체를 찍는다. */
export const MIN_DRAG = 8;

/** 시작점과 끝점으로 사각형. 거꾸로 끌어도 된다. 모니터 밖으로 끌면 모니터 안으로 자른다. */
export function dragRect(a: Point, b: Point, size: { width: number; height: number }): Rect {
  const clampX = (v: number) => Math.min(Math.max(v, 0), size.width);
  const clampY = (v: number) => Math.min(Math.max(v, 0), size.height);
  const x1 = clampX(Math.min(a.x, b.x));
  const y1 = clampY(Math.min(a.y, b.y));
  const x2 = clampX(Math.max(a.x, b.x));
  const y2 = clampY(Math.max(a.y, b.y));
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

export function isClick(r: Rect): boolean {
  return r.width < MIN_DRAG || r.height < MIN_DRAG;
}

/**
 * DIP 사각형을 캡처 그림의 픽셀 사각형으로. 캡처 그림 크기는 모니터 배율과 다를 수 있어서
 * (여러 모니터를 한 번에 찍으면 같은 크기 상자에 맞춰 늘거나 준다) 비율로 계산한다.
 */
export function toPixels(
  r: Rect,
  display: { width: number; height: number },
  image: { width: number; height: number },
): Rect {
  const kx = image.width / display.width;
  const ky = image.height / display.height;
  const x = Math.max(0, Math.floor(r.x * kx));
  const y = Math.max(0, Math.floor(r.y * ky));
  return {
    x,
    y,
    width: Math.min(image.width - x, Math.ceil(r.width * kx)),
    height: Math.min(image.height - y, Math.ceil(r.height * ky)),
  };
}

/** 긴 변이 max 를 넘으면 줄일 크기. 넘지 않으면 undefined. */
export function fitWithin(size: { width: number; height: number }, max: number) {
  const k = max / Math.max(size.width, size.height);
  if (k >= 1) return undefined;
  return { width: Math.max(1, Math.round(size.width * k)), height: Math.max(1, Math.round(size.height * k)) };
}

// ---- AI 에 보낼 그림 규칙: 채팅 붙이기(images.ts)와 같이 보기(look-together.ts)가 같이 쓴다 ----

/** 긴 변 최대값. 이보다 크면 줄인다 (글자는 읽히고 토큰은 덜 쓰는 크기) */
export const IMAGE_MAX_SIDE = 2000;
/** 이보다 큰 PNG 는 JPEG 로 바꾼다 (claude 이미지 한 장 5MB 제한보다 여유 있게) */
export const IMAGE_MAX_BYTES = 3_500_000;
/** 대화 기록에 남길 작은 그림. 배율 2 화면에서 220px 로 보여도 선명하도록 두 배로 만든다 */
export const IMAGE_THUMB_SIDE = 480;
/** JPEG 로 바꿀 때 품질 (0~100) */
export const IMAGE_JPEG_QUALITY = 90;
export const THUMB_JPEG_QUALITY = 80;

/** PNG 바이트 수로 JPEG 로 바꿔야 하는지 */
export const needsJpeg = (pngBytes: number) => pngBytes > IMAGE_MAX_BYTES;

/** 채팅에 한 번에 붙일 수 있는 그림 수 (채팅 창과 같다) */
export const SEND_IMAGES_MAX = 4;
const SEND_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

/**
 * codex 에 넘기려고 임시 폴더에 잠깐 쓰는 그림 파일 이름 (main/ai/runner.ts). 끝나면 지우지만 앱이 죽으면 남는다.
 * 다음 실행이 이 이름만 골라 지운다 (화면 캡처를 디스크에 남기지 않는다, P3-07)
 */
export const aiTempImageName = (uuid: string, mediaType: string): string =>
  `jjakkung-${uuid}.${mediaType.split('/')[1]?.replace('jpeg', 'jpg') ?? 'png'}`;
export const isAiTempImage = (name: string): boolean =>
  /^jjakkung-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|gif|webp)$/.test(name);
/** base64 글자 수 상한 (약 9MB 그림). 화면은 3.5MB 를 넘으면 JPEG 로 줄여 보낸다 */
const SEND_DATA_MAX = 12_000_000;
const THUMB_DATA_MAX = 2_000_000;

/**
 * 채팅 창이 보낸 그림을 메인이 다시 본다. 형식은 허용 목록만(임시 파일 확장자로 쓰인다), 크기와 개수에 상한.
 * 하나라도 이상하면 빈 목록 대신 undefined (보내지 않는다).
 */
export function cleanSendImages(
  v: unknown,
): { full: { mediaType: string; data: string }; thumb: { thumb: string } }[] | undefined {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > SEND_IMAGES_MAX) return undefined;
  const out = [];
  for (const i of v) {
    const full = (i as { full?: { mediaType?: unknown; data?: unknown } } | null)?.full;
    const thumb = (i as { thumb?: { thumb?: unknown } } | null)?.thumb?.thumb;
    if (typeof full?.mediaType !== 'string' || !SEND_TYPES.has(full.mediaType)) return undefined;
    if (
      typeof full.data !== 'string' ||
      full.data.length > SEND_DATA_MAX ||
      !/^[A-Za-z0-9+/=]*$/.test(full.data)
    )
      return undefined;
    if (typeof thumb !== 'string' || thumb.length > THUMB_DATA_MAX || !thumb.startsWith('data:image/'))
      return undefined;
    out.push({ full: { mediaType: full.mediaType, data: full.data }, thumb: { thumb } });
  }
  return out;
}
