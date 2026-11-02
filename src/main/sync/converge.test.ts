// 수렴 시험: 두 기기에서 무작위 편집을 섞은 뒤 맞추면 두 저장 파일의 맞추는 칸이 같아야 한다.
// 씨앗을 고정해 같은 순서가 다시 나온다 (실패하면 씨앗과 차이를 보인다).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Db } from '../../shared/db-schema.ts';
import { localDay } from '../../shared/todo-store.ts';
import { type Dev, FakeSyncServer, pair, settle, snapshot } from './harness.ts';

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

async function scenario(seed: number, ops: number, o: { offline?: boolean } = {}): Promise<void> {
  const server = new FakeSyncServer();
  const { a, b } = await pair(server);
  const r = rng(seed);
  for (let i = 0; i < ops; i++) {
    const d = r.chance(0.5) ? a : b;
    edit(d, r, i);
    const roll = r.next();
    if (roll < 0.1) await d.engine.run(true);
    else if (roll < 0.14) {
      await a.engine.run(true);
      await b.engine.run(true);
    } else if (o.offline && roll < 0.2) server.online = !server.online;
  }
  server.online = true;
  await settle([a, b], 8);
  const sa = snapshot(a.db);
  const sb = snapshot(b.db);
  if (sa !== sb && process.env.SYNC_DEBUG) {
    const mine = new Map(sa.split('\n').map((l) => [l.split(':')[1] ?? '', l]));
    const theirs = new Map(sb.split('\n').map((l) => [l.split(':')[1] ?? '', l]));
    for (const [uid, l] of [...mine, ...theirs]) {
      if (mine.get(uid) === theirs.get(uid)) continue;
      console.log(
        'DIFF',
        uid,
        '\n A:',
        mine.get(uid)?.slice(0, 400),
        '\n B:',
        theirs.get(uid)?.slice(0, 400),
      );
      for (const d of [a, b]) {
        console.log(
          d.name,
          'holds',
          JSON.stringify(d.engine.holds().map((h) => [h.kind, h.reason, h.uid.slice(0, 6)])),
        );
        const kind = l.split(':')[0];
        console.log(
          d.name,
          JSON.stringify(d.db.prepare(`select * from ${kind} where uid = ?`).all(uid)),
          'seen',
          JSON.stringify(d.db.prepare('select rev from sync_seen where uid = ?').all(uid)),
          'server',
          JSON.stringify([...server.items.entries()].filter(([u]) => u === uid).map(([, i]) => i.rev)),
          'clock',
          JSON.stringify(d.db.prepare('select field, t from sync_clock where uid = ?').all(uid)).slice(
            0,
            300,
          ),
        );
      }
      break;
    }
  }
  assert.equal(sa, sb, `씨앗 ${seed}: 두 기기가 달라졌다\n${diff(sa, sb)}`);
  assert.ok(sa.split('\n').length > 5, '시험이 비어 있지 않다');
  assert.equal(a.engine.view().pending, 0, `씨앗 ${seed}: A 에 보낼 것이 남음`);
  assert.equal(b.engine.view().pending, 0, `씨앗 ${seed}: B 에 보낼 것이 남음`);
  assert.equal(
    a.engine.view().held,
    0,
    `씨앗 ${seed}: A 보류 ${JSON.stringify(a.engine.holds().map((h) => [h.kind, h.reason]))}`,
  );
  assert.equal(
    b.engine.view().held,
    0,
    `씨앗 ${seed}: B 보류 ${JSON.stringify(b.engine.holds().map((h) => [h.kind, h.reason]))}`,
  );
  // 한 번 더 맞춰도 서버 번호가 오르지 않는다 (맴돌지 않는다)
  const head = server.head;
  await settle([a, b], 2);
  assert.equal(server.head, head, `씨앗 ${seed}: 맞춘 뒤에도 서로 되풀이해 올린다`);
}

for (const seed of [1, 2, 3, 4, 5, 6]) {
  test(`수렴: 무작위 편집 300번을 두 기기에서 섞어 맞춘다 (씨앗 ${seed})`, async () => {
    await scenario(seed, 300);
  });
}

test('수렴: 오프라인이 섞여도 같다 (씨앗 21)', async () => {
  await scenario(21, 300, { offline: true });
});

test('수렴: 편집 800번 (씨앗 99)', async () => {
  await scenario(99, 800);
});

// 씨앗을 더 돌려 보려면 SYNC_SEEDS=200 node --test src/main/sync/converge.test.ts
const extra = Number(process.env.SYNC_SEEDS ?? 0);
for (let seed = 1000; seed < 1000 + extra; seed++) {
  test(`수렴 추가 씨앗 ${seed}`, async () => {
    await scenario(seed, 300, { offline: seed % 3 === 0 });
  });
}
