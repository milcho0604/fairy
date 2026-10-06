// 상점 (v1). 기획서 "게임 규칙": 먹이, 장난감, 집 업그레이드, 커스텀 먹이. 코인은 일을 끝낼 때만 생기고 펫을 돌보는 데만 쓴다.
import type { Db } from './db-schema.ts';
import { COIN, FULLNESS, type TodoStore } from './todo-store.ts';

export interface Food {
  key: string;
  name: string;
  cost: number;
  /** 오르는 배부름 */
  gain: number;
  /** 오르는 기분 */
  mood: number;
  /** 커스텀 먹이 그림 파일 이름 (pets/ 안) */
  image?: string;
}

export const FOODS: readonly Food[] = [
  { key: 'basic', name: '기본 먹이', cost: COIN.food, gain: FULLNESS.perFood, mood: 0 },
  { key: 'snack', name: '간식', cost: 12, gain: 35, mood: 5 },
  { key: 'cake', name: '케이크', cost: 30, gain: 100, mood: 15 },
];

export interface Toy {
  key: string;
  name: string;
  cost: number;
  hint: string;
}

export const TOYS: readonly Toy[] = [
  { key: 'ball', name: '공', cost: 30, hint: '공을 던져 주면 쫓아가서 물어 와.' },
  { key: 'yarn', name: '털실 뭉치', cost: 60, hint: '공 대신 털실로 놀아. 더 신나해.' },
  { key: 'cushion', name: '쿠션', cost: 100, hint: '앉을 때 쿠션 위에 앉아.' },
];

/** 집 단계 값: 1단계 200, 2단계 500, 3단계 1,000 */
export const HOUSE_COSTS = [200, 500, 1000] as const;
export const HOUSE_NAMES = ['작은 집', '창 있는 집', '마당 있는 집'] as const;

/** 커스텀 먹이 만들기 값 (한 번). 먹일 때는 기본 먹이 값 */
export const CUSTOM_FOOD_COST = 50;
export const CUSTOM_FOOD_MAX = 6;

export interface ShopState {
  balance: number;
  toys: Record<string, boolean>;
  houseLevel: number;
  customFoods: Food[];
}

export type BuyResult = { ok: true } | { ok: false; error: string };

interface ItemRow {
  key: string;
  kind: string;
  name: string;
  image: string | null;
  count: number;
}

export class ItemStore {
  #db: Db;
  #todos: TodoStore;

  constructor(db: Db, todos: TodoStore) {
    this.#db = db;
    this.#todos = todos;
  }

  #rows(): ItemRow[] {
    return this.#db.prepare('select key, kind, name, image, count from item order by id').all() as ItemRow[];
  }

  state(): ShopState {
    const rows = this.#rows();
    const toys: Record<string, boolean> = {};
    for (const t of TOYS) toys[t.key] = rows.some((r) => r.key === t.key && r.count > 0);
    return {
      balance: this.#todos.balance(),
      toys,
      houseLevel: Number(rows.find((r) => r.key === 'house')?.count ?? 0),
      customFoods: rows
        .filter((r) => r.kind === 'food' && r.count > 0)
        .map((r) => ({
          key: r.key,
          name: r.name,
          cost: COIN.food,
          gain: FULLNESS.perFood,
          mood: 3,
          image: r.image ?? undefined,
        })),
    };
  }

  owns(key: string): boolean {
    return this.state().toys[key] === true;
  }

  /** 먹이 찾기: 기본 먹이 셋과 커스텀 먹이 */
  food(key: string): Food | undefined {
    return FOODS.find((f) => f.key === key) ?? this.state().customFoods.find((f) => f.key === key);
  }

  #put(kind: string, key: string, name: string, image: string | null, count: number, now: number) {
    this.#db
      .prepare(
        `insert into item (kind, key, name, image, count, created_at) values (?, ?, ?, ?, ?, ?)
         on conflict(key) do update set count = excluded.count, name = excluded.name, image = coalesce(excluded.image, image)`,
      )
      .run(kind, key, name, image, count, now);
  }

  buyToy(key: string, now: number): BuyResult {
    const toy = TOYS.find((t) => t.key === key);
    if (!toy) return { ok: false, error: '없는 장난감이야.' };
    if (this.owns(key)) return { ok: false, error: '이미 있어.' };
    if (!this.#todos.spend(toy.cost, `toy:${key}`, now))
      return { ok: false, error: `코인이 ${toy.cost}개 있어야 해.` };
    this.#put('toy', key, toy.name, null, 1, now);
    return { ok: true };
  }

  /** 다음 단계 집 */
  buyHouse(now: number): BuyResult {
    const level = this.state().houseLevel;
    const cost = HOUSE_COSTS[level];
    if (cost === undefined) return { ok: false, error: '이미 가장 좋은 집이야.' };
    if (!this.#todos.spend(cost, `house:${level + 1}`, now))
      return { ok: false, error: `코인이 ${cost}개 있어야 해.` };
    this.#put('house', 'house', HOUSE_NAMES[level] ?? '집', null, level + 1, now);
    return { ok: true };
  }

  /** 커스텀 먹이 만들기 (그림 파일은 부르는 쪽이 저장해 두고 이름만 준다). 코인이 모자라면 실패 */
  makeCustomFood(name: string, image: string, now: number): BuyResult & { key?: string } {
    const clean = name.replace(/\s+/g, ' ').trim().slice(0, 12);
    if (!clean) return { ok: false, error: '먹이 이름을 지어 줘.' };
    if (this.state().customFoods.length >= CUSTOM_FOOD_MAX)
      return { ok: false, error: `커스텀 먹이는 ${CUSTOM_FOOD_MAX}개까지야. 하나를 지우고 만들어 줘.` };
    if (!this.#todos.spend(CUSTOM_FOOD_COST, 'custom-food', now))
      return { ok: false, error: `코인이 ${CUSTOM_FOOD_COST}개 있어야 해.` };
    const key = `custom-${now.toString(36)}`;
    this.#put('food', key, clean, image, 1, now);
    return { ok: true, key };
  }

  /** 커스텀 먹이 지우기. 지운 그림 파일 이름을 돌려준다 (부르는 쪽이 파일을 지운다). 코인은 돌려주지 않는다 */
  removeCustomFood(key: string): string | undefined {
    const row = this.#rows().find((r) => r.key === key && r.kind === 'food');
    if (!row) return undefined;
    this.#db.prepare('delete from item where key = ?').run(key);
    return row.image ?? undefined;
  }
}
