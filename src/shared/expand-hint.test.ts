import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createExpandHint, EXPAND_HINT_GAP_MS, type HintStore, pushesPastMax } from './expand-hint.ts';

const MAX = 560;
const at = (outerWidth: number, wantWidth: number | undefined, innerWidth = outerWidth) => ({
  outerWidth,
  innerWidth,
  wantWidth,
});

test('가장 넓은 너비에 닿은 채 더 넓히려 할 때만 권한다', () => {
  assert.equal(pushesPastMax(at(560, 600), MAX), true);
  assert.equal(pushesPastMax(at(559, 600), MAX), true, '1px 안쪽 오차는 닿은 것으로');
  assert.equal(pushesPastMax(at(540, 600), MAX), false, '아직 못 닿았다');
  assert.equal(pushesPastMax(at(560, 560), MAX), false, '더 넓히려는 것이 아니다');
  assert.equal(pushesPastMax(at(560, 561), MAX), false, '2px 안쪽은 손 떨림');
  assert.equal(pushesPastMax(at(560, undefined), MAX), false, '아래 가장자리 끌기는 너비를 안 바꾼다');
});

test('큰 글씨(확대 배율)에서도 창 너비 기준으로 닿았는지 본다', () => {
  // 배율 1.5: 창 560 DIP 는 화면 373 CSS px
  assert.equal(pushesPastMax(at(560, 420, 373), MAX), true);
  assert.equal(pushesPastMax(at(400, 420, 267), MAX), false);
});

test('같은 끌기에서는 한 번만 띄운다', () => {
  const hint = createExpandHint(MAX, () => 1000);
  hint.start();
  assert.equal(hint.drag(at(560, 600)), true);
  assert.equal(hint.drag(at(560, 650)), false);
  assert.equal(hint.drag(at(560, 700)), false);
});

test('다른 끌기라도 한 번 띄운 뒤 일정 시간 안에는 다시 띄우지 않는다', () => {
  let t = 1000;
  const hint = createExpandHint(MAX, () => t);
  hint.start();
  assert.equal(hint.drag(at(560, 600)), true);
  t = 1000 + EXPAND_HINT_GAP_MS - 1;
  hint.start();
  assert.equal(hint.drag(at(560, 600)), false, '너무 자주 뜨지 않게');
  t = 1000 + EXPAND_HINT_GAP_MS + 1;
  hint.start();
  assert.equal(hint.drag(at(560, 600)), true, '시간이 지나면 다시');
});

test('띄우지 않은 끌기는 시간을 쓰지 않는다', () => {
  let t = 0;
  const hint = createExpandHint(MAX, () => t);
  hint.start();
  assert.equal(hint.drag(at(500, 520)), false);
  t = 10;
  hint.start();
  assert.equal(hint.drag(at(560, 600)), true);
});

test('마지막 띄운 때를 밖(메인)에 두면 창을 새로 만들어도 간격이 이어진다', () => {
  let t = 5000;
  let kept = 0;
  const store: HintStore = { get: () => kept, set: (at) => (kept = at) };
  const first = createExpandHint(MAX, () => t, store);
  first.start();
  assert.equal(first.drag(at(560, 600)), true);
  assert.equal(kept, 5000);
  // 패널을 닫았다 열면 권유기가 새로 만들어진다
  t = 5000 + 10_000;
  const reopened = createExpandHint(MAX, () => t, store);
  reopened.start();
  assert.equal(reopened.drag(at(560, 600)), false, '창이 새로 떠도 60초 안에는 안 뜬다');
  t = 5000 + EXPAND_HINT_GAP_MS;
  const later = createExpandHint(MAX, () => t, store);
  later.start();
  assert.equal(later.drag(at(560, 600)), true);
});
