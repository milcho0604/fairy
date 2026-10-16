// 설정 창 탭 (설정 창 재구성 2026-10-10). 칸이 스무 개 가까이 한 줄로 길어서 탭 여섯으로 나눈다.
// 탭마다 어떤 칸이 들어가는지는 화면(settings/tabs/*.tsx)이 정하고, 여기는 탭 이름과 순서, 옮기기만 둔다.
import type { SettingsSection } from './ipc.ts';

/** 늘어놓는 순서. 펫, 비서와 알림, AI 와 대화, 편의(단축키, 언어, 시작), 데이터와 저장 공간, 정보와 베타 */
export const SETTINGS_TABS = ['pet', 'assist', 'ai', 'ease', 'data', 'about'] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

export const isSettingsTab = (v: unknown): v is SettingsTab =>
  typeof v === 'string' && (SETTINGS_TABS as readonly string[]).includes(v);

/** 바로 보여 줄 칸이 든 탭 (메뉴 막대 "의견 보내기" → 베타 기록은 정보 탭, 두 번 눌러 연 백업 파일 → 데이터 탭) */
const SECTION_TAB: Record<SettingsSection, SettingsTab> = {
  stats: 'about',
  restore: 'data',
  friends: 'data',
};

export const tabOfSection = (section: SettingsSection): SettingsTab => SECTION_TAB[section];

const isSection = (v: string): v is SettingsSection => Object.hasOwn(SECTION_TAB, v);

/**
 * 창 주소의 # 뒤로 처음 탭을 정한다. 칸 이름(#stats)이면 그 칸의 탭, 탭 이름(#ai)이면 그 탭 (메인이 지난번 탭을 넘긴다).
 * 모르는 값이면 첫 탭
 */
export function tabFromHash(hash: string): SettingsTab {
  const v = hash.replace(/^#/, '');
  if (isSection(v)) return tabOfSection(v);
  return isSettingsTab(v) ? v : SETTINGS_TABS[0];
}

/** 키로 탭 옮기기: 앞뒤(-1, +1)는 끝에서 돌아 들어오고, 'first', 'last' 는 처음과 끝 */
export function stepTab(now: SettingsTab, step: -1 | 1 | 'first' | 'last'): SettingsTab {
  const n = SETTINGS_TABS.length;
  if (step === 'first') return SETTINGS_TABS[0];
  if (step === 'last') return SETTINGS_TABS[n - 1] as SettingsTab;
  const i = SETTINGS_TABS.indexOf(now);
  return SETTINGS_TABS[(i + step + n) % n] as SettingsTab;
}

/**
 * 탭 목록 키 (aria tablist 관례): ← → (세로로 늘어놓았으면 ↑ ↓ 도), Home, End. 탭 키가 아니면 undefined
 */
export function tabKeyStep(key: string, vertical: boolean): -1 | 1 | 'first' | 'last' | undefined {
  if (key === 'ArrowLeft' || (vertical && key === 'ArrowUp')) return -1;
  if (key === 'ArrowRight' || (vertical && key === 'ArrowDown')) return 1;
  if (key === 'Home') return 'first';
  if (key === 'End') return 'last';
  return undefined;
}

/**
 * 창 어디서나 듣는 탭 키: Cmd/Ctrl+[ ] 앞뒤 탭, Cmd/Ctrl+1~6 그 탭 (패널의 Cmd+1~5 와 같은 꼴).
 * mod 는 맥이면 Cmd, 아니면 Ctrl 이 눌렸는지. Option/Alt, Shift 가 같이 눌렸으면 다른 조합이라 넘긴다
 */
export function globalTabKey(
  e: { key: string; code: string; mod: boolean; altKey: boolean; shiftKey: boolean },
  now: SettingsTab,
): SettingsTab | undefined {
  if (!e.mod || e.altKey || e.shiftKey) return undefined;
  if (e.code === 'BracketLeft') return stepTab(now, -1);
  if (e.code === 'BracketRight') return stepTab(now, 1);
  const m = /^Digit([1-9])$/.exec(e.code);
  if (m) return SETTINGS_TABS[Number(m[1]) - 1];
  return undefined;
}
