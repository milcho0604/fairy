// 손그림 2D 냥이, 곰돌이 그림 불러오기 (cute2d.ts). 그림 자리는 빌드가 알도록 하나씩 적는다 (new URL 은 글자 그대로여야
// 빌드가 파일을 같이 낸다). 시험(node)에서는 Image 가 없어 불러오지 않는다: 그때 draw.ts 는 예전 코드 그림을 그린다

import { CUTE_POSES, type CuteKind, type CutePose } from './cute2d.ts';

const URLS: Record<CuteKind, Record<CutePose, string>> = {
  cat: {
    idle: new URL('./art/cute2d/cat/idle.svg', import.meta.url).href,
    sit: new URL('./art/cute2d/cat/sit.svg', import.meta.url).href,
    sleep: new URL('./art/cute2d/cat/sleep.svg', import.meta.url).href,
    happy: new URL('./art/cute2d/cat/happy.svg', import.meta.url).href,
    hungry: new URL('./art/cute2d/cat/hungry.svg', import.meta.url).href,
    grab: new URL('./art/cute2d/cat/grab.svg', import.meta.url).href,
    sulky: new URL('./art/cute2d/cat/sulky.svg', import.meta.url).href,
    doze: new URL('./art/cute2d/cat/doze.svg', import.meta.url).href,
    wave: new URL('./art/cute2d/cat/wave.svg', import.meta.url).href,
    yawn: new URL('./art/cute2d/cat/yawn.svg', import.meta.url).href,
    'talk-0': new URL('./art/cute2d/cat/talk-0.svg', import.meta.url).href,
    'talk-1': new URL('./art/cute2d/cat/talk-1.svg', import.meta.url).href,
    back: new URL('./art/cute2d/cat/back.svg', import.meta.url).href,
    'walk-0': new URL('./art/cute2d/cat/walk-0.svg', import.meta.url).href,
    'walk-1': new URL('./art/cute2d/cat/walk-1.svg', import.meta.url).href,
    'walk-2': new URL('./art/cute2d/cat/walk-2.svg', import.meta.url).href,
    'walk-3': new URL('./art/cute2d/cat/walk-3.svg', import.meta.url).href,
    'walk-4': new URL('./art/cute2d/cat/walk-4.svg', import.meta.url).href,
    'walk-5': new URL('./art/cute2d/cat/walk-5.svg', import.meta.url).href,
  },
  bear: {
    idle: new URL('./art/cute2d/bear/idle.svg', import.meta.url).href,
    sit: new URL('./art/cute2d/bear/sit.svg', import.meta.url).href,
    sleep: new URL('./art/cute2d/bear/sleep.svg', import.meta.url).href,
    happy: new URL('./art/cute2d/bear/happy.svg', import.meta.url).href,
    hungry: new URL('./art/cute2d/bear/hungry.svg', import.meta.url).href,
    grab: new URL('./art/cute2d/bear/grab.svg', import.meta.url).href,
    sulky: new URL('./art/cute2d/bear/sulky.svg', import.meta.url).href,
    doze: new URL('./art/cute2d/bear/doze.svg', import.meta.url).href,
    wave: new URL('./art/cute2d/bear/wave.svg', import.meta.url).href,
    yawn: new URL('./art/cute2d/bear/yawn.svg', import.meta.url).href,
    'talk-0': new URL('./art/cute2d/bear/talk-0.svg', import.meta.url).href,
    'talk-1': new URL('./art/cute2d/bear/talk-1.svg', import.meta.url).href,
    back: new URL('./art/cute2d/bear/back.svg', import.meta.url).href,
    'walk-0': new URL('./art/cute2d/bear/walk-0.svg', import.meta.url).href,
    'walk-1': new URL('./art/cute2d/bear/walk-1.svg', import.meta.url).href,
    'walk-2': new URL('./art/cute2d/bear/walk-2.svg', import.meta.url).href,
    'walk-3': new URL('./art/cute2d/bear/walk-3.svg', import.meta.url).href,
    'walk-4': new URL('./art/cute2d/bear/walk-4.svg', import.meta.url).href,
    'walk-5': new URL('./art/cute2d/bear/walk-5.svg', import.meta.url).href,
  },
};

type Art = Record<CutePose, HTMLImageElement>;
const art: Partial<Record<CuteKind, Art>> = {};
const loading: Partial<Record<CuteKind, Promise<boolean>>> = {};
const waiters = new Set<() => void>();

/** 다 풀린 그림 묶음 (한 장이라도 안 풀렸으면 undefined) */
export function cuteArt(kind: CuteKind): Art | undefined {
  return art[kind];
}

/** 그림 묶음을 불러온다. 다 풀리면 true (못 풀면 false: 예전 코드 그림으로 그린다) */
export function loadCuteArt(kind: CuteKind): Promise<boolean> {
  if (art[kind]) return Promise.resolve(true);
  if (typeof Image === 'undefined') return Promise.resolve(false);
  loading[kind] ??= Promise.all(
    CUTE_POSES.map(async (p) => {
      const img = new Image();
      img.src = URLS[kind][p];
      await img.decode();
      return [p, img] as const;
    }),
  ).then(
    (all) => {
      art[kind] = Object.fromEntries(all) as Art;
      for (const f of waiters) f();
      return true;
    },
    () => false,
  );
  return loading[kind];
}

/** 그림이 풀릴 때마다 부른다 (펫 화면이 다시 그린다). 끊는 함수를 돌려준다 */
export function onCuteArt(f: () => void): () => void {
  waiters.add(f);
  return () => waiters.delete(f);
}
