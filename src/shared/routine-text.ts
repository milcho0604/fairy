// 만나는 시간의 말 (맞이, 헤어짐, 쉬는 날). 계산은 routine.ts (설정 화면이 일정 모듈까지 싣지 않게 나눴다)
import { timeLabel } from './event-store.ts';
import { locale, t } from './i18n/index.ts';
import { type Arrival, MEET_COINS, type MeetTime } from './routine.ts';

/** 날짜로 고르는 말 (같은 날은 같은 말, 날마다 바뀐다) */
export function variant(day: string, n: number): number {
  let h = 0;
  for (const ch of day) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return n > 0 ? h % n : 0;
}

/** 요일 이름 (지금 말로): 월요일, Monday */
export const weekdayName = (day: string): string =>
  new Intl.DateTimeFormat(locale(), { weekday: 'long', timeZone: 'UTC' }).format(
    new Date(`${day}T00:00:00Z`),
  );

export interface GreetInput {
  day: string;
  arrival: Arrival;
  /** 처음 만나는 날 (연속 기록이 없었다) */
  first: boolean;
  streak: number;
  coins: number;
  /** 오늘 브리핑 (briefingBody). 조용히면 빈 글 */
  briefing: string;
  /** 조용히: 인사 한 줄만 */
  quiet: boolean;
}

/** 맞이하는 말: 온 때에 맞는 인사, 연속 기록과 코인, 오늘 브리핑 */
export function greetText(g: GreetInput): string {
  const i = variant(g.day, 6);
  const hi = g.first
    ? t('routine.hi.first')
    : g.arrival === 'early'
      ? t('routine.hi.early', { i })
      : g.arrival === 'onTime'
        ? t('routine.hi.onTime', { i })
        : t('routine.hi.late', { i });
  if (g.quiet) return hi;
  const parts = [hi];
  if (g.coins > 0 && g.coins > MEET_COINS)
    parts.push(t('routine.coinsBonus', { days: g.streak, n: g.coins }));
  else {
    if (g.streak >= 2) parts.push(t('routine.streak', { n: g.streak }));
    if (g.coins > 0) parts.push(t('routine.coins', { n: g.coins }));
  }
  if (g.briefing) parts.push(g.briefing);
  return parts.join(' ');
}

export interface FarewellInput {
  day: string;
  doneTitles: readonly string[];
  /** 다음 만나는 날. 내일이면 내일 첫 일정 */
  next?: { inDays: number; day: string; meet: MeetTime };
  /** 내일 일정 (다음 만나는 날이 내일일 때만 본다). 이른 것부터, 종일 일정은 allDay */
  tomorrow: readonly { minute: number; title: string; allDay?: boolean }[];
  /** 남은 오늘 마감 수. 회고가 켜져 있을 때만 0 보다 크게 넘긴다 (내일로 넘길지 묻는다) */
  leftToday: number;
  quiet: boolean;
}

/** 헤어지는 말: 수고했어, 오늘 끝낸 일 한 줄, 다음 만남 미리 보기, 남은 마감 묻기 */
export function farewellText(f: FarewellInput): string {
  const parts = [t('routine.bye.head', { i: variant(f.day, 6) })];
  if (!f.quiet) {
    const n = f.doneTitles.length;
    if (n === 1) parts.push(t('routine.bye.doneOne', { title: f.doneTitles[0] ?? '' }));
    else if (n > 1) parts.push(t('routine.bye.doneMany', { n }));
    parts.push(nextLine(f));
  }
  if (f.leftToday > 0) parts.push(t('briefing.review.left', { n: f.leftToday }));
  return parts.join(' ');
}

function nextLine(f: FarewellInput): string {
  if (!f.next) return t('routine.bye.rest');
  if (f.next.inDays > 1) return t('routine.bye.nextMeet', { weekday: weekdayName(f.next.day) });
  const allDay = f.tomorrow.filter((e) => e.allDay);
  const first = f.tomorrow.find((e) => !e.allDay);
  if (first) return t('routine.bye.tomorrowFirst', { time: timeLabel(first.minute), title: first.title });
  if (allDay.length > 0)
    return t('routine.bye.tomorrowAllDay', {
      list: allDay
        .slice(0, 2)
        .map((e) => e.title)
        .join(', '),
    });
  return t('routine.bye.tomorrowMeet', { time: timeLabel(f.next.meet.start) });
}

/** 쉬는 날 한마디. 오늘 일정이 있으면 브리핑을 붙인다 */
export function restText(day: string, briefing: string): string {
  const hi = t('routine.rest', { i: variant(day, 4) });
  return briefing ? `${hi} ${briefing}` : hi;
}
