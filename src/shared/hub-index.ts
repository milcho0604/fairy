// 설정에서 큰 창 구역(페어리, 비서)으로 옮긴 항목의 찾기 표.
// 설정 찾기에서 이 말들이 나오면 "페어리 구역에 있어" 한 줄과 가는 단추를 보인다 (옮긴 항목을 못 찾고 헤매지 않게).
// words 는 한국어와 영어를 같이 둔다. 화면에 실제로 있는 항목 이름에만 붙인다.
import { noteQuery } from './note-store.ts';

export type HubTarget = 'pet' | 'assist';

export interface HubItem {
  /** 어느 구역에 있는가 */
  where: HubTarget;
  /** 구역 안 묶음 (hub 사전의 hub.group.* 열쇠 끝) */
  group: string;
  /** 찾는 말 (공백으로 나눈 낱말, 한국어와 영어) */
  words: string;
}

export const HUB_ITEMS: readonly HubItem[] = [
  {
    where: 'pet',
    group: 'look',
    words: '이름 모습 사진 펫 만들기 포즈 크기 입체 3d 옷 name look photo pose size outfit',
  },
  { where: 'pet', group: 'voice', words: '말투 성격 대사 말끝 효과음 persona tone speech lines wording' },
  {
    where: 'pet',
    group: 'move',
    words: '움직임 돌아다니기 걷기 걸음새 따라 보기 클릭 더블클릭 wander walk gait click cursor',
  },
  { where: 'pet', group: 'friends', words: '친구 페어리 공유 갤러리 friend share gallery' },
  { where: 'pet', group: 'mood', words: '삐짐 쉬는 날 매운맛 sulk rest days spicy' },
  { where: 'pet', group: 'perf', words: '부스트 시스템 모니터 성능 boost monitor performance' },
  { where: 'assist', group: 'talk', words: '말풍선 수다 가끔 한마디 말 빈도 bubbles chatter frequency' },
  { where: 'assist', group: 'routine', words: '만나는 시간 출근 퇴근 루틴 meeting time routine' },
  { where: 'assist', group: 'review', words: '하루 회고 쪽지 저녁 review daily note evening' },
  { where: 'assist', group: 'calendar', words: '캘린더 구글 일정 가져오기 ics calendar google import' },
  {
    where: 'assist',
    group: 'ai',
    words: '규칙 기억 기억하는 것 할 일 알기 도구 일기 rules memory todos tools diary',
  },
];

/** 찾는 말(낱말마다 모두 있어야 한다)에 맞는 옮긴 항목들 */
export function movedHits(query: string, composing = false): HubItem[] {
  const words = query.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const res = words.map((w, i) => noteQuery(w, composing && i === words.length - 1) as RegExp);
  return HUB_ITEMS.filter((it) => res.every((re) => re.test(it.words.normalize('NFC').toLowerCase())));
}
