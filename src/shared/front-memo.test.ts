import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FRESH_FOCUS_MS, FrontMemo } from './front-memo.ts';
import { homeClickAction } from './home-policy.ts';

/** 창 하나의 포커스를 사건 순서대로 흉내 낸다 (BrowserWindow 의 focus, blur 이벤트와 isFocused) */
function fakeWindow() {
  let t = 0;
  let focused = false;
  const memo = new FrontMemo(() => t);
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
    /** 펫 클릭이 닿았을 때 큰 창을 어떻게 다루나 (home.ts toggle 과 같은 조립) */
    click() {
      return homeClickAction({
        alive: true,
        hidden: false,
        minimized: false,
        focused,
        freshFocus: memo.fresh(),
      });
    },
  };
}

test('뒤로 간 창은 펫을 눌러 앱이 깨어나며 포커스를 받아도 앞으로만 나온다 (숨기지 않는다)', () => {
  const w = fakeWindow();
  w.at(0);
  w.focus(); // 큰 창이 열림
  w.at(5000);
  w.blur(); // 다른 앱 창을 눌렀다
  w.at(9000);
  w.focus(); // 펫을 누르는 순간 앱이 깨어나 큰 창이 먼저 포커스를 받는다
  w.at(9120);
  assert.equal(w.click(), 'raise');
});

test('이미 맨 앞에 있던 창은 펫을 다시 누르면 숨긴다', () => {
  const w = fakeWindow();
  w.at(0);
  w.focus();
  w.at(20000);
  assert.equal(w.click(), 'hide');
});

test('방금 열린 창(뒤로 간 적 없음)도 곧바로 누르면 숨긴다', () => {
  const w = fakeWindow();
  w.at(0);
  w.focus();
  w.at(100);
  assert.equal(w.click(), 'hide');
});

test('깨어난 지 한참 지난 창은 맨 앞으로 본다', () => {
  const w = fakeWindow();
  w.at(0);
  w.focus();
  w.at(1000);
  w.blur();
  w.at(2000);
  w.focus();
  w.at(2000 + FRESH_FOCUS_MS + 1);
  assert.equal(w.click(), 'hide');
});

test('포커스가 없으면 뒤에 있는 것이다', () => {
  const w = fakeWindow();
  w.at(0);
  w.focus();
  w.at(10);
  w.blur();
  w.at(20);
  assert.equal(w.click(), 'raise');
});
