import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  canSendTicket,
  chooseDefault,
  explicitPick,
  type TicketGateInput,
  ticketBlock,
  ticketIsDefaultable,
} from './ticket-gate.ts';

const ok: TicketGateInput = {
  enabled: true,
  age: 'adult',
  serverReady: true,
  signedIn: true,
  access: 'ok',
  tickets: 5,
};

test('못 쓰는 까닭: 조건마다 하나씩', () => {
  assert.equal(ticketBlock(ok), undefined);
  assert.equal(ticketBlock({ ...ok, enabled: false }), 'closed');
  assert.equal(ticketBlock({ ...ok, age: 'teen' }), 'age');
  assert.equal(ticketBlock({ ...ok, age: 'under14' }), 'age');
  assert.equal(ticketBlock({ ...ok, age: null }), 'serverOff');
  assert.equal(ticketBlock({ ...ok, serverReady: false }), 'serverOff');
  assert.equal(ticketBlock({ ...ok, signedIn: false }), 'signedOut');
  assert.equal(ticketBlock({ ...ok, access: null }), 'checking');
  assert.equal(ticketBlock({ ...ok, access: 'off' }), 'closed');
  assert.equal(ticketBlock({ ...ok, access: 'not_allowed' }), 'notAllowed');
  assert.equal(ticketBlock({ ...ok, access: 'blocked' }), 'blocked');
  assert.equal(ticketBlock({ ...ok, access: 'waitlisted' }), 'waitlisted');
  assert.equal(ticketBlock({ ...ok, tickets: 0 }), 'empty');
  assert.equal(ticketBlock({ ...ok, tickets: 1 }), undefined);
  assert.equal(ticketBlock({ ...ok, tickets: null }), undefined);
});

test('로그인 안 함이 장수보다 먼저 보인다', () => {
  assert.equal(ticketBlock({ ...ok, signedIn: false, tickets: 0 }), 'signedOut');
});

test('보내기 문: 막힘이 있으면 안 보낸다, 장수 모름은 서버가 판단', () => {
  assert.equal(canSendTicket(ticketBlock({ ...ok, tickets: 0 })), false);
  assert.equal(canSendTicket(ticketBlock({ ...ok, signedIn: false })), false);
  assert.equal(canSendTicket(ticketBlock({ ...ok, tickets: null })), true);
  assert.equal(canSendTicket(ticketBlock(ok)), true);
});

test('기본으로 고를 만큼: 막힘 없음 + 1장 이상', () => {
  assert.equal(ticketIsDefaultable(undefined, 1), true);
  assert.equal(ticketIsDefaultable(undefined, 0), false);
  assert.equal(ticketIsDefaultable(undefined, null), false);
  assert.equal(ticketIsDefaultable('signedOut', 5), false);
});

test('기본 AI 경계 표', () => {
  const row = (ticketUsable: boolean, saved: string | undefined, savedUsable: boolean) =>
    chooseDefault({ ticketUsable, saved, savedUsable });
  // 고른 적 없음
  assert.equal(row(true, undefined, false), 'ticket');
  assert.equal(row(false, undefined, false), 'auto');
  // 옛 저장값(이용권 이전의 고름)은 saved 로 넘기지 않으니 고른 적 없음과 같다: 이용권을 쓸 수 있으면 이용권
  assert.equal(row(true, undefined, true), 'ticket');
  // 이용권 도입 뒤 직접 고름 + 이용권 가능 = 고른 것
  // 직접 고른 AI 가 설치되어 있음: 그것을 존중
  assert.equal(row(true, 'claude', true), 'saved');
  assert.equal(row(false, 'claude', true), 'saved');
  // 직접 고른 AI 가 설치 안 됨: 이용권 (못 쓰면 자동)
  assert.equal(row(true, 'claude', false), 'ticket');
  assert.equal(row(false, 'claude', false), 'auto');
});

test('저장값: 이용권 도입 뒤 직접 고른 것만 명시 선택', () => {
  const pick = (f: Parameters<typeof explicitPick>[0]) =>
    chooseDefault({ ticketUsable: true, saved: explicitPick(f), savedUsable: true });
  // 옛 저장값 있음 + 이용권 가능 = 이용권
  assert.equal(pick({ provider: 'claude' }), 'ticket');
  assert.equal(pick({ provider: 'gemini', pickedAfterTicket: false }), 'ticket');
  assert.equal(pick(undefined), 'ticket');
  // 도입 뒤 직접 고름 + 이용권 가능 = 고른 것
  assert.equal(pick({ provider: 'claude', pickedAfterTicket: true }), 'saved');
  assert.equal(explicitPick({ provider: 'gemini', pickedAfterTicket: true }), 'gemini');
  assert.equal(explicitPick({ pickedAfterTicket: true }), undefined);
});
