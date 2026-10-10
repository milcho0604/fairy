import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { type Db, MIGRATIONS, migrate, SCHEMA_VERSION } from './db-schema.ts';
import { EventStore } from './event-store.ts';
import { GCAL_DELETED } from './gcal.ts';
import { GcalStore } from './gcal-store.ts';

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 9, 10, 0);
const TZ = 'Asia/Seoul';

function fresh() {
  const db = new DatabaseSync(':memory:') as unknown as Db;
  migrate(db);
  const events = new EventStore(db);
  return { db, events, links: new GcalStore(db, events) };
}

test('10판: 9판 저장 파일에 구글 칸을 더하고 있던 일정은 그대로', () => {
  const db = new DatabaseSync(':memory:') as unknown as Db;
  db.exec('begin');
  for (const sql of MIGRATIONS.slice(0, 9)) db.exec(sql);
  db.exec("insert into event (title, start_at, created_at) values ('옛 일정', 1, 1)");
  db.exec('pragma user_version = 9; commit');
  assert.deepEqual(migrate(db), { from: 9, to: SCHEMA_VERSION });
  const row = db.prepare('select title, google_id, google_hash from event').get() as Record<string, unknown>;
  assert.deepEqual({ ...row }, { title: '옛 일정', google_id: null, google_hash: null });
});

test('보낼 것: 짝꿍이 넣은 앞으로의 일정만. 가져온 일정과 지난 일정은 보내지 않는다', () => {
  const { events, links } = fresh();
  const soon = events.add({ title: '회의', startAt: NOW + 2 * HOUR }, NOW);
  events.add({ title: '지난주', startAt: NOW - 7 * 24 * HOUR }, NOW);
  // 어제 시작해서 아직 안 끝난 것은 보낸다
  const long = events.add({ title: '긴 일', startAt: NOW - 30 * HOUR, endAt: NOW + HOUR }, NOW);
  events.syncExternal(
    'ics',
    [{ uid: 'a@google.com', title: '가져옴', startAt: NOW + HOUR, endAt: null, allDay: false }],
    NOW - 24 * HOUR,
    NOW + 60 * 24 * HOUR,
    NOW,
  );
  const ops = links.pending(NOW, 'primary', TZ);
  assert.deepEqual(
    ops.map((o) => [o.kind, o.eventId]),
    [
      ['upsert', long.id],
      ['upsert', soon.id],
    ],
  );
  const op = ops[1];
  assert.ok(op?.kind === 'upsert');
  assert.equal(op.googleId, null);
  assert.equal(op.confirmed, false);
  assert.equal(op.calendarId, 'primary');
  assert.equal(op.body.summary, '회의');
});

test('보낸 뒤: 안 바뀌면 다시 안 보내고, 고치면 그 캘린더에서 고치고, 지우면 지우기, 되살리면 다시', () => {
  const { events, links } = fresh();
  const e = events.add({ title: '회의', startAt: NOW + 2 * HOUR }, NOW);
  const [op] = links.pending(NOW, 'primary', TZ);
  assert.ok(op?.kind === 'upsert');
  links.assignId(e.id, 'jjkabc12345', 'primary');
  links.markSent(e.id, op.hash, 'jjkabc12345@google.com');
  assert.deepEqual(links.pending(NOW, 'primary', TZ), []);

  // 보낼 캘린더를 바꾸면 이미 보낸 것은 원래 캘린더에서 새 캘린더로 옮긴다 (안 바뀌었어도)
  const [move] = links.pending(NOW, 'work@group.calendar.google.com', TZ);
  assert.ok(move?.kind === 'upsert');
  assert.deepEqual(
    [move.googleId, move.confirmed, move.calendarId, move.moveTo],
    ['jjkabc12345', true, 'primary', 'work@group.calendar.google.com'],
  );
  // 고른 캘린더 그대로면 원래 캘린더에서 고친다
  events.update(e.id, { title: '회의 (장소 바뀜)' }, NOW);
  const [edit] = links.pending(NOW, 'primary', TZ);
  assert.ok(edit?.kind === 'upsert');
  assert.deepEqual(
    [edit.googleId, edit.confirmed, edit.calendarId, edit.moveTo],
    ['jjkabc12345', true, 'primary', undefined],
  );
  links.markSent(e.id, edit.hash, null);

  events.remove(e.id, NOW);
  const [del] = links.pending(NOW, 'primary', TZ);
  assert.deepEqual(del, {
    kind: 'delete',
    eventId: e.id,
    googleId: 'jjkabc12345',
    calendarId: 'primary',
    stale: false,
  });
  links.markDeleted(e.id);
  assert.deepEqual(links.pending(NOW, 'primary', TZ), []);

  // 되돌리기: 지운 표시(deleted)와 지문이 달라 다시 보낸다 (status: confirmed 로 되살린다)
  events.restore(e.id);
  const [back] = links.pending(NOW, 'primary', TZ);
  assert.ok(back?.kind === 'upsert');
  assert.equal(back.googleId, 'jjkabc12345');
  assert.equal(back.body.status, 'confirmed');
});

test('구글에 안 보낸 채 지운 일정은 할 것이 없다. 한 번 보낸 것은 오래돼도 따라간다', () => {
  const { events, links } = fresh();
  const never = events.add({ title: '안 보냄', startAt: NOW + HOUR }, NOW);
  events.remove(never.id, NOW);
  assert.deepEqual(links.pending(NOW, 'primary', TZ), []);

  const e = events.add({ title: '보냄', startAt: NOW + HOUR }, NOW);
  links.assignId(e.id, 'jjkold00000', 'primary');
  links.markSent(e.id, 'x', 'u');
  // 한 달 뒤 고쳐도 따라간다
  const later = NOW + 40 * 24 * HOUR;
  events.update(e.id, { title: '보냄 (고침)' }, later);
  assert.equal(links.pending(later, 'primary', TZ).length, 1);
});

test('넣기를 못 끝낸 것(id 만 정함)은 지금 고른 캘린더로 다시 넣는다', () => {
  const { events, links } = fresh();
  const e = events.add({ title: '회의', startAt: NOW + HOUR }, NOW);
  links.assignId(e.id, 'jjkpending0', 'old@group.calendar.google.com');
  const [op] = links.pending(NOW, 'new@group.calendar.google.com', TZ);
  assert.ok(op?.kind === 'upsert');
  assert.deepEqual(
    [op.googleId, op.confirmed, op.calendarId],
    ['jjkpending0', false, 'new@group.calendar.google.com'],
  );
});

test('forget: id 를 버리면 다음에 새로 넣는다', () => {
  const { events, links } = fresh();
  const e = events.add({ title: '회의', startAt: NOW + HOUR }, NOW);
  links.assignId(e.id, 'jjkgone0000', 'primary');
  links.markSent(e.id, 'h', 'u');
  links.forget(e.id);
  const [op] = links.pending(NOW, 'primary', TZ);
  assert.ok(op?.kind === 'upsert');
  assert.equal(op.googleId, null);
});

test('sentUids: 보낸 일정의 iCalUID (가져오기가 거른다)', () => {
  const { events, links } = fresh();
  const a = events.add({ title: 'a', startAt: NOW + HOUR }, NOW);
  const b = events.add({ title: 'b', startAt: NOW + HOUR }, NOW);
  links.assignId(a.id, 'jjkaaaaaaaa', 'primary');
  links.markSent(a.id, 'h', 'custom-uid@google.com');
  links.assignId(b.id, 'jjkbbbbbbbb', 'primary');
  links.markDeleted(b.id);
  assert.deepEqual([...links.sentUids()].sort(), [
    'custom-uid@google.com',
    'jjkaaaaaaaa@google.com',
    'jjkbbbbbbbb@google.com',
  ]);
  assert.equal(GCAL_DELETED, 'deleted');
});

test('이미 보낸 일정이 200개 넘어도 그 뒤 새 일정을 보낸다 (보낸 것이 늘 앞자리를 차지하지 않게)', () => {
  const { events, links } = fresh();
  for (let i = 0; i < 205; i++) events.add({ title: `일정 ${i}`, startAt: NOW + (i + 1) * HOUR }, NOW);
  const first = links.pending(NOW, 'primary', TZ);
  assert.equal(first.length, 200);
  for (const op of first) {
    if (op.kind !== 'upsert') continue;
    links.assignId(op.eventId, `jjk${String(op.eventId).padStart(8, '0')}`, 'primary');
    links.markSent(op.eventId, op.hash, null);
  }
  // 아직 확인 전(uid 없음)이라도 지문이 같으면 다시 넣기부터 하므로, 확인된 것으로 맞춘다
  for (const op of first) if (op.kind === 'upsert') links.markSent(op.eventId, op.hash, `u${op.eventId}`);
  assert.equal(links.pending(NOW, 'primary', TZ).length, 5);
  const late = events.add({ title: '새 일정', startAt: NOW + 900 * HOUR }, NOW);
  assert.ok(links.pending(NOW, 'primary', TZ).some((op) => op.eventId === late.id));
});

test('보낸 기록 되돌리기(연결 끊기, 다른 계정, 백업): id 는 두고 다시 넣기부터', () => {
  const { events, links } = fresh();
  const e = events.add({ title: '회의', startAt: NOW + HOUR }, NOW);
  const [op] = links.pending(NOW, 'primary', TZ);
  assert.ok(op?.kind === 'upsert');
  links.assignId(e.id, 'jjkabc12345', 'primary');
  links.markSent(e.id, op.hash, 'uid@google.com');
  assert.deepEqual(links.pending(NOW, 'primary', TZ), []);
  links.resetSent();
  const [again] = links.pending(NOW, 'primary', TZ);
  assert.ok(again?.kind === 'upsert');
  assert.deepEqual([again.googleId, again.confirmed], ['jjkabc12345', false]);
});
