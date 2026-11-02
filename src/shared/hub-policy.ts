// 큰 창의 페어리, 비서 구역이 메인에 부를 수 있는 것의 허용표 (설정 창 화면 조각을 쓰지만 설정 창 전체 권한은 주지 않는다).
// 메인(settings-window.ts)이 채널과 설정 키를 이 표로 거르고, 큰 창 preload 는 같은 이름의 메서드만 연다 (HubBridge).
import type { Settings } from './settings.ts';

/** 큰 창 구역이 부르는 설정 다리 메서드 (SettingsBridge 의 이름 그대로) */
export const HUB_METHODS = [
  'get',
  'set',
  'setScale',
  'openMaker',
  'importFriend',
  'galleryList',
  'galleryAdopt',
  'galleryShare',
  'syncCalendar',
  'choosePet',
  'removeSavedPet',
  'remakeBody',
  'cancelRemake',
] as const;
export type HubMethod = (typeof HUB_METHODS)[number];

/** 큰 창에서 set 할 수 있는 설정 키: 페어리 구역(이름, 모습, 말투, 움직임, 삐짐, 성능, 친구)과 비서 구역(말 걸기, 만나는 시간, 회고, 캘린더, AI 도우미, 규칙, 기억) */
export const HUB_SETTING_KEYS: readonly (keyof Settings)[] = [
  'persona',
  'speech',
  'doingBubble',
  'petName',
  'petNameEdited',
  'pet3d',
  'petStyle',
  'petGaits',
  'wander',
  'petChips',
  'clickGrow',
  'lookAtCursor',
  'dayRhythm',
  'typeAlong',
  'petClick',
  'petDoubleClick',
  'restDays',
  'spicy',
  'boost',
  'sysMonitor',
  'seasonWear',
  'friends',
  'chatter',
  'routine',
  'review',
  'reviewMinute',
  'dailyNotes',
  'eveningNotes',
  'icsUrl',
  'aiKnowsTodos',
  'aiPetTools',
  'diaryAi',
  'petRules',
  'petMemory',
  'petMemoryPending',
];

/** 큰 창이 보낸 설정 조각이 허용된 키만 담았는가 (객체가 아니거나 빈 조각도 거절) */
export function hubPatchOk(patch: unknown): boolean {
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) return false;
  const keys = Object.keys(patch);
  return keys.length > 0 && keys.every((k) => (HUB_SETTING_KEYS as readonly string[]).includes(k));
}
