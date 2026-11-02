// 동기화 시험 도구: 메모리 가짜 서버(server/src/sync.ts 와 같은 규칙)와 저장 파일을 가진 가짜 기기.
// 시험 파일(*.test.ts)만 부른다. 앱 번들에는 들어가지 않는다.
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { type Db, migrate } from '../../shared/db-schema.ts';
import { EventStore } from '../../shared/event-store.ts';
import { NoteStore } from '../../shared/note-store.ts';
import { SYNC_KINDS } from '../../shared/sync-fields.ts';
import { TodoStore } from '../../shared/todo-store.ts';
import type {
  ApiResult,
  SyncChanges,
  SyncKeyBody,
  SyncKeyView,
  SyncPushed,
  SyncPushItem,
} from '../server-api.ts';
import { createSyncEngine, type SyncEngine, type SyncServerApi, type SyncState } from './engine.ts';
import { readItem } from './rows.ts';

const fail = <T>(status: number, error: string, body: Record<string, unknown> = {}): ApiResult<T> => ({
  ok: false,
  status,
  error,
  body: { error, ...body },
});
const ok = <T>(data: T): ApiResult<T> => ({ ok: true, status: 200, data });

interface Item {
  rev: number;
  blob: string;
  deleted: boolean;
}

/** 서버 한 계정의 사본 (server/src/sync.ts 의 규칙: 낙관적 잠금, epoch, gen, key_rev, 상한) */
export class FakeSyncServer {
  key: { salt: string; params: SyncKeyView['params']; wrapped: string; gen: number; keyRev: number } | null =
    null;
  epoch = 0;
  head = 0;
  hasHead = false;
  items = new Map<string, Item>();
  online = true;
  featureOn = true;
  maxItems = 100_000;
  calls: string[] = [];
  /** 다음 호출을 이 값으로 대신한다 (오류 흉내) */
  inject: ((name: string) => ApiResult<never> | undefined) | undefined;

  private gate<T>(name: string): ApiResult<T> | undefined {
    this.calls.push(name);
    if (!this.online) return fail(0, 'offline');
    if (!this.featureOn) return fail(403, 'feature_off');
    return this.inject?.(name);
  }

  snapshotKeyView(): SyncKeyView | null {
    return this.key ? { ...this.key, epoch: this.epoch } : null;
  }

  readonly api: SyncServerApi = {
    syncKeyGet: async () => {
      const g = this.gate<SyncKeyView>('keyGet');
      if (g) return g;
      const v = this.snapshotKeyView();
      return v ? ok(v) : fail(404, 'none');
    },
    syncKeyPut: async (_t: string, b: SyncKeyBody) => {
      const g = this.gate<{ epoch: number; gen: number; keyRev: number; created: boolean }>('keyPut');
      if (g) return g;
      if (b.epoch !== (this.hasHead ? this.epoch : 0))
        return fail(409, 'epoch', { epoch: this.epoch, gen: this.key?.gen ?? 0 });
      if (!this.key) {
        this.key = { salt: b.salt, params: b.params, wrapped: b.wrapped, gen: 1, keyRev: 1 };
        if (!this.hasHead) {
          this.hasHead = true;
          this.epoch = 1 + Math.floor(Math.random() * 1000);
        }
        return ok({ epoch: this.epoch, gen: 1, keyRev: 1, created: true });
      }
      if (b.keyRev === undefined)
        return fail(409, 'key_exists', { epoch: this.epoch, gen: this.key.gen, key_rev: this.key.keyRev });
      if (b.keyRev !== this.key.keyRev)
        return fail(409, 'key_rev', { epoch: this.epoch, gen: this.key.gen, key_rev: this.key.keyRev });
      const prevGen = this.key.gen;
      const nextGen = b.gen ?? prevGen;
      if (nextGen !== prevGen && nextGen !== prevGen + 1) return fail(400, 'gen');
      this.key = {
        salt: b.salt,
        params: b.params,
        wrapped: b.wrapped,
        gen: nextGen,
        keyRev: this.key.keyRev + 1,
      };
      if (nextGen !== prevGen) {
        // 새 데이터 열쇠: 옛 항목을 모두 지우고 epoch +1 (server/src/sync.ts putKey 와 같다)
        this.items = new Map();
        this.epoch += 1;
      }
      return ok({ epoch: this.epoch, gen: nextGen, keyRev: this.key.keyRev, created: false });
    },
    syncStatus: async () => {
      const g = this.gate<never>('status');
      if (g) return g as never;
      const items = [...this.items.values()].filter((i) => i.blob !== '' || !i.deleted).length;
      return ok({
        on: !!this.key,
        items,
        bytes: 0,
        maxItems: this.maxItems,
        maxBytes: 100 * 1024 * 1024,
        soon: false,
        epoch: this.epoch,
        gen: this.key?.gen ?? 0,
      });
    },
    syncChanges: async (_t: string, since: number, limit: number, epoch: number) => {
      const g = this.gate<SyncChanges>('changes');
      if (g) return g;
      if (epoch !== this.epoch) return fail(409, 'epoch', { epoch: this.epoch, gen: this.key?.gen ?? 0 });
      const all = [...this.items.entries()]
        .filter(([, i]) => i.rev > since)
        .sort((a, b) => a[1].rev - b[1].rev);
      const page = all.slice(0, limit);
      return ok({
        items: page.map(([uid, i]) => ({ uid, rev: i.rev, blob: i.blob, deleted: i.deleted })),
        head: this.head,
        more: all.length > page.length,
        epoch: this.epoch,
        gen: this.key?.gen ?? 0,
      });
    },
    syncPush: async (_t: string, epoch: number, items: readonly SyncPushItem[]) => {
      const g = this.gate<SyncPushed>('push');
      if (g) return g;
      if (!this.key) return fail(409, 'no_key');
      if (epoch !== this.epoch) return fail(409, 'epoch', { epoch: this.epoch, gen: this.key.gen });
      if (items.length > 200) return fail(400, 'too_many');
      const results: SyncPushed['results'] = [];
      const trial = new Map(this.items);
      let head = this.head;
      for (const it of items) {
        const have = trial.get(it.uid);
        if (it.base !== (have?.rev ?? 0)) {
          results.push({
            uid: it.uid,
            ok: false,
            conflict: { rev: have?.rev ?? 0, blob: have?.blob ?? '', deleted: have?.deleted ?? false },
          });
          continue;
        }
        head += 1;
        trial.set(it.uid, { rev: head, blob: it.blob, deleted: it.deleted });
        results.push({ uid: it.uid, ok: true, rev: head });
      }
      if (trial.size > this.maxItems) return fail(413, 'sync_full');
      this.items = trial;
      this.head = head;
      return ok({ results, head, epoch: this.epoch, gen: this.key.gen });
    },
    syncRemove: async () => {
      const g = this.gate<{ epoch: number; gen: number }>('remove');
      if (g) return g;
      this.items = new Map();
      this.key = null;
      this.epoch += 1;
      return ok({ epoch: this.epoch, gen: 0 });
    },
  };
}

export interface Dev {
  name: string;
  db: Db;
  todos: TodoStore;
  notes: NoteStore;
  events: EventStore;
  engine: SyncEngine;
  /** 이 기기의 시계 (ms). 시험이 앞뒤로 옮긴다 */
  clock: { now: number };
  state: () => SyncState;
  secret: () => string | undefined;
  setSecret: (v: string | undefined) => void;
}

export const ACCOUNT = 'F-TEST-0001';

export function newDevice(
  server: FakeSyncServer,
  name: string,
  o: { account?: () => string | undefined; db?: Db; secure?: boolean } = {},
): Dev {
  const db = o.db ?? (new DatabaseSync(':memory:') as unknown as Db);
  if (!o.db) migrate(db);
  let stored: unknown;
  let secret: string | undefined;
  const clock = { now: Date.now() };
  const engine = createSyncEngine({
    db,
    call: async (f) => (o.account && !o.account() ? fail(403, 'login') : f(server.api, 'session')),
    account: o.account ?? (() => ACCOUNT),
    load: () => stored,
    save: (s) => {
      stored = structuredClone(s);
    },
    key: {
      get: () => secret,
      set: (v) => {
        secret = v ?? undefined;
      },
      unreadable: () => false,
    },
    secure: () => o.secure !== false,
    now: () => clock.now,
    deviceName: () => name,
    random: (n) => randomBytes(n),
    log: () => {},
    scrypt: { N: 1 << 10, r: 8, p: 1 },
    timers: false,
  });
  return {
    name,
    db,
    todos: new TodoStore(db),
    notes: new NoteStore(db),
    events: new EventStore(db),
    engine,
    clock,
    state: () => engine.state(),
    secret: () => secret,
    setSecret: (v) => {
      secret = v;
    },
  };
}

/** 두 기기를 같은 서버에 켠다 (a 가 첫 기기, b 는 복구 코드로) */
export async function pair(server: FakeSyncServer): Promise<{ a: Dev; b: Dev; code: string }> {
  const a = newDevice(server, 'A');
  const b = newDevice(server, 'B');
  const r = await a.engine.enable();
  if (!r.ok || r.kind !== 'created') throw new Error(`첫 기기 켜기 실패 ${JSON.stringify(r)}`);
  const e = await b.engine.enable();
  if (!e.ok || e.kind !== 'needCode') throw new Error(`둘째 기기 ${JSON.stringify(e)}`);
  const c = await b.engine.enterCode(r.code);
  if (!c.ok) throw new Error(`코드 넣기 실패 ${JSON.stringify(c)}`);
  return { a, b, code: r.code };
}

/** 몇 ms 기다려 시각을 앞으로 보낸다 (두 기기 편집의 선후를 칸 시각으로 가르려고) */
export const spin = (ms = 3): void => {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    /* 시각을 흘려보낸다 */
  }
};

/** 서로 두세 번 맞춘다 (끝에는 양쪽이 같아야 한다) */
export async function settle(devs: Dev[], rounds = 4): Promise<void> {
  for (let i = 0; i < rounds; i++) for (const d of devs) await d.engine.run(true);
}

/** 맞추는 칸만 모은 모양: 두 기기가 같은지 견준다 (칸 값, 칸 시각은 따로) */
export function snapshot(db: Db, withClock = false): string {
  const out: string[] = [];
  for (const kind of SYNC_KINDS) {
    const uids = (
      db.prepare(`select uid from ${kind} where uid is not null order by uid`).all() as { uid: string }[]
    ).map((r) => r.uid);
    for (const uid of uids) {
      const it = readItem(db, kind, uid, { id: '', name: '' });
      if (!it) continue;
      out.push(
        `${kind}:${uid}:${JSON.stringify(sortKeys(it.f))}${withClock ? JSON.stringify(sortKeys(it.c)) : ''}`,
      );
    }
  }
  return out.join('\n');
}

function sortKeys(o: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)));
}
