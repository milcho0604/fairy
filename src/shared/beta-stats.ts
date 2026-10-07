// 베타 기록 (P4-04). 기획서 "성공 기준" 다섯 가지를 앱 안에서 세어 보여 준다.
// 서버로 보내지 않는다. 사용자가 설정 창에서 복사해 의견과 같이 보낸다. 할 일 제목, 대화는 넣지 않는다.
import type { Db } from './db-schema.ts';
import type { DiaryFacts } from './diary.ts';
import { t } from './i18n/index.ts';
import { localDay } from './todo-store.ts';

export interface DayStat {
  day: string;
  onMin: number;
  hiddenMin: number;
  lookCount: number;
  crashCount: number;
  /** 집중 타이머로 집중한 분 (v1) */
  focusMin: number;
  /** 그날 끝낸 할 일 수 (todo 에서 센다) */
  done: number;
}

export interface BetaReport {
  /** 처음 기록된 날. 기록이 없으면 null */
  firstDay: string | null;
  /** 처음 날부터 오늘까지 며칠째인지 (첫날 = 1) */
  dayNumber: number;
  /** 켜 둔 날 수 (전체) */
  daysUsed: number;
  /** 켜 둔 날의 하루 완료 할 일 중앙값 */
  doneMedian: number;
  /** 켜 둔 시간 중 숨긴 시간 비율 (0~1). 켜 둔 시간이 없으면 0 */
  hiddenRatio: number;
  /** 최근 7일 같이 보기 횟수 */
  look7: number;
  /** 최근 7일 비정상 종료와 멈춤 */
  crash7: number;
  /** 최근 14일, 오래된 날부터 */
  days: DayStat[];
}

/** 성공 기준 목표 (기획서). 화면에서 지금 값 옆에 같이 보여 준다. */
export const TARGET = {
  doneMedian: 3,
  hiddenRatio: 0.3,
  look7: 1,
  crash7: 0,
} as const;

interface Row {
  day: string;
  on_min: number;
  hidden_min: number;
  look_count: number;
  crash_count: number;
  focus_min: number;
  walk_min: number;
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] ?? 0) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
}

/** YYYY-MM-DD 에 n 일을 더한다 (날짜만 다루어 시간대와 서머타임에 흔들리지 않게 UTC 로 센다). */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + n)).toISOString().slice(0, 10);
}

/** 두 날짜 사이 날 수 (b - a) */
export function daysBetween(a: string, b: string): number {
  const t = (s: string) => {
    const [y, m, d] = s.split('-').map(Number);
    return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  };
  return Math.round((t(b) - t(a)) / 86_400_000);
}

export class StatStore {
  #db: Db;
  #day: (ms: number) => string;

  constructor(db: Db, day: (ms: number) => string = localDay) {
    this.#db = db;
    this.#day = day;
  }

  #add(now: number, column: keyof Omit<Row, 'day'>, n = 1) {
    this.#db
      .prepare(
        `insert into daily_stat (day, ${column}) values (?, ?)
         on conflict(day) do update set ${column} = ${column} + excluded.${column}`,
      )
      .run(this.#day(now), n);
  }

  /** 1분마다 부른다. 켜 둔 1분, 숨겨 있었으면 숨긴 1분도 더한다. */
  tick(now: number, hidden: boolean): void {
    this.#add(now, 'on_min');
    if (hidden) this.#add(now, 'hidden_min');
  }

  countLook(now: number): void {
    this.#add(now, 'look_count');
  }

  countCrash(now: number): void {
    this.#add(now, 'crash_count');
  }

  /** 산책한 분 (v1) */
  addWalk(now: number, minutes: number): void {
    if (minutes > 0) this.#add(now, 'walk_min', Math.round(minutes));
  }

  /** 집중 타이머로 집중한 분 (v1) */
  addFocus(now: number, minutes: number): void {
    if (minutes > 0) this.#add(now, 'focus_min', Math.round(minutes));
  }

  /**
   * 짝꿍 일기에 쓸 그날 기록 (from 부터 DIARY_DAYS 일, 오래된 날부터). 숫자만 담는다(할 일 제목은 없다).
   * 끝낸 할 일은 todo 에서, 밥은 코인 장부의 food 에서 센다.
   */
  diaryFacts(days: readonly string[]): DiaryFacts[] {
    if (days.length === 0) return [];
    const want = new Set(days);
    const rows = this.#db
      .prepare(`select * from daily_stat where day in (${days.map(() => '?').join(',')})`)
      .all(...days) as Row[];
    const byDay = new Map(rows.map((r) => [r.day, r]));
    const done = new Map<string, number>();
    const doneRows = this.#db
      .prepare('select done_at from todo where done_at is not null and deleted_at is null')
      .all() as { done_at: number }[];
    for (const r of doneRows) {
      const d = this.#day(Number(r.done_at));
      if (want.has(d)) done.set(d, (done.get(d) ?? 0) + 1);
    }
    const fedRows = this.#db
      .prepare(
        `select day, count(*) as n from coin_log where reason = 'food' and day in (${days.map(() => '?').join(',')}) group by day`,
      )
      .all(...days) as { day: string; n: number }[];
    const fed = new Map(fedRows.map((r) => [r.day, Number(r.n)]));
    return days.map((day) => {
      const r = byDay.get(day);
      return {
        day,
        onMin: Number(r?.on_min ?? 0),
        done: done.get(day) ?? 0,
        focusMin: Number(r?.focus_min ?? 0),
        walkMin: Number(r?.walk_min ?? 0),
        lookCount: Number(r?.look_count ?? 0),
        fed: fed.get(day) ?? 0,
      };
    });
  }

  report(now: number): BetaReport {
    const today = this.#day(now);
    const rows = this.#db.prepare('select * from daily_stat order by day').all() as Row[];
    const doneByDay = new Map<string, number>();
    const doneRows = this.#db
      .prepare('select done_at from todo where done_at is not null and deleted_at is null')
      .all() as { done_at: number }[];
    for (const r of doneRows) {
      const d = this.#day(Number(r.done_at));
      doneByDay.set(d, (doneByDay.get(d) ?? 0) + 1);
    }
    const byDay = new Map(rows.map((r) => [r.day, r]));
    const firstDay = rows[0]?.day ?? null;
    const stat = (day: string): DayStat => {
      const r = byDay.get(day);
      return {
        day,
        onMin: Number(r?.on_min ?? 0),
        hiddenMin: Number(r?.hidden_min ?? 0),
        lookCount: Number(r?.look_count ?? 0),
        crashCount: Number(r?.crash_count ?? 0),
        focusMin: Number(r?.focus_min ?? 0),
        done: doneByDay.get(day) ?? 0,
      };
    };
    const all = rows.map((r) => stat(r.day));
    const used = all.filter((d) => d.onMin > 0);
    const onMin = used.reduce((a, d) => a + d.onMin, 0);
    const hiddenMin = used.reduce((a, d) => a + d.hiddenMin, 0);
    const days = Array.from({ length: 14 }, (_, i) => stat(addDays(today, i - 13)));
    const last7 = days.slice(-7);
    return {
      firstDay,
      dayNumber: firstDay ? daysBetween(firstDay, today) + 1 : 0,
      daysUsed: used.length,
      doneMedian: median(used.map((d) => d.done)),
      hiddenRatio: onMin > 0 ? hiddenMin / onMin : 0,
      look7: last7.reduce((a, d) => a + d.lookCount, 0),
      crash7: last7.reduce((a, d) => a + d.crashCount, 0),
      days,
    };
  }
}

const hours = (min: number) =>
  min < 60 ? t('settings.report.min', { n: min }) : t('settings.report.hours', { n: (min / 60).toFixed(1) });

/** 복사해서 보낼 글. 숫자와 날짜만 담는다. */
export function reportText(r: BetaReport, meta: { version: string; os: string }): string {
  const lines = [
    t('settings.report.title', { version: meta.version, os: meta.os }),
    r.firstDay
      ? t('settings.report.first', { first: r.firstDay, day: r.dayNumber, used: r.daysUsed })
      : t('settings.report.none'),
    t('settings.report.done', { n: r.doneMedian, goal: TARGET.doneMedian }),
    t('settings.report.hidden', { n: Math.round(r.hiddenRatio * 100), goal: TARGET.hiddenRatio * 100 }),
    t('settings.report.look', { n: r.look7, goal: TARGET.look7 }),
    t('settings.report.crash', { n: r.crash7, goal: TARGET.crash7 }),
    '',
    t('settings.report.header'),
    ...r.days
      .filter((d) => d.onMin > 0 || d.done > 0 || d.crashCount > 0)
      .map(
        (d) =>
          `${d.day}, ${hours(d.onMin)}, ${hours(d.hiddenMin)}, ${d.done}, ${d.lookCount}, ${d.crashCount}, ${hours(d.focusMin)}`,
      ),
  ];
  return lines.join('\n');
}
