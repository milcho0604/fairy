import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { type Db, migrate } from './db-schema.ts';
import { makeupCoins, PetLife, SULK_LINES, sulkLevel } from './pet-life.ts';

const DAY = 86_400_000;
const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
// 2026-10-02 금요일 10시
const FRI = Date.UTC(2026, 9, 2, 10);
const WEEKEND = [0, 6];

function fresh() {
  const db = new DatabaseSync(':memory:') as unknown as Db;
  migrate(db);
  return new PetLife(db, utcDay);
}

test('삐짐 칸: 비운 날 수, 오늘은 안 센다, 쉬는 날은 빼고, 순한맛 4 / 매운맛 7 에서 멈춘다', () => {
  assert.equal(sulkLevel('2026-10-02', '2026-10-02', WEEKEND, false), 0);
  assert.equal(sulkLevel('2026-10-02', '2026-10-03', WEEKEND, false), 0); // 토요일에 와도 0
  assert.equal(sulkLevel('2026-10-02', '2026-10-05', WEEKEND, false), 0); // 금 → 월: 주말 빼고 0
  assert.equal(sulkLevel('2026-10-02', '2026-10-07', WEEKEND, false), 2); // 월, 화 비움
  assert.equal(sulkLevel('2026-10-02', '2026-10-07', [], false), 4); // 쉬는 날 없으면 4 에서 멈춤
  assert.equal(sulkLevel('2026-09-01', '2026-10-07', [], true), 7);
  assert.equal(sulkLevel(null, '2026-10-07', [], true), 0);
  assert.equal(makeupCoins(3), 12);
  assert.equal(makeupCoins(9), 28);
  assert.equal(Object.keys(SULK_LINES).length, 7);
});

test('처음 켠 날은 0칸, 사흘 비우면 3칸(쉬는 날 없음), 다시 와도 칸은 그대로', () => {
  const life = fresh();
  assert.equal(life.state(FRI, [], false).sulk, 0);
  const back = FRI + 4 * DAY; // 화요일: 토, 일, 월 비움
  assert.equal(life.state(back, [], false).sulk, 3);
  life.activity('click', back); // 클릭은 화해가 아니다
  assert.equal(life.state(back, [], false).sulk, 3);
  assert.equal(life.state(back + DAY, [], false).sulk, 3); // 활동했으니 더 차지 않는다
});

test('할 일을 끝내면 화해: 0칸과 보너스 코인. 7일 안에 또 화해하면 코인은 없다', () => {
  const life = fresh();
  life.state(FRI, [], false);
  const back = FRI + 4 * DAY;
  life.state(back, [], false);
  assert.deepEqual(life.activity('todo', back).madeUp, { level: 3, coins: 12 });
  assert.equal(life.state(back, [], false).sulk, 0);
  const again = back + 3 * DAY;
  assert.equal(life.state(again, [], false).sulk, 2);
  assert.deepEqual(life.activity('todo', again).madeUp, { level: 2, coins: 0 });
});

test('쓰다듬기와 밥 주기를 같은 날 둘 다 하면 화해', () => {
  const life = fresh();
  life.state(FRI, [], false);
  const back = FRI + 3 * DAY;
  life.state(back, [], false);
  assert.equal(life.activity('pet', back).madeUp, undefined);
  assert.deepEqual(life.activity('feed', back).madeUp, { level: 2, coins: 8 });
});

test('기분은 날이 바뀌면 50, 100 을 넘지 않는다. 친밀도는 쌓이고 단계를 알려 준다', () => {
  const life = fresh();
  assert.equal(life.state(FRI, [], false).mood, 50);
  for (let i = 0; i < 20; i++) life.activity('play', FRI);
  assert.equal(life.state(FRI, [], false).mood, 100);
  assert.equal(life.state(FRI + DAY, [], false).mood, 50);
  let step: number | undefined;
  for (let i = 0; i < 60 && !step; i++) step = life.activity('todo', FRI + DAY).affectionStep;
  assert.equal(step, 100);
  assert.ok(life.state(FRI + DAY, [], false).affection >= 100);
});

test('매운맛을 끄면 4칸으로 내리고, 대사는 하루 한 번', () => {
  const life = fresh();
  life.state(FRI, [], true);
  const back = FRI + 8 * DAY;
  assert.equal(life.state(back, [], true).sulk, 7);
  assert.equal(life.state(back, [], false).sulk, 4);
  assert.equal(life.state(back, [], false).sulkSaidToday, false);
  life.markSulkSaid(back);
  assert.equal(life.state(back, [], false).sulkSaidToday, true);
  assert.equal(life.state(back + DAY, [], false).sulkSaidToday, false);
});
