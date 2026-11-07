// 할 일 전용 "페어리 할 일" 캘린더 (docs/gcal-todo-plan.md 3절, 4절, 9절): 찾기, 만들기, 정본 고르기, 지우기, 계정 지문.
// 일렉트론 없이 돈다 (시험에서 API 를 흉내 낸다). 설정 저장과 상태 알림은 main/gcal.ts 가 한다.
import { createHash } from 'node:crypto';
import { cleanCalendarId, type GcalFairyState } from '../shared/gcal.ts';
import { canonicalFairy, extraFairy, FAIRY_MARKER, type GcalCalendar } from '../shared/gcal-cals.ts';
import type { GcalTodoPrefs } from '../shared/gcal-prefs.ts';
import type { GcalTodoStore } from '../shared/gcal-todo-store.ts';
import type { ApiResult } from './gcal-auth.ts';
import { listCalendars } from './gcal-pull.ts';
import { eventsPath, GcalLost, reasonOf } from './gcal-sync.ts';

export type AnyApi = (
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
) => Promise<ApiResult>;

type Log = (tag: string, ...rest: unknown[]) => void;

export type CalStop = 'scope' | 'offline' | 'failed';

const stopOf = (r: ApiResult): CalStop =>
  r.kind === 'scope' ? 'scope' : r.kind === 'retry' || r.kind === 'auth' ? 'offline' : 'failed';

export const calendarPath = (id: string): string => `/calendars/${encodeURIComponent(id)}`;

// ---- 계정 지문 ----

/** 기본 캘린더 id(구글 계정 메일과 같다)의 sha256. 값 자체는 저장하지 않는다 */
export const accountFingerprint = (primaryId: string): string =>
  createHash('sha256').update(primaryId.trim().toLowerCase(), 'utf8').digest('hex');

// ---- 목록을 읽을 때마다 정하는 것 ----

export interface ListEffects {
  /** 저장할 지문. 기본 캘린더를 못 찾았으면 지금 것 그대로 */
  account: string | null;
  /** 이전 지문이 있었고 달라졌다: 다른 계정으로 다시 연결했다 (올릴 캘린더와 보낸 기록을 비운다) */
  accountChanged: boolean;
  canonical: string | null;
  extras: string[];
  /** 올릴 곳이 페어리 캘린더인데 정본이 바뀌었다: 이 id 로 바꾸면 이미 올린 할 일을 events.move 가 옮긴다 */
  moveTo: string | null;
  /** 쓰던 페어리 캘린더가 목록에 없다 (구글에서 지움) */
  gone: boolean;
}

export function listEffects(o: {
  calendars: readonly GcalCalendar[];
  primaryId: string | null;
  account: string | null;
  todos: GcalTodoPrefs;
}): ListEffects {
  const fp = o.primaryId ? accountFingerprint(o.primaryId) : o.account;
  const accountChanged = !!o.account && !!fp && fp !== o.account;
  const canonical = canonicalFairy(o.calendars);
  const extras = extraFairy(o.calendars);
  // 다른 계정이면 올릴 캘린더는 이미 비워진 것으로 본다
  const current = accountChanged ? null : o.todos.calendarId;
  const fairy = o.todos.target === 'fairy' && !!current;
  return {
    account: fp,
    accountChanged,
    canonical,
    extras,
    moveTo: fairy && canonical && canonical !== current ? canonical : null,
    gone: fairy && !canonical,
  };
}

/** 창에 보일 페어리 캘린더 상태 */
export function fairyState(o: {
  calendars: readonly GcalCalendar[] | null;
  todos: GcalTodoPrefs;
  /** 쓰던 페어리 캘린더가 없어진 것을 이번 실행 중에 알아챘다 (꺼 둔 채여도 "다시 만들기"를 보인다) */
  lost?: boolean;
}): GcalFairyState {
  if (o.todos.target === 'fairy') {
    if (!o.todos.calendarId) return o.todos.on || o.lost ? 'gone' : 'none';
    return o.calendars && !canonicalFairy(o.calendars) ? 'gone' : 'ready';
  }
  if (!o.calendars) return 'unknown';
  return canonicalFairy(o.calendars) ? 'ready' : 'none';
}

// ---- 만들기 ----

const NAMES = { ko: '페어리 할 일', en: 'fairy to-dos' } as const;
const NOTES = {
  ko: '페어리가 만든 할 일 캘린더예요. 이 캘린더를 지우면 올라간 할 일도 사라져요.',
  en: 'A to-do calendar made by fairy. Deleting this calendar also removes the to-dos in it.',
} as const;

/** calendars.insert 에 보낼 몸. 설명 첫 줄이 표식이다 */
export function fairyCalendarBody(lang: 'ko' | 'en', tz: string) {
  return { summary: NAMES[lang], description: `${FAIRY_MARKER}\n${NOTES[lang]}`, timeZone: tz };
}

export type EnsureResult =
  | { ok: true; calendarId: string; calendars: GcalCalendar[]; primaryId: string | null; created: boolean }
  /** where: 목록 읽기(list) 때문인지 만들기(create) 때문인지. needApp: 없는데 만들 권한이 아직 없다 */
  | { ok: false; stop: CalStop | 'needApp'; where: 'list' | 'create' };

/**
 * 페어리 할 일 캘린더를 찾고, 없을 때만 만든다. 만든 직후 목록을 다시 읽어 id 가 더 작은 표식 캘린더가 있으면
 * (다른 컴퓨터가 동시에 만들었다) 방금 만든 것을 지우고 그쪽을 쓴다. 할 일은 이 함수가 끝난 뒤에야 올라간다.
 * 만들었는데 다시 읽지 못하면 실패로 끝낸다: 만든 캘린더는 남고 다음에 "있는 것"으로 찾는다
 */
export async function ensureFairyCalendar(d: {
  api: AnyApi;
  lang: 'ko' | 'en';
  tz: string;
  /** 새 캘린더를 만들어도 되는가 (새 권한을 받았다). 아니면 있는 것만 찾는다 */
  canCreate: boolean;
  log?: Log;
}): Promise<EnsureResult> {
  const first = await listCalendars({ api: d.api, log: d.log });
  if (!first.ok) return { ok: false, stop: first.stop, where: 'list' };
  const found = canonicalFairy(first.calendars);
  if (found)
    return {
      ok: true,
      calendarId: found,
      calendars: first.calendars,
      primaryId: first.primaryId,
      created: false,
    };

  if (!d.canCreate) return { ok: false, stop: 'needApp', where: 'create' };
  let r: ApiResult;
  try {
    r = await d.api('POST', '/calendars', fairyCalendarBody(d.lang, d.tz));
  } catch (err) {
    if (err instanceof GcalLost) throw err;
    d.log?.('gcal', '할 일 캘린더 만들기 실패', err instanceof Error ? err.name : 'error');
    return { ok: false, stop: 'offline', where: 'create' };
  }
  const madeId = r.kind === 'ok' ? cleanCalendarId((r.json as { id?: unknown } | undefined)?.id) : undefined;
  if (!madeId) {
    d.log?.('gcal', '할 일 캘린더 만들기 안 됨', r.status, reasonOf(r.json));
    return { ok: false, stop: r.kind === 'ok' ? 'failed' : stopOf(r), where: 'create' };
  }

  const again = await listCalendars({ api: d.api, log: d.log });
  if (!again.ok) return { ok: false, stop: again.stop, where: 'list' };
  const ids = new Set([madeId, ...again.calendars.filter((c) => c.fairy).map((c) => c.id)]);
  const canonical = [...ids].sort()[0] ?? madeId;
  let calendars = again.calendars;
  if (canonical !== madeId) {
    // 더 작은 id 의 캘린더가 이미 있다: 방금 만든 것은 지운다
    try {
      const del = await d.api('DELETE', calendarPath(madeId));
      if (del.kind === 'ok' || del.kind === 'notFound') calendars = calendars.filter((c) => c.id !== madeId);
      else d.log?.('gcal', '겹쳐 만든 캘린더 지우기 안 됨', del.status);
    } catch (err) {
      if (err instanceof GcalLost) throw err;
      d.log?.('gcal', '겹쳐 만든 캘린더 지우기 실패', err instanceof Error ? err.name : 'error');
    }
  }
  return {
    ok: true,
    calendarId: canonical,
    calendars,
    primaryId: again.primaryId,
    created: canonical === madeId,
  };
}

// ---- 지우기 ----

/** 캘린더 하나 지우기. 이미 없어도 지운 것으로 */
export async function deleteCalendar(
  api: AnyApi,
  id: string,
  log?: Log,
): Promise<{ ok: true } | { ok: false; stop: CalStop }> {
  try {
    const r = await api('DELETE', calendarPath(id));
    if (r.kind === 'ok' || r.kind === 'notFound') return { ok: true };
    log?.('gcal', '캘린더 지우기 안 됨', r.status, reasonOf(r.json));
    return { ok: false, stop: stopOf(r) };
  } catch (err) {
    if (err instanceof GcalLost) throw err;
    log?.('gcal', '캘린더 지우기 실패', err instanceof Error ? err.name : 'error');
    return { ok: false, stop: 'offline' };
  }
}

/** 정본 말고 남은 표식 캘린더를 지운다. 하나라도 못 지우면 거기서 멈춘다 */
export async function removeExtraFairy(d: {
  api: AnyApi;
  calendars: readonly GcalCalendar[];
  log?: Log;
}): Promise<{ deleted: string[]; stop: CalStop | null }> {
  const deleted: string[] = [];
  for (const id of extraFairy(d.calendars)) {
    const r = await deleteCalendar(d.api, id, d.log);
    if (!r.ok) return { deleted, stop: r.stop };
    deleted.push(id);
  }
  return { deleted, stop: null };
}

/** 이 캘린더가 구글에 없는가 (calendarList.get 이 404). 판단할 수 없으면 false */
export async function calendarGone(api: AnyApi, id: string): Promise<boolean> {
  try {
    const r = await api('GET', `/users/me/calendarList/${encodeURIComponent(id)}?fields=id`);
    return r.kind === 'notFound';
  } catch (err) {
    if (err instanceof GcalLost) throw err;
    return false;
  }
}

// ---- 올린 할 일 지우기 (기존 캘린더) ----

/**
 * 올려 둔 할 일을 구글에서 지운다. 먼저 무덤으로 옮기고 올린 기록을 비운 뒤(그래서 도중에 멈춰도 남은 것은 무덤에 있다)
 * 무덤 줄을 하나씩 지운다. fallbackCal 은 올린 캘린더를 모르는 줄에 쓴다.
 * 인터넷이 안 되거나 권한이 없으면 멈추고 남은 수를 돌려준다
 */
export async function removeSentTodos(d: {
  store: GcalTodoStore;
  api: AnyApi;
  fallbackCal: string;
  now: () => number;
  log?: Log;
}): Promise<{ removed: number; left: number; stop: CalStop | null }> {
  d.store.tombSent(d.now());
  let removed = 0;
  let stop: CalStop | null = null;
  const skipped = new Set<number>();
  for (let round = 0; round < 50 && !stop; round++) {
    const rows = d.store.tombTodos(200).filter((x) => !skipped.has(x.rowid));
    if (rows.length === 0) break;
    for (const x of rows) {
      let r: ApiResult;
      try {
        r = await d.api('DELETE', eventsPath(x.calendarId || d.fallbackCal, x.googleId));
      } catch (err) {
        if (err instanceof GcalLost) throw err;
        stop = 'offline';
        break;
      }
      if (r.kind === 'ok' || r.kind === 'notFound') {
        d.store.markDeleted(-x.rowid);
        removed++;
      } else if (r.kind === 'forbidden') {
        // 그 캘린더에 쓸 수 없다: 이 줄은 건너뛴다 (남은 줄까지 막지 않는다)
        skipped.add(x.rowid);
      } else {
        stop = stopOf(r);
        break;
      }
    }
  }
  return { removed, left: d.store.tombTodos(1000).length, stop };
}
