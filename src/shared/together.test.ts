import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  keyLike,
  nextTyping,
  sameTogether,
  TYPING,
  TYPING_IDLE,
  type TypingSample,
  type TypingState,
  typingPollMs,
  typingWanted,
  workingNow,
} from './together.ts';

/** 표본을 차례로 넣어 상태들을 돌려준다 */
function run(samples: TypingSample[], from: TypingState = TYPING_IDLE): TypingState[] {
  const out: TypingState[] = [];
  let s = from;
  for (const x of samples) {
    s = nextTyping(s, x);
    out.push(s);
  }
  return out;
}
const key = (at: number): TypingSample => ({ at, idleSec: 0, cursorMoved: false });
const mouse = (at: number): TypingSample => ({ at, idleSec: 0, cursorMoved: true });
const quiet = (at: number, idleSec = 2): TypingSample => ({ at, idleSec, cursorMoved: false });

test('키보드 같은 입력: 방금 입력이 있었고 커서는 그대로일 때만', () => {
  assert.equal(keyLike(key(0)), true);
  assert.equal(keyLike(mouse(0)), false);
  assert.equal(keyLike(quiet(0, 1)), false);
});

test('키보드 같은 입력이 1.5초(세 번) 이어져야 시작한다: 키 한 번, 클릭 한 번으로는 안 한다', () => {
  const p = TYPING.pollMs;
  const states = run([key(0), key(p), key(2 * p)]);
  assert.deepEqual(
    states.map((s) => s.active),
    [false, false, true],
  );
  // 한 번 치고 쉬면 시작하지 않는다
  assert.equal(run([key(0), quiet(p), key(2 * p), quiet(3 * p)]).at(-1)?.active, false);
});

test('마지막 키에서 1.5초 지나면 그친다 (바로 그치지 않아 잠깐 멈춰 생각해도 이어진다)', () => {
  const p = TYPING.pollMs;
  const on = run([key(0), key(p), key(2 * p)]).at(-1) as TypingState;
  assert.equal(on.active, true);
  const after = run([quiet(3 * p), quiet(4 * p)], on);
  assert.equal(after.at(-1)?.active, true, '1초 쉼은 아직 치는 중');
  const later = run([quiet(2 * p + TYPING.stopMs)], after.at(-1));
  assert.equal(later.at(-1)?.active, false);
});

test('치다가 마우스만 움직이면 이어진 수는 끊기지만 1.5초 안이면 계속 친다', () => {
  const p = TYPING.pollMs;
  const on = run([key(0), key(p), key(2 * p)]).at(-1) as TypingState;
  const moved = nextTyping(on, mouse(3 * p));
  assert.equal(moved.active, true);
  assert.equal(moved.run, 0);
  // 마우스만 계속 쓰면 결국 그친다 (마우스 쓰기는 타자가 아니다)
  assert.equal(nextTyping(moved, mouse(2 * p + TYPING.stopMs)).active, false);
});

test('입력 시각이 늘 0 인 운영체제(쉬는 틈이 10분 넘게 없음)면 그친다. 틈이 보이면 다시 된다', () => {
  const p = TYPING.pollMs;
  let s: TypingState = TYPING_IDLE;
  for (let at = 0; at < TYPING.brokenAfterMs - p; at += p) s = nextTyping(s, key(at));
  assert.equal(s.active, true, '10분 안은 친다');
  s = nextTyping(s, key(TYPING.brokenAfterMs + p));
  assert.equal(s.active, false);
  s = nextTyping(s, key(TYPING.brokenAfterMs + 2 * p));
  assert.equal(s.active, false, '틈이 보일 때까지 쉰다');
  const back = run(
    [quiet(TYPING.brokenAfterMs + 3 * p), ...[4, 5, 6].map((i) => key(TYPING.brokenAfterMs + i * p))],
    s,
  );
  assert.equal(back.at(-1)?.active, true);
});

test('마우스만 쓰면 시작하지 않는다', () => {
  const p = TYPING.pollMs;
  assert.equal(run([mouse(0), mouse(p), mouse(2 * p), mouse(3 * p)]).at(-1)?.active, false);
});

test('손을 안 댄 지 오래면 느슨히 본다 (1초에 두 번 넘게 보지 않는다)', () => {
  assert.equal(typingPollMs(0), TYPING.pollMs);
  assert.equal(typingPollMs(60), TYPING.slowPollMs);
  assert.ok(TYPING.pollMs >= 500);
});

test('설정이 꺼졌거나 배터리 절약, 숨김, 집중(잠) 중이면 보지 않는다', () => {
  const ok = { on: true, saver: false, hidden: false, asleep: false };
  assert.equal(typingWanted(ok), true);
  assert.equal(typingWanted({ ...ok, on: false }), false);
  assert.equal(typingWanted({ ...ok, saver: true }), false);
  assert.equal(typingWanted({ ...ok, hidden: true }), false);
  assert.equal(typingWanted({ ...ok, asleep: true }), false);
});

test('같이 일하는 표정: 켠 뒤 새로 부른 것만, 20초 동안', () => {
  assert.equal(workingNow(1000, 1000, 1500), false, '켜기 전 시각');
  assert.equal(workingNow(2000, 1000, 2500), true);
  assert.equal(workingNow(2000, 1000, 2000 + 20_000), false);
  assert.equal(workingNow(undefined, 1000, 1500), false);
});

test('모습이 같은지', () => {
  assert.ok(sameTogether({ typing: true, working: false }, { typing: true, working: false }));
  assert.ok(!sameTogether({ typing: true, working: false, note: 'note' }, { typing: true, working: false }));
});
