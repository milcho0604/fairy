// 상점 (v1). 기획서 "게임 규칙": 먹이, 장난감, 집 업그레이드, 커스텀 먹이. 코인은 일을 끝낼 때만 생기고 펫을 돌보는 데만 쓴다.

import {
  CUSTOM_FOOD_COST,
  FOOD_COSTS,
  HOUSE_COSTS,
  HOUSE_STYLE_COSTS as STYLE_COSTS,
  TOY_COSTS,
} from './coin-rules.ts';
import { cutText } from './cut-text.ts';
import type { Db } from './db-schema.ts';
import { HOUSE_STYLES, type HouseStyle, isHouseStyle } from './house-art.ts';
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
  named({ key: 'basic', cost: FOOD_COSTS.basic, gain: FULLNESS.perFood, mood: 0 }, 'shop.food.basic'),
  named({ key: 'snack', cost: FOOD_COSTS.snack, gain: 35, mood: 5 }, 'shop.food.snack'),
  named({ key: 'cake', cost: FOOD_COSTS.cake, gain: 100, mood: 15 }, 'shop.food.cake'),
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
  toy('ball', TOY_COSTS.ball, 'shop.toy.ball', 'shop.toy.ballHint'),
  toy('yarn', TOY_COSTS.yarn, 'shop.toy.yarn', 'shop.toy.yarnHint'),
  toy('cushion', TOY_COSTS.cushion, 'shop.toy.cushion', 'shop.toy.cushionHint'),
];

/** 집 단계 값 (coin-rules.ts 한 곳에, 서버도 같은 값을 쓴다) */
export { HOUSE_COSTS };

const HOUSE_KEYS = ['shop.house.1', 'shop.house.2', 'shop.house.3', 'shop.house.4', 'shop.house.5'] as const;
/** 집 이름 (단계 0 ~ 4). 지금 말로 읽는다 */
export const houseName = (index: number): string | undefined => {
  const key = HOUSE_KEYS[index];
  return key ? t(key) : undefined;
};

/** 집 모양 값 (한 번 사면 언제든 공짜로 바꾼다. 단계는 그대로). 나무집은 처음부터 있다 */
export const HOUSE_STYLE_COSTS: Readonly<Record<HouseStyle, number>> = STYLE_COSTS;
const STYLE_KEYS = {
  wood: 'shop.style.wood',
  mushroom: 'shop.style.mushroom',
  igloo: 'shop.style.igloo',
  castle: 'shop.style.castle',
} as const satisfies Record<HouseStyle, I18nKey>;
export const houseStyleName = (style: HouseStyle): string => t(STYLE_KEYS[style]);

/** 고른 집 모양이 든 줄과 산 모양 줄의 이름표 */
const STYLE_ROW = 'house-style';
const styleRow = (style: HouseStyle) => `house-style:${style}`;

/** 저장한 고른 모양 검사. 없거나 깨졌거나 안 산 모양이면 나무집 (3단계까지만 있던 옛 저장도 나무집) */
export function parseHouseStyle(saved: unknown, owned: (style: HouseStyle) => boolean): HouseStyle {
  return isHouseStyle(saved) && (saved === 'wood' || owned(saved)) ? saved : 'wood';
}

/** 커스텀 먹이 만들기 값 (한 번). 먹일 때는 기본 먹이 값 */
export { CUSTOM_FOOD_COST };
export const CUSTOM_FOOD_MAX = 6;

export interface ShopState {
  balance: number;
  toys: Record<string, boolean>;
  houseLevel: number;
  /** 지금 집 모양 */
  houseStyle: HouseStyle;
  /** 가진 집 모양 (나무집은 늘 true) */
  houseStyles: Record<HouseStyle, boolean>;
  customFoods: Food[];
}

export type BuyResult = { ok: true } | { ok: false; error: string };

/** 코인 초기화 범위: 코인만(기본), 코인과 산 물건 */
export type CoinResetScope = 'coins' | 'all';
export const isCoinResetScope = (v: unknown): v is CoinResetScope => v === 'coins' || v === 'all';

/**
 * 코인 초기화 결과. coins: 뺀 코인 수, house: 집이 있다가 없어졌는지(집 창을 맞춘다), items: 되돌린 물건 수.
 * changed: 확인 화면이 본 잔액과 지금이 달라 하지 않았다
 */
export type CoinResetResult =
  | { ok: true; coins: number; house: boolean; items: number }
  | { ok: false; changed: true };

/** 되돌릴 것이 없는지: 코인이 0 이고, 산 물건까지 고르면 물건도 없다 (설정의 초기화 단추를 막는다) */
export const nothingToReset = (s: { balance: number; items: number }, scope: CoinResetScope): boolean =>
  s.balance === 0 && (scope === 'coins' || s.items === 0);

/** 초기화로 되돌릴 산 물건 수: 집(단계가 있으면 하나), 산 집 모양(나무집 빼고), 장난감 */
export function ownedCount(s: Pick<ShopState, 'houseLevel' | 'houseStyles' | 'toys'>): number {
  const styles = HOUSE_STYLES.filter((x) => x !== 'wood' && s.houseStyles[x]).length;
  const toys = Object.values(s.toys).filter(Boolean).length;
  return (s.houseLevel > 0 ? 1 : 0) + styles + toys;
}

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
    const houseStyles = {} as Record<HouseStyle, boolean>;
    for (const s of HOUSE_STYLES)
      houseStyles[s] = s === 'wood' || rows.some((r) => r.key === styleRow(s) && r.count > 0);
    return {
      balance: this.#todos.balance(),
      toys,
      houseLevel: Number(rows.find((r) => r.key === 'house')?.count ?? 0),
      houseStyle: parseHouseStyle(rows.find((r) => r.key === STYLE_ROW)?.name, (s) => houseStyles[s]),
      houseStyles,
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
  /** expect: 사는 쪽이 본 단계. 그새 바뀌었으면(두 번 누름) 사지 않는다 */
  buyHouse(now: number, expect?: number): BuyResult {
    const level = this.state().houseLevel;
    if (expect !== undefined && expect !== level) return { ok: false, error: t('panel.retry') };
    const cost = HOUSE_COSTS[level];
    if (cost === undefined) return { ok: false, error: t('shop.err.bestHouse') };
    if (!this.#todos.spend(cost, `house:${level + 1}`, now))
      return { ok: false, error: t('shop.err.needCoins', { n: cost }) };
    this.#put('house', 'house', houseName(level) ?? t('shop.house.generic'), null, level + 1, now);
    return { ok: true };
  }

  /** 집 모양 사기. 사면 바로 그 모양으로 바꾼다. 이미 있으면 바꾸기만 (코인 안 든다) */
  buyHouseStyle(style: unknown, now: number): BuyResult {
    if (!isHouseStyle(style)) return { ok: false, error: t('shop.err.noStyle') };
    const st = this.state();
    if (st.houseLevel <= 0) return { ok: false, error: t('shop.err.needHouse') };
    if (st.houseStyles[style]) return this.setHouseStyle(style, now);
    const cost = HOUSE_STYLE_COSTS[style];
    if (!this.#todos.spend(cost, `house-style:${style}`, now))
      return { ok: false, error: t('shop.err.needCoins', { n: cost }) };
    this.#put('house-style', styleRow(style), houseStyleName(style), null, 1, now);
    return this.setHouseStyle(style, now);
  }

  /** 가진 집 모양으로 바꾸기 (공짜) */
  setHouseStyle(style: unknown, now: number): BuyResult {
    if (!isHouseStyle(style)) return { ok: false, error: t('shop.err.noStyle') };
    if (!this.state().houseStyles[style]) return { ok: false, error: t('shop.err.noStyle') };
    this.#put('house-style', STYLE_ROW, style, null, 1, now);
    return { ok: true };
  }

  /** 커스텀 먹이 만들기 (그림 파일은 부르는 쪽이 저장해 두고 이름만 준다). 코인이 모자라면 실패 */
  makeCustomFood(name: string, image: string, now: number): BuyResult & { key?: string } {
    const clean = cutText(name.replace(/\s+/g, ' ').trim(), 20);
    if (!clean) return { ok: false, error: t('shop.err.foodName') };
    if (this.state().customFoods.length >= CUSTOM_FOOD_MAX)
      return { ok: false, error: t('shop.err.foodMax', { n: CUSTOM_FOOD_MAX }) };
    if (!this.#todos.spend(CUSTOM_FOOD_COST, 'custom-food', now))
      return { ok: false, error: t('shop.err.needCoins', { n: CUSTOM_FOOD_COST }) };
    const key = `custom-${now.toString(36)}`;
    this.#put('food', key, clean, image, 1, now);
    return { ok: true, key };
  }

  /**
   * 코인 초기화. 'coins' 는 코인만 0 으로, 'all' 은 산 물건(집 단계, 집 모양, 장난감)도 처음으로 되돌린다.
   * 직접 만든 먹이는 그림과 이름을 사용자가 지은 것이라 남긴다 (지우기는 상점에서 하나씩).
   * expect: 확인 화면이 보여 준 잔액. 그새 바뀌었으면(다른 창에서 사거나 받음) 하지 않는다 (두 창 대비, buyHouse 와 같다)
   */
  resetCoins(scope: CoinResetScope, now: number, expect?: number): CoinResetResult {
    const before = this.state();
    if (expect !== undefined && expect !== before.balance) return { ok: false, changed: true };
    const items = scope === 'all';
    const coins = this.#todos.resetCoins(now, () => {
      if (items) this.#db.prepare(`delete from item where kind in ('house', 'house-style', 'toy')`).run();
    });
    return {
      ok: true,
      coins,
      house: items && before.houseLevel > 0,
      items: items ? ownedCount(before) : 0,
    };
  }

  /**
   * 산 물건을 서버 모양으로 (기획서 6절 기존 사용자 옮기기, 서버 owned_item): house 는 단계, toy:<이름>, house-style:<모양>.
   * 처음부터 있는 나무집 모양과 직접 만든 먹이(값만 쓰는 물건)는 넣지 않는다
   */
  ownedItems(): Record<string, number> {
    const s = this.state();
    const out: Record<string, number> = {};
    if (s.houseLevel > 0) out.house = s.houseLevel;
    for (const toy of TOYS) if (s.toys[toy.key]) out[`toy:${toy.key}`] = 1;
    for (const style of HOUSE_STYLES) if (style !== 'wood' && s.houseStyles[style]) out[styleRow(style)] = 1;
    return out;
  }

  /**
   * 산 물건을 이 모양에 맞춘다 (서버 정본 맞추기, 거절된 구매 되돌리기). 집 단계, 장난감, 집 모양만 바꾸고
   * 모르는 이름은 넘긴다. 고른 집 모양을 잃으면 나무집으로. 바뀐 것이 있으면 true
   */
  setOwnedItems(items: Readonly<Record<string, number>>, now: number): boolean {
    const before = this.ownedItems();
    let changed = false;
    const level = Math.max(0, Math.min(HOUSE_COSTS.length, Math.floor(items.house ?? 0)));
    if (level !== (before.house ?? 0)) {
      changed = true;
      if (level > 0)
        this.#put('house', 'house', houseName(level - 1) ?? t('shop.house.generic'), null, level, now);
      else this.#db.prepare(`delete from item where key = 'house'`).run();
    }
    for (const toy of TOYS) {
      const key = `toy:${toy.key}`;
      const want = (items[key] ?? 0) > 0;
      if (want === (before[key] ?? 0) > 0) continue;
      changed = true;
      if (want) this.#put('toy', toy.key, toy.name, null, 1, now);
      else this.#db.prepare('delete from item where key = ?').run(toy.key);
    }
    for (const style of HOUSE_STYLES) {
      if (style === 'wood') continue;
      const key = styleRow(style);
      const want = (items[key] ?? 0) > 0;
      if (want === (before[key] ?? 0) > 0) continue;
      changed = true;
      if (want) this.#put('house-style', key, houseStyleName(style), null, 1, now);
      else this.#db.prepare('delete from item where key = ?').run(key);
    }
    // 고른 모양을 더 갖지 않으면 나무집으로 (parseHouseStyle 도 그렇게 읽지만 저장 값도 맞춘다)
    const chosen = this.state().houseStyle;
    const row = this.#rows().find((r) => r.key === STYLE_ROW);
    if (row && row.name !== chosen) this.#put('house-style', STYLE_ROW, chosen, null, 1, now);
    return changed;
  }

  /** 커스텀 먹이 지우기. 지운 그림 파일 이름을 돌려준다 (부르는 쪽이 파일을 지운다). 코인은 돌려주지 않는다 */
  removeCustomFood(key: string): string | undefined {
    const row = this.#rows().find((r) => r.key === key && r.kind === 'food');
    if (!row) return undefined;
    this.#db.prepare('delete from item where key = ?').run(key);
    return row.image ?? undefined;
  }
}
