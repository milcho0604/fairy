// 페어리 서버 API 부르기 (기획서 11절, 서버 PR #106). Electron 없이 돌아 시험에서 fetch 를 바꿔 끼운다.
// 토큰과 코드는 기록에 남기지 않는다. 실패 대답은 { error: '<까닭>' }.
import { createHash } from 'node:crypto';
import {
  type AccountSummary,
  type Items,
  isLoginService,
  type LoginProviders,
  type LoginService,
  type ServerBackupItem,
} from '../shared/server-account.ts';
import {
  APP_VERSION_HEADER,
  exempt,
  type GateNeed,
  isVersion,
  type UpdateLevels,
} from '../shared/update-levels.ts';
import type { QueueEntry } from './server-coins.ts';

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** /v1/me 의 업데이트 기준 (이슈 #120). 정하지 않은 칸은 빠지고, 모양이 틀린 칸도 빠진다 */
export function levelsOf(v: unknown): UpdateLevels {
  const o = obj(v);
  const pick = (x: unknown) => (isVersion(x) ? x : undefined);
  const out: UpdateLevels = {};
  if (pick(o.recommend)) out.recommend = o.recommend as string;
  if (pick(o.restrict)) out.restrict = o.restrict as string;
  if (pick(o.min)) out.min = o.min as string;
  return out;
}

/** 서버 호출 옵션 (이슈 #120) */
export interface ServerApiOpts {
  /** 앱 판. 모든 요청의 X-Fairy-Version 머리로 간다 (서버 관문이 기준과 비교한다) */
  appVersion?: string;
  /**
   * 관문 결과. 426 을 받았으면 단계와 필요한 판, 관문을 건너는 요청이 통과했으면 null.
   * 설정 칸의 "업데이트하면 다시 쓸 수 있어" 안내와 강제 잠금이 쓴다 (server-core.ts)
   */
  onGate?: (g: GateNeed | null) => void;
}

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
  /** 기기 코드와 닉네임 (#101). 옛 서버면 없다 */
  profile?: ProfileInfo;
  /** 아직 열지 않은 쪽지 수 (#101) */
  inbox: number;
}

/** 앱에 보이는 계정 정보: 기기 코드(F-XXXX-XXXX)와 닉네임 (#101). 계정 번호는 보이지 않는다 */
export interface ProfileInfo {
  code: string;
  nickname: string | null;
}

/** 같은 계정 기기들의 구글 일정 연결 표시 (#115). 서버에는 토큰 없이 연결한 기기 수만 있다 */
export interface CalendarLinkInfo {
  linked: boolean;
  devices: number;
}

/** 서버의 calendar 칸. 기능 키가 꺼져 있으면 서버가 null 을 준다 (모르는 모양도 null) */
export function calendarOf(v: unknown): CalendarLinkInfo | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const devices = nat(o.devices);
  if (typeof o.linked !== 'boolean' || devices === undefined) return null;
  return { linked: o.linked, devices };
}

/** 선물 받기와 쿠폰의 결과 (#101) */
export interface RewardResult {
  balance: number;
  coins: number;
  /** 받은 채팅 이용권 */
  tickets: number;
}

/** 서버 쪽지함의 쪽지 하나 (#101, server/src/inbox.ts) */
export interface InboxItem {
  id: number;
  kind: 'grant' | 'notice' | 'subscription';
  message: string | null;
  coins: number;
  chatPasses: number;
  fillTo: number | null;
  sentAt: string;
  expiresAt: string | null;
  openedAt: string | null;
  opened: { coins: number; chatPasses: number } | null;
  expired: boolean;
}

export interface InboxPage {
  items: InboxItem[];
  next: number | null;
  unopened: number;
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
  /** 남는 계정에 붙은 로그인 서비스 (#102) */
  logins: LoginService[];
}

/** 서버 백업 목록 (GET /v1/backup, #102) */
export interface BackupList {
  backups: ServerBackupItem[];
  keep: number;
  maxBytes: number;
}

/** 서버 백업 올리기와 받기의 시간 상한 (20MB) */
export const BACKUP_TIMEOUT_MS = 180_000;
/** 서버가 말하지 않을 때의 서버 백업 크기 상한 */
export const BACKUP_MAX_BYTES = 20 * 1024 * 1024;

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
  /** 운영자가 건 정기 지급 (#101). 없으면 null */
  subscription: { monthly: number; mode: 'fill' | 'add'; nextFill: string | null } | null;
}

/** 대화권 질문 (POST /v1/ai/chat). 서버가 최근 대화와 펫 성격을 받아 Claude 에 중계한다 */
export interface AiChatBody {
  messages: { role: 'user' | 'assistant'; content: string }[];
  /** 사용자가 직접 친 마지막 질문 글만 (messages 마지막 말에서 앞에 붙인 시각, 머리글, 할 일 목록을 뺀 것). 서버가 질문 글자 수 상한을 이걸로 잰다 */
  question?: string;
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

const obj = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const str = (v: unknown, max = 200): string | null => (typeof v === 'string' && v.length <= max ? v : null);

/** 기기 코드와 닉네임. 코드 모양이 틀리면 undefined */
export function profileOf(v: unknown): ProfileInfo | undefined {
  const o = obj(v);
  const code = str(o.code, 20);
  if (!code || !/^F-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/.test(code)) return undefined;
  return { code, nickname: str(o.nickname, 40) };
}

export function inboxItemOf(v: unknown): InboxItem | undefined {
  const o = obj(v);
  const id = nat(o.id);
  const kind = o.kind;
  if (!id || (kind !== 'grant' && kind !== 'notice' && kind !== 'subscription')) return undefined;
  const opened = o.opened === null || o.opened === undefined ? null : obj(o.opened);
  return {
    id,
    kind,
    message: str(o.message, 400),
    coins: nat(o.coins) ?? 0,
    chatPasses: nat(o.chatPasses) ?? 0,
    fillTo: nat(o.fillTo) ?? null,
    sentAt: str(o.sentAt, 40) ?? '',
    expiresAt: str(o.expiresAt, 40),
    openedAt: str(o.openedAt, 40),
    opened: opened ? { coins: nat(opened.coins) ?? 0, chatPasses: nat(opened.chatPasses) ?? 0 } : null,
    expired: o.expired === true,
  };
}

const rewardOf = (j: Record<string, unknown>): RewardResult | undefined =>
  nat(j.balance) !== undefined
    ? { balance: nat(j.balance) as number, coins: nat(j.coins) ?? 0, tickets: nat(j.tickets) ?? 0 }
    : undefined;

function items(v: unknown): Items {
  const out: Items = {};
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return out;
  for (const [k, n] of Object.entries(v))
    if (typeof n === 'number' && Number.isSafeInteger(n) && n > 0 && k.length <= 64) out[k] = n;
  return out;
}

const services = (v: unknown): LoginService[] =>
  Array.isArray(v) ? [...new Set(v.filter(isLoginService))] : [];

function backupItem(v: unknown): ServerBackupItem | undefined {
  if (typeof v !== 'object' || v === null) return undefined;
  const o = v as Record<string, unknown>;
  const id = nat(o.id);
  const size = nat(o.size);
  if (
    id === undefined ||
    size === undefined ||
    typeof o.sha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(o.sha256)
  )
    return undefined;
  const date = (x: unknown) => (typeof x === 'string' && !Number.isNaN(Date.parse(x)) ? x : undefined);
  const createdAt = date(o.createdAt);
  const expiresAt = date(o.expiresAt);
  if (!createdAt || !expiresAt) return undefined;
  return { id, size, sha256: o.sha256, createdAt, expiresAt, soon: o.soon === true };
}

export const summary = (v: unknown): AccountSummary => {
  const o = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>;
  return { balance: nat(o.balance) ?? 0, items: items(o.items) };
};

/**
 * 서버로 나가는 모든 요청이 지나는 한 곳 (이슈 #120). 앱 판 머리를 붙이고, 관문 결과를 알린다:
 * 426 이면 단계와 필요한 판, 관문을 건너는 호출이 통과했으면 null (막힌 것을 푼다).
 * serverApi 의 요청 함수는 전부 이 감싸개만 쓴다. 그래서 머리가 빠진 요청이 생길 수 없다.
 */
export function gated(
  raw: FetchLike,
  appVersion: string | undefined,
  onGate?: (g: GateNeed | null) => void,
): FetchLike {
  return async (url, init) => {
    const headers = { ...((init.headers ?? {}) as Record<string, string>) };
    if (appVersion) headers[APP_VERSION_HEADER] = appVersion;
    const res = await raw(url, { ...init, headers });
    if (!onGate) return res;
    if (res.status === 426) {
      // 몸이 작다. 못 읽으면 단계를 모르는 것으로 두고 막힌 것만 알린다
      const json = (await res
        .clone()
        .json()
        .catch(() => undefined)) as Record<string, unknown> | undefined;
      const level = json?.level === 'force' || json?.level === 'restrict' ? json.level : undefined;
      if (level && isVersion(json?.need)) onGate({ level, need: json.need });
    } else if (res.status >= 200 && res.status < 300) {
      const path = new URL(url).pathname;
      if (!exempt(init.method ?? 'GET', path)) onGate(null);
    }
    return res;
  };
}

export function serverApi(base: string, raw: FetchLike, opts: ServerApiOpts = {}) {
  const f = gated(raw, opts.appVersion, opts.onGate);
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
    device: (age: '14+' | '18+', nickname?: string | null) =>
      call('POST', '/v1/device', {
        body: { age, ...(nickname ? { nickname } : {}) },
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
                ...(profileOf(j.account) ? { profile: profileOf(j.account) } : {}),
                inbox: nat(j.inbox) ?? 0,
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
                logins: services(j.logins),
              }
            : undefined,
      }),
    /** 지금 쓸 수 있는 로그인 서비스 (토큰을 주면 그 계정 기준, #102) */
    providers: (token?: string) =>
      call<LoginProviders>('GET', '/v1/auth/providers', {
        ...(token ? { token } : {}),
        read: (j) =>
          Array.isArray(j.login) ? { login: services(j.login), link: services(j.link) } : undefined,
      }),
    /** 이 계정에 켜진 기능 키 (토큰 기준, #102). 모르는 값은 false */
    features: (token?: string) =>
      call<Record<string, boolean>>('GET', '/v1/features', {
        ...(token ? { token } : {}),
        read: (j) => {
          if (typeof j.features !== 'object' || j.features === null) return undefined;
          const out: Record<string, boolean> = {};
          for (const [k, v] of Object.entries(j.features as Record<string, unknown>))
            if (/^[a-z][a-z0-9_]{1,39}$/.test(k)) out[k] = v === true;
          return out;
        },
      }),
    /** 토큰을 들고 로그인을 연다: 서비스 로그인 주소를 받는다 (카카오 allowlist 는 이 길로만) */
    begin: (token: string, service: LoginService, port: number, state: string, challenge: string) =>
      call<{ url: string }>('POST', `/v1/auth/${service}/begin`, {
        token,
        body: { port: String(port), state, challenge },
        read: (j) => (typeof j.url === 'string' && /^https?:\/\//.test(j.url) ? { url: j.url } : undefined),
      }),
    /** 서버 백업 목록 (세션 토큰) */
    backupList: (token: string) =>
      call<BackupList>('GET', '/v1/backup', {
        token,
        read: (j) =>
          Array.isArray(j.backups)
            ? {
                backups: (j.backups as unknown[]).flatMap((x) => backupItem(x) ?? []),
                keep: nat(j.keep) ?? 2,
                maxBytes: nat(j.maxBytes) ?? BACKUP_MAX_BYTES,
              }
            : undefined,
      }),
    /** 서버 백업 올리기 (.fairybackup 그대로, 따로 동의한 뒤에만 부른다) */
    backupUpload: (token: string, bytes: Uint8Array) => backupUpload(base, f, token, bytes),
    /** 서버 백업 받기. 크기와 sha256 이 목록 값과 다르면 bad_reply */
    backupDownload: (token: string, item: ServerBackupItem) => backupDownload(base, f, token, item),
    backupDelete: (token: string, id: number) =>
      call('DELETE', `/v1/backup/${id}`, { token, read: () => true }),
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
                subscription:
                  j.subscription && nat(obj(j.subscription).monthly)
                    ? {
                        monthly: nat(obj(j.subscription).monthly) as number,
                        mode: obj(j.subscription).mode === 'add' ? 'add' : 'fill',
                        nextFill: str(obj(j.subscription).nextFill, 10),
                      }
                    : null,
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
    /** 내 계정: 기기 코드, 닉네임, 운영자인지 (#101). 서버가 매번 다시 본다 */
    me: (token: string) =>
      call<{ profile: ProfileInfo; admin: boolean; calendar: CalendarLinkInfo | null; update: UpdateLevels }>(
        'GET',
        '/v1/me',
        {
          token,
          read: (j) => {
            const profile = profileOf(j.account);
            return profile
              ? {
                  profile,
                  admin: j.admin === true,
                  calendar: calendarOf(j.calendar),
                  update: levelsOf(j.update),
                }
              : undefined;
          },
        },
      ),
    /**
     * 이 기기가 구글 일정을 연결했나 (#115). 기기마다 세므로 기기 토큰으로만. 켜기는 기능 키가 켜진 계정만
     * (아니면 403 feature_off). 대답은 계정의 연결 표시 (기능 키가 꺼져 있으면 null)
     */
    setCalendarLinked: (deviceToken: string, linked: boolean) =>
      call<{ calendar: CalendarLinkInfo | null }>('PATCH', '/v1/account', {
        token: deviceToken,
        body: { calendarLinked: linked },
        read: (j) => ({ calendar: calendarOf(j.calendar) }),
      }),
    /** 닉네임 바꾸기 (#101). 틀리면 400 nickname 과 reason */
    setNickname: (token: string, nickname: string) =>
      call('PATCH', '/v1/account', { token, body: { nickname }, read: (j) => profileOf(j.account) ?? true }),
    /** 이벤트 선물 받기 (#101) */
    claim: (token: string, event: string) =>
      call<RewardResult>('POST', '/v1/claim', { token, body: { event }, read: rewardOf }),
    /** 쿠폰 쓰기 (#101) */
    coupon: (token: string, code: string) =>
      call<RewardResult>('POST', '/v1/coupon', { token, body: { code }, read: rewardOf }),
    /** 쪽지함 한 쪽 (#101). before 로 다음 쪽 */
    inbox: (token: string, before?: number) =>
      call<InboxPage>('GET', `/v1/inbox${before ? `?before=${before}` : ''}`, {
        token,
        read: (j) =>
          Array.isArray(j.items)
            ? {
                items: (j.items as unknown[]).flatMap((x) => inboxItemOf(x) ?? []),
                next: nat(j.next) ?? null,
                unopened: nat(j.unopened) ?? 0,
              }
            : undefined,
      }),
    /** 쪽지 열기 (#101): 첨부를 받는다 (한 번만) */
    openInbox: (token: string, id: number) =>
      call<{ item: InboxItem; balance: number; chatPasses: number }>('POST', `/v1/inbox/${id}/open`, {
        token,
        read: (j) => {
          const item = inboxItemOf(j.item);
          return item && nat(j.balance) !== undefined
            ? { item, balance: nat(j.balance) as number, chatPasses: nat(j.chatPasses) ?? 0 }
            : undefined;
        },
      }),
    /** 운영자 화면 (#101, 운영자 계정의 세션만). 화면에 그릴 것을 통째로 */
    adminOverview: (token: string, q?: string) =>
      call<Record<string, unknown>>('GET', `/v1/admin/overview${q ? `?q=${encodeURIComponent(q)}` : ''}`, {
        token,
        read: (j) => j,
      }),
    /** 운영자 쓰기 하나 (#101). 거절은 400 refused 와 text */
    adminAction: (
      token: string,
      action: string,
      fields: Record<string, string | string[] | boolean | number>,
    ) =>
      call<{ text: string; code?: string; data?: Record<string, string | number> }>(
        'POST',
        `/v1/admin/${action}`,
        {
          token,
          body: fields,
          read: (j) =>
            typeof j.text === 'string'
              ? {
                  text: j.text,
                  ...(typeof j.code === 'string' ? { code: j.code.slice(0, 40) } : {}),
                  ...(j.data && typeof j.data === 'object'
                    ? { data: j.data as Record<string, string | number> }
                    : {}),
                }
              : undefined,
        },
      ),
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

const errorOf = (status: number, text: string): string => {
  try {
    const v = JSON.parse(text) as { error?: unknown };
    if (typeof v.error === 'string') return v.error.slice(0, 64);
  } catch {}
  return `http_${status}`;
};

async function backupUpload(
  base: string,
  f: FetchLike,
  token: string,
  bytes: Uint8Array,
): Promise<ApiResult<{ backup: ServerBackupItem }>> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), BACKUP_TIMEOUT_MS);
  try {
    const res = await f(`${base}/v1/backup?consent=yes`, {
      method: 'PUT',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${token}`,
        'content-type': 'application/octet-stream',
      },
      body: bytes as BodyInit,
      signal: ac.signal,
    });
    const text = (await readCapped(res, REPLY_MAX_BYTES)) ?? '';
    if (res.status < 200 || res.status >= 300)
      return { ok: false, status: res.status, error: errorOf(res.status, text), body: {} };
    let item: ServerBackupItem | undefined;
    try {
      item = backupItem((JSON.parse(text) as { backup?: unknown }).backup);
    } catch {}
    if (!item) return { ok: false, status: res.status, error: 'bad_reply', body: {} };
    return { ok: true, status: res.status, data: { backup: item } };
  } catch {
    return { ok: false, status: 0, error: 'offline', body: {} };
  } finally {
    clearTimeout(timer);
  }
}

async function backupDownload(
  base: string,
  f: FetchLike,
  token: string,
  item: ServerBackupItem,
): Promise<ApiResult<Buffer>> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), BACKUP_TIMEOUT_MS);
  try {
    const res = await f(`${base}/v1/backup/${item.id}`, {
      method: 'GET',
      headers: { authorization: `Bearer ${token}` },
      signal: ac.signal,
    });
    if (res.status !== 200) {
      const text = (await readCapped(res, REPLY_MAX_BYTES)) ?? '';
      return { ok: false, status: res.status, error: errorOf(res.status, text), body: {} };
    }
    if (!res.body) return { ok: false, status: 0, error: 'offline', body: {} };
    // 목록의 크기까지만 받는다 (넘으면 그만둔다)
    const reader = res.body.getReader();
    const parts: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > item.size) {
        await reader.cancel().catch(() => {});
        return { ok: false, status: 200, error: 'bad_reply', body: {} };
      }
      parts.push(value);
    }
    const buf = Buffer.concat(parts);
    // 끊겼거나(서버가 tag 를 못 맞춰 끊음) 바뀐 파일
    if (buf.length !== item.size || createHash('sha256').update(buf).digest('hex') !== item.sha256)
      return { ok: false, status: 200, error: 'bad_reply', body: {} };
    return { ok: true, status: 200, data: buf };
  } catch {
    return { ok: false, status: 0, error: 'offline', body: {} };
  } finally {
    clearTimeout(timer);
  }
}

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
