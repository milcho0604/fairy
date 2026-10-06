// 움직이는 펫 그림 (v1): gif, webp, apng 를 프레임으로 풀어 둔다. Chromium 의 ImageDecoder(WebCodecs)를 쓴다.
// 한 장짜리 그림이면 그냥 <img> 로.

/** 메모리를 지키려고 프레임 수와 크기를 줄인다 (펫은 화면에서 최대 300% 크기 = 480px) */
const MAX_FRAMES = 90;
const MAX_SIDE = 480;

interface Frame {
  bitmap: ImageBitmap;
  /** 이 프레임을 보여 줄 시간(ms) */
  ms: number;
}

export class AnimatedImage {
  readonly width: number;
  readonly height: number;
  readonly #frames: Frame[];
  readonly #total: number;

  constructor(frames: Frame[]) {
    this.#frames = frames;
    this.#total = frames.reduce((a, f) => a + f.ms, 0) || 1;
    this.width = frames[0]?.bitmap.width ?? 1;
    this.height = frames[0]?.bitmap.height ?? 1;
  }

  /** 프레임이 바뀌는 대략의 횟수 (초당) */
  get fps(): number {
    return Math.max(1, Math.round((1000 * this.#frames.length) / this.#total));
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

/** data URL 을 펫 그림으로. 여러 프레임이면 AnimatedImage, 아니면 HTMLImageElement */
export async function loadPetImage(dataUrl: string): Promise<HTMLImageElement | AnimatedImage | undefined> {
  const type = /^data:(image\/[a-z+]+)/.exec(dataUrl)?.[1] ?? '';
  if ((type === 'image/gif' || type === 'image/webp' || type === 'image/png') && 'ImageDecoder' in window) {
    try {
      const anim = await decodeFrames(dataUrl, type);
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

async function decodeFrames(dataUrl: string, type: string): Promise<AnimatedImage | undefined> {
  // fetch(dataUrl) 은 펫 창 CSP(connect-src 없음)에 막힌다. base64 를 직접 푼다
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const data = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const decoder = new ImageDecoder({ data, type });
  await decoder.tracks.ready;
  const track = decoder.tracks.selectedTrack;
  const count = Math.min(MAX_FRAMES, track?.frameCount ?? 1);
  if (count <= 1) {
    decoder.close();
    return undefined;
  }
  const frames: Frame[] = [];
  for (let i = 0; i < count; i++) {
    const { image } = await decoder.decode({ frameIndex: i });
    const k = Math.min(1, MAX_SIDE / Math.max(image.displayWidth, image.displayHeight));
    const bitmap = await createImageBitmap(image, {
      resizeWidth: Math.round(image.displayWidth * k),
      resizeHeight: Math.round(image.displayHeight * k),
      resizeQuality: 'high',
    });
    // gif 프레임 시간이 0 이거나 너무 짧으면 브라우저처럼 100ms 로 본다
    const ms = (image.duration ?? 0) / 1000;
    frames.push({ bitmap, ms: ms >= 20 ? ms : 100 });
    image.close();
  }
  decoder.close();
  return new AnimatedImage(frames);
}
