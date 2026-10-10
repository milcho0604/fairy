// 움직이는 펫 그림 (v1): gif, webp, apng 를 프레임으로 풀어 둔다. Chromium 의 ImageDecoder(WebCodecs)를 쓴다.
// 한 장짜리 그림이면 그냥 <img> 로.

/**
 * 그림 하나에 풀어 둘 프레임 비트맵 총량 (프레임 수 × 너비 × 높이 × 4).
 * 예전에는 90 프레임을 480px 로 다 풀어 그림 넷(기본 + 포즈 셋)이면 펫 화면이 130MB 에서 551MB 가 됐다 (2026-10-10 검토)
 */
export const FRAME_BUDGET = 32 * 1024 * 1024;
/** 프레임을 덜어 내도 이만큼은 남긴다 (모자라면 크기를 먼저 줄인다) */
const MIN_KEEP = 24;
/** 펫 화면은 움직이는 그림을 초당 12장까지만 그린다 (pet.ts). 그보다 촘촘한 프레임은 보이지 않아 덜어 낸다 */
const SHOWN_MS = 1000 / 12;
/** 아주 긴 그림은 앞에서 이만큼만 읽는다 (푸는 시간) */
const MAX_READ = 600;
/** 얼굴 아이콘, 집 안 그림도 이 프레임에서 자른다. 펫이 작아도 이 크기까지는 풀어 둔다 */
const MIN_SIDE = 256;

/**
 * 펫 화면에 그릴 그림의 긴 변(px). 사진은 160 기준 캔버스에서 너비 140 까지 차지하고(draw.ts drawPhoto),
 * 캔버스는 펫 크기 × 화면 배율로 그려진다. 레티나에서 크게 키워도 흐리지 않게 배율까지 넣는다
 */
export function frameSide(viewSize: number, dpr: number): number {
  return Math.max(MIN_SIDE, Math.ceil((viewSize * dpr * 140) / 160));
}

export interface FramePlan {
  /** 몇 프레임마다 하나를 남기는지 (1 이면 다) */
  step: number;
  width: number;
  height: number;
}

/**
 * 프레임 몇 장을 어떤 크기로 풀지. 보이지 않는 촘촘한 프레임을 먼저 덜고, 그래도 예산을 넘으면
 * 적어도 MIN_KEEP 장이 들어가게 크기를 줄인 다음, 남는 만큼 프레임을 고르게 덜어 낸다
 */
export function planFrames(o: {
  count: number;
  width: number;
  height: number;
  /** 첫 프레임 시간(ms). 프레임 시간은 대개 고르다 */
  frameMs: number;
  /** 원하는 긴 변(px). 원본보다 키우지는 않는다 */
  side: number;
  budget?: number;
}): FramePlan {
  const budget = o.budget ?? FRAME_BUDGET;
  const count = Math.max(1, o.count);
  const w = Math.max(1, o.width);
  const h = Math.max(1, o.height);
  let k = Math.min(1, o.side / Math.max(w, h));
  const bytes = (kk: number) => Math.max(1, Math.round(w * kk)) * Math.max(1, Math.round(h * kk)) * 4;
  let step = Math.max(1, Math.floor(SHOWN_MS / Math.max(1, o.frameMs)));
  const kept = Math.ceil(count / step);
  if (kept * bytes(k) > budget) {
    const fit = Math.floor(budget / bytes(k));
    if (fit >= Math.min(kept, MIN_KEEP)) step = Math.max(step, Math.ceil(count / fit));
    else {
      // 이 크기로는 MIN_KEEP 장도 안 들어간다: MIN_KEEP 장쯤 남기고 그만큼 들어가게 줄인다
      step = Math.max(step, Math.floor(count / Math.min(kept, MIN_KEEP)));
      const n = Math.ceil(count / step);
      k *= Math.sqrt(budget / (n * bytes(k)));
      while (k > 0.001 && n * bytes(k) > budget) k *= 0.98;
    }
  }
  return { step, width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
}

interface Frame {
  bitmap: ImageBitmap;
  /** 이 프레임을 보여 줄 시간(ms) */
  ms: number;
}

export class AnimatedImage {
  readonly width: number;
  readonly height: number;
  /** 원본보다 줄여 풀었는지 (펫을 키우거나 레티나로 옮기면 다시 풀어야 선명하다) */
  readonly reduced: boolean;
  /** 풀 때 바란 긴 변(px). 예산 때문에 이보다 작게 풀었을 수 있다 (같은 크기로 또 풀지 않게) */
  readonly asked: number;
  readonly #frames: Frame[];
  readonly #total: number;

  constructor(frames: Frame[], reduced = false, asked = 0) {
    this.#frames = frames;
    this.#total = frames.reduce((a, f) => a + f.ms, 0) || 1;
    this.width = frames[0]?.bitmap.width ?? 1;
    this.height = frames[0]?.bitmap.height ?? 1;
    this.reduced = reduced;
    this.asked = asked;
  }

  /** 프레임이 바뀌는 대략의 횟수 (초당) */
  get fps(): number {
    return Math.max(1, Math.round((1000 * this.#frames.length) / this.#total));
  }

  /** 프레임 비트맵을 돌려준다 (그림을 바꿀 때. GC 만 기다리면 그림 하나에 수십 MB 가 남았다) */
  close(): void {
    for (const f of this.#frames) f.bitmap.close();
  }

  frameAt(now: number): ImageBitmap {
    let t = now % this.#total;
    for (const f of this.#frames) {
      if (t < f.ms) return f.bitmap;
      t -= f.ms;
    }
    return (this.#frames[0] as Frame).bitmap;
  }
}

/**
 * data URL 을 펫 그림으로. 여러 프레임이면 AnimatedImage, 아니면 HTMLImageElement.
 * side 는 움직이는 그림을 풀 긴 변(px, frameSide)
 */
export async function loadPetImage(
  dataUrl: string,
  side = MIN_SIDE,
): Promise<HTMLImageElement | AnimatedImage | undefined> {
  const type = /^data:(image\/[a-z+]+)/.exec(dataUrl)?.[1] ?? '';
  if ((type === 'image/gif' || type === 'image/webp' || type === 'image/png') && 'ImageDecoder' in window) {
    try {
      const anim = await decodeFrames(dataUrl, type, side);
      if (anim) return anim;
    } catch (err) {
      // 못 풀면 한 장짜리로 보여 준다. 조용히 넘기면 움직이지 않는 이유가 안 보여 남긴다
      console.warn('[jj] 움직이는 그림을 못 풀었어', err);
    }
  }
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(undefined);
    img.src = dataUrl;
  });
}

/** 프레임 시간(µs)을 ms 로. gif 프레임 시간이 0 이거나 너무 짧으면 브라우저처럼 100ms 로 본다 */
function frameMs(duration: number | null | undefined): number {
  const ms = (duration ?? 0) / 1000;
  return ms >= 20 ? ms : 100;
}

async function decodeFrames(dataUrl: string, type: string, side: number): Promise<AnimatedImage | undefined> {
  // fetch(dataUrl) 은 펫 창 CSP(connect-src 없음)에 막힌다. base64 를 직접 푼다
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const data = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const decoder = new ImageDecoder({ data, type });
  const frames: Frame[] = [];
  try {
    await decoder.tracks.ready;
    const track = decoder.tracks.selectedTrack;
    const count = Math.min(MAX_READ, track?.frameCount ?? 1);
    if (count <= 1) return undefined;
    let plan: FramePlan | undefined;
    let reduced = false;
    try {
      for (let i = 0; i < count; ) {
        const { image } = await decoder.decode({ frameIndex: i });
        try {
          const ms = frameMs(image.duration);
          if (!plan) {
            plan = planFrames({
              count,
              width: image.displayWidth,
              height: image.displayHeight,
              frameMs: ms,
              side,
            });
            reduced = plan.width < image.displayWidth;
          }
          const bitmap = await createImageBitmap(image, {
            resizeWidth: plan.width,
            resizeHeight: plan.height,
            resizeQuality: 'high',
          });
          // 덜어 낸 프레임 시간만큼 이 프레임을 오래 보여 준다 (그림 전체 길이는 그대로)
          frames.push({ bitmap, ms: ms * Math.min(plan.step, count - i) });
        } finally {
          image.close();
        }
        i += plan.step;
      }
    } catch (err) {
      // 프레임 하나가 깨졌다. 앞에서 푼 것이 두 장 이상이면 그것만으로 움직인다
      if (frames.length >= 2) console.warn('[jj] 움직이는 그림 일부만 풀었어', err);
      else throw err;
    }
    return new AnimatedImage(frames, reduced, side);
  } catch (err) {
    for (const f of frames) f.bitmap.close();
    throw err;
  } finally {
    decoder.close();
  }
}
