import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { spendRule } from '../shared/coin-rules.ts';
import { type Db, migrate } from '../shared/db-schema.ts';
import { featureOn, serverView } from '../shared/server-account.ts';
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
    age: '',
    /** 다음 대답 대신 줄 것 (응답 검사 시험) */
    raw: undefined as Response | undefined,
    /** 업데이트 관문 (이슈 #120): 이 단계로 막는다 (/v1/me 는 막지 않는다). 서버가 말하는 강제 최소 판 */
    gate: undefined as { level: 'restrict' | 'force'; need: string } | undefined,
    meMin: undefined as string | undefined,
    /** 기기 계정 대답을 이 약속이 끝날 때까지 미룬다 */
    hold: undefined as Promise<void> | undefined,
    patchFail: false,
    /** AI 대화권 (#100): 남은 수와 다음 질문의 흉내 (ok, cut: 조각 뒤 끊김, 그 밖은 그 까닭의 JSON 실패) */
    tickets: 10,
    aiMode: 'ok' as string,
    reports: [] as unknown[],
    /** #101: 닉네임, 운영자, 쪽지 수, 채팅 이용권 접근 */
    nickname: null as string | null,
    admin: false,
    inbox: 0,
    aiAccess: 'ok' as string,
    claimed: new Set<string>(),
    /** 로그인 서비스 (#102). 이 경로는 calls 에 적지 않는다 (맞추기 순서 시험을 흐리지 않게) */
    providers: { login: ['google'], link: ['google'] } as { login: string[]; link: string[] },
    providerCalls: 0,
    begins: [] as { service: string; auth?: string }[],
    /** 서버 백업 (#102) */
    backups: [] as { id: number; bytes: Uint8Array; sha256: string; createdAt: string }[],
    backupOff: false,
    lastUploadConsent: '',
    /** 서버 백업 전체 상한에 찼다 (507) */
    backupFull: false,
    /** 기능 키 coin_reset (#102) */
    coinReset: false,
    /** 기능 키 calendar_link_hint 와 구글 일정 연결 표시 (#115): 이 기기가 올린 값, 다른 기기에서 연결한 수 */
    calendarHint: true,
    calendarHere: false,
    calendarOthers: 0,
    calendarDelayMs: 0,
    calendarInFlight: 0,
    calendarMaxInFlight: 0,
  };
  const calendarBody = () =>
    s.calendarHint
      ? {
          linked: s.calendarOthers + (s.calendarHere ? 1 : 0) > 0,
          devices: s.calendarOthers + (s.calendarHere ? 1 : 0),
        }
      : null;
  const reply = (status: number, body?: unknown) =>
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  const fetch: FetchLike = async (url, init) => {
    const u = new URL(url);
    const json = (init.headers as Record<string, string>)['content-type'] === 'application/json';
    const body = init.body && json ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    const auth = (init.headers as Record<string, string>).authorization?.slice(7);
    if (u.pathname === '/v1/features') {
      if (s.down) throw new TypeError('fetch failed');
      return reply(200, {
        features: { coin_reset: s.coinReset, kakao_login: false, calendar_link_hint: s.calendarHint },
      });
    }
    if (u.pathname === '/v1/auth/providers') {
      s.providerCalls++;
      if (s.down) throw new TypeError('fetch failed');
      return reply(200, {
        login: s.providers.login,
        link: s.sessions.has(auth ?? '') ? s.providers.link : [],
      });
    }
    s.calls.push({ method: init.method ?? 'GET', path: u.pathname, ...(auth ? { auth } : {}), body });
    if (s.down) throw new TypeError('fetch failed');
    if (s.raw && u.pathname !== '/v1/me') {
      const r = s.raw;
      s.raw = undefined;
      return r;
    }
    if (s.gate && u.pathname !== '/v1/me')
      return new Response(
        JSON.stringify({ error: 'update_required', need: s.gate.need, level: s.gate.level }),
        {
          status: 426,
          headers: { 'content-type': 'application/json' },
        },
      );
    const authed = () => !s.deleted && auth !== undefined && (auth === s.deviceToken || s.sessions.has(auth));
    let out: Response;
    if (u.pathname === '/v1/device') {
      if (s.hold) await s.hold;
      s.age = String(body?.age);
      s.nickname = typeof body?.nickname === 'string' ? body.nickname : null;
      s.migrated = false;
      s.deviceToken = `fd_${s.calls.length}abcdefgh`;
      s.deleted = false;
      out = reply(201, {
        token: s.deviceToken,
        account: { id: 1, code: 'F-ABCD-1234', nickname: s.nickname },
      });
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
        if (e.reason === 'reset-items') {
          s.items = {};
          r = { id: e.id, status: 'ok', applied: 0 };
        } else if (e.amount > 0) r = { id: e.id, status: 'ok', applied: e.amount };
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
      out = reply(200, {
        balance: s.balance,
        items: s.items,
        results,
        account: { id: 1, code: 'F-ABCD-1234', nickname: s.nickname },
        inbox: s.inbox,
      });
    } else if (u.pathname === '/v1/me') {
      out = reply(200, {
        account: { code: 'F-ABCD-1234', nickname: s.nickname },
        admin: s.admin && s.sessions.has(auth ?? ''),
        calendar: calendarBody(),
        update: { recommend: null, restrict: null, min: s.meMin ?? null },
      });
    } else if (u.pathname === '/v1/claim') {
      const id = String(body?.event);
      if (s.claimed.has(id)) out = reply(409, { error: 'already_claimed' });
      else {
        s.claimed.add(id);
        s.balance += 30;
        out = reply(200, { balance: s.balance, coins: 30, tickets: 0 });
      }
    } else if (u.pathname === '/v1/coupon') {
      out = reply(404, { error: 'no_coupon' });
    } else if (u.pathname === '/v1/admin/overview') {
      out =
        s.admin && s.sessions.has(auth ?? '')
          ? reply(200, { ai: { mode: 'allowlist' } })
          : reply(403, { error: 'not_admin' });
    } else if (u.pathname === '/v1/session' && init.method === 'POST') {
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
        out = reply(200, {
          session: tok,
          account: { id: 1 },
          merged: !!b.merge,
          linked: !b.merge,
          logins: s.begins.length ? ['google', 'kakao'] : ['google'],
        });
      }
    } else if (u.pathname === '/v1/account' && init.method === 'PATCH') {
      if (s.patchFail) out = reply(503, { error: 'down' });
      else if (typeof body?.calendarLinked === 'boolean') {
        if (auth !== s.deviceToken) out = reply(400, { error: 'device_token' });
        else if (body.calendarLinked && !s.calendarHint) out = reply(403, { error: 'feature_off' });
        else {
          // 빠른 되풀이 시험: 동시에 들어온 수를 세고, 대답을 잠깐 미룬다
          s.calendarInFlight++;
          s.calendarMaxInFlight = Math.max(s.calendarMaxInFlight, s.calendarInFlight);
          await new Promise((r) => setTimeout(r, s.calendarDelayMs));
          s.calendarInFlight--;
          s.calendarHere = body.calendarLinked;
          out = reply(200, { account: { id: 1, code: 'F-ABCD-1234' }, calendar: calendarBody() });
        }
      } else {
        if (body?.age !== undefined) s.age = String(body?.age);
        if (typeof body?.nickname === 'string') s.nickname = body.nickname;
        out = reply(200, { account: { id: 1, age: s.age, code: 'F-ABCD-1234', nickname: s.nickname } });
      }
    } else if (u.pathname === '/v1/session' && init.method === 'DELETE') {
      s.sessions.delete(auth ?? '');
      out = new Response(null, { status: 204 });
    } else if (u.pathname === '/v1/account' && init.method === 'DELETE') {
      s.deleted = true;
      s.balance = 0;
      s.items = {};
      s.migrated = false;
      out = new Response(null, { status: 204 });
    } else if (u.pathname.startsWith('/v1/auth/') && u.pathname.endsWith('/begin')) {
      const service = u.pathname.split('/')[3] ?? '';
      s.begins.push({ service, ...(auth ? { auth } : {}) });
      out = reply(200, { url: `https://kauth.example/oauth/authorize?state=${String(body?.state)}` });
    } else if (u.pathname.startsWith('/v1/backup')) {
      const id = Number(u.pathname.split('/')[3] ?? 0);
      if (s.backupOff) out = reply(503, { error: 'backup_off' });
      else if (!s.sessions.has(auth ?? '')) out = reply(403, { error: 'login' });
      else if (init.method === 'PUT' && s.backupFull) out = reply(507, { error: 'storage_full' });
      else if (init.method === 'PUT') {
        s.lastUploadConsent = u.searchParams.get('consent') ?? '';
        const bytes = new Uint8Array(init.body as Uint8Array);
        const { createHash } = await import('node:crypto');
        const item = {
          id: s.backups.length ? Math.max(...s.backups.map((b) => b.id)) + 1 : 1,
          bytes,
          sha256: createHash('sha256').update(bytes).digest('hex'),
          createdAt: new Date(T0 + s.backups.length * 1000).toISOString(),
        };
        s.backups = [item, ...s.backups].slice(0, 2);
        out = reply(201, { backup: view(item) });
      } else if (init.method === 'DELETE') {
        s.backups = s.backups.filter((b) => b.id !== id);
        out = new Response(null, { status: 204 });
      } else if (id) {
        const b = s.backups.find((x) => x.id === id);
        out = b
          ? new Response(b.bytes as BodyInit, { status: 200, headers: { 'x-backup-sha256': b.sha256 } })
          : reply(404, { error: 'not_found' });
      } else out = reply(200, { backups: s.backups.map(view), keep: 2, maxBytes: 20 * 1024 * 1024 });
    } else if (u.pathname.startsWith('/v1/ai')) {
      // 서버처럼: 세션 토큰과 만 18세 이상만
      if (!s.sessions.has(auth ?? '')) out = reply(403, { error: 'login' });
      else if (s.age !== '18+') out = reply(403, { error: 'age' });
      else if (s.aiAccess !== 'ok') out = reply(s.aiAccess === 'ai_off' ? 503 : 403, { error: s.aiAccess });
      else if (u.pathname === '/v1/ai')
        out = reply(200, { tickets: s.tickets, dailyLimit: 20, usedToday: 0 });
      else if (u.pathname === '/v1/ai/report') {
        s.reports.push(body);
        out = reply(201, { ok: true });
      } else if (s.aiMode === 'ok' || s.aiMode === 'cut') {
        if (s.tickets <= 0) out = reply(409, { error: 'no_tickets', tickets: 0 });
        else {
          s.tickets -= 1;
          const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
          const parts = [sse('text', { text: '안녕! ' }), sse('text', { text: '나는 AI 야.' })];
          if (s.aiMode === 'ok') parts.push(sse('done', { tickets: s.tickets, stop: 'end_turn' }));
          else s.tickets += 1; // 서버가 되돌린다
          // 조각이 덩이 경계에 걸려도 읽는지 보려고 일부러 잘게 나눈다
          const bytes = new TextEncoder().encode(parts.join(''));
          out = new Response(
            new ReadableStream({
              start(c) {
                for (let i = 0; i < bytes.length; i += 7) c.enqueue(bytes.slice(i, i + 7));
                c.close();
              },
            }),
            { status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8' } },
          );
        }
      } else
        out = reply(s.aiMode === 'budget' ? 503 : 502, {
          error: s.aiMode,
          tickets: s.tickets,
          refunded: true,
        });
    } else out = reply(404, { error: 'not_found' });
    if (s.loseReply) throw new TypeError('connection reset');
    return out;
  };
  const view = (b: { id: number; bytes: Uint8Array; sha256: string; createdAt: string }) => ({
    id: b.id,
    size: b.bytes.length,
    sha256: b.sha256,
    createdAt: b.createdAt,
    lastAccessAt: b.createdAt,
    expiresAt: new Date(Date.parse(b.createdAt) + 365 * 86_400_000).toISOString(),
    soon: false,
  });
  return { s, fetch };
}

function setup(
  o: { url?: string; coins?: number; state?: Partial<ServerState>; calendar?: { linked: boolean } } = {},
) {
  const db = new DatabaseSync(':memory:') as unknown as Db;
  migrate(db);
  const todos = new TodoStore(db, day);
  const shop = new ItemStore(db, todos);
  if (o.coins) todos.reward(o.coins, 'meet', T0);
  const server = fakeServer();
  let saved: ServerState | undefined = o.state ? (o.state as ServerState) : undefined;
  const secrets = {
    device: undefined as string | undefined,
    session: undefined as string | undefined,
    deviceLocked: false,
    secure: true,
  };
  const reverted: { reason: string; amount: number }[][] = [];
  const inboxCalls: number[] = [];
  const lowered: number[] = [];
  const opened: string[] = [];
  /** 서버 백업 (#102): 받은 파일로 연 되살리기 확인 칸 */
  const restored: Uint8Array[] = [];
  /** 업데이트 관문이 알린 서버 최소 판 (이슈 #120) */
  const serverMins: (string | null | undefined)[] = [];
  let backupBytes: Uint8Array = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]);
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
    device: {
      get: () => (secrets.deviceLocked ? undefined : secrets.device),
      set: (v) => {
        secrets.device = v ?? undefined;
      },
      unreadable: () => secrets.deviceLocked,
    },
    session: {
      get: () => secrets.session,
      set: (v) => {
        secrets.session = v ?? undefined;
      },
      unreadable: () => false,
    },
    secure: () => secrets.secure,
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
    onServerMin: (m) => serverMins.push(m),
    onReverted: (list) => reverted.push(list),
    onInbox: (n) => inboxCalls.push(n),
    onCoinsLowered: (n) => lowered.push(n),
    ...(o.calendar ? { calendarLinked: () => o.calendar?.linked ?? false } : {}),
    backupFile: {
      make: async () => backupBytes,
      open: async (bytes) => {
        restored.push(bytes);
        return { ok: true, message: '' };
      },
    },
  });
  return {
    restored,
    serverMins,
    setBackupBytes: (b: Uint8Array) => {
      backupBytes = b;
    },
    db,
    todos,
    shop,
    coins,
    core,
    server: server.s,
    secrets,
    reverted,
    lowered,
    inboxCalls,
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

test('서버 기록에 맞춰 코인이 줄면 줄어든 양을 알리고, 늘 때는 알리지 않는다', async () => {
  const x = setup({ coins: 100 });
  x.core.setAge('adult');
  await x.core.run();
  x.server.balance = 70; // 운영자가 30 을 회수했다
  await x.core.run();
  assert.equal(x.todos.balance(), 70);
  assert.deepEqual(x.lowered, [30]);
  x.server.balance = 90;
  await x.core.run();
  assert.equal(x.todos.balance(), 90);
  assert.deepEqual(x.lowered, [30], '늘 때는 지금처럼 조용히');
  await x.core.run();
  assert.deepEqual(x.lowered, [30], '같으면 다시 알리지 않는다');
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

// ---- 검토 결함 (PR #108 검토) ----

test('기기 토큰 파일이 없어져 새 기기 계정을 만들면 지금 장부를 다시 옮긴다 (잔액, 집, 물건을 지우지 않는다)', async () => {
  const x = setup({ coins: 2000 });
  x.shop.buyHouse(T0);
  x.shop.buyToy('ball', T0);
  x.core.setAge('adult');
  await x.core.run();
  const before = { balance: x.todos.balance(), items: x.shop.ownedItems() };
  // 토큰 파일이 사라지고 서버도 새 계정 (빈 잔액, 빈 물건)
  x.secrets.device = undefined;
  x.server.balance = 0;
  x.server.items = {};
  await x.core.run();
  const paths = x.server.calls.map((c) => c.path).slice(-3);
  assert.deepEqual(paths, ['/v1/device', '/v1/migrate', '/v1/sync']);
  assert.equal(x.todos.balance(), before.balance);
  assert.deepEqual(x.shop.ownedItems(), before.items);
  assert.equal(x.server.balance, before.balance);
});

test('기기 토큰 파일을 못 풀면 서버 모드를 멈추고 덮어쓰지 않는다', async () => {
  const x = setup({ coins: 100 });
  x.core.setAge('adult');
  await x.core.run();
  const token = x.secrets.device;
  x.secrets.deviceLocked = true;
  const n = x.server.calls.length;
  await x.core.run();
  assert.equal(x.server.calls.length, n, '요청 없음');
  assert.equal(x.core.status().problem, 'keyLost');
  assert.equal(x.secrets.device, token, '덮어쓰지 않음');
  assert.equal(x.todos.balance(), 100);
});

test('첫 맞추기에서 서버가 빈 물건을 줘도 로컬 물건을 통째로 비우지 않는다', async () => {
  const x = setup({ coins: 300 });
  x.shop.buyToy('ball', T0);
  x.core.setAge('adult');
  // 옮기기에서 물건이 빠진 서버 (이상한 대답)
  x.server.migrated = true;
  await x.core.run();
  assert.equal(x.shop.owns('ball'), true);
});

test('로그아웃은 서버 세션도 지운다 (실패해도 이 컴퓨터에서는 지운다)', async () => {
  const x = setup({ coins: 10 });
  x.core.setAge('adult');
  await x.core.run();
  x.setLoop({ kind: 'code', code: 'c' });
  await x.core.login();
  const tok = x.secrets.session;
  await x.core.logout();
  const last = x.server.calls.find((c) => c.method === 'DELETE');
  assert.deepEqual([last?.method, last?.path, last?.auth], ['DELETE', '/v1/session', tok]);
  assert.equal(x.core.status().signedIn, false);
  x.setLoop({ kind: 'code', code: 'c' });
  await x.core.login();
  x.server.down = true;
  await x.core.logout();
  assert.equal(x.core.status().signedIn, false);
});

test('나이 구분을 바꾸면 서버에도 알리고, 실패하면 다음 맞추기 때 다시', async () => {
  const x = setup({ coins: 10 });
  x.core.setAge('teen');
  await x.core.run();
  assert.equal(x.server.age, '14+');
  x.server.patchFail = true;
  x.core.setAge('adult');
  await x.core.run();
  assert.equal(x.server.age, '14+');
  x.server.patchFail = false;
  await x.core.run();
  assert.equal(x.server.age, '18+');
  const n = x.server.calls.filter((c) => c.method === 'PATCH').length;
  await x.core.run();
  assert.equal(x.server.calls.filter((c) => c.method === 'PATCH').length, n, '한 번만');
});

test('서버 모드에서 산 물건 초기화는 reset-items 로 보내 서버에서도 비운다', async () => {
  const x = setup({ coins: 300 });
  x.shop.buyToy('ball', T0);
  x.core.setAge('adult');
  await x.core.run();
  await x.core.run();
  assert.deepEqual(x.server.items, { 'toy:ball': 1 });
  const r = x.shop.resetCoins('all', T0 + 1);
  assert.equal(r.ok, true);
  await x.core.run();
  assert.deepEqual(x.server.items, {});
  assert.equal(x.shop.owns('ball'), false, '다음 맞추기에서 돌아오지 않는다');
  assert.equal(x.todos.balance(), 0);
});

test('운영체제 열쇠(safeStorage)를 못 쓰면 서버 모드를 켜지 않는다 (토큰 평문 저장 금지)', async () => {
  const x = setup({ coins: 10 });
  x.secrets.secure = false;
  x.core.setAge('adult');
  await x.core.run();
  assert.equal(x.server.calls.length, 0);
  assert.equal(x.core.status().problem, 'noSecure');
  assert.equal(x.secrets.device, undefined);
});

test('기기 계정을 만드는 중 만 14세 미만으로 바꾸면 받은 토큰을 버리고 더 보내지 않는다', async () => {
  const x = setup({ coins: 10 });
  let release = () => {};
  x.server.hold = new Promise<void>((r) => {
    release = r;
  });
  x.core.setAge('adult');
  const running = x.core.run();
  await new Promise((r) => setTimeout(r, 5));
  x.core.setAge('under14');
  release();
  await running;
  assert.equal(x.secrets.device, undefined);
  assert.deepEqual(
    x.server.calls.map((c) => c.path),
    ['/v1/device'],
  );
});

test('업데이트 관문 (이슈 #120): 426 이면 업데이트 안내로 멈추고, 통과한 호출이 오면 푼다. 대기열은 그대로', async () => {
  const x = setup({ coins: 10 });
  x.core.setAge('adult');
  x.server.gate = { level: 'restrict', need: '0.4.4' };
  await x.core.run();
  assert.equal(x.core.status().problem, 'update');
  assert.equal(x.core.status().device, false);
  x.server.gate = undefined;
  await x.core.run();
  assert.equal(x.core.status().problem, null);
  assert.equal(x.core.status().device, true);
});

test('업데이트 관문 (이슈 #120): 강제 단계면 서버가 말한 최소 판을 알리고, 서버가 없다고 하면 null, 안 닿으면 undefined', async () => {
  const x = setup({ coins: 0 });
  x.core.setAge('adult');
  x.server.meMin = '0.4.0';
  // 처음에는 계정이 없어 묻지 않는다 (기기 계정을 만든 뒤 두 번째 맞추기부터)
  await x.core.run();
  await x.core.run();
  assert.deepEqual(x.serverMins.at(-1), '0.4.0');
  x.server.meMin = undefined;
  await x.core.run();
  assert.equal(x.serverMins.at(-1), null);
  x.server.gate = { level: 'force', need: '0.4.2' };
  x.server.down = true;
  await x.core.run();
  assert.equal(x.serverMins.at(-1), undefined);
  x.server.down = false;
  x.server.gate = undefined;
});

test('업데이트 관문 (이슈 #120): 서버를 끄면 서버 최소 판을 놓는다 (홈페이지 공지 파일을 쓴다)', async () => {
  const x = setup({ coins: 0 });
  x.core.setAge('adult');
  x.server.meMin = '0.4.0';
  await x.core.run();
  x.core.setAge('under14');
  await x.core.run();
  assert.equal(x.serverMins.at(-1), undefined);
});

test('대답 검사: 큰 본문, 음수나 소수 잔액은 받지 않는다', async () => {
  const x = setup({ coins: 10 });
  x.core.setAge('adult');
  await x.core.run();
  const balance = x.todos.balance();
  x.server.raw = new Response('{"balance":5,"items":{},"results":[]}', {
    status: 200,
    headers: { 'content-length': String(50_000_000) },
  });
  await x.core.run();
  assert.equal(x.core.status().problem, 'server');
  x.server.raw = new Response(JSON.stringify({ balance: -5, items: {}, results: [] }), { status: 200 });
  await x.core.run();
  assert.equal(x.core.status().problem, 'server');
  x.server.raw = new Response(JSON.stringify({ balance: 1.5, items: {}, results: [] }), { status: 200 });
  await x.core.run();
  assert.equal(x.core.status().problem, 'server');
  x.server.raw = new Response(`{"balance":5,"pad":"${'x'.repeat(3_000_000)}"}`, { status: 200 });
  await x.core.run();
  assert.equal(x.core.status().problem, 'server');
  assert.equal(x.todos.balance(), balance);
});

test('옮기기 전에 백업을 되살리면 옮길 한 시점을 버리고 새로 잡는다', async () => {
  const x = setup({ coins: 100 });
  x.core.setAge('adult');
  x.server.down = true;
  await x.core.run();
  // 기기 계정 전이라 스냅샷 없음. 기기 계정만 만들고 옮기기에서 끊긴 상태를 만든다
  x.server.down = false;
  x.server.raw = undefined;
  await x.core.run();
  // 이미 옮겼으면 이 시험은 볼 것이 없다: 옮기기 전 상태를 직접 만든다
  const st = x.core.state();
  st.migrated = false;
  st.migrate = { balance: 100, items: {}, maxId: 1 };
  x.todos.reward(50, 'meet', T0);
  x.core.afterRestore();
  assert.equal(x.core.state().migrate, null);
});

test('대화권: 만 18세 이상이고 구글 로그인일 때만 쓸 수 있고, 맞출 때 남은 수를 받는다 (14~17, 로그아웃이면 숨김)', async () => {
  const teen = setup();
  teen.core.setAge('teen');
  await teen.core.run();
  teen.setLoop({ kind: 'code', code: 'one-time' });
  await teen.core.login();
  assert.equal(teen.core.status().signedIn, true);
  assert.equal(teen.core.status().ai, false);
  assert.equal(teen.core.status().tickets, null);
  assert.ok(!teen.server.calls.some((c) => c.path.startsWith('/v1/ai')), '14~17 은 대화권을 묻지도 않는다');
  const r = await teen.core.askAi(
    { messages: [{ role: 'user', content: '안녕' }], lang: 'ko', persona: '' },
    () => {},
  );
  assert.deepEqual(r, { ok: false, status: 403, error: 'login' });

  const x = setup();
  x.core.setAge('adult');
  await x.core.run();
  assert.equal(x.core.status().ai, false, '기기 계정만으로는 안 된다');
  x.setLoop({ kind: 'code', code: 'one-time' });
  await x.core.login();
  await x.core.run();
  assert.deepEqual([x.core.status().ai, x.core.status().tickets], [true, 10]);
  assert.equal(x.core.aiAgreed(), false);
  x.core.agreeAi();
  assert.equal(x.saved()?.aiAgreed, true);
  await x.core.logout();
  assert.deepEqual([x.core.status().ai, x.core.status().tickets], [false, null]);
});

test('대화권 질문: 조각을 넘기고 남은 수를 고친다. 다 쓰면 0, 끊기면 offline, 서버 실패는 까닭과 되돌린 수', async () => {
  const x = setup();
  x.core.setAge('adult');
  await x.core.run();
  x.setLoop({ kind: 'code', code: 'one-time' });
  await x.core.login();
  await x.core.run();
  const body = {
    messages: [{ role: 'user' as const, content: '안녕' }],
    lang: 'ko' as const,
    persona: '고양이',
  };
  let got = '';
  const ok = await x.core.askAi(body, (t) => {
    got += t;
  });
  assert.deepEqual(ok, { ok: true, tickets: 9 });
  assert.equal(got, '안녕! 나는 AI 야.');
  assert.equal(x.core.status().tickets, 9);
  const sent = x.server.calls.find((c) => c.path === '/v1/ai/chat');
  assert.deepEqual(sent?.body, body);
  assert.match(sent?.auth ?? '', /^fs_/);

  x.server.aiMode = 'cut';
  got = '';
  const cut = await x.core.askAi(body, (t) => {
    got += t;
  });
  assert.deepEqual(cut, { ok: false, status: 0, error: 'offline' });
  assert.equal(got, '안녕! 나는 AI 야.');

  x.server.aiMode = 'budget';
  assert.deepEqual(await x.core.askAi(body, () => {}), {
    ok: false,
    status: 503,
    error: 'budget',
    tickets: 9,
    refunded: true,
  });

  x.server.aiMode = 'ok';
  x.server.tickets = 0;
  const empty = await x.core.askAi(body, () => {});
  assert.deepEqual(empty, { ok: false, status: 409, error: 'no_tickets', tickets: 0 });
  assert.equal(x.core.status().tickets, 0);

  assert.equal(await x.core.reportAi('질문', '답'), true);
  assert.deepEqual(x.server.reports, [{ question: '질문', answer: '답', consent: true }]);
});

// ---- #101: 닉네임, 기기 코드, 운영자, 선물, 쪽지, 채팅 이용권 접근 ----

/** 서버 모드로 켜고 구글 로그인까지 */
async function signedIn(x: ReturnType<typeof setup>, age: 'adult' | 'teen' = 'adult') {
  x.core.setAge(age, '짝꿍친구');
  await x.core.run();
  x.setLoop({ kind: 'code', code: 'one-time' });
  await x.core.login();
  await x.core.run();
}

test('닉네임은 기기 계정을 만들 때 같이 보내고, 바꾸면 PATCH. 틀린 닉네임은 보내지 않는다', async () => {
  const x = setup({ coins: 10 });
  x.core.setAge('adult', '  짝꿍친구 ');
  await x.core.run();
  const dev = x.server.calls.find((c) => c.path === '/v1/device');
  assert.deepEqual(dev?.body, { age: '18+', nickname: '짝꿍친구' });
  const st = x.core.status();
  assert.equal(st.nickname, '짝꿍친구');
  assert.equal(st.code, 'F-ABCD-1234');
  const bad = await x.core.setNickname('me@home');
  assert.deepEqual([bad.ok, bad.problem], [false, 'at']);
  const ok = await x.core.setNickname('새이름');
  assert.equal(ok.ok, true);
  assert.equal(x.server.nickname, '새이름');
  assert.equal(x.saved()?.nicknamePending, false);
});

test('만 14세 미만이면 닉네임을 받아도 보내지 않는다', async () => {
  const x = setup();
  x.core.setAge('under14', '아이이름');
  await x.core.run();
  assert.equal(x.server.calls.length, 0);
  assert.equal(x.core.status().nickname, null);
});

test('운영자: 서버가 세션에 admin true 라고 할 때만, 기기 토큰만이면 아니다', async () => {
  const x = setup();
  x.server.admin = true;
  x.core.setAge('adult', '운영자');
  await x.core.run();
  assert.equal(x.core.status().admin, false);
  assert.equal(await x.core.adminOverview(), undefined);
  x.setLoop({ kind: 'code', code: 'one-time' });
  await x.core.login();
  await x.core.run();
  assert.equal(x.core.status().admin, true);
  assert.deepEqual(await x.core.adminOverview(), { ai: { mode: 'allowlist' } });
  // 서버가 운영자 지정을 빼면 다음 맞추기에서 바로 사라진다
  x.server.admin = false;
  await x.core.run();
  assert.equal(x.core.status().admin, false);
});

test('선물 받기는 한 번, 받으면 맞추기로 잔액이 들어온다. 쿠폰 실패는 까닭 그대로', async () => {
  const x = setup({ coins: 10 });
  x.core.setAge('teen', '선물받이');
  await x.core.run();
  const r = await x.core.claim('ev-1');
  assert.deepEqual(r, { ok: true, coins: 30, tickets: 0 });
  assert.equal(x.todos.balance(), 40);
  assert.deepEqual(await x.core.claim('ev-1'), { ok: false, error: 'already_claimed' });
  assert.deepEqual(await x.core.coupon('ABCDEFGHJKMN'), { ok: false, error: 'no_coupon' });
  x.server.down = true;
  assert.deepEqual(await x.core.claim('ev-2'), { ok: false, error: 'offline' });
});

test('열지 않은 쪽지가 있으면 맞추기 뒤 onInbox, 상태에 수', async () => {
  const x = setup();
  x.core.setAge('teen', '쪽지');
  x.server.inbox = 2;
  await x.core.run();
  assert.deepEqual(x.inboxCalls, [2]);
  assert.equal(x.core.status().inbox, 2);
});

test('채팅 이용권: 허용 목록에 없거나 대기 중이면 칸을 숨기고 대기 안내', async () => {
  const x = setup();
  x.server.aiAccess = 'not_allowed';
  await signedIn(x);
  assert.equal(x.core.status().ai, false);
  assert.equal(x.core.aiAvailable(), false);
  x.server.aiAccess = 'waitlisted';
  await x.core.run();
  assert.equal(x.core.status().aiWaitlisted, true);
  x.server.aiAccess = 'ok';
  await x.core.run();
  assert.equal(x.core.status().ai, true);
  assert.equal(x.core.status().aiWaitlisted, false);
});

test('로그인 서비스는 서버가 알려 준 것만: 카카오는 목록에 있을 때만, 로그인한 뒤 잇기는 토큰으로 begin (#102)', async () => {
  const x = setup({ coins: 10 });
  x.core.setAge('adult');
  await x.core.run();
  assert.deepEqual(x.core.status().providers, { login: ['google'], link: [] });
  // 목록에 없으면 카카오 로그인은 아무것도 열지 않는다 (앱에 박아 두지 않는다)
  await x.core.login('kakao');
  assert.equal(x.opened.length, 0);
  assert.equal(x.server.begins.length, 0);
  // 구글로 로그인
  x.setLoop({ kind: 'code', code: 'g' });
  await x.core.login('google');
  assert.deepEqual(x.core.status().logins, ['google']);
  // 서버가 이 계정에 카카오 잇기를 허락했다 (allowlist)
  x.server.providers = { login: ['google'], link: ['google', 'kakao'] };
  await x.core.refreshProviders(true);
  assert.deepEqual(x.core.status().providers?.link, ['google', 'kakao']);
  x.setLoop({ kind: 'code', code: 'k' });
  const googleSession = x.secrets.session;
  await x.core.login('kakao');
  assert.deepEqual(x.server.begins, [{ service: 'kakao', auth: googleSession }]);
  assert.equal(new URL(x.opened.at(-1) ?? '').host, 'kauth.example');
  assert.deepEqual(x.core.status().logins, ['google', 'kakao']);
  // 맞추기마다 다시 묻는다 (운영자가 바꾼 스위치가 다음 맞추기에 보이게). 5초 안의 연달은 맞추기는 한 번만
  const n = x.server.providerCalls;
  await x.core.run();
  await x.core.run();
  assert.equal(x.server.providerCalls, n + 1, '5초 안에는 한 번');
  x.tick(6_000);
  x.server.providers = { login: ['google'], link: ['google'] };
  await x.core.run();
  assert.equal(x.server.providerCalls, n + 2);
  assert.deepEqual(
    x.core.status().providers?.link,
    ['google'],
    '운영자가 끈 카카오가 다음 맞추기에 사라진다',
  );
  await x.core.logout();
  assert.deepEqual(x.core.status().logins, []);
});

test('서버 백업: 로그인과 따로 동의 뒤에만 올리고, 받으면 되살리기 확인 칸을 연다 (#102)', async () => {
  const x = setup({ coins: 10 });
  x.core.setAge('teen');
  await x.core.run();
  assert.equal(x.core.status().backup, null, '로그인 전에는 칸이 없다');
  assert.equal((await x.core.backupUpload()).error, 'consent');
  x.setLoop({ kind: 'code', code: 'g' });
  await x.core.login();
  const v = x.core.status().backup;
  assert.equal(v?.agreed, false);
  assert.equal((await x.core.backupUpload()).error, 'consent');
  assert.equal(x.server.backups.length, 0);
  x.core.agreeBackup(true);
  assert.equal(x.saved()?.backupAgreed, true);
  const up = await x.core.backupUpload();
  assert.equal(up.ok, true, JSON.stringify(up));
  assert.equal(x.server.lastUploadConsent, 'yes');
  assert.equal(x.core.status().backup?.list?.length, 1);
  // 세 번 올려도 서버가 2개만 둔다 (목록을 다시 받는다)
  await x.core.backupUpload();
  await x.core.backupUpload();
  const list = x.core.status().backup?.list ?? [];
  assert.equal(list.length, 2);
  // 받기: 같은 바이트로 확인 칸을 연다
  const got = await x.core.backupDownload(list[0]?.id ?? 0);
  assert.equal(got.ok, true);
  assert.deepEqual([...(x.restored[0] ?? [])], [0x50, 0x4b, 0x03, 0x04, 1, 2, 3]);
  // 서버가 바뀐 바이트를 주면(크기, sha256) 열지 않는다
  const first = x.server.backups[0];
  if (first) first.bytes = new Uint8Array([9, 9, 9, 9, 9, 9, 9]);
  assert.equal((await x.core.backupDownload(first?.id ?? 0)).error, 'failed');
  assert.equal(x.restored.length, 1);
  // 지우기
  assert.equal((await x.core.backupDelete(list[1]?.id ?? 0)).ok, true);
  assert.equal(x.core.status().backup?.list?.length, 1);
  // 너무 큰 파일은 보내지 않는다
  x.setBackupBytes(new Uint8Array(20 * 1024 * 1024 + 1));
  const calls = x.server.calls.length;
  assert.equal((await x.core.backupUpload()).error, 'tooBig');
  assert.equal(x.server.calls.length, calls);
  // 서버가 백업을 열지 않았다
  x.setBackupBytes(new Uint8Array([0x50, 0x4b, 0x03, 0x04]));
  x.server.backupOff = true;
  assert.equal((await x.core.backupUpload()).error, 'off');
  assert.equal(x.core.status().backup?.off, true);
  // 서버에 닿지 않음
  x.server.backupOff = false;
  x.server.down = true;
  assert.equal((await x.core.backupUpload()).error, 'offline');
  x.server.down = false;
  // 로그아웃하면 칸이 사라진다
  await x.core.logout();
  assert.equal(x.core.status().backup, null);
});

test('기능 키 coin_reset: 서버 모드에서 서버가 켜졌다고 알려 줄 때만 켜진다, 그 밖은 모두 꺼짐 (#102)', async () => {
  // 서버 주소 없음
  const none = setup({ url: '' });
  none.core.setAge('adult');
  assert.equal(featureOn(none.core.status(), 'coin_reset'), false);
  // 만 14세 미만
  const kid = setup();
  kid.core.setAge('under14');
  await kid.core.run();
  assert.equal(featureOn(kid.core.status(), 'coin_reset'), false);
  // 서버 모드, 서버가 꺼 둠(기본) / 서버에 닿지 않음 / 켬
  const x = setup();
  x.server.down = true;
  x.core.setAge('adult');
  await x.core.run();
  assert.equal(featureOn(x.core.status(), 'coin_reset'), false, '서버에 닿기 전');
  x.server.down = false;
  await x.core.run();
  assert.equal(featureOn(x.core.status(), 'coin_reset'), false, '서버 기본 off');
  x.server.coinReset = true;
  await x.core.refreshProviders(true);
  assert.equal(featureOn(x.core.status(), 'coin_reset'), true);
  // 만 14세 미만으로 바꾸면 다시 꺼짐
  x.core.setAge('under14');
  assert.equal(featureOn(x.core.status(), 'coin_reset'), false);
});

test('서버 백업: 전체 상한이면 full, 로그아웃과 탈퇴하면 동의를 거둔다 (#102)', async () => {
  const x = setup({ coins: 10 });
  x.core.setAge('adult');
  await x.core.run();
  x.setLoop({ kind: 'code', code: 'g' });
  await x.core.login();
  x.core.agreeBackup(true);
  x.server.backupFull = true;
  assert.equal((await x.core.backupUpload()).error, 'full');
  x.server.backupFull = false;
  await x.core.logout();
  assert.equal(x.saved()?.backupAgreed, false, '로그아웃하면 동의를 거둔다');
  await x.core.login();
  x.core.agreeBackup(true);
  await x.core.remove();
  assert.equal(x.saved()?.backupAgreed, false, '탈퇴하면 동의를 거둔다');
});

test('서버 백업: 올리기와 받기가 끝나 돌려준 상태는 busy 가 풀린 것이다 (QA #112: 화면이 "받는 중"에 멈춤)', async () => {
  const x = setup({ coins: 10 });
  x.core.setAge('adult');
  await x.core.run();
  x.setLoop({ kind: 'code', code: 'g' });
  await x.core.login();
  x.core.agreeBackup(true);
  const up = await x.core.backupUpload();
  assert.equal(up.ok, true);
  assert.equal(up.status?.backup?.busy, null);
  const id = up.status?.backup?.list?.[0]?.id ?? 0;
  const down = await x.core.backupDownload(id);
  assert.equal(down.ok, true);
  assert.equal(down.status?.backup?.busy, null);
  x.server.down = true;
  const fail = await x.core.backupUpload();
  assert.equal(fail.error, 'offline');
  assert.equal(fail.status?.backup?.busy, null);
});

// ---- #115: 같은 계정의 기기끼리 구글 일정 연결 이어 주기 ----

const calendarPatches = (x: ReturnType<typeof setup>) =>
  x.server.calls.filter(
    (c) => c.path === '/v1/account' && (c.body as { calendarLinked?: unknown })?.calendarLinked !== undefined,
  );

test('다른 기기에서 연결했고 이 기기는 아직이면 안내, 거절하면 이 기기에서는 다시 묻지 않는다 (#115)', async () => {
  const cal = { linked: false };
  const x = setup({ calendar: cal });
  x.server.calendarOthers = 1;
  x.core.setAge('adult');
  await x.core.run();
  assert.equal(x.core.status().calendarHint, false, '로그인 전에는 안내하지 않는다');
  assert.equal(calendarPatches(x).length, 0, '로그인 전에는 올리지 않는다');
  await signedIn(x);
  assert.equal(x.core.status().calendarHint, true);
  // 연결하지 않은 기기는 거짓을 올리지 않아도 된다 (처음 값이 거짓이라 한 번만 올린다)
  assert.equal(calendarPatches(x).length, 1);
  assert.equal(x.server.calendarHere, false);
  await x.core.run();
  assert.equal(calendarPatches(x).length, 1, '같은 값은 다시 보내지 않는다');
  x.core.calendarHintNo();
  assert.equal(x.core.status().calendarHint, false);
  assert.equal(x.saved()?.calendarHintNo, true);
  await x.core.run();
  assert.equal(x.core.status().calendarHint, false, '다시 묻지 않는다');
});

test('이 기기가 연결하면 기기 토큰으로 참을 올리고 안내가 사라진다, 끊으면 거짓 (#115)', async () => {
  const cal = { linked: false };
  const x = setup({ calendar: cal });
  x.server.calendarOthers = 1;
  await signedIn(x);
  assert.equal(x.core.status().calendarHint, true);
  cal.linked = true;
  await x.core.calendarChanged();
  const last = calendarPatches(x).at(-1);
  assert.deepEqual(last?.body, { calendarLinked: true });
  assert.equal(last?.auth, x.secrets.device, '기기 토큰으로 (서버가 기기마다 센다)');
  assert.equal(x.server.calendarHere, true);
  assert.equal(x.core.status().calendarHint, false);
  // 다른 기기가 모두 끊고 이 기기만 남아도 안내는 없다 (이 기기 몫은 뺀다)
  x.server.calendarOthers = 0;
  cal.linked = false;
  await x.core.calendarChanged();
  assert.equal(x.server.calendarHere, false);
  assert.equal(x.core.status().calendarHint, false);
});

test('이 기기 몫만 남은 서버 수로는 안내하지 않는다 (올린 참을 아직 못 고쳤을 때) (#115)', async () => {
  const cal = { linked: true };
  const x = setup({ calendar: cal });
  await signedIn(x);
  assert.equal(x.server.calendarHere, true);
  // 끊었는데 서버가 내려가 거짓을 못 올렸다: 서버 수 1 은 이 기기 몫이다
  x.server.patchFail = true;
  cal.linked = false;
  await x.core.calendarChanged();
  assert.equal(x.core.status().calendarHint, false);
  x.server.patchFail = false;
  await x.core.run();
  assert.equal(x.server.calendarHere, false, '다음 맞추기 때 다시 올린다');
});

test('기능 키가 꺼져 있으면 참을 올리지도 안내하지도 않는다, 끄기는 올린다 (#115)', async () => {
  const cal = { linked: true };
  const x = setup({ calendar: cal });
  x.server.calendarHint = false;
  x.server.calendarOthers = 1;
  await signedIn(x);
  assert.equal(calendarPatches(x).length, 0);
  assert.equal(x.core.status().calendarHint, false);
  // 켜져 있을 때 올린 참은 기능 키가 꺼져도 끊으면 거짓으로 고친다
  x.server.calendarHint = true;
  await x.core.refreshProviders(true);
  await x.core.calendarChanged();
  assert.equal(x.server.calendarHere, true);
  x.server.calendarHint = false;
  await x.core.refreshProviders(true);
  cal.linked = false;
  await x.core.calendarChanged();
  assert.equal(x.server.calendarHere, false);
  assert.equal(x.core.status().calendarHint, false);
});

test('만 14세 미만, 서버 주소 없음, 로그아웃이면 아무것도 하지 않는다 (#115)', async () => {
  const none = setup({ url: '', calendar: { linked: true } });
  none.core.setAge('adult');
  await none.core.calendarChanged();
  assert.equal(none.server.calls.length, 0);
  assert.equal(none.core.status().calendarHint, false);
  const x = setup({ calendar: { linked: false } });
  x.server.calendarOthers = 1;
  await signedIn(x);
  assert.equal(x.core.status().calendarHint, true);
  await x.core.logout();
  assert.equal(x.core.status().calendarHint, false, '로그아웃하면 안내도 없다');
  const before = calendarPatches(x).length;
  await x.core.calendarChanged();
  assert.equal(calendarPatches(x).length, before);
  const y = setup({ calendar: { linked: false } });
  y.server.calendarOthers = 1;
  await signedIn(y);
  y.core.setAge('under14');
  assert.equal(y.core.status().calendarHint, false);
  const n = y.server.calls.length;
  await y.core.calendarChanged();
  await y.core.run();
  assert.equal(y.server.calls.length, n, '만 14세 미만으로 바꾼 뒤에는 보내지 않는다');
});

test('상태 파일: 거절과 올린 값은 남고, 모양이 틀리면 처음 값 (#115)', () => {
  assert.equal(parseState({ calendarSent: true, calendarHintNo: true }).calendarSent, true);
  assert.equal(parseState({ calendarHintNo: true }).calendarHintNo, true);
  assert.equal(parseState({ calendarSent: 'yes', calendarHintNo: 1 }).calendarSent, null);
  assert.equal(parseState({ calendarHintNo: 1 }).calendarHintNo, false);
});

test('로그아웃한 뒤 끊어도 기기 토큰으로 거짓을 올린다 (QA #122: 다른 기기에 안내가 남았다) (#115)', async () => {
  const cal = { linked: true };
  const x = setup({ calendar: cal });
  await signedIn(x);
  assert.equal(x.server.calendarHere, true);
  await x.core.logout();
  assert.equal(x.server.calendarHere, true, '로그아웃만으로는 표시를 지우지 않는다 (같은 계정의 기기)');
  cal.linked = false;
  await x.core.calendarChanged();
  await x.core.run();
  assert.equal(x.server.calendarHere, false);
  // 로그아웃한 동안 다시 연결해도 켜기는 로그인한 뒤에만
  cal.linked = true;
  await x.core.calendarChanged();
  assert.equal(x.server.calendarHere, false);
});

test('세션이 끝난(401) 뒤 끊어도 거짓을 올린다 (QA #122) (#115)', async () => {
  const cal = { linked: true };
  const x = setup({ calendar: cal });
  await signedIn(x);
  x.server.sessions.clear();
  await x.core.run();
  cal.linked = false;
  await x.core.calendarChanged();
  await x.core.run();
  assert.equal(x.server.calendarHere, false);
});

test('연결과 끊기를 빠르게 되풀이해도 한 번에 하나만 보내고 마지막 값이 남는다 (QA #122) (#115)', async () => {
  const cal = { linked: false };
  const x = setup({ calendar: cal });
  await signedIn(x);
  x.server.calendarDelayMs = 20;
  const runs: Promise<void>[] = [];
  for (const v of [true, false, true, false, true]) {
    cal.linked = v;
    runs.push(x.core.calendarChanged());
    await new Promise((r) => setTimeout(r, 5));
  }
  await Promise.all(runs);
  await x.core.calendarChanged();
  assert.equal(x.server.calendarMaxInFlight, 1, '동시에 둘 이상 보내지 않는다');
  assert.equal(x.server.calendarHere, true, '마지막 값');
  assert.equal(x.saved()?.calendarSent, true);
  cal.linked = false;
  const a = x.core.calendarChanged();
  cal.linked = true;
  const b = x.core.calendarChanged();
  cal.linked = false;
  await Promise.all([a, b, x.core.calendarChanged()]);
  assert.equal(x.server.calendarHere, false);
  assert.equal(x.server.calendarMaxInFlight, 1);
});

test('만 14세 미만으로 바꾸면 끄기 전에 거짓을 올리고, 그 뒤로는 보내지 않는다 (#115)', async () => {
  const cal = { linked: true };
  const x = setup({ calendar: cal });
  await signedIn(x);
  assert.equal(x.server.calendarHere, true);
  x.core.setAge('under14');
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(x.server.calendarHere, false, '끄기 전에 보낸 거짓');
  const n = x.server.calls.length;
  cal.linked = false;
  await x.core.calendarChanged();
  await x.core.run();
  assert.equal(x.server.calls.length, n, '끈 뒤에는 보내지 않는다');
});
