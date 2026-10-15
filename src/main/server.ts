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
  net,
  shell,
  type WebContents,
} from 'electron';
import { spendRule } from '../shared/coin-rules.ts';
import type { Db } from '../shared/db-schema.ts';
import { isHouseStyle } from '../shared/house-art.ts';
import { t } from '../shared/i18n/index.ts';
import { isLoginService, type RewardOutcome, SERVER, type ServerStatus } from '../shared/server-account.ts';
import { houseName, houseStyleName, type ItemStore, TOYS } from '../shared/shop.ts';
import { EVENT_ID, normalizeCoupon } from '../shared/site-events.ts';
import { localDay, type TodoStore } from '../shared/todo-store.ts';
import { startLoopback } from './gcal-auth.ts';
import { osCrypto } from './os-crypto.ts';
import { serverApi } from './server-api.ts';
import { type Reverted, ServerCoins } from './server-coins.ts';
import { createServerCore, type Secret } from './server-core.ts';
import { SERVER_RESTORE_MARK } from './server-mark.ts';
import { sealedSecret } from './server-secret.ts';
import { appServerUrl } from './server-url.ts';
import { readJson, writeJson } from './store.ts';
import { memorySecrets } from './test-keychain.ts';

/** 켤 때 처음 맞추기까지, 그 뒤로 이만큼마다 */
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

/** 운영자 칸 폼 값: 글자, 수, 참거짓, 글자 목록만 (각 2000자, 칸 40개까지) */
export function adminFields(raw: unknown): Record<string, string | string[] | boolean | number> {
  const out: Record<string, string | string[] | boolean | number> = {};
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw).slice(0, 40)) {
    if (!/^[a-zA-Z_]{1,30}$/.test(k)) continue;
    if (typeof v === 'string') out[k] = v.slice(0, 2000);
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'boolean') out[k] = v;
    else if (Array.isArray(v)) out[k] = v.filter((x): x is string => typeof x === 'string').slice(0, 10);
  }
  return out;
}

export function createServer(o: {
  db: Db;
  todos: TodoStore;
  shop: ItemStore;
  isSettings: (wc: WebContents) => boolean;
  target: () => BrowserWindow | undefined;
  onWrite: (listener: (sql: string) => void) => void;
  /** 맞추기로 잔액이나 물건이 바뀌었다 */
  onCoins: () => void;
  onReverted: (text: string) => void;
  /** 칸 상태가 바뀌었다 (로그인, 나이, 대화권 남은 수). 채팅 창의 대화권 표시를 고친다 */
  onStatus?: () => void;
  /** 열지 않은 서버 쪽지가 있다 (#101, main/server-inbox.ts 가 받아 펫이 건넨다) */
  onInbox?: () => void;
  /** 선물을 받았다 (#101, 이벤트 목록의 단추를 "받았어" 로) */
  onClaimed?: (eventId: string) => void;
  /** 서버 백업 (#102): 개인 백업 파일 만들기와 되살리기 확인 칸 열기 (backup.ts) */
  backup?: {
    exportFile: (target: string) => Promise<string>;
    inspect: (path: string) => Promise<{ ok: boolean; message: string; offer?: unknown }>;
  };
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
  const core = createServerCore({
    api: url ? serverApi(url, (u, init) => net.fetch(u, init)) : undefined,
    coins: new ServerCoins(o.db, o.todos, o.shop, localDay),
    load: () => readJson(STATE),
    save: (s) => writeJson(STATE, s),
    device: secret('server-device'),
    session: sessionSecret,
    secure: () => memory || osCrypto.available(),
    loopback: (x) => startLoopback(x),
    // 시험 실행(JJ_TEST_SECRETS=memory, 설치판 아님)에서 JJ_TEST_BROWSER=fetch 면 시스템 브라우저 대신 메인이 주소를 따라간다:
    // 가짜 카카오 → 서버 콜백 → 루프백. 사용자 화면에 브라우저 창을 띄우지 않는다 (scripts/dev/server-backup.mjs)
    openExternal: (u) =>
      memory && process.env.JJ_TEST_BROWSER === 'fetch'
        ? fetch(u).then((r) => void r.body?.cancel())
        : shell.openExternal(u),
    page: (ok) => ({
      title: t(ok ? 'server.page.okTitle' : 'server.page.failTitle'),
      body: t(ok ? 'server.page.okBody' : 'server.page.failBody'),
    }),
    now: Date.now,
    log: o.log,
    onChange: (s) => send(s),
    onCoins: o.onCoins,
    onInbox: () => o.onInbox?.(),
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

  function send(s: ServerStatus) {
    const w = o.target();
    if (w && !w.isDestroyed()) w.webContents.send(SERVER.changed, s);
    o.onStatus?.();
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
    clearTimeout(soon);
  });

  const ok = (e: IpcMainInvokeEvent) => o.isSettings(e.sender);
  ipcMain.handle(SERVER.status, (e) => {
    if (!ok(e)) return undefined;
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
  ipcMain.handle(SERVER.adminOverview, async (e, q: unknown) => {
    if (!ok(e) || !core.isAdmin()) return undefined;
    return core.adminOverview(typeof q === 'string' ? q.slice(0, 40) : undefined);
  });
  ipcMain.handle(SERVER.adminAction, async (e, action: unknown, fields: unknown) => {
    if (!ok(e) || !core.isAdmin()) return { ok: false, text: 'not_admin', code: 'not_admin' };
    if (typeof action !== 'string' || !/^[a-z]+(\/[a-z]+)?$/.test(action))
      return { ok: false, text: 'action', code: 'invalid' };
    return core.adminAction(action, adminFields(fields));
  });
  ipcMain.handle(SERVER.turnOn, (e) => (ok(e) ? core.turnOn() : undefined));
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
  ipcMain.handle(SERVER.logout, (e) => (ok(e) ? core.logout() : undefined));
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

  return {
    core,
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
  };
}
