import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DOCK_GAP_MS,
  DOCK_RETRY_MAX,
  type DockEffect,
  type DockEnv,
  type DockEvent,
  type DockState,
  dockStep,
  initialDock,
} from './dock-policy.ts';

const MAC: DockEnv = { platform: 'darwin', test: false };

/** 사건을 차례로 먹이고 마지막 상태와 모든 할 일을 모은다 */
function play(steps: Array<[DockEvent, number]>, env: DockEnv = MAC, from: DockState = initialDock()) {
  let state = from;
  const log: Array<{ at: number; ev: DockEvent; effects: DockEffect[] }> = [];
  for (const [ev, at] of steps) {
    const r = dockStep(state, ev, at, env);
    state = r.state;
    log.push({ at, ev, effects: r.effects });
  }
  const calls = log.flatMap((l) => l.effects.map((e) => e.do));
  return { state, log, calls };
}

test('열기: 맥이면 show 를 한 번 부른다', () => {
  const r = play([['open', 0]]);
  assert.deepEqual(r.calls, ['show']);
  assert.equal(r.state.want, true);
  assert.equal(r.state.shown, true);
});

test('이미 보이는 동안 다시 열어도(앞으로 가져오기) show 를 또 부르지 않는다', () => {
  const r = play([
    ['open', 0],
    ['open', 3000],
    ['open', 9000],
  ]);
  assert.deepEqual(r.calls, ['show']);
});

test('닫기: 열린 지 1.1초가 지났으면 바로 hide', () => {
  const r = play([
    ['open', 0],
    ['close', DOCK_GAP_MS],
  ]);
  assert.deepEqual(r.calls, ['show', 'hide']);
  assert.equal(r.state.shown, false);
  assert.equal(r.state.want, false);
});

test('닫기: 열자마자(1초 안) 닫으면 hide 를 미루고 간격이 찰 때 tick 으로 숨긴다 (Electron 이 1초 안의 hide 를 무시한다)', () => {
  const r = play([
    ['open', 0],
    ['close', 300],
  ]);
  assert.deepEqual(r.calls, ['show', 'wait']);
  const wait = r.log[1]?.effects[0];
  assert.equal(wait?.do, 'wait');
  // 기다리는 시간이 지나면 정확히 간격이 찬다
  assert.ok(wait?.do === 'wait' && 300 + wait.ms >= DOCK_GAP_MS);
  assert.equal(r.state.pendingHide, true);
  assert.equal(r.state.shown, true, '아직 숨기지 않았다');
  const t = dockStep(r.state, 'tick', 300 + (wait?.do === 'wait' ? wait.ms : 0), MAC);
  assert.deepEqual(
    t.effects.map((e) => e.do),
    ['hide'],
  );
  assert.equal(t.state.shown, false);
  assert.equal(t.state.pendingHide, false);
});

test('기다리다 틱이 일러도(간격이 모자라) hide 를 부르지 않고 더 기다린다', () => {
  const r = play([
    ['open', 0],
    ['close', 100],
    ['tick', 500],
  ]);
  assert.deepEqual(r.calls, ['show', 'wait', 'wait']);
});

test('빠르게 열고 닫기를 되풀이: show 는 한 번, 기다리던 hide 는 다시 열면 취소, 마지막에 한 번만 hide', () => {
  const r = play([
    ['open', 0],
    ['close', 200],
    ['open', 500],
    ['close', 700],
    ['open', 800],
    ['close', 900],
    ['tick', 1200],
  ]);
  assert.deepEqual(r.calls.filter((c) => c === 'show').length, 1);
  assert.equal(r.calls.filter((c) => c === 'hide').length, 1, '마지막 틱에서만 hide');
  assert.equal(r.state.shown, false);
  // 틱 시각(1200)은 처음 show(0) 로부터 1.1초가 지난 뒤다
  assert.deepEqual(
    r.log.at(-1)?.effects.map((e) => e.do),
    ['hide'],
  );
});

test('열려 있는 동안 늦게 온 틱은 아무것도 하지 않는다 (다시 열어 취소됐다)', () => {
  const r = play([
    ['open', 0],
    ['close', 200],
    ['open', 400],
    ['tick', 1300],
  ]);
  assert.deepEqual(r.calls, ['show', 'wait']);
  assert.equal(r.state.shown, true);
  assert.equal(r.state.pendingHide, false);
});

test('hide 뒤 바로 다시 열면 show 를 부른다 (보이지 않는 동안)', () => {
  const r = play([
    ['open', 0],
    ['close', 2000],
    ['open', 2100],
  ]);
  assert.deepEqual(r.calls, ['show', 'hide', 'show']);
  assert.equal(r.state.shown, true);
});

test('hide 한 뒤 닫기를 또 받아도(창이 사라지며 한 번 더) 아무 일도 없다', () => {
  const r = play([
    ['open', 0],
    ['close', 2000],
    ['close', 2010],
  ]);
  assert.deepEqual(r.calls, ['show', 'hide']);
});

test('숨겼는데 아이콘이 남아 있으면(seen-visible) 다시 hide, 상한 3번까지', () => {
  let state = play([
    ['open', 0],
    ['close', 2000],
  ]).state;
  const calls: string[] = [];
  let at = 2000;
  for (let i = 0; i < DOCK_RETRY_MAX + 2; i++) {
    at += DOCK_GAP_MS + 10;
    const r = dockStep(state, 'seen-visible', at, MAC);
    state = r.state;
    calls.push(...r.effects.map((e) => e.do));
  }
  assert.equal(calls.filter((c) => c === 'hide').length, DOCK_RETRY_MAX);
});

test('아이콘이 남아 보여도 큰 창이 열려 있으면 정상이다', () => {
  const open = play([['open', 0]]).state;
  const r = dockStep(open, 'seen-visible', 5000, MAC);
  assert.deepEqual(r.effects, []);
  assert.equal(r.state.shown, true);
});

test('다시 열면 재시도 횟수가 처음부터', () => {
  const closed = play([
    ['open', 0],
    ['close', 2000],
  ]).state;
  const once = dockStep(closed, 'seen-visible', 4000, MAC).state;
  assert.equal(once.retries, 1);
  const reopened = dockStep(once, 'open', 5000, MAC).state;
  assert.equal(reopened.retries, 0);
});

test('앱이 끝나는 중이면 더는 건드리지 않는다', () => {
  const r = play([
    ['open', 0],
    ['quit', 500],
    ['close', 600],
    ['open', 700],
    ['tick', 5000],
    ['seen-visible', 6000],
  ]);
  assert.deepEqual(r.calls, ['show']);
  assert.equal(r.state.quitting, true);
  assert.equal(r.state.want, false);
});

test('끝나는 중에 기다리던 hide 는 사라진다', () => {
  const r = play([
    ['open', 0],
    ['close', 100],
    ['quit', 200],
    ['tick', 2000],
  ]);
  assert.deepEqual(r.calls, ['show', 'wait']);
  assert.equal(r.state.pendingHide, false);
});

test('시험 모드: show 를 절대 부르지 않고 부르려 한 횟수만 센다', () => {
  const env: DockEnv = { platform: 'darwin', test: true };
  const r = play(
    [
      ['open', 0],
      ['open', 100],
      ['close', 5000],
      ['open', 6000],
      ['tick', 9000],
      ['seen-visible', 9100],
    ],
    env,
  );
  assert.deepEqual(r.calls, [], 'show, hide, wait 어느 것도 없다');
  assert.equal(r.state.triedShow, 3);
  assert.equal(r.state.shown, false);
});

test('맥이 아니면 아무것도 하지 않는다 (윈도우, 리눅스는 작업 표시줄)', () => {
  for (const platform of ['win32', 'linux'] as const) {
    const r = play(
      [
        ['open', 0],
        ['close', 100],
        ['tick', 5000],
        ['seen-visible', 6000],
      ],
      { platform, test: false },
    );
    assert.deepEqual(r.calls, []);
    assert.equal(r.state.triedShow, 0);
  }
});

test('상태를 바꾸지 않는다 (순수 함수)', () => {
  const s = initialDock();
  const frozen = JSON.stringify(s);
  dockStep(s, 'open', 10, MAC);
  dockStep(s, 'close', 10, MAC);
  assert.equal(JSON.stringify(s), frozen);
});

test('검출력: 열자마자 닫는 경우 hide 가 즉시 나가면 안 된다 (간격 규칙을 없애면 이 시험이 깨진다)', () => {
  const r = play([
    ['open', 0],
    ['close', DOCK_GAP_MS - 1],
  ]);
  assert.equal(r.calls.includes('hide'), false);
  const late = play([
    ['open', 0],
    ['close', DOCK_GAP_MS],
  ]);
  assert.equal(late.calls.includes('hide'), true);
});

// ---- 설정 dockIcon (pin, unpin) ----
const TEST: DockEnv = { platform: 'darwin', test: true };

test('설정 켬(pin): 큰 창이 없어도 show 를 한 번 부르고, 큰 창을 열고 닫아도 숨기지 않는다', () => {
  const r = play([
    ['pin', 0],
    ['open', 5000],
    ['close', 9000],
    ['tick', 12000],
  ]);
  assert.deepEqual(r.calls, ['show']);
  assert.equal(r.state.want, true);
  assert.equal(r.state.shown, true);
});

test('설정 끔(unpin) x 큰 창 닫힘: 간격이 찬 뒤 hide', () => {
  const r = play([
    ['pin', 0],
    ['unpin', DOCK_GAP_MS],
  ]);
  assert.deepEqual(r.calls, ['show', 'hide']);
  assert.equal(r.state.want, false);
});

test('설정 끔(unpin) x 큰 창 열림: 아이콘은 큰 창이 닫힐 때까지 남고 닫으면 숨는다', () => {
  const r = play([
    ['pin', 0],
    ['open', 1000],
    ['unpin', 3000],
  ]);
  assert.deepEqual(r.calls, ['show']);
  assert.equal(r.state.want, true);
  const c = dockStep(r.state, 'close', 6000, MAC);
  assert.deepEqual(
    c.effects.map((e) => e.do),
    ['hide'],
  );
});

test('설정 끔 x 큰 창 닫힘 x 처음부터: 켜 둔 적 없으면 아무 일도 없다 (기존 동작 그대로)', () => {
  const r = play([['unpin', 0]]);
  assert.deepEqual(r.calls, []);
  assert.equal(r.state.want, false);
});

test('설정 켬 직후 곧 끔(1초 안): hide 는 간격이 찰 때까지 미룬다', () => {
  const r = play([
    ['pin', 0],
    ['unpin', 200],
  ]);
  assert.deepEqual(r.calls, ['show', 'wait']);
  assert.equal(r.state.pendingHide, true);
});

test('설정 켬 -> 끔 -> 켬: 기다리던 hide 는 취소되고 show 는 다시 부르지 않는다', () => {
  const r = play([
    ['pin', 0],
    ['unpin', 200],
    ['pin', 400],
  ]);
  assert.deepEqual(r.calls, ['show', 'wait']);
  assert.equal(r.state.pendingHide, false);
  assert.equal(r.state.want, true);
});

test('시험 모드: 설정이 켜져 있어도 show 는 0, 부르려 했다만 센다 (끄고 큰 창 열고 닫아도 hide 0)', () => {
  const r = play(
    [
      ['pin', 0],
      ['open', 100],
      ['close', 5000],
      ['unpin', 9000],
    ],
    TEST,
  );
  assert.deepEqual(r.calls, []);
  assert.equal(r.state.triedShow, 2);
  assert.equal(r.state.shown, false);
});

test('맥이 아니면 pin 도 아무것도 하지 않는다', () => {
  const r = play([['pin', 0]], { platform: 'win32', test: false });
  assert.deepEqual(r.calls, []);
});

test('검출력: 설정이 켜져 있는데 큰 창이 닫혀 hide 가 나가면 안 된다 (pinned 를 want 에 넣지 않으면 깨진다)', () => {
  const r = play([
    ['pin', 0],
    ['open', 100],
    ['close', 4000],
  ]);
  assert.ok(!r.calls.includes('hide'));
});
