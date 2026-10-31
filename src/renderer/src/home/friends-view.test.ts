import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { FriendsState } from '../../../shared/server-friends.ts';
import { friendsView } from './friends-view.ts';

const state = (over: Partial<FriendsState> = {}): FriendsState => ({
  available: true,
  off: null,
  list: null,
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
    const v = friendsView(state({ available: false, off }));
    assert.equal(v.kind, 'off');
    if (v.kind === 'off') {
      assert.equal(v.reason, off);
      texts.add(v.text);
    }
  }
  assert.equal(texts.size, 5);
});

test('쓸 수 없는데 까닭을 모르면 운영자가 아직 안 연 것으로 본다', () => {
  const v = friendsView(state({ available: false, off: null }));
  assert.equal(v.kind === 'off' && v.reason, 'featureOff');
});

test('쓸 수 있으면 목록이 아직 없어도 친구 칸을 그린다 (칸이 받는 중과 실패를 보인다)', () => {
  assert.equal(friendsView(state()).kind, 'box');
  assert.equal(friendsView(state({ problem: 'offline' })).kind, 'box');
});
