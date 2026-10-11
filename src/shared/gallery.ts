// 펫 갤러리 (P1 #11): 서버 없이 GitHub 레포의 gallery/ 폴더가 갤러리다.
// gallery/pets/<id>.jjpet 을 PR 로 올리면 scripts/gallery-index.mjs 가 index.json 과 작은 그림(thumbs/)을 만든다.
// 앱은 raw.githubusercontent.com 에서 index.json 을 받아 보여 주고, 고른 펫을 sha256 으로 확인해 받은 뒤
// 원래 있던 .jjpet 가져오기(엄격한 검사)로 데려온다. 여기는 electron, node 없이 도는 모양 검사만 둔다.
// 형식 설명: docs/pet-format.md, gallery/CONTRIBUTING.md

import {
  cleanAuthor,
  cleanThumbnail,
  decodePet,
  isPetLicense,
  type PetLicense,
  SHARE_FORMAT,
  SHARE_VERSION,
  type SharedPet,
} from './pet-share.ts';
import { cleanPetName, isPetKind, type PetKind } from './settings.ts';
import { RELEASE_REPO } from './update-policy.ts';

export const GALLERY_HOST = 'raw.githubusercontent.com';
/** 갤러리 폴더 주소 (끝에 / ). 다른 곳은 받지 않는다 */
export const GALLERY_BASE = `https://${GALLERY_HOST}/${RELEASE_REPO.owner}/${RELEASE_REPO.repo}/main/gallery/`;
/** 올리는 방법 안내 (갤러리에 올리기 단추가 연다) */
export const GALLERY_DOCS_URL = `https://github.com/${RELEASE_REPO.owner}/${RELEASE_REPO.repo}/blob/main/gallery/CONTRIBUTING.md`;
export const INDEX_FORMAT = 'jjakkung-gallery';
export const INDEX_VERSION = 1;
/** index.json 상한 */
export const INDEX_MAX_BYTES = 256 * 1024;
/** 목록에 보일 펫 수 상한 */
export const GALLERY_MAX_PETS = 300;
/** 갤러리 펫 파일 하나 상한 (공유 파일 상한 48MB 보다 작게: 받는 사람 데이터를 아낀다) */
export const GALLERY_PET_MAX_BYTES = 16 * 1024 * 1024;
/** 기다리는 시간 (목록, 작은 그림 / 펫 파일) */
export const INDEX_TIMEOUT_MS = 15_000;
export const PET_TIMEOUT_MS = 60_000;

export interface GalleryEntry {
  /** 파일 이름 (pets/<id>.jjpet, thumbs/<id>.png) */
  id: string;
  name: string;
  species: PetKind;
  author: string;
  license: PetLicense;
  created: string;
  appVersion: string;
  /** gallery/ 안 경로 */
  file: string;
  size: number;
  sha256: string;
  thumbnail: string;
  thumbSha256: string;
}

export interface GalleryIndex {
  format: typeof INDEX_FORMAT;
  version: typeof INDEX_VERSION;
  pets: GalleryEntry[];
}

const ID_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const SHA_RE = /^[0-9a-f]{64}$/;
export const isGalleryId = (v: unknown): v is string => typeof v === 'string' && ID_RE.test(v);

/** 항목 하나 검사. 틀리면 undefined (경로는 id 로만 정해진다: ../ 같은 것이 끼지 못하게) */
export function parseGalleryEntry(v: unknown): GalleryEntry | undefined {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return undefined;
  const r = v as Record<string, unknown>;
  const id = r.id;
  if (!isGalleryId(id)) return undefined;
  const name = cleanPetName(r.name);
  const author = cleanAuthor(r.author);
  if (!name || name !== r.name || !author || author !== r.author) return undefined;
  if (!isPetKind(r.species) || !isPetLicense(r.license)) return undefined;
  if (typeof r.created !== 'string' || r.created.length > 30) return undefined;
  if (typeof r.appVersion !== 'string' || r.appVersion.length > 32) return undefined;
  if (r.file !== `pets/${id}.jjpet` || r.thumbnail !== `thumbs/${id}.png`) return undefined;
  const size = r.size;
  if (typeof size !== 'number' || !Number.isInteger(size) || size <= 0 || size > GALLERY_PET_MAX_BYTES)
    return undefined;
  if (typeof r.sha256 !== 'string' || !SHA_RE.test(r.sha256)) return undefined;
  if (typeof r.thumbSha256 !== 'string' || !SHA_RE.test(r.thumbSha256)) return undefined;
  return {
    id,
    name,
    species: r.species,
    author,
    license: r.license,
    created: r.created,
    appVersion: r.appVersion,
    file: r.file,
    size,
    sha256: r.sha256,
    thumbnail: r.thumbnail,
    thumbSha256: r.thumbSha256,
  };
}

/** 받은 index.json 글을 읽는다. 형식이 아니면 undefined, 틀린 항목은 빼고 같은 id 는 처음 것만 */
export function parseGalleryIndex(text: string): GalleryEntry[] | undefined {
  if (text.length > INDEX_MAX_BYTES) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof raw !== 'object' || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  if (r.format !== INDEX_FORMAT || typeof r.version !== 'number' || r.version > INDEX_VERSION)
    return undefined;
  if (!Array.isArray(r.pets)) return undefined;
  const seen = new Set<string>();
  const out: GalleryEntry[] = [];
  for (const p of r.pets) {
    if (out.length >= GALLERY_MAX_PETS) break;
    const e = parseGalleryEntry(p);
    if (!e || seen.has(e.id)) continue;
    seen.add(e.id);
    out.push(e);
  }
  return out;
}

/** index.json 을 만든다 (스크립트). id 순서로 늘 같은 글이 나오게 */
export function buildGalleryIndex(entries: readonly GalleryEntry[]): string {
  const pets = [...entries].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const index: GalleryIndex = { format: INDEX_FORMAT, version: INDEX_VERSION, pets };
  return `${JSON.stringify(index, null, 2)}\n`;
}

/** 검사를 통과한 펫 파일로 항목을 만든다 (스크립트가 sha256 을 계산해 넘긴다) */
export function entryFor(
  id: string,
  pet: SharedPet,
  file: { size: number; sha256: string; thumbSha256: string },
): GalleryEntry {
  if (!pet.meta?.author) throw new Error(`${id}: author missing`);
  return {
    id,
    name: pet.name,
    species: pet.kind,
    author: pet.meta.author,
    license: pet.meta.license,
    created: pet.meta.created,
    appVersion: pet.meta.appVersion,
    file: `pets/${id}.jjpet`,
    size: file.size,
    sha256: file.sha256,
    thumbnail: `thumbs/${id}.png`,
    thumbSha256: file.thumbSha256,
  };
}

/** 판 2 에서 아는 칸 (갤러리 올리기 검사: 모르는 칸이 있으면 받지 않는다) */
const TOP_KEYS = new Set(['format', 'version', 'manifest', 'images', 'blueprint', 'depth']);
const MANIFEST_KEYS = new Set(['name', 'species', 'author', 'license', 'created', 'appVersion', 'age']);
const IMAGE_KEYS = new Set(['main', 'poses', 'thumbnail']);
const POSE_KEYS = new Set(['happy', 'sleepy', 'hungry']);

/**
 * 갤러리에 올린 파일 검사 (CI). 앱 가져오기보다 엄격하다: 판 2, 만든 사람, 본 그림, 작은 그림이 꼭 있고,
 * 앱이 조용히 버리는 것(깨진 포즈, 깨진 설계도, 모르는 칸)도 문제로 본다. 문제가 없으면 빈 배열
 */
export function validateSubmission(
  id: string,
  text: string,
  bytes: number,
): { problems: string[]; pet?: SharedPet } {
  const problems: string[] = [];
  if (!isGalleryId(id)) problems.push(`file name must be lowercase a-z, 0-9, - (got "${id}")`);
  if (bytes > GALLERY_PET_MAX_BYTES) problems.push(`file is ${bytes} bytes, max ${GALLERY_PET_MAX_BYTES}`);
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text);
  } catch {
    return { problems: [...problems, 'not JSON'] };
  }
  if (raw?.format !== SHARE_FORMAT || raw.version !== SHARE_VERSION)
    return { problems: [...problems, `format must be "${SHARE_FORMAT}" version ${SHARE_VERSION}`] };
  const extra = (o: unknown, keys: Set<string>, where: string) => {
    if (typeof o !== 'object' || o === null || Array.isArray(o)) {
      problems.push(`${where} must be an object`);
      return;
    }
    for (const k of Object.keys(o)) if (!keys.has(k)) problems.push(`unknown field ${where}.${k}`);
  };
  extra(raw, TOP_KEYS, '(top)');
  extra(raw.manifest, MANIFEST_KEYS, 'manifest');
  extra(raw.images, IMAGE_KEYS, 'images');
  const images = (raw.images ?? {}) as Record<string, unknown>;
  if (images.poses !== undefined) extra(images.poses, POSE_KEYS, 'images.poses');
  const pet = decodePet(text);
  if ('error' in pet) return { problems: [...problems, `app rejects it: ${pet.error}`] };
  const manifest = (raw.manifest ?? {}) as Record<string, unknown>;
  if (pet.name !== manifest.name) problems.push('manifest.name is not a clean pet name (1-12 letters)');
  if (pet.kind !== manifest.species) problems.push('manifest.species is not a known species');
  if (!pet.meta?.author) problems.push('manifest.author is required in the gallery');
  if (!pet.image) problems.push('images.main is required in the gallery');
  if (!pet.thumbnail || !cleanThumbnail(pet.thumbnail)) problems.push('images.thumbnail (PNG) is required');
  const poses = (images.poses ?? {}) as Record<string, unknown>;
  for (const k of Object.keys(poses))
    if (POSE_KEYS.has(k) && !pet.poses[k as keyof SharedPet['poses']])
      problems.push(`images.poses.${k} is broken`);
  if (raw.blueprint !== undefined && !pet.model) problems.push('blueprint is broken');
  if (raw.depth !== undefined && !pet.depth) problems.push('depth is broken or used together with blueprint');
  if (manifest.age !== undefined && !pet.age) problems.push('manifest.age is not a known age stage');
  return problems.length ? { problems } : { problems, pet };
}

/**
 * 갤러리 주소를 고른다. 바꾸는 주소(JJ_GALLERY_URL)는 개발 중(dev)에만, 그리고 내 컴퓨터(127.0.0.1, localhost)
 * 주소만 받는다 (시험에서 index.json 을 내 컴퓨터로 내려 줄 때). 끝은 / 로 맞춘다
 */
export function galleryBase(override: string | undefined, dev: boolean): string {
  if (!dev || !override) return GALLERY_BASE;
  try {
    const u = new URL(override);
    const local = u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost');
    if (!local || u.username || u.password || u.search || u.hash) return GALLERY_BASE;
    return u.href.endsWith('/') ? u.href : `${u.href}/`;
  } catch {
    return GALLERY_BASE;
  }
}

/** 받을 주소: 갤러리 폴더 안 상대 경로만 (항목의 file, thumbnail). 다른 호스트로 가지 못하게 다시 본다 */
export function galleryUrl(base: string, path: string): string | undefined {
  if (!/^(?:pets\/[a-z0-9-]+\.jjpet|thumbs\/[a-z0-9-]+\.png|index\.json)$/.test(path)) return undefined;
  try {
    const u = new URL(path, base);
    if (!u.href.startsWith(base)) return undefined;
    if (u.protocol === 'https:' && u.hostname !== GALLERY_HOST) return undefined;
    return u.href;
  } catch {
    return undefined;
  }
}
