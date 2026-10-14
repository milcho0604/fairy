// 공지 파일 (docs/server-plan.md 23절, 1.6 단계). 홈페이지 정적 파일 notices.json 을 읽어 앱 자체 공지 창을 띄우고,
// 파일의 minVersion 으로도 강제 업데이트를 건다. 순수 로직만 둔다. 받기와 창은 main/notices.ts, main/notice-window.ts.
import { SITE_URL } from './update-policy.ts';
import { isNewer, parseVersion } from './version.ts';

/** 파일 크기 상한. 넘으면 파일 전체를 읽지 않는다 (아무것도 띄우지 않고 잠그지도 않는다) */
export const NOTICES_MAX_BYTES = 64 * 1024;
/** 앱이 아는 파일 형식 판. 다른 판이면 파일 전체를 읽지 않는다 */
export const NOTICES_FORMAT = 1;
/** 한 파일에서 보는 공지 수 상한 */
export const NOTICES_MAX = 50;
export const NOTICE_TITLE_MAX = 80;
export const NOTICE_BODY_MAX = 1000;

/** 띄우는 순서이기도 하다: 강제, 중요, 권장, 알림 */
export const NOTICE_KINDS = ['force', 'important', 'update', 'info'] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number];
export const NOTICE_PLATFORMS: readonly string[] = ['darwin', 'win32', 'linux'];

export interface NoticeText {
  ko: string;
  en: string;
}

export interface Notice {
  id: string;
  kind: NoticeKind;
  title: NoticeText;
  body: NoticeText;
  /** 허용한 주소만 남는다 (allowedLink). 아니면 없음 */
  link?: string;
  /** 보이기 시작하는 때와 끝나는 때 (밀리초). 없으면 늘 */
  from?: number;
  until?: number;
  /** 대상 버전 (예: "<0.5.0", ">=0.4.0 <0.5.0"). 없으면 모든 버전 */
  versions?: string;
  /** 대상 운영체제. 없거나 비면 모두 */
  platforms?: string[];
}

export interface NoticeFile {
  /** 이보다 낮은 앱은 잠근다. 다만 최신 릴리스 이하일 때만 쓴다 (update-policy.ts pickMinVersion) */
  minVersion?: string;
  /** 이보다 낮은 앱에 업데이트 권장 공지를 띄운다 (잠그지는 않는다) */
  recommendVersion?: string;
  notices: Notice[];
}

/** 공지 파일 주소 (홈페이지 정적 파일, site/notices.json) */
export const NOTICES_URL = `${SITE_URL}/notices.json`;

/**
 * 받을 공지 주소. 시험용 주소(JJ_NOTICES_URL)는 설치판이 아닌 개발 실행에서, 이 컴퓨터 http 주소일 때만 받는다
 * (업데이트 시험의 JJ_RELEASES_API 와 같은 규칙)
 */
export function noticesUrl(override: string | undefined, packaged: boolean): string {
  if (!override || packaged) return NOTICES_URL;
  return /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(override) ? override : NOTICES_URL;
}

const SITE_HOST = new URL(SITE_URL).hostname;
const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const COMPARATOR = /^(<=|>=|<|>|=)?v?(\d{1,4}\.\d{1,4}\.\d{1,4})$/;

/**
 * 공지 링크로 열어도 되는 주소. 홈페이지(fairy.moilga.com)와 github.com/milcho0604 아래만, https, 계정 정보와 포트 없이.
 * 그 밖이면 undefined (링크만 버리고 공지는 남긴다)
 */
export function allowedLink(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || raw.length > 500) return undefined;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return undefined;
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return undefined;
  if (u.hostname === SITE_HOST) return u.href;
  // 경로는 URL 이 ../ 를 풀어 둔 뒤에 본다 (github.com/milcho0604/../남의것 은 /남의것)
  if (u.hostname === 'github.com' && /^\/milcho0604(\/|$)/.test(u.pathname)) return u.href;
  return undefined;
}

/** 글만 남긴다: 줄바꿈 말고 제어 문자는 지우고 앞뒤 빈칸을 깎는다. 비었거나 너무 길면 undefined */
function cleanText(v: unknown, max: number): string | undefined {
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

function readText(v: unknown, max: number): NoticeText | undefined {
  if (typeof v !== 'object' || v === null) return undefined;
  const r = v as Record<string, unknown>;
  const ko = cleanText(r.ko, max);
  const en = cleanText(r.en, max);
  return ko && en ? { ko, en } : undefined;
}

function readTime(v: unknown): number | undefined | null {
  if (v === undefined) return undefined;
  if (typeof v !== 'string') return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
}

type Comparator = { op: '<' | '<=' | '>' | '>=' | '='; version: string };

/** "<0.5.0", ">=0.4.0 <0.5.0", "0.4.3" 처럼 빈칸으로 나눈 비교를 읽는다. 하나라도 못 읽으면 undefined */
export function parseVersionRange(range: string): Comparator[] | undefined {
  const parts = range.trim().split(/\s+/);
  if (!parts[0] || parts.length > 4) return undefined;
  const out: Comparator[] = [];
  for (const p of parts) {
    const m = COMPARATOR.exec(p);
    if (!m?.[2]) return undefined;
    out.push({ op: (m[1] ?? '=') as Comparator['op'], version: m[2] });
  }
  return out;
}

/** 버전이 범위에 드는지 (모든 비교가 맞아야 한다). 범위를 못 읽으면 false */
export function inVersionRange(version: string, range: string): boolean {
  const cs = parseVersionRange(range);
  if (!cs || !parseVersion(version)) return false;
  return cs.every(({ op, version: v }) => {
    const newer = isNewer(version, v);
    const older = isNewer(v, version);
    if (op === '<') return older;
    if (op === '<=') return !newer;
    if (op === '>') return newer;
    if (op === '>=') return !older;
    return !newer && !older;
  });
}

/** 공지 하나를 읽는다. 모르는 kind 이거나 칸이 깨졌으면 undefined (그 공지만 버린다) */
export function parseNotice(v: unknown): Notice | undefined {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return undefined;
  const r = v as Record<string, unknown>;
  if (typeof r.id !== 'string' || !ID.test(r.id)) return undefined;
  if (!(NOTICE_KINDS as readonly unknown[]).includes(r.kind)) return undefined;
  const title = readText(r.title, NOTICE_TITLE_MAX);
  const body = readText(r.body, NOTICE_BODY_MAX);
  if (!title || !body) return undefined;
  const from = readTime(r.from);
  const until = readTime(r.until);
  if (from === null || until === null) return undefined;
  if (from !== undefined && until !== undefined && until <= from) return undefined;
  let versions: string | undefined;
  if (r.versions !== undefined && r.versions !== '') {
    if (typeof r.versions !== 'string' || !parseVersionRange(r.versions)) return undefined;
    versions = r.versions.trim();
  }
  let platforms: string[] | undefined;
  if (r.platforms !== undefined) {
    if (!Array.isArray(r.platforms) || r.platforms.some((p) => !NOTICE_PLATFORMS.includes(p as string)))
      return undefined;
    if (r.platforms.length) platforms = [...new Set(r.platforms as string[])];
  }
  const n: Notice = { id: r.id, kind: r.kind as NoticeKind, title, body };
  const link = allowedLink(r.link);
  if (link) n.link = link;
  if (from !== undefined) n.from = from;
  if (until !== undefined) n.until = until;
  if (versions) n.versions = versions;
  if (platforms) n.platforms = platforms;
  return n;
}

/**
 * 받은 글 전체를 읽는다. 너무 크거나(64KB 넘음), JSON 이 아니거나, 형식 판이 다르거나, notices 가 목록이 아니면
 * undefined: 아무것도 띄우지 않고 잠그지도 않는다. 깨진 공지와 모르는 kind 는 그것만 버린다. 같은 id 는 앞의 것만.
 * minVersion 이 이상한 값이면 없는 것으로 본다 (잠그지 않는 쪽으로).
 */
export function parseNotices(text: unknown): NoticeFile | undefined {
  if (typeof text !== 'string' || text.length > NOTICES_MAX_BYTES) return undefined;
  if (new TextEncoder().encode(text).length > NOTICES_MAX_BYTES) return undefined;
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return undefined;
  const r = json as Record<string, unknown>;
  if (r.version !== NOTICES_FORMAT || !Array.isArray(r.notices)) return undefined;
  const notices: Notice[] = [];
  const ids = new Set<string>();
  for (const raw of r.notices.slice(0, NOTICES_MAX)) {
    const n = parseNotice(raw);
    if (!n || ids.has(n.id)) continue;
    ids.add(n.id);
    notices.push(n);
  }
  const file: NoticeFile = { notices };
  if (typeof r.minVersion === 'string' && VERSION.test(r.minVersion)) file.minVersion = r.minVersion;
  if (typeof r.recommendVersion === 'string' && VERSION.test(r.recommendVersion))
    file.recommendVersion = r.recommendVersion;
  return file;
}

export interface NoticeTarget {
  version: string;
  platform: string;
  now: number;
}

/** 이 앱에 해당하는 공지인지: 기간, 대상 버전, 대상 운영체제 */
export function applies(n: Notice, at: NoticeTarget): boolean {
  if (n.from !== undefined && at.now < n.from) return false;
  if (n.until !== undefined && at.now >= n.until) return false;
  if (n.versions && !inVersionRange(at.version, n.versions)) return false;
  if (n.platforms && !n.platforms.includes(at.platform)) return false;
  return true;
}

/** 본 공지 기록 (사용자 데이터 폴더의 notices-seen.json) */
export interface NoticeSeen {
  /** 끝난 공지: 알림은 띄운 것, 중요는 확인을 누른 것 */
  done: string[];
  /** 권장 공지를 마지막으로 띄운 날 (id 별) */
  shownDay: Record<string, string>;
  /** 알림이나 권장을 마지막으로 띄운 날. 둘을 합쳐 하루 한 번까지 */
  dailyDay?: string;
}

export const SEEN_MAX = 200;

export function readSeen(raw: unknown): NoticeSeen {
  const seen: NoticeSeen = { done: [], shownDay: {} };
  if (typeof raw !== 'object' || raw === null) return seen;
  const r = raw as Record<string, unknown>;
  if (Array.isArray(r.done))
    seen.done = r.done.filter((x): x is string => typeof x === 'string' && ID.test(x)).slice(-SEEN_MAX);
  if (typeof r.shownDay === 'object' && r.shownDay !== null)
    for (const [k, v] of Object.entries(r.shownDay as Record<string, unknown>))
      if (ID.test(k) && typeof v === 'string') seen.shownDay[k] = v;
  if (typeof r.dailyDay === 'string') seen.dailyDay = r.dailyDay;
  return seen;
}

/** 파일에서 사라진 공지의 기록은 지운다. 파일을 제대로 읽었을 때만 부른다 (깨진 파일로 기록을 잃지 않게) */
export function pruneSeen(seen: NoticeSeen, file: NoticeFile): NoticeSeen {
  const ids = new Set(file.notices.map((n) => n.id));
  const shownDay = Object.fromEntries(Object.entries(seen.shownDay).filter(([k]) => ids.has(k)));
  return { ...seen, done: seen.done.filter((id) => ids.has(id)), shownDay };
}

export interface PickContext extends NoticeTarget {
  /** 오늘 (localDay) */
  today: string;
  seen: NoticeSeen;
  /** 이번 실행에서 이미 띄운 공지 (중요는 켤 때마다 한 번) */
  shownThisRun: ReadonlySet<string>;
  /** 업데이트 확인이 새 버전을 찾았는지. 없으면 권장 공지를 띄우지 않는다 (받을 것이 없다) */
  newerAvailable: boolean;
  /** 공지 파일의 권장 버전. 앱이 이보다 낮을 때만 권장 공지를 띄운다. 없으면 권장 공지를 띄우지 않는다 */
  recommendVersion?: string;
  /** 집중 중이면 강제 말고는 끝난 뒤로 미룬다 */
  focusing: boolean;
}

/**
 * 지금 띄울 공지 하나 (강제는 빼고. 강제는 잠금이 정한다, forceNotice).
 * 순서는 중요, 권장, 알림. 알림과 권장은 합쳐 하루 한 번까지. 집중 중에는 아무것도 고르지 않는다.
 */
export function pickNotice(notices: readonly Notice[], ctx: PickContext): Notice | undefined {
  if (ctx.focusing) return undefined;
  const ok = (n: Notice) => !ctx.shownThisRun.has(n.id) && applies(n, ctx);
  const dailyLeft = ctx.seen.dailyDay !== ctx.today;
  const important = notices.find((n) => n.kind === 'important' && ok(n) && !ctx.seen.done.includes(n.id));
  if (important) return important;
  if (!dailyLeft) return undefined;
  const below = !!ctx.recommendVersion && isNewer(ctx.recommendVersion, ctx.version);
  const update =
    ctx.newerAvailable && below
      ? notices.find((n) => n.kind === 'update' && ok(n) && ctx.seen.shownDay[n.id] !== ctx.today)
      : undefined;
  if (update) return update;
  return notices.find((n) => n.kind === 'info' && ok(n) && !ctx.seen.done.includes(n.id));
}

/** 강제 업데이트 창에 쓸 글. 잠겼을 때만 부른다. 해당하는 강제 공지가 없으면 앱의 기본 글을 쓴다 */
export function forceNotice(notices: readonly Notice[], at: NoticeTarget): Notice | undefined {
  return notices.find((n) => n.kind === 'force' && applies(n, at));
}

/** 공지를 띄웠다. 알림은 끝, 권장은 오늘 띄움. 둘 다 하루 한 번 몫을 쓴다. 중요는 확인을 눌러야 끝 (markConfirmed) */
export function markShown(seen: NoticeSeen, n: Notice, today: string): NoticeSeen {
  if (n.kind === 'info')
    return {
      ...seen,
      done: [...seen.done.filter((x) => x !== n.id), n.id].slice(-SEEN_MAX),
      dailyDay: today,
    };
  if (n.kind === 'update') return { ...seen, shownDay: { ...seen.shownDay, [n.id]: today }, dailyDay: today };
  return seen;
}

export function markConfirmed(seen: NoticeSeen, id: string): NoticeSeen {
  return { ...seen, done: [...seen.done.filter((x) => x !== id), id].slice(-SEEN_MAX) };
}

/** 받은 공지 파일 두 번이 같은 최소 버전을 말하는지 (둘 다 없음도 같다). 잠그기 전에 본다 */
export function sameMinVersion(a: NoticeFile | undefined, b: NoticeFile | undefined): boolean {
  return !!a && !!b && a.minVersion === b.minVersion;
}
