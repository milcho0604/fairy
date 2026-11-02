// 기기 간 동기화 엔진 (docs/sync-plan.md 3, 6절). Electron 없이 돌아 시험에서 가짜 서버와 저장 파일 둘로 그대로 부른다.
// main/server.ts 가 세션 호출(sessionCall), 열쇠 보관(safeStorage), 타이머와 쓰기 알림을 붙인다.
//
// - 한 차례: 받기(changes) → 합쳐 적용 → 보내기(push, conflict 는 받아 합친 뒤 다시, 한 번에 3번까지).
// - 상태(켜짐, 기기 번호, 커서, epoch, gen, 계정)는 저장 파일 밖 sync-state 파일에, 데이터 열쇠는 운영체제 열쇠로만 둔다.
// - 닿지 않으면 앱은 그대로 돌고 늦춰 가며 다시 한다. 풀지 못하거나 적용하지 못한 항목은 그 항목만 보류한다.
import { randomBytes } from 'node:crypto';
import type { Db } from '../../shared/db-schema.ts';
import { t as tr } from '../../shared/i18n/index.ts';
import { SYNC_KINDS, type SyncKind } from '../../shared/sync-fields.ts';
import {
  bodyHash,
  clampClock,
  conflictCopy,
  conflictDate,
  type Json,
  mergeItems,
  type SyncItem,
  sameContent,
} from '../../shared/sync-item.ts';
import type { SyncPhase, SyncProblem, SyncView } from '../../shared/sync-view.ts';
import type { ApiResult, ServerApi, SyncChange, SyncPushItem } from '../server-api.ts';
import type { Secret } from '../server-core.ts';
import {
  newDataKey,
  newRecoveryCode,
  openItem,
  SCRYPT_DEFAULT,
  type ScryptParams,
  sealItem,
  unwrapDataKey,
  wrapDataKey,
} from './crypto.ts';
import * as rows from './rows.ts';

export type SyncServerApi = Pick<
  ServerApi,
  'syncKeyGet' | 'syncKeyPut' | 'syncStatus' | 'syncChanges' | 'syncPush' | 'syncRemove'
>;

/** 저장 파일 밖에 두는 상태 (sync-state 파일) */
export interface SyncState {
  v: 1;
  on: boolean;
  /** 켠 계정 (서버 계정 코드). 다른 계정으로 바뀌면 열쇠와 커서를 지운다 */
  account: string | null;
  /** 이 기기의 번호 (칸 시각이 같을 때가 아니라, 보낸 기기 표시용). 백업을 되살리면 새로 만든다 */
  dev: string;
  /** 받은 번호(서버 rev). 여기까지 받았다 */
  cursor: number;
  epoch: number;
  gen: number;
  keyRev: number;
  /** 서버 사본이 바뀌어(epoch, gen) 복구 코드를 다시 넣어야 한다 */
  paused: 'epoch' | 'gen' | 'code' | null;
  lastAt: number | null;
  full: boolean;
}

export const freshSyncState = (random: (n: number) => Uint8Array = randomBytes): SyncState => ({
  v: 1,
  on: false,
  account: null,
  dev: Buffer.from(random(8)).toString('hex'),
  cursor: 0,
  epoch: 0,
  gen: 0,
  keyRev: 0,
  paused: null,
  lastAt: null,
  full: false,
});

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;

export function parseSyncState(raw: unknown, random?: (n: number) => Uint8Array): SyncState {
  const s = freshSyncState(random);
  if (typeof raw !== 'object' || raw === null) return s;
  const r = raw as Record<string, unknown>;
  if (typeof r.dev === 'string' && /^[0-9a-f]{16}$/.test(r.dev)) s.dev = r.dev;
  s.on = r.on === true && typeof r.account === 'string';
  s.account = typeof r.account === 'string' ? r.account : null;
  if (isCount(r.cursor)) s.cursor = r.cursor;
  if (isCount(r.epoch)) s.epoch = r.epoch;
  if (isCount(r.gen)) s.gen = r.gen;
  if (isCount(r.keyRev)) s.keyRev = r.keyRev;
  s.paused = r.paused === 'epoch' || r.paused === 'gen' || r.paused === 'code' ? r.paused : null;
  if (isCount(r.lastAt)) s.lastAt = r.lastAt;
  s.full = r.full === true;
  return s;
}

export interface SyncDeps {
  db: Db;
  /** 세션으로 서버 부르기 (server-core.ts sessionCall). 로그인하지 않았으면 403 login */
  call: <T>(f: (api: SyncServerApi, session: string) => Promise<ApiResult<T>>) => Promise<ApiResult<T>>;
  /** 지금 로그인한 서버 계정의 코드 (모르면 undefined) */
  account: () => string | undefined;
  load: () => unknown;
  save: (s: SyncState) => void;
  /** 데이터 열쇠 (운영체제 열쇠로만 둔다, base64) */
  key: Secret;
  /** 운영체제 열쇠(safeStorage)를 쓸 수 있다. 못 쓰면 켜지 않는다 */
  secure: () => boolean;
  now: () => number;
  deviceName: () => string;
  random?: (n: number) => Uint8Array;
  log: (tag: string, ...rest: unknown[]) => void;
  /** 상태가 바뀌었다 (설정 창에 보낸다) */
  onChange?: (v: SyncView) => void;
  /** 다른 기기 변경을 저장 파일에 적용했다 (화면을 다시 그린다) */
  onApplied?: () => void;
  /** 새 열쇠를 감쌀 scrypt 값 (시험에서 가볍게) */
  scrypt?: ScryptParams;
  /** 타이머(3초 모음, 1분마다, 닿지 않을 때 늦춤)를 쓴다. 시험은 끈다 */
  timers?: boolean;
}

export type EnableResult =
  | { ok: true; kind: 'created'; code: string }
  | { ok: true; kind: 'needCode' | 'on' }
  | { ok: false; error: string };

export type CodeResult = { ok: true } | { ok: false; error: string };
export type NewCodeResult = { ok: true; code: string } | { ok: false; error: string };

/** 묶음 하나의 항목 수와 덩어리 합(base64 글자) 상한. 서버 본문 상한 4MB 아래 */
const BATCH_ITEMS = 200;
const BATCH_BYTES = 3_500_000;
const PAGE = 500;
/** 서버 덩어리 상한 (바이트) */
const BLOB_MAX = 256 * 1024;
const MIN_MS = 60_000;
const DEBOUNCE_MS = 3_000;
const BACKOFF_MIN_MS = 30_000;
const BACKOFF_MAX_MS = 30 * 60_000;
const USAGE_EVERY_MS = 10 * 60_000;
const ROUNDS = 3;
/** 부모가 이만큼 안 오면 반복 연결을 끊고 적용한다 */
const DEGRADE_MS = 10 * MIN_MS;

const KIND_ORDER: Record<SyncKind, number> = { todo: 0, note: 0, event: 2, todo_step: 3 };

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export function createSyncEngine(d: SyncDeps) {
  const random = d.random ?? ((n: number) => randomBytes(n));
  const params = d.scrypt ?? SCRYPT_DEFAULT;
  let st = parseSyncState(d.load(), random);
  rows.ensureTables(d.db);

  let enabling = false;
  let running = false;
  let offline = false;
  let problem: SyncProblem | null = null;
  let usage: SyncView['usage'] = null;
  let soon = false;
  let usageAt = 0;
  let fails = 0;
  let nextTry = 0;
  let again = false;
  let chain: Promise<unknown> = Promise.resolve();
  let queued: Promise<void> | null = null;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let lastVersion = -1;

  const save = () => {
    try {
      d.save(st);
    } catch (err) {
      d.log('sync', '상태 저장 실패', err instanceof Error ? err.message : String(err));
    }
  };

  // 열쇠는 운영체제 열쇠에서 풀어야 해서 한 번만 읽어 기억한다 (상태를 자주 묻는다)
  let keyCache: Buffer | null | undefined;
  const loadKey = (): Buffer | null => {
    if (keyCache !== undefined) return keyCache;
    let key: Buffer | null = null;
    if (!d.key.unreadable()) {
      const s = d.key.get();
      const b = s ? Buffer.from(s, 'base64') : null;
      key = b && b.length === 32 ? b : null;
    }
    keyCache = key;
    return key;
  };
  const storeKey = (k: Buffer | null) => {
    d.key.set(k ? k.toString('base64') : null);
    keyCache = k;
  };

  function view(): SyncView {
    const on = st.on;
    const phase: SyncPhase = enabling
      ? 'enabling'
      : !on
        ? 'off'
        : loadKey() && !st.paused
          ? 'on'
          : 'needCode';
    const shown: SyncProblem | null = !on
      ? problem === 'account'
        ? 'account'
        : null
      : st.paused === 'epoch'
        ? 'epoch'
        : st.paused === 'gen'
          ? 'gen'
          : st.full
            ? 'full'
            : problem;
    return {
      phase,
      problem: shown,
      lastAt: st.lastAt,
      offline: on && offline,
      pending: on ? rows.outboxCount(d.db) : 0,
      held: on ? rows.holdCount(d.db) : 0,
      usage: on ? usage : null,
      soon: on && soon,
      running,
    };
  }
  const emit = () => d.onChange?.(view());

  // ---- 상태 바꾸기 ----

  /** 이 컴퓨터의 동기화 상태를 지우고 끈다 (열쇠, 커서, 본 번호, 보류). 기기 번호는 둔다 */
  function forgetLocal(): void {
    try {
      storeKey(null);
    } catch {
      // 지우지 못해도 아래에서 꺼진 상태로 둔다
    }
    st = { ...freshSyncState(random), dev: st.dev };
    rows.resetSeen(d.db);
    problem = null;
    offline = false;
    usage = null;
    soon = false;
    clearTimeout(debounce);
    clearTimeout(retry);
    save();
    emit();
  }

  /** 서버 사본이 바뀌었다: 열쇠와 커서를 지우고 복구 코드를 다시 받는 멈춤 상태로 */
  function pause(why: 'epoch' | 'gen'): void {
    try {
      storeKey(null);
    } catch {
      // 열쇠가 남아도 paused 가 맞추기를 막는다
    }
    st.paused = why;
    st.cursor = 0;
    rows.resetSeen(d.db);
    d.log('sync', '멈춤', why);
    save();
    emit();
  }

  function backoff(minMs = 0): void {
    fails += 1;
    nextTry = d.now() + Math.max(minMs, Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** (fails - 1)));
    if (d.timers !== false) {
      clearTimeout(retry);
      retry = setTimeout(() => void run(), Math.max(1000, nextTry - d.now()));
      retry.unref?.();
    }
  }

  /** 서버 호출이 실패했다: 까닭마다 멈추거나 늦춘다 */
  function failed(r: { status: number; error: string; body: Record<string, unknown> }): void {
    if (r.status === 0) {
      offline = true;
      backoff();
    } else if (r.status === 409 && (r.error === 'epoch' || r.error === 'no_key')) pause('epoch');
    else if (r.status === 401 || (r.status === 403 && r.error === 'login')) problem = 'login';
    else if (r.status === 403) problem = 'feature';
    else if (r.status === 426) problem = 'update';
    else if (r.status === 429) {
      // 서버가 분당 요청 수를 막았다 (아주 많은 항목을 처음 받을 때): 한 창(1분)을 쉰다. 받은 곳까지는 커서에 남아 이어 받는다
      backoff(61_000);
    } else if (r.status === 413 && r.error === 'sync_full') {
      st.full = true;
      save();
    } else {
      d.log('sync', '서버 오류', r.status, r.error);
      offline = false;
      backoff();
    }
  }

  // ---- 항목 풀기와 합치기 ----

  const ctx = () => ({ account: st.account as string, gen: st.gen });
  const dev = () => ({ id: st.dev, name: d.deviceName() });

  /** 풀린 글을 항목으로. 모양이 틀리면 던진다 */
  function toItem(o: ReturnType<typeof openItem>, now: number): SyncItem {
    if (!(SYNC_KINDS as readonly string[]).includes(o.kind)) throw new Error('kind');
    if (!isObj(o.f) || !isObj(o.c)) throw new Error('shape');
    const c: Record<string, number> = {};
    for (const [k, v] of Object.entries(o.c))
      c[k] = typeof v === 'number' && Number.isFinite(v) ? clampClock(v, now) : 0;
    return {
      kind: o.kind as SyncKind,
      uid: o.uid,
      f: o.f as Record<string, Json>,
      c,
      dev: typeof o.dev === 'string' ? o.dev : '',
      name: typeof o.name === 'string' ? o.name.slice(0, 60) : '',
      bh: typeof o.bh === 'string' ? o.bh : null,
      ...(typeof o.copyOf === 'string' ? { copyOf: o.copyOf } : {}),
    };
  }

  /** 받은 변경 하나를 저장 파일에 적용한다. 적용한 것이 있으면 true. 던지지 않는다 (실패는 그 항목만 보류) */
  function ingestChange(ch: SyncChange, degrade = false): boolean {
    const seen = rows.getSeen(d.db, ch.uid);
    if (seen && seen.rev >= ch.rev && !degrade) return false;
    const now = d.now();
    d.db.exec('savepoint sync_item');
    try {
      const applied = handle(ch, now, degrade);
      d.db.exec('release sync_item');
      return applied;
    } catch (err) {
      d.db.exec('rollback to sync_item');
      d.db.exec('release sync_item');
      d.log('sync', '적용 실패', err instanceof Error ? err.message : String(err));
      rows.addHold(d.db, ch.uid, null, ch.rev, ch.deleted ? 'tomb' : 'apply', ch.blob, now);
      return false;
    }
  }

  function handle(ch: SyncChange, now: number, degrade: boolean): boolean {
    const key = loadKey();
    if (ch.deleted && !ch.blob) {
      // 서버가 덩어리를 비운 삭제 표식 (90일 뒤): 종류를 모르니 모든 표에서 지운다
      rows.purgeAnyKind(d.db, ch.uid, now);
      rows.setSeen(d.db, 'todo', ch.uid, ch.rev);
      rows.dropHold(d.db, ch.uid);
      return true;
    }
    let opened: ReturnType<typeof openItem>;
    try {
      if (!key) throw new Error('key');
      opened = openItem(key, ctx(), ch.uid, Buffer.from(ch.blob, 'base64'));
    } catch {
      rows.addHold(d.db, ch.uid, null, ch.rev, 'decrypt', ch.blob, now);
      return false;
    }
    if (ch.deleted) {
      if (!(SYNC_KINDS as readonly string[]).includes(opened.kind) || typeof opened.tomb !== 'number') {
        rows.addHold(d.db, ch.uid, null, ch.rev, 'decrypt', ch.blob, now);
        return false;
      }
      return applyTomb(opened.kind as SyncKind, ch.uid, clampClock(opened.tomb, now), ch.rev);
    }
    let item: SyncItem;
    try {
      item = toItem(opened, now);
    } catch {
      rows.addHold(d.db, ch.uid, null, ch.rev, 'decrypt', ch.blob, now);
      return false;
    }
    return ingestAlive(item, ch.rev, ch.blob, now, degrade);
  }

  /** 받은 영구 삭제 표식. 이 기기 행이 표식보다 늦게 만들어졌으면 살린다 */
  function applyTomb(kind: SyncKind, uid: string, t: number, rev: number): boolean {
    let applied = false;
    if (rows.rowId(d.db, kind, uid) !== undefined) {
      if (rows.createdClock(d.db, kind, uid) > t) rows.outboxAdd(d.db, kind, uid);
      else {
        rows.purgeRow(d.db, kind, uid, d.now());
        applied = true;
      }
    } else {
      rows.tombDrop(d.db, kind, uid);
      rows.outboxDrop(d.db, kind, uid);
    }
    rows.setSeen(d.db, kind, uid, rev);
    rows.dropHold(d.db, uid);
    return applied;
  }

  function ingestAlive(item: SyncItem, rev: number, blob: string, now: number, degrade: boolean): boolean {
    const { kind, uid } = item;
    const tomb = rows.tombOf(d.db, kind, uid);
    if (tomb !== undefined) {
      if ((item.c.created_at ?? 0) > tomb) rows.tombDrop(d.db, kind, uid);
      else {
        // 이 기기에서 영구 삭제했다: 되살리지 않는다. 표식을 새 번호 위에 다시 올린다
        rows.setSeen(d.db, kind, uid, rev);
        rows.outboxAdd(d.db, kind, uid);
        rows.dropHold(d.db, uid);
        return false;
      }
    }
    const local = rows.readItem(d.db, kind, uid, dev());
    const seen = rows.getSeen(d.db, uid);
    const m = mergeItems(local, item, seen ? { hash: seen.hash, body: seen.body } : undefined);
    let applied = false;
    if (!local || !sameContent(m.item, local)) {
      const res = rows.applyItem(d.db, m.item, { now, degrade });
      if (res === 'parent') {
        rows.addHold(d.db, uid, kind, rev, 'parent', blob, now);
        return false;
      }
      if (res === 'orphan') {
        // 부모 할 일이 영구 삭제된 뒤 올라온 단계: 서버에서도 지우도록 삭제 표식을 남긴다
        rows.dropHold(d.db, uid);
        rows.setSeen(d.db, kind, uid, rev);
        rows.tombAdd(d.db, kind, uid, now);
        return false;
      }
      applied = true;
    }
    rows.dropHold(d.db, uid);
    const body = typeof item.f.body === 'string' ? item.f.body : undefined;
    rows.setSeen(d.db, kind, uid, rev, body, body === undefined ? undefined : bodyHash(body));
    if (item.copyOf) rows.noteCopy(d.db, uid, item.copyOf, now);
    if (m.ahead) rows.outboxAdd(d.db, kind, uid);
    else rows.outboxDrop(d.db, kind, uid);
    if (m.copy) {
      const loserName = m.copy.fromLocal ? dev().name : item.name;
      const loserTitle = String((m.copy.fromLocal ? local?.f.title : item.f.title) ?? '');
      const copy = conflictCopy(
        m.item,
        m.copy,
        tr('sync.conflictCopy', { title: loserTitle, device: loserName, date: conflictDate(m.copy.t) }),
        dev(),
      );
      const exist = rows.readItem(d.db, 'note', copy.uid, dev());
      const mc = mergeItems(exist, copy, undefined);
      if (!exist || !sameContent(mc.item, exist)) rows.applyItem(d.db, mc.item, { now });
      rows.noteCopy(d.db, copy.uid, uid, now);
      rows.outboxAdd(d.db, 'note', copy.uid);
      applied = true;
    }
    return applied;
  }

  /** 받은 변경 여러 개를 한 묶음(transaction)에 적용한다 */
  function applyBatch(list: readonly SyncChange[], degrade = false): number {
    let n = 0;
    d.db.exec('begin immediate');
    try {
      for (const ch of list) if (ingestChange(ch, degrade)) n++;
      d.db.exec('commit');
    } catch (err) {
      d.db.exec('rollback');
      throw err;
    }
    return n;
  }

  /**
   * 부모가 늦게 와서 보류한 항목을 다시 적용한다. last 면 DEGRADE_MS 넘게 부모가 없는 할 일, 일정은 반복 연결을 끊고 적용한다
   * (부모가 영영 안 오는 항목이 계속 막히지 않게). 단계는 부모 없이는 쓸 수 없어 계속 보류한다
   */
  function retryHolds(last: boolean): number {
    const retriable = () => rows.holds(d.db).filter((h) => h.reason === 'parent' || h.reason === 'apply');
    const asChange = (h: rows.Hold) => ({ uid: h.uid, rev: h.rev, blob: h.blob, deleted: false });
    if (retriable().length === 0) return 0;
    let n = applyBatch(retriable().map(asChange));
    if (last) {
      const old = retriable().filter(
        (h) => (h.kind === 'todo' || h.kind === 'event') && d.now() - h.at >= DEGRADE_MS,
      );
      if (old.length > 0) n += applyBatch(old.map(asChange), true);
    }
    return n;
  }

  // ---- 한 차례 ----

  /** 받기. 계속해도 되면 true */
  async function pull(): Promise<boolean> {
    let appliedAny = false;
    for (;;) {
      const r = await d.call((api, s) => api.syncChanges(s, st.cursor, PAGE, st.epoch));
      if (!r.ok) {
        failed(r);
        return false;
      }
      if (r.data.gen !== st.gen || r.data.epoch !== st.epoch) {
        pause(r.data.epoch !== st.epoch ? 'epoch' : 'gen');
        return false;
      }
      if (applyBatch(r.data.items) > 0) appliedAny = true;
      const lastRev = r.data.items.reduce((m, i) => Math.max(m, i.rev), st.cursor);
      st.cursor = r.data.more ? lastRev : Math.max(lastRev, r.data.head);
      save();
      if (!r.data.more) break;
    }
    if (retryHolds(true) > 0) appliedAny = true;
    if (appliedAny) d.onApplied?.();
    return true;
  }

  interface Built {
    kind: SyncKind;
    uid: string;
    push: SyncPushItem;
    /** 보낸 내용 (그사이 고쳤는지 보는 데 쓴다) */
    sent: SyncItem | { tomb: number };
    size: number;
  }

  /** 보낼 항목 하나를 잠가 만든다. 보낼 것이 없으면(행도 표식도 없음) 보낼 목록에서 뺀다 */
  function build(kind: SyncKind, uid: string, key: Buffer): Built | null {
    const item = rows.readItem(d.db, kind, uid, dev());
    const seen = rows.getSeen(d.db, uid);
    const base = seen?.rev ?? 0;
    if (item) {
      if (kind === 'note') item.bh = seen?.hash ?? null;
      const copyOf = kind === 'note' ? rows.copyOrigin(d.db, uid) : undefined;
      const blob = sealItem(key, ctx(), uid, kind, {
        f: item.f,
        c: item.c,
        dev: item.dev,
        name: item.name,
        ...(kind === 'note' ? { bh: item.bh ?? null } : {}),
        ...(copyOf ? { copyOf } : {}),
      });
      if (blob.length > BLOB_MAX) {
        rows.addHold(d.db, uid, kind, base, 'big', '', d.now());
        rows.outboxDrop(d.db, kind, uid);
        return null;
      }
      const b64 = blob.toString('base64');
      return { kind, uid, push: { uid, base, blob: b64, deleted: false }, sent: item, size: b64.length };
    }
    const t = rows.tombOf(d.db, kind, uid);
    if (t !== undefined && rows.rowId(d.db, kind, uid) === undefined) {
      const blob = sealItem(key, ctx(), uid, kind, { tomb: t, dev: st.dev, name: d.deviceName() }).toString(
        'base64',
      );
      return { kind, uid, push: { uid, base, blob, deleted: true }, sent: { tomb: t }, size: blob.length };
    }
    rows.outboxDrop(d.db, kind, uid);
    return null;
  }

  /** 보낸 항목이 받아들여졌다: 본 번호를 적고, 그사이 고치지 않았으면 보낼 목록에서 뺀다 */
  function sentOk(b: Built, rev: number): void {
    if ('tomb' in b.sent) {
      rows.setSeen(d.db, b.kind, b.uid, rev);
      if (rows.tombOf(d.db, b.kind, b.uid) === b.sent.tomb) {
        rows.tombDrop(d.db, b.kind, b.uid);
        rows.outboxDrop(d.db, b.kind, b.uid);
      }
      return;
    }
    const body = typeof b.sent.f.body === 'string' ? b.sent.f.body : undefined;
    rows.setSeen(d.db, b.kind, b.uid, rev, body, body === undefined ? undefined : bodyHash(body));
    const cur = rows.readItem(d.db, b.kind, b.uid, dev());
    if (!cur || sameContent(cur, b.sent)) rows.outboxDrop(d.db, b.kind, b.uid);
  }

  /** 보내기. 계속해도 되면 true */
  async function push(): Promise<boolean> {
    const key = loadKey();
    if (!key) return false;
    for (let round = 0; round < ROUNDS; round++) {
      // 부모가 먼저: 할 일, 메모, 반복 일정 원본 → 일정 회차 → 단계 (받는 쪽이 보류하지 않아도 되게)
      const origins = rows.eventOrigins(d.db);
      const rank = (x: { kind: SyncKind; uid: string }) =>
        KIND_ORDER[x.kind] + (x.kind === 'event' && origins.has(x.uid) ? -1 : 0);
      const list = rows.outboxList(d.db).sort((a, b) => rank(a) - rank(b) || (a.uid < b.uid ? -1 : 1));
      if (list.length === 0) return true;
      let conflicts = false;
      let batch: Built[] = [];
      let size = 0;
      const flush = async (): Promise<boolean> => {
        if (batch.length === 0) return true;
        const sending = batch;
        batch = [];
        size = 0;
        const r = await d.call((api, s) =>
          api.syncPush(
            s,
            st.epoch,
            sending.map((b) => b.push),
          ),
        );
        if (!r.ok) {
          failed(r);
          return false;
        }
        if (r.data.gen !== st.gen || r.data.epoch !== st.epoch) {
          pause(r.data.epoch !== st.epoch ? 'epoch' : 'gen');
          return false;
        }
        const by = new Map(sending.map((b) => [b.uid, b]));
        d.db.exec('begin immediate');
        try {
          for (const res of r.data.results) {
            const b = by.get(res.uid);
            if (!b) continue;
            if (res.ok) sentOk(b, res.rev);
            else {
              conflicts = true;
              ingestChange(
                {
                  uid: res.uid,
                  rev: res.conflict.rev,
                  blob: res.conflict.blob,
                  deleted: res.conflict.deleted,
                },
                false,
              );
            }
          }
          d.db.exec('commit');
        } catch (err) {
          d.db.exec('rollback');
          throw err;
        }
        d.onApplied?.();
        return true;
      };
      for (const { kind, uid } of list) {
        const b = build(kind, uid, key);
        if (!b) continue;
        if (batch.length >= BATCH_ITEMS || size + b.size > BATCH_BYTES) if (!(await flush())) return false;
        batch.push(b);
        size += b.size;
      }
      if (!(await flush())) return false;
      if (!conflicts) return true;
    }
    return true;
  }

  async function refreshUsage(force = false): Promise<void> {
    if (!force && d.now() - usageAt < USAGE_EVERY_MS) return;
    const r = await d.call((api, s) => api.syncStatus(s));
    if (!r.ok) return;
    usageAt = d.now();
    usage = {
      items: r.data.items,
      bytes: r.data.bytes,
      maxItems: r.data.maxItems,
      maxBytes: r.data.maxBytes,
    };
    soon = r.data.soon;
    if (r.data.items < r.data.maxItems && r.data.bytes < r.data.maxBytes && st.full) {
      st.full = false;
      save();
    }
  }

  async function pass(): Promise<void> {
    if (!st.on || enabling) return;
    const acct = d.account();
    if (!acct) return;
    if (st.account !== acct) {
      d.log('sync', '다른 계정으로 바뀌어 지움');
      forgetLocal();
      problem = 'account';
      emit();
      return;
    }
    if (st.paused || !loadKey()) return;
    if (!d.secure()) {
      problem = 'secure';
      emit();
      return;
    }
    running = true;
    emit();
    try {
      problem = null;
      offline = false;
      if (!(await pull())) return;
      if (!(await push())) return;
      st.lastAt = d.now();
      fails = 0;
      nextTry = 0;
      save();
      await refreshUsage(st.full);
    } catch (err) {
      d.log('sync', '맞추기 오류', err instanceof Error ? err.message : String(err));
      backoff();
    } finally {
      running = false;
      emit();
    }
  }

  const exclusive = <T>(fn: () => Promise<T>): Promise<T> => {
    const p = chain.then(fn, fn);
    chain = p.catch(() => undefined);
    return p;
  };

  /** 한 차례 맞춘다. 돌고 있으면 끝난 뒤 한 번 더 */
  function run(force = false): Promise<void> {
    if (!st.on) return Promise.resolve();
    if (!force && d.now() < nextTry) return Promise.resolve();
    if (queued) {
      again = true;
      return queued;
    }
    const p = exclusive(pass).finally(() => {
      queued = null;
      if (again) {
        again = false;
        void run();
      }
    });
    queued = p;
    return p;
  }

  // ---- 켜기 ----

  /** 켜고 나서 처음 맞출 때: 이 기기의 모든 항목을 올리고 (합집합) 본 번호를 버린다 */
  function startFresh(): void {
    st.cursor = 0;
    st.paused = null;
    st.full = false;
    problem = null;
    rows.resetSeen(d.db);
    rows.enqueueAll(d.db);
    save();
    emit();
    kick();
  }

  async function enable(): Promise<EnableResult> {
    return exclusive(async () => {
      if (!d.secure()) return { ok: false as const, error: 'secure' };
      const acct = d.account();
      if (!acct) return { ok: false as const, error: 'login' };
      if (st.on && st.account === acct && !st.paused && loadKey())
        return { ok: true as const, kind: 'on' as const };
      enabling = true;
      problem = null;
      emit();
      try {
        const g = await d.call((api, s) => api.syncKeyGet(s));
        if (g.ok) return pendCode(acct);
        if (g.status !== 404) return { ok: false as const, error: g.error };
        // 서버에 열쇠가 없다: 이 기기가 첫 기기. 만들고, 올린 뒤에만 저장한다
        const key = newDataKey(random);
        const code = newRecoveryCode(random);
        const w = await wrapDataKey(key, code, acct, 1, params);
        let epoch = 0;
        let put = await d.call((api, s) => api.syncKeyPut(s, { epoch, ...w }));
        if (!put.ok && put.status === 409 && put.error === 'epoch') {
          epoch = Number(put.body.epoch) || 0;
          put = await d.call((api, s) => api.syncKeyPut(s, { epoch, ...w }));
        }
        if (!put.ok) {
          // 다른 기기가 먼저 켰다: 만든 열쇠를 버리고 복구 코드 넣기로
          if (put.status === 409 && put.error === 'key_exists') return pendCode(acct);
          return { ok: false as const, error: put.error };
        }
        try {
          storeKey(key);
        } catch {
          return { ok: false as const, error: 'secure' };
        }
        st = {
          ...st,
          on: true,
          account: acct,
          epoch: put.data.epoch,
          gen: put.data.gen,
          keyRev: put.data.keyRev,
        };
        startFresh();
        return { ok: true as const, kind: 'created' as const, code };
      } finally {
        enabling = false;
        emit();
      }
    });
  }

  /** 서버에 열쇠가 있다: 복구 코드를 받는 상태로 (이 기기의 열쇠는 아직 없다) */
  function pendCode(acct: string): EnableResult {
    st = { ...st, on: true, account: acct, paused: 'code', cursor: 0 };
    save();
    return { ok: true, kind: 'needCode' };
  }

  /** 복구 코드로 서버의 감싼 열쇠를 푼다 (다른 기기, 열쇠를 잃었을 때, 서버 사본이 다시 시작됐을 때) */
  async function enterCode(code: string): Promise<CodeResult> {
    return exclusive(async () => {
      const acct = d.account();
      if (!acct) return { ok: false as const, error: 'login' };
      if (!d.secure()) return { ok: false as const, error: 'secure' };
      const g = await d.call((api, s) => api.syncKeyGet(s));
      if (!g.ok) return { ok: false as const, error: g.status === 404 ? 'none' : g.error };
      let key: Buffer | null;
      try {
        key = await unwrapDataKey(g.data, code, acct, g.data.gen);
      } catch {
        return { ok: false as const, error: 'params' };
      }
      if (!key) return { ok: false as const, error: 'code' };
      try {
        storeKey(key);
      } catch {
        return { ok: false as const, error: 'secure' };
      }
      st = { ...st, on: true, account: acct, epoch: g.data.epoch, gen: g.data.gen, keyRev: g.data.keyRev };
      startFresh();
      return { ok: true as const };
    });
  }

  /** 복구 코드 새로 만들기 (코드를 잃었을 때): 같은 데이터 열쇠를 새 코드로 다시 감싼다 */
  async function newCode(): Promise<NewCodeResult> {
    return exclusive(async () => {
      const key = loadKey();
      const acct = d.account();
      if (!st.on || !key || !acct || st.paused) return { ok: false as const, error: 'off' };
      for (let attempt = 0; attempt < 2; attempt++) {
        const g = await d.call((api, s) => api.syncKeyGet(s));
        if (!g.ok) return { ok: false as const, error: g.error };
        if (g.data.gen !== st.gen) {
          pause('gen');
          return { ok: false as const, error: 'gen' };
        }
        const code = newRecoveryCode(random);
        const w = await wrapDataKey(key, code, acct, g.data.gen, params);
        const put = await d.call((api, s) =>
          api.syncKeyPut(s, { epoch: g.data.epoch, ...w, gen: g.data.gen, keyRev: g.data.keyRev }),
        );
        if (put.ok) {
          st.keyRev = put.data.keyRev;
          save();
          return { ok: true as const, code };
        }
        if (put.status === 409 && put.error === 'key_rev') continue;
        if (put.status === 409 && put.error === 'epoch') {
          pause('epoch');
          return { ok: false as const, error: 'epoch' };
        }
        return { ok: false as const, error: put.error };
      }
      return { ok: false as const, error: 'key_rev' };
    });
  }

  /** 열쇠 바꾸기 (코드가 샜을 때): 새 데이터 열쇠와 새 코드, 세대 +1. 서버는 항목을 모두 지우고 이 기기가 다시 올린다 */
  async function rotateKey(): Promise<NewCodeResult> {
    return exclusive(async () => {
      const old = loadKey();
      const acct = d.account();
      if (!st.on || !old || !acct || st.paused) return { ok: false as const, error: 'off' };
      if (!d.secure()) return { ok: false as const, error: 'secure' };
      for (let attempt = 0; attempt < 2; attempt++) {
        const g = await d.call((api, s) => api.syncKeyGet(s));
        if (!g.ok) return { ok: false as const, error: g.error };
        if (g.data.gen !== st.gen) {
          pause('gen');
          return { ok: false as const, error: 'gen' };
        }
        const key = newDataKey(random);
        const code = newRecoveryCode(random);
        const gen = g.data.gen + 1;
        const w = await wrapDataKey(key, code, acct, gen, params);
        const put = await d.call((api, s) =>
          api.syncKeyPut(s, { epoch: g.data.epoch, ...w, gen, keyRev: g.data.keyRev }),
        );
        if (put.ok) {
          try {
            storeKey(key);
          } catch {
            return { ok: false as const, error: 'secure' };
          }
          st = { ...st, epoch: put.data.epoch, gen: put.data.gen, keyRev: put.data.keyRev };
          startFresh();
          return { ok: true as const, code };
        }
        if (put.status === 409 && put.error === 'key_rev') continue;
        if (put.status === 409 && put.error === 'epoch') {
          pause('epoch');
          return { ok: false as const, error: 'epoch' };
        }
        return { ok: false as const, error: put.error };
      }
      return { ok: false as const, error: 'key_rev' };
    });
  }

  /** 끄기: 이 컴퓨터만, 또는 서버 사본과 열쇠도 지운다 (되돌릴 수 없다) */
  async function disable(wipeServer: boolean): Promise<{ ok: boolean; error?: string }> {
    return exclusive(async () => {
      if (wipeServer) {
        const r = await d.call((api, s) => api.syncRemove(s));
        if (!r.ok) return { ok: false, error: r.error };
      }
      forgetLocal();
      return { ok: true };
    });
  }

  /** 로그아웃, 탈퇴, 서버 계정이 없어짐: 열쇠와 커서를 지우고 끈다 (같은 컴퓨터의 다른 사람 로그인에 앞사람 메모가 올라가지 않게) */
  function onAccountEnd(why: string): void {
    if (!st.on && !loadKey()) return;
    d.log('sync', '계정이 끝나 지움', why);
    forgetLocal();
  }

  /** 백업을 되살렸다: 기기 번호를 새로 만들고 커서를 0 으로, 되살린 항목은 다시 올린다 */
  function afterRestore(): void {
    rows.ensureTables(d.db);
    if (!st.on) return;
    st.dev = Buffer.from(random(8)).toString('hex');
    startFresh();
  }

  // ---- 언제 도나 ----

  function kick(): void {
    if (d.timers === false || !st.on) return;
    clearTimeout(debounce);
    debounce = setTimeout(() => void run(), DEBOUNCE_MS);
    debounce.unref?.();
  }

  /** 앱이 앞에 오거나 잠에서 깼다 */
  function wake(): void {
    nextTry = 0;
    fails = 0;
    if (st.on) void run();
  }

  const WRITE =
    /\b(?:insert|update|delete|replace)\b[\s\S]*\b(?:todo|todo_step|note|event|reminder|event_repeat_\w+)\b/i;

  /** 이 앱이 저장 파일에 쓴 문장 (보낼 것이 생겼을 수 있다) */
  function notifyWrite(sql: string): void {
    if (st.on && !running && WRITE.test(sql)) kick();
  }

  /** 다른 프로세스(MCP)가 썼는지 data_version 으로 본다 */
  function pollVersion(v: number): void {
    if (v < 0) return;
    if (lastVersion >= 0 && v !== lastVersion && st.on && !running) kick();
    lastVersion = v;
  }

  let every: ReturnType<typeof setInterval> | undefined;
  if (d.timers !== false) {
    every = setInterval(() => {
      if (st.on) void run();
    }, MIN_MS);
    every.unref?.();
  }

  return {
    view,
    run,
    enable,
    enterCode,
    newCode,
    rotateKey,
    disable,
    onAccountEnd,
    afterRestore,
    kick,
    wake,
    notifyWrite,
    pollVersion,
    refreshUsage,
    /** 켜져 있다 (상태 파일 기준) */
    isOn: () => st.on,
    dispose() {
      clearTimeout(debounce);
      clearTimeout(retry);
      clearInterval(every);
    },
    /** 시험용 */
    state: () => st,
    holds: () => rows.holds(d.db),
  };
}

export type SyncEngine = ReturnType<typeof createSyncEngine>;
