// 페어리 서버 계정 (이슈 #99): server-core.ts 에 Electron 을 붙인다. 설정 창 IPC, 토큰 파일(safeStorage),
// 브라우저 열기, 몇 분마다 맞추기, 장부가 바뀌면 대기열에 넣기, 백업 되살리기 표시.
// 서버 주소(server-url.ts)가 비면 서버 기능이 모두 꺼진다: 칸이 숨고 어떤 요청도 나가지 않는다.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  app,
  type BrowserWindow,
  clipboard,
  type IpcMainInvokeEvent,
  ipcMain,
  shell,
  type WebContents,
} from 'electron';
import { adminWebUrl } from '../shared/admin-web.ts';
import { spendRule } from '../shared/coin-rules.ts';
import type { Db } from '../shared/db-schema.ts';
import { isHouseStyle } from '../shared/house-art.ts';
import { t } from '../shared/i18n/index.ts';
import type { PetCard } from '../shared/pet-card.ts';
import { isLoginService, type RewardOutcome, SERVER, type ServerStatus } from '../shared/server-account.ts';
import { FRIENDS, type FriendsState, inviteLink } from '../shared/server-friends.ts';
import { houseName, houseStyleName, type ItemStore, TOYS } from '../shared/shop.ts';
import { EVENT_ID, normalizeCoupon } from '../shared/site-events.ts';
import { localDay, type TodoStore } from '../shared/todo-store.ts';
import { isVersion } from '../shared/update-levels.ts';
import { startLoopback } from './gcal-auth.ts';
import { mainFetch } from './net-fetch.ts';
import { osCrypto } from './os-crypto.ts';
import { adminLogFilter, serverApi } from './server-api.ts';
import { type Reverted, ServerCoins } from './server-coins.ts';
import { createServerCore, type Secret } from './server-core.ts';
import { type BusySource, createServerFriends } from './server-friends.ts';
import { SERVER_RESTORE_MARK } from './server-mark.ts';
import { sealedSecret } from './server-secret.ts';
import { appServerUrl } from './server-url.ts';
import { readJson, removeJson, writeJson } from './store.ts';
import { memorySecrets } from './test-keychain.ts';

/** 켤 때 처음 맞추기까지, 그 뒤로 이만큼마다 */
/** 로그아웃 때 서버의 펫 카드를 못 지웠다는 표시 파일 (server-friends.ts cleanup) */
const VISIT_CLEANUP = 'friend-visit-cleanup';
const FIRST_SYNC_MS = 5_000;
export const SYNC_EVERY_MS = 3 * 60_000;
/** 장부가 바뀌고 이만큼 조용하면 대기열에 넣고 보낸다 */
const AFTER_WRITE_MS = 15_000;
const STATE = 'server-state';

/** 거절된 쓰기의 이름 (펫 말풍선) */
export function revertedName(reason: string): string {
  if (reason === 'food') return t('server.reverted.food');
  if (reason === 'custom-food') return t('server.reverted.customFood');
  const rule = spendRule(reason);
  if (rule?.kind === 'buy') {
    if (rule.item === 'house') return houseName((rule.level ?? 1) - 1) ?? t('shop.house.generic');
    const [, tail] = reason.split(':');
    if (reason.startsWith('toy:')) return TOYS.find((x) => x.key === tail)?.name ?? reason;
    if (isHouseStyle(tail)) return houseStyleName(tail);
  }
  return reason;
}

export function createServer(o: {
  db: Db;
  todos: TodoStore;
  shop: ItemStore;
  isSettings: (wc: WebContents) => boolean;
  /** 큰 창 비서 구역 (캘린더 칸의 "다른 기기에서 연결했어" 안내만 읽고 끈다) */
  isHub?: (wc: WebContents) => boolean;
  hub?: () => WebContents | undefined;
  target: () => BrowserWindow | undefined;
  onWrite: (listener: (sql: string) => void) => void;
  /** 맞추기로 잔액이나 물건이 바뀌었다 */
  onCoins: () => void;
  onReverted: (text: string) => void;
  /** 칸 상태가 바뀌었다 (로그인, 나이, 대화권 남은 수). 채팅 창의 대화권 표시를 고친다 */
  onStatus?: () => void;
  /** 열지 않은 서버 쪽지가 있다 (#101, main/server-inbox.ts 가 받아 펫이 건넨다) */
  onInbox?: () => void;
  /** 서버가 정한 강제 최소 판 (이슈 #120, server-core.ts onServerMin). 업데이트 확인이 쓴다 */
  onServerMin?: (min: string | null | undefined) => void;
  /** 업데이트 단추 (이슈 #120): 서버가 낡은 앱이라고 막았을 때 설정 칸에서 누른다 (main/update.ts install) */
  installUpdate?: () => void;
  /** 선물을 받았다 (#101, 이벤트 목록의 단추를 "받았어" 로) */
  onClaimed?: (eventId: string) => void;
  /** 서버 백업 (#102): 개인 백업 파일 만들기와 되살리기 확인 칸 열기 (backup.ts) */
  backup?: {
    exportFile: (target: string) => Promise<string>;
    inspect: (path: string) => Promise<{ ok: boolean; message: string; offer?: unknown }>;
  };
  /** 이 기기가 구글 일정을 연결했나 (#115, main/gcal.ts). 바뀌면 core.calendarChanged() */
  calendarLinked?: () => boolean;
  /** 친구 일정 공유 (#110): [from, to) 의 시각 일정 (어느 것을 보낼지는 server-friends.ts shareableEvent) */
  friendEvents?: (from: number, to: number) => BusySource[];
  /** 친구 펫 놀러 가기 (#141): 지금 내 펫 카드 (종류 id, 이름, 네 발 서기. 그림은 없다) */
  petCard?: () => PetCard;
  /** 새 친구 신청이 왔다 (이름들). 펫이 한마디 한다 */
  onFriendRequest?: (names: string[]) => void;
  /** 로그아웃했다 (와 있던 놀러 온 친구 펫을 돌려보낸다) */
  onLogout?: () => void;
  customPet?: () => boolean;
  log: (tag: string, ...rest: unknown[]) => void;
}) {
  const url = appServerUrl();
  const dir = app.getPath('userData');
  // 서버 토큰은 운영체제 열쇠로 암호화해서만 둔다 (평문 저장 금지, server-secret.ts)
  // 시험 실행(JJ_TEST_SECRETS=memory, 설치판 아님)은 열쇠고리도 파일도 쓰지 않고 메모리에만 둔다 (test-keychain.ts)
  const memory = memorySecrets(app.isPackaged, process.env);
  const secret = (name: string): Secret => {
    if (memory) {
      let v: string | undefined;
      return {
        get: () => v,
        set: (x) => {
          v = x ?? undefined;
        },
        unreadable: () => false,
      };
    }
    return sealedSecret(join(dir, `${name}.json`), () => osCrypto);
  };
  const sessionSecret = secret('server-session');
  /** 시험용 (JJ_TEST_SECRETS=memory 일 때만): 구글을 부르지 않고 이 기기의 구글 일정 연결 상태만 흉내 낸다 */
  let calendarOverride: boolean | undefined;
  // 앱 판은 머리로 보낸다 (이슈 #120). 시험 실행(JJ_TEST_SECRETS=memory, 설치판 아님)만 JJ_TEST_APP_VERSION 으로 낮춰 보낼 수 있다
  const testVersion = process.env.JJ_TEST_APP_VERSION;
  const appVersion = memory && testVersion && isVersion(testVersion) ? testVersion : app.getVersion();
  const openExternal = (u: string): Promise<void> =>
    memory && process.env.JJ_TEST_BROWSER === 'fetch'
      ? mainFetch(u).then((r) => void r.body?.cancel())
      : shell.openExternal(u);
  const core = createServerCore({
    api: url ? serverApi(url, mainFetch, { appVersion, onGate: (g) => core.gate(g) }) : undefined,
    onServerMin: (m) => o.onServerMin?.(m),
    coins: new ServerCoins(o.db, o.todos, o.shop, localDay),
    load: () => readJson(STATE),
    save: (s) => writeJson(STATE, s),
    device: secret('server-device'),
    session: sessionSecret,
    secure: () => memory || osCrypto.available(),
    loopback: (x) => startLoopback(x),
    // 시험 실행(JJ_TEST_SECRETS=memory, 설치판 아님)에서 JJ_TEST_BROWSER=fetch 면 시스템 브라우저 대신 메인이 주소를 따라간다:
    // 가짜 카카오 → 서버 콜백 → 루프백. 사용자 화면에 브라우저 창을 띄우지 않는다 (scripts/dev/server-backup.mjs)
    openExternal,
    page: (ok) => ({
      title: t(ok ? 'server.page.okTitle' : 'server.page.failTitle'),
      body: t(ok ? 'server.page.okBody' : 'server.page.failBody'),
    }),
    now: Date.now,
    log: o.log,
    ...(o.calendarLinked ? { calendarLinked: () => calendarOverride ?? o.calendarLinked?.() ?? false } : {}),
    onChange: (s) => send(s),
    onCoins: o.onCoins,
    onInbox: () => o.onInbox?.(),
    onCoinsLowered: (n: number) => o.onReverted(t('server.coinsLowered', { n })),
    onReverted: (list: Reverted[]) => {
      const names = [...new Set(list.map((e) => revertedName(e.reason)))];
      o.onReverted(t('server.reverted', { what: names.join(', ') }));
    },
    // 서버 백업 파일은 데이터 폴더 안 임시 이름으로 잠깐 두고 바로 지운다 (백업 목록에 들지 않는 이름)
    ...(o.backup
      ? {
          backupFile: {
            async make() {
              const p = join(dir, `server-backup-up-${randomBytes(6).toString('hex')}.fairybackup`);
              try {
                await o.backup?.exportFile(p);
                return readFileSync(p);
              } finally {
                rmSync(p, { force: true });
              }
            },
            async open(bytes: Uint8Array) {
              // 받을 때마다 다른 이름: 같은 이름이면 inspect 가 앞서 연 확인 칸을 그대로 보인다
              const p = join(dir, `server-backup-down-${randomBytes(6).toString('hex')}.fairybackup`);
              try {
                writeFileSync(p, bytes, { mode: 0o600 });
                const r = await o.backup?.inspect(p);
                return { ok: !!r?.offer, message: r?.message ?? '' };
              } finally {
                rmSync(p, { force: true });
              }
            },
          },
        }
      : {}),
  });

  // 친구 (#110): 서버 모드, 로그인, 서버가 켠 친구 기능일 때만
  const friends = createServerFriends({
    core: () => core,
    events: (from, to) => o.friendEvents?.(from, to) ?? [],
    ...(o.petCard ? { card: o.petCard } : {}),
    ...(o.customPet ? { customPet: o.customPet } : {}),
    cleanup: {
      get: () => {
        const v = (readJson(VISIT_CLEANUP) as { code?: unknown } | undefined)?.code;
        return typeof v === 'string' ? v : null;
      },
      set: (code) => (code ? writeJson(VISIT_CLEANUP, { code }) : removeJson(VISIT_CLEANUP)),
    },
    now: Date.now,
    onChange: (s) => sendFriends(s),
    ...(o.onFriendRequest ? { onIncoming: o.onFriendRequest } : {}),
    log: o.log,
  });
  let friendsWas = false;

  function sendFriends(s: FriendsState) {
    const w = o.target();
    if (w && !w.isDestroyed()) w.webContents.send(FRIENDS.changed, s);
  }

  function send(s: ServerStatus) {
    const w = o.target();
    if (w && !w.isDestroyed()) w.webContents.send(SERVER.changed, s);
    const h = o.hub?.();
    if (h && !h.isDestroyed()) h.send(SERVER.changed, s);
    o.onStatus?.();
    // 친구 칸이 새로 보이게 됐으면(로그인, 기능 켬) 목록을 받는다. 숨게 됐으면 칸에 알린다
    const now = friends.available();
    if (now !== friendsWas) {
      friendsWas = now;
      if (now) void friends.refresh();
    }
    // 잔액, 채팅 이용권, 기능 키가 친구 칸(선물 칸)에도 보이게 같이 보낸다
    sendFriends(friends.state());
  }

  // 백업을 되살리고 켰으면 되살린 장부의 코인을 서버 사본으로 맞춘다 (기획서 7절)
  const mark = join(dir, SERVER_RESTORE_MARK);
  if (existsSync(mark)) {
    core.afterRestore();
    rmSync(mark, { force: true });
  }

  // 켤 때와 몇 분마다
  const first = setTimeout(() => void core.run(), FIRST_SYNC_MS);
  const every = setInterval(() => void core.run(), SYNC_EVERY_MS);
  first.unref?.();
  every.unref?.();
  // 친구 목록과 바쁜 시간대 (#110): 맞추기와 같은 간격. 공유하는 친구가 없으면 일정은 올리지 않는다
  const friendsEvery = setInterval(() => {
    if (!friends.available()) return;
    void friends
      .refresh()
      .then(() => friends.uploadBusy())
      .then(() => friends.uploadCard())
      .catch((err) => o.log('friends', '오류', err instanceof Error ? err.message : String(err)));
  }, SYNC_EVERY_MS);
  friendsEvery.unref?.();
  // 장부에 쓰면 조금 뒤 대기열에 넣고 보낸다 (묶음 안에서 바로 읽지 않는다: 되돌려질 수 있다)
  let soon: ReturnType<typeof setTimeout> | undefined;
  o.onWrite((sql) => {
    if (!/coin_log/i.test(sql) || !core.allowed()) return;
    clearTimeout(soon);
    soon = setTimeout(() => void core.run(), AFTER_WRITE_MS);
  });
  app.on('will-quit', () => {
    clearTimeout(first);
    clearInterval(every);
    clearInterval(friendsEvery);
    clearTimeout(soon);
  });

  const ok = (e: IpcMainInvokeEvent) => o.isSettings(e.sender);
  /** 큰 창은 상태 읽기와 캘린더 안내 끄기만 */
  const okOrHub = (e: IpcMainInvokeEvent) => ok(e) || !!o.isHub?.(e.sender);
  ipcMain.handle(SERVER.status, (e) => {
    if (!okOrHub(e)) return undefined;
    // 설정 창을 열 때 로그인 서비스와 기능 키를 다시 묻는다 (운영자가 바꾼 스위치, 바뀌면 상태를 다시 보낸다)
    void core.refreshProviders().catch(() => undefined);
    return core.status();
  });
  ipcMain.handle(SERVER.setAge, (e, age: unknown, nickname: unknown) =>
    ok(e) ? core.setAge(age, nickname) : undefined,
  );
  ipcMain.handle(SERVER.setNickname, async (e, nickname: unknown) =>
    ok(e) ? core.setNickname(nickname) : { ok: false, status: undefined },
  );
  ipcMain.handle(SERVER.copyCode, (e) => {
    const code = ok(e) ? core.status().code : null;
    if (!code) return false;
    clipboard.writeText(code);
    return true;
  });
  // 선물과 쿠폰 (#101): 모양은 여기서 한 번 더 보고 서버에 보낸다
  ipcMain.handle(SERVER.claim, async (e, id: unknown): Promise<RewardOutcome> => {
    if (!ok(e) || typeof id !== 'string' || !EVENT_ID.test(id)) return { ok: false, error: 'event' };
    const r = await core.claim(id);
    if (r.ok || r.error === 'already_claimed') o.onClaimed?.(id);
    return r;
  });
  ipcMain.handle(SERVER.coupon, async (e, code: unknown): Promise<RewardOutcome> => {
    if (!ok(e)) return { ok: false, error: 'code' };
    const norm = normalizeCoupon(code);
    if (!norm) return { ok: false, error: 'code' };
    return core.coupon(norm);
  });
  // 운영자 칸 (#101): 설정 창에서, 운영자 계정일 때만. 세션 토큰은 메인에만 있고 서버가 요청마다 다시 본다
  ipcMain.handle(SERVER.adminOverview, async (e, q: unknown, log: unknown) => {
    if (!ok(e) || !core.isAdmin()) return undefined;
    return core.adminOverview(typeof q === 'string' ? q.slice(0, 40) : undefined, adminLogFilter(log));
  });
  // 관리 작업은 웹 운영자 화면에서 한다 (#150). 주소는 설정된 서버 주소에서 만들고 자리는 목록에 있는 것만
  ipcMain.handle(SERVER.adminOpenWeb, async (e, place: unknown): Promise<string | undefined> => {
    if (!ok(e) || !core.isAdmin()) return undefined;
    const target = adminWebUrl(url, place);
    if (!target) return undefined;
    try {
      await openExternal(target);
    } catch (err) {
      o.log('server', '웹 운영자 화면 열기 실패', String(err));
      return undefined;
    }
    return target;
  });
  ipcMain.handle(SERVER.turnOn, (e) => (ok(e) ? core.turnOn() : undefined));
  // 업데이트 단추 (이슈 #120): 기존 업데이트 흐름을 쓴다 (받아 두고 다시 켜서 설치, 안 되면 설치 안내)
  ipcMain.handle(SERVER.updateNow, (e) => {
    if (!ok(e)) return undefined;
    o.installUpdate?.();
    return core.status();
  });
  ipcMain.handle(SERVER.syncNow, async (e) => {
    if (!ok(e)) return undefined;
    await core.run();
    return core.status();
  });
  ipcMain.handle(SERVER.login, (e, service: unknown) =>
    ok(e) ? core.login(isLoginService(service) ? service : 'google') : undefined,
  );
  ipcMain.on(SERVER.cancelLogin, (e) => {
    if (o.isSettings(e.sender)) core.cancelLogin();
  });
  // 로그아웃하면 서버의 내 펫 카드도 지운다 (세션이 살아 있을 때 먼저)
  ipcMain.handle(SERVER.logout, async (e) => {
    if (!ok(e)) return undefined;
    await friends.stopVisit().catch(() => undefined);
    o.onLogout?.();
    return core.logout();
  });
  ipcMain.handle(SERVER.merge, (e, yes: unknown) => (ok(e) ? core.merge(yes === true) : undefined));
  ipcMain.handle(SERVER.remove, async (e) => (ok(e) ? core.remove() : { ok: false, status: undefined }));
  // 서버 백업 (#102)
  const backupId = (v: unknown) => (typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? v : 0);
  ipcMain.handle(SERVER.backupList, async (e) => {
    if (!ok(e)) return undefined;
    await core.backupList();
    return core.status();
  });
  ipcMain.handle(SERVER.backupAgree, (e, yes: unknown) =>
    ok(e) ? core.agreeBackup(yes === true) : undefined,
  );
  ipcMain.handle(SERVER.backupUpload, (e) => (ok(e) ? core.backupUpload() : { ok: false }));
  ipcMain.handle(SERVER.backupDownload, (e, id: unknown) =>
    ok(e) ? core.backupDownload(backupId(id)) : { ok: false },
  );
  ipcMain.handle(SERVER.backupDelete, (e, id: unknown) =>
    ok(e) ? core.backupDelete(backupId(id)) : { ok: false },
  );
  // 다른 기기의 구글 일정 연결 안내 거절 (#115)
  ipcMain.handle(SERVER.calendarHintNo, (e) => (okOrHub(e) ? core.calendarHintNo() : undefined));

  // 친구 (#110): 설정 창에서만. 코드 모양은 메인이 한 번 더 본다
  const code = (v: unknown) =>
    typeof v === 'string' && /^F-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/.test(v) ? v : '';
  const id = (v: unknown) => (typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? v : 0);
  const amount = (v: unknown, max: number) =>
    typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max ? v : -1;
  const refused = { ok: false as const, error: 'invalid' };
  ipcMain.handle(FRIENDS.state, (e) => {
    if (!ok(e)) return undefined;
    void friends.refresh();
    return friends.state();
  });
  ipcMain.handle(FRIENDS.refresh, async (e) => {
    if (!ok(e)) return undefined;
    await friends.refresh();
    return friends.state();
  });
  ipcMain.handle(FRIENDS.request, (e, text: unknown) => (ok(e) ? friends.request(text) : refused));
  ipcMain.handle(FRIENDS.accept, (e, v: unknown) => (ok(e) && id(v) ? friends.accept(id(v)) : refused));
  ipcMain.handle(FRIENDS.decline, (e, v: unknown) => (ok(e) && id(v) ? friends.decline(id(v)) : refused));
  ipcMain.handle(FRIENDS.cancel, (e, v: unknown) => (ok(e) && id(v) ? friends.cancel(id(v)) : refused));
  ipcMain.handle(FRIENDS.remove, (e, v: unknown) => (ok(e) && code(v) ? friends.remove(code(v)) : refused));
  ipcMain.handle(FRIENDS.block, (e, v: unknown) => (ok(e) && code(v) ? friends.block(code(v)) : refused));
  ipcMain.handle(FRIENDS.unblock, (e, v: unknown) => (ok(e) && code(v) ? friends.unblock(code(v)) : refused));
  ipcMain.handle(FRIENDS.gift, (e, to: unknown, coins: unknown, passes: unknown) => {
    const c = amount(coins, 500);
    const p = amount(passes, 5);
    if (!ok(e) || !code(to) || c < 0 || p < 0 || c + p === 0) return refused;
    return friends.gift(code(to), c, p);
  });
  ipcMain.handle(FRIENDS.share, (e, to: unknown, on: unknown) =>
    ok(e) && code(to) && typeof on === 'boolean' ? friends.share(code(to), on) : refused,
  );
  ipcMain.handle(FRIENDS.shareTitle, (e, to: unknown, on: unknown) =>
    ok(e) && code(to) && typeof on === 'boolean' ? friends.shareTitle(code(to), on) : refused,
  );
  ipcMain.handle(FRIENDS.visit, (e, to: unknown, on: unknown) =>
    ok(e) && code(to) && typeof on === 'boolean' ? friends.visit(code(to), on) : refused,
  );
  ipcMain.handle(FRIENDS.busy, (e, to: unknown) => (ok(e) && code(to) ? friends.busy(code(to)) : refused));
  ipcMain.handle(FRIENDS.copyCode, (e) => {
    const me = ok(e) ? friends.state().list?.me.code : undefined;
    if (!me) return false;
    clipboard.writeText(me);
    return true;
  });
  ipcMain.handle(FRIENDS.copyLink, (e) => {
    const me = ok(e) ? friends.state().list?.me.code : undefined;
    if (!me) return false;
    clipboard.writeText(inviteLink(me));
    return true;
  });
  ipcMain.on(FRIENDS.clearPrefill, (e) => {
    if (o.isSettings(e.sender)) friends.clearPrefill();
  });

  return {
    core,
    friends,
    /** 서버 모드라 코인이 서버 정본을 따른다 (백업 되살리기 안내, 코인 초기화) */
    serverCoins: () => core.allowed(),
    beforeRestore: () => core.beforeRestore(),
    /**
     * 시험용 (JJ_TEST_SECRETS=memory 일 때만): 시험이 DB 에 만든 세션을 넣는다. 시험 서버는 구글 값이 비어
     * 진짜 브라우저 로그인을 하지 않는다 (scripts/dev/server-ai.mjs)
     */
    debugSetSession(token: string): boolean {
      if (!memory || !/^fs_[A-Za-z0-9_-]{43}$/.test(token)) return false;
      sessionSecret.set(token);
      void core.run();
      return true;
    },
    /**
     * 시험용 (JJ_TEST_SECRETS=memory 일 때만, #115): 이 기기의 구글 일정 연결 상태를 흉내 낸다 (undefined 면 진짜 상태로).
     * 진짜 구글은 부르지 않는다 (scripts/dev/calendar-link.mjs)
     */
    async debugCalendarLinked(linked: boolean | undefined): Promise<boolean> {
      if (!memory) return false;
      calendarOverride = linked;
      await core.calendarChanged();
      return true;
    },
  };
}
