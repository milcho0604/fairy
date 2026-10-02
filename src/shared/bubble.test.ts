import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BUBBLE_GAP, layoutBubble } from './bubble-layout.ts';
import { ChatterGate, LATER_LIMIT, MAX_PER_HOUR, quieter } from './chatter.ts';

const area = { x: -1512, y: 33, width: 1512, height: 949 }; // 개발 맥 내장 화면
const pet = { x: -500, y: 780, width: 160, height: 160 };

test('말풍선이 없으면 창 = 펫', () => {
  const l = layoutBubble(pet, undefined, area);
  assert.deepEqual(l.window, pet);
  assert.equal(l.bubble, undefined);
});

test('말풍선은 펫 위로, 펫은 화면에서 제자리', () => {
  const l = layoutBubble(pet, { width: 220, height: 60 }, area);
  assert.equal(l.bubble?.side, 'above');
  assert.deepEqual(l.window, {
    x: -530,
    y: 780 - 60 - BUBBLE_GAP,
    width: 220,
    height: 160 + 60 + BUBBLE_GAP,
  });
  // 창 안 펫 위치 + 창 위치 = 원래 펫 위치
  assert.equal(l.window.x + l.pet.x, pet.x);
  assert.equal(l.window.y + l.pet.y, pet.y);
  // 꼬리는 펫 가운데를 가리킨다
  assert.equal(l.window.x + (l.bubble?.x ?? 0) + (l.bubble?.tailX ?? 0), pet.x + 80);
});

test('위에 자리가 없으면 아래로', () => {
  const top = { ...pet, y: 40 };
  const l = layoutBubble(top, { width: 220, height: 60 }, area);
  assert.equal(l.bubble?.side, 'below');
  assert.equal(l.window.y, 40);
  assert.equal(l.bubble?.y, 160 + BUBBLE_GAP);
});

test('화면 끝에서는 창을 안으로 밀고 펫은 그대로, 꼬리가 펫을 따라간다', () => {
  const edge = { ...pet, x: -165 }; // 오른쪽 끝(0)에 붙음
  const l = layoutBubble(edge, { width: 260, height: 60 }, area);
  assert.ok(l.window.x + l.window.width <= 0);
  assert.equal(l.window.x + l.pet.x, edge.x);
  assert.equal(l.window.x + (l.bubble?.x ?? 0) + (l.bubble?.tailX ?? 0), edge.x + 80);
  assert.ok((l.bubble?.x ?? -1) >= 0);
});

test('조용히: 답 알림과 일정만, 상태 알림은 안 뜬다', () => {
  const g = new ChatterGate('quiet');
  assert.equal(g.take('answer', 0), true);
  assert.equal(g.take('schedule', 0), true);
  assert.equal(g.take('system', 0), false);
});

test(`보통은 한 시간에 ${MAX_PER_HOUR.normal}개, 한 시간이 지나면 다시`, () => {
  const g = new ChatterGate('normal');
  const results = [0, 1, 2, 3].map((i) => g.take('system', i * 1000));
  assert.deepEqual(results, [true, true, true, false]);
  assert.equal(g.take('answer', 5000), true); // 답 알림은 세지 않는다
  assert.equal(g.take('system', 60 * 60 * 1000 + 1), true);
  assert.equal(g.take('idle-talk', 0), false); // 혼잣말은 수다쟁이만
});

test(`"나중에"를 ${LATER_LIMIT}번 연달아 누르면 조용히 할지 묻는다`, () => {
  const g = new ChatterGate('normal');
  assert.equal(g.closed('later'), false);
  assert.equal(g.closed('later'), false);
  assert.equal(g.closed('later'), true);
  assert.equal(g.closed('later'), false); // 물은 뒤에는 다시 센다
  g.closed('later');
  g.closed('other'); // 중간에 다른 걸 누르면 처음부터
  assert.equal(g.closed('later'), false);
  assert.equal(new ChatterGate('quiet').closed('later') || new ChatterGate('quiet').closed('later'), false);
  assert.deepEqual([quieter('chatty'), quieter('normal'), quieter('quiet')], ['normal', 'quiet', 'quiet']);
});
