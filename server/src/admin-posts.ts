import type { Pool } from 'pg';
import { type DocNotice, type NoticeDoc } from './notice-doc';
import { kstIso } from './shared/site-events';

// 알리기의 게시물 목록 (이슈 #154): 공지, 이벤트, 쿠폰, 버전 기준을 한 목록(진행 중, 예정, 끝남)으로 합친다.
// 상태 필터와 검색은 주소의 조회 조건(pk 종류, ps 상태, pq 찾는 말)으로 서버가 거른다 (스크립트 없이 된다).
// 계산과 모양만 둔다. 화면은 admin-page.ts 가 그린다.

export const POST_KINDS = ['notice', 'event', 'coupon', 'version'] as const;
export type PostKind = (typeof POST_KINDS)[number];
export const POST_STATES = ['live', 'soon', 'ended'] as const;
export type PostState = (typeof POST_STATES)[number];

export const POST_KIND_KO: Record<PostKind, string> = {
  notice: '공지',
  event: '이벤트',
  coupon: '쿠폰',
  version: '버전 기준',
};
export const POST_STATE_KO: Record<PostState, string> = { live: '진행 중', soon: '예정', ended: '끝남' };

export interface PostFilter {
  kind: PostKind | 'all';
  state: PostState | 'all';
  q: string;
}

/** 한 종류에서 보이는 줄 수 상한 (넘으면 찾기로 좁힌다) */
export const POSTS_PER_KIND = 100;

export interface PostRow {
  kind: PostKind;
  /** 공지와 이벤트는 id, 쿠폰은 번호 */
  id: string;
  title: string;
  /** 제목 아래 작은 글 (영문 제목, 주는 것) */
  sub: string;
  state: PostState;
  /** 상태 옆 덧붙임 (꺼짐, 다 씀, 기준 없음) */
  note: string;
  from: number | null;
  until: number | null;
  /** 눌러서 불러오는 이름 (?load=notice:ID) */
  load: string;
  /** 지금 끝내거나 지우거나 끌 수 있는가 */
  closable: boolean;
}

export interface PostsView {
  filter: PostFilter;
  rows: PostRow[];
  /** 종류별 전체 줄 수 (필터 뒤) 중 보이지 않는 수 */
  hidden: number;
  /** 필터 없이 전체 개수 */
  totals: Record<PostKind, number>;
}

const pick = <T extends string>(v: unknown, all: readonly T[]): T | 'all' =>
  typeof v === 'string' && (all as readonly string[]).includes(v) ? (v as T) : 'all';

/** 주소의 조회 조건을 필터로 */
export function postFilterOf(query: Record<string, unknown>): PostFilter {
  const q = typeof query.pq === 'string' ? query.pq.trim().slice(0, 60) : '';
  return { kind: pick(query.pk, POST_KINDS), state: pick(query.ps, POST_STATES), q };
}

const ORDER: Record<PostState, number> = { live: 0, soon: 1, ended: 2 };

/** 목록 순서: 진행 중(곧 끝나는 것 먼저), 예정(곧 시작하는 것 먼저), 끝남(최근에 끝난 것 먼저) */
export function sortPosts(rows: PostRow[]): PostRow[] {
  return [...rows].sort((a, b) => {
    if (a.state !== b.state) return ORDER[a.state] - ORDER[b.state];
    if (a.state === 'live')
      return (a.until ?? Number.MAX_SAFE_INTEGER) - (b.until ?? Number.MAX_SAFE_INTEGER);
    if (a.state === 'soon') return (a.from ?? 0) - (b.from ?? 0);
    return (b.until ?? 0) - (a.until ?? 0);
  });
}

/** 기간으로 상태 (끝이 없으면 계속 진행) */
export function stateOf(now: number, from: number | null, until: number | null): PostState {
  if (from !== null && now < from) return 'soon';
  if (until !== null && now >= until) return 'ended';
  return 'live';
}

/** LIKE 에서 특별한 글자를 그대로 찾게 */
const likeOf = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

const textMatch = (q: string, ...parts: Array<string | undefined>): boolean => {
  const needle = q.toLowerCase();
  return !needle || parts.some((p) => (p ?? '').toLowerCase().includes(needle));
};

const msOf = (iso: string | undefined): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
};

export function noticeRow(n: DocNotice, now: number): PostRow {
  const from = msOf(n.from);
  const until = msOf(n.until);
  return {
    kind: 'notice',
    id: n.id,
    title: n.title.ko,
    sub: n.title.en,
    state: stateOf(now, from, until),
    note: '',
    from,
    until,
    load: `notice:${n.id}`,
    closable: true,
  };
}

/** 버전 기준 한 줄: 기준이 하나라도 있으면 진행 중, 없으면 끝남(기준 없음) */
export function versionRow(doc: NoticeDoc | undefined): PostRow {
  const parts: string[] = [];
  if (doc?.minVersion) parts.push(`강제 ${doc.minVersion}`);
  if (doc?.restrictVersion) parts.push(`기능 제한 ${doc.restrictVersion}`);
  if (doc?.recommendVersion) parts.push(`권장 ${doc.recommendVersion}`);
  return {
    kind: 'version',
    id: 'levels',
    title: '앱 버전 기준',
    sub: parts.join(', ') || '정한 기준이 없어요',
    state: parts.length > 0 ? 'live' : 'ended',
    note: parts.length > 0 ? '' : '기준 없음',
    from: null,
    until: null,
    load: 'version',
    closable: false,
  };
}

interface EventPostRow {
  id: string;
  title_ko: string;
  title_en: string;
  kind: string;
  coins: number | null;
  boost_times: number | null;
  starts: string;
  ends: string;
  total: string;
}
interface CouponPostRow {
  id: string;
  hint: string;
  label: string;
  coins: number;
  tickets: number;
  max_uses: number;
  used: number;
  disabled: boolean;
  starts: string;
  ends: string;
  total: string;
}

/**
 * 게시물 목록. 이벤트와 쿠폰은 DB 에서 찾는 말과 상태로 거르고(종류마다 100줄까지, 오래된 것도 찾을 수 있다),
 * 공지는 저장된 문서에서 거른다
 */
export async function queryPosts(
  pool: Pool,
  doc: NoticeDoc | undefined,
  filter: PostFilter,
  now = Date.now(),
): Promise<PostsView> {
  const rows: PostRow[] = [];
  const totals: Record<PostKind, number> = { notice: 0, event: 0, coupon: 0, version: 0 };
  let hidden = 0;
  const q = filter.q;
  const like = likeOf(q);
  const want = (k: PostKind) => filter.kind === 'all' || filter.kind === k;
  const stateSql = (starts: string, ends: string, extra = 'false') =>
    `(CASE WHEN ${extra} THEN 'ended' WHEN ${starts} > now() THEN 'soon' WHEN ${ends} > now() THEN 'live' ELSE 'ended' END)`;

  const count = async (table: string): Promise<number> =>
    Number((await pool.query<{ n: string }>(`SELECT count(*) AS n FROM ${table}`)).rows[0]?.n ?? 0);
  totals.event = await count('event');
  totals.coupon = await count('coupon');
  totals.notice = doc?.notices.length ?? 0;
  totals.version = 1;

  if (want('event')) {
    const r = await pool.query<EventPostRow>(
      `SELECT id, title_ko, title_en, kind, coins, boost_times,
              (extract(epoch FROM starts_at) * 1000)::bigint AS starts, (extract(epoch FROM ends_at) * 1000)::bigint AS ends,
              count(*) OVER () AS total
         FROM event
        WHERE ($1 = '' OR id ILIKE $2 OR title_ko ILIKE $2 OR title_en ILIKE $2 OR body_ko ILIKE $2 OR body_en ILIKE $2)
          AND ($3 = 'all' OR ${stateSql('starts_at', 'ends_at')} = $3)
        ORDER BY ends_at DESC, id LIMIT $4`,
      [q, like, filter.state, POSTS_PER_KIND],
    );
    hidden += Math.max(0, Number(r.rows[0]?.total ?? 0) - r.rows.length);
    for (const e of r.rows) {
      const from = Number(e.starts);
      const until = Number(e.ends);
      rows.push({
        kind: 'event',
        id: e.id,
        title: e.title_ko,
        sub: `${e.title_en} (${e.kind === 'gift' ? `선물 ${e.coins} 코인` : `배수 x${e.boost_times}`})`,
        state: stateOf(now, from, until),
        note: '',
        from,
        until,
        load: `event:${e.id}`,
        closable: now < until,
      });
    }
  }
  if (want('coupon')) {
    const r = await pool.query<CouponPostRow>(
      `SELECT id, hint, label, coins, tickets, max_uses, used, disabled_at IS NOT NULL AS disabled,
              (extract(epoch FROM starts_at) * 1000)::bigint AS starts, (extract(epoch FROM ends_at) * 1000)::bigint AS ends,
              count(*) OVER () AS total
         FROM coupon
        WHERE ($1 = '' OR label ILIKE $2 OR id::text = $1 OR hint ILIKE $2)
          AND ($3 = 'all' OR ${stateSql('starts_at', 'ends_at', 'disabled_at IS NOT NULL OR used >= max_uses')} = $3)
        ORDER BY id DESC LIMIT $4`,
      [q, like, filter.state, POSTS_PER_KIND],
    );
    hidden += Math.max(0, Number(r.rows[0]?.total ?? 0) - r.rows.length);
    for (const c of r.rows) {
      const from = Number(c.starts);
      const until = Number(c.ends);
      const spent = c.used >= c.max_uses;
      rows.push({
        kind: 'coupon',
        id: c.id,
        title: c.label,
        sub: `코드 ${c.hint}…, 코인 ${c.coins}, 채팅 이용권 ${c.tickets}장, 사용 ${c.used} / ${c.max_uses}`,
        state: c.disabled || spent ? 'ended' : stateOf(now, from, until),
        note: c.disabled ? '꺼짐' : spent ? '다 씀' : '',
        from,
        until,
        load: `coupon:${c.id}`,
        closable: !c.disabled,
      });
    }
  }
  if (want('notice')) {
    for (const n of doc?.notices ?? []) {
      if (!textMatch(q, n.id, n.title.ko, n.title.en, n.body.ko, n.body.en)) continue;
      const row = noticeRow(n, now);
      if (filter.state === 'all' || row.state === filter.state) rows.push(row);
    }
  }
  if (want('version')) {
    const row = versionRow(doc);
    if (
      (filter.state === 'all' || row.state === filter.state) &&
      textMatch(q, '버전', '기준', '강제', '권장', row.sub)
    )
      rows.push(row);
  }
  return { filter, rows: sortPosts(rows), hidden, totals };
}

/** datetime-local 칸에 넣는 한국 시간 글 (분까지) */
export const kstInput = (ms: number): string => kstIso(ms).slice(0, 16);

/** 새 글 폼의 기본값. 시각은 한국 시간으로 다음 정시부터 */
export function formDefaults(now = Date.now()): {
  day: string;
  start: string;
  weekLater: string;
  monthLater: string;
} {
  const nextHour = Math.ceil((now + 60_000) / 3_600_000) * 3_600_000;
  return {
    day: kstIso(now).slice(0, 10).replaceAll('-', ''),
    start: kstInput(nextHour),
    weekLater: kstInput(nextHour + 7 * 86_400_000),
    monthLater: kstInput(nextHour + 30 * 86_400_000),
  };
}

export interface LoadedForm {
  /** 쓰기 이름 (notices, events, coupons, versions) */
  form: 'notices' | 'events' | 'coupons' | 'versions';
  fields: Record<string, string | string[]>;
  /** 화면에 알리는 글 */
  note: string;
}

/** 공지를 폼 칸으로 (같은 id 로 저장하면 바꾼다) */
export function noticeFields(n: DocNotice): Record<string, string> {
  return {
    id: n.id,
    kind: n.kind,
    title_ko: n.title.ko,
    title_en: n.title.en,
    body_ko: n.body.ko,
    body_en: n.body.en,
    link: n.link ?? '',
    from: n.from ? n.from.slice(0, 16) : '',
    until: n.until ? n.until.slice(0, 16) : '',
    versions: n.versions ?? '',
    platforms: n.platforms?.join(',') ?? '',
  };
}
