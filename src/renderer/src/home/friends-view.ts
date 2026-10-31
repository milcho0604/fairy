// 큰 창 친구 구역이 무엇을 그릴지 정한다 (FriendsPage.tsx). 화면 없이 시험한다.
// 못 쓰면 빈 목록 대신 까닭과 여는 길, 아직 못 받았으면 불러오는 중, 쓸 수 있으면 설정의 친구 칸과 같은 구성요소(목록, 신청, 선물, 공유).
import type { I18nKey } from '../../../shared/i18n/index.ts';
import type { FriendsOff, FriendsState } from '../../../shared/server-friends.ts';

export type FriendsViewKind =
  | { kind: 'loading' }
  | { kind: 'off'; reason: FriendsOff; text: I18nKey }
  | { kind: 'box' };

const OFF_TEXT: Record<FriendsOff, I18nKey> = {
  noServer: 'home.friends.off.noServer',
  age: 'home.friends.off.age',
  serverOff: 'home.friends.off.serverOff',
  signedOut: 'home.friends.off.signedOut',
  featureOff: 'home.friends.off.featureOff',
};

export function friendsView(s: FriendsState | undefined): FriendsViewKind {
  if (!s) return { kind: 'loading' };
  if (!s.available) {
    const reason = s.off ?? 'featureOff';
    return { kind: 'off', reason, text: OFF_TEXT[reason] };
  }
  return { kind: 'box' };
}
