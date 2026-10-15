// 페어리 서버 계정 (이슈 #99): server-core.ts 에 Electron 을 붙인다. 설정 창 IPC, 토큰 파일(safeStorage),
// 브라우저 열기, 몇 분마다 맞추기, 장부가 바뀌면 대기열에 넣기, 백업 되살리기 표시.
// 서버 주소(server-url.ts)가 비면 서버 기능이 모두 꺼진다: 칸이 숨고 어떤 요청도 나가지 않는다.
import { existsSync, rmSync } from 'node:fs';
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
import { spendRule } from '../shared/coin-rules.ts';
import type { Db } from '../shared/db-schema.ts';
import { isHouseStyle } from '../shared/house-art.ts';
import { t } from '../shared/i18n/index.ts';
import { SERVER, type ServerStatus } from '../shared/server-account.ts';
import { houseName, houseStyleName, type ItemStore, TOYS } from '../shared/shop.ts';
import { localDay, type TodoStore } from '../shared/todo-store.ts';
import { startLoopback } from './gcal-auth.ts';
import { osCrypto } from './os-crypto.ts';
import { secretFile } from './secret-file.ts';
import { serverApi } from './server-api.ts';
import { type Reverted, ServerCoins } from './server-coins.ts';
import { createServerCore } from './server-core.ts';
import { SERVER_RESTORE_MARK } from './server-mark.ts';
import { appServerUrl } from './server-url.ts';
import { readJson, writeJson } from './store.ts';

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
  log: (tag: string, ...rest: unknown[]) => void;
}) {
  const url = appServerUrl();
  const dir = app.getPath('userData');
  const secret = (name: string): { get(): string | undefined; set(v: string | null): void } => {
    const file = secretFile(join(dir, `${name}.json`), 'token', () => osCrypto);
    return {
      get: () => file.read(),
      set: (v) => (v === null ? file.remove() : file.write(v)),
    };
  };
  const core = createServerCore({
    api: url ? serverApi(url, (u, init) => net.fetch(u, init)) : undefined,
    coins: new ServerCoins(o.db, o.todos, o.shop, localDay),
    load: () => readJson(STATE),
    save: (s) => writeJson(STATE, s),
    device: secret('server-device'),
    session: secret('server-session'),
    loopback: (x) => startLoopback(x),
    openExternal: (u) => shell.openExternal(u),
    page: (ok) => ({
      title: t(ok ? 'server.page.okTitle' : 'server.page.failTitle'),
      body: t(ok ? 'server.page.okBody' : 'server.page.failBody'),
    }),
    now: Date.now,
    log: o.log,
    onChange: (s) => send(s),
    onCoins: o.onCoins,
    onReverted: (list: Reverted[]) => {
      const names = [...new Set(list.map((e) => revertedName(e.reason)))];
      o.onReverted(t('server.reverted', { what: names.join(', ') }));
    },
  });

  function send(s: ServerStatus) {
    const w = o.target();
    if (w && !w.isDestroyed()) w.webContents.send(SERVER.changed, s);
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
  ipcMain.handle(SERVER.status, (e) => (ok(e) ? core.status() : undefined));
  ipcMain.handle(SERVER.setAge, (e, age: unknown) => (ok(e) ? core.setAge(age) : undefined));
  ipcMain.handle(SERVER.turnOn, (e) => (ok(e) ? core.turnOn() : undefined));
  ipcMain.handle(SERVER.syncNow, async (e) => {
    if (!ok(e)) return undefined;
    await core.run();
    return core.status();
  });
  ipcMain.handle(SERVER.login, (e) => (ok(e) ? core.login() : undefined));
  ipcMain.on(SERVER.cancelLogin, (e) => {
    if (o.isSettings(e.sender)) core.cancelLogin();
  });
  ipcMain.handle(SERVER.logout, (e) => (ok(e) ? core.logout() : undefined));
  ipcMain.handle(SERVER.merge, (e, yes: unknown) => (ok(e) ? core.merge(yes === true) : undefined));
  ipcMain.handle(SERVER.remove, async (e) => (ok(e) ? core.remove() : { ok: false, status: undefined }));

  return {
    core,
    /** 서버 모드라 코인이 서버 정본을 따른다 (백업 되살리기 안내, 코인 초기화) */
    serverCoins: () => core.allowed(),
    beforeRestore: () => core.beforeRestore(),
  };
}
