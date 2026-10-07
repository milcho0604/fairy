// 일정 (v1). 시간이 되면 펫이 말풍선으로 알린다. 구글 캘린더는 v2.
import type { Db } from './db-schema.ts';
import { t } from './i18n/index.ts';

export interface CalEvent {
  id: number;
  title: string;
  startAt: number;
  endAt: number | null;
  remindMin: number;
  notifiedAt: number | null;
  /** local(직접 넣음), ics(캘린더에서 가져옴, v2) */
  source: 'local' | 'ics';
}

interface Row {
  id: number;
  title: string;
  start_at: number;
  end_at: number | null;
  remind_min: number;
  notified_at: number | null;
  source?: string;
}

const toEvent = (r: Row): CalEvent => ({
  id: Number(r.id),
  title: r.title,
  startAt: Number(r.start_at),
  endAt: r.end_at === null ? null : Number(r.end_at),
  remindMin: Number(r.remind_min),
  notifiedAt: r.notified_at === null ? null : Number(r.notified_at),
  source: r.source === 'ics' ? 'ics' : 'local',
});

export const REMIND_CHOICES = [0, 5, 10, 30, 60] as const;
export const DEFAULT_REMIND_MIN = 10;
/** 이보다 오래 지난 알림은 띄우지 않는다 (컴퓨터가 잠들었다 깬 경우 지난 일정을 몰아서 알리지 않게) */
const STALE_MS = 5 * 60_000;

export class EventStore {
  #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  add(
    input: { title: string; startAt: number; endAt?: number | null; remindMin?: number },
    now: number,
  ): CalEvent {
    const title = input.title.trim();
    if (!title) throw new Error('일정 제목이 비었다');
    const r = this.#db
      .prepare('insert into event (title, start_at, end_at, remind_min, created_at) values (?, ?, ?, ?, ?)')
      .run(
        title.slice(0, 200),
        input.startAt,
        input.endAt ?? null,
        clampRemind(input.remindMin ?? DEFAULT_REMIND_MIN),
        now,
      );
    return this.get(Number(r.lastInsertRowid)) as CalEvent;
  }

  get(id: number): CalEvent | undefined {
    const r = this.#db.prepare('select * from event where id = ? and deleted_at is null').get(id) as
      | Row
      | undefined;
    return r ? toEvent(r) : undefined;
  }

  /** [from, to) 사이에 시작하는 일정, 이른 것부터 */
  between(from: number, to: number): CalEvent[] {
    return (
      this.#db
        .prepare(
          'select * from event where deleted_at is null and start_at >= ? and start_at < ? order by start_at, id',
        )
        .all(from, to) as Row[]
    ).map(toEvent);
  }

  update(
    id: number,
    patch: { title?: string; startAt?: number; endAt?: number | null; remindMin?: number },
  ): CalEvent | undefined {
    const e = this.get(id);
    if (!e) return undefined;
    const title = patch.title === undefined ? e.title : patch.title.trim().slice(0, 200) || e.title;
    const startAt = patch.startAt ?? e.startAt;
    const endAt = patch.endAt === undefined ? e.endAt : patch.endAt;
    const remindMin = patch.remindMin === undefined ? e.remindMin : clampRemind(patch.remindMin);
    // 시각이나 알림 시점을 바꾸면 다시 알린다.
    const renotify = startAt !== e.startAt || remindMin !== e.remindMin;
    // 제목이나 시각을 고치면 사용자 것으로 둔다: 가져온 일정이면 다음 가져오기가 덮지 않는다
    const edited = title !== e.title || startAt !== e.startAt || endAt !== e.endAt;
    this.#db
      .prepare(
        `update event set title = ?, start_at = ?, end_at = ?, remind_min = ?,
         notified_at = case when ? then null else notified_at end,
         user_edited = case when ? then 1 else user_edited end where id = ?`,
      )
      .run(title, startAt, endAt, remindMin, renotify ? 1 : 0, edited ? 1 : 0, id);
    return this.get(id);
  }

  /** 사용자가 지운다. 가져온 일정이면 지운 채로 기억해(묘비) 다음 가져오기가 되살리지 않는다 */
  remove(id: number, now: number): void {
    this.#db.prepare("update event set deleted_at = ?, removed_by = 'user' where id = ?").run(now, id);
  }

  restore(id: number): void {
    this.#db.prepare('update event set deleted_at = null, removed_by = null where id = ?').run(id);
  }

  /** 지금 알릴 일정: 알림 시점이 됐고 아직 안 알렸으며, 시작한 지 5분이 안 지난 것 */
  dueReminders(now: number): CalEvent[] {
    return (
      this.#db
        .prepare(
          `select * from event where deleted_at is null and notified_at is null
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
            `select id, title, start_at, end_at, deleted_at, removed_by, user_edited
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
            }
          | undefined;
        const notified = e.allDay ? e.startAt : null;
        if (!old) {
          this.#db
            .prepare(
              `insert into event (title, start_at, end_at, remind_min, notified_at, created_at, source, external_id)
               values (?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(e.title, e.startAt, e.endAt, e.allDay ? 0 : DEFAULT_REMIND_MIN, notified, now, source, key);
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
        if (
          revive ||
          moved ||
          old.title !== e.title ||
          (old.end_at === null ? null : Number(old.end_at)) !== e.endAt
        ) {
          this.#db
            .prepare(
              `update event set title = ?, start_at = ?, end_at = ?, deleted_at = null, removed_by = null,
               notified_at = case when ? then ? else notified_at end where id = ?`,
            )
            .run(e.title, e.startAt, e.endAt, moved ? 1 : 0, notified, old.id);
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

function plusDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y ?? 2000, (m ?? 1) - 1, (d ?? 1) + n)).toISOString().slice(0, 10);
}

const DAY_WORDS: Record<string, number> = { 오늘: 0, 내일: 1, 모레: 2 };
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

/**
 * "내일 3시 회의", "오후 2시 30분 치과", "10/7 14:00 면접", "금요일 오전 10시 반 1on1 1시간".
 * 시각이 없으면 일정이 아니라서 null. 오전/오후 없이 1~7시는 오후로 본다 (일하는 시간 기준).
 * 날짜가 없고 그 시각이 이미 지났으면 내일. now 는 현지 날짜 today 와 지금 분으로 준다 (시험이 시간대를 타지 않게).
 */
export function parseQuickEvent(text: string, today: string, nowMinute: number): QuickEvent | null {
  let rest = ` ${text.replace(/\s+/g, ' ').trim()} `;
  let day: string | null = null;
  const take = (re: RegExp) => {
    const m = rest.match(re);
    if (m) rest = rest.replace(m[0], ' ');
    return m;
  };

  for (const [word, n] of Object.entries(DAY_WORDS)) {
    if (take(new RegExp(` ${word} `))) {
      day = plusDays(today, n);
      break;
    }
  }
  const md = take(/ (\d{1,2})[/.월] ?(\d{1,2})일? /);
  if (md) {
    const y = Number(today.slice(0, 4));
    const mo = Number(md[1]);
    const dd = Number(md[2]);
    // 없는 날짜(13월, 2월 30일)는 넘기지 않고 일정으로 받지 않는다
    if (mo < 1 || mo > 12 || dd < 1 || dd > new Date(Date.UTC(2024, mo, 0)).getUTCDate()) return null;
    let cand = `${y}-${md[1]?.padStart(2, '0')}-${md[2]?.padStart(2, '0')}`;
    if (cand < today) cand = `${y + 1}${cand.slice(4)}`; // 지난 날짜면 내년
    // 2월 29일은 그해가 윤년일 때만
    if (new Date(`${cand}T00:00:00Z`).getUTCDate() !== dd) return null;
    day = cand;
  }
  const wd = take(/ (다음 ?주 )?([일월화수목금토])요일 /);

  // 길이를 시각보다 먼저 떼어 낸다 ("1시간"을 1시로 읽지 않게).
  let durationMin: number | null = null;
  const dur = take(/ (\d{1,2})시간(?: ?(\d{1,2})분)?(?: 동안)? | (\d{1,3})분 동안 /);
  if (dur) durationMin = dur[3] ? Number(dur[3]) : Number(dur[1]) * 60 + Number(dur[2] ?? 0);

  let minute: number | null = null;
  const hm = take(/ (\d{1,2}):(\d{2}) /);
  if (hm) {
    if (Number(hm[2]) > 59) return null;
    minute = Number(hm[1]) * 60 + Number(hm[2]);
  }
  if (minute === null) {
    const ko = take(/ (오전|오후|아침|저녁|밤)? ?(\d{1,2})시 ?(?:(\d{1,2})분|(반))? /);
    if (ko) {
      if (Number(ko[3] ?? 0) > 59) return null;
      let h = Number(ko[2]);
      const mer = ko[1];
      if ((mer === '오후' || mer === '저녁' || mer === '밤') && h < 12) h += 12;
      if (mer === '오전' && h === 12) h = 0;
      if (!mer && h >= 1 && h <= 7) h += 12;
      minute = h * 60 + (ko[4] ? 30 : Number(ko[3] ?? 0));
    }
  }
  if (minute === null || minute >= 24 * 60) return null;

  if (wd) {
    const target = WEEKDAYS.indexOf(wd[2] ?? '');
    const cur = new Date(`${today}T00:00:00Z`).getUTCDay();
    if (wd[1]) {
      // 다음 주(월요일 시작)의 그 요일
      const toNextMonday = (1 - cur + 7) % 7 || 7;
      day = plusDays(today, toNextMonday + ((target + 6) % 7));
    } else {
      let diff = (target - cur + 7) % 7;
      if (diff === 0 && minute <= nowMinute) diff = 7;
      day = plusDays(today, diff);
    }
  }

  if (!day) day = minute > nowMinute ? today : plusDays(today, 1);
  const title = rest.replace(/\s+/g, ' ').trim();
  if (!title) return null;
  return { title, day, minute, durationMin };
}

/** 14:05 → "오후 2:05" (영어는 "2:05 PM") */
export function timeLabel(minute: number): string {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const vars = { h: h12, m: String(m).padStart(2, '0') };
  return h < 12 ? t('panel.time.am', vars) : t('panel.time.pm', vars);
}
