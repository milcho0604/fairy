import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ProviderView } from '../../../shared/ipc.ts';
import { dotOf, isReady, statusText } from './providerStatus.ts';

const local: ProviderView = {
  id: 'local',
  label: '무료 AI',
  images: false,
  verified: true,
  usage: false,
  custom: false,
  installHint: '',
  command: '',
  ephemeral: false,
};

test('무료 AI 는 모델을 받기 전이면 노란 점과 "받기 전", 받았으면 초록 점과 준비됨', () => {
  const before = { provider: 'local', installed: true, needsModel: true };
  assert.equal(dotOf(before), 'warn');
  assert.match(statusText(local, before), /받기 전/);
  // 받기 전이어도 고를 수는 있다 (물으면 받기 단추가 나온다). 다시 확인하라는 띠는 띄우지 않는다
  assert.equal(isReady(before), true);
  const after = { provider: 'local', installed: true, needsModel: false };
  assert.equal(dotOf(after), 'ok');
  assert.match(statusText(local, after), /준비됨/);
});

test('다른 AI 의 점은 그대로: 없음 빨강, 로그인 필요 노랑, 로그인 모름 옅은 초록', () => {
  assert.equal(dotOf({ provider: 'claude', installed: false }), 'off');
  assert.equal(dotOf({ provider: 'claude', installed: true, loggedIn: false }), 'warn');
  assert.equal(dotOf({ provider: 'claude', installed: true, loggedIn: true }), 'ok');
  assert.equal(dotOf({ provider: 'gemini', installed: true }), 'maybe');
});
