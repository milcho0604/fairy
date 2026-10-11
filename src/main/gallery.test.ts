import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { GALLERY_BASE } from '../shared/gallery.ts';
import { createGallery, type FetchLike, fetchCapped } from './gallery.ts';

const root = new URL('../../gallery/', import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root));
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

/** 레포 gallery/ 를 내려 주는 가짜 fetch. 받은 주소를 남긴다 */
function fakeFetch(over: Record<string, () => Response> = {}) {
  const urls: string[] = [];
  const init: RequestInit[] = [];
  const fetch: FetchLike = async (url, i) => {
    urls.push(url);
    init.push(i);
    if (over[url]) return over[url]();
    if (!url.startsWith(GALLERY_BASE)) throw new Error('blocked');
    try {
      return new Response(read(url.slice(GALLERY_BASE.length)));
    } catch {
      return new Response('nope', { status: 404 });
    }
  };
  return { fetch, urls, init };
}
const log = () => {};

test('목록과 작은 그림을 받고, 고른 펫을 sha256 확인 뒤 읽는다', async () => {
  const f = fakeFetch();
  const g = createGallery({ fetch: f.fetch, base: GALLERY_BASE, log });
  const r = await g.list();
  assert.ok(r.ok);
  assert.deepEqual(
    r.pets.map((p) => [p.id, p.name, p.author, p.license, !!p.thumb?.startsWith('data:image/png;base64,')]),
    [
      ['choco', '초코', '페어리', 'CC-BY-4.0', true],
      ['milk', '밀크', '페어리', 'CC-BY-4.0', true],
    ],
  );
  // 넘기기는 따라가지 않고 쿠키도 보내지 않는다
  assert.ok(f.init.every((i) => i.redirect === 'error' && i.credentials === 'omit'));
  const d = await g.download('milk');
  assert.ok(d.ok && d.pet.name === '밀크' && d.pet.kind === 'cat' && d.pet.meta?.author === '페어리');
  assert.ok(f.urls.every((u) => u.startsWith(GALLERY_BASE)));
});

test('목록에 없는 id, 바뀐 파일은 받지 않는다', async () => {
  const milk = read('pets/milk.jjpet');
  const tampered = Buffer.from(milk);
  tampered[tampered.length - 3] = 0x41;
  const f = fakeFetch({ [`${GALLERY_BASE}pets/milk.jjpet`]: () => new Response(tampered) });
  const g = createGallery({ fetch: f.fetch, base: GALLERY_BASE, log });
  assert.equal((await g.download('milk')).ok, false); // 목록을 받기 전
  assert.ok((await g.list()).ok);
  assert.deepEqual(await g.download('../../x'), { ok: false, reason: 'bad' });
  assert.deepEqual(await g.download('milk'), { ok: false, reason: 'bad' });
  assert.notEqual(sha(tampered), sha(milk));
});

test('작은 그림의 sha256 이 다르면 그림 없이 보인다', async () => {
  const f = fakeFetch({ [`${GALLERY_BASE}thumbs/milk.png`]: () => new Response(read('thumbs/choco.png')) });
  const r = await createGallery({ fetch: f.fetch, base: GALLERY_BASE, log }).list();
  assert.ok(r.ok);
  assert.equal(r.pets.find((p) => p.id === 'milk')?.thumb, undefined);
  assert.ok(r.pets.find((p) => p.id === 'choco')?.thumb);
});

test('인터넷 없음, 아직 없음(404), 깨진 목록을 나눠 알린다', async () => {
  const offline: FetchLike = async () => {
    throw new TypeError('fetch failed');
  };
  assert.deepEqual(await createGallery({ fetch: offline, base: GALLERY_BASE, log }).list(), {
    ok: false,
    reason: 'offline',
  });
  const missing: FetchLike = async () => new Response('404: Not Found', { status: 404 });
  assert.deepEqual(await createGallery({ fetch: missing, base: GALLERY_BASE, log }).list(), {
    ok: false,
    reason: 'notFound',
  });
  const junk: FetchLike = async () => new Response('{"format":"x"}');
  assert.deepEqual(await createGallery({ fetch: junk, base: GALLERY_BASE, log }).list(), {
    ok: false,
    reason: 'bad',
  });
  const server: FetchLike = async () => new Response('', { status: 500 });
  assert.deepEqual(await createGallery({ fetch: server, base: GALLERY_BASE, log }).list(), {
    ok: false,
    reason: 'bad',
  });
});

test('상한을 넘으면 그 자리에서 끊는다 (적힌 크기, 실제 크기)', async () => {
  const big: FetchLike = async () =>
    new Response('x', { headers: { 'content-length': String(10 * 1024 * 1024) } });
  assert.deepEqual(await fetchCapped(big, 'https://x/', 1024, 1000), { ok: false, reason: 'bad' });
  let pulled = 0;
  const endless: FetchLike = async () =>
    new Response(
      new ReadableStream({
        pull(c) {
          pulled++;
          c.enqueue(new Uint8Array(64 * 1024));
        },
      }),
    );
  assert.deepEqual(await fetchCapped(endless, 'https://x/', 256 * 1024, 1000), { ok: false, reason: 'bad' });
  assert.ok(pulled < 20);
});

test('기다리는 시간을 넘기면 끊는다', async () => {
  const slow: FetchLike = (_u, init) =>
    new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
  assert.deepEqual(await fetchCapped(slow, 'https://x/', 1024, 20), { ok: false, reason: 'offline' });
});
