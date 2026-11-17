import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  escClosesSurface,
  escClosesWindow,
  isEsc,
  type ModKeyLike,
  newNoteByKey,
  newNoteShortcut,
  tabByKey,
  tabStepByKey,
  undoByKey,
  undoFieldText,
} from './keys.ts';

test('한글 조합 중 Esc 는 아무것도 하지 않는다 (isComposing, keyCode 229 둘 다)', () => {
  assert.equal(isEsc({ key: 'Escape', isComposing: true, keyCode: 27 }), false);
  assert.equal(isEsc({ key: 'Escape', isComposing: false, keyCode: 229 }), false);
  assert.equal(isEsc({ key: 'Escape', nativeEvent: { key: 'Escape', isComposing: true } }), false);
  assert.equal(isEsc({ key: 'Escape', isComposing: false, keyCode: 27 }), true);
  assert.equal(isEsc({ key: 'Enter' }), false);
});

test('입력칸이 먼저 Esc 를 먹으면 창은 닫히지 않는다', () => {
  assert.equal(escClosesWindow({ key: 'Escape', keyCode: 27, defaultPrevented: true }), false);
  assert.equal(escClosesWindow({ key: 'Escape', keyCode: 27, defaultPrevented: false }), true);
  assert.equal(escClosesWindow({ key: 'Escape', keyCode: 229 }), false);
});

const press = (
  code: string,
  mods: Partial<ModKeyLike> = {},
  key = code.replace(/^(Digit|Key)/, '').toLowerCase(),
) => ({
  key,
  code,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

test('Cmd(맥)/Ctrl(윈도우) + 숫자로 탭을 고른다. 다른 수식키가 섞이거나 탭 수를 넘으면 아니다', () => {
  assert.equal(tabByKey(press('Digit1', { metaKey: true }), true, 5), 0);
  assert.equal(tabByKey(press('Digit5', { ctrlKey: true }), false, 5), 4);
  assert.equal(tabByKey(press('Digit6', { metaKey: true }), true, 5), undefined);
  assert.equal(tabByKey(press('Digit1', { ctrlKey: true }), true, 5), undefined);
  assert.equal(tabByKey(press('Digit1', { metaKey: true, shiftKey: true }), true, 5), undefined);
  assert.equal(tabByKey(press('Digit2'), true, 5), undefined);
  // 한글 입력기에서도 code 로 읽는다
  assert.equal(tabByKey(press('Digit3', { ctrlKey: true }, 'Process'), false, 5), 2);
});

test('Cmd/Ctrl+Z 는 쓰던 글이 없을 때만 알림 되돌리기', () => {
  assert.equal(undoByKey(press('KeyZ', { metaKey: true }), true, undefined), true);
  assert.equal(undoByKey(press('KeyZ', { metaKey: true }), true, ''), true);
  assert.equal(undoByKey(press('KeyZ', { metaKey: true }), true, '메일'), false);
  assert.equal(undoByKey(press('KeyZ', { metaKey: true, shiftKey: true }), true, undefined), false);
  assert.equal(undoByKey(press('KeyZ', { ctrlKey: true }), false, undefined), true);
  assert.equal(undoByKey(press('KeyY', { ctrlKey: true }), false, undefined), false);
});

test('패널 탭 줄 ← → Home End: 끝에서 돌아 들어가고, 다른 키는 아니다', () => {
  assert.equal(tabStepByKey('ArrowRight', 0, 5), 1);
  assert.equal(tabStepByKey('ArrowRight', 4, 5), 0);
  assert.equal(tabStepByKey('ArrowLeft', 0, 5), 4);
  assert.equal(tabStepByKey('ArrowLeft', 3, 5), 2);
  assert.equal(tabStepByKey('Home', 3, 5), 0);
  assert.equal(tabStepByKey('End', 1, 5), 4);
  assert.equal(tabStepByKey('ArrowDown', 1, 5), undefined);
  assert.equal(tabStepByKey('Enter', 1, 5), undefined);
  assert.equal(tabStepByKey('ArrowRight', 0, 0), undefined);
});

test('입력칸의 쓰던 글 판정: 가장 나중 일이 이긴다 (알림 되돌리기 vs 글 되돌리기)', () => {
  // 알림이 없으면 예전 규칙: 글이 있거나 쓴 적이 있으면 글 되돌리기
  assert.equal(undoFieldText('메일', undefined, undefined), '메일');
  assert.equal(undoFieldText('', 100, undefined), 'typed');
  assert.equal(undoFieldText('', undefined, undefined), '');
  // 적고 Enter 로 넣었다: 칸은 비었고 알림이 글보다 나중 -> 알림 되돌리기
  assert.equal(undoFieldText('', 100, 200), '');
  // 알림 뒤에 다시 글을 적었다 -> 글 되돌리기
  assert.equal(undoFieldText('새 글', 300, 200), '새 글');
  assert.equal(undoFieldText('', 300, 200), 'typed');
  // 칸에 글을 적은 적 없고 알림이 있다 -> 알림
  assert.equal(undoFieldText('붙여 넣은 글', undefined, 200), '');
  // 같은 밀리초면 글이 먼저(알림이 나중이 아니다)
  assert.equal(undoFieldText('x', 200, 200), 'x');
});

test('면에 건 Esc: 작은 패널만 창을 닫고 큰 창은 닫지 않는다', () => {
  assert.equal(escClosesSurface({ key: 'Escape', keyCode: 27 }, 'panel'), true);
  assert.equal(escClosesSurface({ key: 'Escape', keyCode: 27 }, 'home'), false);
  // 입력칸이 먼저 먹은 Esc, 한글 조합 중 Esc 는 어느 면에서도 창을 닫지 않는다
  assert.equal(escClosesSurface({ key: 'Escape', defaultPrevented: true }, 'panel'), false);
  assert.equal(escClosesSurface({ key: 'Escape', isComposing: true }, 'panel'), false);
  assert.equal(escClosesSurface({ key: 'Enter' }, 'panel'), false);
});

test('Cmd/Ctrl+N 은 새 메모: 맥은 Cmd, 그 밖은 Ctrl 하나만', () => {
  const n = (mods: Partial<ModKeyLike & { repeat: boolean; keyCode: number }>, key = 'n', code = 'KeyN') => ({
    key,
    code,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...mods,
  });
  assert.equal(newNoteByKey(n({ metaKey: true }), true), true);
  assert.equal(newNoteByKey(n({ ctrlKey: true }), true), false);
  assert.equal(newNoteByKey(n({ ctrlKey: true }), false), true);
  assert.equal(newNoteByKey(n({ metaKey: true }), false), false);
  assert.equal(newNoteByKey(n({}), true), false);
  assert.equal(newNoteByKey(n({ metaKey: true, shiftKey: true }), true), false);
  assert.equal(newNoteByKey(n({ metaKey: true, altKey: true }), true), false);
  // 한글 자판: key 는 ㅜ, 자리는 KeyN
  assert.equal(newNoteByKey(n({ metaKey: true }, 'ㅜ'), true), true);
  // 한글 조합 중, 누르고 있는 반복은 아니다
  assert.equal(newNoteByKey(n({ metaKey: true, isComposing: true }), true), false);
  assert.equal(newNoteByKey(n({ metaKey: true, keyCode: 229 }), true), false);
  assert.equal(newNoteByKey(n({ metaKey: true, repeat: true }), true), false);
  // 다른 단축키와 겹치지 않는다: Cmd+1~5, K, W, Z, 쉼표
  for (const [key, code] of [
    ['1', 'Digit1'],
    ['k', 'KeyK'],
    ['w', 'KeyW'],
    ['z', 'KeyZ'],
    [',', 'Comma'],
  ])
    assert.equal(newNoteByKey(n({ metaKey: true }, key, code), true), false);
});

test('새 메모 단축키 글자', () => {
  assert.equal(newNoteShortcut(true), '⌘N');
  assert.equal(newNoteShortcut(false), 'Ctrl+N');
});

test('Dvorak 등: 물리 N 자리(code=KeyN)에 다른 글자(key=b)면 새 메모가 아니다', () => {
  const n = (mods: Partial<ModKeyLike>, key: string, code: string) => ({
    key,
    code,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...mods,
  });
  assert.equal(newNoteByKey(n({ metaKey: true }, 'b', 'KeyN'), true), false);
  assert.equal(newNoteByKey(n({ ctrlKey: true }, 'b', 'KeyN'), false), false);
  // Dvorak 에서 N 은 다른 물리 자리(KeyL)에 있다
  assert.equal(newNoteByKey(n({ metaKey: true }, 'n', 'KeyL'), true), true);
});
