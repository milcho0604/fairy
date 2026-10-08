// 글 속 주소(링크). 채팅 답의 주소를 누를 수 있게 나누고, 일정 제목 속 회의 주소(Zoom, Meet, Teams 등)를 찾는다.
// 여는 것은 메인이 기본 브라우저로 한다(shell.openExternal). 그 전에 safeExternalUrl 로 http, https 만 통과시킨다.

/** 주소로 읽는 글자: 영문, 숫자, 주소에 쓰는 기호. 한글이 붙으면 거기서 끊는다 ("https://zoom.us/j/1에서") */
const URL_RE = /https?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+/g;

/** 주소 끝에 붙어 문장에 속하는 글자. 괄호는 짝이 안 맞을 때만 뗀다 */
const TRAILING = /[.,!?;:'"]$/;

/** 주소로 연다고 할 최대 길이 (그보다 길면 글로 둔다) */
const MAX_URL = 2048;

export type LinkPart = { text: string } | { url: string; text: string };

/** 끝의 문장 부호와 짝 없는 닫는 괄호를 뗀다. 위키 주소처럼 괄호 짝이 맞으면 둔다 */
function trimTail(url: string): string {
  let u = url;
  for (;;) {
    if (TRAILING.test(u)) {
      u = u.slice(0, -1);
      continue;
    }
    const close = u.at(-1);
    const open = close === ')' ? '(' : close === ']' ? '[' : undefined;
    if (open && [...u].filter((c) => c === close).length > [...u].filter((c) => c === open).length) {
      u = u.slice(0, -1);
      continue;
    }
    return u;
  }
}

/** 글을 주소와 나머지로 나눈다. 주소가 없으면 글 한 조각 */
export function splitLinks(text: string): LinkPart[] {
  const out: LinkPart[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const raw = m[0];
    const url = trimTail(raw);
    const at = m.index ?? 0;
    // "https://" 만 있거나 너무 긴 것은 글로 둔다
    if (url.length <= 'https://'.length || url.length > MAX_URL || !safeExternalUrl(url)) continue;
    if (at > last) out.push({ text: text.slice(last, at) });
    out.push({ url, text: url });
    last = at + url.length;
  }
  if (last < text.length || out.length === 0) out.push({ text: text.slice(last) });
  return out;
}

/**
 * 밖에서 열어도 되는 주소면 다듬은 주소, 아니면 undefined. http, https 만, 주소 속 아이디와 비밀번호는 안 된다
 * (https://good.com@evil.com 처럼 보이는 곳과 가는 곳이 다른 주소). 메인이 열기 직전에 다시 부른다
 */
export function safeExternalUrl(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || raw.length > MAX_URL) return undefined;
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return undefined;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return undefined;
  if (u.username || u.password || !u.hostname) return undefined;
  return u.href;
}

/** 회의 서비스 주소 (호스트 끝). 이것이면 "회의 열기", 아니면 "링크 열기" */
const MEETING_HOSTS = [
  'zoom.us',
  'zoom.com',
  'meet.google.com',
  'teams.microsoft.com',
  'teams.live.com',
  'webex.com',
  'whereby.com',
  'meet.jit.si',
  'gotomeeting.com',
  'chime.aws',
  'around.co',
  'meet.naver.com',
  'zep.us',
  'gather.town',
];

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/** 회의 서비스 이름이 되는 호스트 ("us02web.zoom.us" → "zoom.us"). 회의 주소가 아니면 undefined */
function meetingHost(url: string): string | undefined {
  const host = hostOf(url);
  return MEETING_HOSTS.find((h) => host === h || host.endsWith(`.${h}`));
}

export function isMeetingUrl(url: string): boolean {
  return meetingHost(url) !== undefined;
}

/** 일정 제목 속 주소: 회의 주소가 있으면 그것, 없으면 첫 주소. 없으면 undefined */
export function eventLink(title: string): { url: string; meeting: boolean } | undefined {
  const urls = splitLinks(title).flatMap((p) => ('url' in p ? [p.url] : []));
  const meeting = urls.find(isMeetingUrl);
  if (meeting) return { url: meeting, meeting: true };
  const first = urls[0];
  return first ? { url: first, meeting: false } : undefined;
}

/**
 * 말풍선에 보일 제목: 긴 주소는 호스트만 남긴다. 회의 주소는 서비스 이름으로
 * ("회의 https://us02web.zoom.us/j/123?pwd=..." → "회의 zoom.us"). 비밀번호가 붙은 주소가 말풍선과 놓친 알림에 그대로 보이지 않게
 */
export function shortLinks(text: string): string {
  return splitLinks(text)
    .map((p) =>
      'url' in p ? (meetingHost(p.url) ?? (hostOf(p.url).replace(/^www\./, '') || p.text)) : p.text,
    )
    .join('');
}
