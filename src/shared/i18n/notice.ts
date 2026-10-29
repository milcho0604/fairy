import type { Translation } from './types.ts';

// 공지 창 (main/notice-window.ts, main/notices.ts). 공지 글 자체는 공지 파일(site/notices.json)에 ko, en 으로 온다
export const ko = {
  'notice.window': '페어리 공지',
  'notice.kind.info': '알림',
  'notice.kind.important': '중요',
  'notice.kind.update': '업데이트 권장',
  'notice.kind.force': '꼭 필요한 업데이트',
  'notice.close': '닫기',
  'notice.ok': '확인',
  'notice.link': '자세히 보기',
  'notice.later': '나중에',
  'notice.update': '업데이트',
  'notice.force.title': '업데이트가 필요해',
  'notice.force.body': '이 버전은 이제 쓸 수 없어. 새 버전으로 업데이트해 줘. 그때까지 AI 대화는 쉴게.',
  'notice.force.versions': (v: { current: string; min: string; latest: string }) =>
    `지금 ${v.current}, 필요한 버전 ${v.min} 이상, 새 버전 ${v.latest}`,
  'notice.force.escape': (v: { mac: boolean }) =>
    `백업은 설정 > 데이터와 계정 > 내보내기, 끄기는 ${v.mac ? '메뉴 막대' : '알림 영역'} 아이콘 메뉴의 끝내기에서 할 수 있어.`,
};

export const en: Translation<typeof ko> = {
  'notice.window': 'fairy notice',
  'notice.kind.info': 'Notice',
  'notice.kind.important': 'Important',
  'notice.kind.update': 'Update recommended',
  'notice.kind.force': 'Update required',
  'notice.close': 'Close',
  'notice.ok': 'OK',
  'notice.link': 'Learn more',
  'notice.later': 'Later',
  'notice.update': 'Update',
  'notice.force.title': 'An update is required',
  'notice.force.body':
    "This version can't be used anymore. Please update to the new version. AI chat is paused until then.",
  'notice.force.versions': (v: { current: string; min: string; latest: string }) =>
    `Now ${v.current}, needs ${v.min} or later, new version ${v.latest}`,
  'notice.force.escape': (v: { mac: boolean }) =>
    `You can back up in Settings > Data and account > Export, and quit from the ${v.mac ? 'menu bar' : 'notification area'} icon menu.`,
};
