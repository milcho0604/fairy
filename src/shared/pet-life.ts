// 펫의 하루 (v1): 삐짐 게이지, 기분, 친밀도. 기획서 "삐짐 게이지", "게임 규칙 > 펫 상태 수치".
// 잃는 것은 없다: 코인, 친밀도는 줄지 않고 삐짐은 모습과 대사뿐이다.
import type { Db } from './db-schema.ts';
import { FULLNESS, localDay } from './todo-store.ts';

/** 순한맛은 4칸에서 멈추고, 매운맛은 7칸까지 */
export const SULK_MILD_MAX = 4;
export const SULK_MAX = 7;
/** 화해 보너스: 한 칸에 4코인, 최대 28. 7일에 한 번 */
export const MAKEUP_PER_LEVEL = 4;
export const MAKEUP_COOLDOWN_MS = 7 * 86_400_000;
/** 친밀도 단계: 넘을 때마다 새 대사가 열린다 */
export const AFFECTION_STEPS = [100, 300, 600] as const;

export const SULK_LINES: Record<number, string> = {
  1: '...왔어?',
  2: '어제도 안 왔더라. 흥',
  3: '나 혼자 밥 먹었어',
  4: '할 일 목록에 먼지 쌓이는 중',
  5: '5일. 내가 세고 있었어',
  6: '옛날 사진 정리 중. 너랑 찍은 거',
  7: '이제 안 기다릴 거야... 아마도',
};

export type Activity = 'todo' | 'click' | 'chat' | 'feed' | 'pet' | 'play';

/** 활동마다 기분, 친밀도가 오르는 양 */
const GAIN: Record<Activity, { mood: number; affection: number }> = {
  todo: { mood: 6, affection: 2 },
  click: { mood: 1, affection: 0 },
  chat: { mood: 2, affection: 1 },
  feed: { mood: 4, affection: 1 },
  pet: { mood: 8, affection: 1 },
  play: { mood: 10, affection: 2 },
};

function plusDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y ?? 2000, (m ?? 1) - 1, (d ?? 1) + n)).toISOString().slice(0, 10);
}
const weekday = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay();

/**
 * 마지막 활동 날 다음 날부터 어제까지, 쉬는 날을 뺀 날 수 = 찰 칸 수. 오늘은 아직 세지 않는다.
 * 예: 금요일에 쓰고 월요일에 오면(토, 일 쉬는 날) 0칸. 순한맛이면 4칸에서 멈춘다.
 */
export function sulkLevel(
  lastActive: string | null,
  today: string,
  restDays: readonly number[],
  spicy: boolean,
): number {
  if (!lastActive || lastActive >= today) return 0;
  const cap = spicy ? SULK_MAX : SULK_MILD_MAX;
  let n = 0;
  for (let d = plusDays(lastActive, 1); d < today && n < cap; d = plusDays(d, 1)) {
    if (!restDays.includes(weekday(d))) n++;
  }
  return n;
}

export function makeupCoins(level: number): number {
  return Math.min(SULK_MAX, Math.max(0, level)) * MAKEUP_PER_LEVEL;
}

export interface LifeState {
  sulk: number;
  mood: number;
  affection: number;
  /** 오늘 삐짐 대사를 이미 했는지 */
  sulkSaidToday: boolean;
}

export interface ActivityResult {
  /** 화해했으면 그 전 칸 수와 받은 코인 */
  madeUp?: { level: number; coins: number };
  /** 친밀도가 이번에 넘은 단계 */
  affectionStep?: number;
}

interface Row {
  mood: number;
  mood_day: string | null;
  affection: number;
  last_active_day: string | null;
  sulk: number;
  sulk_said_day: string | null;
  petted_day: string | null;
  fed_day: string | null;
  makeup_at: number | null;
}

export class PetLife {
  #db: Db;
  #day: (ms: number) => string;

  constructor(db: Db, day: (ms: number) => string = localDay) {
    this.#db = db;
    this.#day = day;
  }

  #row(now: number): Row {
    this.#db
      .prepare('insert or ignore into pet_state (id, fullness, fullness_at) values (1, ?, ?)')
      .run(FULLNESS.start, now);
    return this.#db
      .prepare(
        'select mood, mood_day, affection, last_active_day, sulk, sulk_said_day, petted_day, fed_day, makeup_at from pet_state where id = 1',
      )
      .get() as Row;
  }

  /**
   * 지금 상태. 날이 바뀌었으면 기분을 50 으로 되돌리고, 비운 날만큼 삐짐을 채운다(이미 찬 칸은 줄이지 않는다).
   * 처음 쓰는 날(마지막 활동이 없으면)은 오늘을 마지막 활동으로 둔다.
   */
  state(now: number, restDays: readonly number[], spicy: boolean): LifeState {
    const today = this.#day(now);
    const r = this.#row(now);
    if (!r.last_active_day) {
      this.#db.prepare('update pet_state set last_active_day = ? where id = 1').run(today);
      r.last_active_day = today;
    }
    let mood = r.mood;
    if (r.mood_day !== today) {
      mood = 50;
      this.#db.prepare('update pet_state set mood = 50, mood_day = ? where id = 1').run(today);
    }
    const level = Math.max(r.sulk, sulkLevel(r.last_active_day, today, restDays, spicy));
    // 매운맛을 끄면 4칸으로 내린다
    const sulk = spicy ? level : Math.min(level, SULK_MILD_MAX);
    if (sulk !== r.sulk) this.#db.prepare('update pet_state set sulk = ? where id = 1').run(sulk);
    return { sulk, mood, affection: r.affection, sulkSaidToday: r.sulk_said_day === today };
  }

  markSulkSaid(now: number): void {
    this.#db.prepare('update pet_state set sulk_said_day = ? where id = 1').run(this.#day(now));
  }

  /**
   * 활동. 삐짐이 더 차지 않게 마지막 활동 날을 오늘로 두고, 기분과 친밀도를 올린다.
   * 할 일을 끝내거나, 같은 날 쓰다듬기와 밥 주기를 둘 다 하면 화해: 0칸, 보너스 코인(7일에 한 번).
   * 보너스 코인은 부르는 쪽이 장부에 넣는다 (TodoStore 가 장부를 갖고 있다).
   */
  activity(kind: Activity, now: number): ActivityResult {
    const today = this.#day(now);
    const r = this.#row(now);
    const gain = GAIN[kind];
    // 문질러서 친밀도를 쌓지 못하게, 기분이 꽉 찬(100) 뒤의 쓰다듬기는 친밀도를 올리지 않는다.
    const before = r.affection;
    const affection = kind === 'pet' && r.mood >= 100 ? before : before + gain.affection;
    const mood = Math.min(100, (r.mood_day === today ? r.mood : 50) + gain.mood);
    const petted = kind === 'pet' ? today : r.petted_day;
    const fed = kind === 'feed' ? today : r.fed_day;
    this.#db
      .prepare(
        `update pet_state set last_active_day = ?, mood = ?, mood_day = ?, affection = ?,
         petted_day = ?, fed_day = ? where id = 1`,
      )
      .run(today, mood, today, affection, petted, fed);

    const result: ActivityResult = {};
    const step = AFFECTION_STEPS.find((s) => before < s && affection >= s);
    if (step) result.affectionStep = step;

    const makesUp = kind === 'todo' || (petted === today && fed === today);
    if (r.sulk > 0 && makesUp) {
      const canBonus = r.makeup_at === null || now - r.makeup_at >= MAKEUP_COOLDOWN_MS;
      const coins = canBonus ? makeupCoins(r.sulk) : 0;
      this.#db
        .prepare(
          'update pet_state set sulk = 0, makeup_at = case when ? then ? else makeup_at end where id = 1',
        )
        .run(canBonus ? 1 : 0, now);
      result.madeUp = { level: r.sulk, coins };
    }
    return result;
  }
}
