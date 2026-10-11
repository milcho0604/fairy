import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ghostAlpha, type PoseKey, shouldBlend } from './pose-blend.ts';

const idle: PoseKey = { mood: 'idle', tap: false, note: false, work: false, trick: '', back: false };
const live = { calm: false, saver: false };

test('키보드 자세에서 바쁨으로 바뀌면 겹쳐 바꾼다 (한 틀에 통째로 바뀌었다)', () => {
  assert.equal(shouldBlend({ ...idle, tap: true }, { ...idle, mood: 'busy' }, live), true);
  assert.equal(shouldBlend(idle, { ...idle, work: true }, live), true);
  assert.equal(shouldBlend({ ...idle, trick: 'dance' }, { ...idle, note: true }, live), true);
  assert.equal(shouldBlend({ ...idle, mood: 'excited' }, idle, live), true);
  assert.equal(shouldBlend({ ...idle, mood: 'grabbed' }, idle, live), true);
});

test('그대로이거나 처음이거나, 잡을 때와 숨김은 바로 바꾼다', () => {
  assert.equal(shouldBlend(undefined, idle, live), false);
  assert.equal(shouldBlend(idle, { ...idle }, live), false);
  assert.equal(shouldBlend(idle, { ...idle, mood: 'grabbed' }, live), false);
  assert.equal(shouldBlend(idle, { ...idle, mood: 'hidden' }, live), false);
  assert.equal(shouldBlend({ ...idle, mood: 'hidden' }, idle, live), false);
});

test('튀기와 몸짓이 시작될 때는 바로 바꾼다 (움직이는 몸끼리 겹치면 테두리가 두 겹)', () => {
  assert.equal(shouldBlend({ ...idle, note: true }, { ...idle, trick: 'dance' }, live), false);
  assert.equal(shouldBlend(idle, { ...idle, mood: 'excited' }, live), false);
  assert.equal(
    shouldBlend({ ...idle, mood: 'excited', trick: 'dance' }, { ...idle, mood: 'excited', note: true }, live),
    false,
  );
});

test('움직임 줄이기와 배터리 절약이면 겹치지 않는다', () => {
  const next = { ...idle, mood: 'busy' as const };
  assert.equal(shouldBlend(idle, next, { calm: true, saver: false }), false);
  assert.equal(shouldBlend(idle, next, { calm: false, saver: true }), false);
});

test('지난 그림은 1 에서 0 으로 끊김 없이 옅어진다', () => {
  assert.equal(ghostAlpha(0), 1);
  assert.equal(ghostAlpha(1), 0);
  let prev = 1;
  for (let t = 0.02; t <= 1; t += 0.02) {
    const a = ghostAlpha(t);
    assert.ok(a <= prev && prev - a < 0.05, `${t}`);
    prev = a;
  }
});
