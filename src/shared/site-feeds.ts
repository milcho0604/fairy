// 홈페이지 정적 파일 두 개(site/events.json, site/notices.json)를 올리기 전의 엄격한 검사 (이슈 #101).
// 서버가 내보낸 글(GET /v1/events.json, /v1/notices.json)을 앱이 실제로 쓰는 읽기 코드로 읽어 보고, 하나라도 버리는 것이
// 있으면 올리지 않는다. 앱은 깨진 것을 그것만 버려 잠기지 않지만, 운영자가 만든 것이 조용히 사라지지 않게 여기서 막는다.
// 공개 레포 Actions(.github/workflows/site-feeds.yml)의 scripts/site-feeds.mjs 가 부른다.
import { NOTICES_MAX, NOTICES_MAX_BYTES, parseNotices } from './notices.ts';
import { EVENTS_MAX, EVENTS_MAX_BYTES, parseEvents } from './site-events.ts';

export type FeedName = 'events' | 'notices';

/** 올려도 되면 정리한 글(2칸 들여쓰기, 끝 줄바꿈), 아니면 까닭 */
export type FeedCheck = { ok: true; text: string } | { ok: false; error: string };

function rawObject(text: string): Record<string, unknown> | undefined {
  try {
    const v = JSON.parse(text) as unknown;
    return typeof v === 'object' && v !== null && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/** 이벤트 목록 검사: 앱의 parseEvents 가 하나도 버리지 않아야 한다 */
export function checkEvents(text: string): FeedCheck {
  const raw = rawObject(text);
  if (!raw) return { ok: false, error: 'events: JSON 객체가 아님' };
  const pretty = `${JSON.stringify(raw, null, 2)}\n`;
  if (new TextEncoder().encode(pretty).length > EVENTS_MAX_BYTES)
    return { ok: false, error: 'events: 64KB 넘음' };
  const list = Array.isArray(raw.events) ? raw.events : undefined;
  if (!list) return { ok: false, error: 'events: events 목록이 없음' };
  if (list.length > EVENTS_MAX) return { ok: false, error: `events: ${EVENTS_MAX}개 넘음` };
  const parsed = parseEvents(pretty);
  if (!parsed) return { ok: false, error: 'events: 앱이 파일을 읽지 못함 (형식 판 등)' };
  if (parsed.dropped > 0 || parsed.events.length !== list.length)
    return { ok: false, error: `events: 앱이 ${list.length - parsed.events.length}개를 버림` };
  return { ok: true, text: pretty };
}

/** 공지 검사: 앱의 parseNotices 가 공지와 버전을 하나도 버리지 않아야 한다 */
export function checkNotices(text: string): FeedCheck {
  const raw = rawObject(text);
  if (!raw) return { ok: false, error: 'notices: JSON 객체가 아님' };
  const pretty = `${JSON.stringify(raw, null, 2)}\n`;
  if (new TextEncoder().encode(pretty).length > NOTICES_MAX_BYTES)
    return { ok: false, error: 'notices: 64KB 넘음' };
  const list = Array.isArray(raw.notices) ? raw.notices : undefined;
  if (!list) return { ok: false, error: 'notices: notices 목록이 없음' };
  if (list.length > NOTICES_MAX) return { ok: false, error: `notices: ${NOTICES_MAX}개 넘음` };
  const parsed = parseNotices(pretty);
  if (!parsed) return { ok: false, error: 'notices: 앱이 파일을 읽지 못함 (형식 판 등)' };
  if (parsed.notices.length !== list.length)
    return { ok: false, error: `notices: 앱이 ${list.length - parsed.notices.length}개를 버림` };
  for (const k of ['minVersion', 'recommendVersion'] as const)
    if (raw[k] !== undefined && parsed[k] !== raw[k])
      return { ok: false, error: `notices: ${k} 를 읽지 못함` };
  // 링크는 앱이 그것만 버리고 공지는 남긴다. 운영자가 넣은 링크가 사라지지 않게 같이 본다
  for (const [i, n] of list.entries()) {
    const link = (n as { link?: unknown }).link;
    if (link !== undefined && parsed.notices[i]?.link === undefined)
      return { ok: false, error: `notices: ${i}번째 공지의 링크를 앱이 버림` };
  }
  return { ok: true, text: pretty };
}

export const checkFeed = (name: FeedName, text: string): FeedCheck =>
  name === 'events' ? checkEvents(text) : checkNotices(text);
