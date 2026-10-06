// 캘린더 가져오기 (v2 "구글 캘린더 연동" 읽기). 구글 캘린더 설정의 "iCal 형식의 비공개 주소"나 다른 캘린더의 .ics 주소를 읽는다.
// 쓰기(펫에서 구글 일정 만들기)는 OAuth 앱 등록이 필요해 아직이다.
import { t } from './i18n/index.ts';

export interface IcsEvent {
  uid: string;
  title: string;
  /** ms. 종일 일정은 현지 0시 */
  startAt: number;
  endAt: number | null;
  allDay: boolean;
}

/** 접힌 줄(다음 줄이 공백으로 시작)을 펴고, 줄 끝 CR 을 지운다 */
function unfold(text: string): string[] {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\n[ \t]/g, '')
    .split('\n');
}

function unescapeText(v: string): string {
  return v
    .replace(/\\n/gi, ' ')
    .replace(/\\([,;\\])/g, '$1')
    .trim();
}

/** tz 의 그 벽시계 시각이 UTC 로 언제인지. Intl 로 오프셋을 구해 두 번 맞춘다 (서머타임 경계 포함) */
export function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, tz: string): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const offset = (t: number) => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(new Date(t));
    const get = (k: string) => Number(parts.find((p) => p.type === k)?.value);
    return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute')) - t;
  };
  try {
    const first = guess - offset(guess);
    return guess - offset(first);
  } catch {
    return guess; // 모르는 시간대면 UTC 로 본다
  }
}

/** DTSTART;TZID=Asia/Seoul:20261007T150000 → ms. localTz 는 시간대가 없는 "떠 있는" 시각을 읽을 시간대 */
function parseDate(
  params: string,
  value: string,
  localTz: string,
): { at: number; allDay: boolean } | undefined {
  const date = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (date || /VALUE=DATE(?!-)/.test(params)) {
    const m = date ?? /^(\d{4})(\d{2})(\d{2})/.exec(value);
    if (!m) return undefined;
    return { at: zonedToUtc(Number(m[1]), Number(m[2]), Number(m[3]), 0, 0, localTz), allDay: true };
  }
  const t = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(value);
  if (!t) return undefined;
  const [y, mo, d, h, mi] = [t[1], t[2], t[3], t[4], t[5]].map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  if (t[7] === 'Z') return { at: Date.UTC(y, mo - 1, d, h, mi), allDay: false };
  const tz = /TZID=([^;:]+)/.exec(params)?.[1]?.replace(/^"|"$/g, '') ?? localTz;
  return { at: zonedToUtc(y, mo, d, h, mi, tz), allDay: false };
}

/**
 * .ics 글에서 일정을 꺼낸다. 반복 규칙(RRULE)은 첫 회만, 취소된 일정은 뺀다.
 * from~to 사이에 시작하는 것만.
 */
export function parseIcs(text: string, localTz: string, from: number, to: number): IcsEvent[] {
  const out: IcsEvent[] = [];
  let cur: Record<string, { params: string; value: string }> | undefined;
  for (const line of unfold(text)) {
    if (line === 'BEGIN:VEVENT') {
      cur = {};
      continue;
    }
    if (line === 'END:VEVENT') {
      const e = cur;
      cur = undefined;
      if (!e?.DTSTART || !e.UID) continue;
      if (e.STATUS?.value === 'CANCELLED') continue;
      const start = parseDate(e.DTSTART.params, e.DTSTART.value, localTz);
      if (!start || start.at < from || start.at >= to) continue;
      const end = e.DTEND ? parseDate(e.DTEND.params, e.DTEND.value, localTz) : undefined;
      out.push({
        uid: e.UID.value.slice(0, 200),
        title:
          unescapeText(e.SUMMARY?.value ?? t('panel.event.untitled')).slice(0, 200) ||
          t('panel.event.untitled'),
        startAt: start.at,
        endAt: end && !start.allDay ? end.at : null,
        allDay: start.allDay,
      });
      continue;
    }
    if (!cur) continue;
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const head = line.slice(0, colon);
    const [name = '', ...params] = head.split(';');
    cur[name.toUpperCase()] = { params: params.join(';'), value: line.slice(colon + 1) };
  }
  return out.sort((a, b) => a.startAt - b.startAt);
}

/** 캘린더 주소 검사: https 만, webcal 은 https 로 */
export function cleanIcsUrl(raw: string): string | undefined {
  const v = raw.trim().replace(/^webcal:\/\//i, 'https://');
  try {
    const u = new URL(v);
    return u.protocol === 'https:' ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}
