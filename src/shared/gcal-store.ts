// 구글 캘린더에 쓰기: 저장 파일 쪽 (10판 칸 google_id, google_cal, google_hash, google_uid).
// 보낼 것을 따로 줄 세우지 않는다: 저장 파일이 곧 줄이다. 일정의 지금 내용 지문이 마지막으로 보낸 지문과 다르면 보낼 것,
// 지운 일정에 구글 id 가 있고 아직 구글에서 안 지웠으면 지울 것. 그래서 앱이 꺼지거나 인터넷이 끊겨도
// 다음에 그대로 이어서 보내고, 패널, 빠른 입력, 펫 MCP 서버(다른 프로세스) 어디서 고쳐도 똑같이 따라간다.
import type { Db } from './db-schema.ts';
import type { EventStore } from './event-store.ts';
import { GCAL_DELETED, type GcalBody, gcalHash, toGoogle } from './gcal.ts';

const DAY_MS = 86_400_000;
/** 한 번에 보낼 수 (많으면 다음 차례에) */
const BATCH = 200;
/** 한 번에 훑을 줄 상한 (이미 보낸 일정이 아주 많아도 한 차례가 길어지지 않게) */
const SCAN_MAX = 20_000;

export type GcalOp =
  | {
      kind: 'upsert';
      eventId: number;
      /** 이미 정한 구글 id (없으면 새로 정해 넣는다) */
      googleId: string | null;
      /** 구글에 들어간 것을 확인했는지 (아니면 넣기부터: 이미 있으면 409 → 고치기) */
      confirmed: boolean;
      calendarId: string;
      /** 보낼 캘린더를 바꿨으면 새 캘린더 (구글에 들어간 일정을 옮긴다) */
      moveTo?: string;
      body: GcalBody;
      hash: string;
    }
  | {
      kind: 'delete';
      eventId: number;
      googleId: string;
      calendarId: string;
      /** 지금 고른 캘린더가 아닌 곳의 일정 (그 캘린더를 못 쓰면 지운 것으로 치고 넘어간다) */
      stale: boolean;
    };

interface Row {
  id: number;
  start_at: number;
  deleted_at: number | null;
  google_id: string | null;
  google_cal: string | null;
  google_hash: string | null;
  google_uid: string | null;
}

export class GcalStore {
  #db: Db;
  #events: EventStore;

  constructor(db: Db, events: EventStore) {
    this.#db = db;
    this.#events = events;
  }

  /**
   * 지금 보낼 것. 짝꿍이 넣은 일정(source = local)만: 캘린더에서 가져온 일정(ics)은 구글로 되돌려 보내지 않는다.
   * 처음 보내는 것은 끝이 어제 이후인 일정만 (켜자마자 몇 년 치 지난 일정을 쏟아 넣지 않게).
   * 한 번 보낸 것은 언제 것이든 고치기와 지우기를 따라간다
   */
  pending(now: number, calendarId: string, tz: string): GcalOp[] {
    // 줄이 아니라 보낼 것을 BATCH 개 모을 때까지 (start_at, id) 순으로 넘겨 가며 훑는다.
    // 예전에는 이미 보낸 일정 200개가 늘 앞자리를 차지해 그 뒤 새 일정, 고치기, 지우기를 영영 보내지 못했다
    const stmt = this.#db.prepare(
      `select id, start_at, deleted_at, google_id, google_cal, google_hash, google_uid from event
       where source = 'local' and (start_at > ? or (start_at = ? and id > ?)) and (
         (deleted_at is null and (google_id is not null or coalesce(end_at, start_at) >= ?))
         or (deleted_at is not null and google_id is not null and coalesce(google_hash, '') != ?)
       ) order by start_at, id limit ?`,
    );
    const ops: GcalOp[] = [];
    let after = { start: Number.MIN_SAFE_INTEGER, id: 0 };
    for (let scanned = 0; ops.length < BATCH && scanned < SCAN_MAX; ) {
      const rows = stmt.all(after.start, after.start, after.id, now - DAY_MS, GCAL_DELETED, BATCH) as Row[];
      if (rows.length === 0) break;
      scanned += rows.length;
      const last = rows[rows.length - 1] as Row;
      after = { start: Number(last.start_at), id: Number(last.id) };
      this.#collect(rows, ops, calendarId, tz);
      if (rows.length < BATCH) break;
    }
    return ops.slice(0, BATCH);
  }

  #collect(rows: Row[], ops: GcalOp[], calendarId: string, tz: string): void {
    for (const r of rows) {
      const id = Number(r.id);
      if (r.deleted_at !== null) {
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
      const e = this.#events.get(id);
      if (!e) continue;
      const body = toGoogle(e, tz);
      const hash = gcalHash(body);
      const confirmed = !!r.google_id && r.google_uid !== null;
      // 구글에 들어간 것은 그 캘린더에서 고친다. 보낼 캘린더를 바꿨으면 새 캘린더로 옮긴다
      const at = confirmed ? (r.google_cal ?? calendarId) : calendarId;
      const moveTo = confirmed && at !== calendarId ? calendarId : undefined;
      if (r.google_id && hash === r.google_hash && !moveTo) continue;
      ops.push({
        kind: 'upsert',
        eventId: id,
        googleId: r.google_id,
        confirmed,
        calendarId: at,
        ...(moveTo ? { moveTo } : {}),
        body,
        hash,
      });
    }
  }

  /** 옮겼다: 이제 이 캘린더의 일정 */
  setCalendar(eventId: number, calendarId: string): void {
    this.#db.prepare('update event set google_cal = ? where id = ?').run(calendarId, eventId);
  }

  /**
   * 보낸 기록을 "확인 전"으로 되돌린다 (연결 끊기, 다른 계정, 백업 가져오기). id 는 두고 다시 넣기부터 한다:
   * 같은 계정이면 409 → 고치기라 겹치지 않고, 다른 계정이면 새로 들어간다
   */
  resetSent(): void {
    this.#db
      .prepare(
        'update event set google_uid = null, google_hash = null where google_id is not null and deleted_at is null',
      )
      .run();
  }

  /** 보내기 전에 구글 id 를 정해 적는다 (보낸 뒤 대답을 못 받아도 다시 보낼 때 같은 id 라 겹치지 않는다) */
  assignId(eventId: number, googleId: string, calendarId: string): void {
    this.#db
      .prepare(
        'update event set google_id = ?, google_cal = ?, google_hash = null, google_uid = null where id = ?',
      )
      .run(googleId, calendarId, eventId);
  }

  /** 보냈다. uid 는 구글이 준 iCalUID */
  markSent(eventId: number, hash: string, uid: string | null): void {
    this.#db
      .prepare('update event set google_hash = ?, google_uid = coalesce(?, google_uid) where id = ?')
      .run(hash, uid, eventId);
  }

  /** 구글에서도 지웠다 (없던 것도) */
  markDeleted(eventId: number): void {
    this.#db.prepare('update event set google_hash = ? where id = ?').run(GCAL_DELETED, eventId);
  }

  /** 구글에 그 일정이 없다 (다른 계정, 구글에서 지움): id 를 버리고 다음에 새로 넣는다 */
  forget(eventId: number): void {
    this.#db
      .prepare(
        'update event set google_id = null, google_cal = null, google_hash = null, google_uid = null where id = ?',
      )
      .run(eventId);
  }

  /**
   * 짝꿍이 구글로 보낸 일정의 iCalUID 들. 캘린더 가져오기(.ics)가 같은 캘린더를 읽으면 이것들이 되돌아오니 거른다
   * (짝꿍 일정과 가져온 일정이 둘씩 보이지 않게)
   */
  sentUids(): Set<string> {
    const rows = this.#db
      .prepare("select google_id, google_uid from event where source = 'local' and google_id is not null")
      .all() as { google_id: string; google_uid: string | null }[];
    const out = new Set<string>();
    for (const r of rows) {
      out.add(`${r.google_id}@google.com`);
      if (r.google_uid) out.add(r.google_uid);
    }
    return out;
  }
}
