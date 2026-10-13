// 손그림 2D 기본 펫 그림 불러오기 (cute2d.ts). 그림 자리는 빌드가 art/cute2d/<모양>/<자세>.svg 를 모아 준다
// (import.meta.glob: 새 모양 폴더를 두면 따로 적지 않아도 같이 나간다). 시험(node)에는 import.meta.glob 도 Image 도 없어
// 불러오지 않는다: 그때 draw.ts 는 예전 코드 그림을 그린다

import { CUTE_POSES, type CuteKind, type CutePose } from './cute2d.ts';

declare global {
  interface ImportMeta {
    glob(pattern: string, o: { eager: true; query: '?url'; import: 'default' }): Record<string, string>;
  }
}

/** 빌드가 넣어 준 그림 주소 (열쇠는 ./art/cute2d/<모양>/<자세>.svg). node 에서는 빈 것 */
function artFiles(): Record<string, string> {
  try {
    return import.meta.glob('./art/cute2d/*/*.svg', { eager: true, query: '?url', import: 'default' });
  } catch {
    return {};
  }
}
const FILES = artFiles();
const urlOf = (kind: CuteKind, pose: CutePose): string | undefined =>
  FILES[`./art/cute2d/${kind}/${pose}.svg`];

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
  // 한 장이라도 빠진 모양은 쓰지 않는다 (예전 코드 그림)
  if (typeof Image === 'undefined' || CUTE_POSES.some((p) => !urlOf(kind, p))) return Promise.resolve(false);
  loading[kind] ??= Promise.all(
    CUTE_POSES.map(async (p) => {
      const img = new Image();
      img.src = urlOf(kind, p) ?? '';
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
