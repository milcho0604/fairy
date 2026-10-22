import type { Translation } from './types.ts';

// 큰 창 껍데기와 "패널 보기" 설정 (이슈 #161, 큰 창 설계 #159)
// 줄표와 가운뎃점은 사전 글에 쓰지 않는다 (i18n.test.ts). "모드"라는 말은 쓰지 않는다 (서버 모드, 절전, 부스트와 겹친다)
export const ko = {
  'common.title.home': '페어리',
  'settings.panelView': '패널 보기',
  'settings.panelViewAria': '패널 보기 고르기',
  'settings.panelView.compact': '작은 패널',
  'settings.panelView.window': '큰 창',
  'settings.panelViewHint':
    '페어리를 누르거나 패널 단축키를 눌렀을 때 여는 것을 골라. 큰 창은 사이드바가 있는 일반 창이고, 열려 있는 동안 Dock(맥)이나 작업 표시줄에 보여.',
  'settings.shortcut.home': '큰 창 열기, 숨기기',
  'pet.shortcut.home': '큰 창 열기',
  'tray.openHome': '큰 창 열기',
  'pet.menu.openHome': '큰 창으로 열기',
  'home.nav': '구역',
  'home.nav.chat': '채팅',
  'home.nav.friends': '친구',
  'home.opensWindow': '따로 창으로 열려',
  'home.openOnPet': '펫을 누르면 이 창으로 열기',
  'home.settings': '설정',
  'home.keys': '구역 옮기기',
};

export const en: Translation<typeof ko> = {
  'common.title.home': 'fairy',
  'settings.panelView': 'Panel view',
  'settings.panelViewAria': 'Choose the panel view',
  'settings.panelView.compact': 'Small panel',
  'settings.panelView.window': 'Large window',
  'settings.panelViewHint':
    'Choose what opens when you click the fairy or press the panel shortcut. The large window is a normal window with a sidebar, and it shows in the Dock (Mac) or the taskbar while open.',
  'settings.shortcut.home': 'Open or hide the large window',
  'pet.shortcut.home': 'Open large window',
  'tray.openHome': 'Open large window',
  'pet.menu.openHome': 'Open in large window',
  'home.nav': 'Sections',
  'home.nav.chat': 'Chat',
  'home.nav.friends': 'Friends',
  'home.opensWindow': 'Opens in its own window',
  'home.openOnPet': 'Open this window when I click the fairy',
  'home.settings': 'Settings',
  'home.keys': 'Switch sections',
};
