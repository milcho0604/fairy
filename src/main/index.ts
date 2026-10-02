import { app, globalShortcut } from 'electron';
import { IPC } from '../shared/ipc.ts';
import { FULLNESS } from '../shared/todo-store.ts';
import { createChat } from './chat.ts';
import { openStore } from './db.ts';
import { createLookTogether } from './look-together.ts';
import { createMaker, petImageDataUrl } from './maker.ts';
import { createPanel } from './panel.ts';
import { createPetWindow } from './pet-window.ts';
import { watchPresentation } from './presence-watch.ts';
import { settings } from './settings.ts';
import { createSettingsWindow } from './settings-window.ts';
import { createTray, HIDE_SHORTCUT, QUICK_ADD_SHORTCUT } from './tray.ts';

const log = (tag: string, ...rest: unknown[]) => {
  if (!app.isPackaged) console.log(`[${tag}]`, ...rest);
};

// GPU 를 별도 프로세스 대신 본체 안에서 돌린다. 프로세스가 하나 줄어 메모리가 363MB 에서 306MB 로
// 줄었고 CPU 는 같았다 (2026-10-02 맥 측정, L12). 문제가 생기면 JJ_GPU_PROCESS=1 로 끈다.
if (!process.env.JJ_GPU_PROCESS) app.commandLine.appendSwitch('in-process-gpu');

// 펫은 하나만 띄운다. 두 번째로 실행하면 그냥 끝난다.
if (!app.requestSingleInstanceLock()) app.quit();

app.whenReady().then(() => {
  // 펫 앱은 Dock 아이콘 없이 뜬다. 끝내기는 펫 우클릭 메뉴나 메뉴 막대 아이콘에서 한다.
  if (process.platform === 'darwin') app.dock?.hide();
  // 펫 이름은 설정에서 바꿀 수 있어 쓰는 곳마다 지금 값을 읽는다.
  const petName = () => settings.get().petName;
  const chat = createChat({
    petName,
    aiIsolation: () => settings.get().aiIsolation,
    onPetAi: (state) => pet.win.webContents.send(IPC.ai, state),
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
      click: () => panel.togglePanel(),
      openChat: (bounds) => chat.open(bounds),
      lookTogether: () => look.start(),
      openSettings: () => settingsWindow.open(),
      quickAdd: () => panel.openQuick(),
      feed: () => feedPet(),
      makePet: () => maker.open(),
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
    onImage: (image) => chat.attach(image, pet.bounds()),
    log,
  });
  // ---- 방해 금지 (P1-10) ----
  const toggleHidden = () => pet.setHidden('user', !pet.isHidden('user'));
  // 숨기기 단축키는 숨은 펫을 다시 부르는 길이라 늘 걸어 둔다. 다른 앱과 겹치지 않게 네 키 조합.
  // 다른 앱이 이미 쓰고 있으면 등록이 안 된다. 켜진 뒤 펫이 말풍선으로 알린다 (P2-04 확인 항목).
  const takenShortcuts: string[] = [];
  if (!globalShortcut.register(HIDE_SHORTCUT, toggleHidden)) takenShortcuts.push('숨기기');
  const tray = createTray(petName, {
    toggleHidden,
    isHidden: () => pet.isHidden('user'),
    openChat: () => chat.open(pet.bounds()),
    openSettings: () => settingsWindow.open(),
    quickAdd: () => panel.openQuick(),
  });
  // ---- 할 일과 코인 (2단계) ----
  const store = openStore(log);
  const panel = createPanel({
    store,
    petName,
    petBounds: () => pet.bounds(),
    onCompleted: () => pet.react(),
    onFed: () => {
      pet.react();
      void pet.say({ kind: 'answer', text: '냠냠, 고마워!', ttlMs: 3000 });
    },
    onChanged: () => sendHunger(),
    openChat: () => chat.open(pet.bounds()),
    lookTogether: () => look.start(),
    log,
  });
  /** 패널 밖(펫 우클릭)에서 밥 주기 */
  function feedPet() {
    const r = store.feed(Date.now());
    if (r.ok) {
      pet.react();
      void pet.say({ kind: 'answer', text: '냠냠, 고마워!', ttlMs: 3000 });
    } else {
      void pet.say({ kind: 'answer', text: '코인이 모자라. 할 일을 하나 끝내면 생겨.', ttlMs: 4000 });
    }
    panel.refresh();
  }
  // 배부름은 시간이 흐르면 준다. 5분마다 보고 배고픈지 펫에게 알린다.
  let wasHungry: boolean | undefined;
  function sendHunger() {
    const hungry = store.fullness(Date.now()) < FULLNESS.hungry;
    if (hungry === wasHungry || pet.win.isDestroyed()) return;
    wasHungry = hungry;
    pet.win.webContents.send(IPC.status, { hungry });
  }
  pet.win.webContents.on('did-finish-load', () => {
    wasHungry = undefined;
    sendHunger();
  });
  setInterval(sendHunger, 5 * 60 * 1000);
  if (!globalShortcut.register(QUICK_ADD_SHORTCUT, () => panel.openQuick()))
    takenShortcuts.push('할 일 한 줄 넣기');
  if (takenShortcuts.length > 0) {
    log('shortcut', '등록 실패 (다른 앱이 사용 중)', takenShortcuts.join(', '));
    setTimeout(
      () =>
        void pet.say({
          kind: 'answer',
          text: `${takenShortcuts.join(', ')} 단축키를 다른 앱이 쓰고 있어. 내 우클릭 메뉴로 해 줘.`,
          ttlMs: 10_000,
        }),
      3000,
    );
  }

  // ---- 사진 펫 (P1-08) ----
  const maker = createMaker(log);
  const sendPetImage = () => {
    if (!pet.win.isDestroyed()) pet.win.webContents.send(IPC.image, petImageDataUrl());
  };
  pet.win.webContents.on('did-finish-load', sendPetImage);

  // ---- 설정 (P1-12) ----
  const settingsWindow = createSettingsWindow({
    scale: () => pet.scale(),
    setScale: (n) => pet.setScale(n),
    openMaker: () => maker.open(),
  });
  settings.onChange((next, prev) => {
    if (next.petName !== prev.petName) {
      chat.petNameChanged();
      panel.refresh();
      tray.setToolTip(`짝꿍 (${next.petName})`);
    }
    // 격리 폴더와 사용자 폴더는 대화 기록이 따로라 이어 갈 수 없다. 새 대화로 시작한다.
    if (next.aiIsolation !== prev.aiIsolation) chat.resetSessions();
    if (next.petImage !== prev.petImage) {
      sendPetImage();
      pet.react();
    }
    if (next.launchAtLogin !== prev.launchAtLogin && app.isPackaged) {
      app.setLoginItemSettings({ openAtLogin: next.launchAtLogin });
    }
  });

  // 짝꿍을 한 번 더 실행하면(앱 아이콘을 다시 누르는 등) 숨은 펫을 다시 부른다. 메뉴 막대 아이콘이 가려져도 돌아올 길.
  app.on('second-instance', () => pet.setHidden('user', false));
  const stopPresence = watchPresentation((hide) => pet.setHidden('presentation', hide), log);
  app.on('will-quit', () => {
    globalShortcut.unregister(HIDE_SHORTCUT);
    globalShortcut.unregister(QUICK_ADD_SHORTCUT);
    stopPresence();
    tray.destroy();
  });

  // 개발용: 메인 프로세스 디버거(--inspect)에서 같이 보기, 채팅을 불러 시험할 손잡이. 배포본에는 없다.
  if (!app.isPackaged)
    Object.assign(globalThis, {
      __jj: { look, chat, pet, globalShortcut, tray, settings, settingsWindow, panel, store, maker },
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
