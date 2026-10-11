// 혼잣말과 칭찬 (기획서 "수다 빈도": 수다쟁이만). AI 는 쓰지 않고 정해 둔 대사에서 고른다.
// 시각(아침, 점심, 오후, 저녁, 늦은 밤), 요일(월요일 아침, 금요일 오후, 주말), 오늘 끝낸 할 일 수로 고를 대사를 정하고,
// 앱이 실제로 아는 신호(방금 끝낸 할 일, 오늘 남은 할 일, 다음 일정까지 남은 분, 쉬지 않고 일한 시간,
// 마우스를 많이 움직임, 오래 비웠다 돌아옴, 배고픔, 심심함, 친밀도)로 상황 대사를 더한다. 최근에 한 말은 피한다.
// 2026-10-08 사용자 요청("수다쟁이면 말을 좀 많이"): 30분마다 하던 것을 4~6분마다로, 대사를 크게 늘렸다.
import type { I18nKey } from './i18n/index.ts';

/** 혼잣말 사이 간격 (이 사이에서 고른다. 평균 5분, 시간당 12번쯤) */
export const IDLE_GAP_MS = { min: 3.5 * 60_000, max: 6.5 * 60_000 } as const;
/** 상한이나 다른 말풍선에 막혀 못 했으면 이만큼 뒤에 다시 */
export const IDLE_RETRY_MS = 60_000;
/** 이만큼 최근에 한 대사는 다시 고르지 않는다 (아무 때나 하는 대사 수보다 작아야 늘 고를 게 있다) */
export const IDLE_RECENT = 12;
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
/** 다음 일정 대사는 이 분 사이에서만 (10분 전 알림과 겹치지 않게) */
export const EVENT_SOON_MIN = { from: 15, to: 60 } as const;

export type IdleKey = Extract<I18nKey, `idle.${string}`>;

const ANY: IdleKey[] = [
  'idle.any.1',
  'idle.any.2',
  'idle.any.3',
  'idle.any.4',
  'idle.any.5',
  'idle.any.6',
  'idle.any.7',
  'idle.any.8',
  'idle.any.9',
  'idle.any.10',
  'idle.any.11',
  'idle.any.12',
  'idle.any.13',
  'idle.any.14',
  'idle.any.15',
  'idle.any.16',
];

export interface IdleFacts {
  /** 현지 시각 (ms) */
  now: number;
  /** 오늘 끝낸 할 일 수 */
  doneToday: number;
  /** 가장 최근에 할 일을 끝낸 때 (ms) */
  lastDoneAt?: number;
  /** 오늘까지 마감인데 남은 할 일 수 */
  openToday?: number;
  /** 다음 시각 일정까지 남은 분 (오늘 안) */
  nextEventMin?: number;
  /** 오늘 남은 시각 일정 수 */
  eventsLeftToday?: number;
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
  if (minute >= 22 * 60 || minute < 5 * 60) {
    fit.push('idle.late.1', 'idle.late.2', 'idle.late.3');
    // 새벽 1~5시는 지금 시를 말한다 (늦게까지 일하는 동료에게)
    if (minute >= 60 && minute < 5 * 60) fit.push('idle.night.1', 'idle.night.2');
  } else if (minute < 11 * 60) {
    fit.push('idle.morning.1', 'idle.morning.2', 'idle.morning.3', 'idle.morning.4');
    if (day === 1) fit.push('idle.monday.1', 'idle.monday.2');
  } else if (minute >= 11 * 60 + 30 && minute < 13 * 60 + 30)
    fit.push('idle.lunch.1', 'idle.lunch.2', 'idle.lunch.3');
  else if (minute >= 14 * 60 && minute < 17 * 60) {
    fit.push('idle.afternoon.1', 'idle.afternoon.2', 'idle.afternoon.3', 'idle.afternoon.4');
    if (day === 5) fit.push('idle.friday.1', 'idle.friday.2');
  } else if (minute >= 18 * 60) fit.push('idle.evening.1', 'idle.evening.2', 'idle.evening.3');
  if (weekend && minute >= 9 * 60 && minute < 22 * 60) fit.push('idle.weekend.1', 'idle.weekend.2');
  if (f.doneToday >= 5) fit.push('idle.praise.5');
  else if (f.doneToday >= 3) fit.push('idle.praise.3');
  else if (f.doneToday >= 1) fit.push('idle.praise.1');
  const open = f.openToday ?? 0;
  if (open > 0) fit.push('idle.todo.left.1', 'idle.todo.left.2', 'idle.todo.left.3');
  else if (f.openToday === 0 && f.doneToday > 0) fit.push('idle.todo.clear.1', 'idle.todo.clear.2');
  const soon = f.nextEventMin;
  if (soon !== undefined && soon >= EVENT_SOON_MIN.from && soon <= EVENT_SOON_MIN.to)
    fit.push('idle.event.soon.1', 'idle.event.soon.2', 'idle.event.soon.3');
  else if (f.eventsLeftToday === 0 && minute >= 10 * 60 && minute < 17 * 60)
    fit.push('idle.event.free.1', 'idle.event.free.2');
  if ((f.workedMin ?? 0) >= WORKED_LONG_MIN) fit.push('idle.work.1', 'idle.work.2', 'idle.work.3');
  if (f.mouseBusy) fit.push('idle.mouse.1', 'idle.mouse.2', 'idle.mouse.3');
  if (f.hungry) fit.push('idle.hungry.1', 'idle.hungry.2', 'idle.hungry.3');
  else if (f.mood !== undefined && f.mood < BORED_MOOD) fit.push('idle.play.1', 'idle.play.2', 'idle.play.3');
  if (f.affection !== undefined) {
    if (f.affection >= 600) fit.push('idle.friend.3');
    else if (f.affection >= 300) fit.push('idle.friend.2');
    else if (f.affection >= 100) fit.push('idle.friend.1');
    else fit.push('idle.friend.new');
  }
  if (f.more) fit.push(...f.more);
  // 기억: 어제 일(오전에만), 연속 기록, 이번 주(금요일 오후와 주말), 오늘 집중, 함께한 날
  if ((f.yesterdayDone ?? 0) > 0 && minute >= 5 * 60 && minute < 12 * 60)
    fit.push('idle.memory.yesterday.1', 'idle.memory.yesterday.2');
  if ((f.streak ?? 0) >= MEMORY_MIN.streak) fit.push('idle.streak.1', 'idle.streak.2');
  if ((f.weekDone ?? 0) >= MEMORY_MIN.week && ((day === 5 && minute >= 14 * 60) || weekend))
    fit.push('idle.week.1', 'idle.week.2');
  if ((f.focusMin ?? 0) >= MEMORY_MIN.focusMin) fit.push('idle.focus.1', 'idle.focus.2');
  if ((f.daysTogether ?? 0) >= MEMORY_MIN.together) fit.push('idle.together.1');
  const special = specialDay(d);
  if (special) fit.push(special);
  const now: IdleKey[] = [];
  if (f.lastDoneAt !== undefined && f.now - f.lastDoneAt >= 0 && f.now - f.lastDoneAt <= FRESH_MS)
    now.push('idle.done.1', 'idle.done.2', 'idle.done.3', 'idle.done.4');
  if (f.backAt !== undefined && f.now - f.backAt >= 0 && f.now - f.backAt <= FRESH_MS)
    now.push('idle.back.1', 'idle.back.2', 'idle.back.3');
  // 철 대사는 아무 때나 하는 말에 섞는다 (계절 내내 상황이 아니라 분위기라서)
  const season = seasonOf(d.getMonth());
  const any: IdleKey[] = [...ANY, `idle.season.${season}.1`, `idle.season.${season}.2`];
  return { now, fit, any };
}

/** 대사에 넣는 값 (펫 이름은 부르는 쪽이 넣는다) */
export function idleVars(f: IdleFacts): {
  open: number;
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
    open: f.openToday ?? 0,
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

/** 대사 묶음 이름 (idle.todo.left.2 → todo). 같은 묶음이 연달아 나오지 않게 */
const groupOf = (k: IdleKey) => k.split('.')[1] ?? '';

/** 대사 고르기. 한 번만 할 일을 먼저, 그다음 상황에 맞는 말(10번에 7번), 최근에 한 말과 바로 앞 묶음은 건너뛴다 */
export class IdleTalk {
  #recent: IdleKey[] = [];
  /** 이미 칭찬한 할 일 끝낸 때, 이미 반긴 돌아온 때 */
  #doneSaid: number | undefined;
  #backSaid: number | undefined;
  #undo: (() => void) | undefined;

  pick(f: IdleFacts, rand: () => number = Math.random): IdleKey | undefined {
    const { now, fit, any } = idleCandidates(f);
    const fresh = (list: IdleKey[]) => list.filter((k) => !this.#recent.includes(k));
    const nowFresh = fresh(now).filter((k) =>
      groupOf(k) === 'done' ? f.lastDoneAt !== this.#doneSaid : f.backAt !== this.#backSaid,
    );
    const fitFresh = fresh(fit);
    const anyFresh = fresh(any);
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
    const key = pool[Math.floor(rand() * pool.length)] ?? pool[0];
    if (!key) return undefined;
    const before = { recent: [...this.#recent], done: this.#doneSaid, back: this.#backSaid };
    this.#undo = () => {
      this.#recent = before.recent;
      this.#doneSaid = before.done;
      this.#backSaid = before.back;
    };
    if (groupOf(key) === 'done') this.#doneSaid = f.lastDoneAt;
    if (groupOf(key) === 'back') this.#backSaid = f.backAt;
    this.#recent.push(key);
    if (this.#recent.length > IDLE_RECENT) this.#recent.shift();
    return key;
  }

  /** 최근에 한 말 (앱을 다시 켜도 되풀이하지 않게 메인이 저장한다, main/companion.ts) */
  get recent(): readonly IdleKey[] {
    return this.#recent;
  }

  /** 저장해 둔 최근 말을 되살린다. 모르는 열쇠(대사가 빠진 판)는 버린다 */
  restore(keys: readonly string[], known: (k: string) => k is IdleKey): void {
    this.#recent = keys.filter(known).slice(-IDLE_RECENT);
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
  | 'typing';

export interface TalkEnv {
  /** 수다쟁이인지 */
  chatty: boolean;
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
  if (e.idleSec < TYPING_PAUSE_SEC) return 'typing';
  return undefined;
}

export const idleGapMs = (rand: () => number = Math.random): number =>
  IDLE_GAP_MS.min + Math.min(1, Math.max(0, rand())) * (IDLE_GAP_MS.max - IDLE_GAP_MS.min);

/**
 * 언제 혼잣말을 할지. 때가 되면(4~6분) 막는 것이 없을 때 대사를 고른다.
 * 막혀 있으면 다음 틱(15초)에 다시 보고, 띄우지 못했으면(상한, 다른 말풍선) 1분 뒤에 다시.
 */
export class IdleTalker {
  readonly talk = new IdleTalk();
  #nextAt: number;
  #rand: () => number;

  constructor(now: number, rand: () => number = Math.random) {
    this.#rand = rand;
    this.#nextAt = now + idleGapMs(rand);
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
    if (this.#nextAt - now > IDLE_GAP_MS.max) this.#nextAt = now + idleGapMs(this.#rand);
    if (now < this.#nextAt) return { block: 'wait' };
    const block = talkBlock(env);
    if (block) return { block };
    const f = facts();
    const key = this.talk.pick(f, this.#rand);
    if (!key) return { block: 'wait' };
    this.#nextAt = now + idleGapMs(this.#rand);
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
