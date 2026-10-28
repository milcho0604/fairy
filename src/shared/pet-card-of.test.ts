import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cardOf, isCustomPet, lookOf, STAND_IN } from './pet-card-of.ts';

const base = { petName: '나비', petKind: 'cat', petStands: {} } as const;

test('기본 펫: 종류와 이름이 간다', () => {
  assert.deepEqual(cardOf({ ...base }), { species: 'kind:cat', name: '나비', stand: false });
  assert.deepEqual(cardOf({ ...base, petKind: 'penguin' }), {
    species: 'kind:penguin',
    name: '나비',
    stand: false,
  });
});

test('밀크와 초코: starter 종류, 네 발 서기는 설정을 따른다', () => {
  const milk = 'pet-milk-1700000000000.png';
  assert.deepEqual(cardOf({ ...base, petImage: milk }), {
    species: 'starter:milk',
    name: '나비',
    stand: false,
  });
  assert.deepEqual(cardOf({ ...base, petImage: milk, petStands: { 'starter:milk': true } }), {
    species: 'starter:milk',
    name: '나비',
    stand: true,
  });
  assert.equal(cardOf({ ...base, petImage: 'pet-choco-5.png' }).species, 'starter:choco');
});

test('직접 가져온 그림, 사진, 만든 그림, 펫 파일은 카드에 안 들어가고 대역(기본 펫 종류)으로 간다', () => {
  for (const extra of [
    { petImage: 'pet-1700000000000.png' },
    { petImage: 'pet-photo-12.png', petModel: 'model-1.json' },
    { petImage: 'pet-milk-copy.png' }, // 밀크 복사본 이름이 아니다
    { petSprites: { stand: 'sprite-stand.png' } as never },
  ]) {
    const s = { ...base, ...extra };
    assert.equal(isCustomPet(s), true, JSON.stringify(extra));
    const c = cardOf(s);
    assert.deepEqual(c, { species: 'kind:cat', name: '나비', stand: false }, JSON.stringify(extra));
    assert.ok(!JSON.stringify(c).includes('.png') && !JSON.stringify(c).includes('model'));
  }
  assert.equal(isCustomPet({ ...base, petImage: undefined }), false);
  assert.equal(isCustomPet({ ...base, petImage: 'pet-milk-1.png' }), false);
});

test('이름: 규칙에 안 맞으면 null (한 글자, 주소, @, 너무 긴 이름)', () => {
  for (const petName of ['가', 'www.a.com', 'a@b', '가나다라마바사아자차카타파', '', '  ']) {
    assert.equal(cardOf({ ...base, petName }).name, null, petName);
  }
  assert.equal(cardOf({ ...base, petName: ' 뭉치 ' }).name, '뭉치');
});

test('lookOf: 아는 종류는 그대로, 모르는 종류는 대역', () => {
  assert.deepEqual(lookOf('kind:bear'), { kind: 'bear', known: true });
  assert.deepEqual(lookOf('starter:choco'), { kind: 'dog', starter: 'choco', known: true });
  assert.deepEqual(lookOf('starter:milk'), { kind: 'cat', starter: 'milk', known: true });
  for (const x of ['kind:dragon', 'starter:other', 'photo:1', '', 'kind', 'kind:__proto__'])
    assert.deepEqual(lookOf(x), { kind: STAND_IN, known: false }, x);
});
