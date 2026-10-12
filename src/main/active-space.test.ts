import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { KEEP_APP_TYPE, onActiveSpace } from './active-space.ts';

function fakeWindow(allSpaces: boolean) {
  const calls: string[] = [];
  const win = {
    isVisibleOnAllWorkspaces: () => allSpaces,
    setVisibleOnAllWorkspaces: (on: boolean, options?: Electron.VisibleOnAllWorkspacesOptions) => {
      calls.push(`all:${on}:${JSON.stringify(options)}`);
    },
  };
  return { win, calls };
}

test('맥: 잠깐 모든 데스크톱에 보이게 한 채 띄우고 다시 끈다 (앱 종류는 그대로)', () => {
  const { win, calls } = fakeWindow(false);
  onActiveSpace(win, () => calls.push('show'), 'darwin');
  const keep = JSON.stringify(KEEP_APP_TYPE);
  assert.deepEqual(calls, [`all:true:${keep}`, 'show', `all:false:${keep}`]);
});

test('띄우다 던져도 모든 데스크톱 보이기를 끈다', () => {
  const { win, calls } = fakeWindow(false);
  assert.throws(() =>
    onActiveSpace(
      win,
      () => {
        throw new Error('x');
      },
      'darwin',
    ),
  );
  assert.equal(calls.at(-1), `all:false:${JSON.stringify(KEEP_APP_TYPE)}`);
});

test('이미 모든 데스크톱에 보이는 창(펫)과 맥이 아닌 곳은 건드리지 않는다', () => {
  for (const [allSpaces, platform] of [
    [true, 'darwin'],
    [false, 'win32'],
    [false, 'linux'],
  ] as const) {
    const { win, calls } = fakeWindow(allSpaces);
    onActiveSpace(win, () => calls.push('show'), platform);
    assert.deepEqual(calls, ['show'], `${allSpaces} ${platform}`);
  }
});

test('setVisibleOnAllWorkspaces 는 늘 앱 종류를 바꾸지 않게 부른다 (펫이 Dock 있는 보통 앱으로 바뀌지 않게)', () => {
  const dir = import.meta.dirname;
  const bad: string[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.ts') || name.endsWith('.test.ts')) continue;
    const lines = readFileSync(join(dir, name), 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!/\.setVisibleOnAllWorkspaces\(/.test(line)) return;
      if (!/KEEP_APP_TYPE|skipTransformProcessType/.test(line)) bad.push(`${name}:${i + 1}`);
    });
  }
  assert.deepEqual(bad, []);
});

test('창을 여는 곳은 앱을 먼저 앞으로 가져오지 않는다 (focus.ts 가 창을 띄운 뒤에 한다)', () => {
  const dir = import.meta.dirname;
  const early: string[] = [];
  for (const name of ['chat.ts', 'settings-window.ts', 'onboarding.ts', 'maker.ts', 'knows.ts', 'panel.ts']) {
    if (/\bstealFocus\(\)/.test(readFileSync(join(dir, name), 'utf8'))) early.push(name);
  }
  assert.deepEqual(early, []);
});
