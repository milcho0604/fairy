// 구글 캘린더에 쓰기 (6단계): 연결(OAuth), 토큰 보관, 보내기, 읽어 오기(이슈 #54), 설정 창 IPC.
// 네트워크는 모두 여기(메인)서 Electron net.fetch 로 한다. 창은 상태(GcalStatus)만 받는다.
// 토큰은 google-token.json(0600, 운영체제 열쇠로 암호화할 수 있으면 암호화)에만 두고 설정, 백업(backup.ts FILES 에 없다), 기록, 창에는 넘기지 않는다 (hf-token.ts 와 같다).
// 켜고 끄기와 캘린더 id 는 비밀이 아니라 google-calendar.json 에 둔다.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  app,
  type BrowserWindow,
  type IpcMainInvokeEvent,
  ipcMain,
  net,
  shell,
  type WebContents,
} from 'electron';
import type { EventStore } from '../shared/event-store.ts';
import {
  cleanCalendarId,
  GCAL,
  GCAL_PREFS_FILE,
  GCAL_PRIMARY,
  GcalBackoff,
  type GcalMark,
  type GcalProblem,
  type GcalStatus,
  gcalAiOn,
  newGoogleId,
  type PanelGcal,
} from '../shared/gcal.ts';
import type { GcalStore } from '../shared/gcal-store.ts';
import { t } from '../shared/i18n/index.ts';
import {
  authUrl,
  callApi,
  exchangeCode,
  type FetchLike,
  type GoogleClient,
  googleClient,
  makePkce,
  newState,
  refreshAccess,
  revokeToken,
  startLoopback,
} from './gcal-auth.ts';
import { type PullResult, pullPass } from './gcal-pull.ts';
import { GcalLost, type PassResult, syncPass } from './gcal-sync.ts';
import { writeFileDurable } from './json-file.ts';
import { osCrypto } from './os-crypto.ts';
import { secretFile } from './secret-file.ts';

/** 따로 바뀐 게 없어도 이만큼마다 한 번 맞춰 본다 (펫 MCP 서버가 고친 것, 다시 하기) */
const EVERY_MS = 5 * 60_000;
/** 고친 뒤 조금 모아서 보낸다 (제목을 고치고 바로 시각을 고치는 것을 한 번에) */
const KICK_MS = 1500;
/** 구글 일정을 읽어 오는 간격 (따로 바뀐 게 없어도). 설정의 "지금 맞추기"는 바로 */
const PULL_EVERY_MS = 15 * 60_000;

interface Prefs {
  push: boolean;
  /** 고른 캘린더의 원래 일정을 읽어 오기. 옛 설정(이 칸이 없음)은 꺼 둔다: 연결할 때 켠다 */
  pull: boolean;
  /** 가져온 구글 일정도 AI 에 보이기. 사용자가 켠 경우에만 (기본 꺼짐) */
  ai: boolean;
  calendarId: string;
  lastSyncAt: number | null;
}

const userFile = (name: string) => join(app.getPath('userData'), name);
const TOKEN_FILE = 'google-token.json';
const PREFS_FILE = GCAL_PREFS_FILE;

function readPrefs(): Prefs {
  try {
    const v = JSON.parse(readFileSync(userFile(PREFS_FILE), 'utf8')) as Record<string, unknown>;
    return {
      push: v.push === true,
      pull: v.pull === true,
      ai: gcalAiOn(v),
      calendarId: cleanCalendarId(v.calendarId) ?? GCAL_PRIMARY,
      lastSyncAt: typeof v.lastSyncAt === 'number' && Number.isFinite(v.lastSyncAt) ? v.lastSyncAt : null,
    };
  } catch {
    return { push: false, pull: false, ai: false, calendarId: GCAL_PRIMARY, lastSyncAt: null };
  }
}

/**
 * "AI가 구글 일정도 볼 수 있게"를 켰는지 (AI 대화 자료, 오늘 뭐부터, 계획 다듬기가 부른다). 파일에서 바로 읽는다:
 * 펫 MCP 서버(다른 프로세스)와 같은 값을 본다
 */
export const gcalAiAllowed = (): boolean => readPrefs().ai;

function writePrefs(p: Prefs) {
  writeFileDurable(userFile(PREFS_FILE), JSON.stringify(p));
}

/**
 * 오래 가는 토큰(refresh token)만 파일에. 잠깐 쓰는 access token 은 메모리에만.
 * 운영체제 열쇠로 암호화할 수 있으면 암호화해 둔다 (secret-file.ts, 옛 평문 파일은 읽을 때 바꿔 쓴다)
 */
const tokenFile = () => secretFile(userFile(TOKEN_FILE), 'refreshToken', () => osCrypto);
const token = {
  get(): string | undefined {
    const v = tokenFile().read();
    return v && v.length <= 4096 ? v : undefined;
  },
  set(refreshToken: string | null) {
    if (refreshToken === null) tokenFile().remove();
    else tokenFile().write(refreshToken);
  },
};

/** 백업을 가져왔다는 표시 (backup.ts applyPendingImport 가 남긴다) */
export const GCAL_RESET_FILE = 'google-calendar-reset';

const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

export function createGcal(o: {
  store: GcalStore;
  /** 읽어 온 구글 일정을 넣을 곳 (source = google) */
  events: EventStore;
  /** 읽어 와서 일정이 바뀌었다. 패널과 알림을 다시 본다 */
  onEvents?: () => void;
  /** 설정 창에서 온 요청인지 */
  isSettings: (wc: WebContents) => boolean;
  /** 상태를 보낼 설정 창 */
  target: () => BrowserWindow | undefined;
  /** 연결이 끝났다 (구글에서 거둠, 시험판 앱 7일). 펫이 알린다 */
  onLost: () => void;
  log: (tag: string, ...rest: unknown[]) => void;
  /** 일정 줄의 구글 표식이 바뀌었을 수 있다 (보냄, 못 보냄). 패널을 다시 그린다 */
  onMarks?: () => void;
  /** 시험용 */
  fetch?: FetchLike;
}) {
  const f: FetchLike = o.fetch ?? ((url, init) => net.fetch(url, init));
  const client: GoogleClient | undefined = googleClient();
  let prefs = readPrefs();
  let access: { token: string; expiresAt: number } | null = null;
  let connecting: { cancel: () => void } | null = null;
  let problem: GcalProblem | null = null;
  /** 읽어 오기의 문제 (보내기 표식 툴팁에 섞이지 않게 따로 둔다) */
  let pullProblem: GcalProblem | null = null;
  let pending = 0;
  /** 읽어 오기: 마지막으로 다 읽은 때와 수 (메모리에만. 켜면 곧 다시 읽는다), 마지막으로 해 본 때, 다음 차례에 바로 */
  let lastPullAt: number | null = null;
  let pulled = 0;
  let lastPullTry = 0;
  let pullForce = false;
  const backoff = new GcalBackoff();
  /** 구글이 받지 않은 일정 id → 그때 내용 지문 (내용이 바뀌면 다시 보낼 차례라 못 보냄 표시를 내린다) */
  const rejected = new Map<number, string>();

  const connected = () => !!token.get();

  function status(): GcalStatus {
    return {
      configured: !!client,
      connected: connected(),
      connecting: !!connecting,
      push: prefs.push,
      calendarId: prefs.calendarId,
      lastSyncAt: prefs.lastSyncAt,
      pull: prefs.pull,
      ai: prefs.ai,
      lastPullAt,
      pulled,
      pending,
      problem: problem ?? pullProblem,
    };
  }

  function broadcast() {
    const w = o.target();
    if (w && !w.isDestroyed()) w.webContents.send(GCAL.changed, status());
  }

  function setPrefs(patch: Partial<Prefs>) {
    prefs = { ...prefs, ...patch };
    try {
      writePrefs(prefs);
    } catch (err) {
      o.log('gcal', '설정 저장 실패', err instanceof Error ? err.name : 'error');
    }
  }

  /**
   * 읽어 온 구글 일정을 걷어 낸다 (읽어 오기를 끔, 캘린더를 바꿈, 연결이 끝남). 지난 것까지 다:
   * 다시 켜면 다음 읽기가 되살린다 (맞추기가 지운 것이라)
   */
  function dropPulled() {
    lastPullAt = null;
    pulled = 0;
    pullProblem = null;
    try {
      if (o.events.dropExternal('google', Date.now(), { all: true }) > 0) o.onEvents?.();
    } catch (err) {
      o.log('gcal', '가져온 일정 걷기 실패', err instanceof Error ? err.name : 'error');
    }
  }

  function lose(why: 'expired' | 'relink' = 'expired') {
    o.log('gcal', '연결 끝남', why);
    token.set(null);
    access = null;
    problem = why;
    pending = 0;
    dropPulled();
    backoff.clear();
    rejected.clear();
    // 다시 연결하는 계정이 다를 수 있다: 보낸 기록을 "확인 전"으로 (같은 계정이면 겹치지 않고, 다른 계정이면 새로 들어간다)
    o.store.resetSent();
    broadcast();
    o.onMarks?.();
    o.onLost();
  }

  /** 쓸 수 있는 access token. 연결이 끝났으면 Lost, 네트워크가 안 되면 그대로 던진다 */
  async function accessToken(): Promise<string> {
    if (access && Date.now() < access.expiresAt) return access.token;
    const refresh = token.get();
    if (!refresh || !client) throw new GcalLost();
    const r = await refreshAccess(f, { client, refreshToken: refresh, now: Date.now });
    if (!r.ok) {
      o.log('gcal', '토큰 새로 받기 실패', r.error, r.status);
      if (r.error === 'invalid_grant' || r.error === 'unauthorized_client' || r.error === 'invalid_client') {
        lose();
        throw new GcalLost();
      }
      throw new Error('token');
    }
    access = { token: r.tokens.accessToken, expiresAt: r.tokens.expiresAt };
    // 구글이 새 refresh token 을 주면(돌려쓰기) 바꿔 둔다
    if (r.tokens.refreshToken && r.tokens.refreshToken !== refresh) token.set(r.tokens.refreshToken);
    return access.token;
  }

  /** API 를 부른다. 401 이면 토큰을 새로 받아 한 번 더 */
  async function api(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown) {
    const r = await callApi(f, await accessToken(), method, path, body);
    if (r.kind !== 'auth') return r;
    access = null;
    return callApi(f, await accessToken(), method, path, body);
  }

  // ---- 보내기 ----
  let running = false;
  let again = false;
  let marksChanged = false;
  let timer: NodeJS.Timeout | undefined;

  const linked = () => !!client && connected();
  const active = () => linked() && prefs.push;

  /** 허락에서 캘린더 권한이 빠졌다: 다시 연결해야 한다. 남은 권한도 구글에서 거둔다 */
  function scopeLost() {
    const refresh = token.get();
    token.set(null);
    access = null;
    problem = 'scope';
    o.store.resetSent();
    dropPulled();
    if (refresh) void revokeToken(f, refresh).catch(() => {});
  }

  async function pass(): Promise<void> {
    // 저장한 연결을 이 컴퓨터 열쇠로 풀 수 없다 (앱 이름이 짝꿍에서 페어리로 바뀌면 맥 키체인 항목 이름도 바뀐다).
    // 말없이 "연결 안 됨"으로 두면 일정이 안 가는 줄 모른다: 끝난 연결로 치우고 다시 연결해 달라고 알린다
    if (client && !connected() && tokenFile().unreadable()) lose('relink');
    if (!linked()) {
      pending = 0;
      return;
    }
    if (prefs.push) await push();
    else pending = 0;
    if (linked() && prefs.pull && (pullForce || Date.now() - lastPullTry >= PULL_EVERY_MS)) await pull();
  }

  /** 고른 캘린더의 원래 일정을 읽어 온다 (이슈 #54). 페어리가 보낸 일정은 넣지 않는다 */
  async function pull(): Promise<void> {
    pullForce = false;
    lastPullTry = Date.now();
    const cal = prefs.calendarId;
    let r: PullResult;
    try {
      r = await pullPass({
        events: o.events,
        api: (method, path) => api(method, path),
        calendarId: cal,
        now: Date.now,
        ours: o.store.sentUids(),
        untitled: t('panel.event.untitled'),
        // 읽는 사이 끄거나 캘린더를 바꾸거나 연결을 끊었으면 옛 캘린더 것으로 맞추지 않는다
        current: () => prefs.pull && prefs.calendarId === cal && connected(),
        log: o.log,
      });
    } catch (err) {
      if (err instanceof GcalLost) return;
      throw err;
    }
    if (!r.ok) {
      if (r.stop === 'stale') return;
      if (r.stop === 'scope') {
        scopeLost();
        return;
      }
      pullProblem = r.stop;
      // 인터넷이 안 되면 15분이 아니라 다음 차례(5분)에 다시
      if (r.stop === 'offline') lastPullTry = Date.now() - PULL_EVERY_MS + EVERY_MS;
      return;
    }
    pullProblem = null;
    lastPullAt = Date.now();
    pulled = r.count;
    if (r.added || r.updated || r.removed || r.hidden) {
      o.log('gcal', '가져옴', JSON.stringify({ ...r, ok: undefined }));
      o.onEvents?.();
    }
  }

  async function push(): Promise<void> {
    let r: PassResult;
    try {
      r = await syncPass({
        store: o.store,
        backoff,
        api,
        newId: () => newGoogleId((n) => randomBytes(n)),
        now: Date.now,
        calendarId: prefs.calendarId,
        tz: tz(),
        log: o.log,
      });
    } catch (err) {
      if (err instanceof GcalLost) return;
      throw err;
    }
    pending = r.pending;
    for (const id of r.accepted) if (rejected.delete(id)) marksChanged = true;
    for (const x of r.rejected) {
      if (rejected.get(x.eventId) !== x.hash) marksChanged = true;
      rejected.set(x.eventId, x.hash);
    }
    if (r.sent) marksChanged = true;
    if (r.again) again = true;
    if (r.sent) o.log('gcal', '보냄', r.sent);
    if (r.stop === 'scope') scopeLost();
    // 보낸 것이 있으면 적는다 (5분마다 파일을 쓰지 않게. 구글이 받지 않는 일정 하나가 기다려도 멈추지 않게)
    if (r.sent) setPrefs({ lastSyncAt: Date.now() });
    if (r.stop !== problem && (r.stop || problem === 'offline' || problem === 'calendar'))
      marksChanged = true;
    if (r.stop) problem = r.stop;
    else if (r.waiting === 0 && (problem === 'offline' || problem === 'calendar')) problem = null;
  }

  async function run(): Promise<void> {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      let rounds = 0;
      do {
        again = false;
        await pass();
      } while (again && ++rounds < 5);
    } catch (err) {
      o.log('gcal', '맞추기 실패', err instanceof Error ? err.name : 'error');
    } finally {
      running = false;
      broadcast();
      if (marksChanged) {
        marksChanged = false;
        o.onMarks?.();
      }
      schedule();
    }
  }

  function schedule(delay?: number) {
    clearTimeout(timer);
    const next = backoff.nextAt();
    const wait =
      delay ?? (next === undefined ? EVERY_MS : Math.min(EVERY_MS, Math.max(1000, next - Date.now())));
    timer = setTimeout(() => void run(), wait);
    timer.unref();
  }

  /** 일정이 바뀌었다 (패널, 빠른 입력, MCP) */
  function kick() {
    if (active()) schedule(KICK_MS);
  }

  /** 곧 구글 일정을 다시 읽는다 (켬, 캘린더 바꿈, 연결함) */
  function kickPull() {
    if (!linked() || !prefs.pull) return;
    pullForce = true;
    schedule(KICK_MS);
  }

  // ---- 연결 ----
  async function connect(): Promise<GcalStatus> {
    if (!client) return status();
    connecting?.cancel();
    problem = null;
    const pkce = makePkce();
    const state = newState();
    const lb = await startLoopback({
      state,
      page: (ok) => ({
        title: t(ok ? 'gcal.page.okTitle' : 'gcal.page.failTitle'),
        body: t(ok ? 'gcal.page.okBody' : 'gcal.page.failBody'),
      }),
    });
    const mine = { cancel: lb.cancel };
    connecting = mine;
    broadcast();
    o.log('gcal', '연결 시작');
    try {
      await shell.openExternal(
        authUrl({ clientId: client.id, redirectUri: lb.redirectUri, challenge: pkce.challenge, state }),
      );
    } catch (err) {
      o.log('gcal', '브라우저 열기 실패', err instanceof Error ? err.name : 'error');
      lb.cancel();
      problem = 'failed';
    }
    const r = await lb.result;
    // 새 연결이 이 연결을 그만두게 했으면 그쪽이 상태를 맡는다
    if (connecting !== mine) return status();
    connecting = null;
    if (r.kind === 'timeout') problem = 'timeout';
    else if (r.kind === 'error') {
      o.log('gcal', '허락 안 됨', r.error);
      problem = r.error === 'access_denied' ? 'denied' : 'failed';
    } else if (r.kind === 'code') {
      try {
        const got = await exchangeCode(f, {
          client,
          code: r.code,
          verifier: pkce.verifier,
          redirectUri: lb.redirectUri,
          now: Date.now,
        });
        if (!got.ok) {
          o.log('gcal', '토큰 받기 실패', got.error, got.status);
          problem = 'failed';
        } else if (!got.tokens.scopeOk) {
          // 허락 화면에서 캘린더 칸을 체크하지 않았다. 받은 것은 바로 돌려준다
          problem = 'scope';
          void revokeToken(f, got.tokens.refreshToken ?? got.tokens.accessToken).catch(() => {});
        } else if (!got.tokens.refreshToken) {
          problem = 'failed';
        } else {
          token.set(got.tokens.refreshToken);
          access = { token: got.tokens.accessToken, expiresAt: got.tokens.expiresAt };
          backoff.clear();
          // 연결하는 것이 곧 보내고 읽어 오겠다는 것: 둘 다 켠다 (설정 창에서 따로 끌 수 있다)
          setPrefs({ push: true, pull: true });
          o.log('gcal', '연결됨');
          o.onMarks?.();
          kick();
          kickPull();
        }
      } catch (err) {
        o.log('gcal', '토큰 받기 실패', err instanceof Error ? err.name : 'error');
        problem = 'offline';
      }
    }
    broadcast();
    return status();
  }

  async function disconnect(): Promise<GcalStatus> {
    connecting?.cancel();
    connecting = null;
    const refresh = token.get();
    token.set(null);
    access = null;
    problem = null;
    pending = 0;
    backoff.clear();
    rejected.clear();
    clearTimeout(timer);
    // 구글에서도 권한을 거둔다. 인터넷이 안 되면 이 컴퓨터에서만 지운다 (구글 계정 > 보안 > 서드 파티 앱에서 거둘 수 있다)
    if (refresh)
      await revokeToken(f, refresh)
        .then((ok) => o.log('gcal', '권한 거둠', ok))
        .catch((err) => o.log('gcal', '권한 거두기 실패', err instanceof Error ? err.name : 'error'));
    // 다음에 다른 계정으로 이어도 빠짐없이 들어가게 보낸 기록을 "확인 전"으로
    o.store.resetSent();
    // 읽어 온 구글 일정도 걷어 낸다 (연결을 끊으면 더는 맞출 수 없다)
    dropPulled();
    o.log('gcal', '연결 끊음');
    broadcast();
    o.onMarks?.();
    return status();
  }

  // ---- 설정 창 ----
  const ok = (e: IpcMainInvokeEvent) => o.isSettings(e.sender);
  ipcMain.handle(GCAL.status, (e) => (ok(e) ? refreshed() : undefined));
  ipcMain.handle(GCAL.connect, (e) => (ok(e) ? connect() : undefined));
  ipcMain.handle(GCAL.disconnect, (e) => (ok(e) ? disconnect() : undefined));
  ipcMain.on(GCAL.cancel, (e) => {
    if (o.isSettings(e.sender)) connecting?.cancel();
  });
  ipcMain.handle(GCAL.setPush, (e, on: unknown) => {
    if (!ok(e)) return undefined;
    if (typeof on === 'boolean' && on !== prefs.push) {
      setPrefs({ push: on });
      if (on) {
        backoff.clear();
        kick();
      } else {
        clearTimeout(timer);
        pending = 0;
        if (problem !== 'expired' && problem !== 'relink' && problem !== 'scope') problem = null;
      }
      o.onMarks?.();
    }
    return refreshed();
  });
  ipcMain.handle(GCAL.setPull, (e, on: unknown) => {
    if (!ok(e)) return undefined;
    if (typeof on === 'boolean' && on !== prefs.pull) {
      setPrefs({ pull: on });
      if (on) kickPull();
      else dropPulled();
    }
    return refreshed();
  });
  ipcMain.handle(GCAL.setAi, (e, on: unknown) => {
    if (!ok(e)) return undefined;
    if (typeof on === 'boolean' && on !== prefs.ai) {
      setPrefs({ ai: on });
      o.log('gcal', 'AI가 구글 일정 보기', on);
    }
    return refreshed();
  });
  ipcMain.handle(GCAL.setCalendar, (e, raw: unknown) => {
    if (!ok(e)) return undefined;
    const id = typeof raw === 'string' && raw.length <= 300 ? cleanCalendarId(raw) : undefined;
    if (id && id !== prefs.calendarId) {
      setPrefs({ calendarId: id });
      if (problem === 'calendar') problem = null;
      backoff.clear();
      // 옛 캘린더에서 읽어 온 일정은 걷고 새 캘린더를 읽는다
      dropPulled();
      o.onMarks?.();
      kick();
      kickPull();
    }
    return refreshed();
  });
  ipcMain.handle(GCAL.syncNow, async (e) => {
    if (!ok(e)) return undefined;
    backoff.clear();
    pullForce = prefs.pull;
    await run();
    return status();
  });

  /** 창에 보일 때는 못 보낸 수를 새로 센다 */
  function refreshed(): GcalStatus {
    if (active()) {
      try {
        pending = o.store.pending(Date.now(), prefs.calendarId, tz()).length;
      } catch {
        // 저장 파일을 못 쓰면 그대로
      }
    }
    return status();
  }

  // 백업을 가져왔으면 보낸 기록이 그 백업 때 것이다: "확인 전"으로 되돌려 지금 일정과 맞춘다 (backup.ts 표시 파일)
  const imported = userFile(GCAL_RESET_FILE);
  if (existsSync(imported)) {
    try {
      o.store.resetSent();
      rmSync(imported, { force: true });
      o.log('gcal', '백업 가져온 뒤 보낸 기록 되돌림');
    } catch {
      // 다음에 켤 때 다시
    }
  }
  if (client) schedule(15_000);
  app.on('will-quit', () => {
    clearTimeout(timer);
    connecting?.cancel();
  });

  /**
   * 일정 줄의 구글 표식 (패널). 연결이 없으면 undefined: 표식을 하나도 붙이지 않는다.
   * 구글이 받지 않은 일정은 내용이 그때와 같을 때만 failed (고쳤으면 다시 보낼 차례라 pending)
   */
  function marks(ids: readonly number[]): PanelGcal | undefined {
    if (!client || !connected()) return undefined;
    let m: Record<number, GcalMark>;
    try {
      m = o.store.marks(ids, { calendarId: prefs.calendarId, tz: tz(), now: Date.now(), push: prefs.push });
    } catch {
      return undefined;
    }
    if (prefs.push)
      for (const [id, hash] of rejected) {
        if (m[id] !== 'pending') continue;
        if (o.store.hashOf(id, tz()) === hash) m[id] = 'failed';
      }
    return { marks: m, problem };
  }

  return {
    kick,
    status,
    marks,
    /**
     * 캘린더 가져오기(.ics)가 거를 iCalUID: 짝꿍이 보낸 일정이 되돌아온 것, 그리고 구글에서 이미 읽어 온 일정
     * (같은 구글 캘린더를 두 길로 받으면 같은 일정이 둘씩 보였다)
     */
    skipUids: (): Set<string> => {
      const out = o.store.sentUids();
      if (linked() && prefs.pull) for (const u of o.events.googleUids()) out.add(u);
      return out;
    },
  };
}
