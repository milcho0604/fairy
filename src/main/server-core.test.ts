import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { spendRule } from '../shared/coin-rules.ts';
import { type Db, migrate } from '../shared/db-schema.ts';
import { serverView } from '../shared/server-account.ts';
import { ItemStore } from '../shared/shop.ts';
import { TodoStore } from '../shared/todo-store.ts';
import { type FetchLike, serverApi } from './server-api.ts';
import { refOf, ServerCoins, SYNC_REASON, withPending } from './server-coins.ts';
import { createServerCore, type LoopbackLike, parseState, type ServerState } from './server-core.ts';

const T0 = Date.UTC(2026, 9, 15, 3);
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

interface Entry {
  id: string;
  reason: string;
  amount: number;
  day: string;
  ref?: string;
}

/** 서버 PR #106 의 계약을 흉내 내는 작은 가짜 서버 (메모리) */
function fakeServer() {
  const s = {
    down: false,
    /** 처리는 하고 대답만 잃는다 (보낸 뒤 끊김) */
    loseReply: false,
    calls: [] as { method: string; path: string; auth?: string; body?: unknown }[],
    balance: 0,
    items: {} as Record<string, number>,
    seen: new Map<string, { id: string; status: string; applied: number; error?: string }>(),
    migrated: false,
    deviceToken: '',
    sessions: new Set<string>(),
    deleted: false,
    sessionOtherAccount: false,
  };
  const reply = (status: number, body?: unknown) =>
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  const fetch: FetchLike = async (url, init) => {
    const u = new URL(url);
    const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    const auth = (init.headers as Record<string, string>).authorization?.slice(7);
    s.calls.push({ method: init.method ?? 'GET', path: u.pathname, ...(auth ? { auth } : {}), body });
    if (s.down) throw new TypeError('fetch failed');
    const authed = () => !s.deleted && auth !== undefined && (auth === s.deviceToken || s.sessions.has(auth));
    let out: Response;
    if (u.pathname === '/v1/device') {
      s.deviceToken = `fd_${s.calls.length}abcdefgh`;
      s.deleted = false;
      out = reply(201, { token: s.deviceToken, account: { id: 1 } });
    } else if (!authed()) out = reply(401, { error: 'token' });
    else if (u.pathname === '/v1/migrate') {
      if (s.migrated) out = reply(409, { error: 'already_migrated' });
      else {
        s.migrated = true;
        const b = body as { balance: number; items: Record<string, number> };
        s.balance += Math.min(b.balance, 10_000);
        Object.assign(s.items, b.items);
        out = reply(200, { balance: s.balance, items: s.items, applied: b.balance, status: 'ok' });
      }
    } else if (u.pathname === '/v1/sync') {
      const results = [];
      for (const e of (body as { entries: Entry[] }).entries) {
        const prev = s.seen.get(e.id);
        if (prev) {
          results.push({ ...prev, duplicate: true });
          continue;
        }
        let r: { id: string; status: string; applied: number; error?: string };
        const rule = spendRule(e.reason);
        if (e.amount > 0) r = { id: e.id, status: 'ok', applied: e.amount };
        else if (rule?.kind === 'takeBack') {
          const applied = -Math.min(-e.amount, s.balance);
          r = { id: e.id, status: applied === e.amount ? 'ok' : 'capped', applied };
        } else if (-e.amount > s.balance)
          r = { id: e.id, status: 'rejected', applied: 0, error: 'insufficient' };
        else if (rule?.kind === 'buy' && (s.items[rule.item] ?? 0) >= (rule.level ?? 1))
          r = { id: e.id, status: 'rejected', applied: 0, error: 'owned' };
        else {
          r = { id: e.id, status: 'ok', applied: e.amount };
          if (rule?.kind === 'buy') s.items[rule.item] = rule.level ?? 1;
        }
        s.balance += r.applied;
        s.seen.set(e.id, r);
        results.push(r);
      }
      out = reply(200, { balance: s.balance, items: s.items, results });
    } else if (u.pathname === '/v1/session') {
      const b = body as { code: string; verifier?: string; merge?: boolean };
      if (!b.verifier) out = reply(400, { error: 'verifier' });
      else if (s.sessionOtherAccount && !b.merge)
        out = reply(409, {
          error: 'merge_needed',
          code: 'confirm-code',
          current: { balance: s.balance, items: s.items },
          other: { balance: 40, items: { 'toy:yarn': 1 } },
        });
      else {
        if (b.merge) s.balance += 40;
        const tok = `fs_session${s.sessions.size}`;
        s.sessions.add(tok);
        out = reply(200, { session: tok, account: { id: 1 }, merged: !!b.merge, linked: !b.merge });
      }
    } else if (u.pathname === '/v1/account' && init.method === 'DELETE') {
      s.deleted = true;
      s.balance = 0;
      s.items = {};
      s.migrated = false;
      out = new Response(null, { status: 204 });
    } else out = reply(404, { error: 'not_found' });
    if (s.loseReply) throw new TypeError('connection reset');
    return out;
  };
  return { s, fetch };
}

function setup(o: { url?: string; coins?: number; state?: Partial<ServerState> } = {}) {
  const db = new DatabaseSync(':memory:') as unknown as Db;
  migrate(db);
  const todos = new TodoStore(db, day);
  const shop = new ItemStore(db, todos);
  if (o.coins) todos.reward(o.coins, 'meet', T0);
  const server = fakeServer();
  let saved: ServerState | undefined = o.state ? (o.state as ServerState) : undefined;
  const secrets = { device: undefined as string | undefined, session: undefined as string | undefined };
  const reverted: { reason: string; amount: number }[][] = [];
  const opened: string[] = [];
  let loopResult: LoopbackLike['result'] = Promise.resolve({ kind: 'cancelled' });
  let now = T0;
  const url = o.url ?? 'http://127.0.0.1:9999';
  const coins = new ServerCoins(db, todos, shop, day);
  const core = createServerCore({
    api: url ? serverApi(url, server.fetch) : undefined,
    coins,
    load: () => saved,
    save: (st) => {
      saved = JSON.parse(JSON.stringify(st)) as ServerState;
    },
    device: { get: () => secrets.device, set: (v) => (secrets.device = v ?? undefined) },
    session: { get: () => secrets.session, set: (v) => (secrets.session = v ?? undefined) },
    loopback: async (x) => {
      assert.equal(x.path, '/done');
      return { redirectUri: 'http://127.0.0.1:45678', result: loopResult, cancel: () => {} };
    },
    openExternal: async (u) => {
      opened.push(u);
    },
    page: () => ({ title: '', body: '' }),
    now: () => now,
    log: () => {},
    onChange: () => {},
    onCoins: () => {},
    onReverted: (list) => reverted.push(list),
  });
  return {
    db,
    todos,
    shop,
    coins,
    core,
    server: server.s,
    secrets,
    reverted,
    opened,
    saved: () => saved,
    setLoop: (r: Awaited<LoopbackLike['result']>) => {
      loopResult = Promise.resolve(r);
    },
    tick: (ms: number) => {
      now += ms;
    },
  };
}

test('서버 주소가 비면 칸이 숨고 나이를 답해도 아무것도 하지 않는다', async () => {
  const x = setup({ url: '', coins: 50 });
  assert.equal(x.core.status().enabled, false);
  assert.equal(serverView(x.core.status()), 'hidden');
  x.core.setAge('adult');
  await x.core.run();
  await x.core.login();
  assert.equal(x.core.status().age, null);
  assert.equal(x.server.calls.length, 0);
});

test('나이를 답하기 전, 만 14세 미만이면 어떤 요청도 나가지 않는다', async () => {
  const x = setup({ coins: 120 });
  assert.equal(serverView(x.core.status()), 'askAge');
  await x.core.run();
  x.core.setAge('under14');
  assert.equal(serverView(x.core.status()), 'appMode');
  x.todos.reward(15, 'todo', T0);
  x.core.scan();
  await x.core.run();
  await x.core.login();
  x.core.turnOn();
  await x.core.run();
  assert.equal(x.server.calls.length, 0);
  assert.equal(x.todos.balance(), 135);
  assert.equal(x.core.status().pending, 0);
});

test('처음 켜면 기기 계정, 옮기기, 맞추기 순서이고 옮기기 전에는 맞추기를 보내지 않는다', async () => {
  const x = setup({ coins: 200 });
  x.shop.buyToy('ball', T0);
  x.core.setAge('teen');
  await x.core.run();
  assert.deepEqual(
    x.server.calls.map((c) => c.path),
    ['/v1/device', '/v1/migrate', '/v1/sync'],
  );
  assert.deepEqual(x.server.calls[0]?.body, { age: '14+' });
  assert.deepEqual(x.server.calls[1]?.body, { balance: 170, items: { 'toy:ball': 1 } });
  // 옮긴 장부 줄은 다시 보내지 않는다
  assert.deepEqual(((x.server.calls[2]?.body ?? {}) as { entries: unknown[] }).entries, []);
  assert.equal(x.server.balance, 170);
  assert.equal(x.todos.balance(), 170);
  assert.equal(x.core.status().balance, 170);
  assert.ok(x.secrets.device?.startsWith('fd_'));

  // 옮기기 대답을 잃어도 같은 값으로 다시 보내고, 409 면 끝난 것으로 본다
  const y = setup({ coins: 100 });
  y.core.setAge('adult');
  y.server.loseReply = true;
  await y.core.run();
  assert.equal(y.core.status().problem, 'offline');
  assert.equal(y.server.calls.filter((c) => c.path === '/v1/sync').length, 0);
  y.server.loseReply = false;
  // device 는 대답을 잃어 두 번 만든다 (서버에 빈 계정이 하나 남는다)
  await y.core.run();
  assert.equal(y.saved()?.migrated, true);
  assert.equal(y.core.status().problem, null);
});

test('대기열: 코인 변동마다 기록 번호, 같은 기록은 두 번 반영되지 않는다 (대답을 잃어도)', async () => {
  const x = setup({ coins: 10 });
  x.core.setAge('adult');
  await x.core.run();
  const todo = x.todos.add({ title: '빨래' }, T0);
  x.todos.complete(todo.id, T0);
  x.todos.reward(5, 'focus', T0);
  x.server.loseReply = true;
  await x.core.run();
  assert.equal(x.server.balance, 30, '서버는 처리했다');
  assert.equal(x.core.status().pending, 2, '대답을 못 받아 대기열에 남는다');
  const sent = ((x.server.calls.at(-1)?.body ?? {}) as { entries: Entry[] }).entries;
  assert.equal(sent.length, 2);
  assert.match(sent[0]?.id ?? '', /^[A-Za-z0-9_-]{8,64}$/);
  // 할 일 기록은 할 일 번호 대신 지문
  assert.equal(sent[0]?.ref, refOf(x.saved()?.coins.refSalt ?? '', todo.id));
  assert.notEqual(sent[0]?.ref, String(todo.id));
  assert.equal(sent[1]?.ref, undefined);
  x.server.loseReply = false;
  await x.core.run();
  const again = ((x.server.calls.at(-1)?.body ?? {}) as { entries: Entry[] }).entries;
  assert.deepEqual(
    again.map((e) => e.id),
    sent.map((e) => e.id),
    '같은 번호로 다시 보낸다',
  );
  assert.equal(x.server.balance, 30, '두 번 반영되지 않는다');
  assert.equal(x.todos.balance(), 30);
  assert.equal(x.core.status().pending, 0);
  // 맞추기 줄은 보내지 않는다
  await x.core.run();
  assert.deepEqual(((x.server.calls.at(-1)?.body ?? {}) as { entries: Entry[] }).entries, []);
});

test('서버가 꺼져 있어도 앱은 사본 잔액으로 돌고, 살아나면 맞춘다', async () => {
  const x = setup({ coins: 50 });
  x.core.setAge('adult');
  await x.core.run();
  x.server.down = true;
  x.todos.reward(10, 'meet', T0 + 1);
  x.todos.reward(5, 'focus', T0 + 2);
  assert.equal(x.todos.spend(30, 'toy:ball', T0 + 3), true);
  await x.core.run();
  assert.equal(x.core.status().problem, 'offline');
  assert.equal(x.todos.balance(), 35, '앱 잔액은 그대로 쓴다');
  assert.equal(x.core.status().pending, 3);
  assert.equal(x.saved()?.coins.queue.length, 3, '대기열은 파일에 남는다');
  x.server.down = false;
  await x.core.run();
  assert.equal(x.core.status().problem, null);
  assert.equal(x.server.balance, 35);
  assert.equal(x.todos.balance(), 35);
  assert.equal(x.core.status().pending, 0);
});

test('거절된 구매는 되돌린다: 물건을 빼고 코인을 돌려주고 알린다', async () => {
  const x = setup({ coins: 100 });
  x.core.setAge('adult');
  await x.core.run();
  // 다른 기기가 먼저 80 을 썼다 (서버 잔액 20)
  x.server.balance = 20;
  x.server.items['house-style:igloo'] = 1;
  assert.deepEqual(x.shop.buyToy('cushion', T0), { ok: true });
  assert.equal(x.todos.balance(), 0);
  assert.equal(x.shop.owns('cushion'), true);
  await x.core.run();
  assert.equal(x.shop.owns('cushion'), false, '물건 회수');
  assert.equal(x.todos.balance(), 20, '서버 잔액으로');
  assert.deepEqual(x.reverted, [[{ reason: 'toy:cushion', amount: -100 }]]);
  // 다른 기기에서 산 물건은 받아 온다
  assert.equal(x.shop.state().houseStyles.igloo, true);
  // 장부에는 맞추기 한 줄
  const row = x.db
    .prepare('select amount from coin_log where reason = ? order by id desc')
    .get(SYNC_REASON) as {
    amount: number;
  };
  assert.equal(row.amount, 20);
});

test('맞추기: 아직 안 보낸 구매는 물건을 지키고 잔액에 넣는다', () => {
  assert.deepEqual(
    withPending({ house: 1 }, [
      { id: 'a-1aaaaaaa', logId: 1, reason: 'house:2', amount: -500, day: '2026-10-15', at: 1 },
      { id: 'a-2aaaaaaa', logId: 2, reason: 'toy:ball', amount: -30, day: '2026-10-15', at: 1 },
      { id: 'a-3aaaaaaa', logId: 3, reason: 'todo', amount: 15, day: '2026-10-15', at: 1 },
    ]),
    { house: 2, 'toy:ball': 1 },
  );
});

test('백업을 되살린 뒤: 되살린 장부 줄은 보내지 않고 서버 사본으로 맞춘다', async () => {
  const x = setup({ coins: 60 });
  x.core.setAge('adult');
  await x.core.run();
  assert.equal(x.todos.balance(), 60);
  // 되살린 백업의 장부: 옛 줄이 더 많아 잔액이 늘었다고 치자
  x.todos.reward(500, 'meet', T0);
  x.core.afterRestore();
  assert.equal(x.todos.balance(), 60);
  await x.core.run();
  assert.deepEqual(((x.server.calls.at(-1)?.body ?? {}) as { entries: Entry[] }).entries, []);
  assert.equal(x.server.balance, 60);
  // 장부 줄 번호가 줄면(파일이 바뀜) 스스로 새로 시작한다
  const q = { ...(x.saved()?.coins ?? parseState(undefined).coins), scanned: 10_000, queue: [] };
  x.coins.scan(q);
  assert.equal(q.scanned, x.coins.maxLogId());
  assert.equal(q.queue.length, 0);
});

test('구글 로그인: 로컬 PKCE, state 는 루프백이 맞춰 보고, 합치기는 확인 뒤에만', async () => {
  const x = setup({ coins: 30 });
  x.core.setAge('adult');
  await x.core.run();
  x.setLoop({ kind: 'code', code: 'one-time' });
  await x.core.login();
  const start = new URL(x.opened[0] ?? '');
  assert.equal(start.pathname, '/auth/google/start');
  assert.equal(start.searchParams.get('port'), '45678');
  assert.match(start.searchParams.get('state') ?? '', /^[A-Za-z0-9_-]{32}$/);
  assert.match(start.searchParams.get('challenge') ?? '', /^[A-Za-z0-9_-]{43}$/);
  const sess = x.server.calls.find((c) => c.path === '/v1/session');
  assert.equal(((sess?.body ?? {}) as { code: string }).code, 'one-time');
  assert.match(((sess?.body ?? {}) as { verifier: string }).verifier, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(sess?.auth, x.secrets.device);
  assert.equal(x.core.status().signedIn, true);

  // 로그인한 채로 다른 계정의 구글로: 묻고, 합치기를 골라야 합친다
  x.server.sessionOtherAccount = true;
  x.setLoop({ kind: 'code', code: 'other' });
  await x.core.login();
  const ask = x.core.status().merge;
  assert.deepEqual(ask?.other, { balance: 40, items: { 'toy:yarn': 1 } });
  const before = x.server.balance;
  await x.core.merge(false);
  assert.equal(x.server.balance, before, '합치지 않기');
  await x.core.login();
  await x.core.merge(true);
  const last = x.server.calls.filter((c) => c.path === '/v1/session').at(-1);
  assert.deepEqual(
    {
      code: ((last?.body ?? {}) as { code: string }).code,
      merge: ((last?.body ?? {}) as { merge: boolean }).merge,
    },
    { code: 'confirm-code', merge: true },
  );
  await x.core.run();
  assert.equal(x.todos.balance(), before + 40);

  // 거절과 시간 넘김
  x.setLoop({ kind: 'error', error: 'denied' });
  await x.core.login();
  assert.equal(x.core.status().problem, 'denied');
  x.setLoop({ kind: 'timeout' });
  await x.core.login();
  assert.equal(x.core.status().problem, 'timeout');

  x.core.logout();
  assert.equal(x.core.status().signedIn, false);
});

test('탈퇴: 서버 계정을 지우고 토큰과 대기열을 버린다. 앱 코인은 남는다', async () => {
  const x = setup({ coins: 80 });
  x.core.setAge('adult');
  await x.core.run();
  const r = await x.core.remove();
  assert.equal(r.ok, true);
  assert.equal(x.server.calls.at(-1)?.method, 'DELETE');
  assert.equal(x.secrets.device, undefined);
  assert.equal(x.core.status().on, false);
  assert.equal(serverView(x.core.status()), 'serverOff');
  assert.equal(x.todos.balance(), 80);
  const calls = x.server.calls.length;
  await x.core.run();
  assert.equal(x.server.calls.length, calls, '꺼진 뒤에는 보내지 않는다');
});

test('만 14세 미만으로 바꾸면 서버 모드를 끄고 남은 계정을 안내한다', async () => {
  const x = setup({ coins: 20 });
  x.core.setAge('adult');
  await x.core.run();
  x.core.setAge('under14');
  const s = x.core.status();
  assert.equal(s.on, false);
  assert.equal(s.leftover, true);
  const calls = x.server.calls.length;
  x.todos.reward(10, 'meet', T0);
  await x.core.run();
  await x.core.login();
  assert.equal(x.server.calls.length, calls);
  // 사용자가 누른 탈퇴만 간다
  assert.equal((await x.core.remove()).ok, true);
  assert.equal(x.core.status().leftover, false);
});

test('다른 기기에서 탈퇴해 기기 토큰이 끝나면 서버 모드를 끈다', async () => {
  const x = setup({ coins: 20 });
  x.core.setAge('adult');
  await x.core.run();
  x.server.deleted = true;
  await x.core.run();
  assert.equal(x.core.status().problem, 'gone');
  assert.equal(x.core.status().on, false);
  assert.equal(x.secrets.device, undefined);
});

test('상태 파일 검사: 모르는 값은 처음 값으로', () => {
  const s = parseState({
    age: 'kid',
    on: true,
    coins: { salt: '../x', scanned: -1 },
    copy: { balance: 'a' },
  });
  assert.equal(s.age, null);
  assert.equal(s.on, false);
  assert.equal(s.copy, null);
  assert.match(s.coins.salt, /^[A-Za-z0-9_-]{12}$/);
  const t = parseState({
    age: 'teen',
    on: true,
    migrated: true,
    coins: {
      salt: 'abcdefghijkl',
      refSalt: 'mnopqrstuvwx',
      scanned: 4,
      queue: [
        { id: 'abcdefghijkl-5', logId: 5, reason: 'todo', amount: 15, day: '2026-10-15', at: 1, ref: 'zz' },
        7,
      ],
    },
  });
  assert.equal(t.on, true);
  assert.equal(t.coins.queue.length, 1);
  assert.equal(t.coins.queue[0]?.ref, undefined);
});
