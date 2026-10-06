import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { type Db, migrate } from './db-schema.ts';
import { CUSTOM_FOOD_COST, CUSTOM_FOOD_MAX, FOODS, HOUSE_COSTS, ItemStore } from './shop.ts';
import { TodoStore } from './todo-store.ts';

const T0 = Date.UTC(2026, 9, 6, 9);

function fresh(coins: number) {
  const db = new DatabaseSync(':memory:') as unknown as Db;
  migrate(db);
  const todos = new TodoStore(db, (ms) => new Date(ms).toISOString().slice(0, 10));
  todos.reward(coins, 'test', T0);
  return { todos, shop: new ItemStore(db, todos) };
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
  assert.equal(shop.state().houseLevel, 3);
  assert.equal(todos.balance(), 0);
  assert.equal(shop.buyHouse(T0).ok, false);
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
