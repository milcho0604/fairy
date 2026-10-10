// 단축키 바꾸기 (v2). 설정 창에서 키를 눌러 기록하면 Electron 단축키 글자(Accelerator)로 바꾼다.
import { t } from './i18n/index.ts';

export type ShortcutId = 'hide' | 'quickAdd' | 'chat' | 'look';

/** 모두 Cmd/Ctrl+Option/Alt+Shift 에 글자 하나 (시스템, 편집 조합과 겹치지 않는 자리) */
export const SHORTCUT_DEFAULTS: Record<ShortcutId, string> = {
  hide: 'CommandOrControl+Alt+Shift+H',
  quickAdd: 'CommandOrControl+Alt+Shift+N',
  chat: 'CommandOrControl+Alt+Shift+J',
  look: 'CommandOrControl+Alt+Shift+L',
};

/**
 * 키가 없는 단축키. 아무것도 등록하지 않는다. 새로 생긴 기본 단축키가 사용자가 이미 쓰던 키와 겹치면
 * 사용자 키를 되돌리지 않고 새 쪽을 이것으로 비운다 (리뷰: 업데이트하면 바꿔 둔 단축키가 기본으로 돌아갔다)
 */
export const NO_SHORTCUT = '';

/**
 * 같은 키 조합을 쓰는 단축키 둘. 없으면 undefined. 설정 창은 저장하기 전에 이것으로 겹침을 알리고,
 * 설정 검사도 같은 것으로 겹친 값을 버린다 (버그잡이 6차: 조용히 버리면서 "바꿨어"가 떴다)
 */
export function shortcutClash(keys: Record<ShortcutId, string>): [ShortcutId, ShortcutId] | undefined {
  const ids = Object.keys(SHORTCUT_DEFAULTS) as ShortcutId[];
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i] as ShortcutId;
      const b = ids[j] as ShortcutId;
      // 빈 키끼리는 겹친 게 아니다 (둘 다 꺼 둔 것)
      if (keys[a] !== NO_SHORTCUT && keys[a].toLowerCase() === keys[b].toLowerCase()) return [a, b];
    }
  return undefined;
}

/** 단축키 넷 중 하나라도 바뀌었는지 (설정이 바뀔 때 다시 등록할지) */
export function shortcutsChanged(a: Record<ShortcutId, string>, b: Record<ShortcutId, string>): boolean {
  return (Object.keys(SHORTCUT_DEFAULTS) as ShortcutId[]).some((id) => a[id] !== b[id]);
}

// 이름은 지금 말로 읽는다 (getter)
export const SHORTCUT_LABEL: Readonly<Record<ShortcutId, string>> = {
  get hide() {
    return t('settings.shortcut.hide');
  },
  get quickAdd() {
    return t('settings.shortcut.quickAdd');
  },
  get chat() {
    return t('settings.shortcut.chat');
  },
  get look() {
    return t('settings.shortcut.look');
  },
};

/** 키보드 사건에서 필요한 것만 (시험에서 흉내 내기 쉽게) */
export interface KeyPress {
  key: string;
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

const MODIFIER_KEYS = new Set(['Meta', 'Control', 'Alt', 'Shift', 'OS']);

/** code 로 본 글쇠 이름 (Option 을 누르면 key 가 특수 문자로 바뀌어 code 를 쓴다) */
function keyName(code: string): string | undefined {
  let m = /^Key([A-Z])$/.exec(code);
  if (m) return m[1];
  m = /^Digit(\d)$/.exec(code);
  if (m) return m[1];
  m = /^F(\d{1,2})$/.exec(code);
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 24) return `F${m[1]}`;
  const named: Record<string, string> = {
    Space: 'Space',
    Enter: 'Enter',
    Tab: 'Tab',
    Backspace: 'Backspace',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    Minus: '-',
    Equal: '=',
    BracketLeft: '[',
    BracketRight: ']',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Slash: '/',
    Backslash: '\\',
    Backquote: '`',
  };
  return named[code];
}

/**
 * 누른 키를 단축키 글자로. 맥은 Cmd 를, 그 밖은 Ctrl 을 CommandOrControl 로 적는다 (설정 파일을 두 운영체제가 같이 쓸 수 있게).
 * 전역 단축키라 다른 앱의 키를 가로챈다. 그래서 시스템과 편집 조합(복사, 종료, Spotlight 등)은 막고,
 * 수식키 하나만 쓰는 조합은 하나 더 요구한다 (shortcutProblem). 못 쓰는 조합이면 이유를 담은 { error }.
 */
export function toAccelerator(
  e: KeyPress,
  mac: boolean,
): { accelerator: string } | { error: string } | undefined {
  if (MODIFIER_KEYS.has(e.key)) return undefined; // 수식키만 누른 중
  const key = keyName(e.code);
  if (!key) return { error: t('settings.shortcut.badKey') };
  const primary = mac ? e.metaKey : e.ctrlKey;
  const parts: string[] = [];
  if (primary) parts.push('CommandOrControl');
  if (mac && e.ctrlKey) parts.push('Control');
  if (!mac && e.metaKey) parts.push('Super');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  parts.push(key);
  const accelerator = parts.join('+');
  const error = shortcutProblem(accelerator, mac);
  return error ? { error } : { accelerator };
}

/** 단축키 글자를 운영체제 키로 나눈 것. 맥은 cmd, ctrl 이 따로, 윈도우는 Ctrl 이 ctrl, Win 키가 win */
interface Combo {
  cmd: boolean;
  ctrl: boolean;
  win: boolean;
  alt: boolean;
  shift: boolean;
  key: string;
}

function comboOf(acc: string, mac: boolean): Combo {
  const parts = acc.split('+');
  const key = parts.pop() ?? '';
  const has = (p: string) => parts.includes(p);
  return {
    cmd: mac && (has('CommandOrControl') || has('Super')),
    ctrl: has('Control') || (!mac && has('CommandOrControl')),
    win: !mac && has('Super'),
    alt: has('Alt'),
    shift: has('Shift'),
    key,
  };
}

/** 표 이름: 맥은 Cmd, Ctrl, Option, Shift 순, 윈도우는 Ctrl, Win, Alt, Shift 순 (아래 RESERVED 표와 같은 모양) */
function comboName(c: Combo, mac: boolean): string {
  const names = mac
    ? [c.cmd && 'Cmd', c.ctrl && 'Ctrl', c.alt && 'Option', c.shift && 'Shift']
    : [c.ctrl && 'Ctrl', c.win && 'Win', c.alt && 'Alt', c.shift && 'Shift'];
  return [...names.filter((n): n is string => !!n), c.key].join('+');
}

/** 막는 조합이 무슨 일에 쓰이는지 (settings.shortcut.what.* 글) */
type ReservedUse =
  | 'copy'
  | 'paste'
  | 'pastePlain'
  | 'cut'
  | 'selectAll'
  | 'undo'
  | 'redo'
  | 'save'
  | 'saveAs'
  | 'quit'
  | 'logout'
  | 'lock'
  | 'closeWindow'
  | 'minimize'
  | 'hideApp'
  | 'switchApp'
  | 'switchWindow'
  | 'switchTab'
  | 'spotlight'
  | 'inputSource'
  | 'emoji'
  | 'screenshot'
  | 'fullScreen'
  | 'dock'
  | 'missionControl'
  | 'help'
  | 'voiceOver'
  | 'windowMenu'
  | 'contextMenu'
  | 'rotate';

const each = (use: ReservedUse, ...names: string[]) => names.map((n) => [n, use] as const);

/** 맥 시스템, 편집 조합. 이름은 comboName 모양 */
const RESERVED_MAC = new Map<string, ReservedUse>([
  ...each('copy', 'Cmd+C'),
  ...each('paste', 'Cmd+V'),
  ...each('pastePlain', 'Cmd+Shift+V', 'Cmd+Option+Shift+V'),
  ...each('cut', 'Cmd+X'),
  ...each('selectAll', 'Cmd+A'),
  ...each('undo', 'Cmd+Z'),
  ...each('redo', 'Cmd+Shift+Z'),
  ...each('save', 'Cmd+S'),
  ...each('saveAs', 'Cmd+Shift+S', 'Cmd+Option+Shift+S'),
  ...each('quit', 'Cmd+Q'),
  ...each('logout', 'Cmd+Shift+Q', 'Cmd+Option+Shift+Q'),
  ...each('lock', 'Cmd+Ctrl+Q'),
  ...each('closeWindow', 'Cmd+W', 'Cmd+Option+W', 'Cmd+Shift+W'),
  ...each('minimize', 'Cmd+M', 'Cmd+Option+M'),
  ...each('hideApp', 'Cmd+H', 'Cmd+Option+H'),
  ...each('switchApp', 'Cmd+Tab', 'Cmd+Shift+Tab'),
  ...each('switchWindow', 'Cmd+`', 'Cmd+Shift+`'),
  ...each('switchTab', 'Ctrl+Tab', 'Ctrl+Shift+Tab'),
  ...each('spotlight', 'Cmd+Space', 'Cmd+Option+Space'),
  ...each('inputSource', 'Ctrl+Space', 'Ctrl+Option+Space'),
  ...each('emoji', 'Cmd+Ctrl+Space'),
  ...each('screenshot', 'Cmd+Shift+3', 'Cmd+Shift+4', 'Cmd+Shift+5', 'Cmd+Ctrl+Shift+3', 'Cmd+Ctrl+Shift+4'),
  ...each('fullScreen', 'Cmd+Ctrl+F'),
  ...each('dock', 'Cmd+Option+D'),
  ...each('missionControl', 'Ctrl+Up', 'Ctrl+Down', 'Ctrl+Left', 'Ctrl+Right'),
  ...each('help', 'Cmd+Shift+/'),
  ...each('voiceOver', 'Cmd+F5', 'Cmd+Option+F5'),
]);

/** 윈도우 시스템, 편집 조합. Win 키 조합은 표 없이 모두 막는다 (Windows 가 쓰는 자리) */
const RESERVED_WIN = new Map<string, ReservedUse>([
  ...each('copy', 'Ctrl+C'),
  ...each('paste', 'Ctrl+V'),
  ...each('pastePlain', 'Ctrl+Shift+V'),
  ...each('cut', 'Ctrl+X'),
  ...each('selectAll', 'Ctrl+A'),
  ...each('undo', 'Ctrl+Z'),
  ...each('redo', 'Ctrl+Y', 'Ctrl+Shift+Z'),
  ...each('save', 'Ctrl+S'),
  ...each('saveAs', 'Ctrl+Shift+S'),
  ...each('quit', 'Alt+F4'),
  ...each('closeWindow', 'Ctrl+W', 'Ctrl+F4', 'Ctrl+Shift+W'),
  ...each('switchApp', 'Alt+Tab', 'Alt+Shift+Tab', 'Ctrl+Alt+Tab'),
  ...each('switchTab', 'Ctrl+Tab', 'Ctrl+Shift+Tab'),
  ...each('windowMenu', 'Alt+Space'),
  ...each('inputSource', 'Ctrl+Space', 'Alt+Shift+Space'),
  ...each('contextMenu', 'Shift+F10'),
  ...each('rotate', 'Ctrl+Alt+Up', 'Ctrl+Alt+Down', 'Ctrl+Alt+Left', 'Ctrl+Alt+Right'),
]);

/** 시스템이나 편집에 쓰는 조합이면 그 쓰임 (설정 파일 검사도 이것으로 막는다) */
export function reservedUse(acc: string, mac: boolean): ReservedUse | 'windowsKey' | undefined {
  const c = comboOf(acc, mac);
  if (c.win) return 'windowsKey';
  return (mac ? RESERVED_MAC : RESERVED_WIN).get(comboName(c, mac));
}

/**
 * 단축키로 못 쓰는 까닭 (화면 말). 쓸 수 있으면 undefined.
 * 1. 시스템, 편집 조합 (복사, 종료, 앱 전환, Spotlight, 스크린샷 등)
 * 2. F13~F24 는 혼자 써도 된다 (어느 앱도 안 쓴다). F1~F12 는 수식키 하나 이상 (새로 고침, 도움말 등)
 * 3. 그 밖의 키는 수식키 둘 이상. 맥은 그중 Cmd 나 Ctrl 이 있어야 한다 (Option 조합은 특수 문자 입력).
 *    윈도우는 Ctrl 이나 Alt 가 있어야 한다 (Shift 만이면 대문자 입력). Cmd 하나, Ctrl 하나, Alt 하나는 앱 단축키나 메뉴와 겹친다
 */
export function shortcutProblem(acc: string, mac: boolean): string | undefined {
  const c = comboOf(acc, mac);
  const use = reservedUse(acc, mac);
  if (use === 'windowsKey') return t('settings.shortcut.windowsKey');
  if (use)
    return t('settings.shortcut.reserved', {
      keys: acceleratorLabel(acc, mac).join(' + '),
      what: t(`settings.shortcut.what.${use}`),
    });
  const fNum = /^F(\d{1,2})$/.exec(c.key);
  const mods = [c.cmd, c.ctrl, c.alt, c.shift].filter(Boolean).length;
  if (fNum && Number(fNum[1]) >= 13) return undefined;
  if (fNum) return mods >= 1 ? undefined : t('settings.shortcut.fKey');
  const anchor = mac ? c.cmd || c.ctrl : c.ctrl || c.alt;
  if (!anchor) {
    if (mac && c.alt) return t('settings.shortcut.optionOnly');
    return t('settings.shortcut.needMod', { mod: mac ? 'Cmd' : 'Ctrl', alt: mac ? 'Option' : 'Alt' });
  }
  if (mods < 2) {
    const one = mac ? (c.cmd ? 'Cmd' : 'Ctrl') : c.ctrl ? 'Ctrl' : 'Alt';
    const more = mac ? 'Option, Shift' : c.ctrl ? 'Alt, Shift' : 'Ctrl, Shift';
    return t('settings.shortcut.needMore', { one, more });
  }
  return undefined;
}

/** 화면에 보일 글: CommandOrControl → Cmd/Ctrl, Alt → Option(맥) */
export function acceleratorLabel(acc: string, mac: boolean): string[] {
  return acc.split('+').map((p) => {
    if (p === 'CommandOrControl') return mac ? 'Cmd' : 'Ctrl';
    if (p === 'Alt') return mac ? 'Option' : 'Alt';
    if (p === 'Control') return 'Ctrl';
    if (p === 'Super') return 'Win';
    return p;
  });
}

/** 저장된 값 검사: 우리가 만든 모양인지 (설정 파일을 손으로 고쳐도 이상한 값이 등록되지 않게) */
export function isAccelerator(v: unknown): v is string {
  return (
    typeof v === 'string' &&
    v.length <= 60 &&
    /^((CommandOrControl|Control|Super|Alt|Shift)\+)*([A-Z0-9]|F\d{1,2}|Space|Enter|Tab|Backspace|Up|Down|Left|Right|[-=[\];',./\\`])$/.test(
      v,
    )
  );
}
