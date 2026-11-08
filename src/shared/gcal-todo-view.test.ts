import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { GcalGrantProblem } from './gcal.ts';
import type { GcalCalendar } from './gcal-cals.ts';
import {
  chooseOutcome,
  type GcalTodos,
  grantKey,
  mixesWithEvents,
  pickable,
  removeSentBodyKey,
  suggestsPick,
  todoView,
} from './gcal-todo-view.ts';

const base = (o: Partial<GcalTodos> = {}): GcalTodos => ({
  on: false,
  target: 'fairy',
  calendarId: null,
  sent: 0,
  pending: 0,
  problem: null,
  appScope: false,
  fairy: 'none',
  extras: 0,
  grant: null,
  ...o,
});

test('상태가 없으면 아무것도 안 보인다', () => {
  const v = todoView(undefined);
  assert.equal(v.on, false);
  assert.equal(v.status, null);
  assert.deepEqual(v.notes, []);
  assert.equal(v.removeSent, false);
});

test('꺼짐: 줄이 없고 지우기도 없다', () => {
  const v = todoView(base());
  assert.equal(v.on, false);
  assert.equal(v.status, null);
  assert.deepEqual(v.notes, []);
  assert.equal(v.removeSent, false);
  assert.equal(v.where, null);
});

test('켜짐: 보낼 것이 남았으면 남은 수, 아니면 올린 수, 둘 다 없으면 아직', () => {
  const on = { on: true, calendarId: 'c@group.calendar.google.com', fairy: 'ready' as const };
  assert.deepEqual(todoView(base({ ...on, pending: 3, sent: 5 })).status, {
    key: 'gcal.todo.state.pending',
    params: { n: 3 },
    warn: false,
  });
  assert.deepEqual(todoView(base({ ...on, sent: 5 })).status, {
    key: 'gcal.todo.state.sent',
    params: { n: 5 },
    warn: false,
  });
  assert.equal(todoView(base(on)).status?.key, 'gcal.todo.state.idle');
  assert.equal(todoView(base(on)).where, 'fairy');
  assert.equal(todoView(base({ ...on, target: 'pick' })).where, 'pick');
});

test('페어리 캘린더가 없어짐: 다시 만들기, 올린 수 줄은 숨김', () => {
  const v = todoView(base({ on: true, calendarId: 'x@group.calendar.google.com', fairy: 'gone', sent: 4 }));
  assert.equal(v.recreate, true);
  assert.equal(v.status, null);
  assert.equal(v.where, null);
  assert.deepEqual(
    v.notes.map((n) => n.key),
    ['gcal.todo.gone'],
  );
});

test('고른 캘린더(pick)에서는 gone 이어도 다시 만들기를 안 보인다', () => {
  const v = todoView(base({ on: true, target: 'pick', calendarId: 'a@b.co', fairy: 'gone' }));
  assert.equal(v.recreate, false);
});

test('캘린더가 둘 이상: 남는 수와 안내', () => {
  const v = todoView(base({ extras: 1 }));
  assert.equal(v.extras, 1);
  assert.deepEqual(v.notes, [{ key: 'gcal.todo.extras', params: { n: 1 }, warn: true }]);
  assert.equal(todoView(base({ extras: -2 })).extras, 0);
});

test('권한 받기 문제는 맨 위에 붉게', () => {
  const v = todoView(base({ grant: 'account', problem: 'failed', extras: 1 }));
  assert.deepEqual(
    v.notes.map((n) => n.key),
    ['gcal.todo.grant.account', 'gcal.todo.extras', 'gcal.problem.failed'],
  );
  assert.ok(v.notes.every((n) => n.warn));
});

test('올린 할 일 지우기: 올린 것이 있거나 페어리 캘린더가 있을 때', () => {
  assert.equal(todoView(base({ sent: 1 })).removeSent, true);
  assert.equal(todoView(base({ calendarId: 'a@b.co' })).removeSent, true);
  assert.equal(todoView(base({ target: 'pick', calendarId: 'a@b.co' })).removeSent, false);
});

test('까닭마다 글 키가 하나씩, noApp 만 기존 캘린더를 권한다', () => {
  const all: GcalGrantProblem[] = [
    'denied',
    'timeout',
    'offline',
    'failed',
    'noEvents',
    'noApp',
    'noList',
    'account',
  ];
  assert.equal(new Set(all.map(grantKey)).size, all.length);
  assert.deepEqual(
    all.filter((p) => suggestsPick(p)),
    ['noApp'],
  );
  assert.equal(suggestsPick(null), false);
});

test('고른 뒤 결과', () => {
  const ok = { connected: true, connecting: false, todos: base({ target: 'fairy', calendarId: 'a@b.co' }) };
  assert.equal(chooseOutcome(ok, 'fairy'), 'ok');
  assert.equal(chooseOutcome(ok, 'pick'), 'none');
  assert.equal(chooseOutcome({ ...ok, todos: base({ ...ok.todos, grant: 'noApp' }) }, 'fairy'), 'problem');
  assert.equal(chooseOutcome({ ...ok, connecting: true }, 'fairy'), 'none');
  assert.equal(chooseOutcome({ ...ok, todos: base() }, 'fairy'), 'none');
  assert.equal(chooseOutcome({ ...ok, connected: false }, 'fairy'), 'none');
  assert.equal(chooseOutcome({ connected: true, connecting: false, todos: undefined }, 'fairy'), 'none');
});

const cal = (id: string, role: GcalCalendar['role'], extra: Partial<GcalCalendar> = {}): GcalCalendar => ({
  id,
  name: id,
  color: null,
  role,
  primary: id === 'primary',
  ...extra,
});

test('고를 수 있는 캘린더: 읽기만과 페어리 전용은 뺀다', () => {
  const list = [
    cal('primary', 'owner'),
    cal('a@b.co', 'writer'),
    cal('r@b.co', 'reader'),
    cal('f@b.co', 'owner', { fairy: true }),
  ];
  assert.deepEqual(
    pickable(list).map((c) => c.id),
    ['primary', 'a@b.co'],
  );
  assert.deepEqual(pickable(null), []);
});

test('일정 보내기 캘린더와 같으면 섞인다 (보내기가 켜져 있을 때만)', () => {
  assert.equal(mixesWithEvents('primary', { push: true, calendarId: 'primary' }), true);
  assert.equal(mixesWithEvents('primary', { push: false, calendarId: 'primary' }), false);
  assert.equal(mixesWithEvents('a@b.co', { push: true, calendarId: 'primary' }), false);
});

test('지우기 확인 글은 올린 곳에 따라', () => {
  assert.notEqual(removeSentBodyKey('fairy'), removeSentBodyKey('pick'));
});

test('고른 캘린더가 저장된 것과 다르면 켜지지 않는다', () => {
  const v = { connected: true, connecting: false, todos: base({ target: 'pick', calendarId: 'Y' }) };
  assert.notEqual(chooseOutcome(v, 'pick', 'X'), 'ok');
  assert.equal(chooseOutcome(v, 'pick', 'Y'), 'ok');
});

test('마지막으로 올린 때는 다 올렸을 때만 붙고, 남은 것이 있으면 붙지 않는다', () => {
  const on = {
    on: true,
    calendarId: 'c@group.calendar.google.com',
    fairy: 'ready' as const,
    lastSentAt: 1_700_000_000_000,
  };
  assert.equal(todoView(base({ ...on, sent: 5 })).at, 1_700_000_000_000);
  assert.equal(todoView(base({ ...on, sent: 5, pending: 2 })).at, null);
  assert.equal(todoView(base({ ...on, sent: 5, lastSentAt: null })).at, null);
  assert.equal(todoView(base({ ...on, on: false, sent: 5 })).at, null);
});
