import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CAPABILITIES, CAPABILITY_IDS, detectState, isUsable } from './capability.ts';
import { BUILTIN_PROVIDERS } from './providers.ts';

test('감지 결과 해석: 없음, 로그인 필요, 찾음, 로그인은 모름', () => {
  assert.equal(detectState('claude', undefined), 'missing');
  assert.equal(detectState('claude', { provider: 'claude', installed: false }), 'missing');
  assert.equal(detectState('claude', { provider: 'claude', installed: true, loggedIn: false }), 'login');
  assert.equal(detectState('claude', { provider: 'claude', installed: true, loggedIn: true }), 'found');
  // 로그인을 확인할 방법이 없는 AI (Gemini CLI)
  assert.equal(detectState('gemini', { provider: 'gemini', installed: true }), 'found-unchecked');
  // 설치 안 됐으면 로그인 값이 있어도 없음
  assert.equal(detectState('codex', { provider: 'codex', installed: false, loggedIn: true }), 'missing');
});

test('내 컴퓨터 AI 는 모델을 받았는지로 본다', () => {
  assert.equal(detectState('local', { provider: 'local', installed: true }), 'found');
  assert.equal(detectState('local', { provider: 'local', installed: true, needsModel: true }), 'missing');
});

test('쓸 수 있는 상태: 찾았거나 로그인은 모를 때', () => {
  assert.deepEqual((['found', 'found-unchecked', 'login', 'missing'] as const).map(isUsable), [
    true,
    true,
    false,
    false,
  ]);
});

test('능력표는 실제 어댑터와 맞는다: 그림은 spec.images, 페어리 도구는 claude 와 codex 만', () => {
  for (const id of CAPABILITY_IDS) {
    const spec = BUILTIN_PROVIDERS.find((p) => p.id === id);
    assert.ok(spec, id);
    const cap = CAPABILITIES[id];
    assert.equal(cap.vision, spec.images, `${id} 화면 보기`);
    assert.equal(cap.mcp, spec.adapter === 'claude' || spec.adapter === 'codex', `${id} 페어리 도구`);
    assert.equal(cap.verified, spec.verified, `${id} 확인 여부`);
    // 내 컴퓨터 AI 만 도구가 아예 없다. 나머지는 읽기 전용을 강제한다
    assert.equal(cap.readOnly, id === 'local' ? 'none' : 'enforced', id);
    assert.equal(cap.cost, id === 'local' ? 'free' : 'subscription', id);
  }
});
