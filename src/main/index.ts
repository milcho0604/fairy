import { app, globalShortcut } from 'electron';
import { IPC } from '../shared/ipc.ts';
import { createChat } from './chat.ts';
import { createLookTogether } from './look-together.ts';
import { createPetWindow } from './pet-window.ts';

const log = (tag: string, ...rest: unknown[]) => {
  if (!app.isPackaged) console.log(`[${tag}]`, ...rest);
};

// GPU 를 별도 프로세스 대신 본체 안에서 돌린다. 프로세스가 하나 줄어 메모리가 363MB 에서 306MB 로
// 줄었고 CPU 는 같았다 (2026-10-02 맥 측정, L12). 문제가 생기면 JJ_GPU_PROCESS=1 로 끈다.
if (!process.env.JJ_GPU_PROCESS) app.commandLine.appendSwitch('in-process-gpu');

// 펫은 하나만 띄운다. 두 번째로 실행하면 그냥 끝난다.
if (!app.requestSingleInstanceLock()) app.quit();

app.whenReady().then(() => {
  // 펫 앱은 Dock 아이콘 없이 뜬다. 끝내기는 펫 우클릭 메뉴에서 한다 (트레이는 나중에).
  if (process.platform === 'darwin') app.dock?.hide();
  // 이름 짓기 화면(P1-08) 전까지는 기본 이름을 쓴다.
  const petName = '콩이';
  const chat = createChat({
    petName,
    onPetAi: (state) => pet.webContents.send(IPC.ai, state),
    log,
  });
  const pet = createPetWindow({
    petName,
    actions: {
      click: (bounds) => chat.toggle(bounds),
      openChat: (bounds) => chat.open(bounds),
      lookTogether: () => look.start(),
    },
    log,
  });
  const look = createLookTogether({
    petName,
    hideOwnWindows: () => {
      const chatWin = chat.window;
      const chatWasVisible = !!chatWin && !chatWin.isDestroyed() && chatWin.isVisible();
      pet.hide();
      if (chatWasVisible) chatWin?.hide();
      return () => {
        if (!pet.isDestroyed()) pet.showInactive();
        if (chatWasVisible && chatWin && !chatWin.isDestroyed()) chatWin.show();
      };
    },
    onImage: (image) => chat.attach(image, pet.getBounds()),
    log,
  });
  // 개발용: 메인 프로세스 디버거(--inspect)에서 같이 보기, 채팅을 불러 시험할 손잡이. 배포본에는 없다.
  if (!app.isPackaged) Object.assign(globalThis, { __jj: { look, chat, pet, globalShortcut } });
  if (process.env.JJ_METRICS) logMetrics(Number(process.env.JJ_METRICS));
});

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
