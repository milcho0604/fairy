import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { type Db, migrate } from './db-schema.ts';
import { EventStore, parseQuickEvent, timeLabel } from './event-store.ts';
import { NoteStore, notePreview, noteTitle } from './note-store.ts';

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 6, 9, 0); // 기준 시각
// 2026-10-06 화요일, 지금 오전 9시
const today = '2026-10-06';
const nine = 9 * 60;

function fresh() {
  const db = new DatabaseSync(':memory:') as unknown as Db;
  migrate(db);
  return { events: new EventStore(db), notes: new NoteStore(db) };
}

test('일정 한 줄: 날짜 낱말, 오전/오후, 반, 24시간 표기', () => {
  assert.deepEqual(parseQuickEvent('내일 3시 회의', today, nine), {
    title: '회의',
    day: '2026-10-07',
    minute: 15 * 60,
    durationMin: null,
  });
  assert.deepEqual(parseQuickEvent('오전 10시 반 스탠드업', today, nine), {
    title: '스탠드업',
    day: today,
    minute: 10 * 60 + 30,
    durationMin: null,
  });
  assert.deepEqual(parseQuickEvent('10/7 14:00 면접 1시간', today, nine), {
    title: '면접',
    day: '2026-10-07',
    minute: 14 * 60,
    durationMin: 60,
  });
  assert.equal(parseQuickEvent('밤 11시 30분 운동', today, nine)?.minute, 23 * 60 + 30);
  assert.equal(parseQuickEvent('오전 12시 점검', today, nine)?.minute, 0);
});

test('날짜가 없으면 오늘, 이미 지난 시각이면 내일', () => {
  assert.equal(parseQuickEvent('오후 2시 치과', today, nine)?.day, today);
  assert.equal(parseQuickEvent('오전 8시 운동', today, nine)?.day, '2026-10-07');
});

test('요일: 이번 주 그 요일, 다음 주 그 요일, 오늘 요일인데 지났으면 다음 주', () => {
  assert.equal(parseQuickEvent('금요일 4시 회고', today, nine)?.day, '2026-10-09');
  assert.equal(parseQuickEvent('다음주 월요일 10시 주간회의', today, nine)?.day, '2026-10-12');
  assert.equal(parseQuickEvent('다음 주 화요일 10시 1on1', today, nine)?.day, '2026-10-13');
  assert.equal(parseQuickEvent('화요일 7시 회식', today, nine)?.day, '2026-10-06'); // 7시 → 오후 7시
  assert.equal(parseQuickEvent('화요일 오전 8시 조깅', today, nine)?.day, '2026-10-13');
});

test('시각이 없거나 제목이 없으면 일정이 아니다. "1시간"을 시각으로 읽지 않는다', () => {
  assert.equal(parseQuickEvent('내일 보고서', today, nine), null);
  assert.equal(parseQuickEvent('내일 3시', today, nine), null);
  assert.deepEqual(parseQuickEvent('4시 회의 1시간 30분', today, nine), {
    title: '회의',
    day: today,
    minute: 16 * 60,
    durationMin: 90,
  });
  assert.equal(parseQuickEvent('25시 파티', today, nine), null);
});

test('지난 날짜(월/일)는 내년으로', () => {
  assert.equal(parseQuickEvent('1월 3일 10시 신년회', today, nine)?.day, '2027-01-03');
});

test('시각 표시', () => {
  assert.equal(timeLabel(0), '오전 12:00');
  assert.equal(timeLabel(14 * 60 + 5), '오후 2:05');
  assert.equal(timeLabel(12 * 60), '오후 12:00');
});

test('알림: 알림 시점이 되면 한 번만, 시작한 지 5분 넘은 것은 건너뛴다, 시각을 바꾸면 다시 알린다', () => {
  const { events } = fresh();
  const a = events.add({ title: '회의', startAt: T0 + 30 * MIN, remindMin: 10 }, T0);
  events.add({ title: '지난 일', startAt: T0 - 10 * MIN }, T0);
  assert.deepEqual(events.dueReminders(T0), []);
  assert.deepEqual(
    events.dueReminders(T0 + 20 * MIN).map((e) => e.title),
    ['회의'],
  );
  events.markNotified(a.id, T0 + 20 * MIN);
  assert.deepEqual(events.dueReminders(T0 + 21 * MIN), []);
  events.update(a.id, { startAt: T0 + 60 * MIN });
  assert.deepEqual(events.dueReminders(T0 + 21 * MIN), []);
  assert.equal(events.dueReminders(T0 + 50 * MIN).length, 1);
  events.update(a.id, { title: '이름만 바꿈' });
  assert.equal(events.dueReminders(T0 + 50 * MIN).length, 1);
});

test('일정 범위 조회와 지우기, 되살리기', () => {
  const { events } = fresh();
  const b = events.add({ title: '둘째', startAt: T0 + 120 * MIN }, T0);
  events.add({ title: '첫째', startAt: T0 + 60 * MIN }, T0);
  events.add({ title: '범위 밖', startAt: T0 + 24 * 60 * MIN }, T0);
  assert.deepEqual(
    events.between(T0, T0 + 12 * 60 * MIN).map((e) => e.title),
    ['첫째', '둘째'],
  );
  events.remove(b.id, T0);
  assert.equal(events.between(T0, T0 + 12 * 60 * MIN).length, 1);
  events.restore(b.id);
  assert.equal(events.between(T0, T0 + 12 * 60 * MIN).length, 2);
  assert.throws(() => events.add({ title: '  ', startAt: T0 }, T0));
});

test('메모: 최근에 고친 것부터, 그대로면 시각을 안 바꾼다, 제목은 첫 줄에서', () => {
  const { notes } = fresh();
  const a = notes.add({ body: '# 회의 메모\n- 결정 1' }, T0);
  const b = notes.add({ title: '장보기', body: '우유' }, T0 + 1);
  assert.deepEqual(
    notes.list().map((n) => n.id),
    [b.id, a.id],
  );
  notes.update(a.id, { body: '# 회의 메모\n- 결정 2' }, T0 + 2);
  assert.equal(notes.list()[0]?.id, a.id);
  notes.update(b.id, { body: '우유' }, T0 + 3);
  assert.equal(notes.get(b.id)?.updatedAt, T0 + 1);
  assert.equal(noteTitle(notes.get(a.id) as never), '회의 메모');
  assert.equal(noteTitle({ title: '', body: '\n\n' }), '빈 메모');
  assert.equal(notePreview({ title: '', body: '# 회의 메모\n- 결정 1\n- 결정 2' }), '결정 1 결정 2');
  assert.equal(notePreview({ title: '장보기', body: '- 우유\n- 귤' }), '우유 귤');
  notes.remove(a.id, T0 + 4);
  assert.equal(notes.list().length, 1);
  notes.restore(a.id);
  assert.equal(notes.list().length, 2);
  assert.equal(notes.add({ body: 'x', source: 'ai' }, T0).source, 'ai');
});

test('캘린더 가져오기: 새것 넣고, 바뀐 것 고치고, 없어진 것 지운다. 종일은 알리지 않는다', () => {
  const { events } = fresh();
  const a = { uid: 'a', title: '회의', startAt: T0 + 60 * MIN, endAt: null, allDay: false };
  const b = { uid: 'b', title: '휴가', startAt: T0 + 24 * 60 * MIN, endAt: null, allDay: true };
  assert.deepEqual(events.syncExternal('ics', [a, b], T0, T0 + 30 * 24 * 60 * MIN, T0), {
    added: 2,
    updated: 0,
    removed: 0,
  });
  assert.deepEqual(events.syncExternal('ics', [a, b], T0, T0 + 30 * 24 * 60 * MIN, T0), {
    added: 0,
    updated: 0,
    removed: 0,
  });
  assert.deepEqual(
    events.syncExternal('ics', [{ ...a, title: '회의 (장소 바뀜)' }], T0, T0 + 30 * 24 * 60 * MIN, T0),
    { added: 0, updated: 1, removed: 1 },
  );
  const list = events.between(T0, T0 + 30 * 24 * 60 * MIN);
  assert.deepEqual(
    list.map((e) => [e.title, e.source]),
    [['회의 (장소 바뀜)', 'ics']],
  );
  // 직접 넣은 일정은 건드리지 않는다
  events.add({ title: '내 일정', startAt: T0 + 120 * MIN }, T0);
  events.syncExternal('ics', [], T0, T0 + 30 * 24 * 60 * MIN, T0);
  assert.deepEqual(
    events.between(T0, T0 + 30 * 24 * 60 * MIN).map((e) => e.title),
    ['내 일정'],
  );
  // 종일 일정은 알림이 없다
  events.syncExternal('ics', [b], T0, T0 + 30 * 24 * 60 * MIN, T0);
  assert.deepEqual(events.dueReminders(b.startAt + 1000), []);
});
