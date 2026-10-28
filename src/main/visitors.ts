// 놀러 온 친구 펫 (이슈 #141 2부). 서로 켠 친구의 펫 카드(종류 id, 이름, 네 발 서기)를 서버에서 받아, 이 앱에 든 같은 그림으로
// 손님 펫 창을 잠깐 띄운다. 실시간 연결은 없고 서버는 방문이 있었는지 모른다 (언제 올지는 이 컴퓨터가 정한다).
// - 판단(상한, 쉬는 시간, 미룸 까닭)은 shared/visit-plan.ts, 카드를 모습으로 바꾸는 것은 shared/pet-card-of.ts.
// - 손님 창은 기본 펫 화면과 같은 렌더러에서 연 별도 창이다 (openPetWindowIn). 설정의 "친구 페어리"(friends.ts)와 따로다:
//   설정에 저장하지 않고, 자리 파일도 만들지 않는다 (ghost). 마우스는 늘 통과시키고 포커스를 가져오지 않는다.
// - 와 있는 동안 2초마다 기본 펫이 바빠졌는지 보고(숨김, 집중, 놀이, 자리 비움, 절전), 1분마다 친구가 아직 허락하는지 서버에 다시
//   묻는다. 끄기, 끊기, 차단, 나이 변경으로 목록에서 빠지면 1분 안에 돌려보낸다. 서버가 꺼졌거나 막혔으면 쫓아내지 않고 조용히 둔다.
import { join } from 'node:path';
import { app, type BrowserWindow, ipcMain, type MenuItemConstructorOptions, screen } from 'electron';
import { t } from '../shared/i18n/index.ts';
import { IPC, type PetImages, type PetStatus } from '../shared/ipc.ts';
import { meetPlan } from '../shared/meet.ts';
import { lookOf, type VisitorLook } from '../shared/pet-card-of.ts';
import { starterModelOf } from '../shared/pet3d/starters.ts';
import { friendSpot } from '../shared/placement.ts';
import { FRIENDS, type VisitInfo, type VisitorCard } from '../shared/server-friends.ts';
import { starterFileName } from '../shared/starter-pets.ts';
import { localDay } from '../shared/todo-store.ts';
import {
  decide,
  deferReason,
  interruptReason,
  parseState,
  recordVisit,
  setPaused,
  VISIT,
  type VisitFacts,
  type VisitState,
} from '../shared/visit-plan.ts';
import type { WearLook } from '../shared/wear.ts';
import { saverNow } from './battery.ts';
import { boostOn } from './boost.ts';
import { createPetWindow, openPetWindowIn, type PetActions, type PetWindow } from './pet-window.ts';
import type { ServerFriends } from './server-friends.ts';
import { settings } from './settings.ts';
import { readStarter, readStarterWalk } from './starter-copy.ts';
import { readJson, removeJson, writeJson } from './store.ts';

const FILE = 'friend-visit';
/** 손님 펫 창 크기 (pet-window 의 기본 크기, 배율 1. friends.ts FRIEND_SIZE 와 같다) */
const SIZE = 160;
/** 펫 화면이 다 불러오기를 기다리는 시간 */
const LOAD_WAIT_MS = 8000;
/** 화면 가장자리로 걸어 나가는 데 주는 시간 */
const LEAVE_WAIT_MS = 15_000;

const noop = () => {};
/** 손님은 대화, 같이 보기, 할 일, 놀이를 맡지 않는다 (마우스도 닿지 않는다) */
const ACTIONS: PetActions = {
  click: noop,
  openChat: noop,
  lookTogether: noop,
  openSettings: noop,
  quickAdd: noop,
  feed: noop,
  makePet: noop,
  focusRunning: () => false,
  toggleFocus: noop,
  petted: noop,
  play: noop,
  toy: () => undefined,
  openShop: noop,
} as PetActions;

interface Live {
  id: string;
  code: string;
  ac: AbortController;
  pet?: PetWindow;
}

export interface VisitorsOptions {
  mainPet: () => PetWindow;
  friends: ServerFriends;
  /** 설정의 친구 페어리 수 (손님이 설 자리를 겹치지 않게) */
  friendCount: () => number;
  /** 집중 타이머 중, 공놀이와 산책 중, 숨바꼭질 중 */
  busy: () => { focus: boolean; playing: boolean; seeking: boolean };
  /** 마지막 입력 뒤 지난 초 (powerMonitor.getSystemIdleTime) */
  awaySec: () => number;
  /** [from, to) 에 시각 일정이 있나 (회의 대용) */
  eventBetween: (from: number, to: number) => boolean;
  wear?: () => WearLook;
  /** 설정 창에서 온 요청인가 */
  isSettings: (wc: Electron.WebContents) => boolean;
  log: (tag: string, ...rest: unknown[]) => void;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** p 를 기다리되 signal 이 끊기면 false. 시간 안에 안 끝나도 false */
function until(p: Promise<unknown>, signal: AbortSignal, ms = 60_000): Promise<boolean> {
  return new Promise((resolve) => {
    const done = (v: boolean) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      resolve(v);
    };
    const onAbort = () => done(false);
    const timer = setTimeout(() => done(false), ms);
    if (signal.aborted) return done(false);
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(
      (v) => done(v !== false),
      () => done(false),
    );
  });
}

export function createVisitors(o: VisitorsOptions) {
  let state: VisitState = parseState(readJson(FILE), localDay(Date.now()));
  let cur: Live | null = null;
  /** 손님을 부르려고 서버에 묻는 중 (그사이 다음 차례가 겹치지 않게) */
  let starting = false;
  let seq = 0;
  /** 개발용: 자리 비움 초를 고정한다 (시험 컴퓨터는 진짜 입력이 없어도 사람이 쓰고 있을 수 있다) */
  let awayFixed: number | undefined;
  /** 개발용: 손님 펫 화면이 컴퓨터 바쁨, 졸음으로 걷기를 거절하지 않게 입력을 고요하게 고정한다 (시험 컴퓨터는 늘 바쁠 수 있다) */
  let calm = false;
  /** 개발용: 마지막 손님을 어떤 모습으로 그렸나 */
  let lastLook: (VisitorLook & { species: string; name: string | null }) | undefined;
  const away = () => awayFixed ?? o.awaySec();

  const save = () => {
    try {
      writeJson(FILE, state);
    } catch (err) {
      o.log('visit', '기록 저장 실패', err instanceof Error ? err.message : String(err));
    }
  };

  const infoOf = (): VisitInfo => {
    const today = localDay(Date.now());
    state = parseState(state, today);
    return { today: state.count, max: VISIT.dayMax, paused: state.pausedDay === today };
  };

  function facts(now: number): VisitFacts {
    const b = o.busy();
    const main = o.mainPet();
    return {
      today: localDay(now),
      now,
      serverOk: !o.friends.visitQuiet(),
      hidden: main.isHidden(),
      focus: b.focus,
      playing: b.playing,
      seeking: b.seeking,
      awaySec: away(),
      saver: saverNow(),
      eventSoon: o.eventBetween(now, now + VISIT.soonMs),
      mainIdle: main.isIdle(),
      present: cur !== null || starting,
    };
  }

  function statusOf(look: VisitorLook, stand: boolean): PetStatus {
    return {
      hungry: false,
      focus: false,
      sulk: 0,
      kind: look.kind,
      pet3d: settings.get().pet3d,
      style: settings.get().petStyle,
      cushion: false,
      flower: false,
      sounds: false,
      boost: boostOn(),
      saver: saverNow(),
      ...(stand && look.starter ? { stand: true } : {}),
      ...(o.wear ? { wear: o.wear() } : {}),
    };
  }

  /** 앱에 든 밀크, 초코 그림으로 그린다. 읽지 못하면 기본 펫 모양으로 (대역) */
  function imagesOf(look: VisitorLook, stand: boolean): PetImages {
    const none: PetImages = { main: null, model: null, depth: null, poses: {} };
    if (!look.starter) return none;
    const dir = join(app.getAppPath(), 'resources', 'pets');
    const png = readStarter(dir, look.starter);
    if (!png) return none;
    const walk = readStarterWalk(dir, look.starter).map(
      (b) => `data:image/webp;base64,${b.toString('base64')}`,
    );
    return {
      main: `data:image/png;base64,${png.toString('base64')}`,
      model: stand ? starterModelOf(starterFileName(look.starter, 0)) : null,
      depth: null,
      poses: {},
      starter: look.starter,
      ...(walk.length > 0 ? { walk } : {}),
    };
  }

  function loaded(win: BrowserWindow, signal: AbortSignal): Promise<boolean> {
    return until(
      new Promise<void>((resolve) => {
        if (!win.webContents.isLoading() && win.webContents.getURL()) return resolve();
        win.webContents.once('did-finish-load', () => resolve());
      }),
      signal,
      LOAD_WAIT_MS,
    );
  }

  function hello(v: VisitorCard): string {
    const keys = ['friends.visitHello.1', 'friends.visitHello.2', 'friends.visitHello.3'] as const;
    const key = keys[Math.floor(Math.random() * keys.length)] ?? keys[0];
    return t(key, {
      friend: v.nickname ?? t('friends.visitSomeone'),
      pet: v.pet.name ?? t('friends.visitNameless'),
    });
  }

  /** x 까지 걷는다. 걷기가 끊기면(펫 화면이 활동을 바꿨다) 돌려보낸 게 아닌 한 몇 번 다시 시도한다 */
  async function walk(pet: PetWindow, x: number, signal: AbortSignal, ms = 60_000): Promise<boolean> {
    for (let i = 0; i < 4; i++) {
      if (signal.aborted || pet.win.isDestroyed()) return false;
      if (await until(pet.walkTo(x), signal, ms)) return true;
      await until(sleep(700), signal, 1500);
    }
    return false;
  }

  /** 손님 한 마리가 와서 머물고 간다 */
  async function run(v: VisitorCard): Promise<void> {
    const main = o.mainPet();
    const live: Live = { id: `v-${++seq}`, code: v.code, ac: new AbortController() };
    cur = live;
    starting = false;
    let watch: NodeJS.Timeout | undefined;
    const { signal } = live.ac;
    try {
      const mb = main.bounds();
      const area = screen.getDisplayMatching(mb).workArea;
      // 기본 펫에서 먼 쪽 화면 가장자리에서 걸어 들어온다. 설 자리는 기본 펫 옆 바닥 (친구 페어리 자리 다음)
      const fromLeft = mb.x + mb.width / 2 > area.x + area.width / 2;
      const edgeX = fromLeft ? area.x : area.x + area.width - SIZE;
      const spot = friendSpot(mb, o.friendCount(), SIZE, area);
      const plan = meetPlan(mb, { x: spot.x, y: spot.y, width: SIZE, height: SIZE }, true, area);
      if (!plan) {
        o.log('visit', '설 자리가 없어 미룸', v.code);
        return;
      }
      const look = lookOf(v.pet.species);
      lastLook = { ...look, species: v.pet.species, name: v.pet.name };
      const stand = v.pet.stand;
      const win = await openPetWindowIn(main.win.webContents);
      if (signal.aborted) {
        win?.destroy();
        return;
      }
      const name = v.pet.name ?? t('friends.visitNameless');
      const pet = createPetWindow({
        ...(win ? { win } : {}),
        id: live.id,
        ghost: true,
        initial: { x: edgeX, y: spot.y },
        petName: () => name,
        log: o.log,
        actions: ACTIONS,
      });
      live.pet = pet;
      const send = () => {
        if (pet.win.isDestroyed()) return;
        pet.win.webContents.send(IPC.status, statusOf(look, stand));
        pet.win.webContents.send(IPC.image, imagesOf(look, stand));
      };
      // 개발용 calm: 컴퓨터 바쁨, 졸음 소식(IPC.env)이 오면 펫 화면이 걷기를 멈추니, 이 손님 창에는 그 소식을 보내지 않는다
      if (calm) {
        const wc = pet.win.webContents;
        const orig = wc.send.bind(wc);
        wc.send = ((channel: string, ...args: unknown[]) =>
          channel === IPC.env ? undefined : orig(channel, ...args)) as typeof wc.send;
        void wc
          .executeJavaScript('window.__pet?.setInputs({ systemBusy: false, userIdleMs: 0 })')
          .catch(() => undefined);
      }
      pet.win.webContents.on('did-finish-load', send);
      if (!(await loaded(pet.win, signal))) return;
      send();

      // 와 있는 동안 계속 따진다: 바빠지면 바로, 친구가 거둔 건 1분 안에
      let lastRecheck = Date.now();
      let rechecking = false;
      watch = setInterval(() => {
        const now = Date.now();
        const why = interruptReason({
          hidden: main.isHidden(),
          focus: o.busy().focus,
          playing: o.busy().playing,
          seeking: o.busy().seeking,
          awaySec: away(),
          saver: saverNow(),
        });
        if (why) return dismiss(why);
        if (!rechecking && now - lastRecheck >= VISIT.recheckMs) {
          rechecking = true;
          lastRecheck = now;
          void o.friends
            .visitors()
            .then((cards) => {
              // 못 받았으면(오프라인, 막힘) 쫓아내지 않는다. 받았는데 목록에 없으면 허락이 거둬진 것
              if (cards && !cards.some((c) => c.code === live.code)) dismiss('revoked');
            })
            .finally(() => {
              rechecking = false;
            });
        }
      }, VISIT.watchMs);
      watch.unref?.();

      const startedAt = Date.now();
      // 펫 화면이 상태와 그림을 받아 자리를 잡는 동안 걷기가 끊길 수 있어 조금 기다렸다 걷고, 끊기면 몇 번 다시 걷는다
      await until(sleep(1200), signal, 2000);
      if (!(await walk(pet, plan.x, signal))) {
        o.log('visit', '걸어 들어오다 끊김', v.code, signal.aborted ? '돌려보냄' : '걷기 실패');
        return;
      }
      // 기본 펫이 걷는 중이면 멈추기를 조금 기다린다. 끝내 바쁘면 인사 없이 곁에서 같이 지낸다
      for (let i = 0; i < 15 && !main.isIdle() && !main.isHidden() && !signal.aborted; i++)
        await until(sleep(1000), signal, 2000);
      if (signal.aborted || main.isHidden()) return;
      if (main.isIdle()) {
        main.greet(plan.mainDir);
        pet.greet(plan.friendDir);
      }
      state = recordVisit(state, v.code, Date.now(), localDay(Date.now()));
      save();
      o.log('visit', '왔어', v.code);
      if (settings.get().chatter !== 'quiet')
        void pet.say({ kind: 'idle-talk', text: hello(v), ttlMs: 3500 });
      // 같이 걷다가
      void pet.stroll(1);
      while (!signal.aborted && Date.now() - startedAt < VISIT.lengthMs - 8000)
        await until(sleep(1000), signal, 2000);
      if (signal.aborted) return;
      // 화면 가장자리로 걸어 나간다
      await walk(pet, edgeX, signal, LEAVE_WAIT_MS);
      o.log('visit', '갔어', v.code);
    } catch (err) {
      o.log('visit', '손님 오류', err instanceof Error ? err.message : String(err));
    } finally {
      clearInterval(watch);
      starting = false;
      live.ac.abort();
      if (live.pet && !live.pet.win.isDestroyed()) live.pet.win.destroy();
      removeJson(`pet-position-${live.id}`);
      if (cur === live) cur = null;
    }
  }

  /** 지금 와 있는 손님을 바로 돌려보낸다 (창을 닫는다) */
  function dismiss(reason: string): void {
    const live = cur;
    if (!live) return;
    o.log('visit', '돌려보냄', reason, live.code);
    live.ac.abort();
    if (live.pet && !live.pet.win.isDestroyed()) live.pet.win.destroy();
  }

  /**
   * 한 차례: 부를 수 있는 때인지 보고, 서로 켠 친구가 있으면 카드를 받아 한 명을 정한다.
   * 서버가 꺼졌거나 막혔으면 조용히 넘어간다. force 는 확률만 건너뛴다 (개발용 손잡이)
   */
  async function tick(force = false): Promise<{ went: boolean; reason?: string }> {
    const now = Date.now();
    const today = localDay(now);
    state = parseState(state, today);
    const f = facts(now);
    const why = deferReason(state, f);
    if (why) return { went: false, reason: why };
    if (!o.friends.mutualVisit()) return { went: false, reason: 'friend' };
    starting = true;
    try {
      const cards = await o.friends.visitors();
      if (!cards) return { went: false, reason: 'server' };
      const now2 = Date.now();
      const d = decide(state, { ...facts(now2), present: false }, cards, Math.random, force);
      if (!d.go) return { went: false, reason: d.reason };
      void run(d.visitor);
      return { went: true };
    } finally {
      // run 이 cur 를 잡았으면 starting 은 run 이 내린다. 못 불렀으면 여기서
      if (!cur) starting = false;
    }
  }

  const timer = setInterval(
    () => void tick().catch((err) => o.log('visit', '오류', String(err))),
    VISIT.tickMs,
  );
  timer.unref();

  ipcMain.handle(FRIENDS.visitInfo, (e) => (o.isSettings(e.sender) ? infoOf() : undefined));
  ipcMain.handle(FRIENDS.visitPause, (e, on: unknown) => {
    if (!o.isSettings(e.sender) || typeof on !== 'boolean') return undefined;
    pause(on);
    return infoOf();
  });

  /** "오늘은 그만": 그 날이 끝날 때까지 손님을 안 받고, 와 있는 손님은 돌려보낸다 */
  function pause(on: boolean): void {
    state = setPaused(parseState(state, localDay(Date.now())), on, localDay(Date.now()));
    save();
    if (on) dismiss('paused');
    o.log('visit', on ? '오늘은 그만' : '다시 받음');
  }

  return {
    tick,
    dismiss,
    pause,
    info: infoOf,
    /** 지금 떠 있는 손님 펫 창 (같이 보기가 찍는 순간 같이 가린다) */
    pets: (): PetWindow[] => (cur?.pet ? [cur.pet] : []),
    present: (): boolean => cur !== null,
    /** 펫 우클릭 메뉴와 트레이에 넣을 항목. 펫 놀러 가기가 꺼졌으면 비어 있다 */
    menuItems(): MenuItemConstructorOptions[] {
      if (!o.friends.state().visit) return [];
      const paused = infoOf().paused;
      return [
        ...(cur
          ? [
              {
                label: t('friends.visitSendBack'),
                click: () => dismiss('menu'),
              } as MenuItemConstructorOptions,
            ]
          : []),
        {
          label: paused ? t('friends.visitResume') : t('friends.visitPause'),
          click: () => pause(!paused),
        },
      ];
    },
    /** 개발용: 상태 읽고 쓰기 (시험이 날짜, 상한, 쉬는 시간을 만든다) */
    debugState: () => ({ ...state, present: cur !== null, look: lastLook }),
    debugAway: (sec: number | undefined) => {
      awayFixed = sec;
    },
    debugBounds: () => cur?.pet?.bounds(),
    debugCalm: (on: boolean) => {
      calm = on;
    },
    debugSetState: (patch: Partial<VisitState>) => {
      state = { ...state, ...patch };
    },
    stop() {
      clearInterval(timer);
      dismiss('stop');
      ipcMain.removeHandler(FRIENDS.visitInfo);
      ipcMain.removeHandler(FRIENDS.visitPause);
    },
  };
}

export type Visitors = ReturnType<typeof createVisitors>;
