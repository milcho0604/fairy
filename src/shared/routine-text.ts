// 만나는 시간의 말 (맞이, 헤어짐, 쉬는 날). 계산은 routine.ts (설정 화면이 일정 모듈까지 싣지 않게 나눴다)
import { timeLabel } from './event-store.ts';
import { locale } from './i18n/index.ts';
import { voiced, voicedLive } from './persona-voice.ts';
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
  /** 매주 선물 코인 (그 주 첫 출석 때만 0 보다 크다). 만난 날 코인과 따로 한 문장 */
  weekly?: number;
  /** 오늘 브리핑 (briefingBody). 조용히면 빈 글 */
  briefing: string;
  /** 조용히: 인사 한 줄만 */
  quiet: boolean;
}

/** 맞이하는 말: 온 때에 맞는 인사, 연속 기록과 코인, 오늘 브리핑 */
export function greetText(g: GreetInput): string {
  const i = variant(g.day, 6);
  // 안 쓰기로 한 인사는 빼고 나머지(코인, 브리핑)만 말한다
  const hi = g.first
    ? voicedLive('routine.hi.first')
    : g.arrival === 'early'
      ? voicedLive('routine.hi.early', { i })
      : g.arrival === 'onTime'
        ? voicedLive('routine.hi.onTime', { i })
        : voicedLive('routine.hi.late', { i });
  if (g.quiet) return hi ?? '';
  const parts = hi === undefined ? [] : [hi];
  if (g.coins > 0 && g.coins > MEET_COINS)
    parts.push(voiced('routine.coinsBonus', { days: g.streak, n: g.coins }));
  else {
    if (g.streak >= 2) parts.push(voiced('routine.streak', { n: g.streak }));
    if (g.coins > 0) parts.push(voiced('routine.coins', { n: g.coins }));
  }
  if (g.weekly && g.weekly > 0) parts.push(voiced('routine.weekly', { n: g.weekly }));
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

/** 말풍선에 넣는 제목은 이만큼(글자)까지. 넘으면 줄임표 (긴 할 일 제목이 말풍선을 늘리지 않게) */
export const BYE_TITLE_MAX = 14;
const clip = (title: string): string => {
  const chars = [...title.trim()];
  return chars.length > BYE_TITLE_MAX ? `${chars.slice(0, BYE_TITLE_MAX - 1).join('')}…` : title.trim();
};

/**
 * 헤어지는 말: 두 문장까지 (사용자 결정 2026-10-09: 네 줄은 길었다).
 * 첫 문장은 수고했어(끝낸 일이 있으면 그걸 담아 한 문장으로), 둘째는 남은 마감 묻기가 먼저, 없으면 다음 만남 미리 보기.
 * 남은 마감을 물을 때 미리 보기는 답을 누른 뒤 말한다 (farewellNext, planner.ts). 조용히면 첫 문장과 묻기만
 */
export function farewellText(f: FarewellInput): string {
  const n = f.doneTitles.length;
  const headKey =
    f.quiet || n === 0 ? 'routine.bye.head' : n === 1 ? 'routine.bye.doneOne' : 'routine.bye.doneMany';
  const headVars: Record<string, string | number> =
    headKey === 'routine.bye.head'
      ? { i: variant(f.day, 6) }
      : headKey === 'routine.bye.doneOne'
        ? { title: clip(f.doneTitles[0] ?? '') }
        : { n };
  // 안 쓰기로 한 말은 빼고 이어 붙인다 (끝낸 일 말을 안 쓰면 수고했어 말로 대신, 그것도 안 쓰면 없이). 다 빠지면 빈 글
  const head =
    voicedLive(headKey, headVars) ??
    (headKey === 'routine.bye.head' ? undefined : voicedLive('routine.bye.head', { i: variant(f.day, 6) }));
  const tail =
    f.leftToday > 0 ? voiced('briefing.review.left', { n: f.leftToday }) : f.quiet ? '' : farewellNext(f);
  return [head, tail].filter(Boolean).join(' ');
}

/** 다음 만남 미리 보기 한 문장: 내일 첫 일정, 내일 종일 일정, 내일 만나는 시간, 다음에 만나는 요일, 없으면 푹 쉬어 */
export function farewellNext(f: Pick<FarewellInput, 'next' | 'tomorrow'>): string {
  if (!f.next) return voicedLive('routine.bye.rest') ?? '';
  if (f.next.inDays > 1) return voiced('routine.bye.nextMeet', { weekday: weekdayName(f.next.day) });
  const allDay = f.tomorrow.filter((e) => e.allDay);
  const first = f.tomorrow.find((e) => !e.allDay);
  if (first)
    return voiced('routine.bye.tomorrowFirst', { time: timeLabel(first.minute), title: clip(first.title) });
  const [one] = allDay;
  if (one && allDay.length > 1)
    return voiced('routine.bye.tomorrowAllDayMore', { title: clip(one.title), n: allDay.length - 1 });
  if (one) return voiced('routine.bye.tomorrowAllDay', { list: clip(one.title) });
  return voiced('routine.bye.tomorrowMeet', { time: timeLabel(f.next.meet.start) });
}

/** 쉬는 날 한마디. 오늘 일정이 있으면 브리핑을 붙인다 */
export function restText(day: string, briefing: string): string {
  const hi = voicedLive('routine.rest', { i: variant(day, 4) });
  return [hi, briefing].filter(Boolean).join(' ');
}
