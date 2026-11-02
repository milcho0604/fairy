import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { floatingWindowOptions } from './window-options.ts';

const bounds = { x: 10, y: 20, width: 360, height: 540 };

test('패널과 빠른 입력 창은 첫 클릭을 받는다 (앱이 뒤에 있어도 단추에 닿는다)', () => {
  const o = floatingWindowOptions(bounds);
  assert.equal(o.acceptFirstMouse, true);
  assert.equal(o.alwaysOnTop, true);
  assert.equal(o.transparent, true);
  assert.deepEqual([o.x, o.y, o.width, o.height], [10, 20, 360, 540]);
});

test('패널 창은 floatingWindowOptions 로 만든다', () => {
  const src = readFileSync(join(import.meta.dirname, 'panel.ts'), 'utf8');
  assert.match(src, /new BrowserWindow\(\{\s*\.\.\.floatingWindowOptions\(bounds\)/);
});

test('기억하는 창(채팅, 설정, 펫 만들기, 알아보기, 큰 창)은 기본으로 첫 클릭을 받는다', () => {
  const src = readFileSync(join(import.meta.dirname, 'window-bounds.ts'), 'utf8');
  for (const ctor of ['new BrowserWindow({', 'new BaseWindow({']) {
    const at = src.indexOf(ctor, src.indexOf('export function openRemembered'));
    const body = src.slice(at, src.indexOf('});', at));
    assert.match(body, /acceptFirstMouse:\s*true,\s*\n\s*\.\.\.o\.options/, ctor);
  }
});

test('공지 창과 첫 안내 창도 첫 클릭을 받는다', () => {
  for (const f of ['notice-window.ts', 'onboarding.ts']) {
    const src = readFileSync(join(import.meta.dirname, f), 'utf8');
    assert.match(src, /acceptFirstMouse:\s*true/, f);
  }
});
