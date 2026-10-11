// 펫 갤러리 받기 (P1 #11). 네트워크는 메인에서만 한다: 창은 목록(작은 그림은 data URL)과 결과 글만 받는다.
// 갤러리 폴더(GALLERY_BASE, 개발 중에는 내 컴퓨터 주소) 밖은 받지 않고, 다른 곳으로 넘기기(redirect)도 따라가지 않는다.
// 응답마다 상한(목록 256KB, 작은 그림 256KB, 펫은 목록에 적힌 크기)과 기다리는 시간이 있다.
// 펫 파일은 목록의 sha256, 크기와 맞을 때만 .jjpet 읽기(decodePet, 엄격한 검사)로 넘긴다.
// electron 없이 시험할 수 있게 fetch 를 받는다 (gallery.test.ts)
import { createHash } from 'node:crypto';
import {
  GALLERY_PET_MAX_BYTES,
  type GalleryEntry,
  type GalleryFail,
  type GalleryList,
  type GalleryView,
  galleryUrl,
  INDEX_MAX_BYTES,
  INDEX_TIMEOUT_MS,
  PET_TIMEOUT_MS,
  parseGalleryIndex,
} from '../shared/gallery.ts';
import { imageKind, sizeOk } from '../shared/image-head.ts';
import { decodePet, type SharedPet, THUMB_MAX_BYTES } from '../shared/pet-share.ts';

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** 응답을 상한까지만 바이트로 받는다. 못 받으면 까닭 */
export async function fetchCapped(
  fetch: FetchLike,
  url: string,
  maxBytes: number,
  timeoutMs: number,
): Promise<{ ok: true; bytes: Buffer } | { ok: false; reason: GalleryFail }> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    let res: Response;
    try {
      res = await fetch(url, {
        redirect: 'error',
        signal: ac.signal,
        credentials: 'omit',
        cache: 'no-store',
      });
    } catch {
      // 연결 안 됨, 시간 넘김, 넘기기(redirect)
      return { ok: false, reason: 'offline' };
    }
    if (res.status === 404) {
      await res.body?.cancel().catch(() => {});
      return { ok: false, reason: 'notFound' };
    }
    if (!res.ok || !res.body) {
      await res.body?.cancel().catch(() => {});
      return { ok: false, reason: 'bad' };
    }
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) {
      await res.body.cancel().catch(() => {});
      return { ok: false, reason: 'bad' };
    }
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      let step: ReadableStreamReadResult<Uint8Array>;
      try {
        step = await reader.read();
      } catch {
        return { ok: false, reason: 'offline' };
      }
      if (step.done) break;
      total += step.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return { ok: false, reason: 'bad' };
      }
      chunks.push(step.value);
    }
    return { ok: true, bytes: Buffer.concat(chunks) };
  } finally {
    clearTimeout(timer);
  }
}

const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

/** 한 번에 받는 작은 그림 수 */
const THUMB_PARALLEL = 4;

export function createGallery(o: {
  fetch: FetchLike;
  /** 갤러리 폴더 주소 (galleryBase) */
  base: string;
  log: (tag: string, ...rest: unknown[]) => void;
}) {
  /** 마지막으로 받은 목록. 받기는 이 목록의 항목으로만 한다 (창이 보낸 주소를 쓰지 않는다) */
  let entries: GalleryEntry[] = [];

  async function thumbOf(e: GalleryEntry): Promise<string | undefined> {
    const url = galleryUrl(o.base, e.thumbnail);
    if (!url) return undefined;
    const r = await fetchCapped(o.fetch, url, THUMB_MAX_BYTES, INDEX_TIMEOUT_MS);
    if (!r.ok || sha256(r.bytes) !== e.thumbSha256) return undefined;
    if (imageKind(r.bytes) !== 'png' || !sizeOk(r.bytes)) return undefined;
    return `data:image/png;base64,${r.bytes.toString('base64')}`;
  }

  async function list(): Promise<GalleryList> {
    const url = galleryUrl(o.base, 'index.json');
    if (!url) return { ok: false, reason: 'bad' };
    const r = await fetchCapped(o.fetch, url, INDEX_MAX_BYTES, INDEX_TIMEOUT_MS);
    if (!r.ok) {
      o.log('gallery', 'list failed', r.reason);
      return r;
    }
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(r.bytes);
    } catch {
      return { ok: false, reason: 'bad' };
    }
    const parsed = parseGalleryIndex(text);
    if (!parsed) return { ok: false, reason: 'bad' };
    entries = parsed;
    const pets: GalleryView[] = [];
    for (let i = 0; i < parsed.length; i += THUMB_PARALLEL) {
      const batch = parsed.slice(i, i + THUMB_PARALLEL);
      const thumbs = await Promise.all(batch.map((e) => thumbOf(e).catch(() => undefined)));
      batch.forEach((e, j) => {
        const thumb = thumbs[j];
        pets.push({
          id: e.id,
          name: e.name,
          species: e.species,
          author: e.author,
          license: e.license,
          ...(thumb ? { thumb } : {}),
        });
      });
    }
    o.log('gallery', 'list', pets.length);
    return { ok: true, pets };
  }

  /** 목록의 펫 하나를 받아 검사한다. 목록에 없는 id, sha256 이나 크기가 다르면 bad */
  async function download(
    id: unknown,
  ): Promise<{ ok: true; pet: SharedPet } | { ok: false; reason: GalleryFail }> {
    const e = entries.find((x) => x.id === id);
    const url = e && galleryUrl(o.base, e.file);
    if (!e || !url) return { ok: false, reason: 'bad' };
    const r = await fetchCapped(o.fetch, url, Math.min(e.size, GALLERY_PET_MAX_BYTES), PET_TIMEOUT_MS);
    if (!r.ok) return r;
    if (r.bytes.length !== e.size || sha256(r.bytes) !== e.sha256) {
      o.log('gallery', 'sha256 mismatch', e.id);
      return { ok: false, reason: 'bad' };
    }
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(r.bytes);
    } catch {
      return { ok: false, reason: 'bad' };
    }
    const pet = decodePet(text);
    if ('error' in pet) {
      o.log('gallery', 'decode failed', e.id);
      return { ok: false, reason: 'bad' };
    }
    return { ok: true, pet };
  }

  return { list, download };
}
