// 가져온 페어리의 2D 그림 세트 (2026-10-13 사용자 요청: 가져온 펫도 기본 페어리처럼 자세 그림을 다 쓴다).
// .fairy 판 2 의 images.sprites (이름 -> PNG data URL) 로 오고, pets/ 안 sprite-*.png 로 저장한다.
// 이름은 기본 페어리 손그림(renderer/src/cute2d.ts CUTE_POSES)과 같고, 그 뒤에 그림 세트만 갖는 추가 자세(걷기 일곱째, 여덟째 장,
// 위, 아래, 위 대각선 시선)가 붙는다. 화면은 이 그림들을 기본 페어리 길(draw.ts drawCute)로 그린다.
// 여기는 이름 목록, 상한, 저장 파일 이름 검사, 빠진 자세 채우기만 둔다 (화면과 메인이 같이 쓴다. Buffer 를 쓰지 않는다)

/** 기본 페어리 손그림 자세 이름 (cute2d.ts CUTE_POSES 와 같은 순서, 시험이 본다) */
export const SPRITE_BASE_NAMES = [
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
/**
 * 그림 세트만 갖는 추가 자세 (2026-10-28): 걷기 7, 8번째 장(여덟 장 한 주기)과 시선 위, 아래, 위쪽 대각선.
 * 기본 손그림에는 없어 없는 세트는 가까운 그림으로 채운다 (fillSprites). 옛 앱은 모르는 이름이라 건너뛰고 나머지는 그대로 읽는다
 */
export const SPRITE_EXTRA_NAMES = ['walk-6', 'walk-7', 'look-u', 'look-d', 'look-ul', 'look-ur'] as const;
/** 받을 수 있는 그림 이름 전부 (기본 자세 뒤에 추가 자세) */
export const SPRITE_NAMES = [...SPRITE_BASE_NAMES, ...SPRITE_EXTRA_NAMES] as const;
/** 걷기 한 주기 그림 수 상한 */
export const SPRITE_MAX_WALKS = 8;
export type SpriteName = (typeof SPRITE_NAMES)[number];
export const isSpriteName = (v: unknown): v is SpriteName => SPRITE_NAMES.includes(v as SpriteName);
/** 이름마다 그림 하나 (data URL 이나 pets/ 파일 이름) */
export type PetSprites = Partial<Record<SpriteName, string>>;

/** 그림 한 장 상한 (풀기 전 바이트). 512x512 손그림 PNG 는 20~60KB 라 넉넉하다 */
export const SPRITE_MAX_BYTES = 512 * 1024;
/** 그림 한 장 한 변 상한 (px). 펫 캔버스는 160 이라 이보다 크면 줄이기만 한다 */
export const SPRITE_MAX_SIDE = 1024;
/**
 * 그림 세트 전체 상한 (풀기 전 바이트 합). 넘으면 세트를 통째로 버린다. 2026-10-28 에 4MB 에서 6MB 로: 자세가 20장에서 28장으로
 * 늘었고 털이 있는 그림의 320px PNG 는 장당 150~200KB 라 4MB 는 빠듯했다(28장 x 150KB = 4.2MB). 6MB 면 장당 평균 214KB 까지 된다.
 * 파일 하나 상한 SHARE_MAX_BYTES(56MB)는 49.8MB 쯤에서 base64 로 8MB 가 되어 52.4MB 쯤이라 그대로 맞고, 갤러리 상한(16MB)과
 * 서버에는 그림 세트가 가지 않는다(서버 코드에 sprites 없음). 한 장 512KB 상한은 그대로
 */
export const SPRITES_MAX_BYTES = 6 * 1024 * 1024;

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
  // 시선: 대각선은 같은 쪽 옆 시선, 그것도 없으면 위 시선. 위, 아래는 없으면 서기 (가장 가까운 눈 그림이 서기뿐)
  'look-ul': ['look-l', 'look-u'],
  'look-ur': ['look-r', 'look-u'],
};

/**
 * 빠진 자세를 가까운 그림으로 채운 온전한 세트. 서기가 없으면 undefined (세트로 쓰지 않는다).
 * 걷기는 walk-0 부터 이어진 장 수로 한 주기를 돈다 (네 장만 있으면 walk-4 는 walk-0, walk-5 는 walk-1). 걷기가 없으면 서기
 */
export function fillSprites<T>(have: Partial<Record<SpriteName, T>>): Record<SpriteName, T> | undefined {
  const idle = have.idle;
  if (idle === undefined) return undefined;
  let walks = 0;
  while (walks < SPRITE_MAX_WALKS && have[`walk-${walks}` as SpriteName] !== undefined) walks++;
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

/** 그림 세트가 가진 걷기 한 주기 장 수 (walk-0 부터 이어진 장, 없으면 0) */
export function walkCount(have: Partial<Record<SpriteName, unknown>>): number {
  let n = 0;
  while (n < SPRITE_MAX_WALKS && have[`walk-${n}` as SpriteName] !== undefined) n++;
  return n;
}
