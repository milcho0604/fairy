import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { STALE_AFTER_RESTORE } from './backup-import.ts';
import { type Db, MIGRATIONS, migrate, SCHEMA_VERSION } from './db-schema.ts';
import { EventStore } from './event-store.ts';
import { todoPatchInput } from './remind-parse.ts';

// 반복 회차 이어 만들기: 동시 확장 중복, 옮긴 회차, 유일 색인 (버그잡이 2차)
const DAY = 86_400_000;
const NOW = Date.now();

function memory(): Db {
  const db = new DatabaseSync(':memory:') as unknown as Db;
  migrate(db);
  return db;
}

function daily(events: EventStore): number {
  return events.add({ title: '운동', startAt: NOW + DAY, repeat: 'daily' }, NOW).id;
}

const count = (db: Db, sql: string, ...args: unknown[]): number =>
  Number((db.prepare(sql).get(...args) as { n: number }).n);

const DUP =
  'select count(*) n from (select 1 from event where repeat_series = ? group by start_at having count(*) > 1)';

test('두 연결이 읽기와 삽입 사이에 끼어도 같은 회차가 둘 생기지 않는다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jj-extend-'));
  try {
    const file = join(dir, 'a.db');
    const a = new DatabaseSync(file);
    a.exec('pragma journal_mode = wal; pragma busy_timeout = 300;');
    migrate(a as unknown as Db);
    const b = new DatabaseSync(file);
    b.exec('pragma busy_timeout = 300;');
    const id = daily(new EventStore(a as unknown as Db));
    const later = NOW + 100 * DAY;
    const other = new EventStore(b as unknown as Db);
    let fired = false;
    // a 가 가장 늦은 회차를 읽은 직후 b 가 같은 확장을 끝낸다 (묶음이 없으면 a 가 뒤늦게 같은 회차를 또 넣는다)
    const hooked = {
      exec: (sql: string) => a.exec(sql),
      prepare: (sql: string) => {
        const st = a.prepare(sql);
        if (!sql.includes('order by start_at desc limit 1')) return st;
        return {
          get: (...args: unknown[]) => {
            const row = (st.get as (...p: unknown[]) => unknown)(...args);
            if (!fired) {
              fired = true;
              try {
                other.dueReminders(later);
              } catch {
                // a 가 쓰기 잠금을 쥐고 있으면 b 는 기다리다 실패한다. 그래도 중복은 없어야 한다
              }
            }
            return row;
          },
          all: (...args: unknown[]) => (st.all as (...p: unknown[]) => unknown)(...args),
          run: (...args: unknown[]) => (st.run as (...p: unknown[]) => unknown)(...args),
        };
      },
    };
    new EventStore(hooked as unknown as Db).dueReminders(later);
    assert.ok(fired);
    assert.equal(count(a as unknown as Db, DUP, id), 0);
    a.close();
    b.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('같은 반복의 같은 시각을 직접 넣으면 유일 색인이 막는다', () => {
  const db = memory();
  const id = daily(new EventStore(db));
  const row = db
    .prepare('select start_at from event where repeat_series = ? and id != ? limit 1')
    .get(id, id) as {
    start_at: number;
  };
  assert.throws(() =>
    db
      .prepare(
        'insert into event (title, start_at, created_at, repeat_kind, repeat_series) values (?, ?, ?, ?, ?)',
      )
      .run('복제', row.start_at, NOW, 'daily', id),
  );
});

test('21판 올리기: 이미 생긴 중복 회차를 살아 있는 것 하나만 남기고 정리한다', () => {
  const db = new DatabaseSync(':memory:') as unknown as Db;
  db.exec('begin');
  for (const sql of MIGRATIONS.slice(0, 20)) db.exec(sql);
  db.exec('pragma user_version = 20; commit');
  const ins = db.prepare(
    'insert into event (title, start_at, remind_min, created_at, repeat_kind, repeat_series, deleted_at, user_edited) values (?, ?, 10, 0, ?, ?, ?, ?)',
  );
  const t = NOW + DAY;
  const trashed = Number(ins.run('지운 복제', t, 'daily', 1, NOW, 0).lastInsertRowid);
  const live = Number(ins.run('살아 있는 것', t, 'daily', 1, null, 0).lastInsertRowid);
  const extra = Number(ins.run('중복', t, 'daily', 1, null, 0).lastInsertRowid);
  const other = Number(ins.run('다른 시각', t + DAY, 'daily', 1, null, 0).lastInsertRowid);
  for (const id of [trashed, live, extra, other])
    db.prepare("insert into reminder (kind, ref_id, before_min) values ('event', ?, 10)").run(id);
  assert.deepEqual(migrate(db), { from: 20, to: SCHEMA_VERSION });
  const ids = (db.prepare('select id from event order by id').all() as { id: number }[]).map((r) => r.id);
  assert.deepEqual(ids, [live, other]);
  assert.equal(count(db, "select count(*) n from reminder where kind = 'event'"), 2);
  assert.throws(() => ins.run('또', t, 'daily', 1, null, 0));
});

test('지운 회차와 영구 삭제한 회차는 이어 만들 때 다시 생기지 않고 오류도 없다', () => {
  const db = memory();
  const events = new EventStore(db);
  const id = daily(events);
  const rows = db.prepare('select id from event where repeat_series = ? order by start_at').all(id) as {
    id: number;
  }[];
  const soft = rows[3]?.id as number;
  const hard = rows[4]?.id as number;
  events.remove(soft, NOW);
  events.remove(hard, NOW);
  events.purgeTrash(hard, NOW);
  const before = count(db, 'select count(*) n from event where repeat_series = ?', id);
  events.dueReminders(NOW + 200 * DAY);
  assert.equal(count(db, DUP, id), 0);
  assert.ok(count(db, 'select count(*) n from event where repeat_series = ?', id) > before);
  const skipped = db.prepare('select start_at from event_repeat_skip where series_id = ?').all(id) as {
    start_at: number;
  }[];
  assert.equal(skipped.length, 1);
  assert.equal(
    count(
      db,
      'select count(*) n from event where repeat_series = ? and start_at = ?',
      id,
      skipped[0]?.start_at,
    ),
    0,
  );
});

test('가장 늦은 회차를 먼 날짜로 옮겨도 뒤 회차가 이어 만들어진다', () => {
  const db = memory();
  const events = new EventStore(db);
  const id = daily(events);
  const last = events
    .stored(0, NOW + 5 * 365 * DAY)
    .filter((e) => e.id !== id)
    .at(-1);
  assert.ok(last);
  events.update(last.id, { startAt: NOW + 5 * 365 * DAY }, NOW);
  events.between(NOW, NOW + 800 * DAY);
  const n = count(
    db,
    'select count(*) n from event where repeat_series = ? and start_at > ? and start_at < ?',
    id,
    NOW + 366 * DAY,
    NOW + 700 * DAY,
  );
  assert.ok(n > 300, `뒤 회차 ${n}개`);
  assert.equal(count(db, DUP, id), 0);
});

test('회차를 같은 반복의 다른 회차 시각으로 옮기면 오류로 알린다', () => {
  const db = memory();
  const events = new EventStore(db);
  const id = daily(events);
  const [first, second] = db
    .prepare('select id, start_at from event where repeat_series = ? order by start_at')
    .all(id) as { id: number; start_at: number }[];
  assert.throws(
    () => events.update(first?.id as number, { startAt: Number(second?.start_at) }, NOW),
    /이미 회차/,
  );
});

test('할 일 고치기 입력의 마감은 달력에 있는 날만 받는다', () => {
  assert.deepEqual(todoPatchInput({ due: '2026-02-30' }), {});
  assert.deepEqual(todoPatchInput({ due: '2026-13-01' }), {});
  assert.deepEqual(todoPatchInput({ due: '2026-02-28' }), { due: '2026-02-28' });
  assert.deepEqual(todoPatchInput({ due: '2028-02-29' }), { due: '2028-02-29' });
  assert.deepEqual(todoPatchInput({ due: null }), { due: null });
});

test('복원하면 오늘 계획 파일도 지운다 (꼭 할 일 번호가 다른 할 일을 가리킨다)', () => {
  assert.ok(STALE_AFTER_RESTORE.includes('day-plan.json'));
  assert.ok(STALE_AFTER_RESTORE.includes('doing.json'));
});
