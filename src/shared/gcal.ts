// 구글 캘린더에 쓰기 (6단계 남은 것). 짝꿍에서 넣은 일정을 사용자의 구글 캘린더로 보낸다.
// 여기는 화면, 메인, 시험이 같이 쓰는 순수한 것만: 설정 창과 주고받는 모양, 일정 → 구글 일정 바꾸기, 지문, 다시 하기 간격.
// 네트워크와 토큰은 메인(main/gcal.ts, main/gcal-auth.ts)에만 있다. 창은 상태만 받는다.
import { plusDays } from './day.ts';
import { NO_END_MIN } from './event-overlap.ts';

/** 쓰는 권한: 일정 읽기 쓰기만 (캘린더 목록, 설정, 공유는 못 본다) */
export const GCAL_SCOPE = 'https://www.googleapis.com/auth/calendar.events';

/** 기본 캘린더 (로그인한 계정의 기본 캘린더) */
export const GCAL_PRIMARY = 'primary';

/** 짝꿍이 정해 보내는 구글 일정 id 머리. 구글 id 는 base32hex 소문자(0-9, a-v) 5~1024자 */
export const GCAL_ID_PREFIX = 'jjk';

/** 설정 창 ↔ 메인 */
export const GCAL = {
  status: 'gcal:status',
  connect: 'gcal:connect',
  cancel: 'gcal:cancel',
  disconnect: 'gcal:disconnect',
  setPush: 'gcal:set-push',
  setCalendar: 'gcal:set-calendar',
  syncNow: 'gcal:sync-now',
  /** 메인 → 설정 창: 상태가 바뀌었다 */
  changed: 'gcal:changed',
} as const;

/**
 * 창에 보이는 문제. 글은 창이 말로 바꾼다
 * - expired: 연결이 끝났다 (구글에서 권한을 거뒀거나 시험판 앱의 7일이 지남). 다시 연결해야 한다
 * - relink: 저장한 연결을 이 컴퓨터 열쇠로 풀 수 없다 (앱 이름이 바뀌어 키체인 항목이 바뀜). 다시 연결해야 한다
 * - denied: 구글 화면에서 허락하지 않았다
 * - scope: 허락 화면에서 캘린더 칸을 체크하지 않았다
 * - timeout: 브라우저에서 너무 오래 기다렸다
 * - offline: 인터넷이 안 된다 (다시 해 본다)
 * - calendar: 고른 캘린더가 없거나 쓸 수 없다
 * - failed: 그 밖에
 */
export type GcalProblem =
  | 'expired'
  | 'relink'
  | 'denied'
  | 'scope'
  | 'timeout'
  | 'offline'
  | 'calendar'
  | 'failed';

export interface GcalStatus {
  /** 이 짝꿍에 OAuth 클라이언트가 들어 있는지. 없으면 연결 단추 대신 안내만 */
  configured: boolean;
  connected: boolean;
  /** 브라우저에서 허락을 기다리는 중 */
  connecting: boolean;
  /** 짝꿍 일정을 구글 캘린더로 보내기 */
  push: boolean;
  /** 보낼 캘린더 id. 기본 primary */
  calendarId: string;
  /** 마지막으로 다 보낸 때 (ms) */
  lastSyncAt: number | null;
  /** 아직 못 보낸 일정 수 */
  pending: number;
  problem: GcalProblem | null;
}

export interface GcalBridge {
  status(): Promise<GcalStatus>;
  /** 브라우저를 열어 연결한다. 끝나면(허락, 거절, 시간 끝) 상태 */
  connect(): Promise<GcalStatus>;
  cancel(): void;
  disconnect(): Promise<GcalStatus>;
  setPush(on: boolean): Promise<GcalStatus>;
  /** 틀린 모양이면 그대로 둔다 */
  setCalendar(id: string): Promise<GcalStatus>;
  syncNow(): Promise<GcalStatus>;
  /** 듣기를 그만두는 함수를 돌려준다 (탭을 오갈 때 듣는 것이 쌓이지 않게) */
  onChanged(listener: (s: GcalStatus) => void): () => void;
}

/**
 * 캘린더 id 다듬기. 빈 글이면 primary. 구글 캘린더 설정 > 캘린더 통합 > 캘린더 ID 에 보이는 모양
 * (메일 주소, ...@group.calendar.google.com). 경로에 들어가므로 이상한 글자는 받지 않는다
 */
export function cleanCalendarId(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const v = raw.trim();
  if (!v || v.toLowerCase() === GCAL_PRIMARY) return GCAL_PRIMARY;
  if (v.length > 254) return undefined;
  return /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(v) ? v : undefined;
}

/** 구글에 보내는 일정 (Calendar API v3 Event 의 쓰는 칸만) */
export interface GcalBody {
  summary: string;
  start: GcalTime;
  end: GcalTime;
  reminders: { useDefault: false; overrides: { method: 'popup'; minutes: number }[] };
  status: 'confirmed';
  extendedProperties: { private: { jjakkung: '1' } };
}

export type GcalTime = { dateTime: string; timeZone: string } | { date: string };

/** 짝꿍 일정에서 쓰는 칸 (event-store.ts CalEvent) */
export interface GcalSource {
  title: string;
  startAt: number;
  endAt: number | null;
  allDay: boolean;
  /** 기준보다 몇 분 앞 (remind.ts). 종일은 첫날 0시 기준 */
  reminds: readonly number[];
}

/** 구글 알림은 0분~4주, 5개까지 */
export const GCAL_REMIND_MAX_MIN = 40_320;
export const GCAL_REMINDS_MAX = 5;

/** tz 에서 그 순간의 날짜 YYYY-MM-DD */
export function dayIn(ms: number, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(ms));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * 짝꿍 일정 → 구글 일정. tz 는 이 컴퓨터의 시간대 (종일 일정의 날짜, 구글 화면에 보일 시간대).
 * - 시각 일정: 시각은 UTC 로 적고 timeZone 을 같이 준다. 끝이 없거나 시작보다 이르면 30분짜리 (겹침 셈과 같다)
 * - 종일 일정: 날짜만. 끝 날은 들지 않는다(짝꿍과 구글이 같다). 하루짜리는 다음 날까지
 * - 알림: 팝업으로. 구글이 못 받는 값(음수: 종일 일정의 당일 아침, 4주 넘게)은 빼고, 시작에 가까운 5개만
 */
export function toGoogle(e: GcalSource, tz: string): GcalBody {
  let start: GcalTime;
  let end: GcalTime;
  if (e.allDay) {
    const first = dayIn(e.startAt, tz);
    const after = e.endAt === null ? undefined : dayIn(e.endAt, tz);
    start = { date: first };
    end = { date: after && after > first ? after : plusDays(first, 1) };
  } else {
    const endAt = e.endAt !== null && e.endAt > e.startAt ? e.endAt : e.startAt + NO_END_MIN * 60_000;
    start = { dateTime: new Date(e.startAt).toISOString(), timeZone: tz };
    end = { dateTime: new Date(endAt).toISOString(), timeZone: tz };
  }
  const minutes = [...new Set(e.reminds)]
    .filter((m) => Number.isInteger(m) && m >= 0 && m <= GCAL_REMIND_MAX_MIN)
    .sort((a, b) => a - b)
    .slice(0, GCAL_REMINDS_MAX);
  return {
    summary: e.title.slice(0, 1024),
    start,
    end,
    reminders: { useDefault: false, overrides: minutes.map((m) => ({ method: 'popup', minutes: m })) },
    status: 'confirmed',
    extendedProperties: { private: { jjakkung: '1' } },
  };
}

/** 보낸 내용의 지문 (FNV-1a 두 벌). 같으면 다시 보내지 않는다 */
export function gcalHash(body: GcalBody): string {
  const s = JSON.stringify(body);
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x5bd1e995) >>> 0;
  }
  return `${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}`;
}

/** 구글에서도 지웠다는 표시 (google_hash) */
export const GCAL_DELETED = 'deleted';

/** 새 구글 일정 id: 머리 + 무작위 base32hex 26자 (130비트). randomBytes 는 무작위 바이트 (시험에서 바꾼다) */
export function newGoogleId(randomBytes: (n: number) => Uint8Array): string {
  const abc = '0123456789abcdefghijklmnopqrstuv';
  const bytes = randomBytes(26);
  let out = GCAL_ID_PREFIX;
  for (const b of bytes) out += abc[b & 31];
  return out;
}

export const isGoogleId = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-v]{5,1024}$/.test(v);

/**
 * 다시 하기 간격 (일정마다). 인터넷이 끊기거나 구글이 바쁘면 30초, 1분, 2분 ... 30분까지 늘린다.
 * 받지 않는 일정(400 등)은 6시간 뒤에 다시 (고치면 지문이 바뀌어 바로 다시 보낸다: ok 로 풀린다).
 * 앱을 다시 켜면 처음부터 (못 보낸 것은 저장 파일에 그대로 남아 다시 보낸다)
 */
export class GcalBackoff {
  static readonly BASE_MS = 30_000;
  static readonly MAX_MS = 30 * 60_000;
  static readonly BAD_MS = 6 * 3_600_000;
  #m = new Map<string, { n: number; at: number; hash?: string }>();
  #jitter: () => number;
  /** jitter: 0 이상 1 미만. 여럿이 같은 때 몰리지 않게 간격에 0~20% 를 더한다 */
  constructor(jitter: () => number = Math.random) {
    this.#jitter = jitter;
  }

  /** 지금 해 봐도 되는지. hash 를 주면 내용이 바뀐 일정은 기다리지 않는다 */
  ready(key: string, now: number, hash?: string): boolean {
    const v = this.#m.get(key);
    if (!v) return true;
    if (hash !== undefined && v.hash !== undefined && v.hash !== hash) return true;
    return now >= v.at;
  }

  /** 실패. bad 면 길게. 다음에 해 볼 때를 돌려준다 */
  fail(key: string, now: number, o: { bad?: boolean; hash?: string } = {}): number {
    const n = (this.#m.get(key)?.n ?? 0) + 1;
    const wait = o.bad
      ? GcalBackoff.BAD_MS
      : Math.min(GcalBackoff.BASE_MS * 2 ** (n - 1), GcalBackoff.MAX_MS) * (1 + 0.2 * this.#jitter());
    const at = now + Math.round(wait);
    this.#m.set(key, { n, at, ...(o.hash !== undefined ? { hash: o.hash } : {}) });
    return at;
  }

  ok(key: string): void {
    this.#m.delete(key);
  }

  /** 가장 이른 다음 때 (기다리는 것이 없으면 undefined) */
  nextAt(): number | undefined {
    let min: number | undefined;
    for (const v of this.#m.values()) if (min === undefined || v.at < min) min = v.at;
    return min;
  }

  clear(): void {
    this.#m.clear();
  }
}

/**
 * 일정 줄에 붙는 구글 표식 (패널 일정 탭). 구글 연결이 없으면 붙이지 않는다.
 * - sent: 지금 내용 그대로 구글에 들어가 있다
 * - pending: 보낼 차례를 기다린다 (방금 넣거나 고침, 인터넷이 안 됨)
 * - failed: 구글이 받지 않았다 (고치면 다시 보내 본다)
 * - local: 페어리에만 있다 (보내기를 꺼 두었거나, 보내기를 켜기 전의 지난 일정)
 * 캘린더 가져오기(.ics)로 들어온 일정은 표식 대신 일정의 source 로 따로 보인다
 */
export type GcalMark = 'sent' | 'pending' | 'failed' | 'local';

/** 패널에 주는 구글 상태 */
export interface PanelGcal {
  /** 일정 id → 표식 (짝꿍이 넣은 일정만) */
  marks: Record<number, GcalMark>;
  /** 보내기를 멈춘 까닭 (pending 툴팁에 쓴다) */
  problem: GcalProblem | null;
}

/**
 * 고치기(PATCH)에 보낼 일정. 구글 PATCH 는 안쪽 객체(start, end)를 합쳐서, 종일과 시각 일정 사이를 바꾸면
 * 옛 칸(date 나 dateTime)이 남아 둘 다 있는 일정이 되고 구글이 받지 않는다(400). 반대쪽 칸을 null 로 지운다
 */
export function toGooglePatch(b: GcalBody): Omit<GcalBody, 'start' | 'end'> & {
  start: Record<string, string | null>;
  end: Record<string, string | null>;
} {
  const clear = (v: GcalTime): Record<string, string | null> =>
    'date' in v ? { ...v, dateTime: null, timeZone: null } : { ...v, date: null };
  return { ...b, start: clear(b.start), end: clear(b.end) };
}
