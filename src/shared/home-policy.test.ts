import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  HOME_KEEP_MS,
  HOME_MIN,
  HOME_SIZE,
  homeClickAction,
  homeExpired,
  homeOpen,
  isPanelView,
  panelTarget,
  promoteAction,
  reopenTarget,
} from './home-policy.ts';
import { presenceHide } from './presence.ts';

const none = { alive: false, hidden: false };
const shown = { alive: true, hidden: false };
const tucked = { alive: true, hidden: true };

test('패널 보기: compact, window 만 받고 모르는 값은 거른다', () => {
  assert.equal(isPanelView('compact'), true);
  assert.equal(isPanelView('window'), true);
  for (const v of ['', 'big', 'Window', 1, null, undefined, {}]) assert.equal(isPanelView(v), false);
});

test('큰 창이 열려 있다 = 살아 있고 숨겨 두지 않았다', () => {
  assert.equal(homeOpen(none), false);
  assert.equal(homeOpen(shown), true);
  assert.equal(homeOpen(tucked), false);
});

test('펫 클릭이 여는 것: 패널 보기가 정하되, 큰 창이 열려 있으면 늘 큰 창', () => {
  assert.equal(panelTarget('compact', none), 'panel');
  assert.equal(panelTarget('window', none), 'home');
  // 큰 창이 열려 있는데 패널 보기가 작은 패널이어도 큰 창을 앞으로 (둘을 함께 열지 않는다)
  assert.equal(panelTarget('compact', shown), 'home');
  assert.equal(panelTarget('window', shown), 'home');
  // 숨겨 둔 큰 창은 열려 있는 게 아니다: 작은 패널 보기면 작은 패널
  assert.equal(panelTarget('compact', tucked), 'panel');
  assert.equal(panelTarget('window', tucked), 'home');
});

test('다시 누르기: 없으면 만들고, 숨겼거나 내려갔으면 띄우고, 뒤에 있으면 앞으로, 맨 앞이면 숨긴다', () => {
  const base = { alive: true, hidden: false, minimized: false, focused: false };
  assert.equal(homeClickAction({ ...base, alive: false }), 'create');
  assert.equal(homeClickAction({ ...base, hidden: true }), 'show');
  assert.equal(homeClickAction({ ...base, minimized: true }), 'show');
  assert.equal(homeClickAction({ ...base, focused: false }), 'raise');
  assert.equal(homeClickAction({ ...base, focused: true }), 'hide');
  // 숨겨 둔 창은 포커스가 있어 보여도 숨긴 쪽이 먼저
  assert.equal(homeClickAction({ ...base, hidden: true, focused: true }), 'show');
  // 없는 창은 다른 값이 뭐든 만든다
  assert.equal(homeClickAction({ alive: false, hidden: true, minimized: true, focused: true }), 'create');
});

test('숨긴 채 10분이 지나면 없앨 때', () => {
  assert.equal(HOME_KEEP_MS, 600_000);
  assert.equal(homeExpired(undefined, 5_000_000), false);
  assert.equal(homeExpired(1000, 1000 + HOME_KEEP_MS - 1), false);
  assert.equal(homeExpired(1000, 1000 + HOME_KEEP_MS), true);
  assert.equal(homeExpired(1000, 1000 + HOME_KEEP_MS * 3), true);
  assert.equal(homeExpired(1000, 1500, 500), true);
});

test('큰 창 크기: 기본 1100x720, 가장 작게 760x520, 기본이 최소보다 작지 않다', () => {
  assert.deepEqual(HOME_SIZE, { width: 1100, height: 720 });
  assert.deepEqual(HOME_MIN, { width: 760, height: 520 });
  assert.ok(HOME_SIZE.width >= HOME_MIN.width && HOME_SIZE.height >= HOME_MIN.height);
});

test('우리 큰 창이 전체 화면이면 전체 화면 앱으로 세지 않아 펫을 숨기지 않는다', () => {
  assert.equal(presenceHide(true, false), true);
  assert.equal(presenceHide(true, true), false);
  assert.equal(presenceHide(false, true), false);
  assert.equal(presenceHide(false, false), false);
});

test('앱을 다시 열면(Dock 아이콘): 열려 있거나 내려간 큰 창은 되살리고, 없거나 숨겨 둔 창이면 펫을 부른다', () => {
  assert.equal(reopenTarget('activate', shown), 'home');
  assert.equal(reopenTarget('activate', none), 'pet');
  assert.equal(reopenTarget('activate', tucked), 'pet');
  // 다시 실행(윈도우, 리눅스)은 늘 펫
  assert.equal(reopenTarget('second-instance', shown), 'pet');
});

test('크게 보기로 넘길 때: 없으면 만들고, 열려 있으면 앞으로, 숨겨 둔 창은 새로 만든다', () => {
  assert.equal(promoteAction(none), 'create');
  assert.equal(promoteAction(shown), 'show');
  assert.equal(promoteAction(tucked), 'recreate');
});
