// 일정 (v1). 시간이 되면 펫이 말풍선으로 알린다. 구글 캘린더는 v2.
import { plusDays } from './day.ts';
import type { Db } from './db-schema.ts';
import { t } from './i18n/index.ts';
import { EN_WEEKDAY_ANY, EN_WEEKDAY_FULL, enWeekdayIndex, weekdayOffset } from './quick-words.ts';
import { localDay } from './todo-store.ts';

export interface CalEvent {
  id: number;
  title: string;
  startAt: number;
  endAt: number | null;
  remindMin: number;
  notifiedAt: number | null;
  /** local(직접 넣음), ics(캘린더에서 가져옴, v2) */
  source: 'local' | 'ics';
  /**
   * 종일 일정. startAt 은 첫날 현지 0시, endAt 은 여러 날이면 마지막 날 다음 날 현지 0시(끝 날은 들지 않는다), 하루면 null.
   * remindMin 은 첫날 0시보다 몇 분 앞에 알릴지이고 0 이면 알리지 않는다 (아침 브리핑에 나온다)
   */
  allDay: boolean;
}

interface Row {
  id: number;
  title: string;
  start_at: number;
  end_at: number | null;
  remind_min: number;
  notified_at: number | null;
  source?: string;
  all_day?: number;
}

const toEvent = (r: Row): CalEvent => ({
  id: Number(r.id),
  title: r.title,
  startAt: Number(r.start_at),
  endAt: r.end_at === null ? null : Number(r.end_at),
  remindMin: Number(r.remind_min),
  notifiedAt: r.notified_at === null ? null : Number(r.notified_at),
  source: r.source === 'ics' ? 'ics' : 'local',
  allDay: Number(r.all_day ?? 0) === 1,
});

export const REMIND_CHOICES = [0, 5, 10, 30, 60] as const;
export const DEFAULT_REMIND_MIN = 10;
/** 종일 일정 알림: 전날 저녁 8시 (첫날 0시의 4시간 앞) */
export const ALL_DAY_EVE_MIN = 4 * 60;
/** 종일 일정 알림 고르기: 없음(아침 브리핑에만), 전날 저녁 */
export const ALL_DAY_REMIND_CHOICES = [0, ALL_DAY_EVE_MIN] as const;
/** 이보다 오래 지난 알림은 띄우지 않는다 (컴퓨터가 잠들었다 깬 경우 지난 일정을 몰아서 알리지 않게) */
const STALE_MS = 5 * 60_000;

export class EventStore {
  #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  /** 종일 일정(allDay)은 startAt 을 첫날 현지 0시로, endAt 을 여러 날이면 마지막 날 다음 날 0시로 준다 (allDayTimes) */
  add(
    input: { title: string; startAt: number; endAt?: number | null; remindMin?: number; allDay?: boolean },
    now: number,
  ): CalEvent {
    const title = input.title.trim();
    if (!title) throw new Error('일정 제목이 비었다');
    const allDay = input.allDay === true;
    const r = this.#db
      .prepare(
        'insert into event (title, start_at, end_at, remind_min, created_at, all_day) values (?, ?, ?, ?, ?, ?)',
      )
      .run(
        title.slice(0, 200),
        input.startAt,
        input.endAt ?? null,
        clampRemind(input.remindMin ?? (allDay ? 0 : DEFAULT_REMIND_MIN)),
        now,
        allDay ? 1 : 0,
      );
    return this.get(Number(r.lastInsertRowid)) as CalEvent;
  }

  get(id: number): CalEvent | undefined {
    const r = this.#db.prepare('select * from event where id = ? and deleted_at is null').get(id) as
      | Row
      | undefined;
    return r ? toEvent(r) : undefined;
  }

  /**
   * [from, to) 사이에 시작하는 일정, 이른 것부터. 여러 날 종일 일정은 from 전에 시작했어도 from 뒤까지 이어지면 넣는다
   * (어제부터 3일 여행이 오늘 목록에 나오게). 그런 것은 시작이 이르니 맨 앞에 온다
   */
  between(from: number, to: number): CalEvent[] {
    return (
      this.#db
        .prepare(
          `select * from event where deleted_at is null and start_at < ?
           and (start_at >= ? or (all_day = 1 and end_at is not null and end_at > ?))
           order by start_at, id`,
        )
        .all(to, from, from) as Row[]
    ).map(toEvent);
  }

  update(
    id: number,
    patch: { title?: string; startAt?: number; endAt?: number | null; remindMin?: number; allDay?: boolean },
  ): CalEvent | undefined {
    const e = this.get(id);
    if (!e) return undefined;
    const title = patch.title === undefined ? e.title : patch.title.trim().slice(0, 200) || e.title;
    const startAt = patch.startAt ?? e.startAt;
    const endAt = patch.endAt === undefined ? e.endAt : patch.endAt;
    const allDay = patch.allDay === undefined ? e.allDay : patch.allDay;
    // 종일과 시각 일정 사이를 바꾸면 알림을 새 쪽의 기본으로 (시각 일정의 "10분 전"은 종일에서는 전날 밤 11시 50분이 된다)
    const remindMin =
      patch.remindMin !== undefined
        ? clampRemind(patch.remindMin)
        : allDay !== e.allDay
          ? allDay
            ? 0
            : DEFAULT_REMIND_MIN
          : e.remindMin;
    // 시각이나 알림 시점을 바꾸면 다시 알린다.
    const renotify = startAt !== e.startAt || remindMin !== e.remindMin || allDay !== e.allDay;
    // 제목이나 시각을 고치면 사용자 것으로 둔다: 가져온 일정이면 다음 가져오기가 덮지 않는다
    const edited = title !== e.title || startAt !== e.startAt || endAt !== e.endAt || allDay !== e.allDay;
    this.#db
      .prepare(
        `update event set title = ?, start_at = ?, end_at = ?, remind_min = ?, all_day = ?,
         notified_at = case when ? then null else notified_at end,
         user_edited = case when ? then 1 else user_edited end where id = ?`,
      )
      .run(title, startAt, endAt, remindMin, allDay ? 1 : 0, renotify ? 1 : 0, edited ? 1 : 0, id);
    return this.get(id);
  }

  /** 사용자가 지운다. 가져온 일정이면 지운 채로 기억해(묘비) 다음 가져오기가 되살리지 않는다 */
  remove(id: number, now: number): void {
    this.#db.prepare("update event set deleted_at = ?, removed_by = 'user' where id = ?").run(now, id);
  }

  restore(id: number): void {
    this.#db.prepare('update event set deleted_at = null, removed_by = null where id = ?').run(id);
  }

  /**
   * 지금 알릴 일정: 알림 시점이 됐고 아직 안 알렸으며, 시작한 지 5분이 안 지난 것.
   * 종일 일정은 알림을 골랐을 때만(전날 저녁). 알림 0 인 종일 일정은 0시에 깨우지 않고 아침 브리핑에 맡긴다
   */
  dueReminders(now: number): CalEvent[] {
    return (
      this.#db
        .prepare(
          `select * from event where deleted_at is null and notified_at is null
           and not (all_day = 1 and remind_min = 0)
           and start_at - remind_min * 60000 <= ? and start_at > ? order by start_at`,
        )
        .all(now, now - STALE_MS) as Row[]
    ).map(toEvent);
  }

  /**
   * 캘린더에서 가져온 일정 맞추기 (v2). 키는 UID 와 회차(recurrenceId)라 반복 일정의 회차마다 한 행이다.
   * 같은 키는 바뀐 것만 고치고(안 바뀐 행은 알림 표시를 그대로 둔다), 새것은 넣고, 범위 안에서 캘린더에 없어진 것은 지운다.
   * 사용자가 지운 것은 지운 채로 두고(묘비), 사용자가 고친 것은 덮지 않는다.
   * 종일 일정은 알리지 않는다(알림 시각을 이미 지난 것으로 둔다). 고친 수를 돌려준다.
   */
  syncExternal(
    source: 'ics',
    list: readonly {
      uid: string;
      recurrenceId?: string | null;
      title: string;
      startAt: number;
      endAt: number | null;
      allDay: boolean;
    }[],
    from: number,
    to: number,
    now: number,
  ): { added: number; updated: number; removed: number } {
    let added = 0;
    let updated = 0;
    this.#db.exec('begin');
    try {
      const seen = new Set<string>();
      for (const e of list) {
        const key = externalKey(e);
        // 같은 키가 두 번 오면 앞의 것만 (둘이 한 행을 서로 덮어 매번 "고침"이 되지 않게)
        if (seen.has(key)) continue;
        seen.add(key);
        const old = this.#db
          .prepare(
            `select id, title, start_at, end_at, deleted_at, removed_by, user_edited, all_day
             from event where source = ? and external_id = ?`,
          )
          .get(source, key) as
          | {
              id: number;
              title: string;
              start_at: number;
              end_at: number | null;
              deleted_at: number | null;
              removed_by: string | null;
              user_edited: number;
              all_day: number;
            }
          | undefined;
        const notified = e.allDay ? e.startAt : null;
        if (!old) {
          this.#db
            .prepare(
              `insert into event (title, start_at, end_at, remind_min, notified_at, created_at, source, external_id, all_day)
               values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              e.title,
              e.startAt,
              e.endAt,
              e.allDay ? 0 : DEFAULT_REMIND_MIN,
              notified,
              now,
              source,
              key,
              e.allDay ? 1 : 0,
            );
          added++;
          continue;
        }
        // 사용자가 지운 것: 캘린더에 있어도 되살리지 않는다
        if (old.deleted_at !== null && old.removed_by === 'user') continue;
        const revive = old.deleted_at !== null;
        // 사용자가 고친 것: 제목과 시각은 사용자 것. 캘린더에서 없어졌다 돌아온 경우만 되살린다
        if (Number(old.user_edited)) {
          if (revive) {
            this.#db
              .prepare('update event set deleted_at = null, removed_by = null where id = ?')
              .run(old.id);
            updated++;
          }
          continue;
        }
        const moved = Number(old.start_at) !== e.startAt;
        // 캘린더에서 종일과 시각 일정 사이를 바꿨으면 알림도 그쪽 기본으로
        const flipped = (Number(old.all_day) === 1) !== e.allDay;
        if (
          revive ||
          moved ||
          old.title !== e.title ||
          (old.end_at === null ? null : Number(old.end_at)) !== e.endAt ||
          flipped
        ) {
          this.#db
            .prepare(
              `update event set title = ?, start_at = ?, end_at = ?, all_day = ?, deleted_at = null, removed_by = null,
               remind_min = case when ? then ? else remind_min end,
               notified_at = case when ? then ? else notified_at end where id = ?`,
            )
            .run(
              e.title,
              e.startAt,
              e.endAt,
              e.allDay ? 1 : 0,
              flipped ? 1 : 0,
              e.allDay ? 0 : DEFAULT_REMIND_MIN,
              moved || flipped ? 1 : 0,
              notified,
              old.id,
            );
          updated++;
        }
      }
      const inRange = this.#db
        .prepare(
          'select id, external_id from event where source = ? and deleted_at is null and start_at >= ? and start_at < ?',
        )
        .all(source, from, to) as { id: number; external_id: string }[];
      const gone = inRange.filter((r) => !seen.has(r.external_id));
      for (const r of gone)
        this.#db.prepare("update event set deleted_at = ?, removed_by = 'sync' where id = ?").run(now, r.id);
      this.#db.exec('commit');
      return { added, updated, removed: gone.length };
    } catch (err) {
      this.#db.exec('rollback');
      throw err;
    }
  }

  markNotified(id: number, now: number): void {
    this.#db.prepare('update event set notified_at = ? where id = ?').run(now, id);
  }
}

/** 가져온 일정의 저장 키: 한 번뿐인 일정은 UID, 반복 일정의 회차는 "UID#회차" */
export function externalKey(e: { uid: string; recurrenceId?: string | null }): string {
  return e.recurrenceId ? `${e.uid}#${e.recurrenceId}` : e.uid;
}

function clampRemind(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.min(24 * 60, Math.round(n))) : DEFAULT_REMIND_MIN;
}

// ---- 한 줄 입력 ----

export interface QuickEvent {
  title: string;
  /** 현지 날짜 YYYY-MM-DD */
  day: string;
  /** 하루 안의 분 (0~1439) */
  minute: number;
  /** 길이(분). 말하지 않았으면 null */
  durationMin: number | null;
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

// ---- 영어 (F). 낱말은 통째로만, 대소문자는 가리지 않는다. 앞의 at, on, for 같은 연결어는 같이 뗀다 ----
const EN_DAY_OFFSET: Record<string, number> = {
  today: 0,
  tonight: 0,
  tomorrow: 1,
  tmrw: 1,
  'day after tomorrow': 2,
  'the day after tomorrow': 2,
};
const EN_DAY = / (?:on )?((?:the )?day after tomorrow|today|tonight|tomorrow|tmrw) /i;
const EN_MONTHS = [
  ['january', 'jan'],
  ['february', 'feb'],
  ['march', 'mar'],
  ['april', 'apr'],
  ['may'],
  ['june', 'jun'],
  ['july', 'jul'],
  ['august', 'aug'],
  ['september', 'sept', 'sep'],
  ['october', 'oct'],
  ['november', 'nov'],
  ['december', 'dec'],
];
const EN_MONTH = EN_MONTHS.flat().join('|');
// "oct 7", "October 7th,", "on 7 oct", "the 7th of october"
const EN_MONTH_DAY = new RegExp(` (?:on )?(${EN_MONTH})\\.? (\\d{1,2})(?:st|nd|rd|th)?,? `, 'i');
const EN_DAY_MONTH = new RegExp(
  ` (?:on )?(?:the )?(\\d{1,2})(?:st|nd|rd|th)? (?:of )?(${EN_MONTH})\\.?,? `,
  'i',
);
// 요일: 일정은 시각이 있어야 해서 줄임말(fri)도 앞말 없이 읽는다
const EN_WEEKDAY = new RegExp(` (?:on )?(?:(next|this) )?(${EN_WEEKDAY_ANY})\\.? `, 'i');
// 길이: "for 1 hour", "1h", "1.5 hours", "1h 30m", "for 45 min", "half an hour"
const EN_DURATION =
  / (?:for )?(?:(\d{1,2}(?:\.\d)?) ?(?:h|hr|hrs|hour|hours)(?: ?(\d{1,2}) ?(?:m|min|mins|minute|minutes))?|(\d{1,3}) ?(?:m|min|mins|minute|minutes)|(half an hour|an hour)) /i;
// 시각: "3pm", "3:30 pm", "at 10am", "@9am", "noon", "at midnight", "at 3"(오전, 오후 없이)
const EN_TIME_MER = / (?:at |@ ?)?(\d{1,2})(?::(\d{2}))? ?(am|pm|a\.m\.|p\.m\.) /i;
const EN_TIME_WORD = / (?:at |@ ?)?(noon|midnight) /i;
const EN_TIME_AT = / (?:at |@ ?)(\d{1,2})(?: o'?clock)? | (\d{1,2}) o'?clock /i;

function monthIndex(word: string): number {
  const w = word.toLowerCase();
  return EN_MONTHS.findIndex((names) => names.includes(w)) + 1;
}

// ---- 한 줄 다듬기와 시각 낱말 (빠른 입력, 일정 탭, 할 일 마감이 같이 쓴다) ----

/** 시각 앞의 때 낱말 */
const KO_MER = '오전|오후|아침|저녁|밤|새벽|낮';
/** 시각 뒤에 붙는 조사: "3시에", "2시반에", "15:00부터", "4시쯤" */
const KO_TIME_TAIL = '(?:에|부터|까지|쯤|경)?';
/** 띄울 자리 뒤가 조사나 "반"으로 끝나는 말이면 띄우지 않는다 ("3시에 회의" 를 "3시 에 회의" 로 만들지 않게) */
const GLUED_TAIL = '(?!(?:에|부터|까지|쯤|경|반)(?:\\s|$))';
/** "4시즌", "3시간", "2시장" 처럼 시 뒤에 붙어도 시각이 아닌 말 (붙여 쓴 "3시회의"를 띄울 때 뺀다) */
const NOT_TIME_AFTER = '간|즌|리|스|장|청|험|계|각|절|점|민|대|설|공|키|발|도|작|티|트|집|골|인|외|내';

/**
 * 한 줄 입력 다듬기: 전각 글자(！, ３, ：)를 반각으로, 붙여 쓴 날짜와 시각을 띄운다("내일3시 회의", "3시에회의").
 * 붙여 쓴 할 일 말("내일까지보고서")은 quick-add 가 따로 띄운다.
 */
export function normalizeQuick(text: string): string {
  return text
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/　/g, ' ')
    .replace(/(오늘|내일|모레|글피)(?=\d)/g, '$1 ')
    .replace(
      new RegExp(
        `(\\d{1,2}시)(?!${NOT_TIME_AFTER})((?: ?반| ?\\d{1,2}분)?${KO_TIME_TAIL})(?=[가-힣A-Za-z])${GLUED_TAIL}`,
        'g',
      ),
      '$1$2 ',
    )
    .replace(new RegExp(`(\\d{1,2}:\\d{2})(${KO_TIME_TAIL})(?=[가-힣])${GLUED_TAIL}`, 'g'), '$1$2 ')
    .replace(/\s+/g, ' ')
    .trim();
}

interface ClockPart {
  h: number;
  m: number;
  /** 오전, 오후 같은 때 낱말(영어는 am, pm). 없으면 null */
  mer: string | null;
  /** "07:30" 처럼 두 자리로 적은 시. 24시 표기라 오후로 옮기지 않는다 */
  padded: boolean;
}

const KO_PART_RE = new RegExp(`^(?:(${KO_MER}) ?)?(\\d{1,2})(?:시(?: ?(\\d{1,2})분| ?(반))?|:(\\d{2}))$`);
const EN_PART_RE = /^(\d{1,2})(?::(\d{2}))? ?(am|pm|a\.m\.|p\.m\.)?$/i;

function readKoPart(part: string): ClockPart | null {
  const m = part.trim().match(KO_PART_RE);
  if (!m) return null;
  const min = m[5] !== undefined ? Number(m[5]) : m[4] ? 30 : Number(m[3] ?? 0);
  if (min > 59) return null;
  return {
    h: Number(m[2]),
    m: min,
    mer: m[1] ?? null,
    padded: m[5] !== undefined && (m[2] ?? '').length === 2,
  };
}

function readEnPart(part: string): ClockPart | null {
  const m = part.trim().match(EN_PART_RE);
  if (!m) return null;
  const min = Number(m[2] ?? 0);
  if (min > 59) return null;
  const mer = m[3] ? (m[3].toLowerCase().startsWith('p') ? 'pm' : 'am') : null;
  return { h: Number(m[1]), m: min, mer, padded: m[2] !== undefined && (m[1] ?? '').length === 2 };
}

/**
 * 24시 시각(분). 때 낱말이 없으면 1~7시는 오후로 본다 (일하는 시간 기준, 두 자리 "07:30" 은 그대로).
 * 밤 12시, 저녁 12시, 자정은 다음 날 0시라 nextDay. 틀린 시각이면 null
 */
function clockMinute(p: ClockPart): { minute: number; nextDay: boolean } | null {
  let h = p.h;
  let nextDay = false;
  const mer = p.mer;
  if (mer === 'am' || mer === 'pm') {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (mer === 'pm' ? 12 : 0);
  } else if (mer === '오전' || mer === '새벽' || mer === '아침') {
    if (h === 12) h = 0;
  } else if (mer === '낮') {
    if (h >= 1 && h <= 6) h += 12;
  } else if (mer === '오후') {
    if (h < 12) h += 12;
  } else if (mer === '저녁' || mer === '밤') {
    if (h === 12) {
      h = 0;
      nextDay = true;
    } else if (h < 12) h += 12;
  } else if (h >= 1 && h <= 7 && !p.padded) h += 12;
  if (h > 23) return null;
  return { minute: h * 60 + p.m, nextDay };
}

// 시각 범위: "3시부터 5시까지", "2시~4시", "오전 10시~12시", "14:00-15:30"
const KO_TIME_PART = `(?:(?:${KO_MER}) ?)?\\d{1,2}(?:시(?: ?\\d{1,2}분| ?반)?|:\\d{2})`;
const KO_TIME_RANGE = new RegExp(` (${KO_TIME_PART}) ?(?:부터|~|-|–) ?(${KO_TIME_PART})(?: ?까지)?(?:에)? `);
// 영어 범위: "3-5pm", "3pm-5pm", "3:30 to 5 pm", "from 10 to 11:30am", "2:00-3:30"
const EN_TIME_PART = '\\d{1,2}(?::\\d{2})? ?(?:am|pm|a\\.m\\.|p\\.m\\.)?';
const EN_TIME_RANGE = new RegExp(
  ` (from |at )?(${EN_TIME_PART}) ?(?:-|–|~|to|until|till) ?(${EN_TIME_PART}) `,
  'i',
);

/**
 * 범위의 시작과 끝(분). 끝에만 때 낱말이 있으면 시작도 그쪽으로 ("3-5pm" 은 오후 3시부터),
 * 끝에 없으면 시작보다 뒤인 가장 가까운 시각("오후 2시~4시" 는 4시가 16시, "밤 11시~1시" 는 다음 날 1시).
 */
function rangeMinutes(
  a: ClockPart,
  b: ClockPart,
): { start: number; length: number; nextDay: boolean } | null {
  let startPart = a;
  if (!a.mer && b.mer) {
    // 끝의 때를 시작에 빌려 온다. 그러면 시작이 끝보다 늦으면(11시~오후 1시) 오전
    const end = clockMinute(b);
    const same = clockMinute({ ...a, mer: b.mer });
    if (!end || !same) return null;
    startPart =
      same.minute < end.minute ? { ...a, mer: b.mer } : { ...a, mer: b.mer === 'pm' ? 'am' : '오전' };
  }
  const s = clockMinute(startPart);
  if (!s) return null;
  let endMin: number;
  if (b.mer) {
    const e = clockMinute(b);
    if (!e) return null;
    endMin = e.minute + (e.nextDay ? 24 * 60 : 0);
  } else {
    if (b.h > 23 || b.m > 59) return null;
    const base = (b.h % 12) * 60 + b.m;
    // 시작 뒤 12시간 안에서 처음 오는 그 시각 (13~23시로 적었으면 그대로)
    const cands = b.h >= 13 || b.padded ? [b.h * 60 + b.m] : [base, base + 12 * 60, base + 24 * 60];
    endMin = cands.find((c) => c > s.minute) ?? -1;
    if (endMin < 0 && b.h * 60 + b.m + 24 * 60 > s.minute) endMin = b.h * 60 + b.m + 24 * 60;
  }
  const length = endMin - s.minute;
  if (length <= 0 || length > 24 * 60) return null;
  return { start: s.minute, length, nextDay: s.nextDay };
}

/** 시각 범위("3시부터 5시까지", "3-5pm")가 있는지. 빠른 입력이 "까지", "until" 을 마감으로 읽지 않게 */
export function hasTimeRange(text: string): boolean {
  const padded = ` ${normalizeQuick(text)} `;
  const ko = padded.match(KO_TIME_RANGE);
  if (ko && readKoPart(ko[1] ?? '') && readKoPart(ko[2] ?? '')) return true;
  return enRange(padded) !== null;
}

/** 영어 범위: 때(am, pm)가 하나라도 있거나, 둘 다 콜론이거나, from 으로 시작할 때만 ("5-6 people" 은 아니다) */
function enRange(padded: string): { m: RegExpMatchArray; a: ClockPart; b: ClockPart } | null {
  const m = padded.match(EN_TIME_RANGE);
  if (!m) return null;
  const a = readEnPart(m[2] ?? '');
  const b = readEnPart(m[3] ?? '');
  if (!a || !b) return null;
  const colons = (m[2] ?? '').includes(':') && (m[3] ?? '').includes(':');
  if (!a.mer && !b.mer && !colons && (m[1] ?? '').trim().toLowerCase() !== 'from') return null;
  return { m, a, b };
}

// 상대 시각: "30분 뒤", "1시간 반 후에", "2시간 30분 뒤", "in 30 min", "in an hour", "in 1.5 hours", "in half an hour"
const KO_REL_TIME = / (?:(\d{1,2})시간 ?(?:(\d{1,2})분|(반))?|(\d{1,4})분) ?(?:뒤|후)(?:에)? /;
const EN_REL_TIME =
  / in (?:(\d{1,4}) ?(?:m|min|mins|minute|minutes)|(\d{1,2}(?:\.\d)?|an?|one) ?(?:h|hr|hrs|hour|hours)|(half an hour)) /i;
/** 상대 시각은 이레까지 */
const REL_MAX_MIN = 7 * 24 * 60;

/**
 * "내일 3시 회의", "오후 2시 30분 치과", "10/7 14:00 면접", "금요일 오전 10시 반 1on1 1시간".
 * 조사와 범위, 상대 시각도: "내일 3시에 회의", "3시부터 5시까지 회의", "30분 뒤 빨래", "새벽 2시 비행기", "밤 12시"(다음 날 0시).
 * 영어도 읽는다: "meeting tomorrow at 3pm", "dentist fri 2:30pm", "call next monday 10am for 30 min",
 * "lunch at noon", "interview oct 7 14:00 1h", "workshop 3-5pm", "laundry in 30 min".
 * 시각이 없으면 일정이 아니라서 null. 오전/오후 없이 1~7시는 오후로 본다 (일하는 시간 기준. "at 3", "3:30" 도 같다).
 * 날짜가 없고 그 시각이 이미 지났으면 내일. now 는 현지 날짜 today 와 지금 분으로 준다 (시험이 시간대를 타지 않게).
 */
export function parseQuickEvent(text: string, today: string, nowMinute: number): QuickEvent | null {
  let rest = ` ${normalizeQuick(text)} `;
  let day: string | null = null;
  let tonight = false;
  const take = (re: RegExp) => {
    const m = rest.match(re);
    if (m) rest = rest.replace(m[0], ' ');
    return m;
  };
  const titleOf = () => rest.replace(/\s+/g, ' ').trim();

  // 상대 시각은 지금부터 센다. 날짜, 시각 낱말과 같이 쓰지 않는다 ("30분 뒤 빨래")
  const koRel = take(KO_REL_TIME);
  const enRel = koRel ? null : take(EN_REL_TIME);
  if (koRel || enRel) {
    let offset: number;
    if (koRel)
      offset = koRel[4] ? Number(koRel[4]) : Number(koRel[1]) * 60 + (koRel[3] ? 30 : Number(koRel[2] ?? 0));
    else {
      const m = enRel as RegExpMatchArray;
      if (m[1]) offset = Number(m[1]);
      else if (m[3]) offset = 30;
      else offset = Math.round((/^\d/.test(m[2] ?? '') ? Number(m[2]) : 1) * 60);
    }
    const title = titleOf();
    if (offset < 1 || offset > REL_MAX_MIN || !title) return null;
    const total = nowMinute + offset;
    return {
      title,
      day: plusDays(today, Math.floor(total / (24 * 60))),
      minute: total % (24 * 60),
      durationMin: null,
    };
  }

  // 월, 일이 있으면 그 날짜(지난 날짜면 내년). 없는 날짜면 false
  const setMonthDay = (mo: number, dd: number): boolean => {
    const d = monthDayFrom(mo, dd, today);
    if (!d) return false;
    day = d;
    return true;
  };

  // 영어 길이를 가장 먼저 뗀다: "1.5 hours" 를 아래 "1.5"(1월 5일)로, "1h" 를 시각으로 읽지 않게
  let durationMin: number | null = null;
  const enDur = take(EN_DURATION);
  if (enDur) {
    if (enDur[4]) durationMin = enDur[4].toLowerCase() === 'an hour' ? 60 : 30;
    else if (enDur[3]) durationMin = Number(enDur[3]);
    else durationMin = Math.round(Number(enDur[1]) * 60) + Number(enDur[2] ?? 0);
  }

  const koDay = take(KO_REL_RE);
  if (koDay) day = plusDays(today, KO_REL[koDay[1] ?? ''] ?? 0);
  if (!day) {
    const en = take(EN_DAY);
    if (en) {
      const key = (en[1] ?? '').toLowerCase();
      day = plusDays(today, EN_DAY_OFFSET[key] ?? 0);
      tonight = key === 'tonight';
    }
  }
  if (!day) {
    const later = take(KO_DAYS_LATER) ?? take(EN_DAYS_LATER);
    if (later) day = plusDays(today, Number(later[1]));
  }
  const md = take(KO_MD_RE);
  if (md && !setMonthDay(Number(md[1]), Number(md[2]))) return null;
  if (!md) {
    const enMd = take(EN_MONTH_DAY);
    const enDm = enMd ? null : take(EN_DAY_MONTH);
    if (enMd && !setMonthDay(monthIndex(enMd[1] ?? ''), Number(enMd[2]))) return null;
    if (enDm && !setMonthDay(monthIndex(enDm[2] ?? ''), Number(enDm[1]))) return null;
    if (!enMd && !enDm) {
      const nm = take(KO_MONTH_DAY_REL) ?? take(KO_BARE_DAY);
      if (nm) {
        const d = bareDay(nm, today);
        if (!d) return null;
        day = d;
      }
    }
  }
  // 요일: { 요일 번호, 다음 주인가 }
  let wd: { target: number; next: boolean } | null = null;
  const koWd = take(KO_WD_RE);
  if (koWd) wd = { target: WEEKDAYS.indexOf(koWd[2] ?? ''), next: koWd[1] === '다음' };
  else {
    const enWd = take(EN_WEEKDAY);
    if (enWd) wd = { target: enWeekdayIndex(enWd[2] ?? ''), next: (enWd[1] ?? '').toLowerCase() === 'next' };
  }

  let minute: number | null = null;
  // 밤 12시, 자정: 그 날의 다음 날 0시
  let nextDay = false;
  // 오전, 오후를 적었나. 안 적었으면 "tonight at 8" 을 저녁으로 본다
  let meridiem = false;

  // 시각 범위는 길이보다 먼저 ("2시~4시" 의 "4시" 를 따로 읽지 않게)
  const koRange = take(KO_TIME_RANGE);
  if (koRange) {
    const a = readKoPart(koRange[1] ?? '');
    const b = readKoPart(koRange[2] ?? '');
    const r = a && b ? rangeMinutes(a, b) : null;
    if (!r) return null;
    minute = r.start;
    durationMin = r.length;
    nextDay = r.nextDay;
    meridiem = Boolean(a?.mer || b?.mer);
  } else {
    const en = enRange(rest);
    if (en) {
      rest = rest.replace(en.m[0], ' ');
      const r = rangeMinutes(en.a, en.b);
      if (!r) return null;
      minute = r.start;
      durationMin = r.length;
      meridiem = Boolean(en.a.mer || en.b.mer);
    }
  }

  // 길이를 시각보다 먼저 떼어 낸다 ("1시간"을 1시로 읽지 않게).
  if (durationMin === null) {
    const dur = take(/ (\d{1,2})시간(?: ?(\d{1,2})분| ?반)?(?: 동안)? | (\d{1,3})분 동안 /);
    if (dur) {
      durationMin = dur[3]
        ? Number(dur[3])
        : Number(dur[1]) * 60 + (dur[0].includes('반') ? 30 : Number(dur[2] ?? 0));
    }
  }

  if (minute === null) {
    const enMer = take(EN_TIME_MER);
    if (enMer) {
      const c = clockMinute({
        h: Number(enMer[1]),
        m: Number(enMer[2] ?? 0),
        mer: (enMer[3] ?? '').toLowerCase().startsWith('p') ? 'pm' : 'am',
        padded: false,
      });
      if (!c || Number(enMer[2] ?? 0) > 59) return null;
      minute = c.minute;
      meridiem = true;
    }
  }
  if (minute === null) {
    const word = take(EN_TIME_WORD) ?? take(KO_TIME_WORD);
    if (word) {
      const w = (word[1] ?? '').toLowerCase();
      minute = w === 'noon' || w === '정오' ? 12 * 60 : 0;
      // 자정은 그 날 밤 (다음 날 0시). 영어 midnight 는 tonight 와 같이 쓸 때만 (예전과 같이)
      nextDay = w === '자정' || (w === 'midnight' && tonight);
      meridiem = true;
    }
  }
  if (minute === null) {
    const hm = take(new RegExp(` (?:at |@ ?)?((?:(?:${KO_MER}) ?)?\\d{1,2}:\\d{2})${KO_TIME_TAIL} `, 'i'));
    if (hm) {
      const p = readKoPart(hm[1] ?? '');
      const c = p && clockMinute(p);
      if (!c) return null;
      minute = c.minute;
      nextDay = c.nextDay;
      meridiem = Boolean(p.mer);
    }
  }
  if (minute === null) {
    const ko = take(new RegExp(` ((?:(?:${KO_MER}) ?)?\\d{1,2}시(?: ?\\d{1,2}분| ?반)?)${KO_TIME_TAIL} `));
    if (ko) {
      const p = readKoPart(ko[1] ?? '');
      const c = p && clockMinute(p);
      if (!c) return null;
      minute = c.minute;
      nextDay = c.nextDay;
      meridiem = Boolean(p.mer);
    }
  }
  if (minute === null) {
    const at = take(EN_TIME_AT);
    if (at) {
      let h = Number(at[1] ?? at[2]);
      if (h >= 1 && h <= 7) h += 12;
      minute = h * 60;
    }
  }
  if (minute === null || minute >= 24 * 60) return null;
  if (tonight && !meridiem && minute < 12 * 60) minute += 12 * 60;

  const explicit = Boolean(day || wd);
  if (wd && wd.target >= 0) {
    if (wd.next) day = plusDays(today, weekdayOffset(today, wd.target, true));
    else {
      let diff = weekdayOffset(today, wd.target, false);
      // 그 요일 밤 12시는 다음 날 0시라 지난 시각으로 보지 않는다
      if (diff === 0 && minute <= nowMinute && !nextDay) diff = 7;
      day = plusDays(today, diff);
    }
  }

  if (!day) day = minute > nowMinute ? today : plusDays(today, 1);
  else if (explicit && nextDay) day = plusDays(day, 1);
  const title = titleOf();
  if (!title) return null;
  return { title, day, minute, durationMin };
}

// ---- 종일 일정 (일정 탭에서만). "내일 제주도 여행", "10월 10일~12일 제주도", "from tomorrow for 3 days" ----
// 빠른 입력(펫 메뉴)은 parseQuickEvent 만 쓴다: 거기서는 시각이 없으면 할 일이다.

export interface QuickAllDay {
  title: string;
  /** 첫날 YYYY-MM-DD */
  day: string;
  /** 여러 날이면 마지막 날(든다), 하루면 null */
  lastDay: string | null;
  allDay: true;
}

/** 여러 날 일정은 이 날 수까지 (석 달). 넘으면 날짜를 잘못 읽은 것으로 본다 */
export const ALL_DAY_MAX_DAYS = 92;

/** 시각처럼 보이는 말. 시각 일정으로 못 읽었는데 이런 말이 있으면(25시, 3시 75분) 종일로 넣지 않고 되묻는다 */
const TIME_HINT =
  /\d{1,2}시(?!간)|\d{1,2}:\d{2}|\d ?(?:am|pm|a\.m\.|p\.m\.)(?![a-z])|(?:^|\s)(?:noon|midnight)(?:\s|$)|(?:^|\s)(?:at|@) ?\d|\d ?o'?clock/i;

const KO_REL: Record<string, number> = { 오늘: 0, 내일: 1, 모레: 2, 글피: 3 };
const KO_REL_RE = / (오늘|내일|모레|글피) /;
// 월/일 뒤 조사: "10월 20일에", 요일 뒤: "금요일에", "금요일날". "이번주 금요일" 의 이번주도 뗀다
const KO_MD_RE = / (\d{1,2})[/.월] ?(\d{1,2})일?(?:에|엔)? /;
const KO_WD_RE = / (?:(다음|이번) ?주 ?)?([일월화수목금토])요일(?:에|엔|날)? /;
// "3일 뒤", "in 3 days"
const KO_DAYS_LATER = / (\d{1,2})일 ?(?:뒤|후)(?:에)? /;
const EN_DAYS_LATER = / in (\d{1,2}) days? /i;
// "다음 달 5일", "이번 달 20일", 달 없이 "15일" (오늘보다 앞이면 다음 달). "3일간", "3일 동안" 은 날 수라 뺀다
const KO_MONTH_DAY_REL = / (다음|이번) ?달 ?(\d{1,2})일(?:에|엔)? /;
const KO_BARE_DAY = / ()(\d{1,2})일(?!간| ?동안| ?뒤| ?후|째|차)(?:에|엔)? /;
// 자정(그 날 밤 12시), 정오
const KO_TIME_WORD = / (자정|정오)(?:에)? /;

/** "다음 달 5일", "15일" → 날짜. 없는 날짜면 null */
function bareDay(m: RegExpMatchArray, today: string): string | null {
  const dd = Number(m[2]);
  const [y, mo, d] = today.split('-').map(Number) as [number, number, number];
  const next = m[1] === '다음' || (!m[1] && dd < d);
  const mm = next ? (mo % 12) + 1 : mo;
  const yy = next && mo === 12 ? y + 1 : y;
  const cand = `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  return dd >= 1 && new Date(`${cand}T00:00:00Z`).getUTCDate() === dd ? cand : null;
}
// 종일에서는 요일 줄임말(fri)을 앞말(on, next, this)이 있을 때만 읽는다: "sat exam", "sun cream" 은 제목
const EN_WD_FULL_RE = new RegExp(` (?:on )?(?:(next|this) )?(${EN_WEEKDAY_FULL})\\.? `, 'i');
const EN_WD_ABBR_RE = new RegExp(` (?:on (?:(next|this) )?|(next|this) )(${EN_WEEKDAY_ANY})\\.? `, 'i');
// 기간의 앞뒤("fri-sun")처럼 날짜 자리가 정해진 곳에서는 줄임말만 있어도 요일이다
const EN_WD_LOOSE_RE = new RegExp(` (?:on )?(?:(next|this) )?(${EN_WEEKDAY_ANY})\\.? `, 'i');

/** 월, 일 → base 와 같거나 뒤인 가장 가까운 그 날. 없는 날짜(13월, 2월 30일)면 false */
function monthDayFrom(mo: number, dd: number, base: string): string | false {
  if (mo < 1 || mo > 12 || dd < 1 || dd > new Date(Date.UTC(2024, mo, 0)).getUTCDate()) return false;
  const y = Number(base.slice(0, 4));
  let cand = `${y}-${String(mo).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  if (cand < base) cand = `${y + 1}${cand.slice(4)}`;
  // 2월 29일은 그해가 윤년일 때만
  if (new Date(`${cand}T00:00:00Z`).getUTCDate() !== dd) return false;
  return cand;
}

/**
 * 글에서 날짜 하나를 떼어 낸다. 날짜 낱말, 월/일, 요일 순으로 보고 뒤에 읽은 것이 앞의 것을 덮는다 (시각 일정과 같은 규칙).
 * base 는 월/일과 요일을 셀 기준 날(보통 오늘, 기간의 끝이면 첫날). 날짜가 없으면 null, 없는 날짜면 false
 */
function takeDay(
  text: string,
  today: string,
  base: string,
  looseWeekday = false,
): { day: string; rest: string } | null | false {
  let rest = ` ${text.replace(/\s+/g, ' ').trim()} `;
  let day: string | null = null;
  const take = (re: RegExp) => {
    const m = rest.match(re);
    if (m) rest = rest.replace(m[0], ' ');
    return m;
  };
  const rel = take(KO_REL_RE);
  if (rel) day = plusDays(today, KO_REL[rel[1] ?? ''] ?? 0);
  if (!day) {
    const en = take(EN_DAY);
    if (en) day = plusDays(today, EN_DAY_OFFSET[(en[1] ?? '').toLowerCase()] ?? 0);
  }
  if (!day) {
    const later = take(KO_DAYS_LATER) ?? take(EN_DAYS_LATER);
    if (later) day = plusDays(today, Number(later[1]));
  }
  const md = take(KO_MD_RE);
  if (md) {
    const d = monthDayFrom(Number(md[1]), Number(md[2]), base);
    if (!d) return false;
    day = d;
  } else {
    const enMd = take(EN_MONTH_DAY);
    const enDm = enMd ? null : take(EN_DAY_MONTH);
    const d = enMd
      ? monthDayFrom(monthIndex(enMd[1] ?? ''), Number(enMd[2]), base)
      : enDm
        ? monthDayFrom(monthIndex(enDm[2] ?? ''), Number(enDm[1]), base)
        : null;
    if (d === false) return false;
    if (d) day = d;
    if (!enMd && !enDm) {
      const nm = take(KO_MONTH_DAY_REL) ?? take(KO_BARE_DAY);
      if (nm) {
        const b = bareDay(nm, base);
        if (!b) return false;
        day = b;
      }
    }
  }
  // 요일은 base 부터 센다 ("금요일부터 일요일까지"의 일요일은 금요일 뒤). "다음 주 X요일", "next X" 는 늘 오늘 기준의 다음 주
  const weekdayDay = (target: number, next: boolean) =>
    next
      ? plusDays(today, weekdayOffset(today, target, true))
      : plusDays(base, weekdayOffset(base, target, false));
  const koWd = take(KO_WD_RE);
  const enWd = koWd ? null : (take(EN_WD_FULL_RE) ?? take(looseWeekday ? EN_WD_LOOSE_RE : EN_WD_ABBR_RE));
  if (koWd) {
    day = weekdayDay(WEEKDAYS.indexOf(koWd[2] ?? ''), koWd[1] === '다음');
  } else if (enWd) {
    const word = enWd[enWd.length - 1] ?? '';
    const lead = (enWd[1] ?? enWd[2] ?? '').toLowerCase();
    const target = enWeekdayIndex(word);
    if (target >= 0) day = weekdayDay(target, lead === 'next');
  }
  return day ? { day, rest } : null;
}

/** 글 전체가 날짜 하나인지 ("10월 12일", "next fri"). 기간의 앞뒤를 읽는다 */
function dayToken(token: string, today: string, base: string): string | null {
  const r = takeDay(token, today, base, true);
  return r && !r.rest.trim() ? r.day : null;
}

// 기간에 쓰는 날짜 모양 (값은 dayToken 이 다시 읽는다)
const KO_DATE =
  '(?:오늘|내일|모레|글피|(?:(?:다음|이번) ?주 )?[일월화수목금토]요일|\\d{1,2}월 ?\\d{1,2}일|\\d{1,2}[/.]\\d{1,2})';
const EN_DATE = `(?:today|tomorrow|tmrw|(?:(?:next|this) )?(?:${EN_WEEKDAY_ANY})|(?:${EN_MONTH})\\.? \\d{1,2}(?:st|nd|rd|th)?|\\d{1,2}(?:st|nd|rd|th)? (?:of )?(?:${EN_MONTH}))`;
const DATE = `(?:${KO_DATE}|${EN_DATE})`;
const EN_COUNT: Record<string, number> = {
  a: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};
const EN_COUNT_WORD = `\\d{1,2}|${Object.keys(EN_COUNT).join('|')}`;
// "내일부터 3일", "내일부터 2박 3일", "금요일부터 3일간", "10월 10일부터 3일 동안" (뒤에 까지가 오면 끝 날짜라 아래 SPAN 이 읽는다)
const KO_FROM_COUNT = new RegExp(
  ` (${DATE}) ?부터 (?:(\\d{1,2})박 ?(\\d{1,2})일|(\\d{1,2})일(간| ?동안)?)(?! ?까지)(?: 동안)? `,
  'i',
);
// "내일 3일간", "금요일 3일 동안", "내일 2박 3일" (부터 없이는 간, 동안, 박이 있어야 날 수로 본다)
const KO_COUNT = new RegExp(` (${DATE}) (?:(\\d{1,2})박 ?(\\d{1,2})일|(\\d{1,2})일(?:간| 동안)) `, 'i');
// "from tomorrow for 3 days", "fri for two days", "oct 10 for a week", "for 3 days from tomorrow"
const EN_FOR = `for (${EN_COUNT_WORD}) (days?|weeks?)`;
const EN_FROM_COUNT = new RegExp(` (?:from |starting |on )?(${DATE}),? ${EN_FOR} `, 'i');
const EN_COUNT_FROM = new RegExp(` ${EN_FOR} (?:from|starting|on) (${DATE}) `, 'i');
// "10월 10일~12일", "10/10-10/12", "금요일부터 일요일까지", "oct 10-12", "from fri to sun", "oct 10 through oct 12"
const SPAN = new RegExp(
  ` (?:from |on )?(${DATE}) ?(~|-|–|부터|to|through|thru|until|till) ?(${DATE}|\\d{1,2}일|\\d{1,2}(?:st|nd|rd|th)?)(?: ?까지)? `,
  'i',
);

function countOf(word: string, unit: string): number {
  const n = /^\d+$/.test(word) ? Number(word) : (EN_COUNT[word.toLowerCase()] ?? 0);
  return unit.toLowerCase().startsWith('week') ? n * 7 : n;
}

/** 첫날과 날 수 또는 끝 날로 결과. 끝이 앞서거나 너무 길면 null */
function rangeResult(title: string, day: string, last: string): QuickAllDay | null {
  if (!title || last < day || last > plusDays(day, ALL_DAY_MAX_DAYS - 1)) return null;
  return { title, day, lastDay: last === day ? null : last, allDay: true };
}

const restOf = (padded: string, m: RegExpMatchArray) => padded.replace(m[0], ' ').replace(/\s+/g, ' ').trim();

/** 기간 일정. 없으면 undefined, 기간 모양인데 날짜가 틀렸으면 null */
function parseAllDayRange(text: string, today: string): QuickAllDay | null | undefined {
  // 월/일로 적은 첫날은 지났어도 기간이 오늘까지 이어지면 올해다 (10/8 에 "10/7-10/9 워크숍"). 다 지난 기간이면 내년
  const ongoing = rangeFrom(text, today, plusDays(today, -(ALL_DAY_MAX_DAYS - 1)));
  if (ongoing && (ongoing.lastDay ?? ongoing.day) >= today) return ongoing;
  return rangeFrom(text, today, today);
}

/** 기간 일정. pastBase 는 월/일로 적은 첫날을 셀 기준 날 */
function rangeFrom(text: string, today: string, pastBase: string): QuickAllDay | null | undefined {
  const padded = ` ${text.replace(/\s+/g, ' ').trim()} `;
  const startOf = (token: string) => dayToken(token, today, /\d/.test(token) ? pastBase : today);
  for (const re of [KO_FROM_COUNT, KO_COUNT]) {
    const m = padded.match(re);
    if (!m) continue;
    const day = startOf(m[1] ?? '');
    if (!day) return null;
    let n = m[3] ? Number(m[3]) : Number(m[4]);
    // "10월 10일부터 12일": 첫날을 월/일로 적었고 뒤의 수가 그 날보다 크면 끝 날짜로 본다 ("내일부터 3일"은 3일 동안)
    if (re === KO_FROM_COUNT && !m[3] && !m[5] && /\d/.test(m[1] ?? '')) {
      const end = Number(m[4]);
      if (end > Number(day.slice(8, 10))) n = end - Number(day.slice(8, 10)) + 1;
    }
    if (n < 1) return null;
    return rangeResult(restOf(padded, m), day, plusDays(day, n - 1));
  }
  const en = padded.match(EN_FROM_COUNT);
  const enRev = en ? null : padded.match(EN_COUNT_FROM);
  if (en || enRev) {
    const m = (en ?? enRev) as RegExpMatchArray;
    const [token, word, unit] = en ? [m[1], m[2], m[3]] : [m[3], m[1], m[2]];
    const day = startOf(token ?? '');
    const n = countOf(word ?? '', unit ?? '');
    if (!day || n < 1) return null;
    return rangeResult(restOf(padded, m), day, plusDays(day, n - 1));
  }
  const s = padded.match(SPAN);
  if (!s) return undefined;
  const day = startOf(s[1] ?? '');
  if (!day) return null;
  const endText = (s[3] ?? '').trim();
  let last: string | null;
  const bare = endText.match(/^(\d{1,2})(?:일|st|nd|rd|th)?$/i);
  if (bare) {
    // "10월 10일~12일", "oct 10-12": 끝은 첫날과 같은 달의 그 날 (작으면 다음 달). 첫날이 월/일일 때만
    if (!/\d/.test(s[1] ?? '')) return undefined;
    const dd = Number(bare[1]);
    const [y, mo, d] = day.split('-').map(Number) as [number, number, number];
    const nextMonth = dd < d;
    const mm = nextMonth ? (mo % 12) + 1 : mo;
    const yy = nextMonth && mo === 12 ? y + 1 : y;
    const cand = `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
    last = new Date(`${cand}T00:00:00Z`).getUTCDate() === dd ? cand : null;
  } else last = dayToken(endText, today, day);
  if (!last) return null;
  return rangeResult(restOf(padded, s), day, last);
}

/** 날짜 하나만 있는 종일 일정. 날짜가 없거나 시각처럼 보이는 말이 있으면 null */
function parseAllDayOne(text: string, today: string): QuickAllDay | null {
  if (TIME_HINT.test(text)) return null;
  const r = takeDay(text, today, today);
  if (!r) return null;
  const title = r.rest.replace(/\s+/g, ' ').trim();
  return title ? { title, day: r.day, lastDay: null, allDay: true } : null;
}

/**
 * 일정 탭의 한 줄. 시각이 있으면 시각 일정(parseQuickEvent), 날짜만 있으면 그 날 종일 일정,
 * 기간이 있으면 여러 날 종일 일정. 날짜도 시각도 없으면 null.
 * 기간은 시각보다 먼저 본다: "10/10-10/12 3pm 워크숍" 은 여러 날 종일이고 "3pm" 은 제목에 남는다(여러 날 시각 일정은 없다).
 */
export function parseEventInput(
  text: string,
  today: string,
  nowMinute: number,
): QuickEvent | QuickAllDay | null {
  const norm = normalizeQuick(text);
  const range = parseAllDayRange(norm, today);
  if (range !== undefined) return range;
  return parseQuickEvent(norm, today, nowMinute) ?? parseAllDayOne(norm, today);
}

/** 현지 날짜의 0시 ms */
export function dayStartMs(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y ?? 2000, (m ?? 1) - 1, d ?? 1).getTime();
}

/** 종일 일정의 저장 시각: 첫날 0시, 여러 날이면 마지막 날 다음 날 0시 (ics DTEND 와 같은 모양) */
export function allDayTimes(day: string, lastDay: string | null): { startAt: number; endAt: number | null } {
  return {
    startAt: dayStartMs(day),
    endAt: lastDay && lastDay > day ? dayStartMs(plusDays(lastDay, 1)) : null,
  };
}

/** 종일 일정의 첫날과 마지막 날. 끝은 다음 날 0시라 반나절 빼서 읽는다 (서머타임으로 한 시간 밀려도 같은 날) */
export function allDaySpan(e: { startAt: number; endAt: number | null }): { first: string; last: string } {
  const first = localDay(e.startAt);
  const last = e.endAt === null ? first : localDay(e.endAt - 12 * 3_600_000);
  return { first, last: last < first ? first : last };
}

/** 종일 일정 표시: 하루면 "종일", 여러 날이면 "10/10~10/12" */
export function allDayLabel(e: { startAt: number; endAt: number | null }): string {
  const { first, last } = allDaySpan(e);
  if (first === last) return t('panel.event.allDay');
  return t('panel.event.range', {
    m1: Number(first.slice(5, 7)),
    d1: Number(first.slice(8, 10)),
    m2: Number(last.slice(5, 7)),
    d2: Number(last.slice(8, 10)),
  });
}

/** 14:05 → "오후 2:05" (영어는 "2:05 PM") */
export function timeLabel(minute: number): string {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const vars = { h: h12, m: String(m).padStart(2, '0') };
  return h < 12 ? t('panel.time.am', vars) : t('panel.time.pm', vars);
}

// ---- 할 일 마감 (빠른 입력, 할 일 탭). 날짜는 맨 앞이나 맨 끝에 있을 때만 읽는다 ("오늘의 메모"는 제목) ----

const KO_DUE_TOKEN =
  '(?:(?:다음|이번) ?주 ?)?[일월화수목금토]요일|\\d{1,2}월 ?\\d{1,2}일|\\d{1,2}/\\d{1,2}|(?:다음|이번) ?달 ?\\d{1,2}일|\\d{1,2}일 ?(?:뒤|후)|\\d{1,2}일|오늘|내일|모레|글피';
const KO_DUE_PARTICLE = '(?:까지|에|엔|날)?';
const KO_DUE_HEAD = new RegExp(`^(${KO_DUE_TOKEN})${KO_DUE_PARTICLE} (?!동안|간 )`);
const KO_DUE_TAIL = new RegExp(` (${KO_DUE_TOKEN})${KO_DUE_PARTICLE}$`);
// 붙여 쓴 마감: "내일까지보고서", "금요일까지보고서" (조사가 있어야 띄운다. "내일보고서" 는 제목일 수 있다)
const KO_DUE_GLUED = new RegExp(`^(${KO_DUE_TOKEN})(까지|에|엔|부터)(?=[^\\s])`);

/**
 * 할 일 한 줄의 맨 앞이나 맨 끝 한국어 날짜: "금요일까지 보고서", "다음주 월요일 회의 준비", "10월 15일까지 세금",
 * "10/15 세금", "글피 장보기", "15일 월세", "다음 달 5일 결제", "보고서 금요일까지". 요일은 오늘이 그 요일이면 오늘
 * (영어 "friday report" 와 같은 규칙). 있으면 [마감, 남은 말], 없거나 없는 날짜면 null
 */
export function takeKoDue(rest: string, today: string): [string, string] | null {
  const text = rest.replace(KO_DUE_GLUED, '$1$2 ');
  for (const re of [KO_DUE_HEAD, KO_DUE_TAIL]) {
    const m = text.match(re);
    if (!m) continue;
    const day = dayToken(m[1] ?? '', today, today);
    if (day) return [day, text.replace(m[0], ' ').replace(/\s+/g, ' ').trim()];
  }
  return null;
}
