// 구글 캘린더 읽어 오기 (이슈 #54): 한 차례. 일렉트론 없이 돈다 (시험에서 API 를 흉내 낸다).
// 고른 캘린더마다 범위(지난 7일 ~ 앞으로 60일)를 쪽마다 다 읽은 뒤 저장 파일과 맞춘다. 다 못 읽은 캘린더는 그 캘린더 것을 바꾸지 않는다.
// 캘린더 목록(구글 캘린더 옵션 창)도 여기서 읽는다.
import type { EventStore } from '../shared/event-store.ts';
import type { GcalProblem } from '../shared/gcal.ts';
import {
  CALLIST_MAX_PAGES,
  calendarListPath,
  type GcalCalendar,
  parseCalendarList,
} from '../shared/gcal-cals.ts';
import {
  fromGoogle,
  isFromFairy,
  listPath,
  PULL_MAX_PAGES,
  type PulledEvent,
  pullWindow,
} from '../shared/gcal-pull.ts';
import type { ApiResult } from './gcal-auth.ts';
import { GcalLost, reasonOf } from './gcal-sync.ts';

export type GcalGet = (method: 'GET', path: string) => Promise<ApiResult>;

export type PullStop = GcalProblem | 'scope' | 'stale';

export type PullResult =
  | {
      ok: true;
      count: number;
      added: number;
      updated: number;
      removed: number;
      hidden: number;
      /** 다 못 읽은 캘린더 (그 캘린더 일정은 그대로 두었다) */
      failed: { id: string; stop: GcalProblem }[];
    }
  | { ok: false; stop: PullStop };

type CalRead = { ok: true; list: PulledEvent[] } | { ok: false; stop: GcalProblem | 'scope' };

/** 캘린더 하나의 범위를 쪽마다 다 읽는다. 연결이 끝났으면(GcalLost) 그대로 던진다 */
async function readCalendar(
  d: {
    api: GcalGet;
    ours: ReadonlySet<string>;
    untitled: string;
    log?: (tag: string, ...rest: unknown[]) => void;
  },
  calendarId: string,
  w: { from: number; to: number },
): Promise<CalRead> {
  const list: PulledEvent[] = [];
  let page: string | undefined;
  for (let n = 0; ; n++) {
    if (n >= PULL_MAX_PAGES) {
      // 너무 많다: 덜 읽은 채로 맞추면 못 읽은 일정을 지운 것으로 본다. 이번에는 그만둔다
      d.log?.('gcal', '가져오기 쪽이 너무 많음', n);
      return { ok: false, stop: 'failed' };
    }
    let r: ApiResult;
    try {
      r = await d.api('GET', listPath(calendarId, w, page));
    } catch (err) {
      if (err instanceof GcalLost) throw err;
      d.log?.('gcal', '가져오기 실패', err instanceof Error ? err.name : 'error');
      return { ok: false, stop: 'offline' };
    }
    if (r.kind !== 'ok') {
      d.log?.('gcal', '가져오기 안 됨', r.status, reasonOf(r.json));
      return { ok: false, stop: stopOf(r) };
    }
    const json = r.json as { items?: unknown; nextPageToken?: unknown } | undefined;
    if (!json || (json.items !== undefined && !Array.isArray(json.items)))
      return { ok: false, stop: 'failed' };
    for (const item of (json.items as unknown[] | undefined) ?? []) {
      if (isFromFairy(item, d.ours)) continue;
      const e = fromGoogle(item, d.untitled);
      if (e) list.push(e);
    }
    page = typeof json.nextPageToken === 'string' && json.nextPageToken ? json.nextPageToken : undefined;
    if (!page) return { ok: true, list };
  }
}

const stopOf = (r: ApiResult): GcalProblem | 'scope' =>
  r.kind === 'scope'
    ? 'scope'
    : r.kind === 'notFound' || r.kind === 'forbidden'
      ? 'calendar'
      : r.kind === 'retry' || r.kind === 'auth'
        ? 'offline'
        : 'failed';

/**
 * 고른 캘린더들을 읽어 와 맞춘다. 캘린더마다 따로: 다 못 읽은 캘린더는 그 캘린더 것만 그대로 두고, 다 실패하면 실패.
 * 같은 일정이 두 캘린더에 있으면(같은 iCalUID) 앞 캘린더 것 하나만 둔다 (못 읽은 캘린더에 이미 있는 것도 앞 것으로 친다)
 */
export async function pullPass(d: {
  events: EventStore;
  api: GcalGet;
  /** 가져올 캘린더들 (앞 것이 먼저). 예전 판처럼 calendarId 하나만 줘도 된다 */
  calendars?: readonly string[];
  calendarId?: string;
  now: () => number;
  /** 페어리가 구글로 보낸 일정의 iCalUID 들 (GcalStore.sentUids). 되돌아온 것은 넣지 않는다 */
  ours: ReadonlySet<string>;
  /** 제목 없는 일정의 이름 */
  untitled: string;
  /** 다 읽은 뒤 맞추기 전에 묻는다: 그새 끄거나 캘린더를 바꿨으면 false (그때는 stale 로 아무것도 바꾸지 않는다) */
  current?: () => boolean;
  log?: (tag: string, ...rest: unknown[]) => void;
}): Promise<PullResult> {
  const now = d.now();
  const w = pullWindow(now);
  const cals = d.calendars ?? (d.calendarId ? [d.calendarId] : []);
  const reads: { id: string; r: CalRead }[] = [];
  for (const id of cals) {
    const r = await readCalendar(d, id, w);
    // 일정 권한이 빠졌다: 어느 캘린더도 못 읽는다
    if (!r.ok && r.stop === 'scope') return { ok: false, stop: 'scope' };
    reads.push({ id, r });
  }
  const failed = reads.flatMap((x) => (x.r.ok ? [] : [{ id: x.id, stop: x.r.stop as GcalProblem }]));
  if (cals.length > 0 && failed.length === cals.length)
    return { ok: false, stop: failed[0]?.stop ?? 'failed' };
  if (d.current && !d.current()) return { ok: false, stop: 'stale' };
  // 같은 iCalUID 는 앞 캘린더 것만. 못 읽은 캘린더에 남아 있는 것도 차지한 것으로 본다
  const taken = new Set<string>();
  const result = { count: 0, added: 0, updated: 0, removed: 0 };
  const all: string[] = [];
  // 고른 캘린더에서 빠진 캘린더 것은 걷는다 (calendars 를 준 때만. 다시 넣으면 되살아난다)
  if (d.calendars) result.removed += d.events.dropGoogleCals(cals, now);
  for (const x of reads) {
    if (!x.r.ok) {
      for (const u of d.events.googleUids(x.id)) taken.add(u);
      continue;
    }
    const list = x.r.list.filter((e) => !e.icalUid || !taken.has(e.icalUid));
    for (const e of list) if (e.icalUid) taken.add(e.icalUid);
    const r = d.events.syncExternal('google', list, w.from, w.to, now, { calendar: x.id });
    result.count += list.length;
    result.added += r.added;
    result.updated += r.updated;
    result.removed += r.removed;
    all.push(...list.map((e) => e.icalUid).filter((v): v is string => !!v));
  }
  // 같은 일정이 캘린더 가져오기(.ics)로도 들어와 있으면 걷어 낸다 (둘씩 보이지 않게)
  const hidden = d.events.hideIcsDupes(new Set(all), now);
  return { ok: true, ...result, hidden, failed };
}

/** 캘린더 목록 (구글 캘린더 옵션 창). 예전 연결이라 목록 권한이 없으면 scope */
export type CalendarListResult =
  | { ok: true; calendars: GcalCalendar[] }
  | { ok: false; stop: 'scope' | 'offline' | 'failed' };

export async function listCalendars(d: {
  api: GcalGet;
  log?: (tag: string, ...rest: unknown[]) => void;
}): Promise<CalendarListResult> {
  const items: unknown[] = [];
  let page: string | undefined;
  for (let n = 0; n < CALLIST_MAX_PAGES; n++) {
    let r: ApiResult;
    try {
      r = await d.api('GET', calendarListPath(page));
    } catch (err) {
      if (err instanceof GcalLost) throw err;
      d.log?.('gcal', '캘린더 목록 실패', err instanceof Error ? err.name : 'error');
      return { ok: false, stop: 'offline' };
    }
    if (r.kind !== 'ok') {
      d.log?.('gcal', '캘린더 목록 안 됨', r.status, reasonOf(r.json));
      return {
        ok: false,
        stop: r.kind === 'scope' ? 'scope' : r.kind === 'retry' || r.kind === 'auth' ? 'offline' : 'failed',
      };
    }
    const json = r.json as { items?: unknown; nextPageToken?: unknown } | undefined;
    if (!json || (json.items !== undefined && !Array.isArray(json.items)))
      return { ok: false, stop: 'failed' };
    items.push(...((json.items as unknown[] | undefined) ?? []));
    page = typeof json.nextPageToken === 'string' && json.nextPageToken ? json.nextPageToken : undefined;
    if (!page) break;
  }
  return { ok: true, calendars: parseCalendarList(items) };
}
