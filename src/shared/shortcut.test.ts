import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  acceleratorLabel,
  isAccelerator,
  type KeyPress,
  NO_SHORTCUT,
  reservedUse,
  SHORTCUT_DEFAULTS,
  SHORTCUT_IDS,
  SHORTCUT_LABEL,
  shortcutClash,
  shortcutProblem,
  shortcutsChanged,
  toAccelerator,
} from './shortcut.ts';

const k = (code: string, mods: Partial<KeyPress> = {}, key = 'x'): KeyPress => ({
  key,
  code,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

test('맥: Cmd+Option+Shift+J, Option 으로 바뀐 글자도 code 로 읽는다', () => {
  assert.deepEqual(toAccelerator(k('KeyJ', { metaKey: true, altKey: true, shiftKey: true }, '∆'), true), {
    accelerator: 'CommandOrControl+Alt+Shift+J',
  });
  assert.deepEqual(toAccelerator(k('Digit1', { ctrlKey: true, altKey: true }), true), {
    accelerator: 'Control+Alt+1',
  });
});

test('윈도우: Ctrl+Alt+K, Win 키 조합은 Windows 몫이라 막는다', () => {
  assert.deepEqual(toAccelerator(k('KeyK', { ctrlKey: true, altKey: true }), false), {
    accelerator: 'CommandOrControl+Alt+K',
  });
  assert.ok('error' in (toAccelerator(k('KeyK', { metaKey: true, altKey: true }), false) ?? {}));
  assert.equal(reservedUse('Super+Alt+K', false), 'windowsKey');
});

test('수식키 없이 글자만, 수식키만, 못 쓰는 키', () => {
  assert.ok('error' in (toAccelerator(k('KeyA', { shiftKey: true }), true) ?? {}));
  assert.equal(toAccelerator(k('ShiftLeft', { shiftKey: true }, 'Shift'), true), undefined);
  assert.ok('error' in (toAccelerator(k('IntlRo', { metaKey: true }), true) ?? {}));
  // F13~F24 는 혼자 써도 된다. F1~F12 는 새로 고침, 도움말 등이라 수식키 하나를 요구한다
  assert.deepEqual(toAccelerator(k('F13'), true), { accelerator: 'F13' });
  assert.deepEqual(toAccelerator(k('F24'), false), { accelerator: 'F24' });
  assert.ok('error' in (toAccelerator(k('F9'), true) ?? {}));
  assert.ok('error' in (toAccelerator(k('F5'), false) ?? {}));
  assert.deepEqual(toAccelerator(k('F9', { altKey: true }), true), { accelerator: 'Alt+F9' });
  assert.deepEqual(toAccelerator(k('F5', { shiftKey: true }), false), { accelerator: 'Shift+F5' });
});

test('표시와 검사', () => {
  assert.deepEqual(acceleratorLabel(SHORTCUT_DEFAULTS.hide, true), ['Cmd', 'Option', 'Shift', 'H']);
  assert.deepEqual(acceleratorLabel(SHORTCUT_DEFAULTS.hide, false), ['Ctrl', 'Alt', 'Shift', 'H']);
  assert.equal(isAccelerator(SHORTCUT_DEFAULTS.quickAdd), true);
  assert.equal(isAccelerator('CommandOrControl+Alt+='), true);
  assert.equal(isAccelerator('rm -rf'), false);
  assert.equal(isAccelerator('CommandOrControl+Alt+Shift+HH'), false);
});

test('단축키 겹침: 같은 키 조합(대소문자 무시)이면 두 이름을, 아니면 undefined (버그잡이 6차)', () => {
  assert.equal(shortcutClash(SHORTCUT_DEFAULTS), undefined);
  const d = SHORTCUT_DEFAULTS;
  assert.deepEqual(
    shortcutClash({ ...d, hide: 'CommandOrControl+Alt+J', quickAdd: 'CommandOrControl+Alt+J' }),
    ['hide', 'quickAdd'],
  );
  assert.deepEqual(
    shortcutClash({ ...d, hide: 'CommandOrControl+Alt+j', quickAdd: 'CommandOrControl+Alt+J' }),
    ['hide', 'quickAdd'],
  );
  // 대화, 같이 보기도 같이 본다: 숨기기를 대화 키로 바꾸면 겹친다
  assert.deepEqual(shortcutClash({ ...d, hide: d.chat }), ['hide', 'chat']);
  assert.deepEqual(shortcutClash({ ...d, look: d.quickAdd }), ['quickAdd', 'look']);
});

test('대화, 같이 보기 기본 단축키: Cmd/Ctrl+Option/Alt+Shift+J, L. 서로, 다른 기본과 겹치지 않는다', () => {
  assert.equal(SHORTCUT_DEFAULTS.chat, 'CommandOrControl+Alt+Shift+J');
  assert.deepEqual(acceleratorLabel(SHORTCUT_DEFAULTS.look, true), ['Cmd', 'Option', 'Shift', 'L']);
  assert.equal(
    new Set(Object.values(SHORTCUT_DEFAULTS).map((v) => v.toLowerCase())).size,
    SHORTCUT_IDS.length,
  );
  for (const mac of [true, false])
    for (const acc of [SHORTCUT_DEFAULTS.chat, SHORTCUT_DEFAULTS.look]) {
      assert.equal(reservedUse(acc, mac), undefined, acc);
      assert.equal(isAccelerator(acc), true);
    }
});

const err = (r: ReturnType<typeof toAccelerator>): string => (r && 'error' in r ? r.error : '');

test('맥 시스템, 편집 조합은 무슨 일인지 말하며 막는다', () => {
  const cases: [string, Partial<KeyPress>, string][] = [
    ['KeyC', { metaKey: true }, 'copy'],
    ['KeyV', { metaKey: true }, 'paste'],
    ['KeyV', { metaKey: true, shiftKey: true }, 'pastePlain'],
    ['KeyV', { metaKey: true, altKey: true, shiftKey: true }, 'pastePlain'],
    ['KeyX', { metaKey: true }, 'cut'],
    ['KeyA', { metaKey: true }, 'selectAll'],
    ['KeyZ', { metaKey: true }, 'undo'],
    ['KeyZ', { metaKey: true, shiftKey: true }, 'redo'],
    ['KeyS', { metaKey: true }, 'save'],
    ['KeyS', { metaKey: true, shiftKey: true }, 'saveAs'],
    ['KeyQ', { metaKey: true }, 'quit'],
    ['KeyQ', { metaKey: true, shiftKey: true }, 'logout'],
    ['KeyQ', { metaKey: true, ctrlKey: true }, 'lock'],
    ['KeyW', { metaKey: true }, 'closeWindow'],
    ['KeyM', { metaKey: true }, 'minimize'],
    ['KeyH', { metaKey: true }, 'hideApp'],
    ['KeyH', { metaKey: true, altKey: true }, 'hideApp'],
    ['Tab', { metaKey: true }, 'switchApp'],
    ['Tab', { metaKey: true, shiftKey: true }, 'switchApp'],
    ['Backquote', { metaKey: true }, 'switchWindow'],
    ['Tab', { ctrlKey: true }, 'switchTab'],
    ['Space', { metaKey: true }, 'spotlight'],
    ['Space', { metaKey: true, altKey: true }, 'spotlight'],
    ['Space', { ctrlKey: true }, 'inputSource'],
    ['Space', { ctrlKey: true, altKey: true }, 'inputSource'],
    ['Space', { metaKey: true, ctrlKey: true }, 'emoji'],
    ['Digit3', { metaKey: true, shiftKey: true }, 'screenshot'],
    ['Digit4', { metaKey: true, shiftKey: true }, 'screenshot'],
    ['Digit5', { metaKey: true, shiftKey: true }, 'screenshot'],
    ['Digit4', { metaKey: true, ctrlKey: true, shiftKey: true }, 'screenshot'],
    ['KeyF', { metaKey: true, ctrlKey: true }, 'fullScreen'],
    ['KeyD', { metaKey: true, altKey: true }, 'dock'],
    ['ArrowLeft', { ctrlKey: true }, 'missionControl'],
    ['ArrowUp', { ctrlKey: true }, 'missionControl'],
    ['Slash', { metaKey: true, shiftKey: true }, 'help'],
    ['F5', { metaKey: true }, 'voiceOver'],
  ];
  for (const [code, mods, use] of cases) {
    const r = toAccelerator(k(code, mods), true);
    assert.ok(r && 'error' in r, `${code} ${JSON.stringify(mods)} 를 막아야 한다`);
    const acc = acceleratorOf(code, mods, true);
    assert.equal(reservedUse(acc, true), use, acc);
  }
  // 안내에 키 이름과 쓰임이 들어간다
  assert.match(err(toAccelerator(k('KeyC', { metaKey: true }), true)), /Cmd \+ C/);
  assert.match(err(toAccelerator(k('KeyC', { metaKey: true }), true)), /복사/);
  assert.match(err(toAccelerator(k('Space', { metaKey: true }), true)), /Spotlight/);
});

test('윈도우 시스템, 편집 조합 (Ctrl 쪽 같은 표)', () => {
  const cases: [string, Partial<KeyPress>, string][] = [
    ['KeyC', { ctrlKey: true }, 'copy'],
    ['KeyV', { ctrlKey: true }, 'paste'],
    ['KeyV', { ctrlKey: true, shiftKey: true }, 'pastePlain'],
    ['KeyX', { ctrlKey: true }, 'cut'],
    ['KeyA', { ctrlKey: true }, 'selectAll'],
    ['KeyZ', { ctrlKey: true }, 'undo'],
    ['KeyY', { ctrlKey: true }, 'redo'],
    ['KeyZ', { ctrlKey: true, shiftKey: true }, 'redo'],
    ['KeyS', { ctrlKey: true }, 'save'],
    ['KeyS', { ctrlKey: true, shiftKey: true }, 'saveAs'],
    ['F4', { altKey: true }, 'quit'],
    ['KeyW', { ctrlKey: true }, 'closeWindow'],
    ['F4', { ctrlKey: true }, 'closeWindow'],
    ['Tab', { altKey: true }, 'switchApp'],
    ['Tab', { altKey: true, shiftKey: true }, 'switchApp'],
    ['Tab', { ctrlKey: true, altKey: true }, 'switchApp'],
    ['Tab', { ctrlKey: true }, 'switchTab'],
    ['Space', { altKey: true }, 'windowMenu'],
    ['Space', { ctrlKey: true }, 'inputSource'],
    ['F10', { shiftKey: true }, 'contextMenu'],
    ['ArrowUp', { ctrlKey: true, altKey: true }, 'rotate'],
  ];
  for (const [code, mods, use] of cases) {
    const r = toAccelerator(k(code, mods), false);
    assert.ok(r && 'error' in r, `${code} ${JSON.stringify(mods)} 를 막아야 한다`);
    assert.equal(reservedUse(acceleratorOf(code, mods, false), false), use);
  }
  assert.match(err(toAccelerator(k('KeyC', { ctrlKey: true }), false)), /Ctrl \+ C/);
  for (const code of ['KeyL', 'KeyD', 'KeyE', 'Space', 'Tab', 'Period'])
    assert.match(err(toAccelerator(k(code, { metaKey: true }), false)), /Windows/);
});

/** 시험용: 표에서 키 이름을 만들 때 toAccelerator 를 거치지 않는다 (막히면 글자가 안 나와서) */
function acceleratorOf(code: string, mods: Partial<KeyPress>, mac: boolean): string {
  const key = code.replace(/^Key|^Digit/, '').replace(/^Arrow/, '');
  const named: Record<string, string> = { Backquote: '`', Slash: '/', Period: '.' };
  const parts: string[] = [];
  if (mac ? mods.metaKey : mods.ctrlKey) parts.push('CommandOrControl');
  if (mac && mods.ctrlKey) parts.push('Control');
  if (!mac && mods.metaKey) parts.push('Super');
  if (mods.altKey) parts.push('Alt');
  if (mods.shiftKey) parts.push('Shift');
  parts.push(named[key] ?? key);
  return parts.join('+');
}

test('수식키 하나만이면 하나 더: Cmd 하나, 맥 Ctrl 하나, 윈도우 Ctrl 하나, Alt 하나', () => {
  assert.match(err(toAccelerator(k('KeyJ', { metaKey: true }), true)), /Cmd.*Option, Shift/);
  assert.match(err(toAccelerator(k('KeyJ', { ctrlKey: true }), true)), /Ctrl.*Option, Shift/);
  assert.match(err(toAccelerator(k('KeyJ', { ctrlKey: true }), false)), /Ctrl.*Alt, Shift/);
  assert.match(err(toAccelerator(k('KeyJ', { altKey: true }), false)), /Alt.*Ctrl, Shift/);
  // 맥 Option(+Shift) 은 특수 문자 입력이라 Cmd 나 Ctrl 이 있어야 한다
  assert.match(err(toAccelerator(k('KeyJ', { altKey: true }), true)), /특수 문자/);
  assert.match(err(toAccelerator(k('KeyJ', { altKey: true, shiftKey: true }), true)), /특수 문자/);
  // 둘 이상이면 된다
  assert.deepEqual(toAccelerator(k('KeyJ', { metaKey: true, shiftKey: true }), true), {
    accelerator: 'CommandOrControl+Shift+J',
  });
  assert.deepEqual(toAccelerator(k('KeyJ', { metaKey: true, altKey: true }), true), {
    accelerator: 'CommandOrControl+Alt+J',
  });
  assert.deepEqual(toAccelerator(k('KeyJ', { ctrlKey: true, shiftKey: true }), true), {
    accelerator: 'Control+Shift+J',
  });
  assert.deepEqual(toAccelerator(k('KeyJ', { ctrlKey: true, shiftKey: true }), false), {
    accelerator: 'CommandOrControl+Shift+J',
  });
  assert.deepEqual(toAccelerator(k('KeyJ', { altKey: true, shiftKey: true }), false), {
    accelerator: 'Alt+Shift+J',
  });
  // 기본값은 두 운영체제에서 다 된다
  // 비어 있는 기본(큰 창 열기)은 등록하지 않으니 검사할 키가 없다
  for (const mac of [true, false])
    for (const acc of Object.values(SHORTCUT_DEFAULTS).filter((v) => v !== NO_SHORTCUT))
      assert.equal(shortcutProblem(acc, mac), undefined);
});

test('대조: 막는 표에 없는 세 수식키 조합은 통과한다 (표가 너무 넓지 않게)', () => {
  for (const code of ['KeyC', 'KeyV', 'KeyQ', 'KeyW', 'Space', 'Tab', 'Digit3'])
    assert.equal(
      shortcutProblem(acceleratorOf(code, { metaKey: true, ctrlKey: true, altKey: true }, true), true),
      undefined,
      code,
    );
  assert.equal(shortcutProblem('CommandOrControl+Alt+Shift+C', false), undefined);
});

test('영어 안내도 키 이름과 쓰임을 말한다', async () => {
  const { setLang } = await import('./i18n/index.ts');
  setLang('en');
  try {
    assert.match(err(toAccelerator(k('KeyQ', { metaKey: true }), true)), /quitting apps \(Cmd \+ Q\)/);
    assert.match(err(toAccelerator(k('KeyJ', { metaKey: true }), true)), /Cmd alone/);
  } finally {
    setLang('ko');
  }
});

test('빈 단축키끼리는 겹친 게 아니다', () => {
  const d = SHORTCUT_DEFAULTS;
  assert.equal(shortcutClash({ ...d, chat: '', look: '' }), undefined);
  assert.deepEqual(shortcutClash({ ...d, chat: '', look: d.hide }), ['hide', 'look']);
});

test('shortcutsChanged: 대화, 같이 보기 키가 바뀌어도 다시 등록한다', () => {
  const d = SHORTCUT_DEFAULTS;
  assert.equal(shortcutsChanged(d, { ...d }), false);
  assert.equal(shortcutsChanged(d, { ...d, chat: 'CommandOrControl+Alt+Shift+O' }), true);
  assert.equal(shortcutsChanged(d, { ...d, look: '' }), true);
  assert.equal(shortcutsChanged(d, { ...d, hide: 'CommandOrControl+Alt+Shift+K' }), true);
  assert.equal(shortcutsChanged(d, { ...d, panel: '' }), true);
});

test('패널 단축키: 기본 Cmd/Ctrl+Option/Alt+Shift+T. 시스템 조합이 아니고 다른 기본과 겹치지 않는다', () => {
  const d = SHORTCUT_DEFAULTS;
  assert.equal(d.panel, 'CommandOrControl+Alt+Shift+T');
  assert.deepEqual(acceleratorLabel(d.panel, true), ['Cmd', 'Option', 'Shift', 'T']);
  assert.deepEqual(acceleratorLabel(d.panel, false), ['Ctrl', 'Alt', 'Shift', 'T']);
  assert.equal(isAccelerator(d.panel), true);
  for (const mac of [true, false]) {
    assert.equal(reservedUse(d.panel, mac), undefined);
    assert.equal(shortcutProblem(d.panel, mac), undefined);
  }
  for (const id of ['hide', 'quickAdd', 'chat', 'look'] as const) assert.notEqual(d[id], d.panel);
  // 다른 단축키를 패널 키로 바꾸면 겹친다
  assert.deepEqual(shortcutClash({ ...d, chat: d.panel }), ['chat', 'panel']);
  assert.equal(SHORTCUT_LABEL.panel, '패널 열기, 닫기');
  assert.equal(SHORTCUT_IDS.at(-2), 'panel');
});

test('펫 고르기 단축키 (접근성): 기본 Cmd/Ctrl+Option/Alt+Shift+P, 시스템 조합이 아니고 다른 기본과 겹치지 않는다', () => {
  const d = SHORTCUT_DEFAULTS;
  assert.equal(d.pet, 'CommandOrControl+Alt+Shift+P');
  for (const mac of [true, false]) {
    assert.equal(reservedUse(d.pet, mac), undefined);
    assert.equal(shortcutProblem(d.pet, mac), undefined);
  }
  assert.equal(shortcutClash(d), undefined);
  assert.equal(SHORTCUT_LABEL.pet, '페어리 고르기 (키보드로 페어리 다루기)');
  assert.equal(SHORTCUT_IDS.at(-1), 'pet');
});

test('큰 창 열기 단축키: 기본은 비어 있고, 정하면 다른 단축키와 겹침을 가린다', () => {
  const d = SHORTCUT_DEFAULTS;
  assert.equal(d.home, NO_SHORTCUT);
  assert.equal(SHORTCUT_LABEL.home, '큰 창 열기, 숨기기');
  // 기본이 비어 있어도 다른 단축키와 겹친 것으로 세지 않는다
  assert.equal(shortcutClash(d), undefined);
  // 정한 키가 다른 단축키와 같으면 겹친다
  assert.deepEqual(shortcutClash({ ...d, home: d.chat }), ['chat', 'home']);
  assert.equal(shortcutsChanged(d, { ...d, home: 'CommandOrControl+Alt+Shift+O' }), true);
  // 보이는 순서: 패널, 펫 앞에 온다 (기존 순서 시험을 지킨다)
  assert.ok(SHORTCUT_IDS.indexOf('home') < SHORTCUT_IDS.indexOf('panel'));
});
