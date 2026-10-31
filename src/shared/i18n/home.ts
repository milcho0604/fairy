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
  'pet.menu.openHome': '크게 보기',
  'panel.expand': '크게 보기',
  'panel.expandTitle': '크게 보기: 지금 보던 그대로 큰 창에서 열어',
  'panel.expandHint': '크게 볼까요?',
  'home.nav': '구역',
  'home.nav.chat': '채팅',
  'home.nav.records': '기록',
  'home.nav.friends': '친구',
  'home.openOnPet': '펫을 누르면 이 창으로 열기',
  'home.settings': '설정',
  'home.friends.manage': '설정에서 관리',
  'home.friends.manageHint': '친구 신청, 수락, 선물, 일정 공유는 설정 > 데이터와 계정의 친구 칸에서 해.',
  'home.friends.openSettings': '설정 열기',
  'home.friends.off.noServer': '이 판에는 서버 계정이 없어서 친구를 쓸 수 없어.',
  'home.friends.off.age':
    '친구는 만 14세 이상이 서버 계정을 켜야 쓸 수 있어. 설정 > 데이터와 계정에서 나이를 알려 주고 서버 계정을 켜 줘.',
  'home.friends.off.serverOff':
    '서버 계정이 꺼져 있어서 친구를 볼 수 없어. 설정 > 데이터와 계정에서 서버 계정을 켜 줘.',
  'home.friends.off.signedOut': '로그인하지 않아서 친구를 볼 수 없어. 설정 > 데이터와 계정에서 로그인해 줘.',
  'home.friends.off.featureOff':
    '친구 기능을 아직 열지 않았어. 열리면 이 구역에 친구가 보여. 설정 > 데이터와 계정에서 서버 계정 상태를 볼 수 있어.',
  'home.friends.loading': '친구 목록을 불러오는 중이야.',
  'home.friends.problem': '친구 목록을 못 불러왔어. 잠시 뒤 다시 시도할게.',
  'home.friends.emptyTitle': '아직 친구가 없어',
  'home.friends.emptyBody':
    '내 친구 코드나 초대 링크를 보내 봐. 상대가 설정의 친구 칸에 붙여 넣어 신청하면 친구가 돼.',
  'home.friends.since': (v: { when: string }) => `${v.when}부터 친구`,
  'home.friends.theyShare': '나에게 바쁜 시간을 보여 줘',
  'home.friends.iShare': '내 바쁜 시간을 보여 주는 중',
  'home.friends.visit': '펫 놀러 가기 켬',
  'home.friends.incomingN': (v: { n: number }) => `받은 신청 ${v.n}건`,
  'home.friends.outgoingN': (v: { n: number }) => `보낸 신청 ${v.n}건`,
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
  'pet.menu.openHome': 'Open large window',
  'panel.expand': 'Open large window',
  'panel.expandTitle': 'Open large window: keeps what you are looking at',
  'panel.expandHint': 'Want a bigger view?',
  'home.nav': 'Sections',
  'home.nav.chat': 'Chat',
  'home.nav.records': 'Records',
  'home.nav.friends': 'Friends',
  'home.openOnPet': 'Open this window when I click the fairy',
  'home.settings': 'Settings',
  'home.friends.manage': 'Manage in Settings',
  'home.friends.manageHint':
    'Send or accept requests, give gifts, and share your calendar in the Friends box under Settings > Data and account.',
  'home.friends.openSettings': 'Open Settings',
  'home.friends.off.noServer': 'This build has no server account, so Friends is not available.',
  'home.friends.off.age':
    'Friends needs a server account, and you must be 14 or older. Tell us your age and turn on the server account in Settings > Data and account.',
  'home.friends.off.serverOff':
    'The server account is off, so friends cannot show up. Turn it on in Settings > Data and account.',
  'home.friends.off.signedOut':
    'You are not signed in, so friends cannot show up. Sign in under Settings > Data and account.',
  'home.friends.off.featureOff':
    'Friends is not open yet. Once it opens, your friends will show up here. You can check your server account in Settings > Data and account.',
  'home.friends.loading': 'Loading your friends.',
  'home.friends.problem': 'Could not load your friends. We will try again soon.',
  'home.friends.emptyTitle': 'No friends yet',
  'home.friends.emptyBody':
    'Send your friend code or invite link. When they paste it into the Friends box in Settings and send a request, you become friends.',
  'home.friends.since': (v: { when: string }) => `Friends since ${v.when}`,
  'home.friends.theyShare': 'Shows you their busy times',
  'home.friends.iShare': 'You show them your busy times',
  'home.friends.visit': 'Pet visits on',
  'home.friends.incomingN': (v: { n: number }) => `Requests for you (${v.n})`,
  'home.friends.outgoingN': (v: { n: number }) => `Sent requests (${v.n})`,
  'home.keys': 'Switch sections',
};
