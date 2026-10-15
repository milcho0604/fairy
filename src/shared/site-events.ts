// 이벤트 목록과 쿠폰 코드 (docs/server-plan.md 9절, 이슈 #101). 앱과 서버가 함께 쓰는 순수 규칙.
// 운영자 화면에서 만든 이벤트를 서버가 GET /v1/events.json 으로 내보내고, 공개 레포의 Actions 가 그것을 홈페이지 정적 파일
// site/events.json 으로 올린다 (scripts/site/pull-feeds.ts). 앱은 정적 파일만 읽어 홈서버가 꺼져도 목록이 보인다.
// 서버가 함께 읽으므로 이 파일은 아무것도 가져오지 않는다 (import 없음, coin-rules.ts 와 같다).

/** 파일 크기 상한. 넘으면 파일 전체를 읽지 않는다 */
export const EVENTS_MAX_BYTES = 64 * 1024;
/** 앱이 아는 파일 형식 판 */
export const EVENTS_FORMAT = 1;
/** 한 파일에서 보는 이벤트 수 상한 */
export const EVENTS_MAX = 50;
export const EVENT_TITLE_MAX = 60;
export const EVENT_BODY_MAX = 300;
/** 선물 이벤트 하나가 주는 코인 상한 (상점 물건을 다 사는 값 7,990 보다 작게) */
export const GIFT_COINS_MAX = 1000;

/** 선물(모두에게 코인 n), 배수(기간 동안 출석이나 집중 코인 x배) */
export const EVENT_KINDS = ['gift', 'boost'] as const;
export type EventKind = (typeof EVENT_KINDS)[number];
/** 배수를 거는 코인 까닭 (기획서 9절: 출석 또는 집중). coin-rules.ts EARN_RULES 의 키 */
export const BOOST_REASONS = ['meet', 'focus'] as const;
export type BoostReason = (typeof BOOST_REASONS)[number];
export const BOOST_TIMES = [2, 3] as const;

/** 영문, 숫자, '.', '_', '-' 40자까지 (서버 장부의 기록 번호 'claim:<계정>:<이벤트>' 가 80자 안에 들게) */
export const EVENT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;

export interface EventText {
  ko: string;
  en: string;
}

export interface SiteEvent {
  id: string;
  kind: EventKind;
  title: EventText;
  body: EventText;
  /** 시작과 끝 (밀리초). 끝은 그 순간부터 끝난 것 */
  from: number;
  until: number;
  /** 선물: 받는 코인 */
  coins?: number;
  /** 배수: 까닭과 배수 */
  boost?: { reasons: BoostReason[]; times: number };
}

export interface EventsFile {
  events: SiteEvent[];
}

/** 줄바꿈 말고 제어 문자는 지우고 앞뒤 빈칸을 깎는다. 비었거나 너무 길면 undefined (공지와 같은 규칙) */
export function cleanEventText(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = [...v.replace(/\r\n?/g, '\n')]
    .filter((c) => {
      const code = c.charCodeAt(0);
      return c === '\n' || (code >= 0x20 && code !== 0x7f);
    })
    .join('')
    .trim();
  return s && s.length <= max ? s : undefined;
}

function readText(v: unknown, max: number): EventText | undefined {
  if (typeof v !== 'object' || v === null) return undefined;
  const r = v as Record<string, unknown>;
  const ko = cleanEventText(r.ko, max);
  const en = cleanEventText(r.en, max);
  return ko && en ? { ko, en } : undefined;
}

function readTime(v: unknown): number | undefined {
  if (typeof v !== 'string') return undefined;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : undefined;
}

/** 이벤트 하나를 읽는다. 칸이 깨졌거나 모르는 종류면 undefined (그 이벤트만 버린다) */
export function parseEvent(v: unknown): SiteEvent | undefined {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return undefined;
  const r = v as Record<string, unknown>;
  if (typeof r.id !== 'string' || !EVENT_ID.test(r.id)) return undefined;
  if (!(EVENT_KINDS as readonly unknown[]).includes(r.kind)) return undefined;
  const title = readText(r.title, EVENT_TITLE_MAX);
  const body = readText(r.body, EVENT_BODY_MAX);
  const from = readTime(r.from);
  const until = readTime(r.until);
  if (!title || !body || from === undefined || until === undefined || until <= from) return undefined;
  const e: SiteEvent = { id: r.id, kind: r.kind as EventKind, title, body, from, until };
  if (e.kind === 'gift') {
    const c = r.coins;
    if (typeof c !== 'number' || !Number.isInteger(c) || c < 1 || c > GIFT_COINS_MAX) return undefined;
    e.coins = c;
  } else {
    const b = r.boost as Record<string, unknown> | undefined;
    if (typeof b !== 'object' || b === null || !Array.isArray(b.reasons)) return undefined;
    const reasons = [...new Set(b.reasons)];
    if (reasons.length === 0 || reasons.some((x) => !(BOOST_REASONS as readonly unknown[]).includes(x)))
      return undefined;
    if (!(BOOST_TIMES as readonly unknown[]).includes(b.times)) return undefined;
    e.boost = { reasons: reasons as BoostReason[], times: b.times as number };
  }
  return e;
}

export interface ParsedEvents extends EventsFile {
  /** 버린 이벤트 수 (Actions 의 엄격한 검사가 0 인지 본다) */
  dropped: number;
}

/**
 * 받은 글 전체를 읽는다. 너무 크거나, JSON 이 아니거나, 형식 판이 다르거나, events 가 목록이 아니면 undefined.
 * 깨진 이벤트는 그것만 버린다. 같은 id 는 앞의 것만
 */
export function parseEvents(text: unknown): ParsedEvents | undefined {
  if (typeof text !== 'string' || text.length > EVENTS_MAX_BYTES) return undefined;
  if (new TextEncoder().encode(text).length > EVENTS_MAX_BYTES) return undefined;
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return undefined;
  const r = json as Record<string, unknown>;
  if (r.version !== EVENTS_FORMAT || !Array.isArray(r.events)) return undefined;
  const events: SiteEvent[] = [];
  const ids = new Set<string>();
  let dropped = Math.max(0, r.events.length - EVENTS_MAX);
  for (const raw of r.events.slice(0, EVENTS_MAX)) {
    const e = parseEvent(raw);
    if (!e || ids.has(e.id)) {
      dropped++;
      continue;
    }
    ids.add(e.id);
    events.push(e);
  }
  return { events, dropped };
}

export type EventPhase = 'soon' | 'live' | 'ended';

export function eventPhase(e: Pick<SiteEvent, 'from' | 'until'>, now: number): EventPhase {
  if (now < e.from) return 'soon';
  return now < e.until ? 'live' : 'ended';
}

/** 앱 목록에 보일 것: 진행 중과 7일 안에 시작할 것, 끝난 지 3일 안의 것. 진행 중, 곧, 끝남 순, 그 안은 끝나는 때 순 */
export function visibleEvents(list: readonly SiteEvent[], now: number): SiteEvent[] {
  const day = 86_400_000;
  const order: Record<EventPhase, number> = { live: 0, soon: 1, ended: 2 };
  return list
    .filter((e) => e.from - now <= 7 * day && now - e.until <= 3 * day)
    .sort((a, b) => order[eventPhase(a, now)] - order[eventPhase(b, now)] || a.until - b.until);
}

// ---- 날짜 (한국 시간). 배수는 코인 기록의 날짜(앱의 현지 날짜)로 본다 ----

const KST_MS = 9 * 3_600_000;

/** 그 순간의 한국 날짜 YYYY-MM-DD */
export const kstDay = (ms: number): string => new Date(ms + KST_MS).toISOString().slice(0, 10);

/** 한국 시간으로 적은 ISO 글 (예: 2026-10-20T00:00:00+09:00) */
export function kstIso(ms: number): string {
  return `${new Date(ms + KST_MS).toISOString().slice(0, 19)}+09:00`;
}

/**
 * 배수가 걸리는 날 (기록의 날짜 기준, 양 끝 포함): 시작하는 순간의 한국 날짜부터 끝나기 직전의 한국 날짜까지.
 * 오프라인으로 모은 기록도 그날 날짜로 보므로 늦게 보내도 같다
 */
export function boostDays(e: Pick<SiteEvent, 'from' | 'until'>): { first: string; last: string } {
  return { first: kstDay(e.from), last: kstDay(e.until - 1) };
}

// ---- 쿠폰 코드 ----

/** 헷갈리는 글자(0, O, 1, I, L, U)를 뺀 30자. 운영자 화면이 만드는 코드만 받는다 (사람이 고른 쉬운 코드는 추측된다) */
export const COUPON_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
/** 코드 글자 수 (붙임표 빼고). 30^12 ≈ 2^59 */
export const COUPON_LENGTH = 12;

/** 사람이 친 코드를 맞춘다: 대문자로, 빈칸과 붙임표를 뺀다. 모양이 틀리면 undefined (서버에 보내지 않는다) */
export function normalizeCoupon(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || raw.length > 40) return undefined;
  const s = raw.toUpperCase().replace(/[\s-]/g, '');
  if (s.length !== COUPON_LENGTH) return undefined;
  for (const c of s) if (!COUPON_ALPHABET.includes(c)) return undefined;
  return s;
}

/** 보여 줄 모양: XXXX-XXXX-XXXX */
export const formatCoupon = (code: string): string => code.match(/.{1,4}/g)?.join('-') ?? code;
