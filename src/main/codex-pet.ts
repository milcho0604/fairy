// Codex 펫 파일 (.codex-pet.zip) 을 페어리로 (이슈 #88). zip 을 메모리에서 풀고(unzip.ts), pet.json 과 그림 한 장을 찾아
// 칸을 잘라 2D 그림 세트(images.sprites 와 같은 규칙: PNG, 한 장 512KB, 모두 서기와 같은 크기, 합 4MB)로 만든다.
// 그림 풀기와 칸 자르기는 부르는 쪽이 넘긴다 (앱은 숨은 창의 Chromium, codex-atlas.ts. 시험은 가짜).
// 그래서 이 파일은 electron 을 부르지 않는다.
// 남이 만든 펫일 수 있어서 늘 개인 용도(personalOnly)로 데려온다: 공식 갤러리는 받지 않는다

import {
  CODEX_ATLAS,
  CODEX_ROWS,
  CODEX_ZIP_LIMITS,
  codexSpriteCells,
  parseCodexManifest,
} from '../shared/codex-pet.ts';
import { t } from '../shared/i18n/index.ts';
import { imageKind, imageSize } from '../shared/image-head.ts';
import { cleanSprites, type SharedPet } from '../shared/pet-share.ts';
import type { PetSprites, SpriteName } from '../shared/pet-sprites.ts';
import { ZipError, zipEntries } from './unzip.ts';

/**
 * 풀어서 칸으로 자른 그림. cells[줄][칸] 은 그 칸의 PNG (192x208), 완전 투명한 칸이나 줄마다 쓰는 장 수 밖의 칸은 undefined
 */
export interface Atlas {
  width: number;
  height: number;
  cells: readonly (readonly (Buffer | undefined)[])[];
}
/** 그림 바이트(형식은 머리말로 이미 봤다)를 풀어 칸으로 자른다. 못 풀면 undefined */
export type AtlasDecoder = (bytes: Buffer, kind: 'png' | 'webp') => Promise<Atlas | undefined>;

/** 맥 Finder 가 zip 에 넣는 부스러기 (__MACOSX/, ._이름, .DS_Store) */
const junk = (name: string) =>
  name.startsWith('__MACOSX/') || name.split('/').some((p) => p.startsWith('._') || p === '.DS_Store');

/** zip 바이트를 페어리로. 틀리면 이유 글 */
export async function readCodexPet(
  bytes: Buffer,
  decode: AtlasDecoder,
): Promise<SharedPet | { error: string }> {
  let entries: ReturnType<typeof zipEntries>;
  try {
    entries = zipEntries(bytes, CODEX_ZIP_LIMITS).filter((e) => !junk(e.name));
  } catch (err) {
    return { error: zipError(err) };
  }
  // pet.json 은 맨 위나 폴더 하나 안 (Codex 는 pets/<이름>/ 폴더째 묶는다)
  const manifests = entries.filter((e) => /^(?:[^/]+\/)?pet\.json$/.test(e.name));
  const manifestEntry = manifests[0];
  if (manifests.length !== 1 || !manifestEntry) return { error: t('main.codex.noManifest') };
  const dir = manifestEntry.name.slice(0, manifestEntry.name.length - 'pet.json'.length);
  let manifest: ReturnType<typeof parseCodexManifest>;
  let sheet: Buffer | undefined;
  try {
    manifest = parseCodexManifest(manifestEntry.read().toString('utf8'));
    if (!manifest) return { error: t('main.codex.noManifest') };
    sheet = entries.find((e) => e.name === `${dir}${manifest?.sheet}`)?.read();
  } catch (err) {
    return { error: zipError(err) };
  }
  if (!sheet) return { error: t('main.codex.noSheet') };
  // 풀기 전에 머리말로 형식과 크기를 본다 (정해진 크기가 아니면 칸이 어긋난다)
  const kind = imageKind(sheet);
  const size = imageSize(sheet);
  if ((kind !== 'png' && kind !== 'webp') || size?.w !== CODEX_ATLAS.width || size.h !== CODEX_ATLAS.height)
    return { error: t('main.codex.badSheet') };
  let atlas: Atlas | undefined;
  try {
    atlas = await decode(sheet, kind);
  } catch {
    atlas = undefined;
  }
  if (!atlas || atlas.width !== CODEX_ATLAS.width || atlas.height !== CODEX_ATLAS.height)
    return { error: t('main.codex.badSheet') };
  const grid = atlas.cells;
  const filled = CODEX_ROWS.map((_, r) => Array.from({ length: CODEX_ATLAS.cols }, (_, c) => !!grid[r]?.[c]));
  const cells = codexSpriteCells(filled);
  if (!cells.idle) return { error: t('main.codex.noIdle') };
  const raw: PetSprites = {};
  for (const [name, [r, c]] of Object.entries(cells) as [SpriteName, readonly [number, number]][]) {
    const png = grid[r]?.[c];
    if (png) raw[name] = `data:image/png;base64,${png.toString('base64')}`;
  }
  // .fairy 의 그림 세트와 같은 검사를 그대로 (한 장 512KB, 서기와 같은 크기, 합 4MB)
  const sprites = cleanSprites(raw);
  if (!sprites?.idle) return { error: t('pet.share.badImage') };
  return {
    name: manifest.name,
    kind: 'kong',
    image: sprites.idle,
    poses: {},
    sprites,
    personalOnly: true,
    ...(manifest.description ? { description: manifest.description } : {}),
  };
}

function zipError(err: unknown): string {
  if (err instanceof ZipError)
    return err.kind === 'unsafe'
      ? t('main.codex.unsafe')
      : err.kind === 'tooBig'
        ? t('main.codex.tooBig')
        : t('main.codex.notZip');
  return t('main.codex.notZip');
}
