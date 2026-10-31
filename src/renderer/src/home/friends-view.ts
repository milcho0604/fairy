// 큰 창 친구 구역이 무엇을 그릴지 정한다 (FriendsPage.tsx). 화면 없이 시험한다.
// 못 쓰면 빈 목록 대신 까닭과 여는 길, 아직 못 받았으면 불러오는 중, 받기에 실패했으면 다시 시도한다는 글, 0명이면 초대 안내, 그 밖에는 목록.
import type { I18nKey } from '../../../shared/i18n/index.ts';
import type { FriendsList, FriendsOff, FriendsState } from '../../../shared/server-friends.ts';

export type FriendsViewKind =
  | { kind: 'loading' }
  | { kind: 'off'; reason: FriendsOff; text: I18nKey }
  | { kind: 'problem' }
  | { kind: 'empty'; list: FriendsList }
  | { kind: 'list'; list: FriendsList };

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
  if (!s.list) return s.problem ? { kind: 'problem' } : { kind: 'loading' };
  // 받은 신청이나 보낸 신청만 있어도 목록 화면이다 (0명 안내는 신청도 없을 때만)
  const any = s.list.friends.length + s.list.incoming.length + s.list.outgoing.length > 0;
  return any ? { kind: 'list', list: s.list } : { kind: 'empty', list: s.list };
}
