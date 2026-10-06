import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodePet, encodePet, SHARE_FORMAT, shareFileName } from './pet-share.ts';

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
