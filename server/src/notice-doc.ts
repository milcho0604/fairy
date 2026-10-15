// 운영자 화면에서 고치는 공지 문서 (기획서 23절, 이슈 #101). 모양은 홈페이지 정적 파일 site/notices.json 그대로다.
// 앱의 읽기 규칙(src/shared/notices.ts parseNotices)과 같은 규칙으로 저장 전에 거른다. 앱은 깨진 공지를 그것만 버리므로
// 여기서 거르지 못한 것이 있어도 앱이 잠기지는 않는다. 그래도 Actions 의 마지막 검사(scripts/site/check-feeds.ts)가
// 앱 코드로 한 번 더 읽어 하나라도 버리면 올리지 않는다.

export const NOTICES_FORMAT = 1;
export const NOTICES_MAX = 50;
export const NOTICES_MAX_BYTES = 64 * 1024;
export const NOTICE_TITLE_MAX = 80;
export const NOTICE_BODY_MAX = 1000;
export const NOTICE_KINDS = ['force', 'important', 'update', 'info'] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number];
export const NOTICE_PLATFORMS = ['darwin', 'win32', 'linux'] as const;

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
export const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
const COMPARATOR = /^(<=|>=|<|>|=)?v?(\d{1,4}\.\d{1,4}\.\d{1,4})$/;
const SITE_HOST = 'fairy.moilga.com';

export interface DocNotice {
  id: string;
  kind: NoticeKind;
  title: { ko: string; en: string };
  body: { ko: string; en: string };
  link?: string;
  /** ISO (+09:00) */
  from?: string;
  until?: string;
  versions?: string;
  platforms?: string[];
}

export interface NoticeDoc {
  version: 1;
  minVersion?: string;
  recommendVersion?: string;
  notices: DocNotice[];
}

export const emptyDoc = (): NoticeDoc => ({ version: NOTICES_FORMAT, notices: [] });

/** 저장된 JSON 을 문서로 (모양이 틀린 칸은 버린다) */
export function readDoc(raw: unknown): NoticeDoc {
  const doc = emptyDoc();
  if (typeof raw !== 'object' || raw === null) return doc;
  const r = raw as Record<string, unknown>;
  if (typeof r.minVersion === 'string' && VERSION.test(r.minVersion)) doc.minVersion = r.minVersion;
  if (typeof r.recommendVersion === 'string' && VERSION.test(r.recommendVersion))
    doc.recommendVersion = r.recommendVersion;
  if (Array.isArray(r.notices)) doc.notices = r.notices as DocNotice[];
  return doc;
}

/** 줄바꿈 말고 제어 문자는 지우고 앞뒤 빈칸을 깎는다 (앱 cleanText 와 같다) */
export function cleanText(v: unknown): string {
  if (typeof v !== 'string') return '';
  return [...v.replace(/\r\n?/g, '\n')]
    .filter((c) => {
      const code = c.charCodeAt(0);
      return c === '\n' || (code >= 0x20 && code !== 0x7f);
    })
    .join('')
    .trim();
}

/** 앱이 열어 주는 링크인지 (앱 allowedLink 와 같다). 맞으면 정리한 주소 */
export function allowedLink(raw: string): string | undefined {
  if (raw.length > 500) return undefined;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return undefined;
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return undefined;
  if (u.hostname === SITE_HOST) return u.href;
  if (u.hostname === 'github.com' && /^\/milcho0604(\/|$)/.test(u.pathname)) return u.href;
  return undefined;
}

export function validRange(range: string): boolean {
  const parts = range.trim().split(/\s+/);
  return !!parts[0] && parts.length <= 4 && parts.every((p) => COMPARATOR.test(p));
}

/** 버전 비교 (a 가 b 보다 높으면 1, 같으면 0, 낮으면 -1) */
export function compareVersion(a: string, b: string): number {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

export type FormFields = Record<string, string | undefined>;

/**
 * 운영자 화면의 "datetime-local" 값(한국 시간으로 본다)이나 ISO 글을 밀리초로. 빈 값은 undefined, 못 읽으면 NaN
 */
export function parseKstInput(v: string | undefined): number | undefined {
  const s = (v ?? '').trim();
  if (!s) return undefined;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(s))
    return Date.parse(`${s.length === 16 ? `${s}:00` : s}+09:00`);
  return Date.parse(s);
}

/** 한국 시간 ISO 글 */
export const kstIso = (ms: number): string =>
  `${new Date(ms + 9 * 3_600_000).toISOString().slice(0, 19)}+09:00`;

/** 폼에서 공지 하나를 만든다. 틀리면 까닭 글 (운영자 화면에 보인다) */
export function noticeFromForm(f: FormFields): DocNotice | string {
  const id = (f.id ?? '').trim();
  if (!ID.test(id)) return '공지 id 는 영문, 숫자, ., _, - 로 80자까지';
  const kind = f.kind as NoticeKind;
  if (!NOTICE_KINDS.includes(kind)) return '종류를 고르세요';
  const title = { ko: cleanText(f.title_ko), en: cleanText(f.title_en) };
  const body = { ko: cleanText(f.body_ko), en: cleanText(f.body_en) };
  if (!title.ko || !title.en || title.ko.length > NOTICE_TITLE_MAX || title.en.length > NOTICE_TITLE_MAX)
    return `제목은 ko, en 둘 다 ${NOTICE_TITLE_MAX}자까지`;
  if (!body.ko || !body.en || body.ko.length > NOTICE_BODY_MAX || body.en.length > NOTICE_BODY_MAX)
    return `본문은 ko, en 둘 다 ${NOTICE_BODY_MAX}자까지`;
  const n: DocNotice = { id, kind, title, body };
  const link = (f.link ?? '').trim();
  if (link) {
    const ok = allowedLink(link);
    if (!ok) return '링크는 https://fairy.moilga.com 이나 https://github.com/milcho0604/ 아래만';
    n.link = ok;
  }
  const from = parseKstInput(f.from);
  const until = parseKstInput(f.until);
  if (Number.isNaN(from) || Number.isNaN(until)) return '기간을 읽지 못했어요';
  if (from !== undefined && until !== undefined && until <= from) return '끝이 시작보다 뒤여야 해요';
  if (from !== undefined) n.from = kstIso(from);
  if (until !== undefined) n.until = kstIso(until);
  const versions = (f.versions ?? '').trim();
  if (versions) {
    if (!validRange(versions)) return '대상 버전은 <0.5.0, >=0.4.0 <0.5.0, 0.4.3 처럼';
    n.versions = versions;
  }
  const platforms = (f.platforms ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  if (platforms.some((p) => !(NOTICE_PLATFORMS as readonly string[]).includes(p)))
    return '운영체제 값이 이상해요';
  if (platforms.length > 0 && platforms.length < NOTICE_PLATFORMS.length)
    n.platforms = [...new Set(platforms)];
  return n;
}

/** 문서 전체 검사: 수, 크기, 같은 id */
export function checkDoc(doc: NoticeDoc): string | undefined {
  if (doc.notices.length > NOTICES_MAX) return `공지는 ${NOTICES_MAX}개까지`;
  const ids = new Set<string>();
  for (const n of doc.notices) {
    if (ids.has(n.id)) return `같은 id 가 있어요: ${n.id}`;
    ids.add(n.id);
  }
  if (new TextEncoder().encode(JSON.stringify(doc, null, 2)).length > NOTICES_MAX_BYTES - 1024)
    return '공지 파일이 너무 커요 (64KB)';
  return undefined;
}

/** 내보낼 모양 (칸 순서를 고정해 같은 내용이면 같은 글이 나온다: Actions 가 바뀐 것만 올린다) */
export function exportDoc(doc: NoticeDoc): NoticeDoc {
  const out: NoticeDoc = { version: NOTICES_FORMAT, notices: [] };
  if (doc.minVersion) out.minVersion = doc.minVersion;
  if (doc.recommendVersion) out.recommendVersion = doc.recommendVersion;
  out.notices = doc.notices.map((n) => {
    const o: DocNotice = { id: n.id, kind: n.kind, title: n.title, body: n.body };
    if (n.link) o.link = n.link;
    if (n.from) o.from = n.from;
    if (n.until) o.until = n.until;
    if (n.versions) o.versions = n.versions;
    if (n.platforms) o.platforms = n.platforms;
    return o;
  });
  return out;
}
