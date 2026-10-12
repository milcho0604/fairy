import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { type Db, migrate } from './db-schema.ts';
import {
  CUSTOM_FOOD_COST,
  CUSTOM_FOOD_MAX,
  FOODS,
  HOUSE_COSTS,
  HOUSE_STYLE_COSTS,
  houseName,
  ItemStore,
  nothingToReset,
  ownedCount,
  parseHouseStyle,
} from './shop.ts';
import { COIN, TodoStore } from './todo-store.ts';

const T0 = Date.UTC(2026, 9, 6, 9);

function fresh(coins: number) {
  const db = new DatabaseSync(':memory:') as unknown as Db;
  migrate(db);
  const todos = new TodoStore(db, (ms) => new Date(ms).toISOString().slice(0, 10));
  todos.reward(coins, 'test', T0);
  return { db, todos, shop: new ItemStore(db, todos) };
}

test('장난감: 코인이 있으면 사고, 두 번은 못 산다, 모자라면 아무것도 안 바뀐다', () => {
  const { todos, shop } = fresh(40);
  assert.deepEqual(shop.buyToy('ball', T0), { ok: true });
  assert.equal(todos.balance(), 10);
  assert.equal(shop.owns('ball'), true);
  assert.equal(shop.buyToy('ball', T0).ok, false);
  const poor = shop.buyToy('cushion', T0);
  assert.equal(poor.ok, false);
  assert.equal(todos.balance(), 10);
  assert.equal(shop.owns('cushion'), false);
  assert.equal(shop.buyToy('rocket', T0).ok, false);
});

test('집: 한 단계씩, 마지막 단계 뒤에는 못 산다', () => {
  const total = HOUSE_COSTS.reduce((a, b) => a + b, 0);
  const { todos, shop } = fresh(total);
  for (let i = 0; i < HOUSE_COSTS.length; i++) assert.deepEqual(shop.buyHouse(T0), { ok: true });
  assert.equal(shop.state().houseLevel, 5);
  assert.equal(todos.balance(), 0);
  assert.equal(shop.buyHouse(T0).ok, false);
});

test('집: 두 번 눌러 옛 단계로 다시 사면 거절하고 코인도 안 가져간다', () => {
  const { todos, shop } = fresh(HOUSE_COSTS[0] + HOUSE_COSTS[1]);
  assert.equal(shop.buyHouse(T0, 0).ok, true);
  assert.equal(shop.buyHouse(T0, 0).ok, false);
  assert.equal(shop.state().houseLevel, 1);
  assert.equal(todos.balance(), HOUSE_COSTS[1]);
});

test('집 단계: 다섯, 값은 점점 오르고 이름이 다 있다', () => {
  assert.equal(HOUSE_COSTS.length, 5);
  for (let i = 1; i < HOUSE_COSTS.length; i++) assert.ok((HOUSE_COSTS[i] ?? 0) > (HOUSE_COSTS[i - 1] ?? 0));
  for (let i = 0; i < HOUSE_COSTS.length; i++) assert.ok(houseName(i));
  assert.equal(houseName(5), undefined);
});

test('옛 저장(3단계, 모양 없음)은 단계 그대로, 나무집, 다음 단계를 살 수 있다', () => {
  const { db, todos, shop } = fresh(HOUSE_COSTS[3]);
  db.prepare(
    "insert into item (kind, key, name, count, created_at) values ('house', 'house', '마당 있는 집', 3, 0)",
  ).run();
  const st = shop.state();
  assert.equal(st.houseLevel, 3);
  assert.equal(st.houseStyle, 'wood');
  assert.deepEqual(st.houseStyles, { wood: true, mushroom: false, igloo: false, castle: false });
  assert.deepEqual(shop.buyHouse(T0, 3), { ok: true });
  assert.equal(shop.state().houseLevel, 4);
  assert.equal(todos.balance(), 0);
});

test('고른 모양 저장 값 검사: 깨졌거나 안 산 모양이면 나무집', () => {
  const owns = (s: string) => s === 'igloo';
  assert.equal(parseHouseStyle('igloo', owns), 'igloo');
  assert.equal(parseHouseStyle('castle', owns), 'wood');
  assert.equal(parseHouseStyle('wood', owns), 'wood');
  for (const bad of [undefined, null, '', 'palace', 3, {}]) assert.equal(parseHouseStyle(bad, owns), 'wood');
});

test('집 모양: 집이 있어야 사고, 사면 바로 바뀌고, 다시 고르면 공짜, 단계는 그대로', () => {
  const { db, todos, shop } = fresh(HOUSE_COSTS[0] + HOUSE_STYLE_COSTS.mushroom + 5);
  assert.equal(shop.buyHouseStyle('mushroom', T0).ok, false, '집이 없다');
  assert.deepEqual(shop.buyHouse(T0, 0), { ok: true });
  assert.equal(shop.buyHouseStyle('palace', T0).ok, false);
  assert.deepEqual(shop.buyHouseStyle('mushroom', T0), { ok: true });
  assert.equal(todos.balance(), 5);
  assert.equal(shop.state().houseStyle, 'mushroom');
  assert.equal(shop.state().houseLevel, 1);
  // 코인이 모자라면 안 바뀐다
  assert.equal(shop.buyHouseStyle('castle', T0).ok, false);
  assert.equal(shop.state().houseStyle, 'mushroom');
  assert.equal(shop.setHouseStyle('castle', T0).ok, false, '안 산 모양');
  // 나무집으로 돌아갔다 다시 버섯집: 코인 안 든다
  assert.deepEqual(shop.buyHouseStyle('wood', T0), { ok: true });
  assert.equal(shop.state().houseStyle, 'wood');
  assert.deepEqual(shop.buyHouseStyle('mushroom', T0), { ok: true });
  assert.equal(todos.balance(), 5);
  // 저장 값이 깨지면 나무집으로
  db.prepare("update item set name = 'palace' where key = 'house-style'").run();
  assert.equal(shop.state().houseStyle, 'wood');
});

test('커스텀 먹이: 50코인, 6개까지, 지우면 그림 이름을 돌려준다', () => {
  const { todos, shop } = fresh(CUSTOM_FOOD_COST * 7);
  const made = shop.makeCustomFood('  귤  ', 'food-a.png', T0);
  assert.equal(made.ok, true);
  assert.equal(todos.balance(), CUSTOM_FOOD_COST * 6);
  const foods = shop.state().customFoods;
  assert.deepEqual(
    foods.map((f) => [f.name, f.image]),
    [['귤', 'food-a.png']],
  );
  assert.equal(shop.food(foods[0]?.key ?? '')?.name, '귤');
  assert.equal(shop.makeCustomFood('   ', 'x.png', T0).ok, false);
  for (let i = 1; i < CUSTOM_FOOD_MAX; i++)
    assert.equal(shop.makeCustomFood(`먹이${i}`, `f${i}.png`, T0 + i).ok, true);
  assert.equal(shop.makeCustomFood('하나 더', 'z.png', T0 + 99).ok, false);
  assert.equal(shop.removeCustomFood(foods[0]?.key ?? ''), 'food-a.png');
  assert.equal(shop.state().customFoods.length, CUSTOM_FOOD_MAX - 1);
});

test('먹이마다 값과 배부름이 다르다', () => {
  const { todos } = fresh(100);
  const cake = FOODS.find((f) => f.key === 'cake');
  assert.ok(cake);
  const r = todos.feed(T0, cake);
  assert.equal(r.ok, true);
  assert.equal(r.fullness, 100);
  assert.equal(todos.balance(), 70);
  assert.equal(todos.spend(80, 'x', T0), false);
  assert.equal(todos.balance(), 70);
});

// ---- 코인 초기화 (설정 > 데이터) ----

test('코인 초기화(코인만): 잔액 0, 산 물건은 그대로, 장부는 지우지 않고 reset 한 줄', () => {
  const { db, todos, shop } = fresh(HOUSE_COSTS[0] + HOUSE_STYLE_COSTS.mushroom + 30 + 77);
  shop.buyHouse(T0);
  shop.buyHouseStyle('mushroom', T0);
  shop.buyToy('ball', T0);
  todos.rewardFocus(T0, 25);
  const rows = (db.prepare('select count(*) as n from coin_log').get() as { n: number }).n;
  const r = shop.resetCoins('coins', T0 + 1);
  assert.deepEqual(r, { ok: true, coins: 77 + 5, house: false, items: 0 });
  assert.equal(todos.balance(), 0);
  const st = shop.state();
  assert.equal(st.houseLevel, 1);
  assert.equal(st.houseStyle, 'mushroom');
  assert.equal(st.toys.ball, true);
  // 장부: 한 줄만 늘고 합은 0. 기록이 세는 집중 행은 남는다
  assert.equal((db.prepare('select count(*) as n from coin_log').get() as { n: number }).n, rows + 1);
  assert.equal(
    (db.prepare(`select amount from coin_log where reason = 'reset'`).get() as { amount: number }).amount,
    -82,
  );
  assert.equal(
    (db.prepare('select coalesce(sum(amount), 0) as s from coin_log').get() as { s: number }).s,
    0,
  );
  assert.equal(todos.coinCount('focus', '2026-10-06'), 1);
});

test('코인 초기화(산 물건도): 집, 집 모양, 장난감은 처음으로, 직접 만든 먹이는 남는다', () => {
  const { todos, shop } = fresh(HOUSE_COSTS[0] + HOUSE_STYLE_COSTS.castle + 30 + 60 + CUSTOM_FOOD_COST + 3);
  shop.buyHouse(T0);
  shop.buyHouseStyle('castle', T0);
  shop.buyToy('ball', T0);
  shop.buyToy('yarn', T0);
  assert.equal(shop.makeCustomFood('떡', 'food-a.png', T0).ok, true);
  const r = shop.resetCoins('all', T0 + 1);
  assert.deepEqual(r, { ok: true, coins: 3, house: true, items: 4 });
  const st = shop.state();
  assert.equal(todos.balance(), 0);
  assert.equal(st.houseLevel, 0);
  assert.equal(st.houseStyle, 'wood');
  assert.deepEqual(st.houseStyles, { wood: true, mushroom: false, igloo: false, castle: false });
  assert.deepEqual(st.toys, { ball: false, yarn: false, cushion: false });
  assert.equal(st.customFoods.length, 1);
  // 다시 사면 처음 값 그대로
  todos.reward(HOUSE_COSTS[0], 'test', T0);
  assert.equal(shop.buyHouse(T0, 0).ok, true);
  assert.equal(shop.state().houseLevel, 1);
});

test('코인 초기화: 0 코인이면 장부에 줄을 더하지 않고, 확인 화면이 본 잔액과 다르면 하지 않는다', () => {
  const { db, todos, shop } = fresh(0);
  const rows = (db.prepare('select count(*) as n from coin_log').get() as { n: number }).n;
  assert.deepEqual(shop.resetCoins('coins', T0, 0), { ok: true, coins: 0, house: false, items: 0 });
  assert.equal((db.prepare('select count(*) as n from coin_log').get() as { n: number }).n, rows);
  todos.reward(10, 'test', T0);
  // 확인 상자를 연 뒤 다른 창(패널)에서 코인이 바뀌었다
  assert.deepEqual(shop.resetCoins('coins', T0, 0), { ok: false, changed: true });
  assert.equal(todos.balance(), 10);
  assert.equal(shop.resetCoins('coins', T0, 10).ok, true);
  assert.equal(todos.balance(), 0);
});

test('코인 초기화 뒤: 하루 상한은 다시 차지 않고, 되돌리기가 없어진 코인을 또 회수하지 않는다', () => {
  const { todos, shop } = fresh(0);
  const a = todos.add({ title: 'a' }, T0);
  for (let i = 0; i < COIN.dailyTodoLimit; i++) todos.complete(todos.add({ title: `t${i}` }, T0).id, T0);
  const b = todos.add({ title: 'b' }, T0);
  shop.resetCoins('coins', T0);
  // 오늘 이미 20개 받았다: 초기화 뒤에도 21번째는 0
  assert.equal(todos.complete(b.id, T0), 0);
  // 초기화 전에 끝낸 할 일을 되돌려도 잔액이 음수가 되거나 새로 번 코인을 가져가지 않는다
  todos.reward(7, 'test', T0);
  const done = todos.list(T0).doneToday.find((x) => x.title === 't0');
  assert.ok(done);
  assert.equal(todos.undo(done.id, T0), 0);
  assert.equal(todos.balance(), 7);
  // 다시 끝내도 예전에 받은 몫은 다시 주지 않는다 (되돌리기, 끝내기로 코인 찍어 내기 막기)
  assert.equal(todos.complete(done.id, T0), 0);
  assert.equal(todos.balance(), 7);
  void a;
});

test('코인 초기화: 묶음 안에서 실패하면 코인도 물건도 그대로', () => {
  const { todos, shop } = fresh(HOUSE_COSTS[0] + 9);
  shop.buyHouse(T0);
  assert.throws(() =>
    todos.resetCoins(T0, () => {
      throw new Error('디스크');
    }),
  );
  assert.equal(todos.balance(), 9);
  assert.equal(shop.state().houseLevel, 1);
});

test('되돌릴 것이 없는지와 산 물건 수', () => {
  assert.equal(nothingToReset({ balance: 0, items: 3 }, 'coins'), true);
  assert.equal(nothingToReset({ balance: 0, items: 3 }, 'all'), false);
  assert.equal(nothingToReset({ balance: 1, items: 0 }, 'coins'), false);
  assert.equal(nothingToReset({ balance: 0, items: 0 }, 'all'), true);
  assert.equal(
    ownedCount({
      houseLevel: 2,
      houseStyles: { wood: true, mushroom: true, igloo: false, castle: true },
      toys: { ball: true, yarn: false, cushion: false },
    }),
    4,
  );
});
