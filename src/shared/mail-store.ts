// 쪽지함 저장 (feat/mailbox): 받은 펫 쪽지(매일, 특별한 편지, 주간, 저녁), 서버 쪽지(운영자, 정기 지급, 친구), 공지를 한 표에 둔다.
// 이 컴퓨터의 저장 파일(jjakkung.db)에만 있고 서버로 보내지 않는다. 읽음, 보관, 지움, 고정은 기기 안에서만 정한다
// (서버 쪽지의 서버 쪽 상태는 그대로). 지운 것은 휴지통에 MAIL_TRASH_DAYS 일 두었다가 영구 삭제한다.
// 줄 글은 사전 열쇠와 값으로 저장해 언어를 바꿔도 다시 읽히고(펫 쪽지), 서버 쪽지는 받은 그대로(snapshot) 둬 오프라인에서도 보인다.
import type { Db } from './db-schema.ts';

export type MailSource = 'local' | 'server' | 'notice';
/** 종류: daily 매일 쪽지, letter 특별한 편지, week 주간 편지, evening 저녁 쪽지, 그 밖은 서버 쪽지 종류, announce 공지 */
export type MailKind =
  | 'daily'
  | 'letter'
  | 'week'
  | 'evening'
  | 'grant'
  | 'notice'
  | 'subscription'
  | 'gift'
  | 'friend'
  | 'gift_back'
  | 'announce';

export const MAIL_KINDS: readonly MailKind[] = [
  'daily',
  'letter',
  'week',
  'evening',
  'grant',
  'notice',
  'subscription',
  'gift',
  'friend',
  'gift_back',
  'announce',
];
export const isMailKind = (v: unknown): v is MailKind => (MAIL_KINDS as readonly unknown[]).includes(v);

/** 지운 쪽지를 휴지통에 두는 날 (할 일, 메모와 같다) */
export const MAIL_TRASH_DAYS = 30;
/** 이 컴퓨터에서 만든 쪽지를 이만큼까지 둔다 (넘으면 가장 오래된 읽은 것부터 휴지통으로. 고정, 보관한 것은 남긴다) */
export const MAIL_LOCAL_MAX = 2000;
const DAY_MS = 86_400_000;

/** 휴지통 기한이 지나 글을 비운 서버 쪽지인가 (묘비). 화면에는 내지 않는다 */
export const isPurged = (r: Pick<MailRow, 'source' | 'deletedAt'>, now: number): boolean =>
  r.source === 'server' && r.deletedAt !== null && r.deletedAt < now - MAIL_TRASH_DAYS * DAY_MS;

export interface MailRow {
  id: string;
  source: MailSource;
  kind: MailKind;
  /** 받은 날 YYYY-MM-DD (현지) */
  day: string;
  /** 받은 시각 (ms). 정렬에 쓴다 */
  at: number;
  look: 'note' | 'letter';
  milestone: number | null;
  coins: number | null;
  /** 줄 글과 값 (펫 쪽지), 서버 쪽지 원본, 공지 글 */
  payload: unknown;
  readAt: number | null;
  archivedAt: number | null;
  deletedAt: number | null;
  pinnedAt: number | null;
  /** 특별한 편지의 코인을 준 시각 (안 읽음으로 되돌려도 지워지지 않는다. 없으면 아직 안 줬다) */
  coinsPaidAt: number | null;
}

/** 새로 넣거나 내용을 바꿀 때 주는 칸 (읽음, 보관, 지움, 고정은 따로) */
export type MailPut = Omit<MailRow, 'readAt' | 'archivedAt' | 'deletedAt' | 'pinnedAt' | 'coinsPaidAt'> & {
  /** 처음 넣을 때만 쓴다 (이미 있는 쪽지의 읽음은 그대로) */
  readAt?: number | null;
  /** 처음 넣을 때만 쓴다 (옛 파일에서 옮기는 읽은 편지는 받은 것으로) */
  coinsPaidAt?: number | null;
};

interface Row {
  id: string;
  source: string;
  kind: string;
  day: string;
  at: number;
  look: string;
  milestone: number | null;
  coins: number | null;
  payload: string;
  read_at: number | null;
  archived_at: number | null;
  deleted_at: number | null;
  pinned_at: number | null;
  coins_paid: number | null;
}

const ms = (v: unknown): number | null => {
  const n = Number(v);
  return v === null || v === undefined || !Number.isFinite(n) ? null : n;
};

function toRow(r: Row): MailRow {
  let payload: unknown = null;
  try {
    payload = JSON.parse(r.payload);
  } catch {
    // 깨진 글은 빈 값으로 (그 쪽지만 비어 보이고 앱은 계속 간다)
  }
  return {
    id: r.id,
    source: r.source === 'server' || r.source === 'notice' ? r.source : 'local',
    kind: isMailKind(r.kind) ? r.kind : 'daily',
    day: r.day,
    at: Number(r.at),
    look: r.look === 'letter' ? 'letter' : 'note',
    milestone: ms(r.milestone),
    coins: ms(r.coins),
    payload,
    readAt: ms(r.read_at),
    archivedAt: ms(r.archived_at),
    deletedAt: ms(r.deleted_at),
    pinnedAt: ms(r.pinned_at),
    coinsPaidAt: ms(r.coins_paid),
  };
}

export class MailStore {
  #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  /** 모든 쪽지 (지운 것 포함), 받은 시각 최근 것이 앞 */
  all(): MailRow[] {
    return (this.#db.prepare('select * from mail order by at desc, id desc').all() as Row[]).map(toRow);
  }

  get(id: string): MailRow | undefined {
    const r = this.#db.prepare('select * from mail where id = ?').get(id) as Row | undefined;
    return r ? toRow(r) : undefined;
  }

  /** 넣는다. 이미 있으면 내용만 바꾸고 읽음, 보관, 지움, 고정은 그대로 둔다 */
  put(m: MailPut): void {
    this.#db
      .prepare(
        `insert into mail (id, source, kind, day, at, look, milestone, coins, payload, read_at, coins_paid)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         on conflict(id) do update set source = excluded.source, kind = excluded.kind, day = excluded.day,
           at = excluded.at, look = excluded.look, milestone = excluded.milestone, coins = excluded.coins,
           payload = excluded.payload`,
      )
      .run(
        m.id,
        m.source,
        m.kind,
        m.day,
        Math.round(m.at),
        m.look,
        m.milestone,
        m.coins,
        JSON.stringify(m.payload ?? null),
        m.readAt ?? null,
        m.coinsPaidAt ?? null,
      );
  }

  /** 특별한 편지의 코인을 줬다고 적는다 (처음 한 번만. 이미 줬으면 false) */
  markCoinsPaid(id: string, at: number): boolean {
    return (
      Number(
        this.#db.prepare('update mail set coins_paid = ? where id = ? and coins_paid is null').run(at, id)
          .changes,
      ) > 0
    );
  }

  #set(col: 'read_at' | 'archived_at' | 'deleted_at' | 'pinned_at', id: string, at: number | null): boolean {
    return Number(this.#db.prepare(`update mail set ${col} = ? where id = ?`).run(at, id).changes) > 0;
  }

  /** at 가 null 이면 안 읽음으로 */
  setRead(id: string, at: number | null): boolean {
    return this.#set('read_at', id, at);
  }

  setArchived(id: string, at: number | null): boolean {
    return this.#set('archived_at', id, at);
  }

  /** 휴지통으로 (at) 또는 되살리기 (null) */
  setDeleted(id: string, at: number | null): boolean {
    return this.#set('deleted_at', id, at);
  }

  setPinned(id: string, at: number | null): boolean {
    return this.#set('pinned_at', id, at);
  }

  /** 영구 삭제 (개발용, 정리) */
  remove(id: string): boolean {
    return Number(this.#db.prepare('delete from mail where id = ?').run(id).changes) > 0;
  }

  /** 고른 쪽지들을 한꺼번에 읽음으로 (이미 읽은 것은 그대로) */
  readAll(ids: readonly string[], at: number): number {
    let n = 0;
    const stmt = this.#db.prepare('update mail set read_at = ? where id = ? and read_at is null');
    for (const id of ids) n += Number(stmt.run(at, id).changes);
    return n;
  }

  /**
   * 정리: 휴지통에 MAIL_TRASH_DAYS 일 넘게 있던 것은 영구 삭제하고, 이 컴퓨터에서 만든 쪽지가 MAIL_LOCAL_MAX 를 넘으면
   * 가장 오래된 읽은 것(고정, 보관 아님)부터 휴지통으로 보낸다. 지운 개수를 돌려준다
   */
  tidy(now: number): { purged: number; trashed: number } {
    const limit = now - MAIL_TRASH_DAYS * DAY_MS;
    // 서버 쪽지는 글만 비우고 줄은 남긴다(묘비): 지우면 다음 받기 때 안 읽은 새 쪽지로 되돌아온다. 서버가 목록에서 뺄 때 줄을 지운다
    const purged =
      Number(
        this.#db
          .prepare("delete from mail where deleted_at is not null and deleted_at < ? and source <> 'server'")
          .run(limit).changes,
      ) +
      Number(
        this.#db
          .prepare(
            "update mail set payload = 'null' where source = 'server' and deleted_at is not null and deleted_at < ? and payload <> 'null'",
          )
          .run(limit).changes,
      );
    const over = Number(
      (
        this.#db
          .prepare("select count(*) as n from mail where source = 'local' and deleted_at is null")
          .get() as { n: number }
      ).n,
    );
    let trashed = 0;
    if (over > MAIL_LOCAL_MAX) {
      const old = this.#db
        .prepare(
          `select id from mail where source = 'local' and deleted_at is null and read_at is not null
             and pinned_at is null and archived_at is null order by at asc limit ?`,
        )
        .all(over - MAIL_LOCAL_MAX) as { id: string }[];
      for (const r of old) if (this.setDeleted(r.id, now)) trashed++;
    }
    return { purged, trashed };
  }

  /** 서버 쪽지는 서버 목록에 없어진 것(1년 정리)을 이 컴퓨터에서도 비운다: 받은 쪽 가운데 ids 에 없는 것 중 이 번호보다 새로운 것만 */
  dropServerNotIn(ids: ReadonlySet<string>, newerThanAt: number): number {
    const rows = this.#db
      .prepare("select id from mail where source = 'server' and at >= ?")
      .all(newerThanAt) as { id: string }[];
    let n = 0;
    for (const r of rows)
      if (!ids.has(r.id)) n += Number(this.#db.prepare('delete from mail where id = ?').run(r.id).changes);
    return n;
  }

  /** 모든 서버 쪽지 줄을 지운다 (서버 모드를 껐거나 계정이 바뀜). 지운 개수 */
  dropServer(): number {
    return Number(this.#db.prepare("delete from mail where source = 'server'").run().changes);
  }

  meta(key: string): string | undefined {
    const r = this.#db.prepare('select value from mail_meta where key = ?').get(key) as
      | { value: string }
      | undefined;
    return r?.value;
  }

  setMeta(key: string, value: string): void {
    this.#db
      .prepare(
        'insert into mail_meta (key, value) values (?, ?) on conflict(key) do update set value = excluded.value',
      )
      .run(key, value);
  }

  /** 특별한 편지를 준 날 수들 (지운 편지도 다시 주지 않게 따로 둔다) */
  marks(): number[] {
    try {
      const v = JSON.parse(this.meta('marks') ?? '[]');
      return Array.isArray(v) ? v.filter((x): x is number => Number.isInteger(x) && x > 0) : [];
    } catch {
      return [];
    }
  }

  setMarks(marks: readonly number[]): void {
    this.setMeta('marks', JSON.stringify([...new Set(marks)].slice(-64)));
  }
}
