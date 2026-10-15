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

/** AI 대화권 남은 수 (GET /v1/ai, #100) */
export interface AiTicketStatus {
  tickets: number;
  dailyLimit: number;
  usedToday: number;
}

/** 대화권 질문 (POST /v1/ai/chat). 서버가 최근 대화와 펫 성격을 받아 Claude 에 중계한다 */
export interface AiChatBody {
  messages: { role: 'user' | 'assistant'; content: string }[];
  lang: 'ko' | 'en';
  persona: string;
}

/**
 * 대화권 질문의 끝. 실패는 서버의 까닭(no_tickets, daily_limit, budget, upstream, timeout, ai_off, login, age,
 * too_long, rate_limited) 그대로이거나 offline(닿지 않음, 끊김), cancelled(사용자가 멈춤), bad_reply.
 * tickets 는 서버가 알려 준 남은 수, refunded 는 서버가 차감을 되돌렸다는 뜻
 */
export type AiChatOutcome =
  | { ok: true; tickets: number }
  | { ok: false; status: number; error: string; tickets?: number; refunded?: boolean };

/** 대화권 답 전체 시간 상한 (서버 120초 + 여유) */
export const AI_CHAT_TIMEOUT_MS = 150_000;
/** 대화권 답 본문 상한 (출력 600 토큰의 SSE 는 수십 KB) */
export const AI_REPLY_MAX_BYTES = 512_000;

/** 대답 본문 상한 (대기열 500개 결과도 100KB 남짓) */
export const REPLY_MAX_BYTES = 1_000_000;

const num = (v: unknown): number => (typeof v === 'number' && Number.isSafeInteger(v) ? v : 0);
/** 0 이상의 안전한 정수만 (잔액, 옮긴 양, 물건 수) */
export const nat = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : undefined;

/** 본문을 상한까지만 읽는다. content-length 가 넘거나 읽다가 넘으면 undefined (읽기를 멈춘다) */
async function readCapped(res: Response, max: number): Promise<string | undefined> {
  const len = Number(res.headers.get('content-length') ?? '');
  if (Number.isFinite(len) && len > max) {
    await res.body?.cancel().catch(() => {});
    return undefined;
  }
  if (!res.body) return '';
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return undefined;
    }
    parts.push(value);
  }
  return Buffer.concat(parts).toString('utf8');
}

function items(v: unknown): Items {
  const out: Items = {};
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return out;
  for (const [k, n] of Object.entries(v))
    if (typeof n === 'number' && Number.isSafeInteger(n) && n > 0 && k.length <= 64) out[k] = n;
  return out;
}

export const summary = (v: unknown): AccountSummary => {
  const o = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>;
  return { balance: nat(o.balance) ?? 0, items: items(o.items) };
};

export function serverApi(base: string, f: FetchLike) {
  async function call<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
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
      const text = res.status === 204 ? '' : await readCapped(res, REPLY_MAX_BYTES);
      if (text === undefined) return { ok: false, status: res.status || 500, error: 'too_big', body: {} };
      let json: Record<string, unknown> = {};
      if (text) {
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
          nat(j.balance) !== undefined && Array.isArray(j.results)
            ? {
                balance: nat(j.balance) as number,
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
          nat(j.balance) !== undefined && nat(j.applied ?? 0) !== undefined
            ? {
                balance: nat(j.balance) as number,
                items: items(j.items),
                applied: nat(j.applied ?? 0) as number,
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
    /** 나이 구분 바꾸기 */
    setAge: (token: string, age: '14+' | '18+') =>
      call('PATCH', '/v1/account', { token, body: { age }, read: () => true }),
    /** 로그아웃: 이 세션을 서버에서도 지운다 (세션 토큰으로만) */
    logout: (token: string) => call('DELETE', '/v1/session', { token, read: () => true }),
    /** 탈퇴 */
    remove: (token: string) => call('DELETE', '/v1/account', { token, read: () => true }),
    /** AI 대화권 남은 수 (세션 토큰, 만 18세 이상). 처음이면 서버가 첫 로그인 선물을 준다 */
    aiStatus: (token: string) =>
      call<AiTicketStatus>('GET', '/v1/ai', {
        token,
        read: (j) =>
          nat(j.tickets) !== undefined
            ? {
                tickets: nat(j.tickets) as number,
                dailyLimit: nat(j.dailyLimit) ?? 0,
                usedToday: nat(j.usedToday) ?? 0,
              }
            : undefined,
      }),
    /** 신고: 사용자가 따로 확인한 질문과 답 하나 */
    aiReport: (token: string, question: string, answer: string) =>
      call('POST', '/v1/ai/report', {
        token,
        body: { question: question.slice(0, 4000), answer: answer.slice(0, 8000), consent: true },
        read: () => true,
      }),
    /** 대화권 질문 하나. 답 조각마다 onText. signal 로 멈춘다 */
    aiChat: (token: string, body: AiChatBody, onText: (text: string) => void, signal?: AbortSignal) =>
      aiChat(base, f, token, body, onText, signal),
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

/** SSE 한 덩이 ("event: x\ndata: {...}") */
function sseBlock(block: string): { event: string; data: Record<string, unknown> } | undefined {
  let event = 'message';
  let data = '';
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data += line.slice(5).trim();
  }
  if (!data) return undefined;
  try {
    const v = JSON.parse(data) as unknown;
    return typeof v === 'object' && v !== null && !Array.isArray(v)
      ? { event, data: v as Record<string, unknown> }
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * POST /v1/ai/chat 를 읽는다. 성공하면 SSE(text 조각들, 끝에 done 또는 error), 첫 조각 전에 실패하면 JSON.
 * 끝(done, error) 없이 닫히면 offline 으로 본다 (서버는 그때 차감을 되돌린다)
 */
async function aiChat(
  base: string,
  f: FetchLike,
  token: string,
  body: AiChatBody,
  onText: (text: string) => void,
  signal?: AbortSignal,
): Promise<AiChatOutcome> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), AI_CHAT_TIMEOUT_MS);
  const stop = () => ac.abort();
  signal?.addEventListener('abort', stop);
  const failed = (status: number, json: Record<string, unknown>): AiChatOutcome => ({
    ok: false,
    status,
    error: typeof json.error === 'string' ? json.error.slice(0, 64) : `http_${status}`,
    ...(nat(json.tickets) !== undefined ? { tickets: nat(json.tickets) as number } : {}),
    ...(json.refunded === true ? { refunded: true } : {}),
  });
  try {
    const res = await f(`${base}/v1/ai/chat`, {
      method: 'POST',
      headers: {
        accept: 'text/event-stream',
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    const type = res.headers.get('content-type') ?? '';
    if (res.status !== 200 || !type.includes('text/event-stream')) {
      const text = await readCapped(res, REPLY_MAX_BYTES);
      let json: Record<string, unknown> = {};
      try {
        const v = JSON.parse(text ?? '') as unknown;
        if (typeof v === 'object' && v !== null && !Array.isArray(v)) json = v as Record<string, unknown>;
      } catch {}
      return failed(
        res.status === 200 ? 502 : res.status,
        res.status === 200 ? { error: 'bad_reply' } : json,
      );
    }
    if (!res.body) return { ok: false, status: 0, error: 'offline' };
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > AI_REPLY_MAX_BYTES) {
        await reader.cancel().catch(() => {});
        return { ok: false, status: 200, error: 'too_big' };
      }
      buf += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
      for (let i = buf.indexOf('\n\n'); i >= 0; i = buf.indexOf('\n\n')) {
        const ev = sseBlock(buf.slice(0, i));
        buf = buf.slice(i + 2);
        if (!ev) continue;
        if (ev.event === 'text' && typeof ev.data.text === 'string') onText(ev.data.text);
        else if (ev.event === 'done') {
          await reader.cancel().catch(() => {});
          return { ok: true, tickets: nat(ev.data.tickets) ?? 0 };
        } else if (ev.event === 'error') {
          await reader.cancel().catch(() => {});
          return failed(200, ev.data);
        }
      }
    }
    return { ok: false, status: 0, error: 'offline' };
  } catch {
    return { ok: false, status: 0, error: signal?.aborted ? 'cancelled' : 'offline' };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', stop);
  }
}

/** 409 merge_needed 의 몸 읽기 */
export function mergeNeeded(body: Record<string, unknown>): MergeNeeded | undefined {
  if (typeof body.code !== 'string' || !body.code || body.code.length > 128) return undefined;
  return { code: body.code, current: summary(body.current), other: summary(body.other) };
}
