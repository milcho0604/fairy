// 플래너가 15초마다 깨지 않고 다음 때에 깬다 (planner-wake.ts). 예전 15초 틱과 같은 일을 같은 순서로 하는지 본다
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { type Db, migrate } from './db-schema.ts';
import { EventStore } from './event-store.ts';
import {
  nextMinuteTurn,
  onTick,
  PLAN_MAX_SLEEP_MS,
  PLAN_MIN_SLEEP_MS,
  PLAN_TICK_MS,
  wakeDelay,
  wakeNow,
} from './planner-wake.ts';
import { nextFireAt } from './remind.ts';
import { localDay, TodoStore } from './todo-store.ts';

const MIN = 60_000;
const at = (y: number, mo: number, d: number, h: number, mi = 0, s = 0) =>
  new Date(y, mo - 1, d, h, mi, s).getTime();

/** 시간대를 잠깐 바꿔 돌린다 (Node 는 TZ 를 바꾸면 바로 따른다) */
function inZone<T>(tz: string, f: () => T): T {
  const was = process.env.TZ;
  process.env.TZ = tz;
  try {
    return f();
  } finally {
    if (was === undefined) delete process.env.TZ;
    else process.env.TZ = was;
  }
}

test('다음 문턱: 문턱을 넘는 분, 없으면 다음 날 0시', () => {
  inZone('Asia/Seoul', () => {
    const now = at(2026, 10, 12, 4, 59, 30);
    assert.equal(nextMinuteTurn(now, [5 * 60, 20 * 60]), at(2026, 10, 12, 5, 0));
    // 문턱 바로 그 분이면 다음 문턱
    assert.equal(nextMinuteTurn(at(2026, 10, 12, 5, 0, 1), [5 * 60, 20 * 60]), at(2026, 10, 12, 20, 0));
    // 문턱이 없거나 다 지났으면 날이 바뀔 때
    assert.equal(nextMinuteTurn(at(2026, 10, 12, 23, 59, 10), []), at(2026, 10, 13, 0, 0));
    assert.equal(
      nextMinuteTurn(at(2026, 10, 12, 21, 0), [5 * 60, 20 * 60, -100, 3000]),
      at(2026, 10, 13, 0, 0),
    );
  });
});

test('서머타임: 없는 시각의 문턱은 시계가 건너뛴 때, 되풀이되는 시각은 일찍 한 번 더 깬다', () => {
  inZone('America/New_York', () => {
    // 2026-03-08 02:00 → 03:00. 02:30 문턱은 03:00 (분이 180 이 되어 150 을 넘는 때)
    const spring = nextMinuteTurn(at(2026, 3, 8, 1, 50), [2 * 60 + 30]);
    assert.equal(new Date(spring).getHours(), 3);
    assert.equal(spring - at(2026, 3, 8, 1, 50), 10 * MIN);
    // 그날 0시 + 24시간은 다음 날 0시가 아니다: 날이 바뀌는 때를 시계로 찾는다
    assert.equal(nextMinuteTurn(at(2026, 3, 8, 23, 30), []), at(2026, 3, 9, 0, 0));
    // 2026-11-01 02:00 → 01:00. 01:30 문턱은 처음 01:30 에 넘고
    const first = at(2026, 11, 1, 0, 50);
    const fall = nextMinuteTurn(first, [90]);
    assert.equal(fall - first, 40 * MIN);
    // 넘은 뒤에는 시계가 01:00 으로 돌아가는 때 한 번 더 깬다 (다시 물어도 같은 답이라 해가 없다), 그 다음은 다시 01:30
    const back = nextMinuteTurn(fall + 5 * MIN, [90]);
    assert.equal(new Date(back).getHours(), 1);
    assert.equal(new Date(back).getMinutes(), 0);
    assert.equal(back - fall, 30 * MIN);
    assert.equal(nextMinuteTurn(back, [90]) - back, 30 * MIN);
    // 25시간 날도 다음 날 0시
    assert.equal(nextMinuteTurn(at(2026, 11, 1, 23, 0), []), at(2026, 11, 2, 0, 0));
  });
});

test('깰 때까지: 기다리는 것이 있으면 예전 틱, 아니면 다음 때까지 (1초에서 1분 사이)', () => {
  const now = 1_000_000;
  assert.equal(wakeDelay(now, true, now + 3 * MIN), PLAN_TICK_MS);
  assert.equal(wakeDelay(now, false, now + 20_000), 20_000);
  assert.equal(wakeDelay(now, false, now + 3 * MIN), PLAN_MAX_SLEEP_MS);
  assert.equal(wakeDelay(now, false, undefined), PLAN_MAX_SLEEP_MS);
  assert.equal(wakeDelay(now, false, now - 5000), PLAN_MIN_SLEEP_MS);
});

test('다음 알림 때: 아직 말하지 않은 것 중 now 뒤 가장 이른 것', () => {
  const anchor = { kind: 'time' as const, at: 10 * 60 * MIN };
  const marks = [
    { before: 60, notifiedAt: 1 },
    { before: 30, notifiedAt: null },
    { before: 10, notifiedAt: null },
    { before: 0, notifiedAt: 0 },
  ];
  assert.equal(nextFireAt(anchor, marks, 0), anchor.at - 30 * MIN);
  assert.equal(nextFireAt(anchor, marks, anchor.at - 30 * MIN), anchor.at - 10 * MIN);
  assert.equal(nextFireAt(anchor, marks, anchor.at), undefined);
});

test('깨서 바로 틱: 때가 됐거나, 잠자기나 시계 바꾸기로 벽시계가 튀었거나, 시간대가 바뀌었을 때', () => {
  const armed = { wall: 1_000_000, mono: 500, zone: 'Asia/Seoul|-540' };
  const base = { dueAt: 1_000_000 + 10 * MIN, armed };
  // 1분 자고 깸: 아직 때가 아니다
  assert.equal(wakeNow({ ...base, now: 1_000_000 + MIN, mono: 500 + MIN, zone: armed.zone }), false);
  // 때가 됨 (조금 이르게 깨도)
  assert.equal(wakeNow({ ...base, now: base.dueAt - 50, mono: 500 + 10 * MIN, zone: armed.zone }), true);
  // 잠자기: 단조 시계는 1분, 벽시계는 3시간 (맥, 리눅스는 자는 동안 단조 시계가 멈춘다)
  assert.equal(wakeNow({ ...base, now: 1_000_000 + 180 * MIN, mono: 500 + MIN, zone: armed.zone }), true);
  // 시계를 뒤로 30분
  assert.equal(wakeNow({ ...base, now: 1_000_000 - 29 * MIN, mono: 500 + MIN, zone: armed.zone }), true);
  // 시간대 바꾸기
  assert.equal(wakeNow({ ...base, now: 1_000_000 + MIN, mono: 500 + MIN, zone: 'Europe/Paris|-120' }), true);
});

test('예전 틱 자리로 올리기', () => {
  assert.equal(onTick(1000, 1000), 1000);
  assert.equal(onTick(500, 1000), 1000);
  assert.equal(onTick(1001, 1000), 1000 + PLAN_TICK_MS);
  assert.equal(onTick(1000 + PLAN_TICK_MS, 1000), 1000 + PLAN_TICK_MS);
});

/**
 * 알림 많이: 예전 15초 틱과 다음 때에 깨기를 나란히 돌려 같은 알림을 같은 때 같은 순서로 말하는지
 * (다음 때를 예전 틱 자리로 올려서 15초 안에 몰린 알림을 묶는 것도 같다). 시간대는 서울과 뉴욕(서머타임 끝나는 날)
 */
for (const [tz, start] of [
  ['Asia/Seoul', [2026, 10, 12, 8, 0]],
  ['America/New_York', [2026, 10, 31, 20, 0]],
] as const) {
  test(`알림 많이 (${tz}): 다음 때에 깨도 예전 15초 틱과 같은 알림을 같은 순서로`, () => {
    inZone(tz, () => {
      const t0 = at(start[0], start[1], start[2], start[3], start[4]);
      function build() {
        const db = new DatabaseSync(':memory:') as unknown as Db;
        migrate(db);
        const events = new EventStore(db);
        const todos = new TodoStore(db);
        let seed = 7;
        const rand = () => {
          seed = (seed * 1103515245 + 12345) % 2 ** 31;
          return seed / 2 ** 31;
        };
        for (let i = 0; i < 120; i++) {
          const startAt = t0 + Math.floor(rand() * 2 * 24 * 60) * MIN + Math.floor(rand() * 60) * 1000;
          events.add({ title: `일정 ${i}`, startAt, reminds: [60, 10, 0].filter(() => rand() < 0.7) }, t0);
        }
        for (let i = 0; i < 80; i++) {
          const due = localDay(t0 + Math.floor(rand() * 3) * 24 * 60 * MIN);
          const dueMin = rand() < 0.5 ? Math.floor(rand() * 24 * 60) : undefined;
          todos.add(
            {
              title: `할 일 ${i}`,
              due,
              ...(dueMin !== undefined ? { dueMin, reminds: [30, 0] } : { reminds: [-9 * 60] }),
            },
            t0,
          );
        }
        return { events, todos };
      }
      const end = t0 + 3 * 24 * 60 * MIN;
      function speak(s: ReturnType<typeof build>, now: number, log: { key: string; at: number }[]) {
        for (const e of s.events.dueReminders(now)) {
          s.events.markNotified(e.id, now);
          log.push({ key: `e${e.id}`, at: now });
        }
        for (const t of s.todos.dueReminders(now)) {
          s.todos.markNotified(t.id, now);
          log.push({ key: `t${t.id}`, at: now });
        }
      }
      const old = build();
      const oldLog: { key: string; at: number }[] = [];
      for (let now = t0; now <= end; now += PLAN_TICK_MS) speak(old, now, oldLog);
      const neu = build();
      const newLog: { key: string; at: number }[] = [];
      let ticks = 0;
      for (let now = t0; now <= end; ) {
        speak(neu, now, newLog);
        ticks++;
        const next = [neu.events.nextReminderAt(now), neu.todos.nextReminderAt(now)].filter(
          (v): v is number => v !== undefined,
        );
        // 다음 알림 때를 예전 틱 자리로 (플래너는 길어도 1분 자고 깨서 같은 때를 향해 다시 잔다)
        now = next.length ? onTick(Math.min(...next), t0) : end + 1;
      }
      assert.ok(oldLog.length > 100, `알림 수 ${oldLog.length}`);
      assert.deepEqual(newLog, oldLog);
      // 15초 틱은 3일에 17281번, 다음 때에 깨면 알림 수만큼
      assert.ok(ticks < 400, `틱 수 ${ticks}`);
    });
  });
}
