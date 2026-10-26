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
  // 4판: v1 펫과 놀이, 게임. 삐짐, 기분, 친밀도, 아이템(먹이, 장난감, 집), 산책 분
  `
  alter table pet_state add column affection integer not null default 0; -- 친밀도. 줄지 않는다
  alter table pet_state add column mood real not null default 50;       -- 기분 0~100. 날이 바뀌면 50
  alter table pet_state add column mood_day text;
  alter table pet_state add column last_active_day text;  -- 마지막 활동 날 (할 일 끝냄, 클릭, 채팅, 밥)
  alter table pet_state add column sulk integer not null default 0;     -- 삐짐 칸 수
  alter table pet_state add column sulk_said_day text;     -- 삐짐 대사를 한 날 (하루 한 번)
  alter table pet_state add column petted_day text;        -- 쓰다듬은 날 (쓰다듬기 + 밥 = 화해)
  alter table pet_state add column fed_day text;
  alter table pet_state add column makeup_at integer;      -- 화해 보너스를 받은 때 (7일에 한 번)

  create table item (
    id integer primary key,
    kind text not null,          -- food, toy, house
    key text not null unique,    -- 기본 아이템 이름표 또는 custom-...
    name text not null,
    image text,                  -- 사용자 데이터 폴더의 그림 파일 이름 (커스텀 먹이)
    count integer not null default 0,
    created_at integer not null
  );

  alter table daily_stat add column walk_min integer not null default 0;
  `,
  // 5판: v2 업적, 캘린더 가져오기
  `
  create table achievement (
    key text primary key,
    at integer not null           -- 받은 때
  );
  alter table event add column source text not null default 'local'; -- local, ics
  alter table event add column external_id text;                     -- ics UID (다시 가져올 때 겹치지 않게)
  create unique index event_external on event(source, external_id) where external_id is not null;
  `,
  // 6판: 캘린더 가져오기 고침 (버그잡이 6차). external_id 는 반복 일정이면 "UID#회차" 라 회차마다 한 행이다.
  // 지금 지워져 있는 행은 사용자가 지운 것으로 본다: 예전 판은 지운 가져온 일정을 다음 맞춤에서 되살려서,
  // 지금 지워진 채인 것은 대개 사용자가 막 지운 것이다
  `
  alter table event add column user_edited integer not null default 0; -- 패널에서 제목이나 시각을 고침. 가져오기가 덮지 않는다
  alter table event add column removed_by text;                         -- user(사용자가 지움, 다시 가져와도 그대로), sync(캘린더에서 없어짐)
  update event set removed_by = 'user' where deleted_at is not null;
  `,
  // 7판: 종일 일정. 일정 탭에 "내일 제주도 여행"처럼 시각 없이 적은 것과 캘린더에서 가져온 종일 일정.
  // start_at 은 첫날 현지 0시. end_at 은 여러 날이면 마지막 날 다음 날 현지 0시(ics DTEND 처럼 끝 날은 들지 않는다), 하루면 null.
  // 종일 일정의 remind_min 은 첫날 0시보다 몇 분 앞에 알릴지이고 0 이면 알리지 않는다 (아침 브리핑에 나온다).
  // 예전 판은 가져온 종일 일정을 알림 0, 알린 시각 = 시작 시각으로 넣었다. 그 모양을 종일로 표시한다
  `
  alter table event add column all_day integer not null default 0; -- 1 이면 종일
  update event set all_day = 1 where source = 'ics' and remind_min = 0 and notified_at = start_at;
  `,
  // 8판: 여러 개 미리 알림 (일정과 할 일), 할 일 마감 시각. 셈은 shared/remind.ts.
  // before_min 은 기준보다 몇 분 앞에 알릴지. 기준은 시각 일정이면 시작 시각, 종일 일정과 마감일만 있는 할 일이면 그날 0시
  // (240 = 전날 저녁 8시, -540 = 당일 아침 9시), 마감 시각이 있는 할 일이면 그 시각.
  // notified_at 은 null 이면 아직, 0 이면 말없이 넘김(넣을 때 이미 지났거나 늦어서 쓸모없음), 그 밖은 말한 시각.
  // 일정은 지금 알림(remind_min) 하나를 첫 알림으로 옮긴다. 알림 없는 종일 일정(remind_min 0)은 옮기지 않는다.
  // 시작이 이미 지났는데 안 알린 것은 넘긴 것으로 둔다. remind_min, notified_at 칸은 남겨 두지만 더 읽지 않는다.
  // 할 일은 기본 알림(전날 저녁 8시)을 단다. 끝냈거나 지웠거나 마감이 오늘이거나 지난 것, 그 알림 시각이 이미 지난 것은 넘긴 것으로 둔다
  `
  create table reminder (
    kind text not null,          -- event, todo
    ref_id integer not null,     -- event.id, todo.id
    before_min integer not null,
    notified_at integer,
    primary key (kind, ref_id, before_min)
  ) without rowid;
  alter table todo add column due_min integer; -- 마감 시각 (하루 안의 분, 현지). 없으면 날짜만

  insert into reminder (kind, ref_id, before_min, notified_at)
    select 'event', id, remind_min,
      case when notified_at is not null then notified_at
           when start_at + 300000 <= cast(strftime('%s', 'now') as integer) * 1000 then 0
           else null end
    from event where not (all_day = 1 and remind_min = 0);
  insert into reminder (kind, ref_id, before_min, notified_at)
    select 'todo', id, 240,
      case when done_at is not null or deleted_at is not null or due <= date('now', 'localtime')
                or datetime(due, '-1 day', '+20 hours') <= datetime('now', 'localtime') then 0
           else null end
    from todo;
  `,
  // 9판: 할 일 단계 (체크리스트). 할 일 하나를 작은 단계로 쪼개 하나씩 지운다. 단계에는 코인이 없다 (끝낸 할 일만 코인).
  // 반복 할 일을 끝내면 다음 회차에 단계를 안 한 채로 옮겨 적는다. 할 일을 지워도 단계는 남지만 읽지 않는다
  `
  create table todo_step (
    id integer primary key,
    todo_id integer not null,    -- todo.id
    title text not null,
    done integer not null default 0,
    ord integer not null,        -- 할 일 안 순서 (작은 것이 위)
    created_at integer not null
  );
  create index todo_step_todo on todo_step(todo_id, ord);
  `,
  // 10판: 구글 캘린더에 쓰기 (짝꿍에서 넣은 일정을 구글로, shared/gcal.ts). 짝꿍이 넣은 일정(source = local)만 보낸다.
  // google_id 는 짝꿍이 정해 보내는 구글 일정 id (다시 보내도 겹치지 않게 미리 정한다). google_cal 은 보낸 캘린더.
  // google_hash 는 마지막으로 보낸 내용의 지문이라 바뀐 것만 다시 보내고, 'deleted' 면 구글에서도 지웠다.
  // google_uid 는 구글이 준 iCalUID: 캘린더 가져오기(.ics)로 되돌아온 같은 일정을 거른다
  `
  alter table event add column google_id text;
  alter table event add column google_cal text;
  alter table event add column google_hash text;
  alter table event add column google_uid text;
  create index event_google on event(google_id) where google_id is not null;
  `,
  // 11판: 매주 반복 할 일의 요일 기억과 다음 회차 찾기 색인.
  // repeat_anchor 는 지난 마감 옮기기(moveOverdue)가 오늘로 옮긴 매주 할 일의 원래 마감이다. 다음 회차를 그 요일로 센다
  // (월요일 할 일을 수요일에 옮겨 끝내면 다음이 수요일이 됐다). 마감을 직접 고치면 지운다.
  // 되돌리기가 다음 회차를 찾는 repeat_of 에 색인이 없어 할 일이 많으면 표 전체를 훑었다
  `
  alter table todo add column repeat_anchor text;
  create index todo_repeat_of on todo(repeat_of) where repeat_of is not null;
  `,
  // 12판: 코인 잔액을 한 행에 (coin_total). 잔액(balance)이 패널을 그릴 때마다 장부 전체를 더했다.
  // 장부에 쓰거나 지울 때 트리거가 같이 고쳐서, 다른 연결(펫 MCP 서버)이 쓰거나 묶음을 되돌려도 장부 합계와 같다
  `
  create table coin_total (
    id integer primary key check (id = 1),
    total integer not null
  );
  insert into coin_total (id, total) select 1, coalesce(sum(amount), 0) from coin_log;
  create trigger coin_total_insert after insert on coin_log begin
    update coin_total set total = total + new.amount where id = 1;
  end;
  create trigger coin_total_delete after delete on coin_log begin
    update coin_total set total = total - old.amount where id = 1;
  end;
  create trigger coin_total_update after update of amount on coin_log begin
    update coin_total set total = total - old.amount + new.amount where id = 1;
  end;
  `,
  // 13판: 고정(핀). 고정한 시각(ms), 고정 안 했으면 null. 옛 행은 모두 null 이라 고정 안 됨 (shared/pin.ts).
  // 화면 순서만 바꾸는 값이라 메모의 고친 시각(updated_at), 일정의 user_edited, 구글 보내기 지문에 들지 않는다
  `
  alter table todo add column pinned_at integer;
  alter table note add column pinned_at integer;
  alter table event add column pinned_at integer;
  `,
  // 14판: 기록 (#125). 할 일 휴지통 30일과 집중 월간 잔디.
  // 지운 할 일은 deleted_at 으로 이미 목록에서만 빠져 있었다. 이제 30일 휴지통에서 되살리거나 영구 삭제한다.
  // auto_removed 는 사람이 지운 게 아니라 되돌리기가 걷어 낸 다음 회차(1)라 휴지통에 보이지 않는다.
  // focus_session 은 집중 한 번(끝까지 했거나 중간에 그만둔)마다 한 줄: 날마다 가장 길게 이어 간 집중을 보여 주려고.
  // minutes 는 실제 집중한 분이라 잠자기나 시계 점프로 건너뛴 시간은 들지 않는다. day 는 끝난 날 (daily_stat 과 같은 기준)
  `
  alter table todo add column auto_removed integer not null default 0;
  create index todo_trash on todo(deleted_at) where deleted_at is not null;
  -- 13판까지 되돌리기가 걷어 낸 다음 회차(앞 회차가 안 끝난 채 지워진 것)는 사람이 지운 게 아니다
  update todo set auto_removed = 1
    where repeat_of is not null and done_at is null and deleted_at is not null
      and exists (select 1 from todo p where p.id = todo.repeat_of and p.done_at is null);
  -- 지금까지 쓴 가장 큰 할 일 번호. 영구 삭제로 맨 끝 번호가 비어도 다시 쓰지 않는다
  -- (알림 미루기, 집중 끝 연결, 하루 계획이 번호로 할 일을 가리킨다)
  create table todo_hi (
    id integer primary key check (id = 1),
    hi integer not null
  );
  insert into todo_hi (id, hi) select 1, coalesce(max(id), 0) from todo;
  create trigger todo_hi_insert after insert on todo begin
    update todo_hi set hi = max(hi, new.id) where id = 1;
  end;
  create table focus_session (
    id integer primary key,
    day text not null,         -- 끝난 날 YYYY-MM-DD (현지)
    at integer not null,       -- 끝난 시각(ms)
    minutes integer not null
  );
  create index focus_session_day on focus_session(day);
  `,
  // 15판: 할 일 손으로 정한 순서 (#146). 줄을 끌거나 "맨 위로" 로 옮기면 열린 할 일 모두에 1부터 번호를 적는다.
  // 옛 행과 새로 넣은 할 일은 null 이라 그대로 중요, 마감 순 정렬을 따르고, 번호가 있는 것 뒤에 온다
  `
  alter table todo add column sort_ord integer;
  `,
  // 16판: 일정 반복 (#146). 반복 회차는 일정 표에 미리 만들어 알림·달력·검색에서 일반 일정처럼 다룬다.
  `
  alter table event add column repeat_kind text;
  alter table event add column repeat_series integer;
  create index event_repeat_series on event(repeat_series, start_at) where repeat_series is not null;
  `,
  // 17판: DST 보정 뒤에도 반복 일정의 원래 현지 시각을 다음 확장까지 기억한다.
  // repeat_clock 은 현지 자정부터의 밀리초이며 각 회차에 복사해 첫 회차 영구 삭제 뒤에도 쓸 수 있다.
  `
  alter table event add column repeat_clock integer;
  `,
  // 18판: 휴지통에서 영구 삭제한 반복 회차를 다시 만들지 않도록 회차 예외 날짜를 보관한다.
  `
  create table event_repeat_skip (
    series_id integer not null,
    start_at integer not null,
    primary key (series_id, start_at)
  );
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

/** 1판부터 있는 표. 이것들이 있어야 짝꿍 저장 파일로 본다 */
export const REQUIRED_TABLES = ['todo', 'coin_log', 'pet_state'] as const;

/**
 * 짝꿍 저장 파일로 보이는지: 판이 1 이상이고 1판 표가 다 있다. 0바이트 파일, 판 0 인 빈 파일,
 * 다른 앱의 SQLite 파일을 백업이나 복구 후보로 받지 않게 한다 (버그잡이 6차)
 */
export function looksLikeOurs(db: Db): boolean {
  if (schemaVersion(db) < 1) return false;
  const names = new Set(
    (db.prepare("select name from sqlite_master where type = 'table'").all() as { name: string }[]).map(
      (r) => r.name,
    ),
  );
  return REQUIRED_TABLES.every((n) => names.has(n));
}

/** 지금 판에서 최신 판까지 한 판씩 올린다. 판마다 묶음(transaction)으로, 중간에 실패하면 그 판은 통째로 되돌린다. */
export function migrate(db: Db): { from: number; to: number } {
  const from = schemaVersion(db);
  if (from > SCHEMA_VERSION)
    throw new Error(`이 저장 파일(${from}판)은 이 페어리(${SCHEMA_VERSION}판)보다 새 판이다`);
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
