import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyPatch, cleanPetName, DEFAULT_SETTINGS, parseSettings } from './settings.ts';

test('저장 파일이 없거나 깨졌으면 기본값', () => {
  assert.deepEqual(parseSettings(undefined), DEFAULT_SETTINGS);
  assert.deepEqual(parseSettings('x'), DEFAULT_SETTINGS);
  assert.deepEqual(parseSettings({ chatter: 'loud', wander: 'yes', hideHints: -3 }), {
    ...DEFAULT_SETTINGS,
    hideHints: 0,
  });
});

test('예전 펫 설정 파일(pet-settings.json)의 값도 읽는다', () => {
  assert.deepEqual(parseSettings({ chatter: 'quiet', hideHints: 2 }), {
    ...DEFAULT_SETTINGS,
    chatter: 'quiet',
    hideHints: 2,
  });
});

test('펫 이름: 공백 정리, 제어 문자 제거, 12자까지, 빈 이름은 안 받는다', () => {
  assert.equal(cleanPetName('  밤  '), '밤');
  assert.equal(cleanPetName('콩\n이'), '콩이');
  assert.equal(cleanPetName('가 나'), '가 나');
  assert.equal(cleanPetName('일이삼사오육칠팔구십일이삼'), '일이삼사오육칠팔구십일이');
  assert.equal(cleanPetName('🐶🐶🐶🐶🐶🐶🐶🐶🐶🐶🐶🐶🐶'), '🐶🐶🐶🐶🐶🐶🐶🐶🐶🐶🐶🐶');
  assert.equal(cleanPetName('   '), undefined);
  assert.equal(cleanPetName(3), undefined);
});

test('바꾸기는 준 값만, 틀린 값은 지금 값을 지킨다', () => {
  const now = { ...DEFAULT_SETTINGS, petName: '밤', chatter: 'chatty' as const };
  assert.deepEqual(applyPatch(now, { wander: false }), { ...now, wander: false });
  assert.deepEqual(applyPatch(now, { petName: '', chatter: 'nope' }), now);
  assert.deepEqual(applyPatch(now, { petName: ' 콩 ' }), { ...now, petName: '콩' });
});

test('사진 펫 파일 이름은 pets 폴더 안 이름만, 비우면 기본 펫', () => {
  assert.equal(parseSettings({ petImage: 'pet-123.png' }).petImage, 'pet-123.png');
  assert.equal(parseSettings({ petImage: '../../etc/passwd' }).petImage, undefined);
  assert.equal(parseSettings({ petImage: '/tmp/pet-1.png' }).petImage, undefined);
  const withPet = { ...DEFAULT_SETTINGS, petImage: 'pet-1.png' };
  assert.equal(applyPatch(withPet, { petImage: null }).petImage, undefined);
  assert.equal(applyPatch(withPet, { petImage: 'x.png' }).petImage, 'pet-1.png');
});
