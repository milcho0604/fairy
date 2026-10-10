import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodePet, encodePet, SHARE_FORMAT, shareFileName } from './pet-share.ts';
import { DEFAULT_BLUEPRINTS } from './pet3d/defaults.ts';

// 1x1 투명 PNG
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABh6FO1AAAAABJRU5ErkJggg==';

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
  assert.equal(shareFileName('까망 이/2'), '까망-이-2.jjpet');
  assert.equal(shareFileName('***'), 'pet.jjpet');
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
  assert.deepEqual(decodePet(JSON.stringify({ ...broken, model: { parts: 'x' } })), {
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
