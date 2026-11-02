import type { Translation } from './types.ts';

// 설정 창 탭 (설정 창 재구성 2026-10-10)
export const ko = {
  'settings.tabs.label': '설정 묶음',
  'settings.tabs.hits': (v: { n: number }) => `맞는 칸 ${v.n}개`,
  // 탭 이름은 짧게 (좁은 창에서 한 줄에 들어가게), 풀이는 찾기 머리말과 마우스 올렸을 때
  'settings.tab.ai': 'AI 연결',
  'settings.tab.ai.hint': '어떤 AI를 쓸지와 연결',
  'settings.tab.ease': '일반',
  'settings.tab.ease.hint': '알림, 언어, 시작, 단축키',
  'settings.tab.data': '데이터와 계정',
  'settings.tab.data.hint': '로그인, 백업, 저장 공간',
  'settings.tab.about': '정보',
  'settings.tab.about.hint': '업데이트와 내 기록',
  'settings.tabKeys': '설정 탭 옮기기 (설정 창에서)',
};

export const en: Translation<typeof ko> = {
  'settings.tabs.label': 'Settings groups',
  'settings.tabs.hits': (v: { n: number }) => `${v.n} matching ${v.n === 1 ? 'section' : 'sections'}`,
  'settings.tab.ai': 'AI connection',
  'settings.tab.ai.hint': 'Which AI to use and how it connects',
  'settings.tab.ease': 'General',
  'settings.tab.ease.hint': 'Alerts, language, startup, shortcuts',
  'settings.tab.data': 'Data and account',
  'settings.tab.data.hint': 'Sign in, backup, storage',
  'settings.tab.about': 'About',
  'settings.tab.about.hint': 'Updates and my stats',
  'settings.tabKeys': 'Switch settings tabs (in Settings)',
};
