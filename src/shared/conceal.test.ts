import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Conceal, type ConcealReason } from './conceal.ts';

/** 창 하나를 흉내 낸다. 되돌리기는 바로 끝나는 것으로 본다 (fade: false 면 중간에 멈춘 채로 둔다) */
function fakeWin(start = 1) {
  const c = new Conceal();
  const w = { opacity: start };
  const set = (reason: ConcealReason, on: boolean, fade = true) => {
    const step = c.set(reason, on, () => w.opacity);
    if (!step) return;
    if (step.kind === 'hide') w.opacity = 0;
    else if (fade) {
      w.opacity = step.to;
      c.settled();
    } else w.opacity = step.to * 0.4; // 차오르는 도중
  };
  return { c, w, set };
}

test('솟은 때 가림: 같이 보기가 먼저 가리고 두더지가 들어갔다 나와도 원래대로', () => {
  const { w, set } = fakeWin(1);
  set('veil', true);
  assert.equal(w.opacity, 0);
  set('mole', true); // 같이 보는 사이 구멍으로 쏙
  assert.equal(w.opacity, 0);
  set('veil', false); // 찍고 나서: 아직 구멍 속이라 그대로 안 보인다
  assert.equal(w.opacity, 0);
  set('mole', false); // 솟는다
  assert.equal(w.opacity, 1);
});

test('들어간 때 가림: 구멍 속에서 같이 보기가 가렸다 풀려도 원래대로', () => {
  const { w, set } = fakeWin(1);
  set('mole', true);
  set('veil', true);
  assert.equal(w.opacity, 0);
  set('mole', false); // 같이 보는 사이 솟는다: 찍는 중이라 아직 안 보인다
  assert.equal(w.opacity, 0);
  set('veil', false);
  assert.equal(w.opacity, 1);
});

test('엇갈린 순서도 (예전 버그: 서로의 0 을 원래 값으로 잡았다)', () => {
  for (const [a, b] of [
    ['mole', 'veil'],
    ['veil', 'mole'],
  ] as const) {
    for (const firstOff of [a, b]) {
      const { w, set } = fakeWin(0.9);
      set(a, true);
      set(b, true);
      set(firstOff, false);
      set(firstOff === a ? b : a, false);
      assert.equal(w.opacity, 0.9, `${a}+${b}, ${firstOff} 먼저 풀림`);
    }
  }
});

test('차오르는 도중 다시 가려도 처음 값을 기억한다', () => {
  const { c, w, set } = fakeWin(1);
  set('veil', true);
  set('veil', false, false); // 0.4 까지 차오르다
  assert.equal(w.opacity, 0.4);
  set('mole', true);
  assert.equal(w.opacity, 0);
  set('mole', false);
  assert.equal(w.opacity, 1);
  assert.equal(c.active, false);
});

test('시험 인스턴스(불투명도 0)는 0 으로 돌아간다', () => {
  const { w, set } = fakeWin(0);
  set('mole', true);
  set('veil', true);
  set('mole', false);
  set('veil', false);
  assert.equal(w.opacity, 0);
});

test('같은 까닭을 두 번 켜거나 안 켠 까닭을 꺼도 아무 일 없다', () => {
  const c = new Conceal();
  assert.equal(
    c.set('mole', false, () => 1),
    undefined,
  );
  assert.deepEqual(
    c.set('mole', true, () => 1),
    { kind: 'hide' },
  );
  assert.equal(
    c.set('mole', true, () => 0),
    undefined,
  );
  assert.equal(c.has('mole'), true);
  assert.deepEqual(
    c.set('mole', false, () => 0),
    { kind: 'show', to: 1 },
  );
});

test('늦게 온 다 됐다(settled)는 다시 가린 동안에는 기억을 지우지 않는다', () => {
  const c = new Conceal();
  c.set('veil', true, () => 0.8);
  c.set('veil', false, () => 0);
  c.set('mole', true, () => 0.3); // 차오르던 중 (0.3) 에 다시 가림
  c.settled(); // 차오르기 타이머의 마지막 틱이 늦게 온다
  assert.deepEqual(
    c.set('mole', false, () => 0),
    { kind: 'show', to: 0.8 },
  );
});
