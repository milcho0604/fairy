import assert from 'node:assert/strict';
import { test } from 'node:test';
import { eventFindDestination } from './event-find.ts';

test('달력 보기에서는 목록에 있는 일정도 검색한 날짜로 이동한다', () => {
  assert.equal(eventFindDestination('calendar', true), 'calendar');
});

test('목록 보기는 보이는 일정을 유지하고 목록 밖 일정은 달력으로 연다', () => {
  assert.equal(eventFindDestination('list', true), 'list');
  assert.equal(eventFindDestination('list', false), 'calendar');
});
