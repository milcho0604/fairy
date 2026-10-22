// 탭 정의와 구역 단축키. 껍데기(작은 패널의 PanelApp, 큰 창의 사이드바)가 같은 표를 쓴다.
// 순서가 곧 단축키다: Cmd/Ctrl + 1 이 첫째, 다섯째까지.
import type { I18nKey } from '../../../shared/i18n/index.ts';
import type { PanelTab } from '../../../shared/ipc.ts';
import { type ModKeyLike, tabByKey } from './keys.ts';

export interface TabDef {
  id: PanelTab;
  label: I18nKey;
}

export const TABS: readonly TabDef[] = [
  { id: 'today', label: 'panel.tab.today' },
  { id: 'todo', label: 'panel.tab.todo' },
  { id: 'note', label: 'panel.tab.note' },
  { id: 'event', label: 'panel.tab.event' },
  { id: 'shop', label: 'panel.tab.shop' },
];

/** 값이 탭 이름인가 (주소 해시, 저장소에서 읽은 값을 거른다) */
export function isTab(v: unknown): v is PanelTab {
  return TABS.some((tb) => tb.id === v);
}

/** 단축키 누른 탭. 수식키(맥 Cmd, 그 밖 Ctrl) + 1~탭 수 */
export function tabForKey(e: ModKeyLike, mac: boolean): PanelTab | undefined {
  const i = tabByKey(e, mac, TABS.length);
  return i === undefined ? undefined : TABS[i]?.id;
}

/** 탭 풀이에 보이는 단축키 ("Cmd+3") */
export function tabShortcut(id: PanelTab, mod: string): string {
  return `${mod}+${TABS.findIndex((tb) => tb.id === id) + 1}`;
}
