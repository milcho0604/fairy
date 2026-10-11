// 짝꿍이 아는 것 (2026-10-11): 펫 우클릭 메뉴와 설정 AI 탭에서 여는 창, 그리고 알려 준 것(생일, 좋아하는 것)으로 하는
// AI 없는 한마디 (생일 인사는 그날 한 번, 좋아하는 것 한마디는 하루 한 번까지). 판단은 shared/knows.ts.
import { join } from 'node:path';
import { BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent, ipcMain, powerMonitor } from 'electron';
import { BOND, KNOWS_KEYS, type KnowsPatch, type KnowsSnapshot } from '../shared/bond-ipc.ts';
import { t } from '../shared/i18n/index.ts';
import type { ReactKind } from '../shared/ipc.ts';
import { factTalkHour, isBirthday, pickFactTalk } from '../shared/knows.ts';
import type { Settings } from '../shared/settings.ts';
import { localDay } from '../shared/todo-store.ts';
import { focusWindow, showWindow, stealFocus } from './focus.ts';
import { langArg } from './lang.ts';
import type { SayOptions } from './pet-window.ts';
import { settings } from './settings.ts';
import { readJson, writeJson } from './store.ts';
import { rememberBounds, savedBounds } from './window-bounds.ts';

const FILE = 'knows';
/** 알려 준 것 한마디를 볼 간격과, 켜고 나서 처음 볼 때 */
const CHECK_MS = 10 * 60_000;
const FIRST_MS = 3 * 60_000;
/** 좋아하는 것 한마디는 켜고 이만큼 지나서부터 (켜자마자 브리핑과 겹치지 않게) */
const TALK_AFTER_MS = 20 * 60_000;

export interface KnowsOptions {
  petName: () => string;
  say: (o: SayOptions) => Promise<string | undefined>;
  react: (kind?: ReactKind) => void;
  /** 숨거나 집중 중이 아니고 자리에 있는지 (말을 걸어도 되는지) */
  canTalk: () => boolean;
  log: (tag: string, ...rest: unknown[]) => void;
}

interface Said {
  /** 생일 인사를 한 날 */
  birthday?: string;
  /** 좋아하는 것 한마디를 한 날 */
  talk?: string;
}

const pick = (s: Settings): KnowsSnapshot['settings'] => ({
  petName: s.petName,
  petFacts: s.petFacts,
  petMemory: s.petMemory,
  petMemoryPending: s.petMemoryPending,
  petMemoryMeta: s.petMemoryMeta,
  petRules: s.petRules,
});

export function createKnows(o: KnowsOptions) {
  let win: BrowserWindow | undefined;
  const ours = (e: IpcMainEvent | IpcMainInvokeEvent) =>
    !!win && !win.isDestroyed() && e.sender === win.webContents;
  const raw = readJson(FILE);
  let said: Said = typeof raw === 'object' && raw !== null ? (raw as Said) : {};
  const save = () => {
    try {
      writeJson(FILE, said);
    } catch (err) {
      o.log('knows', '저장 실패', err instanceof Error ? err.message : String(err));
    }
  };

  ipcMain.on(BOND.openKnows, () => open());
  ipcMain.handle(BOND.knowsGet, (e): KnowsSnapshot | undefined =>
    ours(e) ? { settings: pick(settings.get()), platform: process.platform } : undefined,
  );
  ipcMain.handle(BOND.knowsSet, (e, patch: unknown) => {
    if (!ours(e) || typeof patch !== 'object' || patch === null) return undefined;
    // 이 창이 바꿀 수 있는 칸만 (다른 설정은 버린다)
    const p = patch as Record<string, unknown>;
    const allowed: KnowsPatch = Object.fromEntries(KNOWS_KEYS.filter((k) => k in p).map((k) => [k, p[k]]));
    return pick(settings.set(allowed));
  });
  settings.onChange((next, prev) => {
    if (!win || win.isDestroyed()) return;
    if (JSON.stringify(pick(next)) !== JSON.stringify(pick(prev)))
      win.webContents.send(BOND.knowsChanged, pick(next));
  });

  function open() {
    stealFocus();
    if (win && !win.isDestroyed()) {
      focusWindow(win);
      return;
    }
    const min = { width: 340, height: 440 };
    win = new BrowserWindow({
      width: 420,
      height: 620,
      ...savedBounds('knows', min),
      minWidth: min.width,
      minHeight: min.height,
      title: t('bond.knows.title', { name: o.petName() }),
      show: false,
      ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const } : {}),
      webPreferences: {
        preload: join(import.meta.dirname, '../preload/index.cjs'),
        additionalArguments: ['--jj-window=knows', langArg()],
        sandbox: true,
        contextIsolation: true,
      },
    });
    rememberBounds(win, 'knows', true);
    win.once('ready-to-show', () => showWindow(win));
    win.on('closed', () => {
      win = undefined;
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (ev) => ev.preventDefault());
    const devUrl = process.env.ELECTRON_RENDERER_URL;
    if (devUrl) win.loadURL(`${devUrl}/knows.html`);
    else win.loadFile(join(import.meta.dirname, '../renderer/knows.html'));
    o.log('knows', 'open');
  }

  // ---- AI 없이 하는 한마디 ----
  const started = Date.now();
  let talking = false;
  async function check(now = Date.now()) {
    if (talking || !o.canTalk()) return;
    const s = settings.get();
    const today = localDay(now);
    const name = o.petName();
    // 생일: 조용히여도 한다 (일 년에 한 번, 사용자가 알려 준 날). 보지 못하면 놓친 알림에 남는다
    if (isBirthday(s.petFacts, today) && said.birthday !== today) {
      said = { ...said, birthday: today };
      save();
      o.log('knows', '생일 인사');
      o.react('cheer');
      void o.say({
        kind: 'schedule',
        text: t('bond.fact.birthday', { name }),
        ttlMs: 12_000,
        hold: { missedMsgs: [{ key: 'bond.fact.birthday', vars: { name } }] },
      });
      return;
    }
    if (s.chatter === 'quiet' || said.talk === today || now - started < TALK_AFTER_MS) return;
    if (!factTalkHour(new Date(now).getHours()) || powerMonitor.getSystemIdleTime() > 60) return;
    // 같은 때마다 하지 않게 볼 때마다 세 번에 한 번쯤
    if (Math.random() > 0.35) return;
    const f = pickFactTalk(s.petFacts);
    if (!f) return;
    talking = true;
    const key =
      f.kind === 'food'
        ? f.variant === 1
          ? 'bond.fact.food.1'
          : 'bond.fact.food.2'
        : f.variant === 1
          ? 'bond.fact.like.1'
          : 'bond.fact.like.2';
    const shown = await o.say({ kind: 'system', text: t(key, { name, value: f.value }), ttlMs: 7000 });
    talking = false;
    // 수다 빈도에 막혔으면(undefined) 다음에 다시
    if (shown === undefined) return;
    said = { ...said, talk: today };
    save();
    o.log('knows', '좋아하는 것 한마디', f.kind);
  }
  const timer = setInterval(() => void check(), CHECK_MS);
  timer.unref();
  setTimeout(() => void check(), FIRST_MS).unref();

  return {
    open,
    check,
    get window() {
      return win;
    },
    stop: () => clearInterval(timer),
  };
}
