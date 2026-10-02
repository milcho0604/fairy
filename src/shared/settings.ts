// 사용자 설정 (P1-12). 2단계에서 SQLite 로 옮기기 전까지 JSON 파일 하나에 둔다.
import type { ChatterLevel } from './chatter.ts';

export interface Settings {
  /** 펫 이름. 메뉴, 채팅, 말풍선, AI 성격 지시에 쓰인다 */
  petName: string;
  chatter: ChatterLevel;
  /** 가만히 있다가 가끔 걷고 앉기 (P1-06) */
  wander: boolean;
  /** AI 를 사용자 설정(훅, MCP, 스킬) 없이 부르기. 끄면 "내 AI 설정 그대로" */
  aiIsolation: boolean;
  /** 컴퓨터를 켜면 같이 켜기 (설치한 앱에서만 동작) */
  launchAtLogin: boolean;
  /** 숨기기 전 안내를 보여 준 횟수 (P1-10) */
  hideHints: number;
}

export const DEFAULT_SETTINGS: Settings = {
  petName: '콩이',
  chatter: 'normal',
  wander: true,
  aiIsolation: true,
  launchAtLogin: false,
  hideHints: 0,
};

export const PET_NAME_MAX = 12;

/** 펫 이름을 다듬는다. 앞뒤 공백, 줄바꿈, 제어 문자를 빼고 12자까지. 비면 undefined. */
export function cleanPetName(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  // 제어 문자(줄바꿈 포함)는 지운다. 정규식 대신 글자 번호로 걸러 린트 예외를 두지 않는다.
  const printable = [...raw].filter((ch) => {
    const code = ch.codePointAt(0) ?? 0;
    return code >= 0x20 && code !== 0x7f;
  });
  const name = printable.join('').replace(/\s+/g, ' ').trim();
  if (!name) return undefined;
  return [...name].slice(0, PET_NAME_MAX).join('');
}

/** 저장 파일이나 화면에서 온 값을 설정으로 만든다. 모르는 값, 틀린 값은 기본값으로. */
export function parseSettings(raw: unknown, base: Settings = DEFAULT_SETTINGS): Settings {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
  return {
    petName: cleanPetName(r.petName) ?? base.petName,
    chatter:
      r.chatter === 'quiet' || r.chatter === 'normal' || r.chatter === 'chatty' ? r.chatter : base.chatter,
    wander: bool(r.wander, base.wander),
    aiIsolation: bool(r.aiIsolation, base.aiIsolation),
    launchAtLogin: bool(r.launchAtLogin, base.launchAtLogin),
    hideHints:
      typeof r.hideHints === 'number' && Number.isFinite(r.hideHints)
        ? Math.max(0, Math.floor(r.hideHints))
        : base.hideHints,
  };
}

/** 바꾸기: 지금 설정에 바꿀 값만 덮는다. 틀린 값은 무시하고 지금 값을 둔다. */
export function applyPatch(current: Settings, patch: unknown): Settings {
  const p = (typeof patch === 'object' && patch !== null ? patch : {}) as Record<string, unknown>;
  return parseSettings({ ...current, ...p }, current);
}
