// 단축키 바꾸기 (v2). 설정 창에서 키를 눌러 기록하면 Electron 단축키 글자(Accelerator)로 바꾼다.
import { t } from './i18n/index.ts';

export type ShortcutId = 'hide' | 'quickAdd';

export const SHORTCUT_DEFAULTS: Record<ShortcutId, string> = {
  hide: 'CommandOrControl+Alt+Shift+H',
  quickAdd: 'CommandOrControl+Alt+Shift+N',
};

// 이름은 지금 말로 읽는다 (getter)
export const SHORTCUT_LABEL: Readonly<Record<ShortcutId, string>> = {
  get hide() {
    return t('settings.shortcut.hide');
  },
  get quickAdd() {
    return t('settings.shortcut.quickAdd');
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
 * 누른 키를 단축키 글자로. 전역 단축키라 다른 앱과 덜 겹치게 수식키(Cmd/Ctrl, Alt) 중 하나 이상이 있어야 한다.
 * 맥은 Cmd 를, 그 밖은 Ctrl 을 CommandOrControl 로 적는다 (설정 파일을 두 운영체제가 같이 쓸 수 있게).
 * 못 쓰는 조합이면 이유를 담은 { error }.
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
  const strong = primary || e.altKey || (mac && e.ctrlKey);
  if (!strong && !/^F\d+$/.test(key))
    return {
      error: t('settings.shortcut.needMod', { mod: mac ? 'Cmd' : 'Ctrl', alt: mac ? 'Option' : 'Alt' }),
    };
  parts.push(key);
  return { accelerator: parts.join('+') };
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
