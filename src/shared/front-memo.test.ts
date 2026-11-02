import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FrontMemo, PRESS_SYNC_MS } from './front-memo.ts';
import { homeClickAction, panelClickAction, shrinkTab } from './home-policy.ts';

/** 창 하나와 펫 누르기를 사건 순서대로 흉내 낸다 (BrowserWindow 의 focus, blur, 펫 pointerdown, isFocused) */
function fake() {
  let t = 0;
  let focused = false;
  let hidden = false;
  let pressAt: number | undefined;
  const memo = new FrontMemo(
    () => pressAt,
    () => t,
  );
  return {
    at(ms: number) {
      t = ms;
    },
    focus() {
      focused = true;
      memo.gained();
    },
    blur() {
      focused = false;
      memo.lost();
    },
    /** 펫 pointerdown (메인이 시각을 적는다) */
    press() {
      pressAt = t;
    },
    hide() {
      hidden = true;
      this.blur();
      memo.reset();
    },
    show() {
      hidden = false;
      memo.reset(); // home.ts showExisting 이 띄우기 전에 비운다
      this.focus();
    },
    /** 펫 클릭이 닿았을 때 큰 창을 어떻게 다루나 (home.ts toggle 과 같은 조립) */
    click() {
      return homeClickAction({
        alive: true,
        hidden,
        minimized: false,
        focused,
        freshFocus: memo.wokenByPet(),
      });
    },
  };
}

test('뒤로 간 창은 펫을 눌러 앱이 깨어나며 포커스를 받아도 앞으로만 나온다 (숨기지 않는다)', () => {
  const w = fake();
  w.at(0);
  w.focus();
  w.at(5000);
  w.blur();
  w.at(9000);
  w.press();
  w.focus(); // 누르는 순간 앱이 깨어나 큰 창이 먼저 포커스를 받는다
  w.at(9500); // 더블클릭을 기다린 단일 클릭이 닿는다
  assert.equal(w.click(), 'raise');
});

test('누른 뒤 클릭이 닿기까지 오래 걸려도(길게 누름 600ms + 지연 500ms) 앞으로만 나온다', () => {
  const w = fake();
  w.at(0);
  w.focus();
  w.at(1000);
  w.blur();
  w.at(9000);
  w.focus();
  w.press(); // 포커스와 누름 알림은 순서가 바뀌어 닿아도 같은 순간이다
  w.at(9000 + 600 + 500);
  assert.equal(w.click(), 'raise');
});

test('이미 맨 앞이던 창은 펫을 누르면 숨긴다', () => {
  const w = fake();
  w.at(0);
  w.focus();
  w.at(20000);
  w.press();
  w.at(20500);
  assert.equal(w.click(), 'hide');
});

test('방금 열린 창(뒤로 간 적 없음)도 누르면 숨긴다', () => {
  const w = fake();
  w.at(0);
  w.focus();
  w.at(100);
  w.press();
  w.at(600);
  assert.equal(w.click(), 'hide');
});

test('숨겼다 띄운 지 1초 안에 눌러도 숨긴다 (연속 토글이 막히지 않는다)', () => {
  const w = fake();
  w.at(0);
  w.focus();
  w.at(5000);
  w.press();
  w.at(5500);
  assert.equal(w.click(), 'hide');
  w.hide();
  w.at(5800);
  w.press();
  w.at(6300);
  assert.equal(w.click(), 'show');
  w.show();
  w.at(6700);
  w.press();
  w.at(7200);
  assert.equal(w.click(), 'hide');
});

test('큰 창을 직접 눌러 앞으로 가져온 직후 펫을 누르면 숨긴다', () => {
  const w = fake();
  w.at(0);
  w.focus();
  w.at(1000);
  w.blur();
  w.at(30000);
  w.focus(); // 사용자가 창을 직접 눌렀다
  w.at(30800);
  w.press();
  w.at(31300);
  assert.equal(w.click(), 'hide');
  assert.ok(800 > PRESS_SYNC_MS);
});

test('누른 적 없이(단축키, 트레이) 닿은 호출은 지금 포커스로 정한다', () => {
  const w = fake();
  w.at(0);
  w.focus();
  w.at(1000);
  w.blur();
  w.at(2000);
  assert.equal(w.click(), 'raise');
  w.focus();
  assert.equal(w.click(), 'hide');
});

test('포커스가 없으면 뒤에 있는 것이다', () => {
  const w = fake();
  w.at(0);
  w.focus();
  w.at(10);
  w.blur();
  w.at(20);
  assert.equal(w.click(), 'raise');
});

test('작은 패널: 보이면 한 번에 닫고(다른 앱이 앞이어도), 안 보이면 앞으로', () => {
  assert.equal(panelClickAction({ visible: true, minimized: false }), 'close');
  assert.equal(panelClickAction({ visible: false, minimized: false }), 'raise');
  assert.equal(panelClickAction({ visible: true, minimized: true }), 'raise');
});

test('작게 보기: 작은 패널에 없는 기록 구역은 오늘로, 나머지는 그대로', () => {
  assert.equal(shrinkTab('records'), 'today');
  for (const t of ['today', 'todo', 'note', 'event', 'shop', 'mail'] as const) assert.equal(shrinkTab(t), t);
});
