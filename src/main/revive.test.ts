import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WebContents } from 'electron';
import { reviveOnCrash } from './revive.ts';

function fake() {
  let onGone: ((e: unknown, d: { reason: string; exitCode: number }) => void) | undefined;
  const wc = {
    crashed: false,
    destroyed: false,
    reloads: 0,
    on(_name: string, fn: typeof onGone) {
      onGone = fn;
    },
    isDestroyed() {
      return this.destroyed;
    },
    isCrashed() {
      return this.crashed;
    },
    reload() {
      this.reloads++;
      this.crashed = false;
    },
  };
  const gone = (reason = 'crashed') => {
    wc.crashed = true;
    onGone?.({}, { reason, exitCode: 1 });
  };
  return { wc, gone };
}

test('죽으면 저절로 다시 불러온다', () => {
  const { wc, gone } = fake();
  reviveOnCrash(wc as unknown as WebContents, 'x', () => {});
  gone();
  assert.equal(wc.reloads, 1);
});

test('정상 종료와 이미 파괴된 화면은 건드리지 않는다', () => {
  const { wc, gone } = fake();
  reviveOnCrash(wc as unknown as WebContents, 'x', () => {});
  gone('clean-exit');
  assert.equal(wc.reloads, 0);
  wc.destroyed = true;
  gone();
  assert.equal(wc.reloads, 0);
});

test('짧은 시간에 여러 번 죽으면 멈추고 기록한다, 다시 열면 되살린다', () => {
  const { wc, gone } = fake();
  const lines: unknown[][] = [];
  const revive = reviveOnCrash(wc as unknown as WebContents, 'x', (...r) => lines.push(r));
  for (let i = 0; i < 6; i++) gone();
  assert.equal(wc.reloads, 3);
  assert.equal(lines.length, 6);
  assert.equal(lines[5]?.[4], 'stop');
  assert.equal(wc.crashed, true);
  revive();
  assert.equal(wc.reloads, 4);
  assert.equal(wc.crashed, false);
  // 멀쩡하면 아무것도 하지 않는다
  revive();
  assert.equal(wc.reloads, 4);
});

test('자동으로 살아난 뒤 다시 열어도 세던 것을 지운다', () => {
  const { wc, gone } = fake();
  const revive = reviveOnCrash(wc as unknown as WebContents, 'x', () => {});
  for (let i = 0; i < 3; i++) gone();
  assert.equal(wc.reloads, 3);
  // 멀쩡한 채로 다시 열기: 불러오지 않지만 가드는 풀린다
  revive();
  assert.equal(wc.reloads, 3);
  for (let i = 0; i < 3; i++) gone();
  assert.equal(wc.reloads, 6);
});

test('again 을 주면 reload 대신 그것을 부른다', () => {
  const { wc, gone } = fake();
  const revive = reviveOnCrash(wc as unknown as WebContents, 'x', () => {});
  for (let i = 0; i < 4; i++) gone();
  let called = 0;
  revive(() => {
    called++;
  });
  assert.equal(called, 1);
  assert.equal(wc.reloads, 3);
});
