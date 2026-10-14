// 2D 그림 세트의 동작 띠 하나를 그림 Space 에서 받는다 (2026-10-15, #89). Electron 없이 돌아 시험에서 가짜 fetch 로 부른다.
// 자르기, 배경 지우기, 검사는 화면이 shared/sprite-strip.ts 로 한다 (받은 그림이 webp 라 캔버스로 풀어야 한다).
//
// 모델은 FLUX.2 klein 4B 하나만 쓴다: Apache-2.0 이라 상업 사용이 된다. 앱의 AI 일러스트가 먼저 쓰는 FLUX.1 Kontext dev 는
// 비상업 라이선스라 그림 세트에는 쓰지 않는다 (다른 Space 로 넘어가지 않게 spaces 를 klein 하나로 못 박는다).
// klein Space 는 입력 그림을 갤러리로 받아 기준 그림을 넣을 수 있고, 결과 크기를 정할 수 있다 (한 변 1024 까지)

import { type Rgb, type SpriteRow, STRIP_H, STRIP_W, stripPrompt } from '../shared/sprite-strip.ts';
import { type IllustOptions, type IllustResult, type IllustSpace, illustrate, KLEIN } from './hf-illust.ts';

/** klein 으로 정한 크기의 띠를 그린다 (prompt, input_images, mode, seed, randomize_seed, width, height, steps, guidance, upsampling) */
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

/** 띠 하나 그리는 상한. klein 은 4단계라 보통 30초 안팎, 줄이 길면 더 */
export const STRIP_TIMEOUT_MS = 3 * 60_000;

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
  return illustrate(reference, 'image/png', stripPrompt(row, key), {
    timeoutMs: STRIP_TIMEOUT_MS,
    ...opt,
    spaces: [stripSpace()],
  });
}
