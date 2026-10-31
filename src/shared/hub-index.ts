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
    words:
      '이름 모습 외형 꾸미기 사진 만들기 포즈 크기 입체 3d 옷 name look appearance photo pose size outfit',
  },
  {
    where: 'pet',
    group: 'voice',
    words: '말투 어투 성격 대사 말끝 persona tone speech lines wording personality',
  },
  {
    where: 'pet',
    group: 'move',
    words: '움직임 돌아다니기 걷기 걸음새 클릭 더블클릭 커서 반응 wander walk gait click cursor movement',
  },
  { where: 'pet', group: 'friends', words: '친구 페어리 공유 갤러리 friend share gallery' },
  { where: 'pet', group: 'mood', words: '삐짐 토라짐 휴식 쉬는 쉬는날 매운맛 sulk rest spicy' },
  { where: 'pet', group: 'perf', words: '부스트 시스템 모니터 성능 boost monitor performance' },
  { where: 'assist', group: 'talk', words: '말풍선 수다 한마디 말 걸기 빈도 bubbles chatter frequency' },
  { where: 'assist', group: 'routine', words: '만나는 시간 출근 퇴근 출퇴근 루틴 meeting time routine' },
  { where: 'assist', group: 'review', words: '하루 회고 쪽지 저녁 아침 review daily note evening' },
  {
    where: 'assist',
    group: 'calendar',
    words: '캘린더 달력 구글 일정 가져오기 연동 ics calendar google import',
  },
  {
    where: 'assist',
    group: 'ai',
    words: 'ai 도우미 규칙 기억 할 일 도구 일기 helper rules memory todos tools diary',
  },
];

/**
 * 찾는 말(낱말마다 모두 맞아야 한다)에 맞는 옮긴 항목들.
 * 낱말의 앞부분이 항목 낱말의 앞과 맞아야 한다 ("ai" 가 "gait", "daily" 안에서 맞지 않게). 마지막 낱말은 조합 중일 수 있다
 */
export function movedHits(query: string, composing = false): HubItem[] {
  const words = query.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const res = words.map((w, i) => {
    const re = noteQuery(w, composing && i === words.length - 1) as RegExp;
    return new RegExp(`(?:^|\\s)(?:${re.source})`, 'u');
  });
  return HUB_ITEMS.filter((it) => {
    const text = it.words.normalize('NFC').toLowerCase();
    return res.every((re) => re.test(text));
  });
}
