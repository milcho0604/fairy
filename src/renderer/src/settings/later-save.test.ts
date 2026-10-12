import assert from 'node:assert/strict';
import { test } from 'node:test';
import { laterSave } from './later-save.ts';

/** 손으로 돌리는 타이머 */
function fakeTimers() {
  const list = new Map<number, () => void>();
  let id = 0;
  return {
    set: (fn: () => void) => {
      list.set(++id, fn);
      return id;
    },
    clear: (k: unknown) => void list.delete(k as number),
    fire() {
      for (const [k, fn] of [...list]) {
        list.delete(k);
        fn();
      }
    },
    get size() {
      return list.size;
    },
  };
}

test('잠깐 멈추면 저장: 마지막 값 하나만', () => {
  const saved: string[] = [];
  const timers = fakeTimers();
  const s = laterSave((v: string) => saved.push(v), 500, timers);
  s.later('냥');
  s.later('냥냥');
  assert.equal(timers.size, 1);
  assert.equal(s.pending, true);
  timers.fire();
  assert.deepEqual(saved, ['냥냥']);
  assert.equal(s.pending, false);
});

test('기다리는 사이 창을 닫으면(flush) 쓴 글을 바로 저장하고 두 번 저장하지 않는다', () => {
  const saved: string[] = [];
  const timers = fakeTimers();
  const s = laterSave((v: string) => saved.push(v), 500, timers);
  s.later('냥');
  s.flush();
  assert.deepEqual(saved, ['냥']);
  assert.equal(timers.size, 0);
  s.flush();
  timers.fire();
  assert.deepEqual(saved, ['냥']);
});

test('바로 저장(고르기)은 기다리던 글을 버린다 (더 새 값)', () => {
  const saved: string[] = [];
  const timers = fakeTimers();
  const s = laterSave((v: string) => saved.push(v), 500, timers);
  s.later('옛 글');
  s.now('새 값');
  s.flush();
  timers.fire();
  assert.deepEqual(saved, ['새 값']);
});
