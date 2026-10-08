import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bounced, restingEye } from './pet3d-motion.ts';

test('쉬는 눈 모양은 뜬 눈 자리에만, 없으면 지금 눈 그대로', () => {
  assert.equal(restingEye('open', undefined), 'open');
  assert.equal(restingEye('open', 'round'), 'open');
  assert.equal(restingEye('open', 'sparkle'), 'open');
  assert.equal(restingEye('open', 'happy'), 'up');
  assert.equal(restingEye('open', 'sleepy'), 'drowsy');
  // 잠, 잡힘 같은 상태 표정은 눈 모양이 덮지 않는다
  assert.equal(restingEye('down', 'happy'), 'down');
  assert.equal(restingEye('chevron', 'sleepy'), 'chevron');
});

test('통통 튀는 세기는 신남과 걷기에만 곱한다', () => {
  // 기본값 1 이면 그대로
  assert.deepEqual(bounced({ mood: 'excited' }, undefined, 1, 18, 1.08, 0.92), {
    lift: 18,
    sx: 1.08,
    sy: 0.92,
  });
  // 얌전하게: 덜 뛰고 덜 찌그러진다
  const calm = bounced({ mood: 'excited' }, undefined, 0.5, 18, 1.08, 0.92);
  assert.equal(calm.lift, 9);
  assert.ok(Math.abs(calm.sx - 1.04) < 1e-9 && Math.abs(calm.sy - 0.96) < 1e-9);
  // 통통 튀게: 더 높이, 찌그러짐은 기본보다 키우지 않는다
  assert.deepEqual(bounced({ mood: 'excited' }, undefined, 1.5, 18, 1.08, 0.92), {
    lift: 27,
    sx: 1.08,
    sy: 0.92,
  });
  assert.equal(bounced({ mood: 'idle' }, { type: 'walk', dir: 1, phase: 0.25 }, 0, 3, 1, 1).lift, 0);
  // 잡힘(올린 몸), 앉기(찌그러진 자세)는 그대로
  assert.deepEqual(bounced({ mood: 'grabbed' }, undefined, 0, 6, 0.94, 1.08), {
    lift: 6,
    sx: 0.94,
    sy: 1.08,
  });
  assert.deepEqual(bounced({ mood: 'idle' }, { type: 'sit' }, 0, 0, 1.06, 0.9), {
    lift: 0,
    sx: 1.06,
    sy: 0.9,
  });
});
