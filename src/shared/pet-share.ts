// 펫 공유 (v2): 내가 만든 펫을 .jjpet 파일 하나로 친구에게 준다. 이름, 기본 모양, 사진, 포즈 사진.
// 남이 준 파일이라 엄격하게 읽는다: 형식, 크기, 그림 머리말.
// 파일 형식 판 2 (2026-10-11, 펫 갤러리): 이름표(manifest: 이름, 종류, 만든 사람, 사용 허락, 만든 날, 앱 판)와
// 그림 묶음(images: 본 그림, 포즈, 작은 그림)으로 나눈다. 판 1 파일도 그대로 읽는다. 쓰기는 판 2 만.
// 형식 설명: docs/pet-format.md, JSON 스키마: docs/schema/jjpet-v2.schema.json
// 판 번호는 옛 앱이 못 읽는 바뀜에만 올린다. 선택 칸을 더하는 것(age, personalOnly, images.sprites)은 판 2 그대로:
// 옛 앱은 모르는 칸을 버리고 읽어서, 판을 올리면 오히려 "더 새 페어리" 라며 통째로 못 받는다

import { t } from './i18n/index.ts';
import { type AgeStage, isAgeStage } from './illustrate.ts';
import { imageSize, sizeOk } from './image-head.ts';
import {
  type PetSprites,
  SPRITE_MAX_BYTES,
  SPRITE_MAX_SIDE,
  SPRITE_NAMES,
  SPRITES_MAX_BYTES,
} from './pet-sprites.ts';
import { type Blueprint, parseBlueprint } from './pet3d/blueprint.ts';
import { cleanPetName, isPetKind, type PetKind, type PoseKind } from './settings.ts';
import { PET_FILE_EXT } from './url-scheme.ts';

export const SHARE_FORMAT = 'jjakkung-pet';
/** 쓰는 판. 읽기는 1, 2 둘 다 */
export const SHARE_VERSION = 2;
/**
 * 파일 하나 상한. 그림 네 장(본 그림, 포즈 셋, 각 8MB)과 깊이 그림, 작은 그림을 base64 로 하면 44.4MB 쯤이고,
 * 2D 그림 세트(SPRITES_MAX_BYTES 4MB, base64 로 5.4MB)를 더하면 49.8MB 쯤이라 48MB 에서 56MB 로 올렸다 (2026-10-13).
 * 그림 세트 상한을 6MB(base64 8MB)로 올린 뒤(2026-10-28)에도 52.4MB 쯤이라 56MB 안이다.
 * 옛 앱은 48MB 가 넘는 파일만 "너무 크다" 고 받지 않는다 (보통 파일은 1MB 안팎)
 */
export const SHARE_MAX_BYTES = 56 * 1024 * 1024;
export const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
/** 갤러리 작은 그림 상한 (PNG, 긴 쪽 512 아래) */
export const THUMB_MAX_BYTES = 256 * 1024;
export const THUMB_MAX_SIDE = 512;
/** 만든 사람 이름 길이 상한 (글자) */
export const AUTHOR_MAX = 40;

/**
 * 고를 수 있는 사용 허락 (SPDX 이름). 기본은 CC BY 4.0: 이름만 밝히면 누구나 쓰고 고칠 수 있다.
 * 순서는 고르기 칸 순서. docs/schema/jjpet-v2.schema.json 의 enum 과 같아야 한다 (시험이 본다)
 */
export const PET_LICENSES = ['CC-BY-4.0', 'CC-BY-SA-4.0', 'CC-BY-NC-4.0', 'CC0-1.0'] as const;
export type PetLicense = (typeof PET_LICENSES)[number];
export const DEFAULT_LICENSE: PetLicense = 'CC-BY-4.0';
export const isPetLicense = (v: unknown): v is PetLicense => PET_LICENSES.includes(v as PetLicense);
/** 사람이 읽는 이름 (말과 상관없이 같다) */
export const LICENSE_LABEL: Record<PetLicense, string> = {
  'CC-BY-4.0': 'CC BY 4.0',
  'CC-BY-SA-4.0': 'CC BY-SA 4.0',
  'CC-BY-NC-4.0': 'CC BY-NC 4.0',
  'CC0-1.0': 'CC0 1.0',
};

/** 깊이 그림 상한 (maker.ts, pet-library.ts MAX_DEPTH_BYTES 와 같다) */
const DEPTH_MAX_BYTES = 1024 * 1024;

export interface SharedPet {
  name: string;
  kind: PetKind;
  /** data URL (png, gif, webp). 없으면 기본 펫 */
  image?: string;
  poses: Partial<Record<PoseKind, string>>;
  /** AI 가 만든 입체 설계도 (6단계). 옛 앱은 이 칸을 모르고 사진으로 보인다 */
  model?: Blueprint;
  /** 2.5D 깊이 그림 (6단계, 회색 PNG data URL) */
  depth?: string;
  /** AI 일러스트 나이 단계 (아기, 청소년은 작게 보인다). 사진이 있을 때만. 옛 앱은 이 칸을 모르고 어른 크기로 보인다 */
  age?: AgeStage;
  /** 갤러리 작은 그림 (PNG data URL, 판 2) */
  thumbnail?: string;
  /** 이름표의 나머지 (판 2). 판 1 파일에는 없다 */
  meta?: PetMeta;
  /**
   * 개인 용도 페어리 (말로 만들기, 이미 있는 캐릭터 이름으로 만든 것). 이름표에 personalOnly: true 로 적고,
   * 공식 갤러리는 이 표시가 있는 파일을 받지 않는다 (gallery.ts validateSubmission). 옛 앱은 이 칸을 모르고 그냥 읽는다
   */
  personalOnly?: boolean;
  /**
   * 2D 그림 세트 (이름 -> PNG data URL, pet-sprites.ts). 본 그림이 있을 때만, 서기(idle)가 꼭 있다.
   * 있으면 2D 에서 기본 페어리처럼 자세마다 그림을 바꿔 그린다. 옛 앱은 이 칸을 모르고 본 그림과 포즈로 보인다
   */
  sprites?: PetSprites;
  /**
   * 가져오기 확인 창에 보이는 한 줄 설명 (Codex 펫 파일의 description, codex-pet.ts). 저장하지 않고 .fairy 로 내보내지도 않는다
   */
  description?: string;
}

/** 판 2 이름표에서 이름, 종류 말고 나머지 */
export interface PetMeta {
  /** 만든 사람이 보이고 싶은 이름 (선택) */
  author?: string;
  license: PetLicense;
  /** 만든 날 (ISO 8601) */
  created: string;
  /** 만든 앱 판 (semver) */
  appVersion: string;
}

/** 저장해 둔 이름표 검사 (설정 파일의 petMeta, 보관함 meta). 틀리면 undefined */
export function cleanPetMeta(v: unknown): PetMeta | undefined {
  if (typeof v !== 'object' || v === null) return undefined;
  const r = v as Record<string, unknown>;
  const created = cleanCreated(r.created);
  const appVersion = cleanAppVersion(r.appVersion);
  if (!isPetLicense(r.license) || !created || !appVersion) return undefined;
  const author = cleanAuthor(r.author);
  return { ...(author ? { author } : {}), license: r.license, created, appVersion };
}

/**
 * 다시 내보낼 때의 이름표. 가져온 펫(stored)이면 만든 사람, 허락, 만든 날, 앱 판을 그대로 넘긴다.
 * given 에 만든 사람을 다르게 적었으면(지우기 포함) 새 작품으로 본다: 지금 앱 판, 새 날. 허락은 given 이 먼저
 */
export function reexportMeta(
  stored: PetMeta | undefined,
  given: Partial<PetMeta> | undefined,
  appVersion: string,
): Partial<PetMeta> {
  const license = isPetLicense(given?.license) ? { license: given.license } : {};
  const edited = !!given && 'author' in given && cleanAuthor(given.author) !== stored?.author;
  if (!stored || edited) {
    const author = cleanAuthor(given?.author);
    return {
      appVersion,
      ...(stored ? { license: stored.license } : {}),
      ...license,
      ...(author ? { author } : {}),
    };
  }
  return { ...stored, ...license };
}

/** 판 2 로 쓴다. meta 를 안 주면 p.meta, 그것도 없으면 기본 허락과 지금 시각 */
export function encodePet(p: SharedPet, meta?: Partial<PetMeta>): string {
  const m = { ...p.meta, ...meta };
  const author = cleanAuthor(m.author);
  const manifest = {
    name: p.name,
    species: p.kind,
    ...(author ? { author } : {}),
    license: isPetLicense(m.license) ? m.license : DEFAULT_LICENSE,
    created: cleanCreated(m.created) ?? new Date().toISOString(),
    appVersion: cleanAppVersion(m.appVersion) ?? '0.0.0',
    ...(p.image && p.age ? { age: p.age } : {}),
    ...(p.personalOnly ? { personalOnly: true } : {}),
  };
  const images = {
    ...(p.image ? { main: p.image } : {}),
    poses: p.image ? p.poses : {},
    ...(p.thumbnail ? { thumbnail: p.thumbnail } : {}),
    ...(p.image && p.sprites?.idle ? { sprites: p.sprites } : {}),
  };
  return JSON.stringify({
    format: SHARE_FORMAT,
    version: SHARE_VERSION,
    manifest,
    images,
    ...(p.image && p.model ? { blueprint: p.model } : {}),
    ...(p.image && p.depth ? { depth: p.depth } : {}),
  });
}

// 글자 제어 문자(Cc)와 서식 문자(Cf: 방향 바꾸기, 폭 없는 글자, BOM)는 뺀다 (갤러리 목록에서 다른 글을 가리거나 뒤집지 않게)
const CONTROL = /[\p{Cc}\p{Cf}]/gu;

/** 만든 사람 이름: 앞뒤 빈칸, 제어 문자를 빼고 AUTHOR_MAX 글자 안. 비었거나 길면 undefined */
export function cleanAuthor(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.replace(CONTROL, '').replace(/\s+/g, ' ').trim();
  return s && [...s].length <= AUTHOR_MAX ? s : undefined;
}

/** 만든 날: ISO 8601 (날짜만 또는 UTC 시각), 2020년부터 */
export function cleanCreated(v: unknown): string | undefined {
  if (typeof v !== 'string' || v.length > 30) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?Z)?$/.test(v)) return undefined;
  const at = Date.parse(v);
  return Number.isFinite(at) && at >= Date.UTC(2020, 0, 1) ? v : undefined;
}

/** 앱 판: 1.2.3 이나 1.2.3-beta.1 */
export function cleanAppVersion(v: unknown): string | undefined {
  return typeof v === 'string' && v.length <= 32 && /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(v)
    ? v
    : undefined;
}

/** 작은 그림: PNG, 상한 안, 긴 쪽 THUMB_MAX_SIDE 아래 */
export function cleanThumbnail(v: unknown): string | undefined {
  const img = cleanImage(v);
  if (!img?.startsWith('data:image/png;')) return undefined;
  const bytes = Buffer.from(img.slice(img.indexOf(',') + 1), 'base64');
  const size = imageSize(bytes);
  return bytes.length <= THUMB_MAX_BYTES && size && Math.max(size.w, size.h) <= THUMB_MAX_SIDE
    ? img
    : undefined;
}

/** data URL 하나 검사: 형식과 실제 머리말이 맞고 크기 안 */
function cleanImage(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const m = /^data:image\/(png|gif|webp);base64,([A-Za-z0-9+/=]+)$/.exec(v);
  if (!m) return undefined;
  const bytes = Buffer.from(m[2] ?? '', 'base64');
  // 머리말(12바이트)도 안 되는 것은 그림이 아니다 (짧으면 머리말 읽기가 예외를 던졌다)
  if (bytes.length < 12 || bytes.length > IMAGE_MAX_BYTES) return undefined;
  const head = bytes.subarray(0, 12).toString('latin1');
  const ok =
    (m[1] === 'png' && bytes.readUInt32BE(0) === 0x89504e47) ||
    (m[1] === 'gif' && head.startsWith('GIF8')) ||
    (m[1] === 'webp' && head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP');
  // 머리말 크기도 본다: 2MB PNG 가 23000x23000 이면 펼칠 때 메인이 몇 초 멈추고 2GB 를 썼다
  return ok && sizeOk(bytes) ? v : undefined;
}

/** PNG 가 움직이는 그림(APNG)인지: 첫 그림 조각(IDAT) 앞에 acTL 조각이 있으면 */
export function isAnimatedPng(bytes: Uint8Array): boolean {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 8;
  while (at + 8 <= bytes.length) {
    const len = dv.getUint32(at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    if (type === 'acTL') return true;
    if (type === 'IDAT' || type === 'IEND') return false;
    at += 12 + len;
  }
  return false;
}

/**
 * 2D 그림 세트 검사. 아는 이름의 PNG 만 (SVG 는 받지 않는다: 글로 된 그림이라 밖 주소, 글꼴, 거대한 필터를 품을 수 있고
 * 머리말로 크기를 미리 잴 수 없다. 움직이는 PNG, GIF, WebP 도 받지 않는다: 한 장이 한 자세다).
 * 한 장 512KB, 한 변 1024px, 모두 서기 그림과 같은 크기. 틀린 장은 그 장만 버리고, 서기가 없거나 합이 4MB 를 넘으면 세트를 버린다
 */
export function cleanSprites(v: unknown): PetSprites | undefined {
  const raw = objOf(v);
  const out: PetSprites = {};
  let total = 0;
  let size: { w: number; h: number } | undefined;
  for (const name of SPRITE_NAMES) {
    const img = cleanImage(raw[name]);
    if (!img?.startsWith('data:image/png;')) continue;
    const bytes = Buffer.from(img.slice(img.indexOf(',') + 1), 'base64');
    const wh = imageSize(bytes);
    if (!wh || bytes.length > SPRITE_MAX_BYTES || Math.max(wh.w, wh.h) > SPRITE_MAX_SIDE) continue;
    if (isAnimatedPng(bytes)) continue;
    // 서기가 먼저 온다 (SPRITE_NAMES 순서): 서기와 크기가 다른 장은 바닥선과 가운데가 어긋나서 버린다
    size ??= name === 'idle' ? wh : undefined;
    if (!size || size.w !== wh.w || size.h !== wh.h) continue;
    total += bytes.length;
    out[name] = img;
  }
  return out.idle && total <= SPRITES_MAX_BYTES ? out : undefined;
}

/** .jjpet 글을 읽는다 (판 1, 2). 틀리면 이유를 담은 오류 */
export function decodePet(text: string): SharedPet | { error: string } {
  if (text.length > SHARE_MAX_BYTES) return { error: t('pet.share.tooBig') };
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text);
  } catch {
    return { error: t('pet.share.notPet') };
  }
  if (typeof raw !== 'object' || raw === null || raw.format !== SHARE_FORMAT)
    return { error: t('pet.share.notPet') };
  if (typeof raw.version !== 'number' || !Number.isInteger(raw.version) || raw.version < 1)
    return { error: t('pet.share.notPet') };
  if (raw.version > SHARE_VERSION) return { error: t('pet.share.newer') };
  return raw.version === 1 ? fromV1(raw) : fromV2(raw);
}

const objOf = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** 판 1, 2 가 같은 칸들 (모양만 다르다) */
interface Fields {
  name: unknown;
  kind: unknown;
  image: unknown;
  poses: unknown;
  model: unknown;
  depth: unknown;
  age: unknown;
}

function fromV1(raw: Record<string, unknown>): SharedPet | { error: string } {
  return common({
    name: raw.name,
    kind: raw.kind,
    image: raw.image,
    poses: raw.poses,
    model: raw.model,
    depth: raw.depth,
    age: raw.age,
  });
}

function fromV2(raw: Record<string, unknown>): SharedPet | { error: string } {
  const manifest = objOf(raw.manifest);
  const images = objOf(raw.images);
  // 판 2 는 이름표를 엄격하게 본다: 허락, 만든 날, 앱 판이 틀리면 받지 않는다 (갤러리에서 누가 무엇을 허락했는지가 중요하다)
  const license = manifest.license;
  const created = cleanCreated(manifest.created);
  const appVersion = cleanAppVersion(manifest.appVersion);
  if (!isPetLicense(license) || !created || !appVersion) return { error: t('pet.share.badManifest') };
  if (manifest.author !== undefined && !cleanAuthor(manifest.author))
    return { error: t('pet.share.badManifest') };
  const base = common({
    name: manifest.name,
    kind: manifest.species,
    image: images.main,
    poses: images.poses,
    model: raw.blueprint,
    depth: raw.depth,
    age: manifest.age,
  });
  if ('error' in base) return base;
  // 2D 그림 세트는 본 그림이 있을 때만 (포즈처럼). 틀리면 세트만 버리고 본 그림과 포즈로 데려온다
  const sprites = base.image && images.sprites !== undefined ? cleanSprites(images.sprites) : undefined;
  const thumbnail = images.thumbnail === undefined ? undefined : cleanThumbnail(images.thumbnail);
  if (images.thumbnail !== undefined && !thumbnail) return { error: t('pet.share.badImage') };
  const author = cleanAuthor(manifest.author);
  return {
    ...base,
    ...(thumbnail ? { thumbnail } : {}),
    ...(manifest.personalOnly === true ? { personalOnly: true } : {}),
    ...(sprites ? { sprites } : {}),
    meta: { ...(author ? { author } : {}), license, created, appVersion },
  };
}

function common(raw: Fields): SharedPet | { error: string } {
  const name = cleanPetName(raw.name);
  if (!name) return { error: t('pet.share.noName') };
  const kind: PetKind = isPetKind(raw.kind) ? raw.kind : 'kong';
  const image = raw.image === undefined ? undefined : cleanImage(raw.image);
  if (raw.image !== undefined && !image) return { error: t('pet.share.badImage') };
  const poses: SharedPet['poses'] = {};
  const rawPoses = objOf(raw.poses);
  for (const k of ['happy', 'sleepy', 'hungry'] as const) {
    const img = cleanImage(rawPoses[k]);
    if (img) poses[k] = img;
  }
  // 설계도는 사진이 있을 때만. 깨졌으면 사진으로만 데려온다
  const model = image && raw.model !== undefined ? parseBlueprint(raw.model) : undefined;
  const depthImg = image && !model ? cleanImage(raw.depth) : undefined;
  // 깊이 그림은 만들기 창 저장과 같은 상한(1MB)으로 (넘으면 펫 화면은 입체, 설정 카드는 평면으로 엇갈렸다)
  const depth =
    depthImg?.startsWith('data:image/png') && (depthImg.length * 3) / 4 <= DEPTH_MAX_BYTES
      ? depthImg
      : undefined;
  const age = image && isAgeStage(raw.age) ? raw.age : undefined;
  return {
    name,
    kind,
    ...(image ? { image } : {}),
    poses,
    ...(model ? { model } : {}),
    ...(depth ? { depth } : {}),
    ...(age ? { age } : {}),
  };
}

/** 파일 이름으로 쓸 수 있게 (공유 파일 이름 기본값) */
export function shareFileName(name: string): string {
  const safe = name.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '') || 'fairy';
  return `${safe}${PET_FILE_EXT}`;
}
