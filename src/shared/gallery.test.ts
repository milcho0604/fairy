import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  buildGalleryIndex,
  GALLERY_BASE,
  type GalleryEntry,
  galleryBase,
  galleryUrl,
  parseGalleryIndex,
  validateSubmission,
} from './gallery.ts';
import { buildGallery, sha256 } from './gallery-build.ts';
import { encodePet, type SharedPet } from './pet-share.ts';

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABh6FO1AAAAABJRU5ErkJggg==';
const META = { author: '짝꿍', license: 'CC-BY-4.0' as const, created: '2026-10-10', appVersion: '0.1.0' };
const PET: SharedPet = { name: '밀크', kind: 'cat', image: PNG, poses: {}, thumbnail: PNG };
const file = (name: string, text: string) => ({ name, bytes: Buffer.from(text) });

const entry = (id: string): GalleryEntry => ({
  id,
  name: '밀크',
  species: 'cat',
  author: '짝꿍',
  license: 'CC-BY-4.0',
  created: '2026-10-10',
  appVersion: '0.1.0',
  file: `pets/${id}.jjpet`,
  size: 10,
  sha256: 'a'.repeat(64),
  thumbnail: `thumbs/${id}.png`,
  thumbSha256: 'b'.repeat(64),
});

test('목록 만들기: 펫 파일에서 항목, 작은 그림, sha256 을 만든다', () => {
  const text = encodePet(PET, META);
  const built = buildGallery([file('milk.jjpet', text)]);
  assert.deepEqual(built.problems, []);
  assert.equal(built.entries.length, 1);
  const e = built.entries[0];
  assert.equal(e?.sha256, sha256(Buffer.from(text)));
  assert.equal(e?.size, Buffer.byteLength(text));
  assert.equal(e?.file, 'pets/milk.jjpet');
  assert.equal(e?.thumbnail, 'thumbs/milk.png');
  const thumb = built.thumbs.get('milk');
  assert.ok(thumb && e?.thumbSha256 === sha256(thumb));
  // 앱이 같은 목록으로 읽는다
  assert.deepEqual(parseGalleryIndex(built.index), built.entries);
});

test('목록 만들기는 id 순서라 늘 같은 글', () => {
  const a = buildGalleryIndex([entry('b'), entry('a')]);
  const b = buildGalleryIndex([entry('a'), entry('b')]);
  assert.equal(a, b);
  assert.deepEqual(
    JSON.parse(a).pets.map((p: GalleryEntry) => p.id),
    ['a', 'b'],
  );
});

test('갤러리 올리기 검사: 만든 사람, 본 그림, 작은 그림, 판 2, 파일 이름', () => {
  assert.deepEqual(validateSubmission('milk', encodePet(PET, META), 100).problems, []);
  const noAuthor = validateSubmission('milk', encodePet(PET, { ...META, author: undefined }), 100);
  assert.ok(noAuthor.problems.some((p) => p.includes('author')));
  const { image: _i, ...noImage } = PET;
  assert.ok(validateSubmission('x', encodePet(noImage, META), 100).problems.length > 0);
  const { thumbnail: _t, ...noThumb } = PET;
  assert.ok(
    validateSubmission('x', encodePet(noThumb, META), 100).problems.some((p) => p.includes('thumbnail')),
  );
  assert.ok(validateSubmission('Milk', encodePet(PET, META), 100).problems.length > 0);
  assert.ok(validateSubmission('../x', encodePet(PET, META), 100).problems.length > 0);
  assert.ok(validateSubmission('milk', encodePet(PET, META), 17 * 1024 * 1024).problems.length > 0);
  const v1 = JSON.stringify({ format: 'jjakkung-pet', version: 1, name: '밀크', image: PNG });
  assert.ok(validateSubmission('milk', v1, 100).problems.length > 0);
});

test('갤러리 올리기 검사: 앱이 조용히 버리는 것(모르는 칸, 깨진 포즈, 깨진 설계도)도 문제', () => {
  const raw = JSON.parse(encodePet(PET, META));
  const check = (o: unknown) => validateSubmission('milk', JSON.stringify(o), 100).problems;
  assert.ok(check({ ...raw, script: 'x' }).some((p) => p.includes('unknown field')));
  assert.ok(check({ ...raw, manifest: { ...raw.manifest, url: 'x' } }).length > 0);
  assert.ok(
    check({ ...raw, images: { ...raw.images, poses: { happy: 'data:image/png;base64,AAAA' } } }).length > 0,
  );
  assert.ok(check({ ...raw, blueprint: { parts: [] } }).some((p) => p.includes('blueprint')));
  assert.ok(check({ ...raw, manifest: { ...raw.manifest, species: 'dragon' } }).length > 0);
  assert.ok(check({ ...raw, manifest: { ...raw.manifest, name: '  밀크 ' } }).length > 0);
});

test('목록 만들기: 문제 있는 파일은 빼고 이유를 적는다 (같은 이름, 다른 확장자)', () => {
  const text = encodePet(PET, META);
  const built = buildGallery([file('milk.jjpet', text), file('milk2.jjpet', text), file('readme.txt', 'x')]);
  assert.equal(built.entries.length, 1);
  assert.equal(built.problems.length, 2);
});

test('앱이 읽는 목록: 경로는 id 로만, 틀린 항목은 빼고 같은 id 는 처음 것', () => {
  const good = entry('milk');
  const index = (pets: unknown[]) => JSON.stringify({ format: 'jjakkung-gallery', version: 1, pets });
  assert.deepEqual(parseGalleryIndex(index([good])), [good]);
  assert.deepEqual(parseGalleryIndex(index([{ ...good, file: '../../etc/passwd' }])), []);
  assert.deepEqual(parseGalleryIndex(index([{ ...good, thumbnail: 'https://evil.example/x.png' }])), []);
  assert.deepEqual(parseGalleryIndex(index([{ ...good, sha256: 'xyz' }])), []);
  assert.deepEqual(parseGalleryIndex(index([{ ...good, size: 17 * 1024 * 1024 }])), []);
  assert.deepEqual(parseGalleryIndex(index([{ ...good, license: 'MIT' }])), []);
  assert.deepEqual(parseGalleryIndex(index([{ ...good, author: 'a‮b' }])), []);
  assert.deepEqual(parseGalleryIndex(index([good, { ...good, name: '초코' }])), [good]);
  assert.equal(parseGalleryIndex('nope'), undefined);
  assert.equal(parseGalleryIndex(JSON.stringify({ format: 'x', version: 1, pets: [] })), undefined);
  assert.equal(
    parseGalleryIndex(JSON.stringify({ format: 'jjakkung-gallery', version: 2, pets: [] })),
    undefined,
  );
  assert.equal(parseGalleryIndex(' '.repeat(300 * 1024)), undefined);
});

test('갤러리 주소: 바꾸기는 개발 중 내 컴퓨터 주소만', () => {
  assert.equal(galleryBase(undefined, true), GALLERY_BASE);
  assert.equal(galleryBase('http://127.0.0.1:9900', false), GALLERY_BASE);
  assert.equal(galleryBase('http://127.0.0.1:9900', true), 'http://127.0.0.1:9900/');
  assert.equal(galleryBase('http://localhost:9900/g/', true), 'http://localhost:9900/g/');
  assert.equal(galleryBase('https://evil.example/', true), GALLERY_BASE);
  assert.equal(galleryBase('http://10.0.0.1/', true), GALLERY_BASE);
  assert.equal(galleryBase('http://u:p@127.0.0.1/', true), GALLERY_BASE);
  assert.equal(galleryBase('file:///etc/', true), GALLERY_BASE);
});

test('받을 주소: 갤러리 폴더 안 정해진 모양만', () => {
  assert.equal(galleryUrl(GALLERY_BASE, 'index.json'), `${GALLERY_BASE}index.json`);
  assert.equal(galleryUrl(GALLERY_BASE, 'pets/milk.jjpet'), `${GALLERY_BASE}pets/milk.jjpet`);
  assert.equal(galleryUrl(GALLERY_BASE, 'thumbs/milk.png'), `${GALLERY_BASE}thumbs/milk.png`);
  assert.equal(galleryUrl(GALLERY_BASE, '../x.json'), undefined);
  assert.equal(galleryUrl(GALLERY_BASE, '//evil.example/pets/a.jjpet'), undefined);
  assert.equal(galleryUrl(GALLERY_BASE, 'pets/../../a.jjpet'), undefined);
});

test('레포 gallery/ 의 목록이 펫 파일과 맞다 (밀크, 초코만)', () => {
  const root = new URL('../../gallery/', import.meta.url);
  const index = parseGalleryIndex(readFileSync(new URL('index.json', root), 'utf8'));
  assert.deepEqual(
    index?.map((e) => [e.id, e.name, e.author, e.license]),
    [
      ['choco', '초코', '페어리', 'CC-BY-4.0'],
      ['milk', '밀크', '페어리', 'CC-BY-4.0'],
    ],
  );
  for (const e of index ?? []) {
    const bytes = readFileSync(new URL(e.file, root));
    assert.equal(sha256(bytes), e.sha256);
    assert.equal(bytes.length, e.size);
    assert.equal(sha256(readFileSync(new URL(e.thumbnail, root))), e.thumbSha256);
  }
});
