// 갤러리 목록 만들기 (scripts/gallery-index.mjs, scripts/gallery-validate.mjs 가 부른다. 앱에는 들어가지 않는다).
// gallery/pets/*.jjpet 을 받아 검사하고, 작은 그림 PNG 와 index.json 글을 만든다. 파일 읽고 쓰기는 스크립트가 한다
import { createHash } from 'node:crypto';
import { buildGalleryIndex, entryFor, type GalleryEntry, validateSubmission } from './gallery.ts';

export const sha256 = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

export interface BuiltGallery {
  /** 파일마다 문제 (비었으면 통과) */
  problems: string[];
  entries: GalleryEntry[];
  /** id 마다 작은 그림 PNG */
  thumbs: Map<string, Buffer>;
  /** index.json 글 */
  index: string;
}

/** pets/ 의 파일들 (이름, 내용)로 목록을 만든다. 문제가 있는 파일은 목록에서 빼고 problems 에 적는다 */
export function buildGallery(files: readonly { name: string; bytes: Buffer }[]): BuiltGallery {
  const problems: string[] = [];
  const entries: GalleryEntry[] = [];
  const thumbs = new Map<string, Buffer>();
  const names = new Set<string>();
  for (const { name, bytes } of files) {
    if (!name.endsWith('.jjpet')) {
      problems.push(`${name}: only .jjpet files belong in gallery/pets/`);
      continue;
    }
    const id = name.slice(0, -'.jjpet'.length);
    const text = bytes.toString('utf8');
    const { problems: p, pet } = validateSubmission(id, text, bytes.length);
    if (p.length || !pet?.thumbnail) {
      problems.push(...p.map((x) => `${name}: ${x}`));
      continue;
    }
    const lower = pet.name.toLowerCase();
    if (names.has(lower)) {
      problems.push(`${name}: another gallery pet is already called "${pet.name}"`);
      continue;
    }
    names.add(lower);
    const thumb = Buffer.from(pet.thumbnail.slice(pet.thumbnail.indexOf(',') + 1), 'base64');
    thumbs.set(id, thumb);
    entries.push(
      entryFor(id, pet, { size: bytes.length, sha256: sha256(bytes), thumbSha256: sha256(thumb) }),
    );
  }
  return { problems, entries, thumbs, index: buildGalleryIndex(entries) };
}
