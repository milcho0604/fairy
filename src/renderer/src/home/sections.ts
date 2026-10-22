// 큰 창 사이드바의 구역과 창 안 단축키 (이슈 #161, 큰 창 설계 #159).
// 구역은 본문 탭(오늘, 할 일, 일정, 메모, 상점)과 채팅(창 안에 품음), 따로 창을 여는 것(친구)이 섞여 있다. 순서가 곧 Cmd/Ctrl+1~ 단축키다.
import type { I18nKey } from '../../../shared/i18n/index.ts';
import type { PanelTab } from '../../../shared/ipc.ts';
import { type ModKeyLike, tabByKey } from '../panel/keys.ts';

export interface HomeSection {
  id: PanelTab | 'chat' | 'friends';
  /** tab: 본문 칸을 바꾼다. chat: 본문 칸 자리에 채팅을 품는다 (#165). window: 따로 창을 연다 (설정의 친구 칸) */
  kind: 'tab' | 'chat' | 'window';
  label: I18nKey;
}

export const HOME_SECTIONS: readonly HomeSection[] = [
  { id: 'today', kind: 'tab', label: 'panel.tab.today' },
  { id: 'todo', kind: 'tab', label: 'panel.tab.todo' },
  { id: 'event', kind: 'tab', label: 'panel.tab.event' },
  { id: 'note', kind: 'tab', label: 'panel.tab.note' },
  { id: 'chat', kind: 'chat', label: 'home.nav.chat' },
  { id: 'shop', kind: 'tab', label: 'panel.tab.shop' },
  // 서버 모드, 로그인, 친구 기능이 켜졌을 때만
  { id: 'friends', kind: 'window', label: 'home.nav.friends' },
];

/** 지금 보이는 구역들 (친구는 기능이 켜졌을 때만) */
export function visibleSections(friendsOn: boolean): HomeSection[] {
  return HOME_SECTIONS.filter((s) => s.id !== 'friends' || friendsOn);
}

/** Cmd/Ctrl + 1~(보이는 구역 수) 로 고른 구역 */
export function sectionForKey(e: ModKeyLike, mac: boolean, friendsOn: boolean): HomeSection | undefined {
  const list = visibleSections(friendsOn);
  const i = tabByKey(e, mac, list.length);
  return i === undefined ? undefined : list[i];
}

/** 구역 풀이에 보이는 단축키 ("Cmd+3"). 안 보이는 구역이면 undefined */
export function sectionShortcut(id: HomeSection['id'], friendsOn: boolean, mod: string): string | undefined {
  const i = visibleSections(friendsOn).findIndex((s) => s.id === id);
  return i < 0 ? undefined : `${mod}+${i + 1}`;
}

export type HomeKeyAction = 'settings' | 'close' | 'find';

/** 수식키 하나만 눌린 키 (맥 Cmd, 그 밖 Ctrl). Shift, Option 이 같이 눌렸으면 아니다 */
const onlyMod = (e: ModKeyLike, mac: boolean) =>
  (mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey) && !e.altKey && !e.shiftKey && !e.isComposing;

/** Cmd/Ctrl+, 설정, Cmd/Ctrl+W 닫기, Cmd/Ctrl+F 찾기. 한글 입력 중에도 되게 code 로 본다 */
export function homeKeyAction(e: ModKeyLike, mac: boolean): HomeKeyAction | undefined {
  if (!onlyMod(e, mac)) return undefined;
  const code = e.code ?? '';
  const key = e.key.toLowerCase();
  if (code === 'Comma' || key === ',') return 'settings';
  if (code === 'KeyW' || key === 'w') return 'close';
  if (code === 'KeyF' || key === 'f') return 'find';
  return undefined;
}
