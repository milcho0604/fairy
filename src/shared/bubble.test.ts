import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BUBBLE_GAP, bubbleClashes, bubbleRectOf, layoutBubble, parseBubbleAnchor } from './bubble-layout.ts';
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

test('두 펫이 나란히 서서 같이 말하면 말풍선이 겹친다고 본다 (이슈 #65)', () => {
  const friend = { x: pet.x + 170, y: pet.y, width: 160, height: 160 };
  const friendBubble = bubbleRectOf(friend, { width: 200, height: 60 }, area);
  assert.equal(bubbleClashes(pet, area, [friendBubble]), true);
  // 멀리 떨어진 친구 말풍선과는 겹치지 않는다
  const far = { ...friend, x: pet.x + 700 };
  assert.equal(bubbleClashes(pet, area, [bubbleRectOf(far, { width: 200, height: 60 }, area)]), false);
  // 떠 있는 말풍선이 없으면 겹치지 않는다
  assert.equal(bubbleClashes(pet, area, []), false);
});

test('말풍선 사각형은 화면 좌표로, 펫 가운데 위', () => {
  const r = bubbleRectOf(pet, { width: 120, height: 40 }, area);
  assert.equal(r.x + r.width / 2, pet.x + pet.width / 2);
  assert.equal(r.y + r.height + BUBBLE_GAP, pet.y);
});

test('다른 펫 말풍선과의 충돌도 그림 윗선으로 계산한다', () => {
  const size = { width: 220, height: 60 };
  const other = { x: -530, y: 790, ...size };
  assert.equal(bubbleClashes(pet, area, [other], size), false);
  assert.equal(bubbleClashes(pet, area, [other], size, { top: 0.5, bottom: 0.95 }), true);
});

for (const scale of [0.5, 1, 1.5, 2]) {
  test(`투명 여백 기준 배치: 크기 ${scale}, 위/아래/화면 끝에서도 펫은 제자리`, () => {
    const anchor = { top: 0.35, bottom: 0.9 };
    const size = { width: 220, height: 60 };
    for (const y of [40, 500]) {
      const p = { x: -160 * scale, y, width: 160 * scale, height: 160 * scale };
      const l = layoutBubble(p, size, area, anchor);
      const b = bubbleRectOf(p, size, area, anchor);
      assert.equal(l.window.x + l.pet.x, p.x);
      assert.equal(l.window.y + l.pet.y, p.y);
      assert.ok(l.pet.y >= 0 && l.pet.y + p.height <= l.window.height);
      assert.ok(l.window.x + l.window.width <= area.x + area.width);
      assert.equal(b.x + (l.bubble?.tailX ?? 0), p.x + p.width / 2);
      if (l.bubble?.side === 'above')
        assert.equal(b.y + b.height + BUBBLE_GAP, Math.round(p.y + p.height * anchor.top));
      else assert.equal(b.y - BUBBLE_GAP, Math.round(p.y + p.height * anchor.bottom));
    }
  });
}

test('투명 여백에 말풍선이 들어가면 캔버스를 줄이거나 펫을 옮기지 않는다', () => {
  const p = { x: -500, y: 500, width: 320, height: 320 };
  const l = layoutBubble(p, { width: 100, height: 30 }, area, { top: 0.5, bottom: 0.9 });
  assert.equal(l.window.height, p.height);
  assert.equal(l.pet.y, 0);
  assert.equal(l.bubble?.y, 120);
});

test('불투명 윗선에 위쪽 자리가 있으면 캔버스 위가 화면 끝이어도 위로 띄운다', () => {
  const p = { ...pet, y: area.y };
  assert.equal(
    layoutBubble(p, { width: 100, height: 30 }, area, { top: 0.4, bottom: 0.9 }).bubble?.side,
    'above',
  );
});

test('잘못된 그림 기준은 거절하고 전체 캔버스 기준으로 돌아간다', () => {
  for (const value of [
    null,
    {},
    { top: NaN, bottom: 1 },
    { top: -1, bottom: 1 },
    { top: 0.9, bottom: 0.2 },
    { top: 0, bottom: Infinity },
  ]) {
    assert.equal(parseBubbleAnchor(value), undefined);
    assert.deepEqual(
      layoutBubble(pet, { width: 100, height: 30 }, area, value as never),
      layoutBubble(pet, { width: 100, height: 30 }, area),
    );
  }
});
