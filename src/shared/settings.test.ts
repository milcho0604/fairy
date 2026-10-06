import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyPatch, cleanPetName, DEFAULT_SETTINGS, isAnimatedFile, parseSettings } from './settings.ts';

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
  assert.deepEqual(applyPatch(now, { persona: 'polite', aiKnowsTodos: true }), {
    ...now,
    persona: 'polite',
    aiKnowsTodos: true,
  });
  assert.deepEqual(applyPatch(now, { persona: 'evil', aiKnowsTodos: 'yes' }), now);
  assert.deepEqual(applyPatch(now, { restDays: [6, 0, 0, 9, 'x'], petKind: 'cat', spicy: true }), {
    ...now,
    restDays: [0, 6],
    petKind: 'cat',
    spicy: true,
  });
  assert.equal(applyPatch(now, { petKind: 'dragon' }).petKind, 'kong');
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

test('사진 펫과 포즈 파일 이름: 규칙에 맞는 것만, null 은 지우기, 빠진 포즈는 그대로', () => {
  const now = { ...DEFAULT_SETTINGS, petImage: 'pet-a.png', petPoses: { happy: 'pose-h.png' } };
  assert.equal(applyPatch(now, { petImage: 'pet-b.gif' }).petImage, 'pet-b.gif');
  assert.equal(applyPatch(now, { petImage: '../etc/passwd' }).petImage, 'pet-a.png');
  assert.equal(applyPatch(now, { petImage: null }).petImage, undefined);
  assert.deepEqual(applyPatch(now, { petPoses: { sleepy: 'pose-s.webp' } }).petPoses, {
    happy: 'pose-h.png',
    sleepy: 'pose-s.webp',
  });
  assert.deepEqual(applyPatch(now, { petPoses: { happy: null } }).petPoses, {});
  assert.deepEqual(applyPatch(now, { petPoses: { happy: '/tmp/x.png' } }).petPoses, {});
  assert.equal(isAnimatedFile('pet-a.GIF'), true);
  assert.equal(isAnimatedFile('pet-a.png'), false);
});

test('v2 설정: 회고 시각, 단축키(겹치면 거절), 캘린더 주소(https 만), 내 MCP', () => {
  const now = { ...DEFAULT_SETTINGS };
  assert.equal(applyPatch(now, { reviewMinute: 17 * 60 }).reviewMinute, 1020);
  assert.equal(applyPatch(now, { reviewMinute: 2000 }).reviewMinute, now.reviewMinute);
  assert.equal(
    applyPatch(now, { shortcuts: { hide: 'CommandOrControl+Alt+J' } }).shortcuts.hide,
    'CommandOrControl+Alt+J',
  );
  assert.deepEqual(applyPatch(now, { shortcuts: { hide: now.shortcuts.quickAdd } }).shortcuts, now.shortcuts);
  assert.deepEqual(applyPatch(now, { shortcuts: { hide: 'rm -rf' } }).shortcuts, now.shortcuts);
  assert.equal(
    applyPatch(now, { icsUrl: ' https://calendar.google.com/x.ics ' }).icsUrl,
    'https://calendar.google.com/x.ics',
  );
  assert.equal(applyPatch(now, { icsUrl: 'http://x/a.ics' }).icsUrl, undefined);
  const withIcs = applyPatch(now, { icsUrl: 'https://a/b.ics' });
  assert.equal(applyPatch(withIcs, { icsUrl: null }).icsUrl, undefined);
  assert.equal(applyPatch(now, { myMcp: true }).myMcp, true);
});

test('친구 펫: 규칙에 맞는 것만, 같은 id 는 한 번, 3마리까지', () => {
  const now = { ...DEFAULT_SETTINGS };
  const r = applyPatch(now, {
    friends: [
      { id: 'f-1', name: '  밤 ', kind: 'cat' },
      { id: 'f-1', name: '중복', kind: 'cat' },
      { id: '../x', name: '나쁨', kind: 'cat' },
      { id: 'f-2', name: '', kind: 'cat' },
      { id: 'f-3', name: '삐', kind: 'dragon', image: '/etc/x.png' },
      { id: 'f-4', name: '넷', kind: 'chick', image: 'pet-a.png' },
      { id: 'f-5', name: '다섯', kind: 'kong' },
    ],
  });
  assert.deepEqual(r.friends, [
    { id: 'f-1', name: '밤', kind: 'cat' },
    { id: 'f-3', name: '삐', kind: 'kong' },
    { id: 'f-4', name: '넷', kind: 'chick', image: 'pet-a.png' },
  ]);
});
