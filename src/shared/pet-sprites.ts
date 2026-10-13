// 가져온 페어리의 2D 그림 세트 (2026-10-13 사용자 요청: 가져온 펫도 기본 페어리처럼 자세 그림을 다 쓴다).
// .fairy 판 2 의 images.sprites (이름 -> PNG data URL) 로 오고, pets/ 안 sprite-*.png 로 저장한다.
// 이름은 기본 페어리 손그림(renderer/src/cute2d.ts CUTE_POSES)과 같다. 화면은 이 그림들을 기본 페어리 길(draw.ts drawCute)로 그린다.
// 여기는 이름 목록, 상한, 저장 파일 이름 검사, 빠진 자세 채우기만 둔다 (화면과 메인이 같이 쓴다. Buffer 를 쓰지 않는다)

/** 받을 수 있는 그림 이름 (cute2d.ts CUTE_POSES 와 같은 순서, 시험이 본다) */
export const SPRITE_NAMES = [
  'idle',
  'blink',
  'look-l',
  'look-r',
  'sit',
  'sleep',
  'happy',
  'hungry',
  'grab',
  'sulky',
  'doze',
  'wave',
  'yawn',
  'talk-0',
  'talk-1',
  'back',
  'walk-0',
  'walk-1',
  'walk-2',
  'walk-3',
  'walk-4',
  'walk-5',
] as const;
export type SpriteName = (typeof SPRITE_NAMES)[number];
export const isSpriteName = (v: unknown): v is SpriteName => SPRITE_NAMES.includes(v as SpriteName);
/** 이름마다 그림 하나 (data URL 이나 pets/ 파일 이름) */
export type PetSprites = Partial<Record<SpriteName, string>>;

/** 그림 한 장 상한 (풀기 전 바이트). 512x512 손그림 PNG 는 20~60KB 라 넉넉하다 */
export const SPRITE_MAX_BYTES = 512 * 1024;
/** 그림 한 장 한 변 상한 (px). 펫 캔버스는 160 이라 이보다 크면 줄이기만 한다 */
export const SPRITE_MAX_SIDE = 1024;
/** 그림 세트 전체 상한 (풀기 전 바이트 합). 넘으면 세트를 통째로 버린다 */
export const SPRITES_MAX_BYTES = 4 * 1024 * 1024;

/** pets/ 안 그림 세트 파일 이름 (경로를 넣어 다른 폴더를 가리키지 못하게) */
export const SPRITE_FILE = /^sprite-[\w-]+\.png$/;

/** 저장해 둔 세트 검사 (설정 파일): 아는 이름, 규칙에 맞는 파일 이름만. 서기(idle)가 없으면 세트가 아니다 */
export function cleanSpriteFiles(v: unknown): PetSprites | undefined {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return undefined;
  const out: PetSprites = {};
  for (const name of SPRITE_NAMES) {
    const f = (v as Record<string, unknown>)[name];
    if (typeof f === 'string' && SPRITE_FILE.test(f)) out[name] = f;
  }
  return out.idle ? out : undefined;
}

/** 세트에 든 파일 이름들 (지우기, 쓰는 중인지 보기) */
export function spriteFiles(s: PetSprites | undefined): string[] {
  return s ? Object.values(s).filter((f): f is string => !!f) : [];
}

/** 빠진 자세를 채울 순서 (앞에서부터 있는 것). 끝은 늘 서기 */
const FALLBACK: Partial<Record<SpriteName, readonly SpriteName[]>> = {
  sleep: ['doze', 'sit'],
  doze: ['sleep', 'sit'],
  grab: ['happy'],
  sulky: ['back'],
  back: ['sulky'],
  wave: ['happy'],
  'talk-1': ['talk-0'],
};

/**
 * 빠진 자세를 가까운 그림으로 채운 온전한 세트. 서기가 없으면 undefined (세트로 쓰지 않는다).
 * 걷기는 walk-0 부터 이어진 장 수로 한 주기를 돈다 (네 장만 있으면 walk-4 는 walk-0, walk-5 는 walk-1). 걷기가 없으면 서기
 */
export function fillSprites<T>(have: Partial<Record<SpriteName, T>>): Record<SpriteName, T> | undefined {
  const idle = have.idle;
  if (idle === undefined) return undefined;
  let walks = 0;
  while (walks < 6 && have[`walk-${walks}` as SpriteName] !== undefined) walks++;
  const out = {} as Record<SpriteName, T>;
  for (const name of SPRITE_NAMES) {
    const own = have[name];
    if (own !== undefined) {
      out[name] = own;
      continue;
    }
    if (name.startsWith('walk-')) {
      const i = Number(name.slice(5));
      out[name] = walks > 0 ? (have[`walk-${i % walks}` as SpriteName] ?? idle) : idle;
      continue;
    }
    const near = (FALLBACK[name] ?? []).map((n) => have[n]).find((x) => x !== undefined);
    out[name] = near ?? idle;
  }
  return out;
}
