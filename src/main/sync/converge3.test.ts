// 수렴 시험: 두 기기에서 무작위 편집을 섞은 뒤 맞추면 두 저장 파일의 맞추는 칸이 같아야 한다.
// 씨앗을 고정해 같은 순서가 다시 나온다 (실패하면 씨앗과 차이를 보인다).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Db } from '../../shared/db-schema.ts';
import { localDay } from '../../shared/todo-store.ts';
import { type Dev, FakeSyncServer, newDevice, pair, settle, snapshot } from './harness.ts';

const DAY = 86_400_000;

/** 작은 무작위 수 생성기 (mulberry32) */
function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (n: number) => Math.floor(next() * n),
    pick: <T>(list: readonly T[]): T | undefined => list[Math.floor(next() * list.length)],
    chance: (p: number) => next() < p,
  };
}

const ids = (db: Db, sql: string): number[] =>
  (db.prepare(sql).all() as { id: number }[]).map((r) => Number(r.id));

function diff(a: string, b: string): string {
  const x = new Set(a.split('\n'));
  const y = new Set(b.split('\n'));
  const onlyA = [...x].filter((l) => !y.has(l)).slice(0, 6);
  const onlyB = [...y].filter((l) => !x.has(l)).slice(0, 6);
  return `A 에만:\n${onlyA.join('\n')}\nB 에만:\n${onlyB.join('\n')}`;
}

function edit(d: Dev, r: ReturnType<typeof rng>, step: number): void {
  const now = Date.now() + step;
  const todo = () => r.pick(ids(d.db, 'select id from todo where deleted_at is null'));
  const trashed = () =>
    r.pick(ids(d.db, 'select id from todo where deleted_at is not null and auto_removed = 0'));
  const note = () => r.pick(ids(d.db, 'select id from note where deleted_at is null'));
  const event = () => r.pick(ids(d.db, "select id from event where deleted_at is null and source = 'local'"));
  const tick = r.int(32);
  const t = todo();
  const n = note();
  const e = event();
  switch (tick) {
    case 0:
    case 1:
      d.todos.add(
        {
          title: `할 일 ${r.int(1000)}`,
          ...(r.chance(0.6) ? { due: localDay(now + r.int(5) * DAY) } : {}),
          ...(r.chance(0.2) ? { repeat: r.pick(['daily', 'weekly'] as const) ?? 'daily' } : {}),
          important: r.chance(0.3),
        },
        now,
      );
      break;
    case 2:
      if (t) d.todos.update(t, { title: `제목 ${r.int(1000)}` }, now);
      break;
    case 3:
      if (t) d.todos.update(t, { due: localDay(now + r.int(9) * DAY), important: r.chance(0.5) }, now);
      break;
    case 4:
    case 5:
      if (t) d.todos.complete(t, now);
      break;
    case 6:
      if (t) d.todos.undo(t, now);
      break;
    case 7:
      if (t) d.todos.remove(t, now);
      break;
    case 8: {
      const x = trashed();
      if (x) d.todos.restoreFromTrash(x);
      break;
    }
    case 9: {
      const x = trashed();
      if (x) d.todos.purge([x]);
      break;
    }
    case 10:
      if (t) d.todos.addStep(t, `단계 ${r.int(100)}`, now);
      break;
    case 11: {
      const s = r.pick(ids(d.db, 'select id from todo_step'));
      if (s) d.todos.toggleStep(s);
      break;
    }
    case 12: {
      const s = r.pick(ids(d.db, 'select id from todo_step'));
      if (s) r.chance(0.5) ? d.todos.renameStep(s, `새 단계 ${r.int(100)}`) : d.todos.removeStep(s);
      break;
    }
    case 13:
      if (t) d.todos.pin(t, r.chance(0.6), now);
      break;
    case 14:
      if (t) d.todos.update(t, { reminds: r.chance(0.5) ? [60, 1440] : [30] }, now);
      break;
    case 15:
    case 16:
      d.notes.add({ title: `메모 ${r.int(1000)}`, body: `본문 ${r.int(1000)}` }, now);
      break;
    case 17:
      if (n) d.notes.update(n, { body: `본문 ${r.int(1000)}` }, now);
      break;
    case 18: {
      const cur = n ? d.notes.get(n) : undefined;
      if (n && cur) d.notes.update(n, { body: `${cur.body}\n줄 ${r.int(1000)}` }, now);
      break;
    }
    case 19:
      if (n) d.notes.update(n, { title: `메모 제목 ${r.int(1000)}` }, now);
      break;
    case 20:
      if (n) d.notes.remove(n, now);
      break;
    case 21: {
      const x = r.pick(ids(d.db, 'select id from note where deleted_at is not null'));
      if (x) r.chance(0.5) ? d.notes.restore(x) : d.notes.purge(x);
      break;
    }
    case 22:
      if (n) d.notes.pin(n, r.chance(0.6), now);
      break;
    case 23:
      d.events.add(
        {
          title: `일정 ${r.int(1000)}`,
          startAt: now + (1 + r.int(20)) * DAY,
          reminds: r.chance(0.5) ? [30] : [60, 10],
        },
        now,
      );
      break;
    case 24:
      if (r.chance(0.15))
        d.events.add(
          {
            title: `반복 ${r.int(1000)}`,
            startAt: now + DAY * (1 + r.int(3)),
            repeat: 'weekly',
            reminds: [10],
          },
          now,
        );
      break;
    case 25:
      if (e) {
        try {
          d.events.update(
            e,
            {
              title: `일정 제목 ${r.int(1000)}`,
              ...(r.chance(0.5) ? { reminds: [r.pick([5, 15, 60]) ?? 5] } : {}),
            },
            now,
          );
        } catch {
          // 같은 반복의 같은 시각 자리 충돌 등은 앱도 거절한다
        }
      }
      break;
    case 26:
      if (e) d.events.remove(e, now);
      break;
    case 27: {
      const x = r.pick(
        ids(d.db, "select id from event where deleted_at is not null and removed_by = 'user'"),
      );
      if (x) {
        try {
          if (r.chance(0.5)) d.events.restore(x);
          else d.events.purgeTrash(x, now);
        } catch {
          // 자리 충돌
        }
      }
      break;
    }
    case 28:
      if (e) d.events.pin(e, r.chance(0.6), now);
      break;
    case 29: {
      // 반복 회차 하나를 고친다
      const occ = r.pick(
        ids(
          d.db,
          'select id from event where repeat_series is not null and repeat_series <> id and deleted_at is null',
        ),
      );
      if (occ) {
        try {
          d.events.update(occ, { title: `이번만 ${r.int(100)}` }, now);
        } catch {
          // 자리 충돌
        }
      }
      break;
    }
    default:
      break;
  }
}

async function scenario3(seed: number, ops: number, o: { offline?: boolean } = {}): Promise<void> {
  const server = new FakeSyncServer();
  const { a, b, code } = await pair(server);
  const c = newDevice(server, 'C');
  assert.equal((await c.engine.enable()).ok, true);
  assert.equal((await c.engine.enterCode(code)).ok, true);
  const devs = [a, b, c];
  const r = rng(seed);
  // 기기마다 독립으로 오프라인처럼 굴기: 서버를 끄는 대신 그 기기는 run 을 건너뛴다
  const away = new Set<Dev>();
  for (let i = 0; i < ops; i++) {
    const d = r.pick(devs) as Dev;
    edit(d, r, i);
    const roll = r.next();
    if (roll < 0.1 && !away.has(d)) await d.engine.run(true);
    else if (roll < 0.14) {
      for (const x of devs) if (!away.has(x)) await x.engine.run(true);
    } else if (o.offline && roll < 0.25) {
      const x = r.pick(devs) as Dev;
      away.has(x) ? away.delete(x) : away.add(x);
    }
  }
  await settle(devs, 10);
  const s = devs.map((d) => snapshot(d.db));
  for (let i = 1; i < 3; i++)
    assert.equal(s[0], s[i], `씨앗 ${seed}: 기기 ${i} 달라짐\n${diff(s[0] as string, s[i] as string)}`);
  for (const d of devs) {
    assert.equal(d.engine.view().pending, 0, `씨앗 ${seed}: ${d.name} 보낼 것 남음`);
    assert.equal(
      d.engine.view().held,
      0,
      `씨앗 ${seed}: ${d.name} 보류 ${JSON.stringify(d.engine.holds().map((h) => [h.kind, h.reason]))}`,
    );
  }
  const head = server.head;
  await settle(devs, 2);
  assert.equal(server.head, head, `씨앗 ${seed}: 맞춘 뒤에도 되풀이해 올린다`);
}

// 기본은 씨앗 12개. 더 돌리려면 SYNC_SEEDS=1200 node --test src/main/sync/converge3.test.ts (SYNC_ONLY=씨앗 하나만)
const extra = Number(process.env.SYNC_SEEDS ?? 12);
for (const seed of process.env.SYNC_ONLY
  ? [Number(process.env.SYNC_ONLY)]
  : Array.from({ length: extra }, (_, i) => 5000 + i)) {
  test(`3대 수렴 씨앗 ${seed}`, async () => {
    await scenario3(seed, 300, { offline: seed % 2 === 0 });
  });
}
