import type { Translation } from './types.ts';

// 설정 창 탭 (설정 창 재구성 2026-10-10)
export const ko = {
  'settings.tabs.label': '설정 묶음',
  'settings.tabs.hits': (v: { n: number }) => `맞는 칸 ${v.n}개`,
  // 탭 이름은 짧게 (좁은 창에서 여섯이 한 줄에 들어가게), 풀이는 찾기 머리말과 마우스 올렸을 때
  'settings.tab.pet': '펫',
  'settings.tab.pet.hint': '펫과 친구 펫',
  'settings.tab.assist': '비서',
  'settings.tab.assist.hint': '비서와 알림',
  'settings.tab.ai': 'AI',
  'settings.tab.ai.hint': 'AI와 대화',
  'settings.tab.ease': '편의',
  'settings.tab.ease.hint': '단축키, 언어, 시작',
  'settings.tab.data': '데이터',
  'settings.tab.data.hint': '백업과 저장 공간',
  'settings.tab.about': '정보',
  'settings.tab.about.hint': '업데이트와 베타 기록',
  'settings.tabKeys': '설정 탭 옮기기 (설정 창에서)',
};

export const en: Translation<typeof ko> = {
  'settings.tabs.label': 'Settings groups',
  'settings.tabs.hits': (v: { n: number }) => `${v.n} matching ${v.n === 1 ? 'section' : 'sections'}`,
  'settings.tab.pet': 'Pet',
  'settings.tab.pet.hint': 'Pet and friends',
  'settings.tab.assist': 'Assist',
  'settings.tab.assist.hint': 'Assistant and alerts',
  'settings.tab.ai': 'AI',
  'settings.tab.ai.hint': 'AI and chat',
  'settings.tab.ease': 'General',
  'settings.tab.ease.hint': 'Shortcuts, language, startup',
  'settings.tab.data': 'Data',
  'settings.tab.data.hint': 'Backup and storage',
  'settings.tab.about': 'About',
  'settings.tab.about.hint': 'Updates and beta stats',
  'settings.tabKeys': 'Switch settings tabs (in Settings)',
};
