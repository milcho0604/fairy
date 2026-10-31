import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { FriendItem, FriendsList, FriendsState } from '../../../shared/server-friends.ts';
import { friendsView } from './friends-view.ts';

const friend = (code: string): FriendItem => ({
  code,
  nickname: code,
  since: '2026-10-01T00:00:00Z',
  iShare: false,
  theyShare: false,
  iVisit: false,
  theyVisit: false,
  canTitle: false,
  iTitle: false,
  theyTitle: false,
  busyAt: null,
});

const list = (over: Partial<FriendsList> = {}): FriendsList => ({
  me: { code: 'F-AAAA-BBBB', nickname: '나' },
  friends: [],
  incoming: [],
  outgoing: [],
  blocked: [],
  limits: { friends: 30, giftCoinsPerDay: 0, giftPassesPerDay: 0, requestDays: 7, busyDays: 14 },
  today: { coins: 0, passes: 0 },
  ...over,
});

const state = (over: Partial<FriendsState> = {}): FriendsState => ({
  available: true,
  off: null,
  list: list(),
  problem: null,
  gifts: false,
  passGifts: false,
  calendar: false,
  visit: false,
  visitCustom: false,
  balance: null,
  passes: null,
  prefill: null,
  ...over,
});

test('상태를 아직 못 받았으면 불러오는 중', () => {
  assert.equal(friendsView(undefined).kind, 'loading');
});

test('쓸 수 없으면 까닭마다 다른 글과 까닭 이름을 준다 (빈 목록이 아니다)', () => {
  const texts = new Set<string>();
  for (const off of ['noServer', 'age', 'serverOff', 'signedOut', 'featureOff'] as const) {
    const v = friendsView(state({ available: false, off, list: null }));
    assert.equal(v.kind, 'off');
    if (v.kind === 'off') {
      assert.equal(v.reason, off);
      texts.add(v.text);
    }
  }
  assert.equal(texts.size, 5);
});

test('쓸 수 없는데 까닭을 모르면 운영자가 아직 안 연 것으로 본다', () => {
  const v = friendsView(state({ available: false, off: null, list: null }));
  assert.equal(v.kind === 'off' && v.reason, 'featureOff');
});

test('쓸 수 있는데 목록이 아직 없으면 불러오는 중, 받기에 실패했으면 실패 글', () => {
  assert.equal(friendsView(state({ list: null })).kind, 'loading');
  assert.equal(friendsView(state({ list: null, problem: 'offline' })).kind, 'problem');
});

test('친구도 신청도 없으면 초대 안내', () => {
  assert.equal(friendsView(state()).kind, 'empty');
});

test('친구가 있거나 신청만 있어도 목록 화면', () => {
  assert.equal(friendsView(state({ list: list({ friends: [friend('F-1')] }) })).kind, 'list');
  assert.equal(
    friendsView(
      state({
        list: list({ incoming: [{ id: 1, code: 'F-2', nickname: null, sentAt: '', expiresAt: '' }] }),
      }),
    ).kind,
    'list',
  );
});
