import {
  applyPatch,
  cleanPetName,
  followKindName,
  parseSettings,
  type Settings,
  type SettingsPatch,
} from '../shared/settings.ts';
import { readJson, writeJson } from './store.ts';

// 설정 저장소. 바뀌면 듣는 쪽(펫, 채팅, 메뉴 막대, 설정 창)에 알린다.
// 예전 판은 수다 빈도와 숨기기 안내 횟수를 pet-settings.json 에 두었다. 처음 한 번 합쳐 읽는다.

const FILE = 'settings';
const LEGACY_FILE = 'pet-settings';

type Listener = (next: Settings, prev: Settings) => void;

let current: Settings | undefined;
const listeners = new Set<Listener>();

/** 저장 파일에 펫 이름이 있었는지 (없으면 처음 켠 것이라 말에 맞는 기본 이름을 줄 수 있다) */
let namedOnDisk = false;

function load(): Settings {
  if (!current) {
    const raw = {
      ...((readJson(LEGACY_FILE) as object) ?? {}),
      ...((readJson(FILE) as object) ?? {}),
    } as Record<string, unknown>;
    namedOnDisk = cleanPetName(raw.petName) !== undefined;
    // 이름을 손댔는지 기억하는 칸이 생기기 전부터 쓰던 사람은 손댄 것으로 본다 (모습을 바꿔도 이름이 그대로)
    if (namedOnDisk && typeof raw.petNameEdited !== 'boolean') raw.petNameEdited = true;
    current = parseSettings(raw);
  }
  return current;
}

export const settings = {
  get(): Settings {
    return load();
  },
  /** 바꿀 값만 준다. 틀린 값은 무시된다. 바뀐 뒤 설정을 돌려준다. */
  set(patch: SettingsPatch): Settings {
    const prev = load();
    const next = followKindName(prev, applyPatch(prev, patch), patch);
    if (JSON.stringify(next) === JSON.stringify(prev)) return prev;
    current = next;
    writeJson(FILE, next);
    for (const l of listeners) l(next, prev);
    return next;
  },
  /**
   * 처음 켤 때 펫 이름을 화면 말에 맞춘다 (영어면 '콩이' 대신 영어 이름). 저장된 이름이 있으면 건드리지 않고,
   * 정한 이름은 바로 저장해 나중에 말을 바꿔도 이름이 따라 바뀌지 않는다 (버그잡이 6차)
   */
  nameIfNew(name: string): void {
    const now = load();
    if (namedOnDisk) return;
    namedOnDisk = true;
    current = { ...now, petName: cleanPetName(name) ?? now.petName };
    writeJson(FILE, current);
  },
  onChange(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
