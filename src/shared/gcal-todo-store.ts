// 할 일을 구글 캘린더로 보내기: 저장 파일 쪽 (25판 todo 의 google_id, google_cal, google_hash, google_uid, gcal_tomb).
// 일정(gcal-store.ts)과 같다: 따로 줄을 세우지 않고 저장 파일에서 고른다 (docs/gcal-todo-plan.md 6절).
// 일정의 쪽 나눔(시작 시각 순 200개)은 할 일에 맞지 않아 질의를 새로 짰다.
import { plusDays } from './day.ts';
import type { Db } from './db-schema.ts';
import { GCAL_DELETED, GCAL_TODO_ID_PREFIX, gcalHash } from './gcal.ts';
import type { GcalOp, GcalOpStore } from './gcal-store.ts';
import { FIRST_SEND_BACK_DAYS, isDueDay, todayIn, todoToGoogle } from './gcal-todo.ts';
import { tombClear, tombDone, tombList } from './gcal-tomb.ts';

/** 한 번에 보낼 수 (많으면 다음 차례에) */
const BATCH = 200;
/** 한 번에 훑을 줄 상한 */
const SCAN_MAX = 20_000;

interface Row {
  id: number;
  uid: string | null;
  title: string;
  due: string | null;
  due_min: number | null;
  done_at: number | null;
  deleted_at: number | null;
  google_id: string | null;
  google_cal: string | null;
  google_hash: string | null;
  google_uid: string | null;
}

export class GcalTodoStore implements GcalOpStore {
  readonly idPrefix = GCAL_TODO_ID_PREFIX;
  #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  /**
   * 지금 보낼 것.
   * - 올릴 것: 끝내지 않았고 지우지 않았고 날짜가 있고, (올린 적 있음 또는 날짜가 30일 전 이후), 지문이 다름.
   *   한 번 올린 할 일은 끝내거나 지울 때까지 둔다 (날짜를 옮길 때마다 휴대폰에서 사라졌다 생기지 않게)
   * - 지울 것: 끝냈거나 지웠거나 날짜를 뺐는데 구글 id 가 있고 아직 구글에서 안 지운 것, 그리고 무덤 줄 전부
   * 지문은 구글로 보낼 몸과 이 컴퓨터 시간대로 만든다. 밀린 할 일은 오늘 종일 일정이라 지문에 오늘이 든다
   */
  pending(now: number, calendarId: string, tz: string): GcalOp[] {
    const today = todayIn(now, tz);
    const first = plusDays(today, -FIRST_SEND_BACK_DAYS);
    const rows = this.#db
      .prepare(
        `select id, uid, title, due, due_min, done_at, deleted_at, google_id, google_cal, google_hash, google_uid
         from todo where
           (done_at is null and deleted_at is null and due is not null and (google_id is not null or due >= ?))
           or (google_id is not null and coalesce(google_hash, '') != ?
               and (done_at is not null or deleted_at is not null or due is null))
         order by id limit ?`,
      )
      .all(first, GCAL_DELETED, SCAN_MAX) as unknown as Row[];
    const ops: GcalOp[] = tombList(this.#db, 'todo', BATCH).map((x) => ({
      kind: 'delete',
      eventId: -x.rowid,
      googleId: x.googleId,
      calendarId: x.calendarId || calendarId,
      stale: (x.calendarId || calendarId) !== calendarId,
    }));
    for (const r of rows) {
      if (ops.length >= BATCH) break;
      const id = Number(r.id);
      const open = r.done_at === null && r.deleted_at === null && isDueDay(r.due);
      if (!open) {
        if (r.google_id)
          ops.push({
            kind: 'delete',
            eventId: id,
            googleId: r.google_id,
            calendarId: r.google_cal ?? calendarId,
            stale: (r.google_cal ?? calendarId) !== calendarId,
          });
        continue;
      }
      const body = todoToGoogle({ title: r.title, due: r.due as string, dueMin: r.due_min }, { tz, today });
      const hash = gcalHash(body);
      const confirmed = !!r.google_id && r.google_uid !== null;
      // 구글에 들어간 것은 그 캘린더에서 고친다. 올릴 캘린더를 바꿨으면 새 캘린더로 옮긴다
      const at = confirmed ? (r.google_cal ?? calendarId) : calendarId;
      const moveTo = confirmed && at !== calendarId ? calendarId : undefined;
      if (r.google_id && hash === r.google_hash && !moveTo) continue;
      ops.push({
        kind: 'upsert',
        eventId: id,
        googleId: r.google_id,
        ...(r.uid ? { uid: r.uid } : {}),
        confirmed,
        calendarId: at,
        ...(moveTo ? { moveTo } : {}),
        body,
        hash,
      });
    }
    return ops.slice(0, BATCH);
  }

  /** 옮겼다: 이제 이 캘린더의 일정 */
  setCalendar(id: number, calendarId: string): void {
    this.#db.prepare('update todo set google_cal = ? where id = ?').run(calendarId, id);
  }

  /** 보낸 기록을 "확인 전"으로 되돌린다 (연결 끊기, 연결 끝남, 백업 가져오기). 구글에서 지웠다는 표시는 둔다 */
  resetSent(): void {
    this.#db
      .prepare(
        `update todo set google_uid = null,
           google_hash = case when google_hash = ? then google_hash else null end
         where google_id is not null`,
      )
      .run(GCAL_DELETED);
  }

  /** 보내기 전에 구글 id 를 정해 적는다 (대답을 못 받아도 다시 보낼 때 같은 id 라 겹치지 않는다) */
  assignId(id: number, googleId: string, calendarId: string): void {
    this.#db
      .prepare(
        'update todo set google_id = ?, google_cal = ?, google_hash = null, google_uid = null where id = ?',
      )
      .run(googleId, calendarId, id);
  }

  /** 보냈다. uid 는 구글이 준 iCalUID */
  markSent(id: number, hash: string, uid: string | null): void {
    this.#db
      .prepare('update todo set google_hash = ?, google_uid = coalesce(?, google_uid) where id = ?')
      .run(hash, uid, id);
  }

  /** 구글에서도 지웠다 (없던 것도). 음수 id 는 무덤 줄이라 줄을 뺀다 */
  markDeleted(id: number): void {
    if (id < 0) tombDone(this.#db, -id);
    else this.#db.prepare('update todo set google_hash = ? where id = ?').run(GCAL_DELETED, id);
  }

  /** 구글에 그 일정이 없다 (다른 계정, 구글에서 지움): id 를 버리고 다음에 새로 넣는다 */
  forget(id: number): void {
    this.#db
      .prepare(
        'update todo set google_id = null, google_cal = null, google_hash = null, google_uid = null where id = ?',
      )
      .run(id);
  }

  /** 연결을 끊을 때: 무덤을 비운다 (일정 쪽 무덤도 같은 표라 같이 빈다) */
  clearTomb(): void {
    tombClear(this.#db);
  }

  /** 구글에 올라가 있는 할 일 수 (설정 칸의 "올린 개수") */
  sentCount(): number {
    return Number(
      (
        this.#db
          .prepare(
            `select count(*) as n from todo where google_id is not null and google_uid is not null
             and coalesce(google_hash, '') != ? and done_at is null and deleted_at is null`,
          )
          .get(GCAL_DELETED) as { n: number }
      ).n,
    );
  }
}
