import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { app, BrowserWindow, type IpcMainEvent, ipcMain, type Rectangle, screen } from 'electron';
import {
  BUILTIN_PROVIDERS,
  type CustomProviderInput,
  customProvider,
  type ProviderSpec,
} from '../shared/ai/providers.ts';
import type { AiProvider } from '../shared/ai/types.ts';
import {
  addQuestion,
  applyEvent,
  applyUsage,
  type ChatState,
  historyFor,
  initialChat,
  resetChat,
  switchProvider,
} from '../shared/chat-state.ts';
import { clampIntoAreas } from '../shared/geometry.ts';
import {
  CHAT,
  type ChatSnapshot,
  type OutgoingImage,
  type PetAiState,
  type ProviderView,
} from '../shared/ipc.ts';
import { withParticle } from '../shared/josa.ts';
import { prepareCodexHome } from './ai/codex-home.ts';
import { type AiRun, checkStatus, readCodexUsage, runAi } from './ai/runner.ts';
import { getShellEnv } from './ai/shell-env.ts';
import { readJson, writeJson } from './store.ts';

const CHAT_SIZE = { width: 400, height: 600 };
const SETTINGS_FILE = 'chat-settings';
const USAGE_FILE = 'ai-usage';
/** 사용자가 추가한 AI (이름, 명령, 인자). */
const CUSTOM_FILE = 'ai-custom';

export interface ChatOptions {
  /** 지금 펫 이름 (설정에서 바뀔 수 있어 쓸 때마다 읽는다) */
  petName: () => string;
  /** AI 를 사용자 설정 없이 격리해서 부를지 (설정) */
  aiIsolation: () => boolean;
  /** 펫에게 AI 상태를 알린다 (생각 중, 답함). */
  onPetAi: (state: PetAiState) => void;
  /** 답이 다 왔다. 채팅 창이 앞에 없으면 펫이 말풍선으로 알린다. */
  onAnswer?: (text: string, chatInFront: boolean) => void;
  log: (tag: string, ...rest: unknown[]) => void;
}

/** 펫 성격 지시. 이모지는 기본으로 쓰지 않는다 (D5, 설정으로 바꿀 수 있게 할 자리). */
export function persona(petName: string): string {
  return [
    `너는 사용자 컴퓨터 화면 위에 사는 데스크톱 펫 "${petName}"다. 옆자리 짝꿍처럼 반말로 다정하게 말한다.`,
    '답은 짧게, 핵심부터. 길게 설명해야 하면 목록으로 나눈다.',
    '사용자가 화면 캡처를 보내면 그 화면을 같이 보고 있다고 생각하고 답한다.',
    '이모지는 쓰지 않는다.',
  ].join(' ');
}

/**
 * 채팅 상태와 채팅 창. 상태는 메인에 두어 창을 닫아도 대화가 남는다.
 * 창은 열 때 만들고 닫으면 없앤다 (L6: 메모리).
 */
export function createChat({ petName, aiIsolation, onPetAi, onAnswer, log }: ChatOptions) {
  // 사용자가 추가한 AI 는 입력값만 저장하고 켤 때마다 정의를 다시 만든다 (검사 규칙이 바뀌어도 맞게).
  let customInputs = (
    (readJson(CUSTOM_FILE) as { id: string; input: CustomProviderInput }[] | undefined) ?? []
  ).filter((c) => c?.id?.startsWith('custom-') && c.input);
  const providers = (): ProviderSpec[] => [
    ...BUILTIN_PROVIDERS,
    ...customInputs.flatMap((c) => {
      const spec = customProvider(c.input, c.id);
      return typeof spec === 'string' ? [] : [spec];
    }),
  ];
  const specOf = (id: AiProvider) => providers().find((p) => p.id === id);

  const saved = readJson(SETTINGS_FILE) as { provider?: AiProvider } | undefined;
  // 사용량은 마지막으로 본 값을 남겨 두었다가 창을 열자마자 보여 준다 (몇 분 전 값인지 같이 표시).
  const savedUsage = (readJson(USAGE_FILE) ?? {}) as ChatState['usage'];
  const startProvider = saved?.provider && specOf(saved.provider) ? saved.provider : 'claude';
  let state: ChatState = initialChat(startProvider, savedUsage);
  let run: AiRun | undefined;
  let win: BrowserWindow | undefined;
  let draft: OutgoingImage[] = [];

  const push = () => win?.webContents.send(CHAT.state, state);
  const fromChat = (e: IpcMainEvent | Electron.IpcMainInvokeEvent) => !!win && e.sender === win.webContents;

  ipcMain.handle(CHAT.snapshot, (e): ChatSnapshot | undefined => {
    if (!fromChat(e)) return undefined;
    const snapshot = { petName: petName(), state, draft };
    draft = [];
    return snapshot;
  });

  ipcMain.handle(CHAT.status, async (e, refresh: boolean) => {
    if (!fromChat(e)) return [];
    // codex 는 질문 없이도 최근 대화 기록에서 사용량을 읽을 수 있다. 창을 열 때 한 번 갱신한다.
    // 파일에서 읽은 값은 기준 시각이 "지금"이 되므로 저장해 둔 값이 없을 때만 쓴다.
    if (!state.usage.codex) {
      const home = prepareCodexHome((await getShellEnv()).codexHome);
      const latest = home ? readCodexUsage(home) : undefined;
      if (latest) {
        state = applyUsage(state, latest);
        writeJson(USAGE_FILE, state.usage);
        push();
      }
    }
    return Promise.all(providers().map((p) => checkStatus(p, refresh)));
  });

  ipcMain.handle(CHAT.providers, (e): ProviderView[] => (fromChat(e) ? providers().map(view) : []));

  ipcMain.handle(CHAT.addProvider, (e, input: CustomProviderInput) => {
    if (!fromChat(e)) return { ok: false, error: '창을 다시 열어 줘.' };
    const id = `custom-${randomUUID().slice(0, 8)}`;
    const spec = customProvider(input, id);
    if (typeof spec === 'string') return { ok: false, error: spec };
    customInputs = [...customInputs, { id, input }];
    writeJson(CUSTOM_FILE, customInputs);
    log('chat', 'provider added', spec.label);
    return { ok: true, id };
  });

  ipcMain.handle(CHAT.removeProvider, (e, id: AiProvider) => {
    if (!fromChat(e) || !id.startsWith('custom-') || state.pendingId) return;
    customInputs = customInputs.filter((c) => c.id !== id);
    writeJson(CUSTOM_FILE, customInputs);
    if (state.provider === id) {
      state = switchProvider(state, 'claude');
      writeJson(SETTINGS_FILE, { provider: state.provider });
    }
    push();
  });

  ipcMain.on(CHAT.send, (e, text: string, images: OutgoingImage[]) => {
    if (!fromChat(e) || state.pendingId) return;
    const question = text.trim();
    if (!question && images.length === 0) return;
    const ids = { user: randomUUID(), pet: randomUUID() };
    const provider = state.provider;
    const spec = specOf(provider);
    if (!spec) return;
    const history = historyFor(state, provider);
    state = addQuestion(
      state,
      ids,
      question,
      images.map((i) => i.thumb),
    );
    push();
    onPetAi({ thinking: true, answered: false });
    const started = Date.now();
    log('chat', 'send', provider, `images=${images.length}`);

    run = runAi(
      {
        spec,
        history,
        text: question || '이 화면 같이 봐 줘.',
        // 그림을 못 받는 AI 에는 글만 보낸다. 화면이 미리 알려 준다.
        images: spec.images ? images.map((i) => i.full) : [],
        sessionId: state.sessions[provider]?.id,
        persona: persona(petName()),
        isolate: aiIsolation(),
      },
      (event) => {
        state = applyEvent(state, ids.pet, event, randomUUID());
        if (event.type === 'usage') writeJson(USAGE_FILE, state.usage);
        if (event.type === 'delta') {
          const msg = state.messages.find((m) => m.id === ids.pet);
          win?.webContents.send(CHAT.delta, ids.pet, msg?.text ?? '');
          return;
        }
        if (event.type === 'done' || event.type === 'error') {
          run = undefined;
          onPetAi({ thinking: false, answered: event.type === 'done' });
          if (event.type === 'done') {
            const inFront = !!win && !win.isDestroyed() && win.isVisible() && win.isFocused();
            onAnswer?.(event.text, inFront);
          }
          log(
            'chat',
            event.type,
            provider,
            `${Date.now() - started}ms`,
            event.type === 'error' ? event.error.kind : '',
          );
        }
        push();
      },
    );
  });

  ipcMain.on(CHAT.cancel, (e) => {
    if (fromChat(e)) run?.cancel();
  });
  ipcMain.on(CHAT.reset, (e) => {
    if (!fromChat(e)) return;
    state = resetChat(state);
    push();
  });
  ipcMain.on(CHAT.provider, (e, provider: AiProvider) => {
    if (!fromChat(e) || !specOf(provider)) return;
    state = switchProvider(state, provider);
    writeJson(SETTINGS_FILE, { provider: state.provider });
    push();
  });

  function open(near?: Rectangle) {
    // 펫 앱은 Dock 없이 떠 있어서 창만 앞으로 부르면 키보드가 다른 앱에 남는다. 사용자가 부른 것이니 앱을 앞으로.
    if (process.platform === 'darwin') app.focus({ steal: true });
    if (win && !win.isDestroyed()) {
      win.show();
      win.focus();
      return;
    }
    win = new BrowserWindow({
      ...placeNear(near),
      title: `${withParticle(petName(), '과')} 대화`,
      minWidth: 320,
      minHeight: 360,
      show: false,
      // 맥은 제목 표시줄을 내용과 합쳐 한 장처럼 보이게 한다. 창 이동은 머리줄을 잡고 한다.
      ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const } : {}),
      webPreferences: {
        preload: join(import.meta.dirname, '../preload/index.cjs'),
        additionalArguments: ['--jj-window=chat'],
        sandbox: true,
        contextIsolation: true,
      },
    });
    win.once('ready-to-show', () => win?.show());
    win.on('closed', () => {
      win = undefined;
    });
    // 채팅 창 안의 링크는 앱 안에서 열지 않는다.
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (ev) => ev.preventDefault());

    const devUrl = process.env.ELECTRON_RENDERER_URL;
    if (devUrl) win.loadURL(`${devUrl}/chat.html`);
    else win.loadFile(join(import.meta.dirname, '../renderer/chat.html'));
  }

  function toggle(near?: Rectangle) {
    if (win && !win.isDestroyed() && win.isVisible() && win.isFocused()) win.close();
    else open(near);
  }

  /** 같이 보기로 찍은 그림을 입력칸에 붙인다. 창이 아직 없으면 열면서 넘긴다. 보내지는 않는다. */
  function attach(image: OutgoingImage, near?: Rectangle) {
    if (win && !win.isDestroyed() && !win.webContents.isLoading()) {
      win.webContents.send(CHAT.attach, image);
      open(near);
    } else {
      draft.push(image);
      open(near);
    }
  }

  return {
    open,
    toggle,
    attach,
    get window() {
      return win;
    },
    /** 설정에서 펫 이름이 바뀌었다. 열린 채팅 창에 알린다. */
    petNameChanged() {
      if (!win || win.isDestroyed()) return;
      win.setTitle(`${withParticle(petName(), '과')} 대화`);
      win.webContents.send(CHAT.petName, petName());
    },
    /** AI 격리 설정이 바뀌면 대화 세션을 끊는다 (격리 폴더와 사용자 폴더의 기록이 달라 이어 갈 수 없다). */
    resetSessions() {
      state = { ...state, sessions: {} };
      push();
    },
    /** 개발용: 디자인 점검 때 상태를 직접 넣는다. 메인 디버거에서만 부른다(index.ts 의 __jj). */
    debugSetState(next: (s: ChatState) => ChatState) {
      state = next(state);
      push();
    },
    get debugState() {
      return state;
    },
  };
}

function view(p: ProviderSpec): ProviderView {
  return {
    id: p.id,
    label: p.label,
    images: p.images,
    verified: p.verified,
    usage: p.usage,
    custom: !!p.custom,
    installHint: p.installHint,
    loginHint: p.loginHint,
    command: p.command,
  };
}

/** 펫 옆(왼쪽, 자리가 없으면 오른쪽)에 펫 아래쪽에 맞춰 둔다. */
function placeNear(near?: Rectangle) {
  const area = near ? screen.getDisplayMatching(near).workArea : screen.getPrimaryDisplay().workArea;
  if (!near) return { ...CHAT_SIZE, x: area.x + area.width - CHAT_SIZE.width - 40, y: area.y + 40 };
  const gap = 8;
  const leftX = near.x - CHAT_SIZE.width - gap;
  const x = leftX >= area.x ? leftX : near.x + near.width + gap;
  const y = near.y + near.height - CHAT_SIZE.height;
  return clampIntoAreas({ x, y, ...CHAT_SIZE }, [area]);
}
