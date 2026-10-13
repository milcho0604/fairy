// 구글 캘린더 읽어 오기 (이슈 #54): 고른 캘린더의 원래 일정을 페어리 일정으로 보인다.
// 여기는 순수한 것만: 읽을 범위, 목록 주소, 구글 일정 → 페어리 일정 바꾸기. 네트워크는 main/gcal-pull.ts.
// 가져온 일정은 페어리에서 읽기 전용이다 (구글로 되돌려 쓰지 않는다. 알림과 고정만 페어리 것).
import { plusDays } from './day.ts';
import { dayStartMs } from './event-store.ts';
import { GCAL_ID_PREFIX } from './gcal.ts';

const DAY_MS = 86_400_000;
/** 읽을 범위: 지난 7일부터 앞으로 60일까지 */
export const PULL_BACK_DAYS = 7;
export const PULL_AHEAD_DAYS = 60;
/** 한 쪽에 받을 수 (구글 상한 2500, 기본 250) */
export const PULL_PAGE = 250;
/** 쪽 상한. 넘으면 이번에는 지우기를 하지 않는다 (덜 읽은 채로 "없어졌다"고 보면 안 된다) */
export const PULL_MAX_PAGES = 20;
/**
 * 받을 칸만 (fields). 제목, 시각, 상태, 짝꿍 표시뿐: 설명, 장소, 참석자, 첨부는 받지 않는다 (개인정보처리방침과 같다).
 * 대답도 작아져 한 쪽이 1MB 상한(gcal-auth readJson)을 넘지 않는다
 */
export const PULL_FIELDS =
  'items(id,iCalUID,status,summary,start,end,extendedProperties/private/jjakkung),nextPageToken';

export function pullWindow(now: number): { from: number; to: number } {
  return { from: now - PULL_BACK_DAYS * DAY_MS, to: now + PULL_AHEAD_DAYS * DAY_MS };
}

/**
 * events.list 경로. 반복 일정은 회차마다 펼쳐 받고(singleEvents), 지운 일정은 받지 않는다(showDeleted=false):
 * 범위를 통째로 다시 읽어 "범위 안인데 이번에 없는 것"을 지운 것으로 맞춘다 (EventStore.syncExternal)
 */
export function listPath(calendarId: string, w: { from: number; to: number }, pageToken?: string): string {
  const q = new URLSearchParams({
    timeMin: new Date(w.from).toISOString(),
    timeMax: new Date(w.to).toISOString(),
    singleEvents: 'true',
    showDeleted: 'false',
    maxResults: String(PULL_PAGE),
    fields: PULL_FIELDS,
  });
  if (pageToken) q.set('pageToken', pageToken);
  return `/calendars/${encodeURIComponent(calendarId)}/events?${q.toString()}`;
}

/** 페어리 일정으로 바꾼 구글 일정 (EventStore.syncExternal 이 받는 모양) */
export interface PulledEvent {
  /** 구글 일정 id (반복 일정 회차는 id_날짜 꼴). 저장 키 */
  uid: string;
  /** iCalUID: 캘린더 가져오기(.ics)와 겹침을 거른다 */
  icalUid: string | null;
  title: string;
  startAt: number;
  endAt: number | null;
  allDay: boolean;
}

/** 페어리가 보낸 일정인지 (짝꿍 표시, 또는 페어리가 정한 id 이고 우리 기록에 있음) */
export function isFromFairy(item: unknown, ours?: ReadonlySet<string>): boolean {
  const v = item as {
    id?: unknown;
    iCalUID?: unknown;
    extendedProperties?: { private?: { jjakkung?: unknown } };
  };
  if (v?.extendedProperties?.private?.jjakkung === '1') return true;
  if (!ours) return false;
  if (typeof v?.id === 'string' && v.id.startsWith(GCAL_ID_PREFIX) && ours.has(`${v.id}@google.com`))
    return true;
  return typeof v?.iCalUID === 'string' && ours.has(v.iCalUID);
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 구글 일정 하나 → 페어리 일정. 못 쓰는 것(취소됨, 시각이 없음)은 undefined.
 * - 시각 일정: dateTime 은 시간대 차가 붙은 RFC3339 라 그 순간 그대로. 끝이 시작보다 이르거나 같으면 끝 없음
 * - 종일 일정: date 는 그 날짜. 이 컴퓨터 시간대의 그날 0시로 둔다(페어리 종일 일정과 같다). 끝 날은 들지 않으며 하루짜리는 끝 없음
 * 제목이 없으면(비공개 일정 등) untitled 를 쓴다
 */
export function fromGoogle(item: unknown, untitled: string): PulledEvent | undefined {
  const v = item as {
    id?: unknown;
    iCalUID?: unknown;
    status?: unknown;
    summary?: unknown;
    start?: { date?: unknown; dateTime?: unknown };
    end?: { date?: unknown; dateTime?: unknown };
  };
  if (!v || typeof v.id !== 'string' || !v.id || v.id.length > 1024) return undefined;
  if (v.status === 'cancelled') return undefined;
  const title = typeof v.summary === 'string' && v.summary.trim() ? v.summary.trim().slice(0, 200) : untitled;
  const icalUid = typeof v.iCalUID === 'string' && v.iCalUID.length <= 1024 ? v.iCalUID : null;
  const s = v.start ?? {};
  const e = v.end ?? {};
  if (typeof s.date === 'string' && DATE.test(s.date)) {
    const first = s.date;
    const after = typeof e.date === 'string' && DATE.test(e.date) && e.date > first ? e.date : undefined;
    const startAt = dayStartMs(first);
    if (!Number.isFinite(startAt)) return undefined;
    return {
      uid: v.id,
      icalUid,
      title,
      startAt,
      endAt: after && after !== plusDays(first, 1) ? dayStartMs(after) : null,
      allDay: true,
    };
  }
  const startAt = typeof s.dateTime === 'string' ? Date.parse(s.dateTime) : Number.NaN;
  if (!Number.isFinite(startAt)) return undefined;
  const endRaw = typeof e.dateTime === 'string' ? Date.parse(e.dateTime) : Number.NaN;
  return {
    uid: v.id,
    icalUid,
    title,
    startAt,
    endAt: Number.isFinite(endRaw) && endRaw > startAt ? endRaw : null,
    allDay: false,
  };
}
