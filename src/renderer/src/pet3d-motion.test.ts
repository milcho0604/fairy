import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bounced, faceDepth, keepsFaceDepth, restingEye } from './pet3d-motion.ts';

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

test('기운: 둥근 눈만 지침은 눈꺼풀(heavy), 졸림은 감기 직전 눈(‿). 설계도 눈 모양과 상태 표정이 먼저', () => {
  assert.equal(restingEye('open', 'round', 'tired'), 'heavy');
  assert.equal(restingEye('open', undefined, 'sleepy'), 'drowsy');
  assert.equal(restingEye('open', 'sparkle', 'lively'), 'open');
  assert.equal(restingEye('open', 'round', 'normal'), 'open');
  assert.equal(restingEye('open', 'happy', 'sleepy'), 'up');
  assert.equal(restingEye('open', 'sleepy', 'tired'), 'drowsy');
  assert.equal(restingEye('up', 'round', 'sleepy'), 'up');
  assert.equal(restingEye('down', undefined, 'tired'), 'down');
});

test('얼굴 두께: 정면 가까이는 그대로, 비스듬할수록 납작하게, 지킬 부품은 그대로', () => {
  assert.equal(faceDepth(1, false), 1);
  assert.equal(faceDepth(0.75, false), 1);
  assert.equal(faceDepth(0.25, false), 0.2);
  assert.equal(faceDepth(0, false), 0.2);
  const mid = faceDepth(0.5, false);
  assert.ok(mid > 0.2 && mid < 1);
  assert.equal(faceDepth(0.1, true), 1);
});

test('솟은 것(코, 부리, 볼 털)과 네 발로 선 몸의 얼굴은 납작하게 하지 않는다, 두 발 몸의 눈과 입은 납작하게', () => {
  const part = { nose: false, beak: false, tuft: false, stance: false };
  assert.equal(keepsFaceDepth(part), false);
  assert.equal(keepsFaceDepth({ ...part, stance: true }), true);
  assert.equal(keepsFaceDepth({ ...part, tuft: true }), true);
  assert.equal(keepsFaceDepth({ ...part, nose: true }), true);
  assert.equal(keepsFaceDepth({ ...part, beak: true }), true);
});
