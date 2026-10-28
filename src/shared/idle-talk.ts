// 혼잣말과 칭찬 (기획서 "수다 빈도": 가끔 한마디, 수다쟁이). AI 는 쓰지 않고 정해 둔 대사에서 고른다.
// 시각(아침, 점심, 오후, 저녁, 늦은 밤), 요일(월요일 아침, 금요일 오후, 주말), 오늘 끝낸 할 일 수로 고를 대사를 정하고,
// 앱이 실제로 아는 신호(방금 끝낸 할 일, 오늘 남은 할 일, 먼저 할 일, 다음 일정까지 남은 분, 쉬지 않고 일한 시간,
// 마우스를 많이 움직임, 오래 비웠다 돌아옴, 배고픔, 심심함, 기분, 친밀도)로 상황 대사를 더한다.
// 대사 후보는 사전(shared/i18n)에서 번호 규칙(idle.morning.1, idle.morning.2, ...)으로 센다. 사전에 번호를 이어 붙이면
// 코드를 고치지 않아도 후보에 든다 (shared/variants.ts).
// 최근에 한 말은 피하고(풀 크기에 따라 늘어나는 창), 그 밖에도 최근에 많이 한 말일수록 덜 고른다.
// 2026-10-08 사용자 요청("수다쟁이면 말을 좀 많이"): 30분마다 하던 것을 4~6분마다로, 대사를 크게 늘렸다.
import type { I18nKey } from './i18n/index.ts';
import { variantsOf } from './variants.ts';

/** 혼잣말 사이 간격 (수다쟁이: 이 사이에서 고른다. 평균 5분, 시간당 12번쯤) */
export const IDLE_GAP_MS = { min: 3.5 * 60_000, max: 6.5 * 60_000 } as const;
/** 가끔 한마디의 간격 (평균 30분, 시간당 2번쯤) */
export const SOMETIMES_GAP_MS = { min: 20 * 60_000, max: 40 * 60_000 } as const;
/** 상한이나 다른 말풍선에 막혀 못 했으면 이만큼 뒤에 다시 */
export const IDLE_RETRY_MS = 60_000;
/**
 * 이만큼(이상) 최근에 한 대사는 다시 고르지 않는다. 후보가 많으면 후보의 60% 까지 넓어진다 (idleWindow).
 * 아무 때나 하는 대사 수보다 작아야 늘 고를 게 있다
 */
export const IDLE_RECENT = 40;
/** 기억해 두는 최근 대사 수 (많이 한 말을 덜 고르는 데 쓴다. 앱을 다시 켜도 이어진다, main/companion.ts) */
export const IDLE_HISTORY = 160;
/** 입력이 이 초보다 최근이면 타이핑이나 마우스질 중으로 보고 손이 쉴 때까지 기다린다 */
export const TYPING_PAUSE_SEC = 2;
/** 입력이 이 초 넘게 없으면 자리에 없거나 펫이 자는 중이다 (혼잣말 안 함) */
export const IDLE_AWAY_SEC = 60;
/** 방금 끝낸 할 일 칭찬, 돌아온 인사는 이 안에서만 한다 */
export const FRESH_MS = 15 * 60_000;
/** 이만큼 넘게 자리를 비웠다 돌아오면 반긴다 */
export const BACK_AFTER_MIN = 45;
/** 쉬지 않고 이만큼 일하면 "오래 했다" (휴식 권유와 같은 기준: 5분 넘게 비우면 0) */
export const WORKED_LONG_MIN = 75;
/** 최근 MOUSE_WINDOW_MS 동안 커서가 이만큼 넘게 움직이면 마우스가 바쁘다 (틱마다 잰 직선 거리 합) */
export const MOUSE_BUSY_PX = 5000;
export const MOUSE_WINDOW_MS = 2 * 60_000;
/** 기분이 이보다 낮으면 놀고 싶어 한다 */
export const BORED_MOOD = 40;
/** 기분이 이 이상이면 들떠 있고, 이 미만이면 시무룩하다 */
export const HIGH_MOOD = 80;
export const LOW_MOOD = 25;
/** 다음 일정 대사는 이 분 사이에서만 (10분 전 알림과 겹치지 않게) */
export const EVENT_SOON_MIN = { from: 15, to: 60 } as const;

export type IdleKey = Extract<I18nKey, `idle.${string}`>;

/** 사전에서 번호 규칙으로 센 후보 (idle.morning -> idle.morning.1, idle.morning.2, ...) */
const keysOf = (base: string): IdleKey[] => variantsOf(base) as IdleKey[];

export interface IdleFacts {
  /** 현지 시각 (ms) */
  now: number;
  /** 오늘 끝낸 할 일 수 */
  doneToday: number;
  /** 가장 최근에 할 일을 끝낸 때 (ms) */
  lastDoneAt?: number;
  /** 오늘까지 마감인데 남은 할 일 수 */
  openToday?: number;
  /** 마감이 지난 할 일 수 (오늘 마감은 빼고) */
  overdue?: number;
  /** 먼저 할 일 하나의 제목 (말풍선에만 쓴다. 어디로도 보내지 않는다) */
  todoTitle?: string;
  /** 다음 시각 일정까지 남은 분 (오늘 안) */
  nextEventMin?: number;
  /** 오늘 남은 시각 일정 수 */
  eventsLeftToday?: number;
  /** 일정을 쓰는 사람인지 (최근 보름 안팎에 일정이 하나라도 있다). 아니면 "일정이 없어" 말은 하지 않는다 */
  eventsUsed?: boolean;
  /** 쉬지 않고 일한 분 */
  workedMin?: number;
  /** 오래 비웠다 돌아온 때 (ms) */
  backAt?: number;
  /** 마우스를 많이 움직이는 중 */
  mouseBusy?: boolean;
  /** 친밀도 */
  affection?: number;
  /** 기분 0~100 */
  mood?: number;
  /** 배고픔 */
  hungry?: boolean;
  /** 다른 쪽(기운 등)에서 넣는 상황 대사. 상황 대사와 같이 고른다 */
  more?: readonly IdleKey[];
  // ---- 기억 (main/companion.ts memoryFacts): 펫이 지난 일을 기억하고 말한다 ----
  /** 어제 끝낸 할 일 수 */
  yesterdayDone?: number;
  /** 할 일을 끝낸 날 연속 기록 (쉬는 날은 건너뜀, shared/achieve.ts streak) */
  streak?: number;
  /** 이번 주(월요일부터) 끝낸 할 일 수 */
  weekDone?: number;
  /** 오늘 집중 타이머로 집중한 분 */
  focusMin?: number;
  /** 처음 만난 날을 1일째로 센 오늘 (함께한 날) */
  daysTogether?: number;
}

/** 기억 대사 기준: 연속 이만큼부터, 이번 주 이만큼부터, 집중 이만큼(분)부터 */
export const MEMORY_MIN = { streak: 2, week: 3, focusMin: 25, together: 2 } as const;

/** 철 (북반구). month 는 Date.getMonth() 처럼 0 이 1월. 1월 1일, 12월 24~25일, 12월 31일은 따로 특별한 날 대사 */
export function seasonOf(month: number): 'spring' | 'summer' | 'autumn' | 'winter' {
  if (month >= 2 && month <= 4) return 'spring';
  if (month >= 5 && month <= 7) return 'summer';
  if (month >= 8 && month <= 10) return 'autumn';
  return 'winter';
}

function specialDay(d: Date): IdleKey | undefined {
  const m = d.getMonth() + 1;
  const day = d.getDate();
  if (m === 1 && day === 1) return 'idle.special.newyear';
  if (m === 12 && (day === 24 || day === 25)) return 'idle.special.christmas';
  if (m === 12 && day === 31) return 'idle.special.yearend';
  return undefined;
}

/** 지금 할 만한 대사들. now 는 한 번만 할 일(방금 끝냄, 돌아옴), fit 은 지금 상황에 맞는 것, any 는 아무 때나 하는 것 */
export function idleCandidates(f: IdleFacts): { now: IdleKey[]; fit: IdleKey[]; any: IdleKey[] } {
  const d = new Date(f.now);
  const minute = d.getHours() * 60 + d.getMinutes();
  const day = d.getDay();
  const weekend = day === 0 || day === 6;
  const fit: IdleKey[] = [];
  const add = (...bases: string[]) => {
    for (const b of bases) fit.push(...keysOf(b));
  };
  if (minute >= 22 * 60 || minute < 5 * 60) {
    add('idle.late');
    // 새벽 1~5시는 지금 시를 말한다 (늦게까지 일하는 동료에게)
    if (minute >= 60 && minute < 5 * 60) add('idle.night');
  } else if (minute < 11 * 60) {
    add('idle.morning');
    if (day === 1) add('idle.monday');
  } else if (minute >= 11 * 60 + 30 && minute < 13 * 60 + 30) add('idle.lunch');
  else if (minute >= 14 * 60 && minute < 17 * 60) {
    add('idle.afternoon');
    if (day === 5) add('idle.friday');
  } else if (minute >= 18 * 60) add('idle.evening');
  if (weekend && minute >= 9 * 60 && minute < 22 * 60) add('idle.weekend');
  if (f.doneToday >= 5) add('idle.praise.5');
  else if (f.doneToday >= 3) add('idle.praise.3');
  else if (f.doneToday >= 1) add('idle.praise.1');
  const open = f.openToday ?? 0;
  if (open > 0) {
    add('idle.todo.left');
    if (f.todoTitle) add('idle.todo.title');
  } else if (f.openToday === 0 && f.doneToday > 0) add('idle.todo.clear');
  if ((f.overdue ?? 0) > 0) add('idle.todo.late');
  const soon = f.nextEventMin;
  if (soon !== undefined && soon >= EVENT_SOON_MIN.from && soon <= EVENT_SOON_MIN.to) add('idle.event.soon');
  else if (f.eventsUsed && f.eventsLeftToday === 0 && minute >= 10 * 60 && minute < 17 * 60)
    add('idle.event.free');
  if ((f.workedMin ?? 0) >= WORKED_LONG_MIN) add('idle.work');
  if (f.mouseBusy) add('idle.mouse');
  if (f.hungry) add('idle.hungry');
  else if (f.mood !== undefined && f.mood < BORED_MOOD) add('idle.play');
  if (f.mood !== undefined) {
    if (f.mood >= HIGH_MOOD) add('idle.mood.high');
    else if (f.mood < LOW_MOOD) add('idle.mood.low');
  }
  if (f.affection !== undefined) {
    if (f.affection >= 600) add('idle.friend.3');
    else if (f.affection >= 300) add('idle.friend.2');
    else if (f.affection >= 100) add('idle.friend.1');
    else add('idle.friend.new');
  }
  if (f.more) fit.push(...f.more);
  // 기억: 어제 일(오전에만), 연속 기록, 이번 주(금요일 오후와 주말), 오늘 집중, 함께한 날
  if ((f.yesterdayDone ?? 0) > 0 && minute >= 5 * 60 && minute < 12 * 60) add('idle.memory.yesterday');
  if ((f.streak ?? 0) >= MEMORY_MIN.streak) add('idle.streak');
  if ((f.weekDone ?? 0) >= MEMORY_MIN.week && ((day === 5 && minute >= 14 * 60) || weekend)) add('idle.week');
  if ((f.focusMin ?? 0) >= MEMORY_MIN.focusMin) add('idle.focus');
  if ((f.daysTogether ?? 0) >= MEMORY_MIN.together) add('idle.together');
  const special = specialDay(d);
  if (special) fit.push(special);
  const now: IdleKey[] = [];
  if (f.lastDoneAt !== undefined && f.now - f.lastDoneAt >= 0 && f.now - f.lastDoneAt <= FRESH_MS)
    now.push(...keysOf('idle.done'));
  if (f.backAt !== undefined && f.now - f.backAt >= 0 && f.now - f.backAt <= FRESH_MS)
    now.push(...keysOf('idle.back'));
  // 철 대사는 아무 때나 하는 말에 섞는다 (계절 내내 상황이 아니라 분위기라서)
  const season = seasonOf(d.getMonth());
  const any: IdleKey[] = [...keysOf('idle.any'), ...keysOf(`idle.season.${season}`)];
  return { now, fit, any };
}

/** 대사에 넣는 값 (펫 이름은 부르는 쪽이 넣는다) */
export function idleVars(f: IdleFacts): {
  done: number;
  open: number;
  late: number;
  todo: string;
  eventMin: number;
  workedH: number;
  yesterday: number;
  streak: number;
  week: number;
  focusMin: number;
  days: number;
  hour: number;
} {
  return {
    done: f.doneToday,
    open: f.openToday ?? 0,
    late: f.overdue ?? 0,
    todo: clipTitle(f.todoTitle ?? ''),
    eventMin: Math.max(1, Math.round(f.nextEventMin ?? 0)),
    workedH: Math.max(1, Math.floor((f.workedMin ?? 0) / 60)),
    yesterday: f.yesterdayDone ?? 0,
    streak: f.streak ?? 0,
    week: f.weekDone ?? 0,
    focusMin: Math.round(f.focusMin ?? 0),
    days: f.daysTogether ?? 0,
    hour: new Date(f.now).getHours(),
  };
}

const TITLE_MAX = 24;
/** 할 일 제목은 말풍선 한 줄에 들어가게 자른다 (줄바꿈, 따옴표, 중괄호는 걷는다) */
function clipTitle(title: string): string {
  const one = title
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[{}"]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const chars = [...one];
  return chars.length > TITLE_MAX ? `${chars.slice(0, TITLE_MAX - 1).join('')}\u2026` : one;
}

/** 대사 묶음 이름 (idle.todo.left.2 -> todo). 같은 묶음이 연달아 나오지 않게 */
const groupOf = (k: IdleKey) => k.split('.')[1] ?? '';

/**
 * 하루 동안 바뀌지 않는 사실을 말하는 묶음: 함께한 날, 연속 기록, 어제 일, 이번 주, 특별한 날, 철, 친밀도.
 * 하루에 한 번만 한다. 최근 말만 피하면 수다쟁이(시간당 12번쯤)에서 한 시간마다 되풀이돼
 * "같이 지낸 지 9일째야"가 하루 여덟 번, 연속 기록이 열두 번, "우리 꽤 친해졌지?"가 아홉 번 나왔다 (2026-10-13 하루 돌려 보기)
 */
export const ONCE_A_DAY = ['together', 'streak', 'memory', 'week', 'special', 'season', 'friend'] as const;
const onceADay = (k: IdleKey) => (ONCE_A_DAY as readonly string[]).includes(groupOf(k));
const dayOf = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};

/**
 * 상황이 하루 내내 이어져 되풀이되던 대사: 남은 할 일, 오래 일함, 배고픔. 수다쟁이(시간당 12번쯤)에서 최근 말만 피하면
 * 하루 5~6번 같은 말을 했다 (이슈 #65). 하루 perDay 번까지, 앞에 한 뒤 gapMs 가 지나야 다시 한다
 */
export const SITUATION_CAP = { perDay: 2, gapMs: 2 * 60 * 60_000 } as const;
/** 상황마다 따로 정한 상한 (없으면 SITUATION_CAP). 일정 없음은 하루 한 번, 칭찬은 자주 하되 간격을 둔다 */
const CAPS: Record<string, { perDay: number; gapMs: number }> = {
  'event.free': { perDay: 1, gapMs: 0 },
  'event.soon': { perDay: 3, gapMs: 40 * 60_000 },
  praise: { perDay: 4, gapMs: 30 * 60_000 },
  mood: { perDay: 2, gapMs: 3 * 60 * 60_000 },
  mouse: { perDay: 2, gapMs: 60 * 60_000 },
};
/** 횟수를 세는 묶음 (idle.todo.left.2 -> todo.left. 다 끝냄 todo.clear 는 세지 않는다) */
const situationOf = (k: IdleKey): string | undefined => {
  const [, a, b] = k.split('.');
  if (a === 'todo' && (b === 'left' || b === 'title' || b === 'late')) return 'todo.left';
  if (a === 'work' || a === 'hungry' || a === 'praise' || a === 'mood' || a === 'mouse') return a;
  if (a === 'event') return b === 'free' ? 'event.free' : 'event.soon';
  return undefined;
};
const capOf = (situ: string) => CAPS[situ] ?? SITUATION_CAP;

/** 후보 수에 맞춘 "최근 말" 창: 후보의 60% 이상은 건너뛴다 (최소 IDLE_RECENT) */
export const idleWindow = (poolSize: number): number => Math.max(IDLE_RECENT, Math.ceil(poolSize * 0.6));

/** 대사 고르기. 한 번만 할 일을 먼저, 그다음 상황에 맞는 말(10번에 7번), 최근에 한 말과 바로 앞 묶음은 건너뛴다 */
export class IdleTalk {
  #recent: IdleKey[] = [];
  /** 이미 칭찬한 할 일 끝낸 때, 이미 반긴 돌아온 때 */
  #doneSaid: number | undefined;
  #backSaid: number | undefined;
  /** 하루 한 번 묶음(ONCE_A_DAY)을 말한 날 */
  #daySaid = new Map<string, string>();
  /** 상황 대사(CAPS)를 말한 날, 그날 횟수, 마지막 때 */
  #situSaid = new Map<string, { day: string; n: number; at: number }>();
  #undo: (() => void) | undefined;

  pick(f: IdleFacts, rand: () => number = Math.random): IdleKey | undefined {
    const { now, fit, any } = idleCandidates(f);
    const today = dayOf(f.now);
    const capped = (k: IdleKey) => {
      const g = situationOf(k);
      const said = g ? this.#situSaid.get(g) : undefined;
      if (!g || !said || said.day !== today) return false;
      const cap = capOf(g);
      return said.n >= cap.perDay || f.now - said.at < cap.gapMs;
    };
    const size = new Set<IdleKey>([...fit, ...any]).size;
    const skipped = new Set(this.#recent.slice(-idleWindow(size)));
    // 방금 끝낸 일, 돌아옴은 변형이 적어서 좁은 창만 본다 (그래도 칭찬이 바로 같은 말로 되풀이되지 않게)
    const skippedNow = new Set(this.#recent.slice(-Math.min(6, Math.max(0, now.length - 1))));
    const fresh = (list: IdleKey[], skip: Set<IdleKey>) =>
      list.filter(
        (k) => !skip.has(k) && !(onceADay(k) && this.#daySaid.get(groupOf(k)) === today) && !capped(k),
      );
    const nowFresh = fresh(now, skippedNow).filter((k) =>
      groupOf(k) === 'done' ? f.lastDoneAt !== this.#doneSaid : f.backAt !== this.#backSaid,
    );
    const fitFresh = fresh(fit, skipped);
    const anyFresh = fresh(any, skipped);
    // 바로 앞 두 번과 같은 묶음은 다른 게 있으면 피한다 (배고프다는 말이 연달아 나오지 않게). 없으면 바로 앞 하나만
    const groups = this.#recent.map(groupOf);
    const avoid = [groups.slice(-2), groups.slice(-1)];
    let pool: IdleKey[] = nowFresh;
    if (pool.length === 0) {
      const fitFirst = fitFresh.length > 0 && (anyFresh.length === 0 || rand() < 0.7);
      const order = fitFirst ? [fitFresh, anyFresh] : [anyFresh, fitFresh];
      const choices = avoid.flatMap((skip) =>
        order.map((list) => list.filter((k) => !skip.includes(groupOf(k)))),
      );
      pool = choices.find((list) => list.length > 0) ?? order[0] ?? [];
    }
    // 후보가 다 최근에 한 말이면 가장 오래전에 한 말부터 (조건에 막힌 것은 뺀다)
    if (pool.length === 0) {
      const all = fresh([...new Set<IdleKey>([...fit, ...any])], new Set());
      const last = (k: IdleKey) => this.#recent.lastIndexOf(k);
      const oldest = all.reduce((m, k) => Math.min(m, last(k)), Number.POSITIVE_INFINITY);
      pool = all.filter((k) => last(k) === oldest);
    }
    const key = this.#weighted(pool, rand);
    if (!key) return undefined;
    const before = {
      recent: [...this.#recent],
      done: this.#doneSaid,
      back: this.#backSaid,
      daySaid: new Map(this.#daySaid),
      situSaid: new Map(this.#situSaid),
    };
    this.#undo = () => {
      this.#recent = before.recent;
      this.#doneSaid = before.done;
      this.#backSaid = before.back;
      this.#daySaid = before.daySaid;
      this.#situSaid = before.situSaid;
    };
    if (groupOf(key) === 'done') this.#doneSaid = f.lastDoneAt;
    if (groupOf(key) === 'back') this.#backSaid = f.backAt;
    if (onceADay(key)) this.#daySaid.set(groupOf(key), today);
    const situ = situationOf(key);
    if (situ) {
      const prev = this.#situSaid.get(situ);
      this.#situSaid.set(situ, { day: today, n: prev?.day === today ? prev.n + 1 : 1, at: f.now });
    }
    this.#recent.push(key);
    if (this.#recent.length > IDLE_HISTORY) this.#recent.shift();
    return key;
  }

  /** 기억해 둔 최근 기록에서 많이 한 말일수록 덜 고른다 (가중치 1 / (1 + 한 횟수)) */
  #weighted(pool: IdleKey[], rand: () => number): IdleKey | undefined {
    if (pool.length <= 1) return pool[0];
    const count = new Map<IdleKey, number>();
    for (const k of this.#recent) count.set(k, (count.get(k) ?? 0) + 1);
    const weights = pool.map((k) => 1 / (1 + (count.get(k) ?? 0)));
    let r = rand() * weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < pool.length; i++) {
      r -= weights[i] ?? 0;
      if (r < 0) return pool[i];
    }
    return pool[pool.length - 1];
  }

  /** 최근에 한 말 (앱을 다시 켜도 되풀이하지 않게 메인이 저장한다, main/companion.ts) */
  get recent(): readonly IdleKey[] {
    return this.#recent;
  }

  /** 저장해 둔 최근 말을 되살린다. 모르는 열쇠(대사가 빠진 판)는 버린다 */
  restore(keys: readonly string[], known: (k: string) => k is IdleKey): void {
    this.#recent = keys.filter(known).slice(-IDLE_HISTORY);
  }

  /** 고른 말을 띄우지 못했다 (상한, 다른 말풍선). 고르기 전으로 돌린다 */
  undo(): void {
    this.#undo?.();
    this.#undo = undefined;
  }
}

/** 혼잣말을 막는 까닭 */
export type TalkBlock =
  | 'level'
  | 'briefing'
  | 'focus'
  | 'hidden'
  | 'locked'
  | 'away'
  | 'busy'
  | 'sulk'
  | 'quiet'
  | 'typing';

export interface TalkEnv {
  /** 혼잣말을 하는 단계인지 (가끔 한마디, 수다쟁이) */
  chatty: boolean;
  /** 말 안 하는 시간 (shared/quiet-hours.ts) */
  quiet?: boolean;
  /** 오늘 브리핑이 떠 있다 */
  briefing?: boolean;
  /** 집중 타이머 중 (펫이 잔다) */
  focusing: boolean;
  /** 펫이 숨었다 (사용자가 숨김, 발표, 집에서 쉬는 중) */
  hidden: boolean;
  /** 화면 잠금 */
  locked: boolean;
  /** 마지막 입력 뒤 초 */
  idleSec: number;
  /** 놀이, 숨바꼭질 중 */
  busy?: boolean;
  /** 삐짐 칸 (삐진 날은 혼잣말 대신 삐짐 대사만) */
  sulk?: number;
}

/** 지금 혼잣말을 하면 안 되는 까닭. 없으면 undefined */
export function talkBlock(e: TalkEnv): TalkBlock | undefined {
  if (!e.chatty) return 'level';
  if (e.briefing) return 'briefing';
  if (e.focusing) return 'focus';
  if (e.hidden) return 'hidden';
  if (e.locked) return 'locked';
  if (e.idleSec > IDLE_AWAY_SEC) return 'away';
  if (e.busy) return 'busy';
  if ((e.sulk ?? 0) > 0) return 'sulk';
  if (e.quiet) return 'quiet';
  if (e.idleSec < TYPING_PAUSE_SEC) return 'typing';
  return undefined;
}

export interface GapRange {
  readonly min: number;
  readonly max: number;
}

export const idleGapMs = (rand: () => number = Math.random, gap: GapRange = IDLE_GAP_MS): number =>
  gap.min + Math.min(1, Math.max(0, rand())) * (gap.max - gap.min);

/**
 * 언제 혼잣말을 할지. 때가 되면(4~6분) 막는 것이 없을 때 대사를 고른다.
 * 막혀 있으면 다음 틱(15초)에 다시 보고, 띄우지 못했으면(상한, 다른 말풍선) 1분 뒤에 다시.
 */
export class IdleTalker {
  readonly talk = new IdleTalk();
  #nextAt: number;
  #rand: () => number;
  #gap: GapRange;

  constructor(now: number, rand: () => number = Math.random, gap: GapRange = IDLE_GAP_MS) {
    this.#rand = rand;
    this.#gap = gap;
    this.#nextAt = now + idleGapMs(rand, gap);
  }

  /** 혼잣말 사이 간격을 바꾼다 (수다 빈도를 바꿨을 때). 이미 정한 다음 때가 새 간격보다 멀면 due 가 다시 잡는다 */
  setGap(gap: GapRange): void {
    this.#gap = gap;
  }

  get nextAt(): number {
    return this.#nextAt;
  }

  /** 지금 말할 대사. 때가 아니면 'wait', 막혔으면 그 까닭 */
  due(
    now: number,
    env: TalkEnv,
    facts: () => IdleFacts,
  ): { key: IdleKey; facts: IdleFacts } | { block: TalkBlock | 'wait' } {
    // 시계를 뒤로 돌렸으면 기다림이 길어지지 않게 다시 잡는다
    if (this.#nextAt - now > this.#gap.max) this.#nextAt = now + idleGapMs(this.#rand, this.#gap);
    if (now < this.#nextAt) return { block: 'wait' };
    const block = talkBlock(env);
    if (block) return { block };
    const f = facts();
    const key = this.talk.pick(f, this.#rand);
    if (!key) return { block: 'wait' };
    this.#nextAt = now + idleGapMs(this.#rand, this.#gap);
    return { key, facts: f };
  }

  /** 띄웠는지. 못 띄웠으면 고른 말을 되돌리고 1분 뒤에 다시 */
  shown(now: number, ok: boolean): void {
    if (ok) return;
    this.talk.undo();
    this.#nextAt = now + IDLE_RETRY_MS;
  }
}

/**
 * 틱마다 입력과 커서를 보고 쉬지 않고 일한 시간, 오래 비웠다 돌아온 때, 마우스가 바쁜지를 센다.
 * 잠자기나 시계 바꾸기로 틱 사이가 10분 넘게 비면 그동안 자리를 비운 것으로 본다.
 */
export class ActivityWatch {
  #last: number | undefined;
  #workFrom: number | undefined;
  #awayFrom: number | undefined;
  #backAt: number | undefined;
  #cursor: { x: number; y: number } | undefined;
  #moves: { at: number; d: number }[] = [];

  observe(now: number, idleSec: number, cursor?: { x: number; y: number }): void {
    const gap = this.#last === undefined ? 0 : now - this.#last;
    this.#last = now;
    const idleFrom = now - idleSec * 1000;
    if (gap > 10 * 60_000 || gap < 0) {
      this.#awayFrom ??= now - Math.max(0, gap);
      this.#workFrom = undefined;
    }
    if (idleSec >= BACK_AFTER_MIN * 60) this.#awayFrom ??= idleFrom;
    if (idleSec >= 5 * 60) this.#workFrom = undefined;
    if (idleSec < IDLE_AWAY_SEC) {
      if (this.#awayFrom !== undefined) {
        if (idleFrom - this.#awayFrom >= BACK_AFTER_MIN * 60_000) this.#backAt = now;
        this.#awayFrom = undefined;
      }
      this.#workFrom ??= now;
    }
    if (cursor) {
      const prev = this.#cursor;
      this.#cursor = cursor;
      if (prev && gap <= 60_000)
        this.#moves.push({ at: now, d: Math.hypot(cursor.x - prev.x, cursor.y - prev.y) });
    }
    this.#moves = this.#moves.filter((m) => now - m.at <= MOUSE_WINDOW_MS && now >= m.at);
  }

  workedMin(now: number): number {
    return this.#workFrom === undefined ? 0 : Math.max(0, Math.floor((now - this.#workFrom) / 60_000));
  }

  get backAt(): number | undefined {
    return this.#backAt;
  }

  mouseBusy(): boolean {
    return this.#moves.reduce((sum, m) => sum + m.d, 0) >= MOUSE_BUSY_PX;
  }
}
