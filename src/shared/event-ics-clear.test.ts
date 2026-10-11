// 캘린더 주소(.ics)를 지우면 가져온 일정 중 앞으로 올 것을 걷어 낸다 (감사 3차: 주소를 지워도 일정과 알림이 남았다)
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { type Db, migrate } from './db-schema.ts';
import { EventStore } from './event-store.ts';

const MIN = 60_000;
const HOUR = 60 * MIN;
const NOW = Date.UTC(2026, 9, 14, 9, 0);

function fresh() {
  const db = new DatabaseSync(':memory:') as unknown as Db;
  migrate(db);
  return { db, events: new EventStore(db) };
}

const ics = (uid: string, startAt: number, title = uid) => ({
  uid,
  title,
  startAt,
  endAt: startAt + HOUR,
  allDay: false,
});

test('주소를 지우면 가져온 앞으로의 일정은 지운 것(sync)으로, 지난 것과 직접 넣은 것은 그대로', () => {
  const { db, events } = fresh();
  const from = NOW - 2 * 86_400_000;
  const to = NOW + 30 * 86_400_000;
  events.syncExternal(
    'ics',
    [ics('past', NOW - 3 * HOUR), ics('soon', NOW + 20 * MIN), ics('later', NOW + 3 * 86_400_000)],
    from,
    to,
    NOW - 4 * HOUR,
  );
  const mine = events.add({ title: '내 일정', startAt: NOW + 2 * HOUR }, NOW);
  assert.equal(events.dueReminders(NOW + 15 * MIN).length, 1, '지우기 전에는 곧 올 일정을 알린다');

  const removed = events.dropExternal('ics', NOW);
  assert.equal(removed, 2);
  const left = events.between(from, to).map((e) => e.title);
  assert.deepEqual(left, ['past', '내 일정']);
  assert.ok(events.get(mine.id));
  assert.deepEqual(events.dueReminders(NOW + 15 * MIN), [], '지운 일정은 알리지 않는다');
  const rows = db
    .prepare("select external_id, removed_by from event where source = 'ics' and deleted_at is not null")
    .all() as { external_id: string; removed_by: string }[];
  assert.deepEqual(rows.map((r) => [r.external_id, r.removed_by]).sort(), [
    ['later', 'sync'],
    ['soon', 'sync'],
  ]);

  // 주소를 다시 넣으면 (sync 로 지운 것이라) 되살아난다
  events.syncExternal(
    'ics',
    [ics('past', NOW - 3 * HOUR), ics('soon', NOW + 20 * MIN), ics('later', NOW + 3 * 86_400_000)],
    from,
    to,
    NOW,
  );
  assert.deepEqual(
    events.between(from, to).map((e) => e.title),
    ['past', 'soon', '내 일정', 'later'],
  );
});

test('이미 이어지는 여러 날 종일 일정도 걷어 낸다. 지울 것이 없으면 0', () => {
  const { events } = fresh();
  const day = 86_400_000;
  events.syncExternal(
    'ics',
    [{ uid: 'trip', title: '여행', startAt: NOW - day, endAt: NOW + 2 * day, allDay: true }],
    NOW - 2 * day,
    NOW + 30 * day,
    NOW - 2 * day,
  );
  assert.equal(events.dropExternal('ics', NOW), 1);
  assert.equal(events.dropExternal('ics', NOW), 0);
});
