// SQLite 스키마 (P2-01). node:sqlite 를 쓴다: Electron 44 의 Node 24.21 에 들어 있어 네이티브 모듈 빌드가 없다.
// 버전은 PRAGMA user_version 에 적고, 앱이 올라갈 때 순서대로 바꾼다. 바꾸기 전 파일 복사는 메인이 한다.

/** 버전 n 으로 올리는 SQL. 배열 순서 = 버전 (0번은 1판으로 올리는 것). 한 번 내보낸 판은 고치지 않고 새 판을 더한다. */
export const MIGRATIONS: readonly string[] = [
  // 1판: 할 일, 코인 장부, 펫 상태
  `
  create table todo (
    id integer primary key,
    title text not null,
    due text,                 -- 마감일 YYYY-MM-DD (현지 날짜), 없으면 null
    important integer not null default 0,
    created_at integer not null,
    done_at integer,          -- 완료 시각(ms), 안 끝났으면 null
    coins integer not null default 0, -- 이 할 일로 받은 코인 (되돌릴 때 회수)
    deleted_at integer
  );
  create index todo_open on todo(done_at, deleted_at);

  create table coin_log (
    id integer primary key,
    amount integer not null,  -- +는 획득, -는 소비나 회수
    reason text not null,     -- todo, early, undo, food
    ref_id integer,
    day text not null,        -- 현지 날짜 YYYY-MM-DD (하루 상한 계산용)
    at integer not null
  );
  create index coin_day on coin_log(day, reason);

  create table pet_state (
    id integer primary key check (id = 1),
    fullness real not null,
    fullness_at integer not null
  );
  `,
  // 2판: 베타 기록 (P4-04). 성공 기준 화면용. 완료한 할 일 수는 todo 에서 세어 따로 적지 않는다.
  `
  create table daily_stat (
    day text primary key,     -- 현지 날짜 YYYY-MM-DD
    on_min integer not null default 0,     -- 켜 두고 화면이 잠기지 않은 분
    hidden_min integer not null default 0, -- 그중 사용자가 펫을 숨긴 분 (발표 자동 숨김은 빼고)
    look_count integer not null default 0, -- 같이 보기로 화면을 찍은 횟수
    crash_count integer not null default 0 -- 비정상 종료와 창 멈춤
  );
  `,
  // 3판: v1 생산성. 반복 할 일, 메모, 일정, 집중 시간
  `
  alter table todo add column repeat text;          -- daily, weekdays, weekly. 없으면 null
  alter table todo add column repeat_of integer;    -- 반복 할 일을 끝내서 생긴 다음 회차면 앞 회차 id

  create table note (
    id integer primary key,
    title text not null default '',
    body text not null default '',    -- 마크다운
    source text not null default 'me', -- me, ai
    created_at integer not null,
    updated_at integer not null,
    deleted_at integer
  );
  create index note_live on note(deleted_at, updated_at);

  create table event (
    id integer primary key,
    title text not null,
    start_at integer not null,        -- ms
    end_at integer,
    remind_min integer not null default 10, -- 시작 몇 분 전에 알릴지 (0 이면 시작할 때)
    notified_at integer,              -- 알림을 띄운 시각. 시작 시각을 바꾸면 비운다
    created_at integer not null,
    deleted_at integer
  );
  create index event_start on event(deleted_at, start_at);

  alter table daily_stat add column focus_min integer not null default 0;
  `,
];

export const SCHEMA_VERSION = MIGRATIONS.length;

/** node:sqlite DatabaseSync 에서 쓰는 만큼만. 시험에서도 같은 것을 쓴다. */
export interface Db {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
}

export function schemaVersion(db: Db): number {
  return Number((db.prepare('pragma user_version').get() as { user_version: number }).user_version);
}

/** 지금 판에서 최신 판까지 한 판씩 올린다. 판마다 묶음(transaction)으로, 중간에 실패하면 그 판은 통째로 되돌린다. */
export function migrate(db: Db): { from: number; to: number } {
  const from = schemaVersion(db);
  if (from > SCHEMA_VERSION)
    throw new Error(`이 저장 파일(${from}판)은 이 짝꿍(${SCHEMA_VERSION}판)보다 새 판이다`);
  for (let v = from; v < SCHEMA_VERSION; v++) {
    db.exec('begin');
    try {
      db.exec(MIGRATIONS[v] ?? '');
      db.exec(`pragma user_version = ${v + 1}`);
      db.exec('commit');
    } catch (err) {
      db.exec('rollback');
      throw err;
    }
  }
  return { from, to: SCHEMA_VERSION };
}
