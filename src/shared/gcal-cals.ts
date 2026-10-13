// 구글 캘린더 옵션 창: 내 구글 캘린더 목록(calendarList.list)과 캘린더마다 "가져오기", "보내기" 고르기.
// 여기는 순수한 것만 (설정 창, 메인, 시험이 같이 쓴다). 네트워크는 main/gcal-pull.ts listCalendars.
import { cleanCalendarId, GCAL_PRIMARY } from './gcal.ts';

/** 캘린더에 대한 내 권한 (calendarList accessRole). freeBusyReader 는 일정 제목을 못 봐서 목록에서 뺀다 */
export type GcalRole = 'owner' | 'writer' | 'reader';

export interface GcalCalendar {
  /** 캘린더 id. 기본 캘린더는 늘 primary (예전 설정, 보낸 기록과 같은 이름이라 옮기기가 생기지 않는다) */
  id: string;
  /** 보일 이름 (내가 바꾼 이름 먼저) */
  name: string;
  /** 구글에서 고른 색 (#rrggbb). 없으면 null */
  color: string | null;
  role: GcalRole;
  primary: boolean;
  /** 구글 캘린더 목록에서 숨긴 캘린더 */
  hidden?: boolean;
}

/** 받을 칸만: id, 이름, 색, 권한, 기본, 표시 여부 */
export const CALLIST_FIELDS =
  'items(id,summary,summaryOverride,backgroundColor,accessRole,primary,selected,hidden),nextPageToken';
/** 목록 쪽 상한 (한 쪽 250개) */
export const CALLIST_MAX_PAGES = 4;
/** 한 번에 가져올 수 있는 캘린더 수 (15분마다 캘린더마다 부른다) */
export const PULL_CALS_MAX = 25;

/** calendarList.list 경로. 제목을 읽을 수 있는 것(reader 이상)만 */
export function calendarListPath(pageToken?: string): string {
  const q = new URLSearchParams({ minAccessRole: 'reader', maxResults: '250', fields: CALLIST_FIELDS });
  if (pageToken) q.set('pageToken', pageToken);
  return `/users/me/calendarList?${q.toString()}`;
}

const ROLES: readonly GcalRole[] = ['owner', 'writer', 'reader'];
const COLOR = /^#[0-9a-fA-F]{6}$/;

/** 목록 대답의 items → 캘린더들. 이상한 id, 모르는 권한은 뺀다. 순서: 기본 캘린더, 내 것, 공유, 읽기만 (같으면 구글 순서) */
export function parseCalendarList(items: readonly unknown[]): GcalCalendar[] {
  const out: GcalCalendar[] = [];
  const seen = new Set<string>();
  for (const raw of items) {
    const v = raw as {
      id?: unknown;
      summary?: unknown;
      summaryOverride?: unknown;
      backgroundColor?: unknown;
      accessRole?: unknown;
      primary?: unknown;
      hidden?: unknown;
    } | null;
    if (!v || typeof v.id !== 'string') continue;
    const role = ROLES.find((r) => r === v.accessRole);
    if (!role) continue;
    const primary = v.primary === true;
    const id = primary ? GCAL_PRIMARY : cleanCalendarId(v.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const nameOf = (x: unknown) => (typeof x === 'string' && x.trim() ? x.trim().slice(0, 100) : undefined);
    out.push({
      id,
      name: nameOf(v.summaryOverride) ?? nameOf(v.summary) ?? v.id.slice(0, 100),
      color:
        typeof v.backgroundColor === 'string' && COLOR.test(v.backgroundColor) ? v.backgroundColor : null,
      role,
      primary,
      ...(v.hidden === true ? { hidden: true } : {}),
    });
  }
  const rank = (c: GcalCalendar) => (c.primary ? 0 : c.role === 'owner' ? 1 : c.role === 'writer' ? 2 : 3);
  return out
    .map((c, i) => ({ c, i }))
    .sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i)
    .map((x) => x.c);
}

/** 설정 파일에 둔 목록 다시 읽기 (깨진 것은 뺀다) */
export function cleanCalendars(raw: unknown): GcalCalendar[] | null {
  if (!Array.isArray(raw)) return null;
  const out: GcalCalendar[] = [];
  for (const v of raw as Partial<GcalCalendar>[]) {
    const id = cleanCalendarId(v?.id);
    const role = ROLES.find((r) => r === v?.role);
    if (!id || !role || typeof v.name !== 'string') continue;
    out.push({
      id,
      name: v.name.slice(0, 100),
      color: typeof v.color === 'string' && COLOR.test(v.color) ? v.color : null,
      role,
      primary: v.primary === true,
      ...(v.hidden === true ? { hidden: true } : {}),
    });
  }
  return out;
}

/** 옵션 창의 표시: 내 캘린더, 공유됨(쓰기 가능), 읽기만 */
export type CalKind = 'mine' | 'shared' | 'readOnly';
export const calKind = (c: { role: GcalRole }): CalKind =>
  c.role === 'owner' ? 'mine' : c.role === 'writer' ? 'shared' : 'readOnly';

/** 페어리 일정을 보낼 수 있는지. 목록에 없는(직접 넣은) 캘린더는 모르니 막지 않는다 */
export const canPush = (c: { role: GcalRole } | undefined): boolean => c?.role !== 'reader';

/** 고른 것: 가져올 캘린더들, 보낼 캘린더 (null 이면 보내지 않기) */
export interface CalChoice {
  pull: string[];
  push: string | null;
}

/** 처음 연결했을 때: 기본 캘린더만 가져오고 기본 캘린더로 보낸다 */
export const DEFAULT_CHOICE: Readonly<CalChoice> = Object.freeze({
  pull: [GCAL_PRIMARY],
  push: GCAL_PRIMARY,
});

/**
 * 창에서 온 고른 것 다듬기. 틀린 id 는 빼고, 겹치면 하나로, 많으면 앞에서 PULL_CALS_MAX 개.
 * 읽기만 캘린더나 틀린 id 로 보내기면 통째로 거절(undefined)
 */
export function cleanChoice(raw: unknown, known: readonly GcalCalendar[] | null): CalChoice | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const v = raw as { pull?: unknown; push?: unknown };
  if (!Array.isArray(v.pull)) return undefined;
  const pull: string[] = [];
  for (const x of v.pull) {
    const id = typeof x === 'string' && x.length <= 300 ? cleanCalendarId(x) : undefined;
    if (id && !pull.includes(id)) pull.push(id);
    if (pull.length >= PULL_CALS_MAX) break;
  }
  if (v.push === null) return { pull, push: null };
  const push = typeof v.push === 'string' && v.push.length <= 300 ? cleanCalendarId(v.push) : undefined;
  if (!push) return undefined;
  if (!canPush(known?.find((c) => c.id === push))) return undefined;
  return { pull, push };
}

export interface CalRow {
  id: string;
  name: string;
  color: string | null;
  /** 목록에서 온 것이 아니면(직접 넣은 것, 예전 연결) undefined */
  kind?: CalKind;
  primary: boolean;
  pull: boolean;
  push: boolean;
  canPush: boolean;
}

/**
 * 옵션 창의 줄들: 구글 목록 + 목록에 없는 직접 넣은 캘린더(가져오기나 보내기에 든 것).
 * 목록이 없으면(예전 연결, 아직 못 읽음) 기본 캘린더와 직접 넣은 것만
 */
export function calendarRows(o: {
  calendars: readonly GcalCalendar[] | null;
  pull: readonly string[];
  push: string | null;
}): CalRow[] {
  const rows: CalRow[] = [];
  const row = (c: Partial<GcalCalendar> & { id: string }, listed?: GcalCalendar): CalRow => ({
    id: c.id,
    name: c.name ?? c.id,
    color: c.color ?? null,
    ...(listed ? { kind: calKind(listed) } : {}),
    primary: c.id === GCAL_PRIMARY,
    pull: o.pull.includes(c.id),
    push: o.push === c.id,
    canPush: canPush(listed),
  });
  for (const c of o.calendars ?? []) rows.push(row(c, c));
  const have = new Set(rows.map((r) => r.id));
  const extra = [...(o.calendars ? [] : [GCAL_PRIMARY]), ...o.pull, ...(o.push ? [o.push] : [])];
  for (const id of extra) {
    if (have.has(id)) continue;
    have.add(id);
    rows.push(row({ id }));
  }
  return rows;
}

/**
 * 옵션 창이 보일 것: off(연결 안 됨), relink(예전 연결이라 목록 권한이 없음: 다시 연결 안내),
 * loading(목록을 읽는 중), ready(목록이 있음)
 */
export function listState(o: {
  connected: boolean;
  listScope: boolean | null;
  calendars: readonly GcalCalendar[] | null;
}): 'off' | 'relink' | 'loading' | 'ready' {
  if (!o.connected) return 'off';
  if (o.listScope === false) return 'relink';
  return o.calendars ? 'ready' : 'loading';
}
