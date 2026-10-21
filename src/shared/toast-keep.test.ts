import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type KeptToast,
  liveToasts,
  parseToasts,
  splitToasts,
  TOAST_KEEP_MAX,
  undoable,
} from './toast-keep.ts';

const NOW = 1_000_000;
const item = (key: number, until: number, kind = 'todo-removed'): unknown => ({
  key,
  at: NOW - 1000,
  until,
  toast: kind === 'added' ? { kind, text: '넣었어' } : { kind, id: key },
});

test('남은 시간이 있는 알림만 돌려받는다', () => {
  const got = parseToasts([item(1, NOW + 5000), item(2, NOW - 1), item(3, NOW)], NOW);
  assert.deepEqual(
    got.map((k) => k.key),
    [1],
  );
});

test('모양이 틀린 알림은 버린다', () => {
  const bad = [
    null,
    'x',
    { key: '1', at: 1, until: NOW + 5000, toast: { kind: 'done', id: 1, coins: 2 } },
    { key: 1, at: 1, until: NOW + 5000, toast: { kind: 'nope' } },
    { key: 1, at: 1, until: NOW + 5000, toast: null },
    { key: 1.5, at: 1, until: NOW + 5000, toast: { kind: 'done' } },
    { key: 1, at: Number.NaN, until: NOW + 5000, toast: { kind: 'done' } },
  ];
  assert.deepEqual(parseToasts(bad, NOW), []);
  assert.deepEqual(parseToasts('x', NOW), []);
  assert.deepEqual(parseToasts(undefined, NOW), []);
});

test('최근 여덟 개까지만, 너무 먼 미래 시각은 5분으로 줄인다', () => {
  const many = Array.from({ length: 20 }, (_, i) => item(i, NOW + 5000));
  const got = parseToasts(many, NOW);
  assert.equal(got.length, TOAST_KEEP_MAX);
  assert.equal(got[0]?.key, 20 - TOAST_KEEP_MAX);
  assert.equal(parseToasts([item(1, NOW + 10 ** 12)], NOW)[0]?.until, NOW + 5 * 60_000);
});

test('아주 큰 알림은 버린다', () => {
  const big = { key: 1, at: 1, until: NOW + 5000, toast: { kind: 'added', text: 'ㄱ'.repeat(30_000) } };
  assert.deepEqual(parseToasts([big], NOW), []);
});

test('liveToasts 와 undoable', () => {
  const list = parseToasts([item(1, NOW + 10), item(2, NOW + 20, 'added'), item(3, NOW + 30, 'done')], NOW);
  assert.equal(liveToasts(list, NOW + 15).length, 2);
  assert.deepEqual(
    undoable(list).map((k) => k.key),
    [1, 3],
  );
});

test('세 개까지는 펼치고 넘으면 오래된 것을 합친다', () => {
  const list = parseToasts(
    Array.from({ length: 5 }, (_, i) => item(i, NOW + 5000)),
    NOW,
  ) as KeptToast[];
  const two = splitToasts(list.slice(0, 2));
  assert.equal(two.folded.length, 0);
  assert.equal(two.shown.length, 2);
  const five = splitToasts(list);
  assert.deepEqual(
    five.folded.map((k) => k.key),
    [0, 1],
  );
  assert.deepEqual(
    five.shown.map((k) => k.key),
    [2, 3, 4],
  );
});
