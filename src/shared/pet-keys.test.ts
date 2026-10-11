import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isPetKey, petKeyOf } from './pet-keys.ts';

const press = (
  key: string,
  mods: Partial<{ shift: boolean; alt: boolean; ctrl: boolean; meta: boolean }> = {},
) =>
  petKeyOf({
    key,
    shiftKey: !!mods.shift,
    altKey: !!mods.alt,
    ctrlKey: !!mods.ctrl,
    metaKey: !!mods.meta,
  });

test('Enter, Space 는 패널, Shift+F10 과 메뉴 키는 메뉴, Esc 는 나가기', () => {
  assert.equal(press('Enter'), 'open');
  assert.equal(press(' '), 'open');
  assert.equal(press('F10', { shift: true }), 'menu');
  assert.equal(press('ContextMenu'), 'menu');
  assert.equal(press('F10'), undefined);
  assert.equal(press('Escape'), 'leave');
});

test('화살표: 좌우는 걷기, Shift 는 조금 옮기기, 위아래는 옮기기', () => {
  assert.equal(press('ArrowLeft'), 'left');
  assert.equal(press('ArrowRight'), 'right');
  assert.equal(press('ArrowLeft', { shift: true }), 'nudgeLeft');
  assert.equal(press('ArrowRight', { shift: true }), 'nudgeRight');
  assert.equal(press('ArrowUp'), 'nudgeUp');
  assert.equal(press('ArrowDown', { shift: true }), 'nudgeDown');
});

test('Cmd, Ctrl, Alt 조합과 모르는 키는 건드리지 않는다', () => {
  assert.equal(press('ArrowLeft', { meta: true }), undefined);
  assert.equal(press('Enter', { ctrl: true }), undefined);
  assert.equal(press('F10', { shift: true, alt: true }), undefined);
  assert.equal(press('a'), undefined);
  assert.equal(press('Tab'), undefined);
  assert.equal(press('Enter', { shift: true }), undefined);
});

test('메인은 아는 명령만 받는다', () => {
  assert.ok(isPetKey('open'));
  assert.equal(isPetKey('quit'), false);
  assert.equal(isPetKey({}), false);
});
