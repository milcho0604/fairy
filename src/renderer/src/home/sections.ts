// 큰 창 사이드바의 구역과 창 안 단축키 (이슈 #161, 큰 창 설계 #159).
// 구역은 본문 탭(오늘, 할 일, 메모, 일정, 상점, 기록, 쪽지함, 친구. 앞의 다섯은 작은 패널과 같은 순서)과 채팅(창 안에 품음)이 섞여 있다. 순서가 곧 Cmd/Ctrl+1~ 단축키다.
import type { I18nKey } from '../../../shared/i18n/index.ts';
import type { PanelTab } from '../../../shared/ipc.ts';
import { type ModKeyLike, tabByKey } from '../panel/keys.ts';

export interface HomeSection {
  id: PanelTab | 'chat' | 'friends';
  /** tab: 본문 칸을 바꾼다. chat: 본문 칸 자리에 채팅을 품는다 (#165) */
  kind: 'tab' | 'chat';
  label: I18nKey;
  /** true 면 Cmd/Ctrl+번호에 넣지 않는다 (쪽지함: 8번이던 친구 단축키가 그대로이게) */
  noKey?: boolean;
}

export const HOME_SECTIONS: readonly HomeSection[] = [
  { id: 'today', kind: 'tab', label: 'panel.tab.today' },
  { id: 'todo', kind: 'tab', label: 'panel.tab.todo' },
  { id: 'note', kind: 'tab', label: 'panel.tab.note' },
  { id: 'event', kind: 'tab', label: 'panel.tab.event' },
  { id: 'chat', kind: 'chat', label: 'home.nav.chat' },
  { id: 'shop', kind: 'tab', label: 'panel.tab.shop' },
  // 집중 월간 잔디, 이번 주, 일기, 휴지통을 한 구역에 (#166). 작은 패널에는 없다
  { id: 'records', kind: 'tab', label: 'home.nav.records' },
  // 받은 펫 쪽지, 서버 쪽지, 공지를 다시 읽고 보관하고 지운다 (feat/mailbox). 단축키 번호는 기록 다음이라 1~7번은 그대로다
  { id: 'mail', kind: 'tab', label: 'home.nav.mail', noKey: true },
  // 늘 보인다. 친구 기능을 쓸 수 없으면 본문에 까닭과 여는 길을 보인다 (home/FriendsPage.tsx)
  { id: 'friends', kind: 'tab', label: 'home.nav.friends' },
];

/** 번호 단축키가 있는 구역들 (쪽지함은 번호가 없다) */
const keyed = HOME_SECTIONS.filter((s) => !s.noKey);

/** Cmd/Ctrl + 1~(번호가 있는 구역 수) 로 고른 구역 */
export function sectionForKey(e: ModKeyLike, mac: boolean): HomeSection | undefined {
  const i = tabByKey(e, mac, keyed.length);
  return i === undefined ? undefined : keyed[i];
}

/** 구역 풀이에 보이는 단축키 ("Cmd+3"). 번호가 없는 구역이면 undefined */
export function sectionShortcut(id: HomeSection['id'], mod: string): string | undefined {
  const i = keyed.findIndex((s) => s.id === id);
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
