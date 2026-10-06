// 상점 (v1). 기획서 "게임 규칙": 먹이, 장난감, 집 업그레이드, 커스텀 먹이. 코인은 일을 끝낼 때만 생기고 펫을 돌보는 데만 쓴다.
import type { Db } from './db-schema.ts';
import { type I18nKey, t } from './i18n/index.ts';
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

/** 이름은 지금 말로 읽는다 (getter). 화면은 setLang 뒤에 읽는다 */
function named<T extends object>(item: T, nameKey: I18nKey): T & { readonly name: string } {
  return Object.defineProperty(item, 'name', { get: () => t(nameKey), enumerable: true }) as T & {
    readonly name: string;
  };
}

export const FOODS: readonly Food[] = [
  named({ key: 'basic', cost: COIN.food, gain: FULLNESS.perFood, mood: 0 }, 'shop.food.basic'),
  named({ key: 'snack', cost: 12, gain: 35, mood: 5 }, 'shop.food.snack'),
  named({ key: 'cake', cost: 30, gain: 100, mood: 15 }, 'shop.food.cake'),
];

export interface Toy {
  key: string;
  name: string;
  cost: number;
  hint: string;
}

function toy(key: string, cost: number, nameKey: I18nKey, hintKey: I18nKey): Toy {
  return {
    key,
    cost,
    get name() {
      return t(nameKey);
    },
    get hint() {
      return t(hintKey);
    },
  };
}

export const TOYS: readonly Toy[] = [
  toy('ball', 30, 'shop.toy.ball', 'shop.toy.ballHint'),
  toy('yarn', 60, 'shop.toy.yarn', 'shop.toy.yarnHint'),
  toy('cushion', 100, 'shop.toy.cushion', 'shop.toy.cushionHint'),
];

/** 집 단계 값: 1단계 200, 2단계 500, 3단계 1,000 */
export const HOUSE_COSTS = [200, 500, 1000] as const;
const HOUSE_KEYS = ['shop.house.1', 'shop.house.2', 'shop.house.3'] as const;
/** 집 이름 (단계 0, 1, 2). 지금 말로 읽는다 */
export const houseName = (index: number): string | undefined => {
  const key = HOUSE_KEYS[index];
  return key ? t(key) : undefined;
};

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
    if (!toy) return { ok: false, error: t('shop.err.noToy') };
    if (this.owns(key)) return { ok: false, error: t('shop.err.owned') };
    if (!this.#todos.spend(toy.cost, `toy:${key}`, now))
      return { ok: false, error: t('shop.err.needCoins', { n: toy.cost }) };
    this.#put('toy', key, toy.name, null, 1, now);
    return { ok: true };
  }

  /** 다음 단계 집 */
  buyHouse(now: number): BuyResult {
    const level = this.state().houseLevel;
    const cost = HOUSE_COSTS[level];
    if (cost === undefined) return { ok: false, error: t('shop.err.bestHouse') };
    if (!this.#todos.spend(cost, `house:${level + 1}`, now))
      return { ok: false, error: t('shop.err.needCoins', { n: cost }) };
    this.#put('house', 'house', houseName(level) ?? t('shop.house.generic'), null, level + 1, now);
    return { ok: true };
  }

  /** 커스텀 먹이 만들기 (그림 파일은 부르는 쪽이 저장해 두고 이름만 준다). 코인이 모자라면 실패 */
  makeCustomFood(name: string, image: string, now: number): BuyResult & { key?: string } {
    const clean = name.replace(/\s+/g, ' ').trim().slice(0, 20);
    if (!clean) return { ok: false, error: t('shop.err.foodName') };
    if (this.state().customFoods.length >= CUSTOM_FOOD_MAX)
      return { ok: false, error: t('shop.err.foodMax', { n: CUSTOM_FOOD_MAX }) };
    if (!this.#todos.spend(CUSTOM_FOOD_COST, 'custom-food', now))
      return { ok: false, error: t('shop.err.needCoins', { n: CUSTOM_FOOD_COST }) };
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
