// 캘린더 가져오기 (v2 "구글 캘린더 연동" 읽기). 구글 캘린더 설정의 "iCal 형식의 비공개 주소"나 다른 캘린더의 .ics 주소를 읽는다.
// 쓰기(펫에서 구글 일정 만들기)는 OAuth 앱 등록이 필요해 아직이다.
import { t } from './i18n/index.ts';

export interface IcsEvent {
  uid: string;
  /**
   * 반복 일정의 회차 표시: 그 회차가 원래 시작하기로 한 때. 시각이 있으면 UTC 'YYYYMMDDTHHMMSSZ', 종일이면 'YYYYMMDD'.
   * 한 번뿐인 일정은 null. uid 와 같이 저장 키가 된다 (같은 UID 의 회차들이 한 행을 서로 덮지 않게)
   */
  recurrenceId: string | null;
  title: string;
  /** ms. 종일 일정은 현지 0시 */
  startAt: number;
  /** 종일 일정은 여러 날일 때만 마지막 날 다음 날 0시, 하루면 null */
  endAt: number | null;
  allDay: boolean;
}

const DAY_MS = 86_400_000;

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

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatterOf(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    formatters.set(tz, f);
  }
  return f;
}

/** tz 의 그 벽시계 시각이 UTC 로 언제인지. Intl 로 오프셋을 구해 두 번 맞춘다 (서머타임 경계 포함) */
export function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, tz: string): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const offset = (t: number) => {
    const parts = formatterOf(tz).formatToParts(new Date(t));
    const get = (k: string) => Number(parts.find((p) => p.type === k)?.value);
    return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute')) - t;
  };
  try {
    const first = guess - offset(guess);
    return guess - offset(first);
  } catch {
    return guess; // 모르는 시간대면 UTC 로 본다 (읽는 쪽은 resolveTz 로 먼저 거른다)
  }
}

// ---- 시간대 이름 ----

/**
 * 윈도우(Outlook, Exchange) 시간대 이름 → IANA. CLDR windowsZones 의 대표값(001).
 * 아웃룩에서 내보낸 .ics 는 TZID=Korea Standard Time 처럼 이 이름을 쓴다.
 */
export const WINDOWS_ZONES: Readonly<Record<string, string>> = {
  'Dateline Standard Time': 'Etc/GMT+12',
  'UTC-11': 'Etc/GMT+11',
  'Hawaiian Standard Time': 'Pacific/Honolulu',
  'Alaskan Standard Time': 'America/Anchorage',
  'Pacific Standard Time': 'America/Los_Angeles',
  'Pacific Standard Time (Mexico)': 'America/Tijuana',
  'US Mountain Standard Time': 'America/Phoenix',
  'Mountain Standard Time': 'America/Denver',
  'Central America Standard Time': 'America/Guatemala',
  'Central Standard Time': 'America/Chicago',
  'Central Standard Time (Mexico)': 'America/Mexico_City',
  'Canada Central Standard Time': 'America/Regina',
  'SA Pacific Standard Time': 'America/Bogota',
  'Eastern Standard Time': 'America/New_York',
  'US Eastern Standard Time': 'America/Indiana/Indianapolis',
  'Venezuela Standard Time': 'America/Caracas',
  'Atlantic Standard Time': 'America/Halifax',
  'SA Western Standard Time': 'America/La_Paz',
  'Pacific SA Standard Time': 'America/Santiago',
  'Newfoundland Standard Time': 'America/St_Johns',
  'E. South America Standard Time': 'America/Sao_Paulo',
  'Argentina Standard Time': 'America/Argentina/Buenos_Aires',
  'SA Eastern Standard Time': 'America/Cayenne',
  'Azores Standard Time': 'Atlantic/Azores',
  'Cape Verde Standard Time': 'Atlantic/Cape_Verde',
  UTC: 'Etc/UTC',
  'GMT Standard Time': 'Europe/London',
  'Greenwich Standard Time': 'Atlantic/Reykjavik',
  'Morocco Standard Time': 'Africa/Casablanca',
  'W. Europe Standard Time': 'Europe/Berlin',
  'Central Europe Standard Time': 'Europe/Budapest',
  'Romance Standard Time': 'Europe/Paris',
  'Central European Standard Time': 'Europe/Warsaw',
  'W. Central Africa Standard Time': 'Africa/Lagos',
  'GTB Standard Time': 'Europe/Bucharest',
  'E. Europe Standard Time': 'Europe/Chisinau',
  'FLE Standard Time': 'Europe/Kiev',
  'Middle East Standard Time': 'Asia/Beirut',
  'Egypt Standard Time': 'Africa/Cairo',
  'South Africa Standard Time': 'Africa/Johannesburg',
  'Israel Standard Time': 'Asia/Jerusalem',
  'Jordan Standard Time': 'Asia/Amman',
  'Syria Standard Time': 'Asia/Damascus',
  'Turkey Standard Time': 'Europe/Istanbul',
  'Belarus Standard Time': 'Europe/Minsk',
  'Arabic Standard Time': 'Asia/Baghdad',
  'Arab Standard Time': 'Asia/Riyadh',
  'E. Africa Standard Time': 'Africa/Nairobi',
  'Russian Standard Time': 'Europe/Moscow',
  'Iran Standard Time': 'Asia/Tehran',
  'Arabian Standard Time': 'Asia/Dubai',
  'Azerbaijan Standard Time': 'Asia/Baku',
  'Georgian Standard Time': 'Asia/Tbilisi',
  'Caucasus Standard Time': 'Asia/Yerevan',
  'Afghanistan Standard Time': 'Asia/Kabul',
  'Ekaterinburg Standard Time': 'Asia/Yekaterinburg',
  'Pakistan Standard Time': 'Asia/Karachi',
  'West Asia Standard Time': 'Asia/Tashkent',
  'India Standard Time': 'Asia/Kolkata',
  'Sri Lanka Standard Time': 'Asia/Colombo',
  'Nepal Standard Time': 'Asia/Kathmandu',
  'Central Asia Standard Time': 'Asia/Almaty',
  'Bangladesh Standard Time': 'Asia/Dhaka',
  'Myanmar Standard Time': 'Asia/Yangon',
  'SE Asia Standard Time': 'Asia/Bangkok',
  'N. Central Asia Standard Time': 'Asia/Novosibirsk',
  'North Asia Standard Time': 'Asia/Krasnoyarsk',
  'China Standard Time': 'Asia/Shanghai',
  'North Asia East Standard Time': 'Asia/Irkutsk',
  'Singapore Standard Time': 'Asia/Singapore',
  'W. Australia Standard Time': 'Australia/Perth',
  'Taipei Standard Time': 'Asia/Taipei',
  'Ulaanbaatar Standard Time': 'Asia/Ulaanbaatar',
  'Tokyo Standard Time': 'Asia/Tokyo',
  'Korea Standard Time': 'Asia/Seoul',
  'North Korea Standard Time': 'Asia/Pyongyang',
  'Yakutsk Standard Time': 'Asia/Yakutsk',
  'Cen. Australia Standard Time': 'Australia/Adelaide',
  'AUS Central Standard Time': 'Australia/Darwin',
  'E. Australia Standard Time': 'Australia/Brisbane',
  'AUS Eastern Standard Time': 'Australia/Sydney',
  'West Pacific Standard Time': 'Pacific/Port_Moresby',
  'Tasmania Standard Time': 'Australia/Hobart',
  'Vladivostok Standard Time': 'Asia/Vladivostok',
  'Central Pacific Standard Time': 'Pacific/Guadalcanal',
  'New Zealand Standard Time': 'Pacific/Auckland',
  'Fiji Standard Time': 'Pacific/Fiji',
  'Tonga Standard Time': 'Pacific/Tongatapu',
};

const knownTz = new Map<string, boolean>();
function isTimeZone(name: string): boolean {
  let ok = knownTz.get(name);
  if (ok === undefined) {
    try {
      formatterOf(name);
      ok = true;
    } catch {
      ok = false;
    }
    knownTz.set(name, ok);
  }
  return ok;
}

/**
 * TZID 를 Intl 이 아는 시간대로. IANA 이름은 그대로, 윈도우 이름은 표로, "/mozilla.org/.../Asia/Seoul" 처럼 끝에
 * IANA 이름이 붙은 것은 그 이름으로, "(UTC+09:00) Seoul" 처럼 정시 오프셋만 있으면 Etc/GMT 로.
 * 그래도 모르면 UTC 가 아니라 사용자 시간대로 본다 (회사 캘린더는 대개 같은 시간대라 덜 틀린다).
 */
export function resolveTz(tzid: string, localTz: string): string {
  const name = tzid.trim();
  if (!name) return localTz;
  const win = WINDOWS_ZONES[name];
  if (win && isTimeZone(win)) return win;
  if (isTimeZone(name)) return name;
  const tail = /([A-Za-z]+\/[A-Za-z0-9_+-]+(?:\/[A-Za-z0-9_+-]+)?)$/.exec(name)?.[1];
  if (tail && isTimeZone(tail)) return tail;
  const off = /^\((?:UTC|GMT)([+-])(\d{1,2}):00\)/i.exec(name);
  if (off) {
    const h = Number(off[2]);
    if (h === 0) return 'Etc/UTC';
    // Etc/GMT 는 부호가 거꾸로다 (UTC+9 = Etc/GMT-9)
    const etc = `Etc/GMT${off[1] === '+' ? '-' : '+'}${h}`;
    if (isTimeZone(etc)) return etc;
  }
  if (/^\((?:UTC|GMT)\)/i.test(name)) return 'Etc/UTC';
  return localTz;
}

// ---- 줄과 속성 ----

interface Prop {
  params: string;
  value: string;
}
/** VEVENT 하나의 속성. 같은 이름이 여러 번 나올 수 있다 (EXDATE) */
type Comp = Record<string, Prop[]>;

/** 따옴표 안의 콜론, 세미콜론은 나누지 않는다 (TZID="(UTC+09:00) Seoul") */
function splitOutsideQuotes(s: string, sep: string, once: boolean): string[] {
  const out: string[] = [];
  let q = false;
  let startAt = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') q = !q;
    else if (c === sep && !q) {
      out.push(s.slice(startAt, i));
      startAt = i + 1;
      if (once) break;
    }
  }
  out.push(s.slice(startAt));
  return out;
}

function paramOf(params: string, key: string): string | undefined {
  for (const p of splitOutsideQuotes(params, ';', false)) {
    const eq = p.indexOf('=');
    if (eq > 0 && p.slice(0, eq).trim().toUpperCase() === key) return p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return undefined;
}

/**
 * VEVENT 들을 꺼낸다. BEGIN/END 깊이를 세어 VEVENT 바로 아래 줄만 읽는다:
 * 안에 든 VALARM 의 SUMMARY, UID, DESCRIPTION 이 일정 값을 덮지 않게.
 */
function events(text: string): Comp[] {
  const out: Comp[] = [];
  const stack: string[] = [];
  let cur: Comp | undefined;
  for (const raw of unfold(text)) {
    const line = raw.trimEnd();
    const begin = /^BEGIN:(.+)$/i.exec(line);
    if (begin) {
      const name = (begin[1] ?? '').trim().toUpperCase();
      stack.push(name);
      if (name === 'VEVENT') cur = {};
      continue;
    }
    const end = /^END:(.+)$/i.exec(line);
    if (end) {
      const name = (end[1] ?? '').trim().toUpperCase();
      const at = stack.lastIndexOf(name);
      if (at >= 0) stack.length = at; // 짝이 안 맞아도 그 묶음까지 닫는다
      if (name === 'VEVENT' && cur) {
        out.push(cur);
        cur = undefined;
      }
      continue;
    }
    if (!cur || stack[stack.length - 1] !== 'VEVENT') continue;
    const [head = '', value] = splitOutsideQuotes(line, ':', true);
    if (value === undefined) continue;
    const [name = '', ...params] = splitOutsideQuotes(head, ';', false);
    const key = name.toUpperCase();
    const list = cur[key] ?? [];
    list.push({ params: params.join(';'), value });
    cur[key] = list;
  }
  return out;
}

const one = (c: Comp, key: string): Prop | undefined => c[key]?.[0];

// ---- 날짜 ----

/** 벽시계 시각과 그 시간대. 종일이면 시각은 0 */
interface When {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  s: number;
  allDay: boolean;
  /** 'UTC' 또는 IANA 이름 */
  tz: string;
}

/** DTSTART;TZID=Asia/Seoul:20261007T150000 → 벽시계 시각. localTz 는 시간대가 없는 "떠 있는" 시각과 종일 일정을 읽을 시간대 */
function readWhen(params: string, value: string, localTz: string): When | undefined {
  const v = value.trim();
  const date = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (date || /VALUE=DATE(?!-)/i.test(params)) {
    const m = date ?? /^(\d{4})(\d{2})(\d{2})/.exec(v);
    if (!m) return undefined;
    return {
      y: Number(m[1]),
      mo: Number(m[2]),
      d: Number(m[3]),
      h: 0,
      mi: 0,
      s: 0,
      allDay: true,
      tz: localTz,
    };
  }
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/i.exec(v);
  if (!m) return undefined;
  const tzid = paramOf(params, 'TZID');
  const tz = m[7] ? 'UTC' : tzid ? resolveTz(tzid, localTz) : localTz;
  return {
    y: Number(m[1]),
    mo: Number(m[2]),
    d: Number(m[3]),
    h: Number(m[4]),
    mi: Number(m[5]),
    s: Number(m[6]),
    allDay: false,
    tz,
  };
}

function toMs(w: When): number {
  const base =
    w.tz === 'UTC' ? Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi) : zonedToUtc(w.y, w.mo, w.d, w.h, w.mi, w.tz);
  return base + w.s * 1000;
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');
const dateKey = (y: number, mo: number, d: number) => `${pad(y, 4)}${pad(mo)}${pad(d)}`;

/** 회차 키: 종일이면 벽시계 날짜, 아니면 UTC 시각 (TZID 를 다르게 적어도 같은 순간이면 같은 키) */
function occurrenceKey(at: number, w: Pick<When, 'y' | 'mo' | 'd' | 'allDay'>): string {
  if (w.allDay) return dateKey(w.y, w.mo, w.d);
  return `${new Date(at).toISOString().slice(0, 19).replace(/[-:]/g, '')}Z`;
}

/** DURATION:PT1H30M, P1D → ms */
function durationMs(v: string): number | undefined {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i.exec(v.trim());
  if (!m) return undefined;
  const ms =
    (Number(m[2] ?? 0) * 7 + Number(m[3] ?? 0)) * DAY_MS +
    Number(m[4] ?? 0) * 3_600_000 +
    Number(m[5] ?? 0) * 60_000 +
    Number(m[6] ?? 0) * 1000;
  return m[1] === '-' ? -ms : ms;
}

// ---- 반복 규칙 (RRULE) ----

const WEEKDAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
/** 1970-01-01 기준 날 수 (벽시계 날짜) */
const dayNum = (y: number, mo: number, d: number) => Math.floor(Date.UTC(y, mo - 1, d) / DAY_MS);
const weekdayOf = (day: number) => (((day + 4) % 7) + 7) % 7; // 1970-01-01 은 목요일
const daysInMonth = (y: number, mo: number) => new Date(Date.UTC(y, mo, 0)).getUTCDate();
function fromDayNum(day: number): { y: number; mo: number; d: number } {
  const dt = new Date(day * DAY_MS);
  return { y: dt.getUTCFullYear(), mo: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

interface Rule {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  interval: number;
  count?: number;
  until?: number;
  /** n 은 달(또는 해) 안에서 몇째 (음수는 끝에서), 없으면 그 요일 모두 */
  byDay?: { wd: number; n?: number }[];
  byMonthDay?: number[];
  byMonth?: number[];
  wkst: number;
}

/** 모르는 규칙(BYSETPOS, BYWEEKNO, HOURLY 등)이면 undefined: 첫 회만 쓴다 */
function parseRule(value: string, start: When, localTz: string): Rule | undefined {
  const parts = new Map<string, string>();
  for (const p of value.split(';')) {
    const eq = p.indexOf('=');
    if (eq > 0)
      parts.set(
        p.slice(0, eq).trim().toUpperCase(),
        p
          .slice(eq + 1)
          .trim()
          .toUpperCase(),
      );
  }
  const freq = parts.get('FREQ');
  if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY' && freq !== 'YEARLY') return undefined;
  for (const k of ['BYSETPOS', 'BYWEEKNO', 'BYYEARDAY', 'BYHOUR', 'BYMINUTE', 'BYSECOND'])
    if (parts.has(k)) return undefined;
  const ints = (k: string) =>
    parts
      .get(k)
      ?.split(',')
      .map(Number)
      .filter((n) => Number.isInteger(n) && n !== 0);
  const interval = Number(parts.get('INTERVAL') ?? 1);
  const rule: Rule = {
    freq,
    interval: Number.isInteger(interval) && interval > 0 ? interval : 1,
    wkst: Math.max(0, WEEKDAY_CODES.indexOf(parts.get('WKST') ?? 'MO')),
  };
  const count = Number(parts.get('COUNT'));
  if (parts.has('COUNT') && Number.isInteger(count) && count > 0) rule.count = count;
  const until = parts.get('UNTIL');
  if (until) {
    const w = readWhen('', until, start.tz === 'UTC' ? localTz : start.tz);
    if (!w) return undefined;
    // 날짜만이면 그날 끝까지, 시각이 Z 가 아니면 일정의 시간대로 읽는다
    if (w.allDay) {
      const next = fromDayNum(dayNum(w.y, w.mo, w.d) + 1);
      rule.until = toMs({ ...w, ...next, allDay: false, tz: start.allDay ? localTz : start.tz }) - 1;
    } else rule.until = toMs(/Z$/i.test(until) ? { ...w, tz: 'UTC' } : { ...w, tz: start.tz });
  }
  const byDay = parts.get('BYDAY');
  if (byDay) {
    rule.byDay = [];
    for (const code of byDay.split(',')) {
      const m = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/.exec(code.trim());
      if (!m) return undefined;
      const n = m[1] ? Number(m[1]) : undefined;
      rule.byDay.push({ wd: WEEKDAY_CODES.indexOf(m[2] ?? ''), ...(n ? { n } : {}) });
    }
    // 해 안에서 몇째 요일(BYMONTH 없는 YEARLY;BYDAY=20MO)은 안 다룬다
    if (freq === 'YEARLY' && !parts.has('BYMONTH') && rule.byDay.some((b) => b.n)) return undefined;
  }
  const byMonthDay = ints('BYMONTHDAY');
  if (byMonthDay?.length) rule.byMonthDay = byMonthDay.filter((n) => Math.abs(n) <= 31);
  const byMonth = ints('BYMONTH');
  if (byMonth?.length) rule.byMonth = byMonth.filter((n) => n >= 1 && n <= 12);
  return rule;
}

/** 한 달 안에서 규칙에 맞는 날(1~31). 정렬됨 */
function daysOfMonth(rule: Rule, y: number, mo: number, startDay: number): number[] {
  const len = daysInMonth(y, mo);
  let days: number[];
  if (rule.byMonthDay) {
    days = rule.byMonthDay.map((n) => (n > 0 ? n : len + n + 1)).filter((d) => d >= 1 && d <= len);
  } else if (rule.byDay) {
    days = [];
  } else {
    days = startDay <= len ? [startDay] : []; // 31일 반복은 31일이 없는 달을 건너뛴다
  }
  if (rule.byDay) {
    const first = weekdayOf(dayNum(y, mo, 1));
    const fromByDay = new Set<number>();
    for (const b of rule.byDay) {
      const all: number[] = [];
      for (let d = 1 + ((b.wd - first + 7) % 7); d <= len; d += 7) all.push(d);
      if (b.n === undefined) for (const d of all) fromByDay.add(d);
      else {
        const pick = b.n > 0 ? all[b.n - 1] : all[all.length + b.n];
        if (pick !== undefined) fromByDay.add(pick);
      }
    }
    // BYMONTHDAY 와 같이 오면 둘 다 맞는 날만
    days = rule.byMonthDay ? days.filter((d) => fromByDay.has(d)) : [...fromByDay];
  }
  return [...new Set(days)].sort((a, b) => a - b);
}

/** 규칙 하나가 펼칠 수 있는 기간 수와 회차 수 상한 (범위 밖은 넉넉히, 그래도 끝없이 돌지 않게) */
const MAX_PERIODS = 50_000;
const MAX_IN_RANGE = 1000;

/**
 * 반복 일정을 [from, to) 안의 회차로 펼친다. 회차는 시작 벽시계 시각(시간대 기준)을 지켜서
 * 서머타임이 바뀌어도 "매주 화 10시"는 10시다. COUNT 는 범위 밖 회차도 센다 (규칙대로).
 */
function expandRule(
  rule: Rule,
  start: When,
  from: number,
  to: number,
): { at: number; wall: { y: number; mo: number; d: number } }[] {
  const out: { at: number; wall: { y: number; mo: number; d: number } }[] = [];
  const startDay = dayNum(start.y, start.mo, start.d);
  const timeMs = (start.h * 3600 + start.mi * 60 + start.s) * 1000;
  // 시간대 오프셋은 ±14시간 안이라 벽시계를 UTC 로 본 값으로 대강 거르고, 가까운 것만 정확히 바꾼다
  const SLACK = 2 * DAY_MS;
  const fromDay = Math.floor(from / DAY_MS);
  let count = 0;
  let stop = false;

  const visit = (day: number) => {
    if (day < startDay) return;
    count++;
    if (rule.count !== undefined && count > rule.count) {
      stop = true;
      return;
    }
    const approx = day * DAY_MS + timeMs;
    if (approx > to + SLACK) {
      stop = true;
      return;
    }
    if (rule.until !== undefined && approx > rule.until + SLACK) {
      stop = true;
      return;
    }
    if (approx < from - SLACK) return;
    const wall = fromDayNum(day);
    const at = toMs({ ...start, ...wall });
    if (rule.until !== undefined && at > rule.until) {
      stop = true;
      return;
    }
    if (at >= from && at < to) out.push({ at, wall });
    if (out.length >= MAX_IN_RANGE) stop = true;
  };
  const monthOk = (mo: number) => !rule.byMonth || rule.byMonth.includes(mo);

  if (rule.freq === 'DAILY') {
    // COUNT 가 없으면 범위 근처로 건너뛴다 (오래전에 시작한 매일 일정)
    let k = rule.count === undefined ? Math.max(0, Math.floor((fromDay - 3 - startDay) / rule.interval)) : 0;
    for (let i = 0; i < MAX_PERIODS && !stop; i++, k++) {
      const day = startDay + k * rule.interval;
      const w = fromDayNum(day);
      if (!monthOk(w.mo)) continue;
      if (
        rule.byMonthDay &&
        !rule.byMonthDay.some((n) => (n > 0 ? n : daysInMonth(w.y, w.mo) + n + 1) === w.d)
      )
        continue;
      if (rule.byDay && !rule.byDay.some((b) => b.wd === weekdayOf(day))) continue;
      visit(day);
    }
  } else if (rule.freq === 'WEEKLY') {
    const weekStart = startDay - ((weekdayOf(startDay) - rule.wkst + 7) % 7);
    const wds = rule.byDay ? [...new Set(rule.byDay.map((b) => b.wd))] : [weekdayOf(startDay)];
    const offsets = wds.map((wd) => (wd - rule.wkst + 7) % 7).sort((a, b) => a - b);
    const span = 7 * rule.interval;
    let k = rule.count === undefined ? Math.max(0, Math.floor((fromDay - 10 - weekStart) / span)) : 0;
    for (let i = 0; i < MAX_PERIODS && !stop; i++, k++) {
      const ws = weekStart + k * span;
      for (const off of offsets) {
        if (stop) break;
        const day = ws + off;
        if (monthOk(fromDayNum(day).mo)) visit(day);
      }
    }
  } else if (rule.freq === 'MONTHLY') {
    const m0 = start.y * 12 + (start.mo - 1);
    for (let k = 0; k < MAX_PERIODS && !stop; k++) {
      const m = m0 + k * rule.interval;
      const y = Math.floor(m / 12);
      const mo = (m % 12) + 1;
      if (!monthOk(mo)) continue;
      for (const d of daysOfMonth(rule, y, mo, start.d)) {
        if (stop) break;
        visit(dayNum(y, mo, d));
      }
    }
  } else {
    const months = rule.byMonth ? [...rule.byMonth].sort((a, b) => a - b) : [start.mo];
    for (let k = 0; k < MAX_PERIODS && !stop; k++) {
      const y = start.y + k * rule.interval;
      for (const mo of months) {
        if (stop) break;
        // BYMONTH 만 있고 날 규칙이 없으면 시작한 날짜 (2월 29일은 윤년에만)
        for (const d of daysOfMonth(rule, y, mo, start.d)) {
          if (stop) break;
          visit(dayNum(y, mo, d));
        }
      }
    }
  }
  return out;
}

// ---- 꺼내기 ----

function sequenceOf(c: Comp): number {
  const n = Number(one(c, 'SEQUENCE')?.value);
  return Number.isFinite(n) ? n : 0;
}

/** 같은 키가 여러 번 나오면 SEQUENCE 가 큰 것, 같으면 나중 것 */
function better(a: Comp | undefined, b: Comp): Comp {
  return !a || sequenceOf(b) >= sequenceOf(a) ? b : a;
}

const cancelled = (c: Comp) => one(c, 'STATUS')?.value.trim().toUpperCase() === 'CANCELLED';

/**
 * 한 번에 가져오는 일정 수 상한 (이른 것부터). 사람 한 명의 두 달 일정으로는 넉넉하다.
 * 예전에는 상한이 없어 매일 반복 일정 2천 개(180KB)짜리 캘린더가 12만 행을 넣느라 앱이 10초 넘게 멈췄고,
 * 10MB 캘린더면 몇 분씩 30분마다 멈추며 저장 파일이 커졌다 (버그잡이 4)
 */
export const ICS_MAX_EVENTS = 5000;
/** 이만큼 모이면 이른 것 ICS_MAX_EVENTS 개만 남기고 줄인다 */
const ICS_SCAN_MAX = ICS_MAX_EVENTS * 10;

/**
 * .ics 글에서 일정을 꺼낸다. 반복 일정(RRULE: DAILY, WEEKLY, MONTHLY, YEARLY 와 INTERVAL, COUNT, UNTIL,
 * BYDAY, BYMONTHDAY, BYMONTH)은 범위 안 회차로 펼치고 EXDATE 는 빼고 RDATE 는 더한다. 회차를 따로 고친 것
 * (RECURRENCE-ID)은 그 회차를 바꾼다. 취소된 일정과 회차는 뺀다. from~to 사이에 시작하는 것만.
 */
export function parseIcs(text: string, localTz: string, from: number, to: number): IcsEvent[] {
  // UID 마다 본 일정 하나와 회차별 고침
  const groups = new Map<string, { master?: Comp; overrides: Map<string, Comp> }>();
  for (const c of events(text)) {
    const uid = one(c, 'UID')?.value.trim().slice(0, 200);
    if (!uid) continue;
    let g = groups.get(uid);
    if (!g) {
      g = { overrides: new Map() };
      groups.set(uid, g);
    }
    const rid = one(c, 'RECURRENCE-ID');
    if (rid) {
      const w = readWhen(rid.params, rid.value, localTz);
      if (!w) continue;
      const key = occurrenceKey(toMs(w), w);
      g.overrides.set(key, better(g.overrides.get(key), c));
    } else g.master = better(g.master, c);
  }

  const out: IcsEvent[] = [];
  const byStart = (a: IcsEvent, b: IcsEvent) => a.startAt - b.startAt || a.uid.localeCompare(b.uid);
  /** 상한까지 모은 뒤의 마지막 시작. 이보다 늦은 회차는 더 모으지 않는다 (ICS_MAX_EVENTS) */
  let cutoff: number | undefined;
  const titleOf = (...cs: (Comp | undefined)[]) => {
    for (const c of cs) {
      const v = c && one(c, 'SUMMARY')?.value;
      if (v !== undefined) return unescapeText(v).slice(0, 200) || t('panel.event.untitled');
    }
    return t('panel.event.untitled');
  };
  /** 시작과 길이(DTEND 또는 DURATION). 하루짜리 종일 일정은 끝을 두지 않는다 (예전과 같이). 여러 날이면 끝 날 다음 날 0시 */
  const timesOf = (c: Comp, fallbackLength: number | null) => {
    const s = one(c, 'DTSTART');
    const start = s && readWhen(s.params, s.value, localTz);
    if (!start) return undefined;
    const startAt = toMs(start);
    const e = one(c, 'DTEND');
    const end = e && readWhen(e.params, e.value, localTz);
    const dur = one(c, 'DURATION');
    const length = end ? toMs(end) - startAt : dur ? (durationMs(dur.value) ?? null) : fallbackLength;
    return { start, startAt, length: length !== null && length >= 0 ? length : null };
  };
  const push = (
    uid: string,
    recurrenceId: string | null,
    title: string,
    at: number,
    len: number | null,
    allDay: boolean,
  ) => {
    if (at < from || at >= to || (cutoff !== undefined && at > cutoff)) return;
    out.push({
      uid,
      recurrenceId,
      title,
      startAt: at,
      // 종일은 이틀 이상일 때만 끝을 둔다 (하루는 23~25시간이라 26시간으로 가른다). 짝꿍 종일 일정과 같은 모양
      endAt: len === null || (allDay && len <= 26 * 3_600_000) ? null : at + len,
      allDay,
    });
    // 넉넉히 모이면 이른 것만 남기고 줄인다 (메모리와 시간을 묶는다)
    if (out.length >= ICS_SCAN_MAX) {
      out.sort(byStart);
      out.length = ICS_MAX_EVENTS;
      cutoff = out[out.length - 1]?.startAt;
    }
  };

  for (const [uid, g] of groups) {
    const m = g.master;
    const base = m && timesOf(m, null);
    if (m && cancelled(m)) continue; // 본 일정이 취소되면 회차 고침도 같이
    const rrule = m && one(m, 'RRULE');
    const rule = base && rrule ? parseRule(rrule.value, base.start, localTz) : undefined;
    const recurring = !!(m && base && (rrule || m.RDATE));

    if (m && base && !recurring) {
      push(uid, null, titleOf(m), base.startAt, base.length, base.start.allDay);
    } else if (m && base) {
      // 뺄 회차: EXDATE (여러 줄, 쉼표로 여러 값). 날짜만 적힌 것은 그날 회차를 뺀다
      const exact = new Set<string>();
      const exDays = new Set<string>();
      for (const p of m.EXDATE ?? [])
        for (const v of p.value.split(',')) {
          const w = readWhen(p.params, v, base.start.tz === 'UTC' ? localTz : base.start.tz);
          if (!w) continue;
          if (w.allDay) exDays.add(dateKey(w.y, w.mo, w.d));
          exact.add(occurrenceKey(toMs(w), w));
        }
      const slots: { at: number; wall: { y: number; mo: number; d: number } }[] = rule
        ? expandRule(rule, base.start, from, cutoff === undefined ? to : Math.min(to, cutoff + 1))
        : // 모르는 규칙이면 첫 회만 (예전처럼)
          [{ at: base.startAt, wall: base.start }];
      // RDATE 는 회차를 더한다 (기간 PERIOD 값은 시작만)
      for (const p of m.RDATE ?? [])
        for (const v of p.value.split(',')) {
          const w = readWhen(
            p.params,
            v.split('/')[0] ?? '',
            base.start.tz === 'UTC' ? localTz : base.start.tz,
          );
          if (w) slots.push({ at: toMs(w), wall: w });
        }
      // DTSTART 는 규칙에 안 맞아도 첫 회다 (RFC 5545)
      if (rule && !slots.some((s) => s.at === base.startAt))
        slots.push({ at: base.startAt, wall: base.start });
      const seen = new Set<string>();
      for (const s of slots) {
        const key = occurrenceKey(s.at, { ...s.wall, allDay: base.start.allDay });
        if (seen.has(key)) continue;
        seen.add(key);
        if (exact.has(key) || exDays.has(dateKey(s.wall.y, s.wall.mo, s.wall.d))) continue;
        if (g.overrides.has(key)) continue; // 따로 고친 회차는 아래에서
        push(uid, key, titleOf(m), s.at, base.length, base.start.allDay);
      }
    }
    // 회차 고침: 원래 자리가 범위 밖이어도 옮긴 자리가 범위 안이면 넣는다
    for (const [key, o] of g.overrides) {
      if (cancelled(o)) continue;
      const times = timesOf(o, base?.length ?? null);
      if (!times) continue;
      push(uid, key, titleOf(o, m), times.startAt, times.length, times.start.allDay);
    }
  }
  return out.sort((a, b) => a.startAt - b.startAt || a.uid.localeCompare(b.uid)).slice(0, ICS_MAX_EVENTS);
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

// ---- 캘린더를 계속 못 읽을 때 (조용히 실패하던 것을 한 번 알린다) ----

/** 연달아 이만큼 못 읽으면 펫이 한 번 말한다 (30분마다 읽으니 1시간 남짓) */
export const CAL_FAIL_TELL = 3;

export interface CalFailState {
  /** 연달아 못 읽은 수 (인터넷이 끊긴 것은 세지 않는다) */
  n: number;
  /** 이번에 이어진 실패를 이미 알렸다 */
  told: boolean;
}

export const CAL_FAIL_START: CalFailState = { n: 0, told: false };

/**
 * 가져오기 한 번의 결과로 다음 상태와 지금 알릴지.
 * ok 면 처음으로, offline(인터넷 끊김, 시간 끝)은 캘린더 탓이 아니라 그대로, fail(주소 틀림, 403, 캘린더 아님, 너무 큼)은 센다.
 * CAL_FAIL_TELL 번째에 한 번만 알리고, 한 번 읽히기 전에는 다시 알리지 않는다
 */
/**
 * 받은 응답 상태로 본 결과. 5xx(서버가 잠깐 아픔)와 429(너무 자주 물음)는 캘린더 주소 탓이 아니라 세지 않는다 (리뷰 LOW).
 * 그 밖의 4xx(주소 틀림, 권한 없음)는 센다
 */
export function calStatusResult(status: number): 'ok' | 'offline' | 'fail' {
  if (status >= 200 && status < 300) return 'ok';
  if (status >= 500 || status === 429) return 'offline';
  return 'fail';
}

/**
 * 계속 못 읽음을 펫이 말할지. 사용자가 설정에서 직접 가져왔거나(byUser) 설정 창이 열려 있으면(settingsOpen)
 * 거기 결과 글을 이미 보고 있으니 말하지 않는다 (리뷰 LOW)
 */
export function calTellNow(tell: boolean, o: { byUser: boolean; settingsOpen: boolean }): boolean {
  return tell && !o.byUser && !o.settingsOpen;
}

export function calFailStep(
  s: CalFailState,
  result: 'ok' | 'offline' | 'fail',
): { state: CalFailState; tell: boolean } {
  if (result === 'ok') return { state: CAL_FAIL_START, tell: false };
  if (result === 'offline') return { state: s, tell: false };
  const n = s.n + 1;
  const tell = !s.told && n >= CAL_FAIL_TELL;
  return { state: { n, told: s.told || tell }, tell };
}
