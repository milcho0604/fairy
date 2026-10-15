// 첫 7일 여정 (2026-10-11). 첫 안내를 마친 날부터 이레 동안 하루에 하나씩 기능을 살짝 권한다.
// 빠른 입력, 집중 25분, 메모, 일정, 펫 만들기, 같이 보기, 주간 돌아보기. 해 보면 작은 코인을 준다.
// 건너뛸 수 있고, 펫이 먼저 권하는 말은 하루에 한 번까지다(안 해도 아무 벌이 없다). 진행은 패널 오늘 탭에 보인다.
// 모두 순수 함수다. 저장, 말풍선, 해 봤는지 보기는 main/journey.ts.
import { JOURNEY_COINS } from './coin-rules.ts';
import { plusDays } from './day.ts';

export const JOURNEY_STEPS = ['quick', 'focus', 'note', 'event', 'maker', 'look', 'week'] as const;
export type JourneyStep = (typeof JOURNEY_STEPS)[number];
export const JOURNEY_DAYS = JOURNEY_STEPS.length;
/** 하나 해 볼 때마다 주는 코인 (밥 한 번 값쯤) */
export { JOURNEY_COINS };
/** 코인 기록 까닭 (coin_log.reason) */
export const JOURNEY_REASON = 'journey';

export const isJourneyStep = (v: unknown): v is JourneyStep => JOURNEY_STEPS.includes(v as JourneyStep);

export interface JourneyState {
  /** 여정을 시작한 날 (YYYY-MM-DD). 없으면 아직 시작 안 함 (예전부터 쓰던 사람은 시작하지 않는다) */
  start?: string;
  /** 해 본 것 (코인을 이미 받았다) */
  tried: JourneyStep[];
  /** 여정 그만 보기 */
  skipped: boolean;
  /** 펫이 마지막으로 권한 날. 하루에 한 번까지 */
  nudged?: string;
  /** 다 해 봤다고 축하한 날 */
  finished?: string;
}

export const EMPTY_JOURNEY: JourneyState = { tried: [], skipped: false };

const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** 저장 파일에서 읽은 값을 고른다. 모르는 칸과 틀린 값은 버린다 */
export function parseJourney(raw: unknown): JourneyState {
  if (typeof raw !== 'object' || raw === null) return { ...EMPTY_JOURNEY, tried: [] };
  const r = raw as Record<string, unknown>;
  const tried = Array.isArray(r.tried) ? [...new Set(r.tried.filter(isJourneyStep))] : [];
  return {
    ...(isDay(r.start) ? { start: r.start } : {}),
    tried: JOURNEY_STEPS.filter((s) => tried.includes(s)),
    skipped: r.skipped === true,
    ...(isDay(r.nudged) ? { nudged: r.nudged } : {}),
    ...(isDay(r.finished) ? { finished: r.finished } : {}),
  };
}

/** 시작한 날을 0 으로 센 오늘. 시작 안 했으면 -1 */
export function journeyDay(s: JourneyState, today: string): number {
  if (!s.start) return -1;
  const t = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
  return Math.round((t(today) - t(s.start)) / 86_400_000);
}

/** 여정 중인지: 시작했고, 그만 보지 않았고, 이레 안이고, 다 해 보지 않았다 */
export function journeyActive(s: JourneyState, today: string): boolean {
  const day = journeyDay(s, today);
  return day >= 0 && day < JOURNEY_DAYS && !s.skipped && s.tried.length < JOURNEY_STEPS.length;
}

/**
 * 오늘 권할 것: 오늘까지 열린 것(첫날 하나, 하루에 하나씩 더) 가운데 아직 안 해 본 첫 것.
 * 앞날 것을 먼저 해 봤으면 그날은 그 앞에 남은 것을 권한다. 다 했으면 undefined (오늘 몫 끝)
 */
export function todayStep(s: JourneyState, today: string): JourneyStep | undefined {
  if (!journeyActive(s, today)) return undefined;
  const day = journeyDay(s, today);
  return JOURNEY_STEPS.slice(0, day + 1).find((step) => !s.tried.includes(step));
}

/** 펫이 오늘 권해도 되는지: 여정 중이고 권할 것이 있고 오늘 아직 안 권했다 */
export function canNudge(s: JourneyState, today: string): boolean {
  return todayStep(s, today) !== undefined && s.nudged !== today;
}

/** 권했다고 적는다 */
export const markNudged = (s: JourneyState, today: string): JourneyState => ({ ...s, nudged: today });

/**
 * 해 봤다. 여정 중에 처음 해 본 것이면 코인을 준다(reward). 여정 밖(시작 전, 그만 봄, 지남)이면 아무것도 안 바꾼다.
 * 이번에 마지막 하나였으면 finished 를 오늘로 (다 해 봤다고 한 번 축하)
 */
export function tryStep(
  s: JourneyState,
  step: JourneyStep,
  today: string,
): { state: JourneyState; reward: boolean; finished: boolean } {
  if (!journeyActive(s, today) || s.tried.includes(step)) return { state: s, reward: false, finished: false };
  const tried = JOURNEY_STEPS.filter((x) => x === step || s.tried.includes(x));
  const finished = tried.length === JOURNEY_STEPS.length;
  return { state: { ...s, tried, ...(finished ? { finished: today } : {}) }, reward: true, finished };
}

/** 여정을 시작한다 (첫 안내를 마쳤을 때). 이미 시작했으면 그대로 */
export const startJourney = (s: JourneyState, today: string): JourneyState =>
  s.start ? s : { ...s, start: today };

export interface JourneyView {
  /** 몇째 날 (1~7) */
  day: number;
  steps: { id: JourneyStep; tried: boolean; open: boolean }[];
  /** 오늘 권할 것 */
  today?: JourneyStep;
  /** 오늘 다 해 봤다 (완주한 날에 축하 칸을 보인다) */
  finishedToday: boolean;
  /** 받은 코인 합 */
  coins: number;
}

/** 패널 오늘 탭 칸. 보일 것이 없으면(여정 밖, 다 하고 하루 지남) undefined */
export function journeyView(s: JourneyState, today: string): JourneyView | undefined {
  const finishedToday = s.finished === today && !s.skipped;
  if (!journeyActive(s, today) && !finishedToday) return undefined;
  const day = Math.min(JOURNEY_DAYS, journeyDay(s, today) + 1);
  const next = todayStep(s, today);
  return {
    day,
    steps: JOURNEY_STEPS.map((id, i) => ({ id, tried: s.tried.includes(id), open: i < day })),
    ...(next ? { today: next } : {}),
    finishedToday,
    coins: s.tried.length * JOURNEY_COINS,
  };
}

/**
 * 예전부터 쓰던 사람도 여정을 시작할지: 저장 파일이 없고(이 판에서 처음 켬), 처음 켠 날이 이틀 안이면.
 * 처음 켠 날을 모르면(기록 없음) 시작한다
 */
export function shouldStartLate(firstDay: string | null, today: string): boolean {
  return firstDay === null || firstDay >= plusDays(today, -2);
}
