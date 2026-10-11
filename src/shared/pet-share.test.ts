import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  cleanPetMeta,
  decodePet as decodeFull,
  encodePet,
  LICENSE_LABEL,
  PET_LICENSES,
  reexportMeta,
  SHARE_FORMAT,
  type SharedPet,
  shareFileName,
} from './pet-share.ts';
import { DEFAULT_BLUEPRINTS } from './pet3d/defaults.ts';

// 1x1 투명 PNG
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABh6FO1AAAAABJRU5ErkJggg==';

/** 옛 시험은 이름표(meta)를 빼고 본다 (판 2 로 쓰면 늘 붙는다) */
function decodePet(text: string): SharedPet | { error: string } {
  const r = decodeFull(text);
  if ('error' in r) return r;
  const { meta: _meta, ...rest } = r;
  return rest;
}

test('보내고 받기: 이름, 모양, 그림, 포즈가 그대로', () => {
  const pet = { name: '까망이', kind: 'cat' as const, image: PNG, poses: { happy: PNG } };
  assert.deepEqual(decodePet(encodePet(pet)), pet);
  assert.deepEqual(decodePet(encodePet({ name: '콩', kind: 'kong', poses: {} })), {
    name: '콩',
    kind: 'kong',
    poses: {},
  });
});

test('남이 준 파일은 엄격하게: 형식, 판, 이름, 그림 머리말', () => {
  assert.ok('error' in decodePet('{"hello":1}'));
  assert.ok('error' in decodePet('not json'));
  assert.ok('error' in decodePet(JSON.stringify({ format: SHARE_FORMAT, version: 99, name: 'x' })));
  assert.ok('error' in decodePet(JSON.stringify({ format: SHARE_FORMAT, version: 1, name: '  ' })));
  // png 라고 했지만 내용은 다른 것
  const fake = `data:image/png;base64,${Buffer.from('<script>').toString('base64')}`;
  assert.ok(
    'error' in decodePet(JSON.stringify({ format: SHARE_FORMAT, version: 1, name: 'x', image: fake })),
  );
  // 포즈가 이상하면 그 포즈만 버린다, 모르는 모양은 콩
  const ok = decodePet(
    JSON.stringify({
      format: SHARE_FORMAT,
      version: 1,
      name: 'x',
      kind: 'dragon',
      poses: { happy: fake, sleepy: PNG },
    }),
  );
  assert.deepEqual(ok, { name: 'x', kind: 'kong', poses: { sleepy: PNG } });
});

test('공유 파일 이름', () => {
  assert.equal(shareFileName('까망 이/2'), '까망-이-2.fairy');
  assert.equal(shareFileName('***'), 'fairy.fairy');
});

test('입체 설계도도 같이 주고받는다 (사진이 있을 때만, 깨졌으면 뺀다)', () => {
  const image = PNG;
  const model = DEFAULT_BLUEPRINTS.cat;
  assert.deepEqual(decodePet(encodePet({ name: '치즈', kind: 'cat', image, poses: {}, model })), {
    name: '치즈',
    kind: 'cat',
    image,
    poses: {},
    model,
  });
  const broken = JSON.parse(encodePet({ name: '치즈', kind: 'cat', image, poses: {} }));
  assert.deepEqual(decodePet(JSON.stringify({ ...broken, blueprint: { parts: 'x' } })), {
    name: '치즈',
    kind: 'cat',
    image,
    poses: {},
  });
  const noImage = decodePet(encodePet({ name: '콩', kind: 'kong', poses: {}, model }));
  assert.ok(!('error' in noImage) && !('model' in noImage));
});

test('가로세로가 터무니없는 그림은 받지 않는다 (작은 파일이라도 풀면 몇 GB)', () => {
  const head = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(head, 0);
  head.writeUInt32BE(13, 8);
  head.write('IHDR', 12, 'latin1');
  head.writeUInt32BE(23000, 16);
  head.writeUInt32BE(23000, 20);
  const huge = `data:image/png;base64,${head.toString('base64')}`;
  const ok = decodePet(encodePet({ name: '작은', kind: 'kong', image: PNG, poses: {} }));
  assert.ok(!('error' in ok) && ok.image === PNG);
  const r = decodePet(encodePet({ name: '큰', kind: 'kong', image: huge, poses: {} }));
  assert.ok('error' in r || !r.image);
});

// ---- 판 2 (2026-10-11, 펫 갤러리) ----

/** 판 1 파일 (옛 앱이 쓴 모양 그대로) */
const v1 = (o: Record<string, unknown>) => JSON.stringify({ format: SHARE_FORMAT, version: 1, ...o });

test('판 1 파일도 그대로 읽는다 (이름표 없이)', () => {
  const model = DEFAULT_BLUEPRINTS.cat;
  const r = decodeFull(
    v1({ name: '치즈', kind: 'cat', image: PNG, poses: { happy: PNG }, model, age: 'baby' }),
  );
  assert.deepEqual(r, { name: '치즈', kind: 'cat', image: PNG, poses: { happy: PNG }, model, age: 'baby' });
});

test('판 2 로 쓰고 이름표(만든 사람, 허락, 날짜, 앱 판, 작은 그림)를 그대로 읽는다', () => {
  const meta = {
    author: '짝꿍',
    license: 'CC-BY-SA-4.0' as const,
    created: '2026-10-11',
    appVersion: '1.2.3',
  };
  const pet: SharedPet = { name: '밀크', kind: 'cat', image: PNG, poses: {}, thumbnail: PNG, age: 'adult' };
  const text = encodePet(pet, meta);
  const raw = JSON.parse(text);
  assert.equal(raw.version, 2);
  assert.deepEqual(Object.keys(raw).sort(), ['format', 'images', 'manifest', 'version']);
  assert.deepEqual(raw.manifest, { name: '밀크', species: 'cat', ...meta, age: 'adult' });
  assert.deepEqual(raw.images, { main: PNG, poses: {}, thumbnail: PNG });
  assert.deepEqual(decodeFull(text), { ...pet, meta });
});

test('허락을 안 고르면 CC BY 4.0, 만든 사람은 없어도 된다', () => {
  const r = decodeFull(encodePet({ name: '콩', kind: 'kong', poses: {} }));
  assert.ok(!('error' in r));
  assert.equal(r.meta?.license, 'CC-BY-4.0');
  assert.equal(r.meta?.author, undefined);
  assert.ok(r.meta && Date.parse(r.meta.created) > 0);
});

test('판 2 이름표가 틀리면 받지 않는다', () => {
  const good = JSON.parse(encodePet({ name: '콩', kind: 'kong', poses: {} }, { appVersion: '1.0.0' }));
  const bad = (patch: Record<string, unknown>) =>
    decodeFull(JSON.stringify({ ...good, manifest: { ...good.manifest, ...patch } }));
  assert.ok('error' in bad({ license: 'MIT' }));
  assert.ok('error' in bad({ license: undefined }));
  assert.ok('error' in bad({ created: 'yesterday' }));
  assert.ok('error' in bad({ created: '1999-01-01' }));
  assert.ok('error' in bad({ appVersion: 'v1' }));
  assert.ok('error' in bad({ author: '' }));
  assert.ok('error' in bad({ author: 'a'.repeat(41) }));
  assert.ok('error' in bad({ name: '' }));
  assert.ok('error' in decodeFull(JSON.stringify({ ...good, manifest: 'x' })));
  assert.ok('error' in decodeFull(JSON.stringify({ ...good, version: 3 })));
  assert.ok('error' in decodeFull(JSON.stringify({ ...good, version: 1.5 })));
  // 만든 사람 이름의 방향 바꾸기, 줄바꿈 글자는 뺀다
  const r = bad({ author: ' 짝\u202e꿍\n ' });
  assert.ok(!('error' in r) && r.meta?.author === '짝꿍');
});

test('작은 그림은 PNG, 상한 안만', () => {
  const good = JSON.parse(encodePet({ name: '밀크', kind: 'cat', image: PNG, poses: {} }));
  const withThumb = (thumbnail: string) =>
    decodeFull(JSON.stringify({ ...good, images: { ...good.images, thumbnail } }));
  assert.ok(!('error' in withThumb(PNG)));
  const gif = `data:image/gif;base64,${Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00\x00').toString('base64')}`;
  assert.ok('error' in withThumb(gif));
  const head = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(head, 0);
  head.writeUInt32BE(13, 8);
  head.write('IHDR', 12, 'latin1');
  head.writeUInt32BE(1024, 16);
  head.writeUInt32BE(1024, 20);
  assert.ok('error' in withThumb(`data:image/png;base64,${head.toString('base64')}`));
});

test('설계도와 깊이 그림은 판 2 에서도 사진이 있을 때만', () => {
  const model = DEFAULT_BLUEPRINTS.dog;
  const raw = JSON.parse(encodePet({ name: '초코', kind: 'dog', image: PNG, poses: {}, model }));
  assert.deepEqual(raw.blueprint, model);
  assert.equal(raw.model, undefined);
  const noImage = JSON.parse(encodePet({ name: '콩', kind: 'kong', poses: { happy: PNG }, model }));
  assert.equal(noImage.blueprint, undefined);
  assert.deepEqual(noImage.images.poses, {});
});

test('허락 목록은 JSON 스키마와 같다', async () => {
  const { readFileSync } = await import('node:fs');
  const schema = JSON.parse(
    readFileSync(new URL('../../docs/schema/jjpet-v2.schema.json', import.meta.url), 'utf8'),
  );
  assert.deepEqual(schema.properties.manifest.properties.license.enum, [...PET_LICENSES]);
  assert.deepEqual(Object.keys(LICENSE_LABEL), [...PET_LICENSES]);
});

test('다시 내보낼 때 이름표: 데려온 펫은 만든 사람, 허락, 만든 날, 앱 판을 그대로', () => {
  const stored = {
    author: '짝꿍',
    license: 'CC-BY-NC-4.0',
    created: '2026-10-01T00:00:00Z',
    appVersion: '1.1.0',
  } as const;
  // 설정 → 데이터 → 펫 내보내기 (이름표를 안 준다)
  assert.deepEqual(reexportMeta(stored, undefined, '2.0.0'), stored);
  // 보내기 칸을 미리 채운 그대로
  assert.deepEqual(reexportMeta(stored, { author: '짝꿍', license: 'CC-BY-NC-4.0' }, '2.0.0'), stored);
  // 만든 사람을 바꿔 적으면 새 작품: 지금 앱 판, 만든 날은 encodePet 이 지금으로
  assert.deepEqual(reexportMeta(stored, { author: '나', license: 'CC-BY-4.0' }, '2.0.0'), {
    appVersion: '2.0.0',
    license: 'CC-BY-4.0',
    author: '나',
  });
  assert.deepEqual(reexportMeta(stored, { author: '' }, '2.0.0'), {
    appVersion: '2.0.0',
    license: 'CC-BY-NC-4.0',
  });
  // 직접 만든 펫
  assert.deepEqual(reexportMeta(undefined, { author: '나', license: 'CC0-1.0' }, '2.0.0'), {
    appVersion: '2.0.0',
    license: 'CC0-1.0',
    author: '나',
  });
  assert.deepEqual(reexportMeta(undefined, undefined, '2.0.0'), { appVersion: '2.0.0' });
  // 파일까지: 가져온 이름표가 다시 나온다
  const back = decodeFull(
    encodePet({ name: '콩', kind: 'kong', poses: {} }, reexportMeta(stored, undefined, '2.0.0')),
  );
  assert.ok(!('error' in back));
  assert.deepEqual(back.meta, stored);
});

test('저장해 둔 이름표 검사', () => {
  assert.deepEqual(
    cleanPetMeta({ license: 'CC0-1.0', created: '2026-10-11', appVersion: '1.0.0', author: '  ' }),
    {
      license: 'CC0-1.0',
      created: '2026-10-11',
      appVersion: '1.0.0',
    },
  );
  assert.equal(cleanPetMeta({ license: 'CC0-1.0', created: '2026-10-11' }), undefined);
  assert.equal(cleanPetMeta('CC0'), undefined);
  assert.equal(cleanPetMeta(null), undefined);
});
