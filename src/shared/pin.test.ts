import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { type Db, MIGRATIONS, migrate, SCHEMA_VERSION } from './db-schema.ts';
import { EventStore } from './event-store.ts';
import { eventsIcs, noteMarkdown, readExportTodos, todosCsv } from './export.ts';
import { GcalStore } from './gcal-store.ts';
import { NoteStore } from './note-store.ts';
import { isPinKind, pinAt, pinFirst } from './pin.ts';
import { TodoStore } from './todo-store.ts';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 9, 12, 3, 0);
const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function fresh() {
  const db = new DatabaseSync(':memory:') as unknown as Db;
  migrate(db);
  const events = new EventStore(db);
  return {
    db,
    todos: new TodoStore(db, utcDay),
    notes: new NoteStore(db),
    events,
    links: new GcalStore(db, events),
  };
}

const ids = (list: readonly { id: number }[]) => list.map((x) => x.id);

test('pinAt: 양의 유한한 수만 고정, 없거나 깨진 값은 고정 안 됨', () => {
  assert.equal(pinAt(1_700_000_000_000), 1_700_000_000_000);
  assert.equal(pinAt(5n), 5);
  for (const bad of [
    null,
    undefined,
    0,
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    'abc',
    '123',
    {},
    [],
    true,
  ])
    assert.equal(pinAt(bad), null, String(bad));
  assert.equal(isPinKind('note'), true);
  assert.equal(isPinKind('habit'), false);
});

test('pinFirst: 고정한 것은 고정한 순서로 맨 위, 나머지는 받은 순서 그대로, 받은 배열은 그대로', () => {
  const list = [
    { id: 1, pinnedAt: null },
    { id: 2, pinnedAt: 300 },
    { id: 3, pinnedAt: null },
    { id: 4, pinnedAt: 100 },
    { id: 5, pinnedAt: 300 },
    { id: 6, pinnedAt: null },
  ];
  const before = JSON.stringify(list);
  assert.deepEqual(ids(pinFirst(list)), [4, 2, 5, 1, 3, 6]);
  assert.equal(JSON.stringify(list), before);
  assert.deepEqual(pinFirst([]), []);
  // 깨진 값이 들어와도(타입 밖) 고정 안 된 것으로
  const odd = [
    { id: 1, pinnedAt: 'x' as unknown as number },
    { id: 2, pinnedAt: -5 },
    { id: 3, pinnedAt: 7 },
  ];
  assert.deepEqual(ids(pinFirst(odd)), [3, 1, 2]);
});

test('13판: 12판 저장 파일은 그대로 읽히고 모두 고정 안 됨', () => {
  const db = new DatabaseSync(':memory:') as unknown as Db;
  db.exec('begin');
  for (const sql of MIGRATIONS.slice(0, 12)) db.exec(sql);
  db.exec("insert into todo (title, created_at) values ('옛 할 일', 1)");
  db.exec("insert into note (title, body, created_at, updated_at) values ('옛 메모', '', 1, 2)");
  db.exec(`insert into event (title, start_at, created_at) values ('옛 일정', ${NOW + DAY}, 1)`);
  db.exec('pragma user_version = 12; commit');
  assert.deepEqual(migrate(db), { from: 12, to: SCHEMA_VERSION });
  const todos = new TodoStore(db, utcDay);
  const notes = new NoteStore(db);
  const events = new EventStore(db);
  assert.equal(todos.list(NOW).open[0]?.title, '옛 할 일');
  assert.equal(todos.list(NOW).open[0]?.pinnedAt, null);
  assert.equal(notes.list()[0]?.pinnedAt, null);
  assert.equal(notes.list()[0]?.updatedAt, 2);
  assert.equal(events.between(NOW, NOW + 2 * DAY)[0]?.pinnedAt, null);
  assert.deepEqual(events.pinned(NOW), []);
});

test('저장 파일의 깨진 고정 값(글, 0, 음수)은 고정 안 된 것으로 읽는다', () => {
  const { db, todos, notes, events } = fresh();
  const a = todos.add({ title: 'a' }, NOW);
  const b = todos.add({ title: 'b' }, NOW);
  const c = todos.add({ title: 'c' }, NOW);
  const d = todos.add({ title: 'd' }, NOW);
  db.prepare('update todo set pinned_at = ? where id = ?').run('어제', a.id);
  db.prepare('update todo set pinned_at = ? where id = ?').run(0, b.id);
  db.prepare('update todo set pinned_at = ? where id = ?').run(-3, c.id);
  db.prepare('update todo set pinned_at = ? where id = ?').run(NOW, d.id);
  const open = todos.list(NOW).open;
  assert.deepEqual(
    open.map((x) => x.pinnedAt),
    [null, null, null, NOW],
  );
  assert.deepEqual(ids(pinFirst(open)), [d.id, a.id, b.id, c.id]);
  // 깨진 값 위에 고정하면 새로 고정된다
  assert.equal(todos.pin(a.id, true, NOW + 5)?.pinnedAt, NOW + 5);

  const n = notes.add({ title: 'n' }, NOW);
  db.prepare('update note set pinned_at = ? where id = ?').run('nan', n.id);
  assert.equal(notes.get(n.id)?.pinnedAt, null);
  const e = events.add({ title: 'e', startAt: NOW + HOUR }, NOW);
  db.prepare('update event set pinned_at = ? where id = ?').run('x', e.id);
  assert.equal(events.get(e.id)?.pinnedAt, null);
  assert.deepEqual(events.pinned(NOW), []);
});

test('할 일: 고정과 풀기 반복, 다시 고정하면 처음 자리, 여러 개는 고정한 순서', () => {
  const { todos } = fresh();
  const a = todos.add({ title: 'a', due: '2026-10-13' }, NOW);
  const b = todos.add({ title: 'b', important: true }, NOW);
  const c = todos.add({ title: 'c' }, NOW);
  const view = () => ids(pinFirst(todos.list(NOW).open));
  // 원래 정렬: 중요 먼저, 마감 순, 마감 없는 것은 뒤
  assert.deepEqual(view(), [b.id, a.id, c.id]);
  todos.pin(c.id, true, NOW + 1);
  assert.deepEqual(view(), [c.id, b.id, a.id]);
  todos.pin(a.id, true, NOW + 2);
  assert.deepEqual(view(), [c.id, a.id, b.id]);
  // 이미 고정한 것을 다시 고정해도 자리(처음 고정 시각)는 그대로
  todos.pin(c.id, true, NOW + 3);
  assert.equal(todos.get(c.id)?.pinnedAt, NOW + 1);
  assert.deepEqual(view(), [c.id, a.id, b.id]);
  for (let i = 0; i < 5; i++) {
    todos.pin(c.id, false, NOW + 10 + i);
    assert.equal(todos.get(c.id)?.pinnedAt, null);
    todos.pin(c.id, true, NOW + 20 + i);
  }
  // 풀었다 다시 고정하면 맨 뒤(가장 늦게 고정한 것)
  assert.deepEqual(view(), [a.id, c.id, b.id]);
  todos.pin(a.id, false, NOW + 30);
  todos.pin(c.id, false, NOW + 30);
  assert.deepEqual(view(), [b.id, a.id, c.id]);
  // 고정은 제목, 마감, 중요를 건드리지 않는다
  assert.deepEqual(
    todos.list(NOW).open.map((x) => [x.title, x.due, x.important]),
    [
      ['b', null, true],
      ['a', '2026-10-13', false],
      ['c', null, false],
    ],
  );
});

test('할 일: 끝내면 목록에서 빠지고 되돌리면 고정 자리로, 지운 것은 바꾸지 않고 되살리면 고정 그대로', () => {
  const { todos } = fresh();
  const a = todos.add({ title: 'a' }, NOW);
  const b = todos.add({ title: 'b' }, NOW);
  todos.pin(b.id, true, NOW);
  todos.complete(b.id, NOW + 1);
  assert.deepEqual(ids(pinFirst(todos.list(NOW + 1).open)), [a.id]);
  assert.equal(todos.list(NOW + 1).doneToday[0]?.pinnedAt, NOW);
  todos.undo(b.id, NOW + 2);
  assert.deepEqual(ids(pinFirst(todos.list(NOW + 2).open)), [b.id, a.id]);

  todos.remove(b.id, NOW + 3);
  assert.equal(todos.pin(b.id, false, NOW + 4), undefined, '지운 할 일은 바꾸지 않는다');
  todos.restore(b.id);
  assert.equal(todos.get(b.id)?.pinnedAt, NOW);
  assert.equal(todos.pin(999, true, NOW), undefined);
});

test('할 일: 고정한 반복 할 일을 끝내면 다음 회차도 같은 자리에 고정, 되돌리면 다음 회차는 걷힌다', () => {
  const { todos } = fresh();
  const plain = todos.add({ title: '보통' }, NOW);
  const daily = todos.add({ title: '물 마시기', repeat: 'daily', due: utcDay(NOW) }, NOW);
  todos.pin(daily.id, true, NOW + 7);
  todos.complete(daily.id, NOW + HOUR);
  const open = pinFirst(todos.list(NOW + HOUR).open);
  assert.equal(open[0]?.title, '물 마시기');
  assert.notEqual(open[0]?.id, daily.id);
  assert.equal(open[0]?.pinnedAt, NOW + 7);
  assert.equal(open[1]?.id, plain.id);
  todos.undo(daily.id, NOW + 2 * HOUR);
  assert.deepEqual(ids(pinFirst(todos.list(NOW + 2 * HOUR).open)), [daily.id, plain.id]);
  // 고정 안 한 반복 할 일의 다음 회차는 고정 안 됨
  const weekly = todos.add({ title: '주간 회고', repeat: 'weekly', due: utcDay(NOW) }, NOW);
  todos.complete(weekly.id, NOW + HOUR);
  const next = todos.list(NOW + HOUR).open.find((x) => x.title === '주간 회고');
  assert.equal(next?.pinnedAt, null);
});

test('메모: 고정해도 고친 시각은 그대로, 고정한 순서로 위에, 지우고 되살리면 고정 그대로', () => {
  const { notes } = fresh();
  const a = notes.add({ title: 'a' }, NOW);
  const b = notes.add({ title: 'b' }, NOW + 1);
  const c = notes.add({ title: 'c' }, NOW + 2);
  const view = () => ids(pinFirst(notes.list()));
  assert.deepEqual(view(), [c.id, b.id, a.id]);
  notes.pin(a.id, true, NOW + 10);
  notes.pin(b.id, true, NOW + 11);
  assert.deepEqual(view(), [a.id, b.id, c.id]);
  assert.equal(notes.get(a.id)?.updatedAt, NOW);
  // 고정한 메모를 고치면 고친 시각은 바뀌어도 자리는 고정 순서
  notes.update(b.id, { body: '고침' }, NOW + 20);
  assert.deepEqual(view(), [a.id, b.id, c.id]);
  notes.remove(a.id, NOW + 30);
  assert.equal(notes.pin(a.id, false, NOW + 31), undefined);
  assert.deepEqual(view(), [b.id, c.id]);
  notes.restore(a.id);
  assert.deepEqual(view(), [a.id, b.id, c.id]);
  notes.pin(a.id, false, NOW + 40);
  notes.pin(b.id, false, NOW + 40);
  assert.deepEqual(view(), [b.id, c.id, a.id]);
});

test('일정: 고정 칸은 안 끝난 것만 고정 순서로 (14일 밖도), 지운 것과 끝난 것은 빠진다', () => {
  const { events } = fresh();
  const soon = events.add({ title: '곧', startAt: NOW + HOUR }, NOW);
  const far = events.add({ title: '두 달 뒤', startAt: NOW + 60 * DAY }, NOW);
  const past = events.add({ title: '지난', startAt: NOW - 3 * HOUR, endAt: NOW - 2 * HOUR }, NOW);
  // 종일 일정은 현지 0시로 넣는다 (Date.UTC 면 서쪽 시간대에서 전날 일정이 된다)
  const allDay = events.add(
    { title: '오늘 종일', startAt: new Date(2026, 9, 12).getTime(), allDay: true },
    NOW,
  );
  const gone = events.add({ title: '지울 것', startAt: NOW + 2 * HOUR }, NOW);
  events.pin(far.id, true, NOW + 1);
  events.pin(soon.id, true, NOW + 2);
  events.pin(past.id, true, NOW + 3);
  events.pin(allDay.id, true, NOW + 4);
  events.pin(gone.id, true, NOW + 5);
  events.remove(gone.id, NOW + 6);
  const today = utcDay(NOW);
  assert.deepEqual(ids(events.pinned(NOW, today)), [far.id, soon.id, allDay.id]);
  // 지난 일정은 고정 값은 남는다 (달력에서 보이고 풀 수 있다)
  assert.equal(events.get(past.id)?.pinnedAt, NOW + 3);
  // 시간이 흘러 끝나면 빠진다. 종일은 그날이 지나야 끝
  assert.deepEqual(ids(events.pinned(NOW + 2 * HOUR, today)), [far.id, allDay.id]);
  assert.deepEqual(ids(events.pinned(NOW + DAY, utcDay(NOW + DAY))), [far.id]);
  // 지운 것을 되살리면 고정 그대로
  events.restore(gone.id);
  assert.deepEqual(ids(events.pinned(NOW, today)), [far.id, soon.id, allDay.id, gone.id]);
  // 풀기
  events.pin(far.id, false, NOW + 9);
  assert.deepEqual(ids(events.pinned(NOW, today)), [soon.id, allDay.id, gone.id]);
});

test('일정 고정은 고침이 아니다: 가져온 일정의 다음 가져오기가 덮고, 고정은 남는다', () => {
  const { db, events } = fresh();
  const range: [number, number] = [NOW - DAY, NOW + 30 * DAY];
  events.syncExternal(
    'ics',
    [{ uid: 'x@google.com', title: '옛 제목', startAt: NOW + DAY, endAt: null, allDay: false }],
    ...range,
    NOW,
  );
  const e = events.between(...range)[0];
  assert.ok(e);
  events.pin(e.id, true, NOW);
  const row = db.prepare('select user_edited from event where id = ?').get(e.id) as { user_edited: number };
  assert.equal(Number(row.user_edited), 0);
  events.syncExternal(
    'ics',
    [{ uid: 'x@google.com', title: '새 제목', startAt: NOW + 2 * DAY, endAt: null, allDay: false }],
    ...range,
    NOW + 1,
  );
  const after = events.get(e.id);
  assert.equal(after?.title, '새 제목');
  assert.equal(after?.pinnedAt, NOW);
});

test('고정은 바깥으로 나가지 않는다: 구글 보내기 지문, .ics, 할 일 CSV, 메모 마크다운이 고정 전과 같다', () => {
  const { db, todos, notes, events, links } = fresh();
  const e = events.add({ title: '회의', startAt: NOW + HOUR }, NOW);
  const op = links.pending(NOW, 'primary', 'Asia/Seoul')[0];
  assert.ok(op?.kind === 'upsert');
  links.assignId(e.id, 'jjkabc12345', 'primary');
  links.markSent(e.id, op.hash, 'jjkabc12345@google.com');
  assert.deepEqual(links.pending(NOW, 'primary', 'Asia/Seoul'), []);
  const ics = eventsIcs([events.get(e.id) as never], NOW);
  const todo = todos.add({ title: '보고서' }, NOW);
  const csv = todosCsv(readExportTodos(db));
  const note = notes.add({ title: '메모', body: '본문' }, NOW);
  const md = noteMarkdown(notes.get(note.id) as never);

  events.pin(e.id, true, NOW + 5);
  todos.pin(todo.id, true, NOW + 5);
  notes.pin(note.id, true, NOW + 5);
  // 바뀐 것이 없으니 구글로 다시 보내지 않는다
  assert.deepEqual(links.pending(NOW, 'primary', 'Asia/Seoul'), []);
  assert.equal(eventsIcs([events.get(e.id) as never], NOW), ics);
  assert.equal(todosCsv(readExportTodos(db)), csv);
  assert.equal(noteMarkdown(notes.get(note.id) as never), md);
  assert.doesNotMatch(ics + csv + md, /pin/i);
});
