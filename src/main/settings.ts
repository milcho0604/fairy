import { applyPatch, parseSettings, type Settings } from '../shared/settings.ts';
import { readJson, writeJson } from './store.ts';

// 설정 저장소. 바뀌면 듣는 쪽(펫, 채팅, 메뉴 막대, 설정 창)에 알린다.
// 예전 판은 수다 빈도와 숨기기 안내 횟수를 pet-settings.json 에 두었다. 처음 한 번 합쳐 읽는다.

const FILE = 'settings';
const LEGACY_FILE = 'pet-settings';

type Listener = (next: Settings, prev: Settings) => void;

let current: Settings | undefined;
const listeners = new Set<Listener>();

function load(): Settings {
  current ??= parseSettings({
    ...((readJson(LEGACY_FILE) as object) ?? {}),
    ...((readJson(FILE) as object) ?? {}),
  });
  return current;
}

export const settings = {
  get(): Settings {
    return load();
  },
  /** 바꿀 값만 준다. 틀린 값은 무시된다. 바뀐 뒤 설정을 돌려준다. */
  set(patch: Partial<Settings>): Settings {
    const prev = load();
    const next = applyPatch(prev, patch);
    if (JSON.stringify(next) === JSON.stringify(prev)) return prev;
    current = next;
    writeJson(FILE, next);
    for (const l of listeners) l(next, prev);
    return next;
  },
  onChange(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
