// 미리 알림 글 (8판): 고르기 칸 이름과 펫이 하는 말. 셈은 remind.ts.
import { allDayLabel, timeLabel } from './event-store.ts';
import { t } from './i18n/index.ts';
import { shortLinks } from './links.ts';
import { voiced } from './persona-voice.ts';
import { type Anchor, anchorAt, DAY_MIN, dayOf, EVENING_MIN, MORNING_MIN, splitDayBefore } from './remind.ts';

/** 날짜 기준 알림의 그날 시각 이름: 아침 9시, 저녁 8시, 그 밖은 "오후 6:30" */
const atLabel = (minute: number) =>
  minute === MORNING_MIN
    ? t('remind.morning')
    : minute === EVENING_MIN
      ? t('remind.evening')
      : timeLabel(minute);

/** 고르기 칸 이름: "1시간 전", "3일 전", "정각", 날짜 기준이면 "전날 저녁 8시", "당일 아침 9시", "3일 전 아침 9시" */
export function remindLabel(before: number, dateOnly: boolean): string {
  if (dateOnly) {
    const { days, minute } = splitDayBefore(before);
    const at = atLabel(minute);
    if (days === 0) return t('remind.sameDay', { at });
    if (days === 1) return t('remind.prevDay', { at });
    if (days % 7 === 0) return t('remind.weekAt', { n: days / 7, at });
    return t('remind.daysAt', { n: days, at });
  }
  if (before === 0) return t('remind.at');
  if (before % (7 * DAY_MIN) === 0) return t('remind.week', { n: before / (7 * DAY_MIN) });
  if (before % DAY_MIN === 0) return t('remind.day', { n: before / DAY_MIN });
  if (before < 60) return t('remind.min', { n: before });
  if (before % 60 === 0) return t('remind.hour', { n: before / 60 });
  if (before < DAY_MIN) return t('remind.hourMin', { h: Math.floor(before / 60), m: before % 60 });
  return t('remind.min', { n: before });
}

/** 알림 목록을 한 줄로 (단추 풀이) */
export function remindSummary(reminds: readonly number[], dateOnly: boolean, allDay = false): string {
  if (reminds.length === 0) return allDay ? t('remind.noneAllDay') : t('remind.none');
  return reminds.map((b) => remindLabel(b, dateOnly)).join(', ');
}

/** 알릴 것 한 개: 일정이나 할 일 */
export interface RemindItem {
  kind: 'event' | 'todo';
  title: string;
  anchor: Anchor;
  /** 여러 날 종일 일정의 기간 ("10/7~10/9"). 하루짜리면 없음 */
  range?: string;
}

/** 날짜 사이 날 수 (b - a), 현지 달력 */
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
const minuteOf = (ms: number) => {
  const d = new Date(ms);
  return d.getHours() * 60 + d.getMinutes();
};
const dateLabel = (day: string) =>
  t('panel.due.date', { m: Number(day.slice(5, 7)), d: Number(day.slice(8, 10)) });
function durLabel(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? t('remind.dur.h', { h }) : t('remind.dur.hm', { h, m });
}

/**
 * 펫이 하는 말 한 줄. 남은 시간에 맞춰: 지금, n분 뒤, n시간 뒤(오늘), 내일, n일 남음.
 * 늦게 꺼내도(숨어 있다 나옴, 컴퓨터가 꺼져 있었음) 지금 시각으로 다시 만들면 맞다.
 */
export function remindLine(item: RemindItem, now: number): string {
  // 제목 속 긴 회의 주소는 호스트만 보인다. 여는 것은 "회의 열기" 단추로
  const title = shortLinks(item.title);
  const start = anchorAt(item.anchor);
  const days = daysBetween(dayOf(now), dayOf(start));
  if (item.anchor.kind === 'day') {
    const range = item.range ? ` (${item.range})` : '';
    if (item.kind === 'event') {
      if (days <= 0) return voiced('remind.say.allDayToday', { title, range });
      if (days === 1) return voiced('remind.say.allDayTomorrow', { title, range });
      return voiced('remind.say.allDayDays', { title, n: days, date: dateLabel(item.anchor.day) });
    }
    if (days <= 0) return voiced('remind.say.todoToday', { title });
    if (days === 1) return voiced('remind.say.todoTomorrow', { title });
    return voiced('remind.say.todoDays', { title, n: days, date: dateLabel(item.anchor.day) });
  }
  const time = timeLabel(minuteOf(start));
  const left = Math.round((start - now) / 60_000);
  const ev = item.kind === 'event';
  if (left <= 0) return voiced(ev ? 'remind.say.eventNow' : 'remind.say.todoNow', { title, time });
  if (left < 60) return voiced(ev ? 'remind.say.eventSoon' : 'remind.say.todoSoon', { title, time, n: left });
  if (days <= 0)
    return voiced(ev ? 'remind.say.eventLater' : 'remind.say.todoLater', {
      title,
      time,
      dur: durLabel(left),
    });
  if (days === 1)
    return voiced(ev ? 'remind.say.eventTomorrow' : 'remind.say.todoTomorrowAt', { title, time });
  if (ev) return voiced('remind.say.eventDays', { title, time, n: days, date: dateLabel(dayOf(start)) });
  return voiced('remind.say.todoDays', { title, n: days, date: dateLabel(dayOf(start)) });
}

/** 놓친 알림에 남길 줄: 때가 지나도 맞는 글 ("디자인 회의 (오후 3:00)", "보고서 (10월 9일)") */
export function missedLine(item: RemindItem): string {
  const title = shortLinks(item.title);
  const start = anchorAt(item.anchor);
  const when =
    item.anchor.kind === 'day'
      ? item.kind === 'event'
        ? item.range || allDayLabel({ startAt: start, endAt: null })
        : dateLabel(item.anchor.day)
      : `${dateLabel(dayOf(start))} ${timeLabel(minuteOf(start))}`;
  return `${title} (${when})`;
}
