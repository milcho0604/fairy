// 구글 캘린더에 쓰기: 한 차례 보내기. 일렉트론 없이 돈다 (시험에서 API 를 흉내 낸다).
// 보낼 것은 저장 파일에서 고르고(GcalStore.pending), 일정마다 다시 하기 간격(GcalBackoff)을 지킨다.
import { type GcalBackoff, type GcalProblem, isGoogleId } from '../shared/gcal.ts';
import type { GcalOp, GcalStore } from '../shared/gcal-store.ts';
import type { ApiResult } from './gcal-auth.ts';

/** 연결이 끝났다 (invalid_grant). 보내기를 멈춘다 */
export class GcalLost extends Error {}

export type GcalApi = (
  method: 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
) => Promise<ApiResult>;

type Outcome = 'ok' | 'again' | 'retry' | 'offline' | 'bad' | 'calendar' | 'scope';

const outcomeOf = (kind: ApiResult['kind']): Outcome =>
  kind === 'retry' || kind === 'auth'
    ? 'retry'
    : kind === 'forbidden' || kind === 'notFound'
      ? 'calendar'
      : kind === 'scope'
        ? 'scope'
        : 'bad';

export const eventsPath = (calendarId: string, eventId?: string): string =>
  `/calendars/${encodeURIComponent(calendarId)}/events${eventId ? `/${encodeURIComponent(eventId)}` : ''}`;

function uidOf(json: unknown): string | null {
  const v = (json as { iCalUID?: unknown } | undefined)?.iCalUID;
  return typeof v === 'string' && v.length > 0 && v.length <= 512 ? v : null;
}

/**
 * 일정 하나 보내기.
 * - 넣기: id 를 미리 정해 적고 넣는다. 409(이미 있음: 지난번 대답을 못 받음)면 고치기로
 * - 고치기: 404/410(구글에서 지움, 다른 계정)이면 id 를 버리고 다음 차례에 새로 넣는다
 * - 지우기: 이미 없어도 지운 것으로
 */
export async function applyOp(
  op: GcalOp,
  d: { store: GcalStore; api: GcalApi; newId: () => string },
): Promise<Outcome> {
  if (op.kind === 'delete') {
    const r = await d.api('DELETE', eventsPath(op.calendarId, op.googleId));
    // 지금 고르지 않은 옛 캘린더를 못 쓰면(읽기 전용) 그 일정 때문에 나머지 보내기를 멈추지 않는다
    if (r.kind === 'ok' || r.kind === 'notFound' || (op.stale && r.kind === 'forbidden')) {
      d.store.markDeleted(op.eventId);
      return 'ok';
    }
    return outcomeOf(r.kind);
  }
  // 보낼 캘린더를 바꿨으면 구글의 일정을 새 캘린더로 옮긴다 (events.move). 옛 캘린더를 못 쓰면 새로 넣는다
  if (op.moveTo && op.googleId) {
    const r = await d.api(
      'POST',
      `${eventsPath(op.calendarId, op.googleId)}/move?destination=${encodeURIComponent(op.moveTo)}`,
    );
    if (r.kind === 'ok') {
      d.store.setCalendar(op.eventId, op.moveTo);
      op = { ...op, calendarId: op.moveTo, moveTo: undefined };
    } else if (r.kind === 'notFound' || r.kind === 'forbidden') {
      d.store.forget(op.eventId);
      return 'again';
    } else return outcomeOf(r.kind);
  }
  const id = op.googleId && isGoogleId(op.googleId) ? op.googleId : d.newId();
  const fresh = !op.confirmed || id !== op.googleId;
  // 넣기 전에 id 와 캘린더를 적어 둔다 (대답을 못 받고 꺼져도 다음에 같은 id 로 보내 겹치지 않는다)
  if (fresh) {
    d.store.assignId(op.eventId, id, op.calendarId);
    const r = await d.api('POST', eventsPath(op.calendarId), { ...op.body, id });
    if (r.kind === 'ok') {
      d.store.markSent(op.eventId, op.hash, uidOf(r.json));
      return 'ok';
    }
    if (r.kind !== 'conflict') return outcomeOf(r.kind);
  }
  const r = await d.api('PATCH', eventsPath(op.calendarId, id), op.body);
  if (r.kind === 'ok') {
    d.store.markSent(op.eventId, op.hash, uidOf(r.json));
    return 'ok';
  }
  if (r.kind === 'notFound') {
    d.store.forget(op.eventId);
    return 'again';
  }
  return outcomeOf(r.kind);
}

export interface PassResult {
  /** 아직 못 보낸 수 */
  pending: number;
  sent: number;
  /** 다시 하기 간격을 기다리는 수 */
  waiting: number;
  /** 멈춘 까닭 (다음 차례에 다시) */
  stop: GcalProblem | 'scope' | null;
  /** 바로 한 차례 더 (버린 id 로 새로 넣기) */
  again: boolean;
}

/**
 * 한 차례. 인터넷이 끊기거나 구글이 바쁘거나 캘린더를 못 쓰면 거기서 멈춘다 (남은 것도 똑같이 실패할 테니).
 * 구글이 받지 않는 일정 하나(400)는 길게 미루고 다음 것으로 간다. GcalLost 는 그대로 던진다
 */
export async function syncPass(d: {
  store: GcalStore;
  backoff: GcalBackoff;
  api: GcalApi;
  newId: () => string;
  now: () => number;
  calendarId: string;
  tz: string;
  log?: (tag: string, ...rest: unknown[]) => void;
}): Promise<PassResult> {
  const ops = d.store.pending(d.now(), d.calendarId, d.tz);
  const out: PassResult = { pending: ops.length, sent: 0, waiting: 0, stop: null, again: false };
  for (const op of ops) {
    const key = String(op.eventId);
    const hash = op.kind === 'upsert' ? op.hash : 'delete';
    if (!d.backoff.ready(key, d.now(), hash)) {
      out.waiting++;
      continue;
    }
    let r: Outcome;
    try {
      r = await applyOp(op, d);
    } catch (err) {
      if (err instanceof GcalLost) throw err;
      d.log?.('gcal', '보내기 실패', err instanceof Error ? err.name : 'error');
      r = 'offline';
    }
    if (r === 'ok') {
      d.backoff.ok(key);
      out.sent++;
      out.pending--;
    } else if (r === 'again') {
      out.again = true;
    } else if (r === 'bad') {
      d.backoff.fail(key, d.now(), { bad: true, hash });
      d.log?.('gcal', '구글이 받지 않음', op.kind);
    } else {
      d.backoff.fail(key, d.now(), { hash });
      out.stop = r === 'calendar' ? 'calendar' : r === 'scope' ? 'scope' : 'offline';
      break;
    }
  }
  return out;
}
