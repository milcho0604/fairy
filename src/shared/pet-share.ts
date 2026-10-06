// 펫 공유 (v2): 내가 만든 펫을 .jjpet 파일 하나로 친구에게 준다. 이름, 기본 모양, 사진, 포즈 사진.
// 남이 준 파일이라 엄격하게 읽는다: 형식, 크기, 그림 머리말.
import { cleanPetName, type PetKind, type PoseKind } from './settings.ts';

export const SHARE_FORMAT = 'jjakkung-pet';
export const SHARE_VERSION = 1;
/** 파일 하나 상한 (그림 네 장, 움직이는 그림 8MB 를 base64 로) */
export const SHARE_MAX_BYTES = 48 * 1024 * 1024;
const IMAGE_MAX_BYTES = 8 * 1024 * 1024;

export interface SharedPet {
  name: string;
  kind: PetKind;
  /** data URL (png, gif, webp). 없으면 기본 펫 */
  image?: string;
  poses: Partial<Record<PoseKind, string>>;
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
  if (bytes.length === 0 || bytes.length > IMAGE_MAX_BYTES) return undefined;
  const head = bytes.subarray(0, 12).toString('latin1');
  const ok =
    (m[1] === 'png' && bytes.readUInt32BE(0) === 0x89504e47) ||
    (m[1] === 'gif' && head.startsWith('GIF8')) ||
    (m[1] === 'webp' && head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP');
  return ok ? v : undefined;
}

/** .jjpet 글을 읽는다. 틀리면 이유를 담은 오류 */
export function decodePet(text: string): SharedPet | { error: string } {
  if (text.length > SHARE_MAX_BYTES) return { error: '파일이 너무 커.' };
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text);
  } catch {
    return { error: '짝꿍 펫 파일이 아니야.' };
  }
  if (raw?.format !== SHARE_FORMAT) return { error: '짝꿍 펫 파일이 아니야.' };
  if (typeof raw.version !== 'number' || raw.version > SHARE_VERSION)
    return { error: '더 새 짝꿍에서 만든 파일이야. 짝꿍을 올려 줘.' };
  const name = cleanPetName(raw.name);
  if (!name) return { error: '펫 이름이 비었어.' };
  const kind: PetKind = raw.kind === 'cat' || raw.kind === 'chick' ? raw.kind : 'kong';
  const image = raw.image === undefined ? undefined : cleanImage(raw.image);
  if (raw.image !== undefined && !image) return { error: '펫 그림이 깨졌거나 너무 커.' };
  const poses: SharedPet['poses'] = {};
  const rawPoses =
    typeof raw.poses === 'object' && raw.poses !== null ? (raw.poses as Record<string, unknown>) : {};
  for (const k of ['happy', 'sleepy', 'hungry'] as const) {
    const img = cleanImage(rawPoses[k]);
    if (img) poses[k] = img;
  }
  return { name, kind, ...(image ? { image } : {}), poses };
}

/** 파일 이름으로 쓸 수 있게 (공유 파일 이름 기본값) */
export function shareFileName(name: string): string {
  const safe = name.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '') || 'pet';
  return `${safe}.jjpet`;
}
