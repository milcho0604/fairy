import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setLang } from './i18n/index.ts';
import { DEFAULT_SETTINGS, parseSettings } from './settings.ts';
import {
  isCurrentStarter,
  isStarterId,
  isStarterName,
  parsePetChoice,
  STARTER_PETS,
  starterFileName,
  starterOf,
} from './starter-pets.ts';

test('밀크, 초코 이름과 설명 (영어도)', () => {
  assert.deepEqual(
    STARTER_PETS.map((p) => p.name),
    ['밀크', '초코'],
  );
  assert.ok(STARTER_PETS.every((p) => p.desc.length > 0));
  setLang('en');
  try {
    assert.deepEqual(
      STARTER_PETS.map((p) => p.name),
      ['Milk', 'Choco'],
    );
    assert.equal(STARTER_PETS[1]?.desc, 'brown curly poodle');
  } finally {
    setLang('ko');
  }
});

test('복사본 파일 이름: 설정이 받는 사진 펫 이름 규칙을 따르고 어느 캐릭터인지 알아본다', () => {
  const f = starterFileName('choco', 1760000000000);
  assert.equal(f, 'pet-choco-1760000000000.png');
  assert.equal(parseSettings({ ...DEFAULT_SETTINGS, petImage: f }).petImage, f);
  assert.equal(starterOf(f), 'choco');
  assert.equal(starterOf(starterFileName('milk', 5)), 'milk');
  // 펫 만들기 그림, 다른 형식, 다른 이름은 아니다
  for (const x of [
    'pet-1760000000000.png',
    'pet-milk-1.gif',
    'pet-milky-1.png',
    'pose-milk-1.png',
    '',
    null,
    undefined,
  ])
    assert.equal(starterOf(x), undefined, String(x));
  assert.ok(isCurrentStarter('pet-milk-3.png', 'milk'));
  assert.ok(!isCurrentStarter('pet-milk-3.png', 'choco'));
  assert.ok(!isCurrentStarter(undefined, 'milk'));
});

test('펫 고르기 요청 확인 (설정 창 IPC): 기본 펫, 그림 친구, 보관한 펫만', () => {
  assert.deepEqual(parsePetChoice({ kind: 'cat' }), { kind: 'cat' });
  assert.deepEqual(parsePetChoice({ starter: 'milk' }), { starter: 'milk' });
  assert.deepEqual(parsePetChoice({ id: 'p-abc' }), { id: 'p-abc' });
  for (const bad of [
    null,
    undefined,
    'milk',
    ['milk'],
    {},
    { kind: 'dragon' },
    { starter: 'latte' },
    { starter: '../milk' },
    { id: '' },
    { id: 3 },
    { id: 'x'.repeat(65) },
  ])
    assert.equal(parsePetChoice(bad), undefined, JSON.stringify(bad));
  assert.ok(isStarterId('choco'));
  assert.ok(!isStarterId('kong'));
});

test('고른 그대로의 이름은 말을 바꿔도 알아본다 (말 바꾼 뒤 초코가 보관함에 하나 더 생기던 것)', () => {
  setLang('en');
  try {
    assert.equal(isStarterName('choco', '초코'), true);
    assert.equal(isStarterName('choco', 'Choco'), true);
    assert.equal(isStarterName('choco', '밀크'), false);
    assert.equal(isStarterName('milk', '몽실이'), false);
  } finally {
    setLang('ko');
  }
});
