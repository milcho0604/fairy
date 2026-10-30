// 페어리 서버 계정의 앱 쪽 흐름 (기획서 5, 6, 7, 21절, 이슈 #99). Electron 없이 돌아 시험에서 그대로 부른다.
// main/server.ts 가 설정 창 IPC, 토큰 파일(safeStorage), 브라우저 열기, 타이머를 붙인다.
//
// - 서버 주소가 없거나 만 14세 미만(앱 안 모드)이거나 서버 모드를 끈 동안은 어떤 요청도 보내지 않는다 (allowed).
//   하나 예외는 사용자가 누른 탈퇴다 (만 14세 미만으로 바꾼 뒤 남은 계정을 지울 수 있게).
// - 처음: 기기 계정(/v1/device) → 기존 잔액과 산 물건 옮기기(/v1/migrate, 한 번) → 코인 맞추기(/v1/sync).
//   옮기기가 끝나기 전에는 맞추기를 보내지 않는다.
// - 서버가 꺼져 있어도 앱은 사본 잔액(앱 장부)으로 돈다. 대기열은 파일에 남아 살아나면 보낸다.
import { createHash, randomBytes } from 'node:crypto';
import { checkNickname, DEVICE_CODE } from '../shared/account-profile.ts';
import { type TicketBlock, ticketBlock } from '../shared/ai/ticket-gate.ts';
import {
  type AccountSummary,
  type AdminLogFilter,
  type AgeAnswer,
  ageClass,
  isAgeAnswer,
  isLoginService,
  type LoginProviders,
  type LoginService,
  type NicknameProblem,
  type RewardOutcome,
  type ServerBackupResult,
  type ServerProblem,
  type ServerStatus,
} from '../shared/server-account.ts';
import type { GateNeed } from '../shared/update-levels.ts';
import type {
  AiChatBody,
  AiChatOutcome,
  ApiResult,
  BackupList,
  CalendarLinkInfo,
  ServerApi,
} from './server-api.ts';
import { BACKUP_MAX_BYTES, mergeNeeded, SYNC_BATCH, summary } from './server-api.ts';
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
  /** AI 대화권 남은 수의 사본 (#100). 모르면 null */
  tickets: number | null;
  /** 대화권 국외 이전 안내를 읽고 쓰기로 했다 (이 컴퓨터에서 한 번) */
  aiAgreed: boolean;
  /** 닉네임 (#101). 서버 모드를 처음 켤 때 정한다 */
  nickname: string | null;
  /** 바꾼 닉네임을 아직 서버에 못 알렸다 (다음 맞추기 때 다시) */
  nicknamePending: boolean;
  /** 서버가 준 기기 코드의 사본 */
  code: string | null;
  /** 운영자 계정인지 (서버 /v1/me 가 정한다. 세션일 때만 true) */
  admin: boolean;
  /** 아직 열지 않은 서버 쪽지 수 */
  inbox: number;
  /** 채팅 이용권 접근 (운영자 스위치). 모르면 null */
  aiAccess: AiAccess | null;
  /** 운영자가 건 정기 지급 */
  subscription: { monthly: number; nextFill: string | null } | null;
  /** 이 계정에 이은 로그인 서비스 (세션을 받을 때 서버가 알려 준 것, #102) */
  logins: LoginService[];
  /** 서버 백업의 민감정보 안내에 따로 동의했다 (이 컴퓨터에서, #102) */
  backupAgreed: boolean;
  /**
   * 이 기기의 구글 일정 연결 표시를 서버가 받은 값 (#115). 모르면(아직 안 보냄, 새 기기 계정) null.
   * 토큰은 보내지 않는다: 연결했나 참거짓만
   */
  calendarSent: boolean | null;
  /** 다른 기기의 구글 일정 연결 안내를 이 기기에서 거절했다 (다시 묻지 않는다, 기기 단위) */
  calendarHintNo: boolean;
}

/** 채팅 이용권 접근: 됨, 전체 꺼짐, 허용 목록에 없음, 이 계정만 막힘 */
export type AiAccess = 'ok' | 'off' | 'not_allowed' | 'blocked' | 'waitlisted';
const AI_ACCESS: readonly AiAccess[] = ['ok', 'off', 'not_allowed', 'blocked', 'waitlisted'];

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
    tickets: null,
    aiAgreed: false,
    nickname: null,
    nicknamePending: false,
    code: null,
    admin: false,
    inbox: 0,
    aiAccess: null,
    subscription: null,
    logins: [],
    backupAgreed: false,
    calendarSent: null,
    calendarHintNo: false,
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
  if (isCount(raw.tickets)) s.tickets = raw.tickets;
  s.aiAgreed = raw.aiAgreed === true;
  const nick = checkNickname(raw.nickname);
  if (nick.ok) s.nickname = nick.value;
  s.nicknamePending = raw.nicknamePending === true && s.nickname !== null;
  if (typeof raw.code === 'string' && DEVICE_CODE.test(raw.code)) s.code = raw.code;
  s.admin = raw.admin === true;
  if (isCount(raw.inbox)) s.inbox = raw.inbox;
  if (AI_ACCESS.includes(raw.aiAccess as AiAccess)) s.aiAccess = raw.aiAccess as AiAccess;
  const sub = raw.subscription;
  if (isObj(sub) && isCount(sub.monthly))
    s.subscription = {
      monthly: sub.monthly,
      nextFill: typeof sub.nextFill === 'string' ? sub.nextFill : null,
    };
  if (Array.isArray(raw.logins)) s.logins = [...new Set(raw.logins.filter(isLoginService))];
  s.backupAgreed = raw.backupAgreed === true;
  if (typeof raw.calendarSent === 'boolean') s.calendarSent = raw.calendarSent;
  s.calendarHintNo = raw.calendarHintNo === true;
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
  /** 서버 기록에 맞추느라 코인이 줄었다 (운영자 회수 등. 줄어든 양. 늘 때는 부르지 않는다) */
  onCoinsLowered?: (lowered: number) => void;
  /** 열지 않은 서버 쪽지가 있다 (#101, 메인이 쪽지함을 받아 펫이 건넨다) */
  onInbox?: (unopened: number) => void;
  /**
   * 서버가 정한 강제 최소 판 (이슈 #120). 서버가 답했으면 그 값(없으면 null), 서버를 쓰지 않거나 닿지 않으면 undefined
   * (그때는 홈페이지 notices.json 의 값을 쓴다). 업데이트 확인(main/update.ts)에 넘긴다
   */
  onServerMin?: (min: string | null | undefined) => void;
  random?: (n: number) => Uint8Array;
  /**
   * 서버 백업 (#102): 개인 백업 파일(.fairybackup)을 만들고, 받은 파일로 되살리기 확인 칸을 연다 (backup.ts).
   * 없으면 서버 백업 단추가 failed 를 돌려준다
   */
  backupFile?: {
    make(): Promise<Uint8Array>;
    open(bytes: Uint8Array): Promise<{ ok: boolean; message: string }>;
  };
  /**
   * 이 기기가 구글 일정을 연결했나 (#115, main/gcal.ts). 없으면 연결 표시를 올리지도 안내하지도 않는다.
   * 연결이 바뀌면 메인이 calendarChanged() 를 부른다
   */
  calendarLinked?: () => boolean;
}

const b64url = (b: Uint8Array) => Buffer.from(b).toString('base64url');
/**
 * 로그인 서비스와 기능 키를 다시 묻는 가장 짧은 간격. 맞추기마다(몇 분), "지금 맞추기", 설정 창을 열 때 묻는다:
 * 운영자가 바꾼 스위치가 다음 맞추기에 보이게 (QA #112). 설정 창 칸 여럿이 한꺼번에 열어도 한 번만
 */
export const PROVIDERS_EVERY_MS = 5_000;

export function createServerCore(d: ServerCoreDeps) {
  const random = d.random ?? ((n: number) => randomBytes(n));
  let st = parseState(d.load());
  let problem: ServerProblem | null = null;
  let syncing = false;
  let running: Promise<void> | null = null;
  let next: Promise<void> | null = null;
  let login: { cancel: () => void } | null = null;
  let merge: { code: string; verifier: string; current: AccountSummary; other: AccountSummary } | null = null;
  /** 서버가 알려 준 로그인 서비스 (#102). 모르면 null */
  let providers: LoginProviders | null = null;
  let providersAt = 0;
  /** 서버가 알려 준 기능 키 (#102). 모르면 null: 앱은 꺼진 것으로 본다 (featureOn) */
  let features: Record<string, boolean> | null = null;
  /** 서버 백업 목록 (로그인한 동안만). 모르면 null */
  let backups: BackupList | null = null;
  let backupOff = false;
  let backupBusy: 'up' | 'down' | null = null;
  /** 서버가 알려 준 이 계정의 구글 일정 연결 표시 (#115, 이 기기 몫 포함). 모르거나 기능 키가 꺼져 있으면 null */
  let calendar: CalendarLinkInfo | null = null;
  /** 서버가 426 으로 막은 단계 (이슈 #120). 통과한 호출이 오면 푼다. 없으면 null */
  let gate: GateNeed | null = null;

  const enabled = () => d.api !== undefined;
  /** 서버 모드를 켰다 (나이 답과 켬. 열쇠 문제는 blocked) */
  const wanted = () => enabled() && ageClass(st.age) !== undefined && st.on;
  /** 서버 모드인데 토큰을 다룰 수 없다: 열쇠를 못 씀(평문 저장 금지), 토큰 파일을 못 풂(덮어쓰지 않음) */
  const blocked = (): ServerProblem | null =>
    !d.secure() ? 'noSecure' : d.device.unreadable() ? 'keyLost' : null;
  /** 서버로 무엇이든 보내도 되는가 (탈퇴, 로그아웃 말고). 요청마다 다시 본다 */
  const allowed = () => wanted() && blocked() === null;
  /** 채팅 이용권을 물어볼 수 있는가 (#100): 서버 모드, 만 18세 이상, 구글 로그인(세션) */
  const aiEligible = () => allowed() && st.age === 'adult' && !!d.session.get();
  /** 채팅 이용권을 쓸 수 있는가: 위에 더해 운영자가 열어 두었다 (#101, 모르면 아직 아님) */
  const aiAvailable = () => aiEligible() && st.aiAccess === 'ok';
  /** 채팅 이용권을 못 쓰는 까닭 (AI 고르기에 보인다). 쓸 수 있으면 undefined (shared/ai/ticket-gate.ts) */
  const aiBlock = (): TicketBlock | undefined =>
    ticketBlock({
      enabled: enabled(),
      age: st.age,
      serverReady: allowed(),
      signedIn: !!d.session.get(),
      access: st.aiAccess,
      tickets: st.tickets,
    });
  /** 운영자 계정인가 (#101): 세션이 있고 서버가 운영자라고 했다 */
  const isAdmin = () => allowed() && !!d.session.get() && st.admin;

  /**
   * 다른 기기에서 구글 일정을 연결했는데 이 기기는 아직인가 (#115). 서버 수에서 이 기기 몫(올린 값이 참이면 1)을 뺀다.
   * 로그인(세션), 서버 모드, 기능 키, 이 기기에서 거절하지 않음이 모두 맞을 때만
   */
  const calendarHint = (): boolean =>
    allowed() &&
    !!d.session.get() &&
    !!d.calendarLinked &&
    features?.calendar_link_hint === true &&
    !st.calendarHintNo &&
    !d.calendarLinked() &&
    !!calendar &&
    calendar.devices - (st.calendarSent === true ? 1 : 0) > 0;

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
      ai: aiAvailable(),
      tickets: aiAvailable() ? st.tickets : null,
      subscription: aiAvailable() ? st.subscription : null,
      aiWaitlisted: aiEligible() && st.aiAccess === 'waitlisted',
      nickname: st.nickname,
      code: wanted() ? st.code : null,
      inbox: wanted() ? st.inbox : 0,
      admin: isAdmin(),
      providers,
      features: allowed() ? features : null,
      logins: d.session.get() ? st.logins : [],
      backup:
        allowed() && d.session.get()
          ? {
              off: backupOff,
              agreed: st.backupAgreed,
              list: backups?.backups ?? null,
              keep: backups?.keep ?? 2,
              maxBytes: backups?.maxBytes ?? BACKUP_MAX_BYTES,
              busy: backupBusy,
            }
          : null,
      calendarHint: calendarHint(),
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

  /** 426 (업데이트 단계, 이슈 #120) 은 'update': 서버 기능을 멈추고 업데이트 안내를 띄운다 (대기열은 그대로 둔다) */
  const failProblem = (r: { status: number }): ServerProblem =>
    r.status === 426 ? 'update' : r.status === 0 ? 'offline' : 'server';

  /**
   * 관문 결과 (server-api.ts onGate). 426 이면 단계와 필요한 판을 기억하고 안내를 띄운다, 통과한 호출이면 푼다.
   * 강제 단계면 서버가 말한 최소 판을 업데이트 확인에 넘겨 잠금 창도 같이 띄운다 (main/update.ts setServerMin)
   */
  function gateSeen(g: GateNeed | null) {
    if (JSON.stringify(g) === JSON.stringify(gate)) return;
    gate = g;
    if (g) {
      problem = 'update';
      if (g.level === 'force') d.onServerMin?.(g.need);
      d.log('server', '업데이트 단계', g.level, g.need);
    } else if (problem === 'update') problem = null;
    changed();
  }

  /** 서버 계정이 없어졌다 (기기 토큰을 서버가 모른다): 서버 모드를 끄고 처음으로 */
  function forgetAccount() {
    d.device.set(null);
    d.session.set(null);
    login?.cancel();
    login = null;
    merge = null;
    backups = null;
    features = null;
    st = {
      ...st,
      on: false,
      migrated: false,
      migrate: null,
      copy: null,
      lastSyncAt: null,
      tickets: null,
      code: null,
      admin: false,
      inbox: 0,
      aiAccess: null,
      subscription: null,
      nicknamePending: false,
      logins: [],
      // 서버 백업 동의는 그 계정에 준 것이다: 탈퇴하면 거둔다
      backupAgreed: false,
      // 기기 계정이 없어졌다: 연결 표시는 새 기기 계정에 다시 올린다 (거절은 기기 단위라 그대로)
      calendarSent: null,
    };
    calendar = null;
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
      backups = null;
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
    const r = await d.api.device(age, st.nickname);
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
    st = {
      ...st,
      migrated: false,
      migrate: null,
      copy: null,
      lastSyncAt: null,
      agePending: false,
      nicknamePending: false,
      code: null,
      admin: false,
      inbox: 0,
      calendarSent: null,
    };
    calendar = null;
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

  /** 바꾼 닉네임을 서버에 알린다 (실패하면 다음 맞추기 때 다시) */
  async function ensureNickname(): Promise<void> {
    const t = token();
    if (!st.nicknamePending || !st.nickname || !d.api || !t || !allowed()) return;
    const r = await d.api.setNickname(t, st.nickname);
    if (r.ok || r.status === 400) {
      // 400 이면 서버 규칙에 안 맞는 옛 값이다: 다시 보내지 않는다
      st.nicknamePending = false;
      save();
    } else d.log('server', '닉네임 못 알림', r.status, r.error);
  }

  /**
   * 내 계정을 서버에 묻는다: 운영자인지(세션만 true, 기기 토큰은 언제나 아니다), 업데이트 기준(이슈 #120).
   * 관문을 건너는 호출이라 맞추기의 맨 앞에서 부른다. 기기 토큰으로도 된다 (없으면 건너뛴다)
   */
  async function refreshMe(): Promise<void> {
    const t = token();
    if (!d.api || !t || !allowed()) {
      if (st.admin) {
        st.admin = false;
        save();
      }
      return;
    }
    const r = await d.api.me(t);
    if (r.ok) {
      d.onServerMin?.(r.data.update.min ?? null);
      const was = st.admin;
      st.admin = r.data.admin;
      st.code = r.data.profile.code;
      calendar = r.data.calendar;
      if (!st.nicknamePending) st.nickname = r.data.profile.nickname ?? st.nickname;
      save();
      if (was !== st.admin) d.log('server', '운영자', st.admin);
    } else if (r.status === 401) onUnauthorized();
    else if (r.status === 0) d.onServerMin?.(undefined);
  }

  /**
   * 이 기기의 구글 일정 연결 표시를 서버에 올린다 (#115). 기기 토큰으로 (서버가 기기마다 센다).
   * - 켜기: 로그인(세션)했고 기능 키가 켜졌을 때만
   * - 끄기: 올린 참이 있으면 기기 토큰만으로 (로그아웃, 세션 만료 뒤에 끊어도, 기능 키가 꺼져도 표시가 남지 않게.
   *   QA #122: 남은 참 때문에 다른 기기에 안내가 계속 떴다). 처음 값(null)을 거짓으로 맞추는 것은 로그인했을 때만
   * 보낼 것이 있었으면 true
   */
  async function calendarStep(): Promise<boolean> {
    const dev = d.device.get();
    if (!d.api || !dev || !allowed() || !d.calendarLinked) return false;
    const here = d.calendarLinked();
    const signed = !!d.session.get();
    const on = features?.calendar_link_hint === true;
    const send = here
      ? signed && on && st.calendarSent !== true
      : st.calendarSent === true || (signed && on && st.calendarSent === null);
    if (!send) return false;
    const r = await d.api.setCalendarLinked(dev, here);
    if (r.ok) {
      st.calendarSent = here;
      calendar = r.data.calendar;
      save();
      d.log('server', '구글 일정 연결 표시 올림', here);
      return true;
    }
    if (r.status === 401) onUnauthorized();
    else d.log('server', '구글 일정 연결 표시 못 올림', r.status, r.error);
    return false;
  }

  /** 도는 연결 표시 올리기 (한 번에 하나), 그사이 다시 보라는 요청이 왔다 */
  let calendarRun: Promise<void> | null = null;
  let calendarDirty = false;

  /**
   * 연결 표시 올리기를 한 줄로 세운다: 연결과 끊기를 빠르게 되풀이해도 한 번에 하나만 보내고, 보내는 사이 값이 바뀌었으면
   * 끝난 뒤 지금 값으로 다시 본다 (늦게 도착한 옛 값이 마지막이 되지 않게)
   */
  function ensureCalendar(): Promise<void> {
    calendarDirty = true;
    if (calendarRun) return calendarRun;
    calendarRun = (async () => {
      try {
        for (let i = 0; calendarDirty && i < 10; i++) {
          calendarDirty = false;
          // 보냈으면 그사이 바뀌었을 수 있다: 한 번 더 본다 (같으면 보내지 않고 끝난다)
          if (await calendarStep()) calendarDirty = true;
        }
      } finally {
        calendarRun = null;
      }
    })();
    return calendarRun;
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
    if (r.delta < 0) d.onCoinsLowered?.(-r.delta);
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
      if (r.data.profile) {
        st.code = r.data.profile.code;
        if (!st.nicknamePending && r.data.profile.nickname) st.nickname = r.data.profile.nickname;
      }
      st.inbox = r.data.inbox;
      apply({ balance: r.data.balance, items: r.data.items }, rejected);
      if (st.inbox > 0) d.onInbox?.(st.inbox);
      if (st.coins.queue.length === 0 || batch.length < SYNC_BATCH) return;
    }
  }

  // ---- AI 대화권 (#100) ----

  function setTickets(n: number | null) {
    if (st.tickets === n) return;
    st.tickets = n;
    save();
  }

  function setAccess(a: AiAccess | null) {
    if (st.aiAccess === a) return;
    st.aiAccess = a;
    if (a !== 'ok') st.subscription = null;
    save();
  }

  /**
   * 남은 채팅 이용권을 받는다 (처음이면 서버가 첫 로그인 선물 10장을 준다). 운영자 스위치도 여기서 안다:
   * 꺼짐(503 ai_off), 허용 목록에 없음(403 not_allowed), 막힘(403 blocked)이면 채팅 이용권 칸을 숨긴다
   */
  async function refreshTickets(): Promise<void> {
    const s = d.session.get();
    if (!d.api || !s || !aiEligible()) return;
    const r = await d.api.aiStatus(s);
    if (r.ok) {
      setAccess('ok');
      setTickets(r.data.tickets);
      const sub = r.data.subscription
        ? { monthly: r.data.subscription.monthly, nextFill: r.data.subscription.nextFill }
        : null;
      if (JSON.stringify(sub) !== JSON.stringify(st.subscription)) {
        st.subscription = sub;
        save();
      }
    } else if (r.status === 401) onUnauthorized();
    else if (r.error === 'ai_off') setAccess('off');
    else if (r.error === 'not_allowed') setAccess('not_allowed');
    else if (r.error === 'blocked') setAccess('blocked');
    else if (r.error === 'waitlisted') setAccess('waitlisted');
    else d.log('server', '채팅 이용권 수를 못 받음', r.status, r.error);
  }

  /** 대화권으로 질문 하나 (글은 기록에 남기지 않는다) */
  async function askAi(
    body: AiChatBody,
    onText: (text: string) => void,
    signal?: AbortSignal,
  ): Promise<AiChatOutcome> {
    const s = d.session.get();
    if (!d.api || !s || !aiAvailable()) return { ok: false, status: 403, error: 'login' };
    const r = await d.api.aiChat(s, body, onText, signal);
    if (r.ok) setTickets(r.tickets);
    else {
      if (r.tickets !== undefined) setTickets(r.tickets);
      else if (r.error === 'no_tickets') setTickets(0);
      if (r.status === 401) onUnauthorized();
      if (r.error === 'ai_off') setAccess('off');
      else if (r.error === 'not_allowed') setAccess('not_allowed');
      else if (r.error === 'blocked') setAccess('blocked');
      else if (r.error === 'waitlisted') setAccess('waitlisted');
      d.log('server', '대화권 질문 실패', r.status, r.error, r.refunded ? '되돌림' : '');
    }
    changed();
    return r;
  }

  /** 신고 (화면에서 따로 확인한 뒤) */
  async function reportAi(question: string, answer: string): Promise<boolean> {
    const s = d.session.get();
    if (!d.api || !s || !aiAvailable()) return false;
    const r = await d.api.aiReport(s, question, answer);
    if (!r.ok) d.log('server', '신고 실패', r.status, r.error);
    return r.ok;
  }

  /** 켤 때, 몇 분마다, 지금 맞추기: 기기 계정 → 옮기기 → 맞추기. 한 번에 하나만 */
  function run(): Promise<void> {
    if (!allowed()) {
      // 서버를 쓰지 않으면 강제 최소 판은 홈페이지 공지 파일의 것을 쓴다 (이슈 #120)
      d.onServerMin?.(undefined);
      changed();
      return Promise.resolve();
    }
    // 로그인 뒤 다시 맞추기가 줄을 서 있으면 그것까지 기다린다 (runAgain)
    if (running) return next ?? running;
    running = (async () => {
      syncing = true;
      changed();
      try {
        scan();
        // 업데이트 기준과 운영자인지 먼저 (이슈 #120: 서버 기준이 맞추기 전에 와야 강제 잠금이 맞는다).
        // 채팅 이용권 자리와 이번 달 정기 지급 쪽지도 맞추기 전에 (QA #113: 허용 직후 쪽지가 첫 맞추기 대답의 쪽지 수에 들게)
        await refreshMe();
        if (!(await ensureDevice())) return;
        if (!(await ensureMigrated())) return;
        await ensureAge();
        await ensureNickname();
        await refreshTickets();
        await syncAll();
        await refreshProviders();
        // 기능 키를 안 뒤에 (#115)
        await ensureCalendar();
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

  /**
   * 도는 중이면 끝난 뒤 한 번 더 (로그인, 합치기 직후의 맞추기가 이미 지나간 단계에 묻히지 않게). 줄은 하나만 세운다.
   * 로그인 서비스와 기능 키를 묻는 단계가 생겨 앞의 맞추기가 길어졌다 (#102)
   */
  function runAgain(): Promise<void> {
    if (!running) return run();
    next ??= running.then(() => {
      next = null;
      return run();
    });
    return next;
  }

  /** 새 장부 줄을 대기열로 (서버로 보내지는 않는다) */
  function scan() {
    if (!allowed() || !st.migrated) return;
    if (d.coins.scan(st.coins) > 0) save();
  }

  /** 지금 쓸 수 있는 로그인 서비스를 서버에 묻는다 (#102, 기능 키에 따라 카카오가 들고 난다) */
  async function refreshProviders(force = false): Promise<void> {
    const t = token();
    if (!d.api || !allowed()) return;
    // 바로 앞(5초 안)에 물었으면 건너뛴다. 로그인이 바뀐 뒤는 force
    if (!force && providers && d.now() - providersAt < PROVIDERS_EVERY_MS) return;
    const before = JSON.stringify([providers, features]);
    const r = await d.api.providers(t);
    if (r.ok) {
      providers = r.data;
      providersAt = d.now();
    } else d.log('server', '로그인 서비스 목록을 못 받음', r.status, r.error);
    const f = await d.api.features(t);
    if (f.ok) features = f.data;
    else d.log('server', '기능 키를 못 받음', f.status, f.error);
    // 바뀌었으면 설정 창에 바로 (맞추기 밖에서 불렸을 때: 설정 창을 열 때)
    if (JSON.stringify([providers, features]) !== before) changed();
  }

  // ---- 서버 백업 (#102, 기획서 7절) ----

  const backupError = (r: { status: number; error: string }): ServerBackupResult['error'] => {
    if (r.status === 0) return 'offline';
    // 426: 서버 관문이 낡은 앱이라고 막았다 (이슈 #120)
    if (r.status === 426) return 'update';
    if (r.status === 413 || r.error === 'too_big') return 'tooBig';
    if (r.status === 507) return 'full';
    if (r.status === 503 && r.error === 'backup_off') return 'off';
    if (r.status === 401 || r.status === 403) return 'login';
    return 'failed';
  };

  /** 서버 백업 목록을 받는다 (로그인했을 때만) */
  async function backupList(): Promise<void> {
    const s = d.session.get();
    if (!d.api || !s || !allowed()) return;
    const r = await d.api.backupList(s);
    if (r.ok) {
      backups = r.data;
      backupOff = false;
    } else if (r.status === 503 && r.error === 'backup_off') backupOff = true;
    else if (r.status === 401) onUnauthorized();
    else d.log('server', '서버 백업 목록을 못 받음', r.status, r.error);
    changed();
  }

  async function backupStep(
    kind: 'up' | 'down',
    fn: (session: string) => Promise<ServerBackupResult>,
  ): Promise<ServerBackupResult> {
    const s = d.session.get();
    if (!d.api || !s || !allowed()) return { ok: false, error: 'login', status: status() };
    if (backupBusy) return { ok: false, error: 'busy', status: status() };
    backupBusy = kind;
    changed();
    let out: ServerBackupResult;
    try {
      out = await fn(s);
    } catch (err) {
      d.log('server', '서버 백업 오류', err instanceof Error ? err.message : String(err));
      out = { ok: false, error: 'failed' };
    }
    // busy 를 푼 뒤의 상태를 돌려준다 (QA #112: 푸기 전 상태를 돌려줘 화면이 "받는 중"에 멈췄다)
    backupBusy = null;
    changed();
    return { ...out, status: status() };
  }

  /** 서버에 백업 올리기: 따로 동의한 뒤에만. 개인 백업 파일과 같은 것을 만든다 */
  function backupUpload(): Promise<ServerBackupResult> {
    if (!st.backupAgreed) return Promise.resolve({ ok: false, error: 'consent', status: status() });
    return backupStep('up', async (s) => {
      if (!d.api || !d.backupFile) return { ok: false, error: 'failed' };
      const bytes = await d.backupFile.make();
      if (bytes.length > (backups?.maxBytes ?? BACKUP_MAX_BYTES)) return { ok: false, error: 'tooBig' };
      const r = await d.api.backupUpload(s, bytes);
      if (!r.ok) {
        if (r.status === 503 && r.error === 'backup_off') backupOff = true;
        if (r.status === 401) onUnauthorized();
        d.log('server', '서버 백업 못 올림', r.status, r.error);
        return { ok: false, error: backupError(r) };
      }
      d.log('server', '서버 백업 올림', bytes.length);
      await backupList();
      return { ok: true };
    });
  }

  /** 서버 백업 받기: 받은 파일로 되살리기 확인 칸을 연다. 되살린 뒤 코인과 산 물건은 서버 정본을 따른다 (afterRestore) */
  function backupDownload(id: number): Promise<ServerBackupResult> {
    return backupStep('down', async (s) => {
      if (!d.api || !d.backupFile) return { ok: false, error: 'failed' };
      let item = backups?.backups.find((b) => b.id === id);
      if (!item) {
        await backupList();
        item = backups?.backups.find((b) => b.id === id);
      }
      if (!item) return { ok: false, error: 'failed' };
      const r = await d.api.backupDownload(s, item);
      if (!r.ok) {
        if (r.status === 401) onUnauthorized();
        d.log('server', '서버 백업 못 받음', r.status, r.error);
        return { ok: false, error: backupError(r) };
      }
      const opened = await d.backupFile.open(r.data);
      // 받으면 서버가 마지막 쓴 때를 고친다 (곧 지워짐이 풀린다)
      await backupList();
      if (!opened.ok) return { ok: false, error: 'open', message: opened.message };
      d.log('server', '서버 백업 받음');
      return { ok: true };
    });
  }

  async function backupDelete(id: number): Promise<ServerBackupResult> {
    const s = d.session.get();
    if (!d.api || !s || !allowed()) return { ok: false, error: 'login', status: status() };
    const r = await d.api.backupDelete(s, id);
    if (!r.ok && r.status !== 404) {
      if (r.status === 401) onUnauthorized();
      return { ok: false, error: backupError(r), status: status() };
    }
    await backupList();
    return { ok: true, status: status() };
  }

  // ---- 로그인 (구글, 카카오. 루프백 + 로컬 PKCE) ----

  async function exchange(code: string, verifier: string, yes: boolean): Promise<void> {
    const t = token();
    if (!d.api || !t || !allowed()) return;
    const r: ApiResult<unknown> = await d.api.session(t, code, verifier, yes);
    if (r.ok) {
      const data = r.data as { session: string; merged: boolean; linked: boolean; logins: LoginService[] };
      try {
        d.session.set(data.session);
      } catch {
        problem = 'noSecure';
        return;
      }
      problem = null;
      st.logins = data.logins;
      backups = null;
      providers = null;
      save();
      d.log('server', '로그인함', data.merged ? '합침' : '', data.linked ? '이음' : '');
      // 합쳤으면 잔액과 물건이 바뀌었다
      void runAgain();
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

  /**
   * 로그인 (로그인했으면 그 서비스를 더 잇는다). 서버가 알려 준 서비스만 (providers). 아직 모르면 구글만 예전처럼.
   * 구글은 브라우저로 /auth/google/start 를, 카카오는 토큰을 들고 /v1/auth/kakao/begin 으로 받은 주소를 연다
   * (카카오 allowlist 는 로그인한 허용 계정만 되므로 서버가 토큰으로 계정을 본다)
   */
  async function startLogin(service: LoginService = 'google'): Promise<ServerStatus> {
    if (!allowed() || !d.api) return status();
    if (!d.device.get()) await run();
    if (!d.device.get()) return status();
    const offered = d.session.get() ? providers?.link : providers?.login;
    if (offered ? !offered.includes(service) : service !== 'google') return status();
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
      let url = d.api.startUrl(port, state, challenge);
      if (service !== 'google') {
        const r = await d.api.begin(token() as string, service, port, state, challenge);
        if (!r.ok) {
          d.log('server', '로그인을 열지 못함', service, r.status, r.error);
          lb.cancel();
          if (login === mine) login = null;
          problem = r.status === 0 ? 'offline' : r.status === 503 ? 'loginOff' : 'failed';
          // 기능 키가 바뀌었을 수 있다: 단추를 다시 맞춘다
          await refreshProviders(true);
          changed();
          return status();
        }
        url = r.data.url;
      }
      await d.openExternal(url);
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

  // ---- 선물, 쿠폰, 쪽지, 운영자 (#101) ----

  /** 서버에 보낼 수 있을 때의 토큰 (기기 계정까지 만든다) */
  async function ready(): Promise<string | undefined> {
    if (!d.api || !allowed()) return undefined;
    if (!d.device.get()) await run();
    return token();
  }

  async function reward(kind: 'claim' | 'coupon', arg: string): Promise<RewardOutcome> {
    const t = await ready();
    if (!d.api || !t) return { ok: false, error: 'off' };
    const r = kind === 'claim' ? await d.api.claim(t, arg) : await d.api.coupon(t, arg);
    if (!r.ok) {
      if (r.status === 401) onUnauthorized();
      d.log('server', kind === 'claim' ? '선물 못 받음' : '쿠폰 못 씀', r.status, r.error);
      return { ok: false, error: r.status === 0 ? 'offline' : r.error };
    }
    d.log('server', kind === 'claim' ? '선물 받음' : '쿠폰 씀', r.data.coins, r.data.tickets);
    // 잔액과 채팅 이용권은 맞추기로 받는다 (앱 장부에 'server-sync' 한 줄)
    await run();
    return { ok: true, coins: r.data.coins, tickets: r.data.tickets };
  }

  /** 쪽지 하나를 연다. 받은 것을 맞추기로 앱에 들인다 */
  async function openInbox(id: number) {
    const t = await ready();
    if (!d.api || !t) return { ok: false as const, status: 0, error: 'off', body: {} };
    const r = await d.api.openInbox(t, id);
    if (r.ok || r.status === 409) await run();
    return r;
  }

  /**
   * 로그인 세션으로 부르기 (친구, #110). 서버 모드가 아니거나 로그인하지 않았으면 부르지 않고 login 으로 답한다.
   * 401 이면 세션을 버린다 (onUnauthorized)
   */
  async function sessionCall<T>(
    f: (api: ServerApi, session: string) => Promise<ApiResult<T>>,
  ): Promise<ApiResult<T>> {
    const s = d.session.get();
    if (!d.api || !s || !allowed()) return { ok: false, status: 403, error: 'login', body: {} };
    const r = await f(d.api, s);
    if (!r.ok && r.status === 401) {
      onUnauthorized();
      changed();
    }
    return r;
  }

  async function adminCall<T>(f: (t: string) => Promise<T>): Promise<T | undefined> {
    const s = d.session.get();
    if (!d.api || !s || !isAdmin()) return undefined;
    return f(s);
  }

  return {
    status,
    run,
    scan,
    allowed,
    /**
     * 이 기기가 지금 쓰는 계정의 짧은 표식(서버가 준 계정 코드의 해시 앞부분). 계정이 바뀌어야만 바뀐다(같은 계정이 다시
     * 로그인해도 같다). 서버가 아직 코드를 안 줬으면 undefined
     */
    accountKey: (): string | undefined =>
      st.code ? createHash('sha256').update(st.code).digest('hex').slice(0, 16) : undefined,
    isAdmin,
    /** 닉네임 바꾸기 (규칙에 맞는 것만. 서버에는 지금이나 다음 맞추기 때) */
    async setNickname(
      raw: unknown,
    ): Promise<{ ok: boolean; problem?: NicknameProblem; status: ServerStatus }> {
      const c = checkNickname(raw);
      if (!c.ok) return { ok: false, problem: c.error, status: status() };
      st.nickname = c.value;
      st.nicknamePending = true;
      save();
      if (allowed() && token()) await ensureNickname();
      changed();
      return { ok: true, status: status() };
    },
    claim: (eventId: string) => reward('claim', eventId),
    coupon: (code: string) => reward('coupon', code),
    /** 쪽지함 한 쪽 (서버 DB). 서버 모드가 아니면 undefined */
    async inbox(before?: number) {
      const t = await ready();
      if (!d.api || !t) return undefined;
      const r = await d.api.inbox(t, before);
      if (!r.ok) {
        if (r.status === 401) onUnauthorized();
        return undefined;
      }
      if (before === undefined && st.inbox !== r.data.unopened) {
        st.inbox = r.data.unopened;
        save();
        changed();
      }
      return r.data;
    },
    openInbox,
    sessionCall,
    /** 운영자 화면 (운영자가 아니면 undefined. 서버가 요청마다 다시 본다) */
    adminOverview: (q?: string, log?: AdminLogFilter) =>
      adminCall(async (t) => {
        const r = await d.api?.adminOverview(t, q, log);
        if (r && !r.ok && r.status === 403) {
          st.admin = false;
          save();
          changed();
        }
        return r?.ok ? r.data : undefined;
      }),
    setAge(age: unknown, nickname?: unknown): ServerStatus {
      if (!isAgeAnswer(age) || !enabled()) return status();
      if (nickname !== undefined && age !== 'under14') {
        const c = checkNickname(nickname);
        if (c.ok) {
          st.nickname = c.value;
          st.nicknamePending = !!d.device.get();
        }
      }
      const was = st.age;
      // 바꾸기 전에 서버로 보낼 수 있었나 (만 14세 미만으로 바꿀 때 연결 표시 거두기, #115)
      const couldSend = allowed();
      st.age = age;
      // 14+ 와 18+ 사이를 바꿨으면 서버에도 알린다 (기기 계정이 있을 때. 없으면 만들 때 지금 값을 보낸다)
      if (ageClass(was) && ageClass(age) && ageClass(was) !== ageClass(age) && d.device.get())
        st.agePending = true;
      if (age === 'under14') {
        // 서버 모드를 끄기 전에 이 기기의 구글 일정 연결 표시를 거둔다 (#115): 끈 뒤에는 어떤 요청도 보내지 않으므로
        // 끊은 뒤 남은 참이 다른 기기에 안내를 띄우지 않게. 끄기 전에 보내기 시작하고 결과만 적는다
        const dev = d.device.get();
        if (d.api && dev && st.calendarSent === true && couldSend)
          void d.api
            .setCalendarLinked(dev, false)
            .then((r) => {
              if (!r.ok) return;
              st.calendarSent = false;
              save();
            })
            .catch(() => undefined);
        // 앱 안 모드: 아무것도 보내지 않는다. 남은 서버 계정은 칸이 탈퇴를 안내한다
        st.on = false;
        st.admin = false;
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
    aiAvailable,
    aiBlock,
    /** 남은 대화권 사본 (쓸 수 없으면 null) */
    tickets: () => (aiAvailable() ? st.tickets : null),
    aiAgreed: () => st.aiAgreed,
    agreeAi() {
      st.aiAgreed = true;
      save();
      changed();
    },
    refreshTickets,
    askAi,
    reportAi,
    /** 로그아웃: 서버의 세션도 지운다 (실패해도 이 컴퓨터에서는 지운다). 기기 토큰은 같은 계정 그대로 */
    async logout(): Promise<ServerStatus> {
      const t = d.session.get();
      merge = null;
      d.session.set(null);
      setTickets(null);
      st.admin = false;
      setAccess(null);
      backups = null;
      providers = null;
      st.logins = [];
      // 로그아웃하면 서버 백업 동의도 거둔다 (다음 로그인 때 다시 묻는다)
      st.backupAgreed = false;
      // 다른 기기의 구글 일정 연결 안내는 로그인한 동안만 (이 기기 표시는 기기 계정에 남는다)
      calendar = null;
      save();
      if (t && d.api) {
        const r = await d.api.logout(t);
        if (!r.ok) d.log('server', '서버 세션 못 지움', r.status, r.error);
      }
      d.log('server', '로그아웃');
      // 로그인 전에 쓸 수 있는 서비스를 다시 받는다 (기기 토큰 기준)
      await refreshProviders(true);
      changed();
      return status();
    },
    merge: answerMerge,
    remove,
    refreshProviders,
    backupList,
    agreeBackup(yes: boolean): ServerStatus {
      st.backupAgreed = yes;
      save();
      changed();
      return status();
    },
    backupUpload,
    backupDownload,
    backupDelete,
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
    /**
     * 이 기기의 구글 일정 연결이 바뀌었다 (#115, main/gcal.ts 가 연결, 끊기, 끝남 때 부른다): 표시를 올리고 칸을 고친다.
     * 맞추기가 도는 중이어도 같이 돌아도 된다 (같은 값이면 보내지 않는다)
     */
    async calendarChanged(): Promise<void> {
      try {
        await ensureCalendar();
      } catch (err) {
        d.log('server', '구글 일정 연결 표시 오류', err instanceof Error ? err.message : String(err));
      }
      changed();
    },
    /** 다른 기기의 구글 일정 연결 안내 거절: 이 기기에서는 다시 묻지 않는다 */
    calendarHintNo(): ServerStatus {
      st.calendarHintNo = true;
      save();
      changed();
      return status();
    },
    /** 관문 결과 (server-api.ts onGate, 이슈 #120). 426 이면 업데이트 안내, 통과하면 푼다 */
    gate: gateSeen,
    /** 시험용 */
    state: () => st,
  };
}

export type ServerCore = ReturnType<typeof createServerCore>;
