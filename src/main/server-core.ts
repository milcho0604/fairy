// 페어리 서버 계정의 앱 쪽 흐름 (기획서 5, 6, 7, 21절, 이슈 #99). Electron 없이 돌아 시험에서 그대로 부른다.
// main/server.ts 가 설정 창 IPC, 토큰 파일(safeStorage), 브라우저 열기, 타이머를 붙인다.
//
// - 서버 주소가 없거나 만 14세 미만(앱 안 모드)이거나 서버 모드를 끈 동안은 어떤 요청도 보내지 않는다 (allowed).
//   하나 예외는 사용자가 누른 탈퇴다 (만 14세 미만으로 바꾼 뒤 남은 계정을 지울 수 있게).
// - 처음: 기기 계정(/v1/device) → 기존 잔액과 산 물건 옮기기(/v1/migrate, 한 번) → 코인 맞추기(/v1/sync).
//   옮기기가 끝나기 전에는 맞추기를 보내지 않는다.
// - 서버가 꺼져 있어도 앱은 사본 잔액(앱 장부)으로 돈다. 대기열은 파일에 남아 살아나면 보낸다.
import { createHash, randomBytes } from 'node:crypto';
import {
  type AccountSummary,
  type AgeAnswer,
  ageClass,
  isAgeAnswer,
  type ServerProblem,
  type ServerStatus,
} from '../shared/server-account.ts';
import type { ApiResult, ServerApi } from './server-api.ts';
import { mergeNeeded, SYNC_BATCH, summary } from './server-api.ts';
import { type CoinQueue, emptyQueue, type QueueEntry, type Reverted, revertable } from './server-coins.ts';

/** 파일에 두는 상태 (server-state.json, 백업에 넣지 않는다: 나이 답은 이 컴퓨터의 것) */
export interface ServerState {
  v: 1;
  age: AgeAnswer | null;
  /** 서버 모드를 켰다. 만 14세 미만으로 바꾸거나 탈퇴하면 끈다 */
  on: boolean;
  /** 기존 잔액 옮기기를 마쳤다 (서버가 받았거나 이미 받았다고 했다) */
  migrated: boolean;
  /** 옮기기에 올릴 한 시점 (다시 보낼 때도 같은 값) */
  migrate: { balance: number; items: Record<string, number>; maxId: number } | null;
  coins: CoinQueue;
  /** 서버 정본의 마지막 사본 */
  copy: AccountSummary | null;
  lastSyncAt: number | null;
  /** 바꾼 나이 구분을 아직 서버에 못 알렸다 (PATCH /v1/account, 다음 맞추기 때 다시) */
  agePending: boolean;
}

export function freshState(): ServerState {
  return {
    v: 1,
    age: null,
    on: false,
    migrated: false,
    migrate: null,
    coins: emptyQueue(),
    copy: null,
    lastSyncAt: null,
    agePending: false,
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const SALT = /^[A-Za-z0-9_-]{8,32}$/;

function itemsOf(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isObj(v)) return out;
  for (const [k, n] of Object.entries(v)) if (isCount(n) && n > 0) out[k] = n;
  return out;
}

function entryOf(v: unknown): QueueEntry | undefined {
  if (!isObj(v)) return undefined;
  const { id, logId, reason, amount, day, at, ref } = v;
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(id)) return undefined;
  if (!isCount(logId) || typeof reason !== 'string' || !Number.isInteger(amount)) return undefined;
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day) || !isCount(at)) return undefined;
  return {
    id,
    logId,
    reason,
    amount: amount as number,
    day,
    at,
    ...(typeof ref === 'string' && /^[0-9a-f]{16}$/.test(ref) ? { ref } : {}),
  };
}

/** 파일에서 읽은 값 검사. 모양이 틀린 칸은 처음 값으로 */
export function parseState(raw: unknown): ServerState {
  const s = freshState();
  if (!isObj(raw)) return s;
  if (isAgeAnswer(raw.age)) s.age = raw.age;
  s.on = raw.on === true && s.age !== null && s.age !== 'under14';
  s.migrated = raw.migrated === true;
  const m = raw.migrate;
  if (isObj(m) && isCount(m.balance) && isCount(m.maxId))
    s.migrate = { balance: m.balance, items: itemsOf(m.items), maxId: m.maxId };
  const c = raw.coins;
  if (isObj(c) && typeof c.salt === 'string' && SALT.test(c.salt) && isCount(c.scanned)) {
    s.coins = {
      salt: c.salt,
      refSalt: typeof c.refSalt === 'string' && SALT.test(c.refSalt) ? c.refSalt : s.coins.refSalt,
      scanned: c.scanned,
      queue: Array.isArray(c.queue) ? c.queue.flatMap((e) => entryOf(e) ?? []) : [],
    };
  }
  if (isObj(raw.copy) && isCount(raw.copy.balance)) s.copy = summary(raw.copy);
  if (isCount(raw.lastSyncAt)) s.lastSyncAt = raw.lastSyncAt;
  s.agePending = raw.agePending === true;
  return s;
}

export interface Secret {
  get(): string | undefined;
  /** 운영체제 열쇠로만 쓴다. 못 쓰면 던진다 (평문 저장 금지) */
  set(value: string | null): void;
  /** 파일은 있는데 지금 열쇠로 풀지 못한다 (열쇠가 바뀜). 덮어쓰지 않는다 */
  unreadable(): boolean;
}

export interface LoopbackLike {
  redirectUri: string;
  result: Promise<
    | { kind: 'code'; code: string }
    | { kind: 'error'; error: string }
    | { kind: 'timeout' }
    | { kind: 'cancelled' }
  >;
  cancel: () => void;
}

/** 코인 장부 쪽 (server-coins.ts ServerCoins) */
export interface CoinsLike {
  scan(q: CoinQueue): number;
  restart(q: CoinQueue): void;
  snapshot(): { balance: number; items: Record<string, number>; maxId: number };
  reconcile(
    q: CoinQueue,
    server: AccountSummary,
    rejected: readonly QueueEntry[],
    now: number,
    keepLocalItems?: boolean,
  ): { delta: number; itemsChanged: boolean };
}

export interface ServerCoreDeps {
  /** 서버 API. 서버 주소가 없으면 undefined (서버 기능이 모두 꺼진다) */
  api: ServerApi | undefined;
  coins: CoinsLike;
  load: () => unknown;
  save: (s: ServerState) => void;
  device: Secret;
  session: Secret;
  /** 운영체제 열쇠(safeStorage)로 암호화할 수 있다. 못 하면 서버 모드를 켜지 않는다 */
  secure: () => boolean;
  loopback: (o: {
    state: string;
    path: string;
    page: (ok: boolean) => { title: string; body: string };
  }) => Promise<LoopbackLike>;
  openExternal: (url: string) => Promise<void>;
  page: (ok: boolean) => { title: string; body: string };
  now: () => number;
  log: (tag: string, ...rest: unknown[]) => void;
  /** 칸 상태가 바뀌었다 (설정 창에 보낸다) */
  onChange: (s: ServerStatus) => void;
  /** 잔액이나 산 물건이 맞추기로 바뀌었다 (패널, 집 창) */
  onCoins: () => void;
  /** 서버가 거절해 되돌린 쓰기 (펫이 알린다) */
  onReverted: (list: Reverted[]) => void;
  random?: (n: number) => Uint8Array;
}

const b64url = (b: Uint8Array) => Buffer.from(b).toString('base64url');

export function createServerCore(d: ServerCoreDeps) {
  const random = d.random ?? ((n: number) => randomBytes(n));
  let st = parseState(d.load());
  let problem: ServerProblem | null = null;
  let syncing = false;
  let running: Promise<void> | null = null;
  let login: { cancel: () => void } | null = null;
  let merge: { code: string; verifier: string; current: AccountSummary; other: AccountSummary } | null = null;

  const enabled = () => d.api !== undefined;
  /** 서버 모드를 켰다 (나이 답과 켬. 열쇠 문제는 blocked) */
  const wanted = () => enabled() && ageClass(st.age) !== undefined && st.on;
  /** 서버 모드인데 토큰을 다룰 수 없다: 열쇠를 못 씀(평문 저장 금지), 토큰 파일을 못 풂(덮어쓰지 않음) */
  const blocked = (): ServerProblem | null =>
    !d.secure() ? 'noSecure' : d.device.unreadable() ? 'keyLost' : null;
  /** 서버로 무엇이든 보내도 되는가 (탈퇴, 로그아웃 말고). 요청마다 다시 본다 */
  const allowed = () => wanted() && blocked() === null;

  function status(): ServerStatus {
    const device = !!d.device.get();
    return {
      enabled: enabled(),
      age: st.age,
      on: st.on,
      device,
      signedIn: !!d.session.get(),
      loggingIn: !!login,
      syncing,
      balance: st.copy?.balance ?? null,
      pending: st.coins.queue.length,
      lastSyncAt: st.lastSyncAt,
      problem: (wanted() && blocked()) || problem,
      merge: merge ? { current: merge.current, other: merge.other } : null,
      leftover: st.age === 'under14' && (device || !!d.session.get()),
    };
  }

  const save = () => {
    try {
      d.save(st);
    } catch (err) {
      d.log('server', '상태 저장 실패', err instanceof Error ? err.message : String(err));
    }
  };
  const changed = () => d.onChange(status());

  const failProblem = (r: { status: number }): ServerProblem => (r.status === 0 ? 'offline' : 'server');

  /** 서버 계정이 없어졌다 (기기 토큰을 서버가 모른다): 서버 모드를 끄고 처음으로 */
  function forgetAccount() {
    d.device.set(null);
    d.session.set(null);
    login?.cancel();
    login = null;
    merge = null;
    st = { ...st, on: false, migrated: false, migrate: null, copy: null, lastSyncAt: null };
    st.coins.queue = [];
    save();
  }

  /** 맞추기에 쓸 토큰: 세션이 먼저, 없으면 기기 */
  const token = () => d.session.get() ?? d.device.get();

  /** 401: 세션이면 세션만 버리고 기기로 한 번 더, 기기면 계정이 없어진 것 */
  function onUnauthorized(): 'retry' | 'gone' {
    if (d.session.get()) {
      d.log('server', '세션이 끝남');
      d.session.set(null);
      return 'retry';
    }
    d.log('server', '기기 계정이 없어짐');
    forgetAccount();
    problem = 'gone';
    return 'gone';
  }

  async function ensureDevice(): Promise<boolean> {
    if (d.device.get()) return true;
    const age = ageClass(st.age);
    if (!d.api || !age || !allowed()) return false;
    const r = await d.api.device(age);
    // 기다리는 사이 만 14세 미만으로 바꾸거나 껐으면 받은 토큰을 버린다 (더 보내지 않는다)
    if (!allowed()) {
      d.log('server', '기기 계정을 받았지만 서버 모드가 꺼져 버림');
      return false;
    }
    if (!r.ok) {
      problem = failProblem(r);
      d.log('server', '기기 계정 못 만듦', r.status, r.error);
      return false;
    }
    // 새 기기 계정은 빈 계정이다: 옮기기부터 다시 (지금 장부의 잔액과 물건을 옮긴다).
    // 옛 계정의 사본, 대기열, 세션은 이 계정 것이 아니다
    st = { ...st, migrated: false, migrate: null, copy: null, lastSyncAt: null, agePending: false };
    st.coins.queue = [];
    try {
      d.session.set(null);
      d.device.set(r.data.token);
    } catch (err) {
      problem = 'noSecure';
      d.log('server', '기기 토큰 저장 실패', err instanceof Error ? err.message : String(err));
      return false;
    }
    save();
    d.log('server', '기기 계정 만듦');
    return true;
  }

  /** 바꾼 나이 구분을 서버에 알린다 (실패하면 다음 맞추기 때 다시) */
  async function ensureAge(): Promise<void> {
    const age = ageClass(st.age);
    const t = token();
    if (!st.agePending || !d.api || !age || !t || !allowed()) return;
    const r = await d.api.setAge(t, age);
    if (r.ok) {
      st.agePending = false;
      save();
      d.log('server', '나이 구분 알림', age);
    } else d.log('server', '나이 구분 못 알림', r.status, r.error);
  }

  async function ensureMigrated(): Promise<boolean> {
    if (st.migrated) return true;
    const device = d.device.get();
    if (!d.api || !device || !allowed()) return false;
    if (!st.migrate) {
      // 이 시점까지의 장부는 옮기기에 든다. 대기열은 그 뒤 줄부터
      const snap = d.coins.snapshot();
      st.migrate = snap;
      st.coins.queue = [];
      st.coins.scanned = snap.maxId;
      save();
    }
    const r = await d.api.migrate(device, { balance: st.migrate.balance, items: st.migrate.items });
    if (r.ok) {
      st.migrated = true;
      st.migrate = null;
      d.log('server', '기존 잔액 옮김', r.data.status, r.data.applied);
      apply({ balance: r.data.balance, items: r.data.items }, []);
      return true;
    }
    if (r.status === 409 && r.error === 'already_migrated') {
      st.migrated = true;
      st.migrate = null;
      save();
      return true;
    }
    if (r.status === 401) {
      onUnauthorized();
      return false;
    }
    problem = failProblem(r);
    d.log('server', '옮기기 실패', r.status, r.error);
    return false;
  }

  /** 서버 정본을 받아 사본과 앱 장부를 맞춘다 */
  function apply(server: AccountSummary, rejected: QueueEntry[]) {
    const now = d.now();
    // 서버 사본이 아직 없으면(처음 맞추기) 서버 대답만으로 로컬 물건을 빼지 않는다
    const r = d.coins.reconcile(st.coins, server, rejected, now, st.copy === null);
    st.copy = { balance: server.balance, items: server.items };
    st.lastSyncAt = now;
    save();
    if (r.delta !== 0 || r.itemsChanged || rejected.length > 0) d.onCoins();
    if (rejected.length > 0) d.onReverted(rejected.map((e) => ({ reason: e.reason, amount: e.amount })));
  }

  async function syncAll(): Promise<void> {
    if (!d.api) return;
    for (let round = 0; round < 20; round++) {
      const t = token();
      if (!t || !allowed()) return;
      const batch = st.coins.queue.slice(0, SYNC_BATCH);
      const r = await d.api.sync(t, batch);
      if (!r.ok) {
        if (r.status === 401) {
          if (onUnauthorized() === 'retry') continue;
          return;
        }
        // 모양이 틀린 기록 하나가 대기열 전체를 막지 않게 그 기록만 버린다 (앱 버그. 기록에 남긴다)
        if (r.status === 400 && r.error === 'entry' && typeof r.body.id === 'string') {
          const id = r.body.id;
          d.log('server', '서버가 기록 모양을 받지 않음', id);
          st.coins.queue = st.coins.queue.filter((e) => e.id !== id);
          save();
          continue;
        }
        problem = failProblem(r);
        d.log('server', '맞추기 실패', r.status, r.error);
        return;
      }
      problem = null;
      const res = new Map(r.data.results.map((x) => [x.id, x]));
      const rejected = batch.filter((e) => res.get(e.id)?.status === 'rejected' && revertable(e.reason));
      for (const e of batch) {
        const x = res.get(e.id);
        if (x && x.status !== 'ok')
          d.log('server', '기록', x.status, e.reason, e.amount, x.applied, x.error ?? '');
      }
      st.coins.queue = st.coins.queue.filter((e) => !res.has(e.id));
      apply({ balance: r.data.balance, items: r.data.items }, rejected);
      if (st.coins.queue.length === 0 || batch.length < SYNC_BATCH) return;
    }
  }

  /** 켤 때, 몇 분마다, 지금 맞추기: 기기 계정 → 옮기기 → 맞추기. 한 번에 하나만 */
  function run(): Promise<void> {
    if (!allowed()) {
      changed();
      return Promise.resolve();
    }
    if (running) return running;
    running = (async () => {
      syncing = true;
      changed();
      try {
        scan();
        if (!(await ensureDevice())) return;
        if (!(await ensureMigrated())) return;
        await ensureAge();
        await syncAll();
      } catch (err) {
        problem = 'server';
        d.log('server', '맞추기 중 오류', err instanceof Error ? err.message : String(err));
      } finally {
        syncing = false;
        running = null;
        changed();
      }
    })();
    return running;
  }

  /** 새 장부 줄을 대기열로 (서버로 보내지는 않는다) */
  function scan() {
    if (!allowed() || !st.migrated) return;
    if (d.coins.scan(st.coins) > 0) save();
  }

  // ---- 로그인 (구글, 루프백 + 로컬 PKCE) ----

  async function exchange(code: string, verifier: string, yes: boolean): Promise<void> {
    const t = token();
    if (!d.api || !t || !allowed()) return;
    const r: ApiResult<unknown> = await d.api.session(t, code, verifier, yes);
    if (r.ok) {
      const data = r.data as { session: string; merged: boolean; linked: boolean };
      try {
        d.session.set(data.session);
      } catch {
        problem = 'noSecure';
        return;
      }
      problem = null;
      d.log('server', '로그인함', data.merged ? '합침' : '', data.linked ? '이음' : '');
      // 합쳤으면 잔액과 물건이 바뀌었다
      void run();
      return;
    }
    if (r.status === 409 && r.error === 'merge_needed') {
      const m = mergeNeeded(r.body);
      if (m) {
        merge = { ...m, verifier };
        return;
      }
    }
    if (r.status === 503 && r.error === 'login_off') problem = 'loginOff';
    else if (r.status === 0) problem = 'offline';
    else problem = 'failed';
    d.log('server', '로그인 실패', r.status, r.error);
  }

  async function startLogin(): Promise<ServerStatus> {
    if (!allowed() || !d.api) return status();
    if (!d.device.get()) await run();
    if (!d.device.get()) return status();
    login?.cancel();
    merge = null;
    problem = null;
    const verifier = b64url(random(32));
    const challenge = createHash('sha256').update(verifier, 'ascii').digest('base64url');
    const state = b64url(random(24));
    const lb = await d.loopback({ state, path: '/done', page: d.page });
    const mine = { cancel: lb.cancel };
    login = mine;
    changed();
    const port = Number(new URL(lb.redirectUri).port);
    try {
      await d.openExternal(d.api.startUrl(port, state, challenge));
    } catch (err) {
      d.log('server', '브라우저 열기 실패', err instanceof Error ? err.name : 'error');
      lb.cancel();
      problem = 'failed';
    }
    const r = await lb.result;
    if (login !== mine) return status();
    login = null;
    if (r.kind === 'timeout') problem = 'timeout';
    else if (r.kind === 'error') problem = r.error === 'denied' ? 'denied' : 'failed';
    else if (r.kind === 'code') await exchange(r.code, verifier, false);
    changed();
    return status();
  }

  async function answerMerge(yes: boolean): Promise<ServerStatus> {
    const m = merge;
    merge = null;
    if (m && yes && allowed()) await exchange(m.code, m.verifier, true);
    changed();
    return status();
  }

  function cancelLogin() {
    login?.cancel();
    login = null;
    changed();
  }

  // ---- 탈퇴 ----

  async function remove(): Promise<{ ok: boolean; status: ServerStatus }> {
    const t = token();
    if (!t || !d.api) {
      forgetAccount();
      changed();
      return { ok: true, status: status() };
    }
    let r = await d.api.remove(t);
    // 세션이 끝났으면 기기 토큰으로 한 번 더
    if (!r.ok && r.status === 401 && d.session.get() && d.device.get()) {
      d.session.set(null);
      r = await d.api.remove(d.device.get() as string);
    }
    if (r.ok || r.status === 401) {
      forgetAccount();
      problem = null;
      d.log('server', '탈퇴함');
      changed();
      return { ok: true, status: status() };
    }
    problem = failProblem(r);
    changed();
    return { ok: false, status: status() };
  }

  return {
    status,
    run,
    scan,
    allowed,
    setAge(age: unknown): ServerStatus {
      if (!isAgeAnswer(age) || !enabled()) return status();
      const was = st.age;
      st.age = age;
      // 14+ 와 18+ 사이를 바꿨으면 서버에도 알린다 (기기 계정이 있을 때. 없으면 만들 때 지금 값을 보낸다)
      if (ageClass(was) && ageClass(age) && ageClass(was) !== ageClass(age) && d.device.get())
        st.agePending = true;
      if (age === 'under14') {
        // 앱 안 모드: 아무것도 보내지 않는다. 남은 서버 계정은 칸이 탈퇴를 안내한다
        st.on = false;
        login?.cancel();
        login = null;
        merge = null;
        problem = null;
      } else if (was === null || was === 'under14') st.on = true;
      save();
      changed();
      if (st.on) void run();
      return status();
    },
    /** 서버 모드 다시 켜기 (탈퇴 뒤, 계정이 없어진 뒤) */
    turnOn(): ServerStatus {
      if (ageClass(st.age) && enabled()) {
        st.on = true;
        problem = null;
        save();
        void run();
      }
      changed();
      return status();
    },
    login: startLogin,
    cancelLogin,
    /** 로그아웃: 서버의 세션도 지운다 (실패해도 이 컴퓨터에서는 지운다). 기기 토큰은 같은 계정 그대로 */
    async logout(): Promise<ServerStatus> {
      const t = d.session.get();
      merge = null;
      d.session.set(null);
      if (t && d.api) {
        const r = await d.api.logout(t);
        if (!r.ok) d.log('server', '서버 세션 못 지움', r.status, r.error);
      }
      d.log('server', '로그아웃');
      changed();
      return status();
    },
    merge: answerMerge,
    remove,
    /** 백업을 되살리기 전: 지금 장부 줄을 대기열에 넣어 둔다 (되살린 뒤에는 옛 장부가 없다) */
    beforeRestore() {
      scan();
    },
    /**
     * 백업을 되살린 뒤 켰다 (기획서 7절: 서버 모드에서는 백업에서 코인을 되살리지 않는다).
     * 되살린 장부 줄은 보내지 않고, 잔액과 물건은 서버 사본으로 바로 맞춘다 (서버에 닿으면 다시 맞춘다)
     */
    afterRestore() {
      if (!st.migrated) {
        // 옮기기 전: 잡아 둔 한 시점은 옛 장부 것이다. 버리고 되살린 장부에서 다시 잡는다
        if (st.migrate) {
          st.migrate = null;
          d.coins.restart(st.coins);
          save();
        }
        return;
      }
      d.coins.restart(st.coins);
      save();
      if (st.copy && allowed()) {
        try {
          const r = d.coins.reconcile(st.coins, st.copy, [], d.now());
          save();
          if (r.delta !== 0 || r.itemsChanged) d.onCoins();
        } catch (err) {
          d.log('server', '되살린 뒤 맞추기 실패', err instanceof Error ? err.message : String(err));
        }
      }
    },
    /** 시험용 */
    state: () => st,
  };
}

export type ServerCore = ReturnType<typeof createServerCore>;
