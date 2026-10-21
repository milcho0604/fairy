import type { Translation } from './types.ts';

// 쓰던 글과 보던 위치를 잃지 않기 (이슈 #145, 큰 창 설계 #159)
// 줄표와 가운뎃점은 사전 글에 쓰지 않는다 (i18n.test.ts)
export const ko = {
  'keep.pin': '패널 고정',
  'keep.unpin': '패널 고정 풀기',
  'keep.pinHint': '켜면 다른 곳을 눌러도 닫히지 않아. Esc, 펫 누르기, 단축키로 닫아.',
  'settings.panelSection': '패널',
  'settings.panelPin': '패널 고정',
  'settings.panelPinHint':
    '켜면 패널이 다른 곳을 눌러도 닫히지 않아. Esc, 펫 누르기, 단축키로만 닫혀. 패널 머리의 핀으로도 바꿀 수 있어.',
  'keep.retry': '다시 묻기',
  'keep.retryTitle': '같은 AI에게 같은 질문을 다시 해',
  'keep.recallHint': '빈 칸에서 ↑ 를 누르면 마지막 질문이 돌아와',
};

export const en: Translation<typeof ko> = {
  'keep.pin': 'Keep panel open',
  'keep.unpin': 'Stop keeping panel open',
  'keep.pinHint':
    'When on, clicking elsewhere does not close it. Close it with Esc, the pet, or the shortcut.',
  'settings.panelSection': 'Panel',
  'settings.panelPin': 'Keep panel open',
  'settings.panelPinHint':
    'When on, the panel stays open when you click elsewhere. Only Esc, clicking the pet, or the shortcut closes it. The pin in the panel header does the same.',
  'keep.retry': 'Ask again',
  'keep.retryTitle': 'Ask the same AI the same question again',
  'keep.recallHint': 'Press ↑ in an empty box to bring back your last question',
};
