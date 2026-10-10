import type { Translation } from './types.ts';

// 사용자 편의 (2026-10-10 점검): 설정 찾기, 단축키 끄기, 패널 키보드, 대화 첫 질문 예시, 첫 안내 키
export const ko = {
  // 단축키 끄기, 패널 안 키 알려 주기
  'settings.shortcut.off': '끄기',
  'settings.shortcutOff': '단축키를 껐어',
  'settings.panelTabKeys': '패널 탭 옮기기 (패널에서)',
  'settings.panelUndoKeys': '방금 지운 것, 끝낸 것 되돌리기 (패널에서)',

  // 설정 찾기
  'settings.search.label': '설정 찾기',
  'settings.search.placeholder': '설정 찾기 ({keys})',
  'settings.search.empty': '"{q}"에 맞는 설정이 없어. 다른 말로 찾아 봐.',
  'settings.search.clear': '찾는 말 지우기',

  // 패널
  'panel.openSettings': '설정 열기',
  'panel.tabKey': '{tab} ({keys})',

  // 대화 창 첫 질문 예시 (누르면 입력칸에 채운다. 바로 보내지 않는다)
  'chat.starters': '이렇게 물어봐도 돼',
  'chat.starter.today': '오늘 뭐부터 하면 좋을까?',
  'chat.starter.polish': '이 글 자연스럽게 다듬어 줘:\n',
  'chat.starter.break': '5분 쉴 때 할 만한 거 하나 추천해 줘',

  // 첫 안내
  'onboarding.tips.chatDesc': '어디서든 대화 창 열기',
  'onboarding.tips.settings': '설정',
  'onboarding.tips.settingsDesc': (v: { mac: boolean }) =>
    `${v.mac ? '메뉴 막대' : '알림 영역'} 아이콘이나 우클릭 메뉴에서 열어. 설정 창 맨 위 찾기 칸으로 바로 찾을 수 있어.`,
  'onboarding.keys': '← → 키로도 넘길 수 있어',
};

export const en: Translation<typeof ko> = {
  'settings.shortcut.off': 'Turn off',
  'settings.shortcutOff': 'Shortcut turned off',
  'settings.panelTabKeys': 'Switch panel tabs (in the panel)',
  'settings.panelUndoKeys': 'Undo the last remove or done (in the panel)',

  'settings.search.label': 'Search settings',
  'settings.search.placeholder': 'Search settings ({keys})',
  'settings.search.empty': 'No settings match "{q}". Try other words.',
  'settings.search.clear': 'Clear search',

  'panel.openSettings': 'Open settings',
  'panel.tabKey': '{tab} ({keys})',

  'chat.starters': 'You could ask',
  'chat.starter.today': 'What should I do first today?',
  'chat.starter.polish': 'Make this read more naturally:\n',
  'chat.starter.break': 'Suggest one thing to do on a 5-minute break',

  'onboarding.tips.chatDesc': 'Open chat from anywhere',
  'onboarding.tips.settings': 'Settings',
  'onboarding.tips.settingsDesc': (v: { mac: boolean }) =>
    `Open from the ${v.mac ? 'menu bar' : 'tray'} icon or the right-click menu. The search box at the top of Settings finds any setting.`,
  'onboarding.keys': 'You can also use the ← → keys',
};
