import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type DisplayLike, displaySignature, settleDisplayChanges, type Timers } from './display-change.ts';

// 2026-10-08 실측한 맥북 내장 화면 (몰아 온 알림 38번 내내 이 값 그대로였다)
const macbook: DisplayLike = {
  id: 1,
  bounds: { x: 0, y: 0, width: 1512, height: 982 },
  workArea: { x: 0, y: 33, width: 1512, height: 949 },
  scaleFactor: 2,
  rotation: 0,
};
const external: DisplayLike = {
  id: 2,
  bounds: { x: 1512, y: 0, width: 1920, height: 1080 },
  workArea: { x: 1512, y: 30, width: 1920, height: 1050 },
  scaleFactor: 1,
  rotation: 0,
};

test('같은 배치는 순서가 달라도 같은 글자다', () => {
  assert.equal(displaySignature([macbook, external]), displaySignature([external, macbook]));
});

test('작업 영역, 크기, 배율, 회전, 개수가 바뀌면 글자가 달라진다', () => {
  const base = displaySignature([macbook]);
  const dockUp = { ...macbook, workArea: { ...macbook.workArea, height: 900 } };
  assert.notEqual(displaySignature([dockUp]), base);
  assert.notEqual(displaySignature([{ ...macbook, bounds: { ...macbook.bounds, width: 1800 } }]), base);
  assert.notEqual(displaySignature([{ ...macbook, scaleFactor: 1 }]), base);
  assert.notEqual(displaySignature([{ ...macbook, rotation: 90 }]), base);
  assert.notEqual(displaySignature([macbook, external]), base);
});

/** 손으로 돌리는 시계 */
function fakeTimers() {
  let now = 0;
  let seq = 0;
  const jobs = new Map<number, { at: number; fn: () => void }>();
  const timers: Timers = {
    set: (fn, ms) => {
      jobs.set(++seq, { at: now + ms, fn });
      return seq;
    },
    clear: (h) => {
      jobs.delete(h as number);
    },
  };
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      const next = [...jobs.entries()].filter(([, j]) => j.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      jobs.delete(next[0]);
      now = next[1].at;
      next[1].fn();
    }
    now = end;
  };
  return { timers, advance, pending: () => jobs.size };
}

function setup(initial: DisplayLike[]) {
  let displays = initial;
  let reads = 0;
  const calls: DisplayLike[][] = [];
  const clock = fakeTimers();
  const watch = settleDisplayChanges({
    read: () => {
      reads++;
      return displays;
    },
    key: displaySignature,
    onChange: (d) => calls.push(d),
    ms: 250,
    timers: clock.timers,
  });
  return {
    watch,
    clock,
    calls,
    reads: () => reads,
    set: (d: DisplayLike[]) => {
      displays = d;
    },
  };
}

test('값이 그대로인 알림 묶음(90ms 간격 16번)은 한 번도 부르지 않고 화면도 한 번만 읽는다', () => {
  const s = setup([macbook]);
  const before = s.reads();
  for (let i = 0; i < 16; i++) {
    s.watch.notify();
    s.clock.advance(90);
  }
  s.clock.advance(1000);
  assert.equal(s.calls.length, 0);
  assert.equal(s.reads() - before, 1);
});

test('독이 올라오며 작업 영역이 여러 번 바뀌어도 잦아든 뒤 마지막 값으로 한 번만 부른다', () => {
  const s = setup([macbook]);
  for (let h = 940; h >= 880; h -= 10) {
    s.set([{ ...macbook, workArea: { ...macbook.workArea, height: h } }]);
    s.watch.notify();
    s.clock.advance(90);
  }
  assert.equal(s.calls.length, 0, '아직 잦아들지 않았다');
  s.clock.advance(250);
  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0]?.[0]?.workArea.height, 880);
});

test('바뀐 뒤 다시 같은 값 알림이 오면 또 부르지 않는다. 원래대로 돌아가면 부른다', () => {
  const s = setup([macbook]);
  s.set([macbook, external]);
  s.watch.notify();
  s.clock.advance(300);
  s.watch.notify();
  s.clock.advance(300);
  assert.equal(s.calls.length, 1);
  s.set([macbook]);
  s.watch.notify();
  s.clock.advance(300);
  assert.equal(s.calls.length, 2);
});

test('stop 뒤에는 기다리던 것도 부르지 않는다', () => {
  const s = setup([macbook]);
  s.set([macbook, external]);
  s.watch.notify();
  s.watch.stop();
  s.watch.notify();
  s.clock.advance(1000);
  assert.equal(s.calls.length, 0);
  assert.equal(s.clock.pending(), 0);
});
