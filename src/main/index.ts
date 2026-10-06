import { join } from 'node:path';
import { app, globalShortcut, powerMonitor, screen } from 'electron';
import { ACHIEVEMENTS } from '../shared/achieve.ts';
import { todoContext } from '../shared/ai/persona.ts';
import { timeLabel } from '../shared/event-store.ts';
import { HIDE_SEEK, pickHideSpot } from '../shared/hide-seek.ts';
import { IPC, type PetStatus, type PlayKind } from '../shared/ipc.ts';
import { FULLNESS, localDay } from '../shared/todo-store.ts';
import { mcpServers, refreshMcpServers } from './ai/mcp-list.ts';
import { applyPendingImport, createBackup, exportPet, importPet } from './backup.ts';
import { watchBetaStats } from './beta.ts';
import { watchCalendar } from './calendar.ts';
import { createChat } from './chat.ts';
import { openStore } from './db.ts';
import { createFriends } from './friends.ts';
import { createLookTogether } from './look-together.ts';
import { createMaker, foodImageDataUrl, petImages, registerModelScheme, removeFoodImage } from './maker.ts';
import { createOnboarding } from './onboarding.ts';
import { createPanel } from './panel.ts';
import { createPetLife } from './pet-life.ts';
import { createPetWindow } from './pet-window.ts';
import { createPlanner, minuteOfDay, startOfDay } from './planner.ts';
import { createHouse, playBall } from './play.ts';
import { watchPresentation } from './presence-watch.ts';
import { settings } from './settings.ts';
import { createSettingsWindow } from './settings-window.ts';
import { createTray } from './tray.ts';
import { watchUpdates } from './update.ts';

// 데이터 폴더를 이름으로 고정한다. 기본값은 앱 이름을 따라가서 설치판(Jjakkung)과 개발판(jjakkung)이
// 운영체제에 따라 다른 폴더가 되고, 나중에 앱 이름을 바꿔도 데이터를 잃는다.
// 하나만 띄우기 잠금도 이 폴더에 있어 다른 무엇보다 먼저 정한다.
// JJ_USER_DATA 는 시험용: 설치판을 실제 데이터와 잠금을 건드리지 않고 따로 띄울 때 쓴다.
app.setPath('userData', process.env.JJ_USER_DATA || join(app.getPath('appData'), 'jjakkung'));

const log = (tag: string, ...rest: unknown[]) => {
  if (!app.isPackaged) console.log(`[${tag}]`, ...rest);
};

// GPU 를 별도 프로세스 대신 본체 안에서 돌린다. 프로세스가 하나 줄어 메모리가 363MB 에서 306MB 로
// 줄었고 CPU 는 같았다 (2026-10-02 맥 측정, L12). 문제가 생기면 JJ_GPU_PROCESS=1 로 끈다.
if (!process.env.JJ_GPU_PROCESS) app.commandLine.appendSwitch('in-process-gpu');

registerModelScheme();

// 펫은 하나만 띄운다. 두 번째로 실행하면 그냥 끝난다.
if (!app.requestSingleInstanceLock()) app.quit();

app.whenReady().then(() => {
  // 가져온 백업 저장 파일이 기다리면 저장 파일을 열기 전에 바꿔 끼운다 (v2)
  applyPendingImport();
  // 펫 앱은 Dock 아이콘 없이 뜬다. 끝내기는 펫 우클릭 메뉴나 메뉴 막대 아이콘에서 한다.
  if (process.platform === 'darwin') app.dock?.hide();
  // 펫 이름은 설정에서 바꿀 수 있어 쓰는 곳마다 지금 값을 읽는다.
  const petName = () => settings.get().petName;
  const chat = createChat({
    petName,
    aiIsolation: () => settings.get().aiIsolation,
    personaId: () => settings.get().persona,
    knowsTodos: () => settings.get().aiKnowsTodos,
    setKnowsTodos: (on) => settings.set({ aiKnowsTodos: on }),
    // 질문 앞에 붙일 내 오늘 상황: 안 끝낸 할 일 제목과 마감, 오늘 남은 일정 (기획서 개인정보 표)
    todoContext: () => {
      const now = Date.now();
      return todoContext({
        today: localDay(now),
        todos: store.list(now).open,
        events: events
          .between(now, startOfDay(now) + 86_400_000)
          .map((e) => ({ time: timeLabel(minuteOfDay(e.startAt)), title: e.title })),
      });
    },
    saveNote: (title, body) => {
      notes.add({ title, body, source: 'ai' }, Date.now());
      panel.refresh();
    },
    mcpServers: () => (settings.get().myMcp ? mcpServers(log) : []),
    addTodos: (titles) => {
      const now = Date.now();
      for (const title of titles) store.add({ title }, now);
      panel.refresh();
      return titles.length;
    },
    onPetAi: (state) => {
      if (state.thinking) petLife.activity('chat');
      pet.win.webContents.send(IPC.ai, state);
    },
    // 채팅 창을 닫았거나 다른 앱을 보는 중이면 펫이 답이 왔다고 알린다.
    onAnswer: async (text, chatInFront) => {
      if (chatInFront) return;
      const action = await pet.say({
        kind: 'answer',
        text: `답 왔어: ${preview(text)}`,
        buttons: [
          { id: 'open', label: '보기' },
          { id: 'later', label: '나중에' },
        ],
      });
      if (action === 'open' || action === 'dismiss') chat.open(pet.bounds());
    },
    log,
  });
  const pet = createPetWindow({
    petName,
    actions: {
      // 왼쪽 클릭은 패널(할 일, 코인, 밥). 대화는 패널 안과 우클릭 메뉴에서.
      click: () => {
        // 숨바꼭질 중이면 찾은 것
        if (seeking) {
          seeking.done(true);
          return;
        }
        petLife.activity('click');
        panel.togglePanel();
      },
      openChat: (bounds) => chat.open(bounds),
      lookTogether: () => look.start(),
      openSettings: () => settingsWindow.open(),
      quickAdd: () => panel.openQuick(),
      feed: () => feedPet(),
      makePet: () => maker.open(),
      petted: () => petLife.activity('pet'),
      play: (kind) => void play(kind),
      toy: () => (shop.owns('yarn') ? '털실' : shop.owns('ball') ? '공' : undefined),
      openShop: () => panel.openTab('shop'),
      focusRunning: () => planner.focus.phase !== 'idle',
      toggleFocus: () => (planner.focus.phase === 'idle' ? planner.startFocus() : planner.stopFocus()),
    },
    log,
  });
  const look = createLookTogether({
    petName,
    hideOwnWindows: () => {
      const chatWin = chat.window;
      const chatWasVisible = !!chatWin && !chatWin.isDestroyed() && chatWin.isVisible();
      pet.win.hide();
      if (chatWasVisible) chatWin?.hide();
      return () => {
        if (!pet.win.isDestroyed()) pet.win.showInactive();
        if (chatWasVisible && chatWin && !chatWin.isDestroyed()) chatWin.show();
      };
    },
    onImage: (image) => {
      stats.countLook(Date.now());
      chat.attach(image, pet.bounds());
    },
    log,
  });
  // ---- 방해 금지 (P1-10) ----
  // 친구 펫(v2)도 기본 펫과 같이 숨고 나온다
  const friends = createFriends({ mainPet: () => pet, log });
  const toggleHidden = () => {
    const on = !pet.isHidden('user');
    pet.setHidden('user', on);
    friends.setHidden('user', on);
  };
  // 숨기기 단축키는 숨은 펫을 다시 부르는 길이라 늘 걸어 둔다. 다른 앱과 겹치지 않게 네 키 조합.
  const tray = createTray(petName, {
    toggleHidden,
    isHidden: () => pet.isHidden('user'),
    openChat: () => chat.open(pet.bounds()),
    openSettings: () => settingsWindow.open(),
    sendFeedback: () => settingsWindow.open('stats'),
    quickAdd: () => panel.openQuick(),
  });
  // ---- 할 일과 코인 (2단계) ----
  const { store, stats, notes, events, life, shop, achievements, vacuumInto, dataVersion } = openStore(log);
  // ---- 펫의 하루: 삐짐, 기분, 친밀도 (v1) ----
  const petLife = createPetLife({
    life,
    todos: store,
    petName,
    say: (o) => pet.say(o),
    petHidden: () => pet.isHidden(),
    react: () => pet.react(),
    onChange: () => {
      sendStatus();
      panel.refresh();
    },
    stroll: (min) => play('walk', min),
    log,
  });

  // ---- 놀이와 집 (v1) ----
  const house = createHouse();
  let playing = false;
  /** 공놀이(공이나 털실이 있어야), 산책. 노는 중이면 무시 */
  async function play(kind: PlayKind, walkMin = 5): Promise<boolean> {
    if (playing || pet.isHidden()) return false;
    const toy = shop.owns('yarn') ? 'yarn' : shop.owns('ball') ? 'ball' : undefined;
    if (kind === 'seek') return seek();
    if (kind === 'ball' && !toy) {
      void pet.say({ kind: 'answer', text: '공이 없어. 상점에서 공을 사 주면 같이 놀자!', ttlMs: 5000 });
      return false;
    }
    playing = true;
    try {
      if (kind === 'ball') {
        const ok = await playBall(pet, toy === 'yarn');
        if (ok) {
          petLife.activity('play');
          if (toy === 'yarn') petLife.activity('play'); // 털실은 더 신난다
          pet.react();
        }
        return ok;
      }
      void pet.say({ kind: 'answer', text: '산책 가자!', ttlMs: 2000 });
      await new Promise((r) => setTimeout(r, 2200));
      const started = Date.now();
      const ok = await pet.stroll(walkMin);
      const minutes = Math.round((Date.now() - started) / 60_000);
      stats.addWalk(Date.now(), minutes);
      if (minutes > 0) petLife.activity('play');
      if (ok) void pet.say({ kind: 'answer', text: '산책 즐거웠어!', ttlMs: 4000 });
      return ok;
    } finally {
      playing = false;
    }
  }
  // ---- 숨바꼭질 (v2 미니 게임) ----
  let seeking:
    | { home: { x: number; y: number }; timer: NodeJS.Timeout; done: (found: boolean) => void }
    | undefined;
  async function seek(): Promise<boolean> {
    void pet.say({
      kind: 'answer',
      text: `숨바꼭질 하자! ${HIDE_SEEK.seconds}초 안에 나를 찾아 눌러 줘.`,
      ttlMs: 2500,
    });
    await new Promise((r) => setTimeout(r, 2800));
    const home = { x: pet.bounds().x, y: pet.bounds().y };
    const spot = pickHideSpot(
      pet.bounds(),
      screen.getAllDisplays().map((d) => d.workArea),
      Math.random,
    );
    if (!spot) return false;
    pet.peekAt(spot.x, spot.y);
    const found = await new Promise<boolean>((resolve) => {
      seeking = {
        home,
        timer: setTimeout(() => resolve(false), HIDE_SEEK.seconds * 1000),
        done: resolve,
      };
    });
    if (seeking) clearTimeout(seeking.timer);
    seeking = undefined;
    pet.comeBack(home);
    const now = Date.now();
    if (found) {
      const today = localDay(now);
      const won = store.coinCount('hide-seek', today);
      const coins = won < HIDE_SEEK.dailyLimit ? HIDE_SEEK.coins : 0;
      if (coins) store.reward(coins, 'hide-seek', now);
      petLife.activity('play');
      pet.react();
      void pet.say({
        kind: 'answer',
        text: coins ? `찾았다! 코인 ${coins}개.` : '찾았다! 재밌었어.',
        ttlMs: 4000,
      });
    } else {
      void pet.say({ kind: 'answer', text: '못 찾았지! 다음엔 찾아 봐.', ttlMs: 4000 });
    }
    panel.refresh();
    return found;
  }

  // ---- 업적 (v2) ----
  function checkAchievements() {
    const s = settings.get();
    const facts = achievements.facts(Date.now(), s.restDays, {
      affection: petLife.state.affection,
      houseLevel: shop.state().houseLevel,
    });
    for (const a of achievements.check(facts, Date.now())) {
      log('achieve', a.key);
      void pet.say({ kind: 'system', text: `업적 달성: ${a.name} (${a.hint})`, ttlMs: 6000 });
    }
  }
  setInterval(checkAchievements, 60_000).unref();
  setTimeout(checkAchievements, 8000).unref();

  // ---- 캘린더 가져오기, 백업 (v2) ----
  const calendar = watchCalendar({
    events,
    onChanged: () => {
      panel.refresh();
      planner.check();
    },
    log,
  });
  const backup = createBackup({ vacuumInto, log });
  // 펫 MCP 서버(다른 프로세스)가 할 일, 메모, 일정을 넣으면 저장 파일 판 번호가 바뀐다. 3초마다 보고 다시 그린다.
  let seenVersion = dataVersion();
  setInterval(() => {
    const v = dataVersion();
    if (v === seenVersion) return;
    seenVersion = v;
    log('db', '다른 곳에서 바뀜 (MCP)');
    panel.refresh();
    planner.check();
  }, 3000).unref();
  watchBetaStats(stats, () => pet.isHidden('user'), log);
  // ---- 일정 알림, 오늘 브리핑, 집중 타이머 (v1) ----
  const planner = createPlanner({
    todos: store,
    events,
    stats,
    say: (o) => pet.say(o),
    petHidden: () => pet.isHidden(),
    onReward: () => pet.react(),
    onChange: () => {
      panel.refresh();
      sendStatus();
    },
    log,
  });
  const panel = createPanel({
    store,
    notes,
    events,
    focus: () => planner.focus,
    startFocus: () => planner.startFocus(),
    stopFocus: () => planner.stopFocus(),
    onEventsChanged: () => planner.check(),
    askAi: (prompt) => chat.askInWindow(prompt, pet.bounds()),
    life: () => {
      const l = petLife.state;
      return { sulk: l.sulk, mood: Math.round(l.mood), affection: l.affection };
    },
    shop,
    foodImage: (file) => foodImageDataUrl(file),
    onFedWith: (food) => {
      pet.react();
      petLife.activity('feed');
      const image = food.image ? foodImageDataUrl(food.image) : undefined;
      void pet.say({ kind: 'answer', text: `${food.name} 냠냠, 고마워!`, ttlMs: 3500, image });
      sendStatus();
    },
    openFoodMaker: () => maker.open('food'),
    removeFoodImage,
    onHouseChanged: () => {
      house.show(shop.state().houseLevel, pet.bounds());
      void pet.say({ kind: 'answer', text: '새 집이다! 고마워.', ttlMs: 4000 });
    },
    play: (kind) => void play(kind),
    achieve: () => {
      const now = Date.now();
      const got = achievements.got();
      const streakDays = achievements.facts(now, settings.get().restDays, {
        affection: 0,
        houseLevel: 0,
      }).streak;
      const list = ACHIEVEMENTS.filter((a) => got.has(a.key)).map(({ key, name, hint }) => ({
        key,
        name,
        hint,
      }));
      const next = ACHIEVEMENTS.find((a) => !got.has(a.key));
      return {
        streak: streakDays,
        got: list,
        total: ACHIEVEMENTS.length,
        ...(next ? { next: { name: next.name, hint: next.hint } } : {}),
      };
    },
    petName,
    petBounds: () => pet.bounds(),
    onCompleted: () => {
      pet.react();
      petLife.activity('todo');
    },
    onFed: () => {
      pet.react();
      petLife.activity('feed');
      void pet.say({ kind: 'answer', text: '냠냠, 고마워!', ttlMs: 3000 });
    },
    onChanged: () => sendStatus(),
    openChat: () => chat.open(pet.bounds()),
    lookTogether: () => look.start(),
    log,
  });
  /** 패널 밖(펫 우클릭)에서 밥 주기 */
  function feedPet() {
    const r = store.feed(Date.now());
    if (r.ok) {
      pet.react();
      petLife.activity('feed');
      void pet.say({ kind: 'answer', text: '냠냠, 고마워!', ttlMs: 3000 });
    } else {
      void pet.say({ kind: 'answer', text: '코인이 모자라. 할 일을 하나 끝내면 생겨.', ttlMs: 4000 });
    }
    panel.refresh();
  }
  // 펫 표정에 쓰는 상태: 배고픔(배부름은 시간이 흐르면 준다, 5분마다 본다), 집중 중(잠).
  let lastStatus = '';
  function sendStatus() {
    const status: PetStatus = {
      hungry: store.fullness(Date.now()) < FULLNESS.hungry,
      focus: planner.focus.phase === 'focus',
      sulk: petLife.state.sulk,
      kind: settings.get().petKind,
      cushion: shop.owns('cushion'),
    };
    const key = JSON.stringify(status);
    if (key === lastStatus || pet.win.isDestroyed()) return;
    lastStatus = key;
    pet.win.webContents.send(IPC.status, status);
  }
  pet.win.webContents.on('did-finish-load', () => {
    lastStatus = '';
    sendStatus();
  });
  setInterval(sendStatus, 5 * 60 * 1000);
  // ---- 전역 단축키 (설정에서 바꾼다, v2) ----
  let registered: string[] = [];
  /** 지금 설정의 단축키를 건다. 다른 앱이 쓰고 있어 못 건 것의 이름을 돌려준다 */
  function applyShortcuts(): string[] {
    for (const acc of registered) globalShortcut.unregister(acc);
    registered = [];
    const taken: string[] = [];
    const { hide, quickAdd } = settings.get().shortcuts;
    for (const [acc, run, name] of [
      [hide, toggleHidden, '숨기기'],
      [quickAdd, () => panel.openQuick(), '할 일 한 줄 넣기'],
    ] as const) {
      try {
        if (globalShortcut.register(acc, run)) registered.push(acc);
        else taken.push(name);
      } catch {
        taken.push(name);
      }
    }
    if (taken.length > 0) log('shortcut', '등록 실패 (다른 앱이 사용 중)', taken.join(', '));
    return taken;
  }
  const takenShortcuts = applyShortcuts();
  if (takenShortcuts.length > 0) {
    setTimeout(
      () =>
        void pet.say({
          kind: 'answer',
          text: `${takenShortcuts.join(', ')} 단축키를 다른 앱이 쓰고 있어. 설정에서 다른 키로 바꿔 줘.`,
          ttlMs: 10_000,
        }),
      3000,
    );
  }

  // ---- 사진 펫 (P1-08) ----
  const maker = createMaker(log, (name, file) => {
    const r = shop.makeCustomFood(name, file, Date.now());
    panel.refresh();
    if (r.ok)
      void pet.say({
        kind: 'answer',
        text: `${name.trim()} 먹어 보고 싶다!`,
        ttlMs: 4000,
        image: foodImageDataUrl(file),
      });
    return r;
  });
  const sendPetImage = () => {
    if (!pet.win.isDestroyed()) pet.win.webContents.send(IPC.image, petImages());
  };
  pet.win.webContents.on('did-finish-load', sendPetImage);

  // ---- 설정 (P1-12) ----
  const settingsWindow = createSettingsWindow({
    scale: () => pet.scale(),
    setScale: (n) => pet.setScale(n),
    openMaker: (target) => maker.open(target),
    stats,
    checkUpdate: () => updates.check(true),
    openOnboarding: () => onboarding.open(),
    v2: {
      exportData: (w) => backup.exportTo(w),
      importData: (w) => backup.importFrom(w),
      exportPet: (w) => exportPet(w),
      importPet: (w) => importPet(w),
      importFriend: (w) => importPet(w, true),
      syncCalendar: () => calendar.sync(),
      calendarLast: () => calendar.last,
      mcpServers: () => mcpServers(log),
      refreshMcp: () => refreshMcpServers(log),
    },
  });
  settings.onChange((next, prev) => {
    if (next.shortcuts.hide !== prev.shortcuts.hide || next.shortcuts.quickAdd !== prev.shortcuts.quickAdd) {
      const taken = applyShortcuts();
      if (taken.length > 0)
        void pet.say({
          kind: 'answer',
          text: `${taken.join(', ')} 단축키는 다른 앱이 쓰고 있어. 다른 키로 해 줘.`,
          ttlMs: 8000,
        });
    }
    if (next.icsUrl !== prev.icsUrl && next.icsUrl) void calendar.sync();
    if (next.myMcp && !prev.myMcp) void refreshMcpServers(log);
    if (JSON.stringify(next.friends) !== JSON.stringify(prev.friends)) friends.sync();
    if (next.petName !== prev.petName) {
      chat.petNameChanged();
      panel.refresh();
      tray.setToolTip(`짝꿍 (${next.petName})`);
    }
    // 격리 폴더와 사용자 폴더는 대화 기록이 따로라 이어 갈 수 없다. 새 대화로 시작한다.
    if (next.aiIsolation !== prev.aiIsolation) chat.resetSessions();
    if (next.petImage !== prev.petImage || JSON.stringify(next.petPoses) !== JSON.stringify(prev.petPoses)) {
      sendPetImage();
      pet.react();
    }
    if (
      next.petKind !== prev.petKind ||
      next.spicy !== prev.spicy ||
      next.restDays.join() !== prev.restDays.join()
    )
      sendStatus();
    if (next.launchAtLogin !== prev.launchAtLogin && app.isPackaged) {
      app.setLoginItemSettings({ openAtLogin: next.launchAtLogin });
    }
  });

  // 짝꿍을 한 번 더 실행하면(앱 아이콘을 다시 누르는 등) 숨은 펫을 다시 부른다. 메뉴 막대 아이콘이 가려져도 돌아올 길.
  // ---- 새 버전 알림, 첫 실행 안내 (v1) ----
  const updates = watchUpdates({ say: (o) => pet.say(o), log });
  const onboarding = createOnboarding({ openMaker: () => maker.open(), log });
  if (!settings.get().onboarded)
    pet.win.webContents.once('did-finish-load', () => setTimeout(() => onboarding.open(), 1500));

  app.on('second-instance', () => {
    pet.setHidden('user', false);
    friends.setHidden('user', false);
  });
  pet.win.webContents.once('did-finish-load', () => friends.sync());
  // 집은 펫과 같이 숨고 나온다 (발표, 숨기기). 2초마다 맞춘다.
  pet.win.webContents.once('did-finish-load', () => house.show(shop.state().houseLevel, pet.bounds()));
  // 자리를 4분쯤 비우면 펫이 집 앞으로 가서 존다 (5분부터 졸고 10분부터 잔다). 자리 비울 때마다 한 번.
  let wentHome = false;
  setInterval(() => {
    const idle = powerMonitor.getSystemIdleTime();
    if (idle < 60) wentHome = false;
    const door = house.door();
    if (wentHome || !door || idle < 230 || idle > 290 || playing || pet.isHidden()) return;
    wentHome = true;
    void pet.walkTo(door.x - pet.bounds().width / 2, 60);
  }, 20_000).unref();
  let houseHidden = false;
  setInterval(() => {
    const hidden = pet.isHidden();
    if (hidden === houseHidden) return;
    houseHidden = hidden;
    if (hidden) house.hide();
    else house.unhide();
  }, 2000).unref();
  const stopPresence = watchPresentation((hide) => {
    pet.setHidden('presentation', hide);
    friends.setHidden('presentation', hide);
  }, log);
  app.on('will-quit', () => {
    for (const acc of registered) globalShortcut.unregister(acc);
    stopPresence();
    tray.destroy();
  });

  // 개발용: 메인 프로세스 디버거(--inspect)에서 같이 보기, 채팅을 불러 시험할 손잡이. 배포본에는 없다.
  if (!app.isPackaged)
    Object.assign(globalThis, {
      __jj: {
        look,
        chat,
        pet,
        globalShortcut,
        tray,
        settings,
        settingsWindow,
        panel,
        store,
        stats,
        notes,
        events,
        planner,
        life,
        petLife,
        shop,
        house,
        play,
        updates,
        onboarding,
        calendar,
        backup,
        achievements,
        seek,
        maker,
      },
    });
  if (process.env.JJ_METRICS) logMetrics(Number(process.env.JJ_METRICS));
});

/** 말풍선에 넣을 답 앞부분. 마크다운 기호와 줄바꿈을 빼고 30자까지. */
export function preview(text: string): string {
  const plain = text
    .replace(/[`*#>_]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > 30 ? `${plain.slice(0, 30)}...` : plain;
}

/**
 * 개발용: N초마다 모든 프로세스의 CPU, 메모리 합을 찍는다. `JJ_METRICS=10 npm run dev`
 * 0단계 P0-08 과 같은 방법(app.getAppMetrics)이라 숫자를 바로 비교할 수 있다.
 */
function logMetrics(seconds: number) {
  app.getAppMetrics(); // 첫 CPU 값은 기준점이라 버린다.
  setInterval(() => {
    const metrics = app.getAppMetrics();
    const cpu = metrics.reduce((sum, m) => sum + m.cpu.percentCPUUsage, 0);
    const memMB = metrics.reduce((sum, m) => sum + m.memory.workingSetSize, 0) / 1024;
    const detail = metrics.map((m) => `${m.type}:${Math.round(m.memory.workingSetSize / 1024)}`).join(' ');
    log('metrics', `cpu=${cpu.toFixed(2)}% mem=${memMB.toFixed(0)}MB procs=${metrics.length} (${detail})`);
  }, seconds * 1000);
}

app.on('window-all-closed', () => app.quit());
