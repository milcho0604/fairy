// 그림 파일 머리말 읽기 (메인, 공유 둘 다). 그림을 풀지 않고 종류와 가로세로만 본다:
// 큰 그림(23000x23000 PNG 는 2MB 로도 풀면 2GB)을 풀기 전에 거르려고

export type ImageKind = 'png' | 'webp' | 'jpeg';

/** 머리말로 그림 형식을 본다 */
export function imageKind(b: Uint8Array): ImageKind | undefined {
  if (b.length > 12 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  const s = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  if (b.length > 12 && s(0, 4) === 'RIFF' && s(8, 12) === 'WEBP') return 'webp';
  return undefined;
}

/** 그림 머리말에서 가로세로를 읽는다 (PNG, JPEG, WebP, GIF). 모르면 undefined */
export function imageSize(b: Uint8Array): { w: number; h: number } | undefined {
  const u16 = (i: number) => ((b[i] ?? 0) << 8) | (b[i + 1] ?? 0);
  const le16 = (i: number) => (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8);
  const le24 = (i: number) => le16(i) | ((b[i + 2] ?? 0) << 16);
  const kind = imageKind(b);
  if (kind === 'png' && b.length >= 24) {
    const u32 = (i: number) => (b[i] ?? 0) * 2 ** 24 + ((b[i + 1] ?? 0) << 16) + u16(i + 2);
    return { w: u32(16), h: u32(20) };
  }
  if (kind === 'webp' && b.length >= 30) {
    const chunk = String.fromCharCode(...b.subarray(12, 16));
    if (chunk === 'VP8X') return { w: le24(24) + 1, h: le24(27) + 1 };
    if (chunk === 'VP8 ') return { w: le16(26) & 0x3fff, h: le16(28) & 0x3fff };
    if (chunk === 'VP8L') {
      const v = (b[21] ?? 0) | ((b[22] ?? 0) << 8) | ((b[23] ?? 0) << 16) | ((b[24] ?? 0) << 24);
      return { w: (v & 0x3fff) + 1, h: ((v >>> 14) & 0x3fff) + 1 };
    }
    return undefined;
  }
  if (b.length >= 10 && String.fromCharCode(...b.subarray(0, 4)) === 'GIF8')
    return { w: le16(6), h: le16(8) };
  if (kind === 'jpeg') {
    // SOF 표시(C0~CF, C4 C8 CC 빼고)를 찾아 그 안의 높이, 너비
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return undefined;
      const m = b[i + 1] ?? 0;
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc)
        return { w: u16(i + 7), h: u16(i + 5) };
      i += 2 + u16(i + 2);
    }
  }
  return undefined;
}

/** 풀어도 되는 그림 크기 (가로세로 각각, 넓이) */
export const MAX_IMAGE_SIDE = 4096;
export const MAX_IMAGE_PIXELS = 16_000_000;

/** 머리말로 본 크기가 상한 안인지. 크기를 모르면 false */
export function sizeOk(b: Uint8Array, side = MAX_IMAGE_SIDE, pixels = MAX_IMAGE_PIXELS): boolean {
  const s = imageSize(b);
  return !!s && s.w > 0 && s.h > 0 && s.w <= side && s.h <= side && s.w * s.h <= pixels;
}
