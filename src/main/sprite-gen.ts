// 2D 그림 세트의 동작 띠 하나를 그림 Space 에서 받는다 (2026-10-15, #89). Electron 없이 돌아 시험에서 가짜 fetch 로 부른다.
// 자르기, 배경 지우기, 검사는 화면이 shared/sprite-strip.ts 로 한다 (받은 그림이 webp 라 캔버스로 풀어야 한다).
//
// 모델은 FLUX.2 klein 4B 하나만 쓴다: Apache-2.0 이라 상업 사용이 된다. 앱의 AI 일러스트가 먼저 쓰는 FLUX.1 Kontext dev 는
// 비상업 라이선스라 그림 세트에는 쓰지 않는다 (다른 Space 로 넘어가지 않게 spaces 를 klein 하나로 못 박는다).
// klein Space 는 입력 그림을 갤러리로 받아 기준 그림을 넣을 수 있고, 결과 크기를 정할 수 있다 (한 변 1024 까지)

import {
  linesOf,
  type Rgb,
  type SpriteRow,
  STRIP_H,
  STRIP_W,
  sheetSize,
  stripPrompt,
} from '../shared/sprite-strip.ts';
import {
  type IllustOptions,
  type IllustResult,
  type IllustSpace,
  type ImageKind,
  illustrate,
  KLEIN,
} from './hf-illust.ts';

/**
 * klein 으로 정한 크기의 띠(여러 줄 시트면 줄 수만큼 높은 그림. 한 번 호출로 받는다)를 그린다
 * (prompt, input_images, mode, seed, randomize_seed, width, height, steps, guidance, upsampling)
 */
export function stripSpace(w = STRIP_W, h = STRIP_H): IllustSpace {
  return {
    id: KLEIN.id,
    endpoint: 'infer',
    // 씨앗은 그때마다 바꾼다: 실패한 줄을 다시 만들면 다른 그림이 나와야 한다
    inputs: (image, prompt) => [
      prompt,
      [{ image, caption: null }],
      'Distilled (4 steps)',
      0,
      true,
      w,
      h,
      4,
      1.0,
      false,
    ],
  };
}

/** 띠 하나 그리는 상한. klein 은 4단계라 보통 30초 안팎, 줄이 길면 더 (여러 줄 시트는 줄마다 1분씩 더) */
export const STRIP_TIMEOUT_MS = 3 * 60_000;
export const stripTimeoutMs = (row: SpriteRow): number => STRIP_TIMEOUT_MS + (linesOf(row) - 1) * 60_000;

/**
 * 기준 그림(PNG, 배경색 위에 놓은 지금 페어리 그림)과 동작 하나로 띠 한 장을 받는다.
 * 실패는 hf-illust.ts IllustError 그대로 (quota 면 화면이 남은 동작을 멈춘다)
 */
export function drawStrip(
  reference: Uint8Array,
  row: SpriteRow,
  key: Rgb,
  opt: Omit<IllustOptions, 'spaces'>,
): Promise<IllustResult> {
  const size = sheetSize(row);
  return illustrate(reference, 'image/png', stripPrompt(row, key), {
    timeoutMs: stripTimeoutMs(row),
    ...opt,
    spaces: [stripSpace(size.w, size.h)],
  });
}

/**
 * 내 컴퓨터에서 띠 그리기의 하한 바이트 (2026-10-15). local-draw-core.ts MIN_DRAWN_BYTES(40KB)는 768x1024 쯤 그림의 값이라
 * 넓이가 1/3 인 띠(1024x256, 단색 배경)에는 너무 크다. 넓이만큼 줄인다 (거의 한 색인 판은 몇 KB 라 여전히 걸린다)
 */
export const STRIP_MIN_BYTES = Math.round((40 * 1024 * STRIP_W * STRIP_H) / (768 * 1024));
/** 여러 줄 시트는 넓이가 줄 수만큼 크니 하한도 그만큼 */
export const stripMinBytes = (row: SpriteRow): number => STRIP_MIN_BYTES * linesOf(row);

/** 내 컴퓨터에서 그리는 함수 (local-draw.ts illustrateLocal 과 같은 모양). 시험은 가짜를 넣는다 */
export type LocalStripDraw = (
  photo: Uint8Array,
  kind: 'png',
  prompt: string,
  o: {
    signal: AbortSignal;
    onProgress: (ratio: number) => void;
    log: (tag: string, ...rest: unknown[]) => void;
    size: { width: number; height: number; minBytes?: number };
  },
) => Promise<{ bytes: Uint8Array; kind: ImageKind }>;

/**
 * 같은 띠를 내 컴퓨터에서 (mflux 또는 sd.cpp 의 FLUX.2 klein 4B, 서버와 같은 모델). 요청문과 기준 그림은 서버와 같고,
 * 크기는 넣는 그림 비율 대신 1024x256 으로 정한다 (local-draw-core.ts fixedDrawSize). 실패는 LocalDrawError 그대로
 */
export function drawStripLocal(
  draw: LocalStripDraw,
  reference: Uint8Array,
  row: SpriteRow,
  key: Rgb,
  o: {
    signal: AbortSignal;
    onProgress: (ratio: number) => void;
    log: (tag: string, ...rest: unknown[]) => void;
  },
): Promise<{ bytes: Uint8Array; kind: ImageKind }> {
  return draw(reference, 'png', stripPrompt(row, key), {
    ...o,
    size: { width: sheetSize(row).w, height: sheetSize(row).h, minBytes: stripMinBytes(row) },
  });
}
