// 페어리 서버 API 부르기 (기획서 11절, 서버 PR #106). Electron 없이 돌아 시험에서 fetch 를 바꿔 끼운다.
// 토큰과 코드는 기록에 남기지 않는다. 실패 대답은 { error: '<까닭>' }.
import type { AccountSummary, Items } from '../shared/server-account.ts';
import type { QueueEntry } from './server-coins.ts';

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** 요청 하나에 이만큼 넘으면 그만둔다 */
export const SERVER_TIMEOUT_MS = 20_000;
/** 한 번에 보내는 기록 수 (서버 SYNC_MAX_ENTRIES) */
export const SYNC_BATCH = 500;

/** 대답. status 0 은 서버에 닿지 않음(인터넷, 서버 꺼짐, 시간 넘김) */
export type ApiResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: string; body: Record<string, unknown> };

export type EntryStatus = 'ok' | 'capped' | 'rejected';

export interface SyncResult {
  balance: number;
  items: Items;
  results: { id: string; status: EntryStatus; applied: number; error?: string; duplicate?: boolean }[];
}

export interface MigrateResult {
  balance: number;
  items: Items;
  applied: number;
  status: EntryStatus;
}

export interface SessionResult {
  session: string;
  account: { id: number };
  merged: boolean;
  linked: boolean;
}

/** 409 merge_needed 의 몸: 확인 코드와 두 계정 */
export interface MergeNeeded {
  code: string;
  current: AccountSummary;
  other: AccountSummary;
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

function items(v: unknown): Items {
  const out: Items = {};
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return out;
  for (const [k, n] of Object.entries(v))
    if (typeof n === 'number' && Number.isInteger(n) && n > 0) out[k] = n;
  return out;
}

export const summary = (v: unknown): AccountSummary => {
  const o = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>;
  return { balance: num(o.balance), items: items(o.items) };
};

export function serverApi(base: string, f: FetchLike) {
  async function call<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    o: { token?: string; body?: unknown; read: (json: Record<string, unknown>) => T | undefined },
  ): Promise<ApiResult<T>> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), SERVER_TIMEOUT_MS);
    try {
      const res = await f(`${base}${path}`, {
        method,
        headers: {
          accept: 'application/json',
          ...(o.token ? { authorization: `Bearer ${o.token}` } : {}),
          ...(o.body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(o.body === undefined ? {} : { body: JSON.stringify(o.body) }),
        signal: ac.signal,
      });
      const text = res.status === 204 ? '' : await res.text();
      let json: Record<string, unknown> = {};
      if (text && text.length <= 2_000_000) {
        try {
          const v = JSON.parse(text) as unknown;
          if (typeof v === 'object' && v !== null && !Array.isArray(v)) json = v as Record<string, unknown>;
        } catch {
          // 모르는 대답: 아래에서 server 문제로
        }
      }
      if (res.status < 200 || res.status >= 300) {
        const error = typeof json.error === 'string' ? json.error.slice(0, 64) : `http_${res.status}`;
        return { ok: false, status: res.status, error, body: json };
      }
      const data = o.read(json);
      if (data === undefined) return { ok: false, status: res.status, error: 'bad_reply', body: json };
      return { ok: true, status: res.status, data };
    } catch {
      return { ok: false, status: 0, error: 'offline', body: {} };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    base,
    /** 이름 없는 기기 계정 (나이 구분만 보낸다) */
    device: (age: '14+' | '18+') =>
      call('POST', '/v1/device', {
        body: { age },
        read: (j) => (typeof j.token === 'string' && j.token ? { token: j.token } : undefined),
      }),
    /** 코인 기록 묶음 (최대 500) */
    sync: (token: string, entries: readonly QueueEntry[]) =>
      call<SyncResult>('POST', '/v1/sync', {
        token,
        body: {
          entries: entries.slice(0, SYNC_BATCH).map((e) => ({
            id: e.id,
            reason: e.reason,
            amount: e.amount,
            day: e.day,
            ...(e.ref ? { ref: e.ref } : {}),
          })),
        },
        read: (j) =>
          typeof j.balance === 'number' && Array.isArray(j.results)
            ? {
                balance: j.balance,
                items: items(j.items),
                results: (j.results as unknown[]).flatMap((r) => {
                  const x = (typeof r === 'object' && r !== null ? r : {}) as Record<string, unknown>;
                  if (typeof x.id !== 'string') return [];
                  const status: EntryStatus =
                    x.status === 'ok' || x.status === 'capped' ? x.status : 'rejected';
                  return [
                    {
                      id: x.id,
                      status,
                      applied: num(x.applied),
                      ...(typeof x.error === 'string' ? { error: x.error } : {}),
                      ...(x.duplicate === true ? { duplicate: true } : {}),
                    },
                  ];
                }),
              }
            : undefined,
      }),
    /** 기존 잔액과 산 물건 올리기 (기기 토큰, 한 번) */
    migrate: (token: string, body: { balance: number; items: Items }) =>
      call<MigrateResult>('POST', '/v1/migrate', {
        token,
        body,
        read: (j) =>
          typeof j.balance === 'number'
            ? {
                balance: j.balance,
                items: items(j.items),
                applied: num(j.applied),
                status: j.status === 'capped' ? 'capped' : 'ok',
              }
            : undefined,
      }),
    /** 일회용 코드를 세션으로 (로컬 PKCE verifier 와 함께). merge 는 합치기 확인 뒤 */
    session: (token: string, code: string, verifier: string, merge: boolean) =>
      call<SessionResult>('POST', '/v1/session', {
        token,
        body: { code, verifier, ...(merge ? { merge: true } : {}) },
        read: (j) =>
          typeof j.session === 'string' && j.session
            ? {
                session: j.session,
                account: { id: num((j.account as Record<string, unknown> | undefined)?.id) },
                merged: j.merged === true,
                linked: j.linked === true,
              }
            : undefined,
      }),
    /** 탈퇴 */
    remove: (token: string) => call('DELETE', '/v1/account', { token, read: () => true }),
    /** 브라우저로 여는 구글 로그인 주소 */
    startUrl: (port: number, state: string, challenge: string) => {
      const u = new URL(`${base}/auth/google/start`);
      u.searchParams.set('port', String(port));
      u.searchParams.set('state', state);
      u.searchParams.set('challenge', challenge);
      return u.toString();
    },
  };
}

export type ServerApi = ReturnType<typeof serverApi>;

/** 409 merge_needed 의 몸 읽기 */
export function mergeNeeded(body: Record<string, unknown>): MergeNeeded | undefined {
  if (typeof body.code !== 'string' || !body.code) return undefined;
  return { code: body.code, current: summary(body.current), other: summary(body.other) };
}
