// 펫 공유 (v2): 내가 만든 펫을 .jjpet 파일 하나로 친구에게 준다. 이름, 기본 모양, 사진, 포즈 사진.
// 남이 준 파일이라 엄격하게 읽는다: 형식, 크기, 그림 머리말.

import { t } from './i18n/index.ts';
import { type AgeStage, isAgeStage } from './illustrate.ts';
import { sizeOk } from './image-head.ts';
import { type Blueprint, parseBlueprint } from './pet3d/blueprint.ts';
import { cleanPetName, isPetKind, type PetKind, type PoseKind } from './settings.ts';

export const SHARE_FORMAT = 'jjakkung-pet';
export const SHARE_VERSION = 1;
/** 파일 하나 상한 (그림 네 장, 움직이는 그림 8MB 를 base64 로) */
export const SHARE_MAX_BYTES = 48 * 1024 * 1024;
const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
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
}

export function encodePet(p: SharedPet): string {
  return JSON.stringify({ format: SHARE_FORMAT, version: SHARE_VERSION, ...p });
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

/** .jjpet 글을 읽는다. 틀리면 이유를 담은 오류 */
export function decodePet(text: string): SharedPet | { error: string } {
  if (text.length > SHARE_MAX_BYTES) return { error: t('pet.share.tooBig') };
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text);
  } catch {
    return { error: t('pet.share.notPet') };
  }
  if (raw?.format !== SHARE_FORMAT) return { error: t('pet.share.notPet') };
  if (typeof raw.version !== 'number' || raw.version > SHARE_VERSION) return { error: t('pet.share.newer') };
  const name = cleanPetName(raw.name);
  if (!name) return { error: t('pet.share.noName') };
  const kind: PetKind = isPetKind(raw.kind) ? raw.kind : 'kong';
  const image = raw.image === undefined ? undefined : cleanImage(raw.image);
  if (raw.image !== undefined && !image) return { error: t('pet.share.badImage') };
  const poses: SharedPet['poses'] = {};
  const rawPoses =
    typeof raw.poses === 'object' && raw.poses !== null ? (raw.poses as Record<string, unknown>) : {};
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
  const safe = name.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '') || 'pet';
  return `${safe}.jjpet`;
}
