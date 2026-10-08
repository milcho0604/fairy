import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findSameEvent } from './event-dup.ts';

const at = new Date(2026, 9, 9, 15, 0).getTime();
const list = [{ id: 1, title: '디자인 회의', startAt: at, allDay: false }];

test('같은 제목, 같은 시각이면 이미 있는 일정', () => {
  assert.equal(findSameEvent(list, { title: '디자인 회의', startAt: at })?.id, 1);
  assert.equal(findSameEvent(list, { title: '  디자인   회의 ', startAt: at })?.id, 1);
});

test('시각이나 제목, 종일 여부가 다르면 다른 일정', () => {
  assert.equal(findSameEvent(list, { title: '디자인 회의', startAt: at + 30 * 60_000 }), undefined);
  assert.equal(findSameEvent(list, { title: '개발 회의', startAt: at }), undefined);
  assert.equal(findSameEvent(list, { title: '디자인 회의', startAt: at, allDay: true }), undefined);
  assert.equal(findSameEvent([], { title: '디자인 회의', startAt: at }), undefined);
});
