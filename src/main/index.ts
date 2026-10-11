import { cpus, homedir } from 'node:os';
import { join } from 'node:path';
import { app, dialog, globalShortcut, powerMonitor, screen, session } from 'electron';
import { ACHIEVEMENTS } from '../shared/achieve.ts';
import { planTodos } from '../shared/ai/answer-todos.ts';
import { pickLocal } from '../shared/ai/catalog.ts';
import { contextEvents, todayRange } from '../shared/ai/context-events.ts';
import { persona, setMemorySource, todoContext } from '../shared/ai/persona.ts';
import { HIDE_SEEK, pickHideSpot } from '../shared/hide-seek.ts';
import { locale, t } from '../shared/i18n/index.ts';
import { IPC, type PetStatus, type PlayKind } from '../shared/ipc.ts';
import { type FactKind, factsForAi } from '../shared/knows.ts';
import { runnerKindOf } from '../shared/menu-runner.ts';
import { isMiniGame, PLAY_COIN } from '../shared/minigames.ts';
import { noteTitle } from '../shared/note-store.ts';
import { setVoiceSource, voiced } from '../shared/persona-voice.ts';
import { unlocked, WAVE_AWAY_SEC } from '../shared/pet-life.ts';
import { restDaysOf } from '../shared/routine.ts';
import { pickedGait } from '../shared/settings.ts';
import { shortcutsChanged } from '../shared/shortcut.ts';
import { FULLNESS, localDay } from '../shared/todo-store.ts';
import { admitUrl, panelTabOf, parseJjUrl } from '../shared/url-scheme.ts';
import { watchCatalog } from './ai/catalog.ts';
import { stopLocal } from './ai/local.ts';
import { cachedMcpServers, mcpServers, refreshMcpServers } from './ai/mcp-list.ts';
import { stopAllAi } from './ai/runner.ts';
import { applyPendingImport, createBackup, exportPet, importPet } from './backup.ts';
import { debugBattery, onSaverChange, powerFacts, saverNow, watchPower } from './battery.ts';
import { watchBetaStats } from './beta.ts';
import { boostOn, onBoostChange } from './boost.ts';
import { watchCalendar } from './calendar.ts';
import { createChat } from './chat.ts';
import { createCompanion } from './companion.ts';
import { createDayTools } from './day-tools.ts';
import { announceJsonTrouble, announceStoreTrouble, openStore } from './db.ts';
import { createDiary } from './diary.ts';
import { confineTestDisplay } from './focus.ts';
import { createFriends } from './friends.ts';
import { galleryHandlers } from './gallery-app.ts';
import { createGcal } from './gcal.ts';
import { createHouseRest } from './house-rest.ts';
import { createJourney } from './journey.ts';
import { pruneCopies } from './keep-copies.ts';
import { createKnows } from './knows.ts';
import { initLang } from './lang.ts';
import { stopLocalDrawNow, sweepLocalDraw } from './local-draw.ts';
import { createLogFile } from './log-file.ts';
import { createLookTogether } from './look-together.ts';
import {
  createMaker,
  foodImageDataUrl,
  modelOf,
  petImages,
  registerModelScheme,
  removeFoodImage,
} from './maker.ts';
import { createMiniGames } from './minigames.ts';
import { createOnboarding } from './onboarding.ts';
import { type Incoming, listenEarly, registerScheme, startIncoming, takeArgv } from './open-handler.ts';
import { openLink } from './open-link.ts';
import { createPanel } from './panel.ts';
import { denyPermissionsByDefault } from './permissions.ts';
import { createPetConfirm } from './pet-confirm.ts';
import { createPetFace, trayImageOf } from './pet-face.ts';
import { library } from './pet-library.ts';
import { createPetLife } from './pet-life.ts';
import { drainMemoryInbox } from './pet-memory.ts';
import { createPetWindow } from './pet-window.ts';
import { createPlanner } from './planner.ts';
import { createHouse, playBall, visitHouse } from './play.ts';
import { createPout } from './pout.ts';
import { watchPresentation } from './presence-watch.ts';
import { settings } from './settings.ts';
import { createSettingsWindow } from './settings-window.ts';
import { onJsonTrouble } from './store.ts';
import { createSystemMonitor } from './system-monitor.ts';
import { baseTrayIcon, createTray } from './tray.ts';
import { watchTrayTitle } from './tray-title.ts';
import { watchUpdates } from './update.ts';
import { createWear } from './wear.ts';
import { createWeekCard } from './week-card.ts';
import { createWhatFirst } from './what-first.ts';

// 데이터 폴더를 이름으로 고정한다. 기본값은 앱 이름을 따라가서 설치판(Jjakkung)과 개발판(jjakkung)이
// 운영체제에 따라 다른 폴더가 되고, 나중에 앱 이름을 바꿔도 데이터를 잃는다.
// 하나만 띄우기 잠금도 이 폴더에 있어 다른 무엇보다 먼저 정한다.
// JJ_USER_DATA 는 시험용: 설치판을 실제 데이터와 잠금을 건드리지 않고 따로 띄울 때 쓴다.
app.setPath('userData', process.env.JJ_USER_DATA || join(app.getPath('appData'), 'jjakkung'));

// 진단 기록: 설치판도 userData/logs/main.log 에 남긴다(1MB 넘으면 main.old.log 로 돌려 두 개만). 개발 실행은 콘솔에도.
// 질문, 답, 할 일과 일정 제목은 넘기지 않고, 경로 속 사용자 이름은 log-file.ts 가 가린다
const writeLog = createLogFile(join(app.getPath('userData'), 'logs'), homedir());
const log = (tag: string, ...rest: unknown[]) => {
  if (!app.isPackaged) console.log(`[${tag}]`, ...rest);
  writeLog(tag, rest);
};

// 메인에서 잡지 못한 오류는 기록만 남긴다. 처리기가 없으면 Electron 이 "Uncaught Exception" 창을 띄워
// 사용자 화면을 막는다 (2026-10-07 사용자 지적: 끄는 중 타이머가 닫힌 저장 파일을 읽었다)
process.on('uncaughtException', (err) => log('error', 'uncaught', err?.stack ?? String(err)));
process.on('unhandledRejection', (err) =>
  log('error', 'unhandled', err instanceof Error ? (err.stack ?? err.message) : String(err)),
);

// GPU 를 별도 프로세스 대신 본체 안에서 돌린다. 프로세스가 하나 줄어 메모리가 363MB 에서 306MB 로
// 줄었고 CPU 는 같았다 (2026-10-02 맥 측정, L12). 문제가 생기면 JJ_GPU_PROCESS=1 로 끈다.
if (!process.env.JJ_GPU_PROCESS) app.commandLine.appendSwitch('in-process-gpu');
// 네트워크 서비스도 본체 안에서 돌린다 (Chromium 기능 NetworkServiceInProcess2). 짝꿍은 네트워크를 가끔만 쓰는데
// (캘린더, 업데이트 확인, 모델 받기) 따로 띄우면 프로세스 하나가 늘 떠 있다. footprint 132MB 에서 122MB, 프로세스 3개에서 2개
// (2026-10-07 맥 측정, net.fetch 확인). 문제가 생기면 JJ_NET_PROCESS=1 로 끈다. enable-features 를 더 쓰면 한 줄에 쉼표로 모은다
if (!process.env.JJ_NET_PROCESS) app.commandLine.appendSwitch('enable-features', 'NetworkServiceInProcess2');

// 펫은 하나만 띄운다. 두 번째로 실행하면 그냥 끝난다.
// quit() 은 바로 끝나지 않아 ready 가 와서 시작 일(저장 파일 열기, 가져온 백업 끼우기, 창과 아이콘)이 돈다.
// 그래서 exit() 로 바로 끝내고, 시작 일도 잠금을 잡았을 때만 건다
const primary = app.requestSingleInstanceLock();
if (!primary) app.exit(0);
// jjakkung:// 주소와 .jjpet 파일 (맥은 ready 전에도 온다. 받는 쪽이 준비될 때까지 모아 둔다, open-handler.ts)
if (primary) listenEarly();
// 가져온 백업(저장 파일과 설정 파일)이 기다리면 바꿔 끼운다 (v2). 설정을 처음 읽기(아래 initLang) 전에 해야
// 가져온 설정이 보인다. 잠금을 잡은 쪽만: 이미 떠 있는 펫의 파일을 바꾸지 않게
// 실패해도 지금 데이터로 켠다 (켜기 전 이 자리에서 던지면 앱이 아예 안 뜬다)
if (primary)
  try {
    applyPendingImport();
  } catch (err) {
    log('backup', '가져온 백업 끼우기 실패', err instanceof Error ? err.message : String(err));
  }

registerModelScheme();

// 화면 말은 메뉴와 창을 만들기 전에 정한다 (v2 다국어). 시각 입력칸 같은 기본 칸은 Chromium 말을 따라서
// 준비 전에 같은 말로 맞춘다
initLang();
app.commandLine.appendSwitch('lang', locale());

// 모든 창(펫, 같이 보기, 놀이 창 포함): 새 창을 열거나 다른 주소로 옮겨 가지 못하게 한다. 링크는 메인이 따로 연다
app.on('web-contents-created', (_e, wc) => {
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('will-navigate', (ev) => ev.preventDefault());
});

// 잠금이 없으면 ready 를 기다리지 않는다 (곧 끝난다). 시작 일 전체를 if 로 감싸지 않으려고 약속으로 막는다
const ready = primary ? app.whenReady() : new Promise<void>(() => {});
ready
  .then(() => {
    // 웹 권한은 복사하기 말고 모두 거절한다 (permissions.ts)
    denyPermissionsByDefault(session.defaultSession, log);
    // 시험 인스턴스는 처음부터 맥북 화면에만 뜬다 (쓰는 사람의 작업 모니터에 잠깐이라도 뜨지 않게)
    confineTestDisplay();
    // 펫 앱은 Dock 아이콘 없이 뜬다. 끝내기는 펫 우클릭 메뉴나 메뉴 막대 아이콘에서 한다.
    if (process.platform === 'darwin') app.dock?.hide();
    // 내 컴퓨터에서 그리기: 앞서 갑자기 꺼져 남은 파이썬, sd-cli, 임시 그림, 지우다 만 폴더를 뒤에서 치운다 (기다리지 않는다)
    sweepLocalDraw(log);
    // 펫 이름은 설정에서 바꿀 수 있어 쓰는 곳마다 지금 값을 읽는다.
    const petName = () => settings.get().petName;
    // 인사, 칭찬, 쉬자는 말처럼 정해진 말도 고른 성격 말투로 (shared/persona-voice.ts)
    setVoiceSource(() => settings.get().persona);
    // 모델 목록 (v2): 앱 기본값, 하루 한 번 레포에서 받은 것으로 바꾼다
    const catalog = watchCatalog(log);
    const chat = createChat({
      catalog: catalog.get,
      aiModels: () => settings.get().aiModels,
      petName,
      aiIsolation: () => settings.get().aiIsolation,
      personaId: () => settings.get().persona,
      rules: () => settings.get().petRules,
      knowsTodos: () => settings.get().aiKnowsTodos,
      setKnowsTodos: (on) => settings.set({ aiKnowsTodos: on }),
      petTools: () => settings.get().aiPetTools,
      // 짝꿍 도구로 할 일, 메모가 바뀌었을 수 있다. 3초 판 번호 확인을 기다리지 않고 바로 다시 그린다
      // 지우기, 고치기는 확인 편지함에 남아 있다: 답이 끝나면 바로 묻는다 (pet-confirm.ts)
      onTurnEnd: () => {
        panel.refresh();
        petConfirm.drain();
      },
      // 질문 앞에 붙일 내 오늘 상황: 안 끝낸 할 일 제목과 마감, 오늘 남은 일정 (기획서 개인정보 표)
      todoContext: () => {
        // 오늘 일정은 0시부터 다음 날 0시까지 다 읽고 고른다: 종일 일정, 막 시작한 회의도 (context-events.ts)
        const now = Date.now();
        const day = todayRange(now);
        return todoContext({
          today: localDay(now),
          todos: store.list(now).open,
          events: contextEvents(events.between(day.from, day.to), now),
        });
      },
      saveNote: (title, body) => {
        notes.add({ title, body, source: 'ai' }, Date.now());
        panel.refresh();
      },
      mcpServers: () => (settings.get().myMcp ? mcpServers(log) : []),
      addTodos: (titles) => addAnswerTodos(titles).length,
      // "오늘 뭐부터 할까?" 규칙 답과 답 아래 단추 (main/what-first.ts)
      whatFirst: { answer: () => whatFirst.answer(), context: () => whatFirst.context() },
      onPlanAction: (kind, todoId) => planAction(kind, todoId),
      onUserSaid: (text) => pout.said(text),
      onPetAi: (state) => {
        if (state.thinking) petLife.activity('chat');
        pet.win.webContents.send(IPC.ai, state);
      },
      // 채팅 창을 닫았거나 다른 앱을 보는 중이면 펫이 답이 왔다고 알린다.
      onAnswer: async (text, chatInFront) => {
        if (chatInFront) return;
        const action = await pet.say({
          kind: 'answer',
          text: t('pet.answer', { text: preview(text) }),
          buttons: [
            { id: 'open', label: t('pet.answerOpen') },
            { id: 'later', label: t('pet.life.later') },
          ],
        });
        if (action === 'open' || action === 'dismiss') chat.open(pet.bounds());
      },
      // 강제 업데이트 전이면 AI 대화를 잠그고 펫이 까닭을 말한다 (updates 는 아래에서 만든다. 부를 때는 있다)
      locked: () => updates.locked(),
      onLocked: () => updates.remind(),
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
          // 짧은 놀이 중이면 그만 (비눗방울, 레이저 쫓기 등). 두더지 잡기는 누르기가 잡기
          if (games.running()) {
            if (!games.tap()) games.stop();
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
        toy: () =>
          shop.owns('yarn') ? t('pet.toy.yarn') : shop.owns('ball') ? t('pet.toy.ball') : undefined,
        openShop: () => panel.openTab('shop'),
        playing: () => playing,
        stopPlay: () => stopPlay(),
        playmate: () => games.mateName(),
        grabbed: () => pout.grabbed(),
        menuNote: () => pout.menuNote(),
        focusRunning: () => planner.focus.phase !== 'idle',
        toggleFocus: () => (planner.focus.phase === 'idle' ? planner.startFocus() : planner.stopFocus()),
        openKnows: () => knows.open(),
        whatFirst: () => sayWhatFirst(),
      },
      log,
      onMissed: () => panel.refresh(),
      onRestHeld: (kind, important) => rest.held(kind, important),
    });
    const look = createLookTogether({
      petName,
      hideChat: () => {
        const chatWin = chat.window;
        const chatWasVisible = !!chatWin && !chatWin.isDestroyed() && chatWin.isVisible();
        if (chatWasVisible) chatWin?.hide();
        return () => {
          if (chatWasVisible && chatWin && !chatWin.isDestroyed()) chatWin.show();
        };
      },
      // 펫은 숨기지 않고 돋보기를 들고 같이 본다. 친구 펫은 같은 쪽만 본다. 찍는 순간에만 다 같이 가린다
      // (예전에는 같이 보기 내내 펫을 숨겼고, 사용자가 숨겨 둔 펫도 끝나면 다시 보였다)
      pets: {
        aim: () => {
          for (const p of [pet, ...friends.pets()]) p.look('aim');
        },
        veil: async (on) => {
          await Promise.all([pet, ...friends.pets()].map((p) => p.veil(on)));
        },
        found: (target) => {
          for (const p of [pet, ...friends.pets()]) p.look({ found: target });
        },
        end: () => {
          for (const p of [pet, ...friends.pets()]) p.look(null);
        },
      },
      onImage: (image) => {
        stats.countLook(Date.now());
        chat.attach(image, pet.bounds());
      },
      // 놀던 중이면 그만 논다: 같이 보는 동안 펫은 오버레이 위에서 마우스를 다 통과시켜 놀 수 없다.
      // (두더지 구멍 속 가리기와 찍는 순간 가리기가 겹쳐도 펫은 pet-window setConcealed 가 한곳에서 되돌린다)
      onStart: () => {
        journey.tried('look');
        const game = games.running();
        if (!game) return;
        log('look', 'stop play', game);
        games.stop();
      },
      log,
    });
    // ---- 방해 금지 (P1-10) ----
    // 친구 펫(v2)도 기본 펫과 같이 숨고 나온다
    const friends = createFriends({
      mainPet: () => pet,
      // 집중(펫이 잠), 공놀이와 산책, 숨바꼭질 중이 아니고 사용자가 자리에 있을 때만
      canMeet: () =>
        planner.focus.phase !== 'focus' && !playing && !seeking && powerMonitor.getSystemIdleTime() < 60,
      wear: () => wear.friendLook(),
      log,
    });
    const toggleHidden = () => {
      // 집에서 쉬는 중이면 보이기(숨기기 단축키, 메뉴 막대)는 집에서 부르는 것
      if (rest.inside() && !pet.isHidden('user')) {
        void rest.call();
        return;
      }
      const on = !pet.isHidden('user');
      pet.setHidden('user', on);
      friends.setHidden('user', on);
      if (!on) void rest.call(false);
    };
    // 숨기기 단축키는 숨은 펫을 다시 부르는 길이라 늘 걸어 둔다. 다른 앱과 겹치지 않게 네 키 조합.
    const tray = createTray(petName, {
      toggleHidden,
      isHidden: () => pet.isHidden('user') || rest.inside(),
      openChat: () => chat.open(pet.bounds()),
      lookTogether: () => look.start(),
      openSettings: () => settingsWindow.open(),
      sendFeedback: () => settingsWindow.open('stats'),
      quickAdd: () => panel.openQuick(),
      openTodos: () => panel.openTab('todo'),
      togglePanel: () => panel.togglePanel(),
      reloadPet: () => {
        pet.reload();
        friends.reloadAll();
      },
      stats: () => sysMonitor.menuItems(),
      sysMonitorOn: () => settings.get().sysMonitor,
      setSysMonitor: (on) => settings.set({ sysMonitor: on }),
    });
    // 메뉴 막대 컴퓨터 상태 (RunCat 처럼): CPU 사용률과 그만큼 바삐 움직이는 펫
    const sysMonitor = createSystemMonitor(
      tray,
      baseTrayIcon(),
      () => t('tray.tooltip', { name: petName() }),
      log,
    );
    // 메뉴 막대에서 달릴 모습은 지금 펫 종류 (사진 펫은 걸음새와 설계도로 가장 가까운 종류). 켜기 전에 정해 한 번만 그린다
    const runnerKindNow = () => {
      const s = settings.get();
      return runnerKindOf(s, s.petImage ? modelOf(s.petModel) : null);
    };
    sysMonitor.setKind(runnerKindNow());
    sysMonitor.setEnabled(settings.get().sysMonitor);
    // ---- 할 일과 코인 (2단계) ----
    const {
      store,
      stats,
      notes,
      events,
      gcalLinks,
      life,
      shop,
      achievements,
      habits,
      exportTodos,
      vacuumInto,
      dataVersion,
      trouble,
    } = openStore(log);
    // "오늘 뭐부터 할까?" (채팅 규칙 답, 펫 우클릭 메뉴): 지난 마감 → 오늘 마감 → 중요 → 곧 마감 → 습관, 빈 시간에 집중 칸
    const whatFirst = createWhatFirst({
      todos: store,
      habits,
      events,
      restDays: () => restDaysOf(settings.get()),
      dayEndMinute: () => settings.get().reviewMinute,
    });
    /** 펫 우클릭 메뉴 "오늘 뭐부터?": 규칙 답을 말풍선으로, 단추는 집중 시작과 패널 열기 */
    const sayWhatFirst = () => {
      const b = whatFirst.bubble();
      void pet
        .say({
          kind: 'answer',
          text: b.text,
          buttons: b.empty
            ? []
            : [
                ...(b.focusTodoId !== undefined ? [{ id: 'focus', label: t('first.focus') }] : []),
                { id: 'panel', label: t('first.panel') },
              ],
          ttlMs: 30_000,
        })
        .then((a) => {
          if (a === 'focus' || a === 'panel') planAction(a, b.focusTodoId);
        });
    };
    /** 규칙 답 단추: 집중 시작(이미 집중 중이면 그대로), 패널 오늘 탭 */
    const planAction = (kind: 'focus' | 'panel', todoId?: number) => {
      if (kind === 'panel') panel.openTab('today');
      else if (planner.focus.phase === 'idle') planner.startFocus(undefined, todoId);
    };
    // 오래된 안전 복사본(가져오기 전 데이터, 판 올리기 전 복사, 깨진 파일)을 정리한다. 저장 파일을 연 뒤라
    // 되살리기에 쓸 복사본은 이미 썼다. 종류마다 새것 3개와 30일 안의 것은 남긴다 (keep-copies.ts)
    try {
      const gone = pruneCopies(app.getPath('userData'));
      if (gone.length) log('storage', '오래된 복사본 정리', gone.length);
    } catch (err) {
      log('storage', '복사본 정리 실패', err instanceof Error ? err.message : String(err));
    }
    // ---- 펫 성장 단계와 철마다 옷 (main/wear.ts) ----
    const wear = createWear({
      stats,
      affection: () => petLife.state.affection,
      petName,
      say: (o) => pet.say(o),
      react: (kind) => pet.react(kind),
      onChange: () => {
        sendStatus();
        friends.resendStatus();
      },
      fromSettings: (sender) => {
        const w = settingsWindow.window;
        return !!w && !w.isDestroyed() && w.webContents === sender;
      },
      log,
    });
    // 저장 파일이 깨졌거나 새 판이었으면 펫이 화면에 뜬 뒤 알린다 (버그잡이 6차)
    if (trouble)
      pet.win.webContents.once('did-finish-load', () =>
        setTimeout(() => void announceStoreTrouble(trouble, (o) => pet.say(o)), 3000),
      );
    // 설정 같은 JSON 파일이 깨져 옆으로 옮겼으면(json-file.ts) 조용히 넘어가지 않고 알린다. 켠 뒤에 생긴 것도 바로
    pet.win.webContents.once('did-finish-load', () =>
      setTimeout(() => onJsonTrouble((tr) => void announceJsonTrouble(tr, (o) => pet.say(o))), 3500),
    );
    // 채팅의 AI 가 부른 지우기, 고치기, 메모 덧붙이기: 펫 말풍선으로 묻고 허락하면 한다 (프롬프트 주입 막기)
    const petConfirm = createPetConfirm({
      stores: { todos: store, events, notes },
      say: (o) => pet.say(o),
      onChange: () => panel.refresh(),
      log,
    });
    setInterval(() => petConfirm.drain(), 5000).unref();
    // 답을 할 일로: 마감 낱말은 마감으로, 이미 있는 할 일은 빼고 넣는다. 넣은 id 를 돌려준다 (되돌리기를 붙일 수 있게)
    const addAnswerTodos = (titles: readonly string[]): number[] => {
      const now = Date.now();
      const planned = planTodos(titles, store.list(now).open, localDay(now));
      const ids = planned.map((p) => store.add(p, now).id);
      if (ids.length > 0) panel.refresh();
      return ids;
    };
    // ---- 짝꿍이 기억하는 것 ----
    // 질문마다 성격 뒤에 붙는다 (persona.ts). MCP remember 가 남긴 것은 질문할 때와 1분마다 "기다리는 기억"으로 옮기고,
    // 사용자가 설정에서 허락한 것만 여기(petMemory)에 들어온다
    // 사용자가 직접 알려 준 것(생일, 좋아하는 간식, 좋아하는 것)도 앞에 붙인다 (짝꿍이 아는 것, shared/knows.ts)
    const factLine = (kind: FactKind, v: { value: string; m?: number; d?: number }) =>
      kind === 'birthday'
        ? t('bond.fact.ai.birthday', { m: v.m ?? 0, d: v.d ?? 0 })
        : t(kind === 'food' ? 'bond.fact.ai.food' : 'bond.fact.ai.like', { value: v.value });
    setMemorySource(() => {
      drainMemoryInbox(log);
      return [...factsForAi(settings.get().petFacts, factLine), ...settings.get().petMemory];
    });
    drainMemoryInbox(log);
    setInterval(() => drainMemoryInbox(log), 60_000).unref();
    // ---- 짝꿍 일기 ----
    const diary = createDiary({
      stats,
      ask: (text, system) => chat.textOnce(text, system),
      // 일기는 질문이 아니라 기억을 보내지 않는다 (숫자와 펫 문장만)
      persona: () => persona(petName(), settings.get().persona, '', { memory: [] }),
      onChange: () => panel.refresh(),
      log,
    });
    // ---- 펫의 하루: 삐짐, 기분, 친밀도 (v1) ----
    const petLife = createPetLife({
      life,
      todos: store,
      petName,
      say: (o) => pet.say(o),
      petHidden: () => pet.isHidden(),
      react: (kind) => pet.react(kind),
      focusing: () => planner.focus.phase === 'focus',
      onChange: () => {
        sendStatus();
        panel.refresh();
      },
      stroll: (min) => play('walk', min),
      onActivity: (kind, dayMadeUp) => pout.activity(kind, dayMadeUp),
      onRestIgnored: () => pout.restIgnored(),
      log,
    });
    // ---- 매운맛 토라짐: 하루 중에도 잘 삐지고 달래면 풀린다 (shared/pout.ts). 매운맛을 끄면 아무것도 안 한다 ----
    const pout = createPout({
      say: (o) => pet.say(o),
      react: (kind) => pet.react(kind),
      petName,
      // 집중, 숨김(발표, 집 안), 노는 중, 숨바꼭질 중에는 방해하지 않는다
      calm: () =>
        planner.focus.phase === 'focus' || pet.isHidden() || playing || !!seeking || !!games.running(),
      userHidden: () => pet.isHidden('user'),
      canTalk: () => pet.isIdle(),
      hungry: () => store.fullness(Date.now()) < FULLNESS.hungry,
      overdue: () => {
        const today = localDay(Date.now());
        return store.list(Date.now()).open.filter((x) => x.due !== null && x.due < today).length;
      },
      onChange: () => {
        sendStatus();
        panel.refresh();
      },
      log,
    });

    // ---- 놀이와 집 (v1) ----
    // 집을 끌어 옮기면 (v2) 한가한 펫이 새 자리에 가 본다
    const house = createHouse({
      onMoved: () => {
        if (!playing) void visitHouse(pet, house);
      },
      // 집에서 쉬기: 집 우클릭 맨 위 항목, 쉬는 중에 집을 누르면 나온다
      onClick: () => {
        if (rest.inside()) void rest.call();
      },
      restItem: () => rest.menuItem(),
      log,
    });
    const houseLook = () => {
      const s = shop.state();
      return { level: s.houseLevel, style: s.houseStyle };
    };
    let playing = false;
    const rest = createHouseRest({ pet, house, petName, playing: () => playing, log });
    /** 공놀이(공이나 털실이 있어야), 산책. 노는 중이면 무시 */
    async function play(kind: PlayKind, walkMin = 5): Promise<boolean> {
      if (playing) return false;
      // 집중 중에는 펫이 잔다. 놀지 않고 까닭만 말한다
      if (planner.focus.phase === 'focus') {
        if (!pet.isHidden()) void pet.say({ kind: 'answer', text: t('play.block.focus'), ttlMs: 4000 });
        return false;
      }
      // 집에서 쉬는 중이면 나와서 논다
      if (rest.phase() !== 'out') await rest.call(false);
      if (pet.isHidden()) return false;
      if (isMiniGame(kind)) {
        playing = true;
        try {
          return await games.start(kind);
        } finally {
          playing = false;
          panel.refresh();
        }
      }
      const toy = shop.owns('yarn') ? 'yarn' : shop.owns('ball') ? 'ball' : undefined;
      if (kind === 'seek') {
        // 숨바꼭질도 노는 중으로 친다 (두 번 시작하면 두 번째 판이 끝나지 않았다)
        playing = true;
        try {
          return await seek();
        } finally {
          playing = false;
        }
      }
      if (kind === 'ball' && !toy) {
        void pet.say({ kind: 'answer', text: t('pet.play.noBall'), ttlMs: 5000 });
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
        void pet.say({ kind: 'answer', text: t('pet.play.walkStart'), ttlMs: 2000 });
        await new Promise((r) => setTimeout(r, 2200));
        const started = Date.now();
        const ok = await pet.stroll(walkMin);
        const minutes = Math.round((Date.now() - started) / 60_000);
        stats.addWalk(Date.now(), minutes);
        if (minutes > 0) petLife.activity('play');
        if (ok) void pet.say({ kind: 'answer', text: t('pet.play.walkEnd'), ttlMs: 4000 });
        return ok;
      } finally {
        playing = false;
      }
    }
    /** 그만 놀기 (펫 우클릭 놀기 메뉴): 짧은 놀이, 숨바꼭질, 공놀이, 산책 모두 */
    function stopPlay() {
      games.stop();
      seeking?.done(false);
      pet.halt();
    }
    // ---- 짧은 놀이: 비눗방울, 레이저 쫓기, 간식 받아먹기, 가위바위보, 친구와 술래잡기, 두더지 잡기 ----
    const games = createMiniGames({
      pet: () => pet,
      mates: () => friends.mates(),
      focus: () => planner.focus.phase === 'focus',
      hungry: () => store.fullness(Date.now()) < FULLNESS.hungry,
      coinsToday: () => store.coinCount(PLAY_COIN.reason, localDay(Date.now())),
      giveCoins: (coins) => {
        const now = Date.now();
        // 한 행에 1코인 (하루 상한을 행 수로 센다)
        for (let i = 0; i < coins; i++) store.reward(1, PLAY_COIN.reason, now);
        panel.refresh();
      },
      played: () => petLife.activity('play'),
      log,
    });
    // ---- 숨바꼭질 (v2 미니 게임) ----
    let seeking:
      | { home: { x: number; y: number }; timer: NodeJS.Timeout; done: (found: boolean) => void }
      | undefined;
    async function seek(): Promise<boolean> {
      void pet.say({
        kind: 'answer',
        text: t('pet.seek.start', { seconds: HIDE_SEEK.seconds }),
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
          text: coins ? t('pet.seek.foundCoins', { coins }) : t('pet.seek.found'),
          ttlMs: 4000,
        });
      } else {
        void pet.say({ kind: 'answer', text: t('pet.seek.lost'), ttlMs: 4000 });
      }
      panel.refresh();
      return found;
    }

    // ---- 업적 (v2) ----
    function checkAchievements() {
      const s = settings.get();
      const facts = achievements.facts(Date.now(), restDaysOf(s), {
        affection: petLife.state.affection,
        houseLevel: shop.state().houseLevel,
      });
      for (const a of achievements.check(facts, Date.now())) {
        log('achieve', a.key);
        void pet.say({
          kind: 'system',
          text: t('pet.achieved', { name: a.name, hint: a.hint }),
          ttlMs: 6000,
          hold: {
            missedMsgs: [
              { key: 'pet.achieved', vars: { name: { key: a.nameKey }, hint: { key: a.hintKey } } },
            ],
          },
        });
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
      // 연달아 못 읽으면 한 번 (조용히 실패하던 것). 숨어 있으면 모아 두었다가, 못 보면 놓친 알림에
      onBroken: () => {
        void pet
          .say({
            kind: 'schedule',
            text: t('pet.calendarBroken'),
            buttons: [{ id: 'settings', label: t('pet.calendarSettings') }],
            ttlMs: 30_000,
            hold: { missedMsgs: [{ key: 'pet.calendarBroken' }], onAction: openCalendarSettings },
          })
          .then(openCalendarSettings);
      },
      // 설정 창을 보고 있으면 알리지 않는다 (거기 결과 글이 이미 있다)
      quiet: () => {
        const w = settingsWindow.window;
        return !!w && !w.isDestroyed() && w.isVisible();
      },
      // 구글 캘린더로 보낸 짝꿍 일정이 같은 캘린더를 가져올 때 되돌아오면 거른다 (둘씩 보이지 않게)
      skipUids: () => gcalLinks.sentUids(),
      log,
    });
    function openCalendarSettings(a: string | undefined) {
      if (a === 'settings') settingsWindow.open();
    }
    const backup = createBackup({ vacuumInto, log });
    // 펫 MCP 서버(다른 프로세스)가 할 일, 메모, 일정을 넣으면 저장 파일 판 번호가 바뀐다. 3초마다 보고 다시 그린다.
    let seenVersion = dataVersion();
    setInterval(() => {
      const v = dataVersion();
      // -1 은 끄는 중 (저장 파일을 닫았다)
      if (v < 0 || v === seenVersion) return;
      seenVersion = v;
      log('db', '다른 곳에서 바뀜 (MCP)');
      panel.refresh();
      planner.check();
      gcal.kick();
    }, 3000).unref();
    watchBetaStats(stats, () => pet.isHidden('user'), log);
    // ---- 펫 경험: 끝낸 일 축하, 만난 날 기념, 혼잣말 기억 (main/companion.ts) ----
    const companion = createCompanion({
      todos: store,
      stats,
      achievements,
      petName,
      say: (o) => pet.say(o),
      react: (kind) => pet.react(kind),
      canCelebrate: () =>
        !pet.isHidden('user') && !pet.isHidden('presentation') && planner.focus.phase !== 'focus',
      visible: () => !pet.isHidden() && !rest.inside(),
      log,
    });
    /** 할 일을 끝냈다 (패널, 집중 끝 "끝냈어"). 친밀도 300 이 넘으면 신나서 빙글 춤 */
    function todoFinished(id: number) {
      pet.react(unlocked(petLife.state.affection).has('dance') ? 'dance' : 'happy');
      petLife.activity('todo');
      // 오늘 할 일 다 끝냄, 연속 기록, 5/10/20개째면 한마디 (그날 한 번씩)
      companion.completed(id);
    }
    /** 메뉴 막대 글자 다시 맞추기 (아래에서 메뉴 막대 글자를 만든 뒤 채운다. 그 전에 불려도 괜찮게) */
    const titleHook = { refresh: () => {} };
    // ---- 일정 알림, 오늘 브리핑, 집중 타이머 (v1) ----
    const planner = createPlanner({
      todos: store,
      events,
      stats,
      say: (o) => pet.say(o),
      petHidden: () => pet.isHidden(),
      petName,
      // 수다쟁이 혼잣말이 보는 펫 상태 (기분, 친밀도, 배고픔, 삐짐, 노는 중)
      talkFacts: () => {
        const l = petLife.state;
        return {
          mood: l.mood,
          affection: l.affection,
          hungry: store.fullness(Date.now()) < FULLNESS.hungry,
          // 매운맛으로 토라진 동안도 신난 혼잣말은 안 한다 (토라짐 대사만)
          sulk: Math.max(l.sulk, pout.stage),
          busy: playing || !!seeking || games.running() !== undefined,
          // 기운 (shared/energy.ts): 활발, 나른함, 졸림, 녹초일 때 펫 자신의 몸 상태 대사
          more: petLife.talkKeys(),
          // 기억: 어제 끝낸 수, 연속 기록, 이번 주, 오늘 집중, 함께한 날 (고를 때만 읽는다)
          memory: () => companion.memoryFacts(Date.now()),
        };
      },
      talkRecent: {
        load: () => companion.recentTalk(),
        known: companion.isIdleKey,
        save: (keys) => companion.saveRecentTalk(keys),
      },
      openToday: () => panel.openTab('today'),
      openUrl: (url) => openLink(url, log),
      onReward: () => pet.react(),
      // 집중 끝에 "끝냈어": 패널에서 끝낸 것과 같은 반응
      onCompleted: (_coins, id) => todoFinished(id),
      onChange: () => {
        panel.refresh();
        sendStatus();
        titleHook.refresh();
      },
      log,
    });
    const panel = createPanel({
      store,
      notes,
      events,
      focus: () => planner.focus,
      startFocus: (minutes, todoId) => planner.startFocus(minutes, todoId),
      focusMin: () => settings.get().focusMin,
      stopFocus: () => planner.stopFocus(),
      onEventsChanged: () => {
        planner.check();
        gcal.kick();
        journey.tried('event');
      },
      askAi: (prompt) => chat.askInWindow(prompt, pet.bounds()),
      askOnce: (text, system) => chat.textOnce(text, system),
      aiLocked: () => updates.locked(),
      aiLabel: () => chat.aiLabel(),
      life: () => {
        const l = petLife.state;
        const poutWhy = pout.why;
        return {
          sulk: l.sulk,
          mood: Math.round(l.mood),
          affection: l.affection,
          ...(poutWhy ? { poutWhy } : {}),
        };
      },
      shop,
      foodImage: (file) => foodImageDataUrl(file),
      onFedWith: (food) => {
        void rest.call(false);
        pet.react('fed');
        petLife.activity('feed');
        const image = food.image ? foodImageDataUrl(food.image) : undefined;
        void pet.say({ kind: 'answer', text: voiced('pet.fedWith', { food: food.name }), ttlMs: 3500, image });
        sendStatus();
      },
      openFoodMaker: () => maker.open('food'),
      removeFoodImage,
      onHouseChanged: (what) => {
        house.show(houseLook(), pet.bounds());
        if (!house.bounds()) rest.houseGone();
        void pet.say({
          kind: 'answer',
          text: t(what === 'style' ? 'pet.houseStyle' : 'pet.newHouse'),
          ttlMs: 4000,
        });
      },
      play: (kind) => void play(kind),
      achieve: () => {
        const now = Date.now();
        const got = achievements.got();
        const streakDays = achievements.facts(now, restDaysOf(settings.get()), {
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
      onCompleted: (_coins, id) => todoFinished(id),
      onFed: () => {
        void rest.call(false);
        pet.react('fed');
        petLife.activity('feed');
        void pet.say({ kind: 'answer', text: voiced('pet.fed'), ttlMs: 3000 });
      },
      onChanged: () => sendStatus(),
      openChat: () => chat.open(pet.bounds()),
      openSettings: () => settingsWindow.open(),
      lookTogether: () => look.start(),
      missed: () => pet.missed(),
      diary: () => diary.entries(Date.now()),
      clearMissed: () => pet.clearMissed(),
      stats,
      log,
    });
    /** 패널 밖(펫 우클릭)에서 밥 주기 */
    function feedPet() {
      const r = store.feed(Date.now());
      if (r.ok) {
        // 집에서 쉬는 중이면 밥 냄새 맡고 나온다 (먹는 말은 나온 뒤에)
        void rest.call(false);
        pet.react('fed');
        petLife.activity('feed');
        void pet.say({ kind: 'answer', text: voiced('pet.fed'), ttlMs: 3000 });
      } else {
        void pet.say({ kind: 'answer', text: r.full ? t('pet.full') : t('pet.noCoins'), ttlMs: 4000 });
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
        pout: pout.stage,
        kind: settings.get().petKind,
        pet3d: settings.get().pet3d,
        style: settings.get().petStyle,
        cushion: shop.owns('cushion'),
        flower: unlocked(petLife.state.affection).has('flower'),
        sounds: settings.get().sounds,
        boost: boostOn(),
        face: true,
        gait: pickedGait(settings.get()),
        energy: petLife.energy,
        saver: saverNow(),
        readAloud: settings.get().readAloud,
        wear: wear.look(),
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
    // 이름 옆 얼굴: 내 펫 화면이 지금 모습으로 그려 보낸 것을 창들에 나눠 준다 (shared/face.ts)
    // 윈도우 알림 영역 아이콘도 지금 펫 얼굴로 (원래는 콩이 그림 tray.png). 맥 메뉴 막대는 흑백 템플릿이라 그대로
    const petFace = createPetFace(
      () => (pet.win.isDestroyed() ? undefined : pet.win.webContents),
      (url) => {
        if (process.platform === 'darwin') return;
        const icon = trayImageOf(url);
        // 컴퓨터 상태가 켜져 있으면 달리는 콩이가 자리를 쓰고, 끌 때 이 얼굴로 돌아온다
        if (icon) sysMonitor.setBaseIcon(icon);
      },
    );
    setInterval(sendStatus, 5 * 60 * 1000);
    // 부스트 모드가 켜지고 꺼지면(설정, 전원 꽂고 빼기) 펫과 친구에게 다시 알린다
    onBoostChange(() => {
      sendStatus();
      friends.resendStatus();
    });
    // 배터리 절약 (설정 편의): 전원, 저전력, 설정이 바뀌면 펫과 친구에게 알린다 (그리기 상한, 걷기 간격)
    const stopPower = watchPower(log);
    onSaverChange((on) => {
      sendStatus();
      friends.resendStatus();
      tellSaver(on);
    });
    /**
     * 처음 배터리로 바뀌어 움직임을 줄이면 펫이 한 번 알린다 (몰래 바꾸지 않게, 사용자 요청 2026-10-11).
     * "그대로 움직이기"를 누르면 바로 끈다. 자동일 때 배터리 때문에 켜진 것만 (항상 줄이기는 사용자가 고른 것)
     */
    function tellSaver(on: boolean) {
      const s = settings.get();
      if (!on || s.saverTold || s.batterySaver !== 'auto' || !powerFacts().onBattery) return;
      settings.set({ saverTold: true });
      void pet
        .say({
          kind: 'answer',
          text: t('pet.saver.told'),
          buttons: [
            { id: 'keep', label: t('pet.saver.keep') },
            { id: 'ok', label: t('pet.saver.ok') },
          ],
          ttlMs: 20_000,
        })
        .then((action) => {
          if (action !== 'keep') return;
          settings.set({ batterySaver: 'off' });
          sayShort(t('pet.saver.kept'));
        });
    }
    // 켤 때 이미 배터리면 펫이 뜬 뒤 알린다 (한 번만)
    pet.win.webContents.once('did-finish-load', () => setTimeout(() => tellSaver(saverNow()), 6000));
    // ---- 전역 단축키 (설정에서 바꾼다, v2) ----
    let registered: string[] = [];
    /** 지금 설정의 단축키를 건다. 다른 앱이 쓰고 있어 못 건 것의 이름을 돌려준다 */
    function applyShortcuts(): string[] {
      for (const acc of registered) globalShortcut.unregister(acc);
      registered = [];
      const taken: string[] = [];
      const {
        hide,
        quickAdd,
        chat: chatKey,
        look: lookKey,
        panel: panelKey,
        pet: petKey,
      } = settings.get().shortcuts;
      for (const [acc, run, name] of [
        [hide, toggleHidden, t('pet.shortcut.hide')],
        [quickAdd, () => panel.openQuick(), t('pet.shortcut.quickAdd')],
        // 펫 메뉴의 "대화", "같이 보기"와 같다
        [chatKey, () => chat.open(pet.bounds()), t('pet.shortcut.chat')],
        [lookKey, () => void look.start(), t('pet.shortcut.look')],
        // 펫을 누른 것과 같다 (열려 있으면 닫는다). 펫을 찾아 누르지 않아도 패널을 연다
        [panelKey, () => panel.togglePanel(), t('pet.shortcut.panel')],
        // 키보드로 펫 다루기 (접근성): 숨겨 둔 펫이면 먼저 부른다
        [
          petKey,
          () => {
            if (pet.isHidden('user') || rest.inside()) toggleHidden();
            else pet.keyboard();
          },
          t('pet.shortcut.pet'),
        ],
      ] as const) {
        // 비운 단축키(새 기본 키가 사용자 키와 겹쳐 비운 것)는 등록하지 않는다
        if (!acc) continue;
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
            text: t('pet.shortcut.takenStart', { keys: takenShortcuts.join(', ') }),
            ttlMs: 10_000,
          }),
        3000,
      );
    }

    // ---- 사진 펫 (P1-08) ----
    const maker = createMaker(
      log,
      (name, file) => {
        const r = shop.makeCustomFood(name, file, Date.now());
        panel.refresh();
        if (r.ok)
          void pet.say({
            kind: 'answer',
            text: t('pet.foodMade', { food: name.trim() }),
            ttlMs: 4000,
            image: foodImageDataUrl(file),
          });
        return r;
      },
      {
        ask: (text, image, system, signal) => chat.oneShot(text, image, system, signal),
        hasVision: chat.hasVisionAi,
      },
    );
    const sendPetImage = () => {
      if (!pet.win.isDestroyed()) pet.win.webContents.send(IPC.image, petImages());
    };
    pet.win.webContents.on('did-finish-load', sendPetImage);

    // ---- 설정 (P1-12) ----
    const settingsWindow = createSettingsWindow({
      scale: () => pet.scale(),
      setScale: (n) => pet.setScale(n),
      openMaker: (target) => maker.open(target),
      remakeBody: (gait) => maker.remake(gait),
      cancelRemake: () => maker.cancelRemake(),
      stats,
      checkUpdate: () => updates.check(true),
      openOnboarding: () => onboarding.open(),
      log,
      logDir: join(app.getPath('userData'), 'logs'),
      // 기록에는 원래 남기지 않지만, 혹시 오류 글에 섞여 와도 의견 보내기에서 가린다 (diagnostics.ts)
      privateWords: () => {
        const now = Date.now();
        const { open, doneToday } = store.list(now);
        const s = settings.get();
        return [
          ...[...open, ...doneToday].flatMap((x) => [x.title, ...x.steps.map((st) => st.title)]),
          ...events.between(now - 90 * 86_400_000, now + 180 * 86_400_000).map((e) => e.title),
          ...notes.list().map((n) => n.title),
          ...(s.icsUrl ? [s.icsUrl] : []),
          ...s.petMemory,
          ...s.petFacts.map((f) => f.value),
          ...s.petRules.split('\n'),
        ];
      },
      v2: {
        exportData: (w) => backup.exportTo(w),
        importData: (w) => backup.importFrom(w),
        exportPet: (w) => exportPet(w),
        importPet: (w) => importPet(w, false, log),
        importFriend: (w) => importPet(w, true, log),
        syncCalendar: () => calendar.sync(true),
        calendarLast: () => calendar.last,
        catalog: catalog.get,
        // 설정 창을 연다고 사용자 MCP 서버를 다 띄워 보지 않는다. 내 MCP 쓰기를 켠 사람만 새로 읽는다
        mcpServers: () => (settings.get().myMcp ? mcpServers(log) : cachedMcpServers()),
        refreshMcp: () => refreshMcpServers(log),
        forgetAiSessions: () => chat.forgetSessions(),
      },
      gallery: galleryHandlers(log),
    });
    // ---- 구글 캘린더에 쓰기 (6단계): 짝꿍 일정을 구글로. 설정 창에서 연결한다 ----
    const gcal = createGcal({
      store: gcalLinks,
      isSettings: (wc) => {
        const w = settingsWindow.window;
        return !!w && !w.isDestroyed() && w.webContents === wc;
      },
      target: () => settingsWindow.window,
      onLost: () => {
        void pet
          .say({
            kind: 'schedule',
            text: t('gcal.lost'),
            buttons: [{ id: 'settings', label: t('pet.calendarSettings') }],
            ttlMs: 30_000,
            hold: { missedMsgs: [{ key: 'gcal.lost' }], onAction: openCalendarSettings },
          })
          .then(openCalendarSettings);
      },
      log,
    });
    // ---- 하루 도구: 습관, 아침 계획, 알림 미루기, 내보내기 (main/day-tools.ts) ----
    const dayTools = createDayTools({
      todos: store,
      habits,
      events,
      notes,
      exportTodos,
      restDays: () => restDaysOf(settings.get()),
      dayEndMinute: () => settings.get().reviewMinute,
      isPanel: (wc) => panel.owns(wc),
      panelWindow: () => panel.window,
      openToday: () => panel.openTab('today'),
      isSettings: (wc) => {
        const w = settingsWindow.window;
        return !!w && !w.isDestroyed() && w.webContents === wc;
      },
      settingsWindow: () => settingsWindow.window,
      askOnce: (text, system) => chat.textOnce(text, system),
      aiLabel: () => chat.aiLabel(),
      aiLocked: () => updates.locked(),
      say: (o) => pet.say(o),
      petHidden: () => pet.isHidden(),
      focusing: () => planner.focus.phase === 'focus',
      reminders: planner.reminders,
      log,
    });
    // ---- 짝꿍이 아는 것, 첫 7일 여정, 주간 회고 카드 (2026-10-11) ----
    // 말을 걸어도 되는 때: 숨거나 집중 중, 노는 중이 아니고 펫이 한가하다
    const canTalk = () =>
      !pet.isHidden() &&
      planner.focus.phase !== 'focus' &&
      !playing &&
      !seeking &&
      !games.running() &&
      pet.isIdle();
    const knows = createKnows({
      petName,
      say: (o) => pet.say(o),
      react: (kind) => pet.react(kind),
      canTalk,
      log,
    });
    const journey = createJourney({
      todos: store,
      stats,
      notes,
      petName,
      say: (o) => pet.say(o),
      react: (kind) => pet.react(kind),
      canTalk,
      seen: {
        quick: () => !!panel.quickWindow && !panel.quickWindow.isDestroyed(),
        focus: () => planner.focus.phase !== 'idle',
        maker: () => !!maker.window && !maker.window.isDestroyed(),
      },
      open: (step) => {
        if (step === 'quick') panel.openQuick();
        else if (step === 'focus') planner.startFocus(25);
        else if (step === 'note' || step === 'event') panel.openTab(step);
        else if (step === 'maker') maker.open();
        else if (step === 'look') void look.start();
        else panel.openTab('today');
      },
      panel: () => panel.window,
      onChange: () => panel.refresh(),
      log,
    });
    const weekCard = createWeekCard({
      doneTitlesSince: (from) => store.doneTitlesSince(from),
      panel: () => panel.window,
      hold: (work) => panel.hold(work),
      onSaved: () => journey.tried('week'),
      log,
    });
    settings.onChange((next, prev) => {
      // 단축키를 다 본다 (대화, 같이 보기 키를 바꿔도 다시 켜야 반영되던 문제, 리뷰 HIGH)
      if (shortcutsChanged(next.shortcuts, prev.shortcuts)) {
        const taken = applyShortcuts();
        if (taken.length > 0)
          void pet.say({
            kind: 'answer',
            text: t('pet.shortcut.taken', { keys: taken.join(', ') }),
            ttlMs: 8000,
          });
      }
      if (next.icsUrl !== prev.icsUrl && next.icsUrl) void calendar.sync(true);
      else if (prev.icsUrl && !next.icsUrl) calendar.clear();
      if (next.myMcp && !prev.myMcp) void refreshMcpServers(log);
      if (JSON.stringify(next.friends) !== JSON.stringify(prev.friends)) {
        friends.sync();
        // 매운맛: 새 친구 펫을 꺼내면 샘이 나서 토라진다
        const added = next.friends.find((f) => !prev.friends.some((p) => p.id === f.id));
        if (added) pout.friendAdded(added.name);
      }
      // 매운맛을 끄면 토라짐도 바로 푼다
      if (next.spicy !== prev.spicy) pout.tick();
      if (next.pet3d !== prev.pet3d || next.petStyle !== prev.petStyle) friends.resendStatus();
      if (
        next.petKind !== prev.petKind ||
        next.petImage !== prev.petImage ||
        next.petModel !== prev.petModel ||
        JSON.stringify(next.petGaits) !== JSON.stringify(prev.petGaits)
      )
        sysMonitor.setKind(runnerKindNow());
      if (next.sysMonitor !== prev.sysMonitor) sysMonitor.setEnabled(next.sysMonitor);
      if (next.trayTitle !== prev.trayTitle) trayTitle.refresh();
      if (next.readAloud !== prev.readAloud) sendStatus();
      if (next.petName !== prev.petName) {
        chat.petNameChanged();
        panel.refresh();
        tray.setToolTip(t('tray.tooltip', { name: next.petName }));
      }
      // 격리 폴더와 사용자 폴더는 대화 기록이 따로라 이어 갈 수 없다. 새 대화로 시작한다.
      if (next.aiIsolation !== prev.aiIsolation) chat.resetSessions();
      if (
        next.petImage !== prev.petImage ||
        next.petModel !== prev.petModel ||
        next.petDepth !== prev.petDepth ||
        next.petAge !== prev.petAge ||
        JSON.stringify(next.petPoses) !== JSON.stringify(prev.petPoses)
      ) {
        sendPetImage();
        pet.react();
      }
      if (
        next.petKind !== prev.petKind ||
        next.pet3d !== prev.pet3d ||
        next.petStyle !== prev.petStyle ||
        next.spicy !== prev.spicy ||
        next.sounds !== prev.sounds ||
        restDaysOf(next).join() !== restDaysOf(prev).join() ||
        next.dayRhythm !== prev.dayRhythm ||
        // 걸음새는 몸마다 따로라 고른 값이 그대로여도 펫(몸)이 바뀌면 다시 본다. 같은 값이면 sendStatus 가 거른다
        pickedGait(next) !== pickedGait(prev)
      )
        sendStatus();
      if (next.launchAtLogin !== prev.launchAtLogin && app.isPackaged) {
        app.setLoginItemSettings({ openAtLogin: next.launchAtLogin });
      }
    });
    // 켤 때 자동 실행 설정을 운영체제 것에 맞춘다: 사용자가 시스템 설정에서 끈 것을 다시 켜지 않고, 설정 창도 맞게 보인다 (버그잡이 7차)
    if (app.isPackaged) {
      const atLogin = app.getLoginItemSettings().openAtLogin;
      if (atLogin !== settings.get().launchAtLogin) settings.set({ launchAtLogin: atLogin });
    }

    // 짝꿍을 한 번 더 실행하면(앱 아이콘을 다시 누르는 등) 숨은 펫을 다시 부른다. 메뉴 막대 아이콘이 가려져도 돌아올 길.
    // ---- 새 버전 알림, 첫 실행 안내 (v1) ----
    const updates = watchUpdates({ say: (o) => pet.say(o), log });
    const onboarding = createOnboarding({
      openMaker: () => maker.open(),
      ai: async () => ({
        hasCli: await chat.hasCliAi(),
        freeModelBytes: pickLocal(catalog.get(), settings.get().aiModels.local).bytes,
      }),
      // 첫 할 일 유도: 안내를 마친 뒤 처음 펫을 누르면 오늘 탭 대신 할 일 탭(입력칸에 커서)으로 연다. 할 일이 하나도 없을 때만, 한 번만.
      // 오늘 탭에 빠른 입력칸을 더하는 것보다 덜 끼어든다: 새 칸 없이 한 번 탭만 바꾸고, 다음부터는 원래대로 마지막 탭이다
      onFirstDone: () => {
        // 첫 7일 여정을 시작한다 (main/journey.ts)
        journey.start();
        const { open, doneToday } = store.list(Date.now());
        if (open.length === 0 && doneToday.length === 0) panel.openNextAt('todo');
      },
      log,
    });
    if (!settings.get().onboarded)
      pet.win.webContents.once('did-finish-load', () => setTimeout(() => onboarding.open(), 1500));

    app.on('second-instance', (_e, argv, cwd) => {
      // 주소나 .jjpet 파일을 넘기며 다시 실행한 것(윈도우, 리눅스)이면 그것만 처리한다
      if (takeArgv(argv, cwd)) return;
      pet.setHidden('user', false);
      friends.setHidden('user', false);
      void rest.call();
    });
    pet.win.webContents.once('did-finish-load', () => friends.sync());
    // ---- 다른 앱에서 부르기: jjakkung:// 주소, .jjpet 두 번 눌러 열기 ----
    registerScheme(log);
    let urlTimes: number[] = [];
    const sayShort = (text: string) => void pet.say({ kind: 'answer', text, ttlMs: 5000 });
    function handleUrl(raw: string) {
      const admitted = admitUrl(urlTimes, Date.now());
      if (!admitted) {
        log('url', '너무 잦아 버림');
        return;
      }
      urlTimes = admitted;
      if (!settings.get().urlScheme) {
        log('url', '꺼져 있음');
        sayShort(t('pet.url.off'));
        return;
      }
      const r = parseJjUrl(raw);
      if (!r.ok) {
        log('url', '거절', r.reason);
        sayShort(r.reason === 'tooLong' ? t('pet.url.tooLong') : t('pet.url.bad'));
        return;
      }
      // 글은 기록에 남기지 않는다 (할 일, 메모 내용)
      const a = r.value;
      log('url', a.action);
      if (a.action === 'add') {
        const added = panel.addLine(a.text);
        if (!added.ok) sayShort(t('pet.url.failed', { error: added.error ?? t('panel.add.empty') }));
        else if (added.kind === 'event') {
          const ev = events.get(added.id);
          const when = new Date(added.startAt).toLocaleString(locale(), {
            month: 'numeric',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
          });
          sayShort(t('pet.url.event', { title: ev?.title ?? a.text, when }));
        } else if (added.kind === 'todo')
          sayShort(t('pet.url.todo', { title: store.get(added.id)?.title ?? a.text }));
        else sayShort(t('pet.url.todos', { n: added.todos + added.events }));
        if (added.ok) petLife.activity('todo');
        return;
      }
      if (a.action === 'memo') {
        const note = notes.add({ body: a.text, source: 'me' }, Date.now());
        panel.refresh();
        sayShort(t('pet.url.memo', { title: noteTitle(note) }));
        return;
      }
      if (a.action === 'focus') {
        if (planner.focus.phase !== 'idle') {
          sayShort(t('pet.url.focusBusy'));
          return;
        }
        planner.startFocus(a.min);
        sayShort(t('pet.url.focus', { n: settings.get().focusMin }));
        return;
      }
      panel.openTab(panelTabOf(a.tab));
    }
    /** .jjpet 을 두 번 눌러 열었다: 펫 가져오기와 같은 검사, 같은 확인 창을 거친다 (backup.ts importPet) */
    async function importPetFile(path: string) {
      log('pet', '.jjpet 열기');
      const r = await importPet(undefined, false, log, path);
      if (r.message) sayShort(r.message);
    }
    const handleIncoming = (item: Incoming) => {
      if (item.kind === 'petFile') void importPetFile(item.path);
      else handleUrl(item.url);
    };
    // 펫 화면이 뜬 뒤에 받는다 (확인 말풍선이 보이게)
    pet.win.webContents.once('did-finish-load', () => setTimeout(() => startIncoming(handleIncoming), 800));
    // 맥 메뉴 막대 글자: 다음 일정이나 집중 남은 시간 (설정 편의, 기본 끔)
    const trayTitle = watchTrayTitle(tray, {
      on: () => settings.get().trayTitle,
      focus: () => planner.focus,
      events: (from, to) => events.between(from, to),
    });
    titleHook.refresh = trayTitle.refresh;
    // 집은 펫과 같이 숨고 나온다 (발표, 숨기기). 2초마다 맞춘다. 펫이 집 안에서 쉬는 동안은 집이 보인다
    pet.win.webContents.once('did-finish-load', () => house.show(houseLook(), pet.bounds()));
    // 자리를 4분쯤 비우면 펫이 집 앞으로 가서 존다 (5분부터 졸고 10분부터 잔다). 자리 비울 때마다 한 번.
    let wentHome = false;
    setInterval(() => {
      const idle = powerMonitor.getSystemIdleTime();
      if (idle < 60) wentHome = false;
      const door = house.door(pet.bounds().width);
      if (wentHome || !door || idle < 230 || idle > 290 || playing || pet.isHidden()) return;
      wentHome = true;
      void pet.walkTo(door.x - pet.bounds().width / 2, 60);
    }, 20_000).unref();
    let houseHidden = false;
    setInterval(() => {
      const hidden = pet.isHidden('user') || pet.isHidden('presentation');
      if (hidden === houseHidden) return;
      houseHidden = hidden;
      if (hidden) house.hide();
      else house.unhide();
    }, 2000).unref();
    // 친밀도 100 (손 흔들기): 5분 넘게 자리를 비웠다 돌아오면 손을 흔든다
    let away = false;
    setInterval(() => {
      const idle = powerMonitor.getSystemIdleTime();
      if (idle >= WAVE_AWAY_SEC) away = true;
      else if (away && idle < 5) {
        away = false;
        if (unlocked(petLife.state.affection).has('wave') && !pet.isHidden() && !playing) pet.react('wave');
      }
    }, 2000).unref();
    const stopPresence = watchPresentation((hide) => {
      pet.setHidden('presentation', hide);
      friends.setHidden('presentation', hide);
      sysMonitor.setPaused('presentation', hide);
    }, log);
    app.on('will-quit', () => {
      stopLocal();
      // 내 컴퓨터에서 그리기(파이썬, sd-cli)를 남겨 두지 않는다
      stopLocalDrawNow();
      // 답을 기다리던 AI CLI 를 프로세스 묶음째 끝낸다 (생각만 하는 중이면 끄고 나서도 남았다)
      stopAllAi();
      for (const acc of registered) globalShortcut.unregister(acc);
      stopPresence();
      stopPower();
      trayTitle.dispose();
      sysMonitor.dispose();
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
          petFace,
          trayImageOf,
          settings,
          settingsWindow,
          gcal,
          panel,
          store,
          stats,
          notes,
          events,
          planner,
          life,
          petLife,
          pout,
          shop,
          house,
          rest,
          toggleHidden,
          play,
          updates,
          onboarding,
          calendar,
          backup,
          achievements,
          seek,
          games,
          maker,
          friends,
          diary,
          companion,
          dayTools,
          habits,
          whatFirst,
          sayWhatFirst,
          handleUrl,
          handleIncoming,
          saverNow,
          debugBattery,
          trayTitle,
          knows,
          journey,
          wear,
          weekCard,
          // 문서 화면 찍기(scripts/dev/screens.mjs)가 그림 친구(밀크, 초코)로 바꿀 때
          library,
        },
      });
    if (process.env.JJ_METRICS) logMetrics(Number(process.env.JJ_METRICS));
  })
  .catch((err: unknown) => {
    // 시작 일 중간에 던지면 창도 단축키도 없이 프로세스만 남았다: 기록하고 알린 뒤 끝낸다 (다시 켜면 된다)
    const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
    log('error', '시작 실패', msg);
    try {
      dialog.showErrorBox(
        t('main.start.failed'),
        t('main.start.failedDetail', { error: err instanceof Error ? err.message : String(err) }),
      );
    } catch {
      // 알리지 못해도 끝낸다
    }
    app.quit();
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
    // percentCPUUsage 는 모든 코어를 합친 100% 기준이라, 코어 하나 기준(ps, 활성 상태 보기)으로 맞춘다
    const cpu = metrics.reduce((sum, m) => sum + m.cpu.percentCPUUsage, 0) * cpus().length;
    const memMB = metrics.reduce((sum, m) => sum + m.memory.workingSetSize, 0) / 1024;
    const detail = metrics.map((m) => `${m.type}:${Math.round(m.memory.workingSetSize / 1024)}`).join(' ');
    log('metrics', `cpu=${cpu.toFixed(2)}% mem=${memMB.toFixed(0)}MB procs=${metrics.length} (${detail})`);
  }, seconds * 1000);
}

app.on('window-all-closed', () => app.quit());
