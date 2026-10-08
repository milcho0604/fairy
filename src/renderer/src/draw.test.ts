import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type DrawState, danceTilt, excitedBounce, gazeOf, trickOf, waveSwing } from './draw.ts';

const base: DrawState = { mood: 'idle', elapsed: 0, blink: -1 };
const gaze = { x: 1, y: 0 };

test('커서 바라보기는 한가한 모습(기본, 앉기)일 때만', () => {
  assert.deepEqual(gazeOf({ ...base, gaze }, undefined), gaze);
  assert.deepEqual(gazeOf({ ...base, gaze }, { type: 'sit' }), gaze);
  assert.equal(gazeOf({ ...base, gaze }, { type: 'walk', dir: 1, phase: 0 }), undefined);
  assert.equal(gazeOf({ ...base, gaze }, { type: 'yawn', t: 0.5 }), undefined);
  for (const mood of [
    'sleeping',
    'dozing',
    'busy',
    'excited',
    'sulky',
    'thinking',
    'talking',
    'grabbed',
  ] as const)
    assert.equal(gazeOf({ ...base, mood, gaze }, undefined), undefined, mood);
  assert.equal(gazeOf(base, undefined), undefined);
});

test('몸짓은 잠, 졸음, 바쁨, 잡힘에서 안 하고, 삐져 있으면 손은 안 흔든다', () => {
  const wave = { type: 'wave' as const, t: 0.5 };
  const dance = { type: 'dance' as const, t: 0.5 };
  assert.deepEqual(trickOf({ ...base, trick: wave }), wave);
  assert.deepEqual(trickOf({ ...base, mood: 'excited', trick: dance }), dance);
  for (const mood of ['sleeping', 'dozing', 'busy', 'grabbed', 'hidden'] as const)
    assert.equal(trickOf({ ...base, mood, trick: dance }), undefined, mood);
  assert.equal(trickOf({ ...base, mood: 'sulky', trick: wave }), undefined);
  assert.deepEqual(trickOf({ ...base, mood: 'sulky', trick: dance }), dance);
});

test('몸짓은 시작과 끝에서 제자리 (튀지 않게), 가운데서 크게', () => {
  assert.ok(Math.abs(waveSwing(0)) < 1e-9);
  assert.ok(Math.abs(waveSwing(1)) < 1e-9);
  assert.ok(Math.abs(danceTilt(0)) < 1e-9);
  assert.ok(Math.abs(danceTilt(1)) < 1e-9);
  let maxSwing = 0;
  let maxTilt = 0;
  for (let i = 0; i <= 100; i++) {
    maxSwing = Math.max(maxSwing, Math.abs(waveSwing(i / 100)));
    maxTilt = Math.max(maxTilt, Math.abs(danceTilt(i / 100)));
  }
  assert.ok(maxSwing > 0.8 && maxSwing <= 1, `${maxSwing}`);
  // 너무 기울면 넘어지는 것처럼 보인다 (0.3 라디안, 약 17도 안)
  assert.ok(maxTilt > 0.15 && maxTilt < 0.3, `${maxTilt}`);
});

test('움직임 줄이기: 빙글 춤은 안 하고 손 흔들기는 한다, 신남은 살짝만 들썩이고 찌그러지지 않는다', () => {
  const wave = { type: 'wave' as const, t: 0.5 };
  const dance = { type: 'dance' as const, t: 0.5 };
  assert.equal(trickOf({ ...base, calm: true, trick: dance }), undefined);
  assert.deepEqual(trickOf({ ...base, calm: true, trick: wave }), wave);
  assert.deepEqual(trickOf({ ...base, trick: dance }), dance);
  assert.equal(Math.round(excitedBounce(300).lift), 18);
  assert.equal(Math.round(excitedBounce(300, true).lift), 3);
  assert.equal(excitedBounce(10).squash, 0.08);
  assert.equal(excitedBounce(10, true).squash, 0);
  for (let e = 0; e < 1200; e += 37) assert.ok(excitedBounce(e, true).lift <= 3);
});
