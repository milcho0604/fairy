// 일정 (v1). 시간이 되면 펫이 말풍선으로 알린다. 구글 캘린더는 v2.

import { cutText } from './cut-text.ts';
import { plusDays } from './day.ts';
import type { Db } from './db-schema.ts';
import { NO_END_MIN } from './event-overlap.ts';
import { t } from './i18n/index.ts';
import { pinAt } from './pin.ts';
import {
  EN_COUNT,
  EN_REL_DAY_GUARD,
  EN_REL_DAY_WORD,
  EN_WEEKDAY_ANY,
  EN_WEEKDAY_FULL,
  enRelDay,
  enWeekdayIndex,
  KO_REL_DAY_WORD,
  koRelDay,
  weekdayOffset,
} from './quick-words.ts';
import { type Anchor, DEFAULT_REMINDS, dayOf, normalizeReminds, REMIND_MAX_MIN } from './remind.ts';
import { ReminderStore } from './reminder-store.ts';
import { localDay } from './todo-store.ts';

export interface CalEvent {
  id: number;
  title: string;
  startAt: number;
  endAt: number | null;
  /**
   * 미리 알림 (8판), 이른 것부터. 시각 일정은 시작 몇 분 전, 종일 일정은 첫날 0시 몇 분 전 (remind.ts).
   * 비었으면 알리지 않는다 (종일 일정은 아침 브리핑에 나온다)
   */
  reminds: number[];
  /** 가장 늦은(시작에 가까운) 알림. 7판의 알림 하나와 같은 뜻이고 없으면 0. 옛 호출(MCP, 시험)이 읽는다 */
  remindMin: number;
  /** 마지막으로 알린 시각. 없으면 null */
  notifiedAt: number | null;
  /** local(직접 넣음), ics(캘린더에서 가져옴, v2) */
  source: 'local' | 'ics';
  /**
   * 종일 일정. startAt 은 첫날 현지 0시, endAt 은 여러 날이면 마지막 날 다음 날 현지 0시(끝 날은 들지 않는다), 하루면 null.
   */
  allDay: boolean;
  /** 고정한 시각 (13판, shared/pin.ts). 고정 안 했거나 값이 깨졌으면 null. 구글 보내기와 .ics 내보내기에는 없다 */
  pinnedAt: number | null;
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
  pinned_at?: unknown;
}

const toEvent = (r: Row, marks: readonly { before: number; notifiedAt: number | null }[]): CalEvent => {
  const reminds = marks.map((m) => m.before);
  const spoken = marks.map((m) => m.notifiedAt ?? 0).filter((v) => v > 0);
  return {
    id: Number(r.id),
    title: r.title,
    startAt: Number(r.start_at),
    endAt: r.end_at === null ? null : Number(r.end_at),
    reminds,
    remindMin: reminds.length ? Math.min(...reminds) : 0,
    notifiedAt: spoken.length ? Math.max(...spoken) : null,
    source: r.source === 'ics' ? 'ics' : 'local',
    allDay: Number(r.all_day ?? 0) === 1,
    pinnedAt: pinAt(r.pinned_at),
  };
};

/** 일정의 알림 기준: 종일이면 첫날, 아니면 시작 시각 */
export const eventAnchor = (e: { startAt: number; allDay: boolean }): Anchor =>
  e.allDay ? { kind: 'day', day: dayOf(e.startAt) } : { kind: 'time', at: e.startAt };

/** 7판 알림 하나(remindMin)를 알림 목록으로. 종일 일정의 0 은 "알림 없음" */
const fromLegacy = (m: number, allDay: boolean): number[] =>
  allDay && m === 0 ? [] : normalizeReminds([clampRemind(m)], allDay);

const defaultReminds = (allDay: boolean): number[] => [
  ...(allDay ? DEFAULT_REMINDS.allDay : DEFAULT_REMINDS.event),
];

export const DEFAULT_REMIND_MIN = 10;
/** 종일 일정 알림: 전날 저녁 8시 (첫날 0시의 4시간 앞) */
export const ALL_DAY_EVE_MIN = 4 * 60;
/** 종일 일정 알림 고르기: 없음(아침 브리핑에만), 전날 저녁 */
export const ALL_DAY_REMIND_CHOICES = [0, ALL_DAY_EVE_MIN] as const;

/**
 * 일정 시각으로 받는 가장 먼 때 (ms). JS Date 가 나타내는 끝(서기 275760년)이다. 넘으면 Date 가 Invalid Date 라
 * 구글 보내기가 던지고, 2^53 을 넘으면 SQLite 에서 읽을 때마다 "Value is too large" 로 던져 일정 표 전체(패널, 알림,
 * 달력)가 멈췄다. 캘린더 주소의 DURATION:P99999999W 한 줄이나 MCP duration_min 한 번으로 생겼다 (버그잡이 4: 견고함)
 */
export const EVENT_TIME_MAX_MS = 8.64e15;
/** 일정 시각으로 쓸 수 있는 수인지 */
export const eventTimeOk = (ms: unknown): ms is number =>
  typeof ms === 'number' && Number.isFinite(ms) && Math.abs(ms) <= EVENT_TIME_MAX_MS;
/** 끝 시각: 쓸 수 없는 수면 끝 없음으로 */
const cleanEnd = (ms: number | null | undefined): number | null => (eventTimeOk(ms) ? ms : null);

/**
 * 이미 저장된 쓸 수 없는 시각을 고친다 (켤 때 한 번). 끝은 지우고(끝 없음), 시작이 틀린 것은 지운 것으로 둔다.
 * 읽기는 그 행에서 던지므로 쓰기(update)로만 고친다. 고친 행 수
 */
export function repairEventTimes(db: Db, now: number): number {
  const ends = db
    .prepare('update event set end_at = null where end_at is not null and abs(end_at) > ?')
    .run(EVENT_TIME_MAX_MS);
  const starts = db
    .prepare(
      "update event set deleted_at = ?, removed_by = 'user' where deleted_at is null and abs(start_at) > ?",
    )
    .run(now, EVENT_TIME_MAX_MS);
  return Number(ends.changes) + Number(starts.changes);
}

export class EventStore {
  #db: Db;
  #reminders: ReminderStore;

  constructor(db: Db) {
    this.#db = db;
    this.#reminders = new ReminderStore(db, 'event');
  }

  #withReminds(
    rows: readonly Row[],
    marks = this.#reminders.many(rows.map((r) => Number(r.id))),
  ): CalEvent[] {
    return rows.map((r) => toEvent(r, marks.get(Number(r.id)) ?? []));
  }

  /** 종일 일정(allDay)은 startAt 을 첫날 현지 0시로, endAt 을 여러 날이면 마지막 날 다음 날 0시로 준다 (allDayTimes) */
  add(
    input: {
      title: string;
      startAt: number;
      endAt?: number | null;
      /** 알림 목록. 없으면 remindMin(7판 하나), 그것도 없으면 기본 (시각 10분 전, 종일 없음) */
      reminds?: readonly number[];
      remindMin?: number;
      allDay?: boolean;
    },
    now: number,
  ): CalEvent {
    const title = input.title.trim();
    if (!title) throw new Error('일정 제목이 비었다');
    if (!eventTimeOk(input.startAt)) throw new Error('일정 시각이 틀렸다');
    const allDay = input.allDay === true;
    const r = this.#db
      .prepare(
        'insert into event (title, start_at, end_at, remind_min, created_at, all_day) values (?, ?, ?, ?, ?, ?)',
      )
      .run(
        cutText(title, 200),
        input.startAt,
        cleanEnd(input.endAt),
        clampRemind(input.remindMin ?? (allDay ? 0 : DEFAULT_REMIND_MIN)),
        now,
        allDay ? 1 : 0,
      );
    const id = Number(r.lastInsertRowid);
    const reminds = input.reminds
      ? normalizeReminds(input.reminds, allDay)
      : input.remindMin !== undefined
        ? fromLegacy(input.remindMin, allDay)
        : defaultReminds(allDay);
    this.#reminders.set(id, reminds, eventAnchor({ startAt: input.startAt, allDay }), { now, reset: true });
    return this.get(id) as CalEvent;
  }

  get(id: number): CalEvent | undefined {
    const r = this.#db.prepare('select * from event where id = ? and deleted_at is null').get(id) as
      | Row
      | undefined;
    return r ? this.#withReminds([r])[0] : undefined;
  }

  /**
   * [from, to) 사이에 시작하는 일정, 이른 것부터. 여러 날 종일 일정은 from 전에 시작했어도 from 뒤까지 이어지면 넣는다
   * (어제부터 3일 여행이 오늘 목록에 나오게). 그런 것은 시작이 이르니 맨 앞에 온다
   */
  between(from: number, to: number): CalEvent[] {
    return this.#withReminds(
      this.#db
        .prepare(
          `select * from event where deleted_at is null and start_at < ?
           and (start_at >= ? or (all_day = 1 and end_at is not null and end_at > ?))
           order by start_at, id`,
        )
        .all(to, from, from) as Row[],
    );
  }

  /**
   * [from, to) 와 시간이 겹치는 시각 일정 (종일은 뺀다), 이른 것부터. 시작이 from 보다 이른 긴 일정도 넣는다
   * (월요일 9시부터 수요일 18시까지인 일정이 화요일 회의와 겹치는 것을 between 으로는 못 봤다).
   * 끝이 없는 일정은 30분짜리로 본다 (event-overlap.ts NO_END_MIN)
   */
  timedOverlapping(from: number, to: number): CalEvent[] {
    return this.#withReminds(
      this.#db
        .prepare(
          `select * from event where deleted_at is null and all_day = 0 and start_at < ?
           and (case when end_at is not null and end_at > start_at then end_at else start_at + ? end) > ?
           order by start_at, id`,
        )
        .all(to, NO_END_MIN * 60_000, from) as Row[],
    );
  }

  /**
   * 고치기. now 를 주면(패널, 가져오기) 새로 건 알림 중 이미 지난 것은 넘긴 것으로 적는다.
   * 시작이나 종일을 바꾸면 알림 표시를 지워 다시 알린다. 알림만 바꾸면 이미 말한 알림의 표시는 그대로 둔다
   */
  update(
    id: number,
    patch: {
      title?: string;
      startAt?: number;
      endAt?: number | null;
      reminds?: readonly number[];
      remindMin?: number;
      allDay?: boolean;
    },
    now?: number,
  ): CalEvent | undefined {
    const e = this.get(id);
    if (!e) return undefined;
    const title = patch.title === undefined ? e.title : cutText(patch.title.trim(), 200) || e.title;
    const startAt = eventTimeOk(patch.startAt) ? patch.startAt : e.startAt;
    const endAt = patch.endAt === undefined ? e.endAt : cleanEnd(patch.endAt);
    const allDay = patch.allDay === undefined ? e.allDay : patch.allDay;
    // 종일과 시각 일정 사이를 바꾸면 알림을 새 쪽의 기본으로 (시각 일정의 "10분 전"은 종일에서는 전날 밤 11시 50분이 된다)
    const reminds = patch.reminds
      ? normalizeReminds(patch.reminds, allDay)
      : patch.remindMin !== undefined
        ? fromLegacy(patch.remindMin, allDay)
        : allDay !== e.allDay
          ? defaultReminds(allDay)
          : e.reminds;
    const moved = startAt !== e.startAt || allDay !== e.allDay;
    const remindsChanged = reminds.join() !== e.reminds.join();
    // 제목이나 시각을 고치면 사용자 것으로 둔다: 가져온 일정이면 다음 가져오기가 덮지 않는다 (알림만 바꾼 것은 아니다)
    const edited = title !== e.title || startAt !== e.startAt || endAt !== e.endAt || allDay !== e.allDay;
    this.#db
      .prepare(
        `update event set title = ?, start_at = ?, end_at = ?, all_day = ?,
         user_edited = case when ? then 1 else user_edited end where id = ?`,
      )
      .run(title, startAt, endAt, allDay ? 1 : 0, edited ? 1 : 0, id);
    if (moved || remindsChanged)
      this.#reminders.set(id, reminds, eventAnchor({ startAt, allDay }), {
        ...(now === undefined ? {} : { now }),
        reset: moved,
      });
    return this.get(id);
  }

  /**
   * 고정과 풀기 (13판). 일정의 고침(user_edited)으로 치지 않아 가져온 일정의 다음 가져오기를 막지 않고, 구글로 다시 보내지도 않는다.
   * 이미 고정한 것을 다시 고정하면 처음 자리를 지킨다. 지운 일정은 바꾸지 않는다
   */
  pin(id: number, on: boolean, now: number): CalEvent | undefined {
    const e = this.get(id);
    if (!e) return undefined;
    if (on && e.pinnedAt !== null) return e;
    this.#db.prepare('update event set pinned_at = ? where id = ?').run(on ? now : null, id);
    return this.get(id);
  }

  /**
   * 고정한 일정 가운데 아직 안 끝난 것, 고정한 순서대로. 날짜가 멀어도(패널 목록 14일 밖) 넣는다.
   * 끝 판단은 일정 탭 목록과 같다: 종일은 마지막 날이 today 보다 앞이면, 시각 일정은 끝(없으면 시작 30분 뒤)이 now 보다 앞이면 끝
   */
  pinned(now: number, today: string = localDay(now)): CalEvent[] {
    const rows = this.#db
      .prepare('select * from event where deleted_at is null and pinned_at is not null order by start_at, id')
      .all() as Row[];
    return this.#withReminds(rows.filter((r) => pinAt(r.pinned_at) !== null))
      .filter((e) => (e.allDay ? allDaySpan(e).last >= today : (e.endAt ?? e.startAt + 30 * 60_000) >= now))
      .sort((a, b) => (a.pinnedAt ?? 0) - (b.pinnedAt ?? 0) || a.id - b.id);
  }

  /** 사용자가 지운다. 가져온 일정이면 지운 채로 기억해(묘비) 다음 가져오기가 되살리지 않는다 */
  remove(id: number, now: number): void {
    this.#db.prepare("update event set deleted_at = ?, removed_by = 'user' where id = ?").run(now, id);
  }

  restore(id: number): void {
    this.#db.prepare('update event set deleted_at = null, removed_by = null where id = ?').run(id);
  }

  /**
   * 지금 알릴 일정: 알림 하나가 울릴 때가 됐고 아직 안 알렸으며, 시작한 지 5분이 안 지난 것 (종일은 첫날이 끝나기 전).
   * 컴퓨터가 꺼져 있던 사이 여러 알림이 지났어도 일정마다 한 번 (planReminders). 알림 없는 종일 일정은 아침 브리핑에 맡긴다
   */
  dueReminders(now: number): CalEvent[] {
    const rows = this.#remindRows(now);
    // 알림 표시는 한 번에 읽는다 (예전에는 일정마다 다시 읽었다). 쓸모없어진 알림은 넘긴 것으로 적는다 (sweep)
    const marks = this.#reminders.many(rows.map((r) => Number(r.id)));
    const list = this.#withReminds(rows, marks);
    const speak = this.#reminders.sweep(
      list.map((e) => ({ id: e.id, anchor: eventAnchor(e) })),
      marks,
      now,
    );
    return list.filter((e) => speak.has(e.id));
  }

  /** dueReminders 가 볼 일정 (아직 말하지 않은 알림이 있는 것) */
  #remindRows(now: number): Row[] {
    return this.#db
      .prepare(
        `select * from event e where deleted_at is null and start_at > ? and start_at <= ?
         and exists (select 1 from reminder r where r.kind = 'event' and r.ref_id = e.id and r.notified_at is null)
         order by start_at, id`,
      )
      .all(now - 2 * DAY_MS, now + REMIND_MAX_MIN * 60_000 + 2 * DAY_MS) as Row[];
  }

  /**
   * now 뒤로 가장 먼저 울릴 일정 알림의 때 (플래너가 그때 깬다). 없으면 undefined.
   * dueReminders 와 같은 일정만 본다: 더 먼 것은 이틀 넘게 남아 그사이 다시 묻는다
   */
  nextReminderAt(now: number): number | undefined {
    const rows = this.#remindRows(now);
    const marks = this.#reminders.many(rows.map((r) => Number(r.id)));
    return this.#reminders.nextFire(
      this.#withReminds(rows, marks).map((e) => ({ id: e.id, anchor: eventAnchor(e) })),
      marks,
      now,
    );
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
      for (const raw of list) {
        // 쓸 수 없는 시각(캘린더의 엉뚱한 DURATION 등): 시작이 틀리면 건너뛰고, 끝이 틀리면 끝 없이
        if (!eventTimeOk(raw.startAt)) continue;
        const e = { ...raw, endAt: cleanEnd(raw.endAt) };
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
          const r = this.#db
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
          this.#reminders.set(Number(r.lastInsertRowid), defaultReminds(e.allDay), eventAnchor(e), {
            now,
            reset: true,
          });
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
          // 캘린더에서 시각이 바뀌면 다시 알린다. 종일과 시각 사이를 바꿨으면 알림도 그쪽 기본으로
          if (moved || flipped) {
            const keep = this.#reminders.marks(old.id).map((m) => m.before);
            this.#reminders.set(old.id, flipped ? defaultReminds(e.allDay) : keep, eventAnchor(e), {
              now,
              reset: true,
            });
          }
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

  /**
   * 캘린더 주소를 지웠다: 가져온 일정 중 아직 안 끝난 것(앞으로 올 것, 이어지는 것)을 지운 것으로 둔다.
   * 맞추기가 지운 것(removed_by 'sync')이라 주소를 다시 넣으면 되살아난다. 지난 일정은 기록으로 둔다. 지운 수를 돌려준다
   */
  dropExternal(source: 'ics', now: number): number {
    const r = this.#db
      .prepare(
        `update event set deleted_at = ?, removed_by = 'sync'
         where source = ? and deleted_at is null and (start_at >= ? or (end_at is not null and end_at > ?))`,
      )
      .run(now, source, now, now);
    return Number(r.changes);
  }

  /** 알렸다: 울릴 때가 지난 알림을 다 알린 것으로 (늦었으면 곧 올 것까지) */
  markNotified(id: number, now: number): void {
    const e = this.get(id);
    if (e) this.#reminders.markNotified(id, eventAnchor(e), now);
  }
}

/** 가져온 일정의 저장 키: 한 번뿐인 일정은 UID, 반복 일정의 회차는 "UID#회차" */
export function externalKey(e: { uid: string; recurrenceId?: string | null }): string {
  return e.recurrenceId ? `${e.uid}#${e.recurrenceId}` : e.uid;
}

function clampRemind(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.min(24 * 60, Math.round(n))) : DEFAULT_REMIND_MIN;
}
const DAY_MS = 86_400_000;

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
  'this evening': 0,
  tomorrow: 1,
  tmrw: 1,
  'day after tomorrow': 2,
  'the day after tomorrow': 2,
};
const EN_DAY = / (?:on )?((?:the )?day after tomorrow|today|tonight|this evening|tomorrow|tmrw) /i;
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
// 하루 끝: "eod", "cob", "end of day", "close of business" 는 오후 6시
const EN_TIME_WORD = / (?:at |@ ?)?(noon|midnight|eod|cob|end of (?:the )?day|close of business) /i;
/** "tonight 9", "this evening 8:30": 저녁 낱말 뒤에는 at 없이 수만 적어도 시각 */
const EN_TIME_BARE = / (\d{1,2})(?::(\d{2}))? /;
/** 오전, 오후 없는 1~7시를 오전으로 읽게 하는 아침 말 ("7시 조깅", "내일 6시 기상") */
const MORNING_CUE =
  /아침|기상|일어나|조깅|러닝|출근|등교|모닝|조식|첫차|\b(?:morning|breakfast|wake|jog|jogging|commute)\b/i;
/** 저녁 말: 오후로 읽은 것이 맞아 보여 오전으로 바꿀 길을 주지 않는다 ("6시 저녁 약속") */
const EVENING_CUE = /저녁|밤|퇴근|회식|야근|\b(?:dinner|evening|night|drinks)\b/i;
/** "오전 중", "오후 중": 시간대 (일정은 그 동안, 할 일은 끝까지). 오전 9~12시, 오후 1~6시 */
export const KO_WINDOW = / (오전|오후) ?중(?:에|까지|으로)? /;
const WINDOWS: Record<string, { start: number; length: number }> = {
  오전: { start: 9 * 60, length: 3 * 60 },
  오후: { start: 13 * 60, length: 5 * 60 },
};
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
    .replace(/(오늘|내일모레|내일|모레|글피)(?=\d)/g, '$1 ')
    .replace(
      new RegExp(
        `(\\d{1,2}시)(?!${NOT_TIME_AFTER})((?: ?반| ?\\d{1,2}분)?${KO_TIME_TAIL})(?=[가-힣A-Za-z])${GLUED_TAIL}`,
        'g',
      ),
      '$1$2 ',
    )
    .replace(new RegExp(`(\\d{1,2}:\\d{2})(${KO_TIME_TAIL})(?=[가-힣])${GLUED_TAIL}`, 'g'), '$1$2 ')
    .replace(/\s+/g, ' ')
    .replace(EN_WD_NEXT_WEEK, 'next $1')
    .replace(EN_NEXT_WEEK_WD, 'next $1')
    .trim();
}

/**
 * "friday next week", "next week friday", "next week on fri" → "next friday" (다음 주 그 요일).
 * 그대로 두면 "next week"(다음 주 월요일)과 요일(이번 주)을 따로 읽어 이번 주 금요일이 된다
 */
const EN_WD_NEXT_WEEK = new RegExp(`\\b(${EN_WEEKDAY_ANY}) next week\\b`, 'gi');
const EN_NEXT_WEEK_WD = new RegExp(`\\bnext week,? (?:on )?(${EN_WEEKDAY_ANY})\\b`, 'gi');

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

/** 범위 끝의 때와 반대쪽 때 (끝에만 때를 적은 범위의 시작이 끝보다 늦을 때) */
const OTHER_MER: Record<string, string> = {
  am: 'pm',
  pm: 'am',
  오전: '오후',
  새벽: '오후',
  아침: '오후',
  오후: '오전',
  낮: '오전',
  저녁: '오전',
  밤: '오전',
};

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
    // 끝의 때를 시작에 빌려 온다. 그러면 시작이 끝보다 늦으면 반대쪽: "11시~오후 1시" 는 오전 11시,
    // "11시~새벽 1시", "10-2am" 은 전날 밤 (자정을 넘는다)
    const end = clockMinute(b);
    const same = clockMinute({ ...a, mer: b.mer });
    if (!end || !same) return null;
    startPart = same.minute < end.minute ? { ...a, mer: b.mer } : { ...a, mer: OTHER_MER[b.mer] ?? '오전' };
  }
  const s = clockMinute(startPart);
  if (!s) return null;
  let endMin: number;
  if (b.mer) {
    const e = clockMinute(b);
    if (!e) return null;
    endMin = e.minute + (e.nextDay ? 24 * 60 : 0);
    // 오후에 시작해 끝을 오전 쪽(새벽 1시, 오전 2시, 1am)으로 적었으면 다음 날: "밤 11시~새벽 1시", "11pm-1am".
    // 오전에 시작해 오전에 끝나거나(오전 10시~오전 9시) 끝이 오후인데 앞서면(오후 3시~2시) 틀린 범위로 둔다
    if (endMin <= s.minute && s.minute >= 12 * 60 && e.minute < 12 * 60) endMin += 24 * 60;
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
  return parseQuickEventInfo(text, today, nowMinute).ev;
}

/**
 * parseQuickEvent 에 더해, 오전, 오후 없는 1~7시를 오후로 읽었으면 오전으로 읽은 것(am)도 준다.
 * 빠른 입력 결과에 "(오후로 읽었어)" 와 오전으로 바꾸는 단추를 단다. 아침 말("7시 조깅")이 있으면 처음부터 오전이라 없다
 */
export function parseQuickEventInfo(
  text: string,
  today: string,
  nowMinute: number,
): { ev: QuickEvent | null; am?: QuickEvent } {
  const none = { ev: null };
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
    if (offset < 1 || offset > REL_MAX_MIN || !title) return none;
    const total = nowMinute + offset;
    return {
      ev: {
        title,
        day: plusDays(today, Math.floor(total / (24 * 60))),
        minute: total % (24 * 60),
        durationMin: null,
      },
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
      tonight = key === 'tonight' || key === 'this evening';
    }
  }
  if (!day) day = takeLaterDay(rest, today, take);
  const md = take(KO_MD_RE);
  if (md && !setMonthDay(Number(md[1]), Number(md[2]))) return none;
  if (!md) {
    const enMd = take(EN_MONTH_DAY);
    const enDm = enMd ? null : take(EN_DAY_MONTH);
    if (enMd && !setMonthDay(monthIndex(enMd[1] ?? ''), Number(enMd[2]))) return none;
    if (enDm && !setMonthDay(monthIndex(enDm[2] ?? ''), Number(enDm[1]))) return none;
    if (!enMd && !enDm) {
      const nm = take(KO_MONTH_DAY_REL) ?? take(KO_BARE_DAY);
      if (nm) {
        const d = bareDay(nm, today);
        if (!d) return none;
        day = d;
      }
    }
  }
  // 요일: { 요일 번호, 다음 주인가 }
  let wd: { target: number; next: boolean; weeks: number } | null = null;
  const koWd = take(KO_WD_RE) ?? take(KO_WD_SHORT);
  if (koWd) {
    const { lead, name } = koWeekdayOf(koWd);
    wd = { target: WEEKDAYS.indexOf(name), next: koWeeks(lead) > 0, weeks: koWeeks(lead) };
  } else {
    const enWd = take(EN_WEEKDAY);
    const next = (enWd?.[1] ?? '').toLowerCase() === 'next';
    if (enWd) wd = { target: enWeekdayIndex(enWd[2] ?? ''), next, weeks: next ? 1 : 0 };
  }

  let minute: number | null = null;
  // 밤 12시, 자정: 그 날의 다음 날 0시
  let nextDay = false;
  // 오전, 오후를 적었나. 안 적었으면 "tonight at 8" 을 저녁으로 본다
  let meridiem = false;
  // 오전, 오후 없이 1~7시라 오후로 읽었다 (아침 말이 있으면 오전으로, 없으면 오전으로 바꿀 길을 준다)
  let bare = false;
  const bareHour = (p: ClockPart) => !p.mer && !p.padded && p.h >= 1 && p.h <= 7;
  // 때 낱말 없이 적은 8~11시 (두 자리 "08:00" 은 24시 표기라 뺀다). 저녁 말이 있거나 오전이 이미 지난 "오늘"이면 오후로
  let plainHour = false;
  const plain = (p: ClockPart | null | undefined) => !!p && !p.mer && !p.padded && p.h >= 8 && p.h <= 11;
  // "오전 중", "오후 중" 시간대: 날짜를 정할 때 시작이 아니라 끝이 지났는지 본다
  let windowLength = 0;

  // 시각 범위는 길이보다 먼저 ("2시~4시" 의 "4시" 를 따로 읽지 않게)
  const koRange = take(KO_TIME_RANGE);
  if (koRange) {
    const a = readKoPart(koRange[1] ?? '');
    const b = readKoPart(koRange[2] ?? '');
    const r = a && b ? rangeMinutes(a, b) : null;
    if (!r) return none;
    minute = r.start;
    durationMin = r.length;
    nextDay = r.nextDay;
    meridiem = Boolean(a?.mer || b?.mer);
    bare = !meridiem && !!a && bareHour(a);
    plainHour = !meridiem && plain(a);
  } else {
    const en = enRange(rest);
    if (en) {
      rest = rest.replace(en.m[0], ' ');
      const r = rangeMinutes(en.a, en.b);
      if (!r) return none;
      minute = r.start;
      durationMin = r.length;
      meridiem = Boolean(en.a.mer || en.b.mer);
      bare = !meridiem && bareHour(en.a);
      plainHour = !meridiem && plain(en.a);
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
      if (!c || Number(enMer[2] ?? 0) > 59) return none;
      minute = c.minute;
      meridiem = true;
    }
  }
  if (minute === null) {
    const word = take(EN_TIME_WORD) ?? take(KO_TIME_WORD);
    if (word) {
      const w = (word[1] ?? '').toLowerCase();
      minute = w === 'noon' || w === '정오' ? 12 * 60 : w === 'midnight' || w === '자정' ? 0 : 18 * 60;
      // 자정, midnight 는 그 날 밤 (다음 날 0시): "금요일 자정", "friday midnight" 은 토요일 0시
      nextDay = w === '자정' || w === 'midnight';
      meridiem = true;
    }
  }
  if (minute === null) {
    const hm = take(new RegExp(` (?:at |@ ?)?((?:(?:${KO_MER}) ?)?\\d{1,2}:\\d{2})${KO_TIME_TAIL} `, 'i'));
    if (hm) {
      const p = readKoPart(hm[1] ?? '');
      const c = p && clockMinute(p);
      if (!c) return none;
      minute = c.minute;
      nextDay = c.nextDay;
      meridiem = Boolean(p.mer);
      bare = bareHour(p);
      plainHour = plain(p);
    }
  }
  if (minute === null) {
    const ko = take(new RegExp(` ((?:(?:${KO_MER}) ?)?\\d{1,2}시(?: ?\\d{1,2}분| ?반)?)${KO_TIME_TAIL} `));
    if (ko) {
      const p = readKoPart(ko[1] ?? '');
      const c = p && clockMinute(p);
      if (!c) return none;
      minute = c.minute;
      nextDay = c.nextDay;
      meridiem = Boolean(p.mer);
      bare = bareHour(p);
      plainHour = plain(p);
    }
  }
  if (minute === null) {
    const at = take(EN_TIME_AT);
    if (at) {
      let h = Number(at[1] ?? at[2]);
      bare = h >= 1 && h <= 7;
      plainHour = h >= 8 && h <= 11;
      if (bare) h += 12;
      minute = h * 60;
    }
  }
  // "tonight 9", "this evening 8:30": 저녁 낱말 뒤에는 at 없이 수만 적어도 시각
  if (minute === null && tonight) {
    const n = take(EN_TIME_BARE);
    if (n && Number(n[1]) <= 12 && Number(n[2] ?? 0) <= 59)
      minute = (Number(n[1]) % 12) * 60 + Number(n[2] ?? 0);
  }
  // "오전 중", "오후 중": 그 시간대 (다른 시각이 없을 때만)
  if (minute === null) {
    const w = take(KO_WINDOW);
    const win = w ? WINDOWS[w[1] ?? ''] : undefined;
    if (win) {
      minute = win.start;
      if (durationMin === null) durationMin = win.length;
      windowLength = win.length;
      meridiem = true;
    }
  }
  if (minute === null || minute >= 24 * 60) return none;
  if (tonight) bare = false;
  if (tonight && !meridiem && minute < 12 * 60) minute += 12 * 60;

  const title = titleOf();
  if (!title) return none;
  const explicit = Boolean(day || wd);
  const said = day;
  /** 그 시각(분)의 날짜: 적은 날짜, 요일, 없으면 오늘이나 (지났으면) 내일 */
  const dayFor = (m: number): string => {
    let d = said;
    if (wd && wd.target >= 0) {
      if (wd.next) d = plusDays(today, weekdayOffset(today, wd.target, true) + (wd.weeks - 1) * 7);
      else {
        let diff = weekdayOffset(today, wd.target, false);
        // 그 요일 밤 12시는 다음 날 0시라 지난 시각으로 보지 않는다
        if (diff === 0 && m + windowLength <= nowMinute && !nextDay) diff = 7;
        d = plusDays(today, diff);
      }
    }
    if (!d) return m + windowLength > nowMinute ? today : plusDays(today, 1);
    return explicit && nextDay ? plusDays(d, 1) : d;
  };
  // 아침 말이 있으면 오전으로 ("7시 조깅"). 없으면 오후로 두고 오전으로 읽은 것도 준다
  if (bare && minute >= 12 * 60 && MORNING_CUE.test(title)) {
    minute -= 12 * 60;
    bare = false;
  }
  // 때 낱말 없는 8~11시: 저녁 말("오늘 8시 저녁", "today at 8 dinner")이 있으면 오후. 없어도 "오늘"이라 적었고
  // 오전 그 시각은 지났는데 오후 그 시각은 아직이면 오후 (밤 8시에 "오늘 8시 저녁"이 지난 오전 8시가 되던 것)
  if (plainHour && !tonight && minute < 12 * 60 && !MORNING_CUE.test(title)) {
    const pm = minute + 12 * 60;
    const fits = pm + (durationMin ?? 0) <= 24 * 60;
    const todaySaid = said === today && !wd;
    if (fits && (EVENING_CUE.test(title) || (todaySaid && minute < nowMinute && pm >= nowMinute)))
      minute = pm;
  }
  const ev = { title, day: dayFor(minute), minute, durationMin };
  if (!bare || minute < 12 * 60 || EVENING_CUE.test(title)) return { ev };
  return { ev, am: { title, day: dayFor(minute - 12 * 60), minute: minute - 12 * 60, durationMin } };
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
  /\d{1,2}시(?!간)|(?:^|\s)(?:자정|정오)|\d{1,2}:\d{2}|\d ?(?:am|pm|a\.m\.|p\.m\.)(?![a-z])|(?:^|\s)(?:noon|midnight)(?:\s|$)|(?:^|\s)(?:at|@) ?\d|\d ?o'?clock/i;

// "내일모레"는 모레 (내일보다 먼저 본다: 앞의 "내일"만 읽고 "모레"를 제목에 남기지 않게)
const KO_REL: Record<string, number> = { 오늘: 0, 내일모레: 2, 내일: 1, 모레: 2, 글피: 3 };
const KO_REL_RE = / (오늘|내일모레|내일|모레|글피) /;
// 월/일 뒤 조사: "10월 20일에", 요일 뒤: "금요일에", "금요일날". "이번주 금요일" 의 이번주도 뗀다
const KO_MD_RE = / (\d{1,2})[/.월] ?(\d{1,2})일?(?:에|엔)? /;
const KO_WD_RE = / (?:(다다음|다음|이번) ?주 ?)?([일월화수목금토])요일(?:에|엔|날)? /;
/**
 * 한 글자 요일: 뒤에 시각이 오거나("금 3시 회의", "토 오전 10시") 앞에 다음 주, 이번 주가 있을 때만
 * ("다음주 월 9시", "다음 주 금까지 보고서"). "일"은 일하다일 수 있어 앞말과 시각이 다 있을 때만 ("다음 주 일 3시")
 */
const KO_CLOCK_AHEAD = `(?:(?:${KO_MER}) ?)?\\d{1,2}(?:시|:\\d{2})`;
const KO_WD_SHORT = new RegExp(
  ` (?:(?:(다다음|다음|이번) ?주 ?)?([월화수목금토])(?:에|엔)? (?=${KO_CLOCK_AHEAD})|(다다음|다음|이번) ?주 ?([월화수목금토])(?:에|엔|까지)? |(다다음|다음|이번) ?주 ?(일)(?:에|엔)? (?=${KO_CLOCK_AHEAD}))`,
);
/** KO_WD_RE, KO_WD_SHORT 로 찾은 것 → 앞말(다음, 이번)과 요일 글자 */
const koWeekdayOf = (m: RegExpMatchArray) => ({
  lead: m[1] ?? m[3] ?? m[5],
  name: m[2] ?? m[4] ?? m[6] ?? '',
});
/** "다음 주" 1, "다다음 주" 2, 나머지 0 */
const koWeeks = (lead: string | undefined) => (lead === '다다음' ? 2 : lead === '다음' ? 1 : 0);
// 상대 날짜: "3일 뒤", 영어 "in 3 days", "in a week", "next week", "end of month", "this weekend" (quick-words.ts EN_REL_DAY_WORD)
const KO_DAYS_LATER = / (\d{1,2})일 ?(?:뒤|후)(?:에)? /;
const EN_REL_DAY = new RegExp(` (${EN_REL_DAY_WORD}) ${EN_REL_DAY_GUARD}`, 'i');
// 한국어 상대 날짜: "2주 뒤", "한 달 뒤", "다음 주", "이번 주까지", "주말에", "월말", "다음 달" (quick-words.ts KO_REL_DAY_WORD)
const KO_REL_DAY = new RegExp(` (${KO_REL_DAY_WORD})(?:까지|에|엔)? `);

/**
 * 글(앞뒤에 빈칸을 붙인 것)의 상대 날짜 → 날짜. 읽으면 take 로 글에서 뗀다(제목에 남지 않게).
 * 없거나 "in 0 days" 면 null 이고 글은 그대로. 시각 일정과 종일 일정이 같이 쓴다
 */
function takeLaterDay(
  rest: string,
  today: string,
  take: (re: RegExp) => RegExpMatchArray | null,
): string | null {
  if (KO_DAYS_LATER.test(rest)) return plusDays(today, Number(take(KO_DAYS_LATER)?.[1]));
  const ko = rest.match(KO_REL_DAY);
  const koDay = ko ? koRelDay(ko[1] ?? '', today) : null;
  if (koDay) {
    take(KO_REL_DAY);
    return koDay;
  }
  const en = rest.match(EN_REL_DAY);
  const day = en ? enRelDay(en[1] ?? '', today) : null;
  if (day) take(EN_REL_DAY);
  return day;
}
// "다음 달 5일", "이번 달 20일", 달 없이 "15일" (오늘보다 앞이면 다음 달). "3일간", "3일 동안" 은 날 수라 뺀다
const KO_MONTH_DAY_REL = / (다음|이번) ?달 ?(\d{1,2})일(?:에|엔)? /;
const KO_BARE_DAY = / ()(\d{1,2})일(?!간| ?동안| ?뒤| ?후|째|차)(?:에|엔)? /;
// 자정(그 날 밤 12시), 정오. 뒤에 조사: "자정까지", "정오부터", "정오쯤"
const KO_TIME_WORD = new RegExp(` (자정|정오)${KO_TIME_TAIL} `);

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
  if (!day) day = takeLaterDay(rest, today, take);
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
  const weekdayDay = (target: number, weeks: number) =>
    weeks > 0
      ? plusDays(today, weekdayOffset(today, target, true) + (weeks - 1) * 7)
      : plusDays(base, weekdayOffset(base, target, false));
  const koWd = take(KO_WD_RE) ?? take(KO_WD_SHORT);
  const enWd = koWd ? null : (take(EN_WD_FULL_RE) ?? take(looseWeekday ? EN_WD_LOOSE_RE : EN_WD_ABBR_RE));
  if (koWd) {
    const { lead, name } = koWeekdayOf(koWd);
    day = weekdayDay(WEEKDAYS.indexOf(name), koWeeks(lead));
  } else if (enWd) {
    const word = enWd[enWd.length - 1] ?? '';
    const lead = (enWd[1] ?? enWd[2] ?? '').toLowerCase();
    const target = enWeekdayIndex(word);
    if (target >= 0) day = weekdayDay(target, lead === 'next' ? 1 : 0);
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
  '(?:오늘|내일모레|내일|모레|글피|(?:(?:다다음|다음|이번) ?주 )?[일월화수목금토]요일|\\d{1,2}월 ?\\d{1,2}일|\\d{1,2}[/.]\\d{1,2})';
const EN_DATE = `(?:today|tomorrow|tmrw|(?:(?:next|this) )?(?:${EN_WEEKDAY_ANY})|(?:${EN_MONTH})\\.? \\d{1,2}(?:st|nd|rd|th)?|\\d{1,2}(?:st|nd|rd|th)? (?:of )?(?:${EN_MONTH}))`;
const DATE = `(?:${KO_DATE}|${EN_DATE})`;
const EN_COUNT_WORD = `\\d{1,2}|${Object.keys(EN_COUNT).join('|')}`;
// "내일부터 3일", "내일부터 2박 3일", "금요일부터 3일간", "10월 10일부터 3일 동안" (뒤에 까지가 오면 끝 날짜라 아래 SPAN 이 읽는다)
// 첫날이 한국어 상대 날짜여도 된다: "다음 주부터 3일", "2주 뒤부터 2박 3일"
const KO_START = `${DATE}|${KO_REL_DAY_WORD}`;
const KO_FROM_COUNT = new RegExp(
  ` (${KO_START}) ?부터 (?:(\\d{1,2})박 ?(\\d{1,2})일|(\\d{1,2})일(간| ?동안)?)(?! ?까지)(?: 동안)? `,
  'i',
);
// "내일 3일간", "금요일 3일 동안", "내일 2박 3일" (부터 없이는 간, 동안, 박이 있어야 날 수로 본다)
const KO_COUNT = new RegExp(` (${KO_START}) (?:(\\d{1,2})박 ?(\\d{1,2})일|(\\d{1,2})일(?:간| 동안)) `, 'i');
// "from tomorrow for 3 days", "fri for two days", "oct 10 for a week", "for 3 days from tomorrow".
// 첫날이 상대 날짜여도 된다: "trip in 2 weeks for 3 days", "conference next week for 3 days" (끝 날짜 자리에는 받지 않는다)
const EN_FOR = `for (${EN_COUNT_WORD}) (days?|weeks?)`;
const EN_FROM_COUNT = new RegExp(` (?:from |starting |on )?(${DATE}|${EN_REL_DAY_WORD}),? ${EN_FOR} `, 'i');
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
    if (re === KO_FROM_COUNT && !m[3] && !m[5] && /\d/.test(m[1] ?? '') && !/뒤|후/.test(m[1] ?? '')) {
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
  `(?:(?:다다음|다음|이번) ?주 ?)?[일월화수목금토]요일|(?:다다음|다음|이번) ?주 ?[월화수목금토]|${KO_REL_DAY_WORD}|` +
  '\\d{1,2}월 ?\\d{1,2}일|\\d{1,2}/\\d{1,2}|(?:다음|이번) ?달 ?\\d{1,2}일|\\d{1,2}일 ?(?:뒤|후)|\\d{1,2}일|오늘|내일모레|내일|모레|글피';
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
    // 맨 앞의 그냥 "주말"(조사 없이)은 제목일 수 있다: "주말 여행 계획". "주말에 대청소", "이번 주말 대청소", "대청소 주말"은 날짜
    if (re === KO_DUE_HEAD && m[0].trim() === '주말') continue;
    const day = dayToken(m[1] ?? '', today, today);
    if (day) return [day, text.replace(m[0], ' ').replace(/\s+/g, ' ').trim()];
  }
  return null;
}
