// 영구 삭제된 행의 구글 일정을 나중에라도 지우려고 남기는 무덤 표 (25판 gcal_tomb, docs/gcal-todo-plan.md 6절).
// 행이 지워지면 구글 id 도 같이 사라져 구글 일정을 지울 근거가 없어진다. 그래서 행을 지우기 전에 여기로 옮기고,
// 보내기가 구글에서 지운 뒤 줄을 뺀다. 할 일(todo)과 일정(event) 둘이 같이 쓴다.
import type { Db } from './db-schema.ts';
import { GCAL_DELETED } from './gcal.ts';

export type TombKind = 'todo' | 'event';

/**
 * 조건에 맞는 행 가운데 구글에 올라가 있는 것(구글 id 가 있고 구글에서 지웠다고 적히지 않은 것)을 무덤으로 옮긴다.
 * where 는 호출하는 쪽이 만든 조건뿐이다 (사용자 글을 이어 붙이지 않는다). 값은 params 로 받는다. 지우기 직전에 부른다
 */
export function tombRows(db: Db, kind: TombKind, where: string, at: number, ...params: unknown[]): number {
  return Number(
    db
      .prepare(
        `insert or replace into gcal_tomb (kind, google_id, google_cal, at)
         select '${kind}', google_id, coalesce(google_cal, ''), ? from ${kind}
         where (${where}) and google_id is not null and coalesce(google_hash, '') != ?`,
      )
      .run(Math.floor(at), ...params, GCAL_DELETED).changes,
  );
}

export interface TombRow {
  rowid: number;
  googleId: string;
  /** 보낸 캘린더. 모르면 빈 글 */
  calendarId: string;
}

export function tombList(db: Db, kind: TombKind, limit: number): TombRow[] {
  return (
    db
      .prepare(
        'select rowid as r, google_id, google_cal from gcal_tomb where kind = ? order by at, rowid limit ?',
      )
      .all(kind, limit) as { r: number; google_id: string; google_cal: string }[]
  ).map((x) => ({ rowid: Number(x.r), googleId: x.google_id, calendarId: x.google_cal }));
}

export function tombDone(db: Db, rowid: number): void {
  db.prepare('delete from gcal_tomb where rowid = ?').run(rowid);
}

/** 연결을 끊으면 비운다 (다른 계정의 일정을 지우려 들지 않게) */
export function tombClear(db: Db): void {
  db.exec('delete from gcal_tomb');
}
