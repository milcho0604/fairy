import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { BrowserWindow, type IpcMainEvent, ipcMain, type Rectangle, screen } from 'electron';
import { type Catalog, pickCli, pickLocal } from '../shared/ai/catalog.ts';
import { extractTodos, noteTitleFromQuestion, type PersonaId, persona } from '../shared/ai/persona.ts';
import {
  BUILTIN_PROVIDERS,
  type CustomProviderInput,
  customProvider,
  type ProviderSpec,
} from '../shared/ai/providers.ts';
import { withHistory } from '../shared/ai/text.ts';
import type { AiEvent, AiProvider } from '../shared/ai/types.ts';
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
import { getLang, t } from '../shared/i18n/index.ts';
import {
  CHAT,
  type ChatSnapshot,
  type OutgoingImage,
  type PetAiState,
  type ProviderView,
} from '../shared/ipc.ts';
import { prepareCodexHome } from './ai/codex-home.ts';
import { downloadLocalModel, runLocal } from './ai/local.ts';
import { type AiRun, checkStatus, readCodexUsage, runAi } from './ai/runner.ts';
import { getShellEnv } from './ai/shell-env.ts';
import { focusWindow, showWindow, stealFocus } from './focus.ts';
import { langArg } from './lang.ts';
import { readJson, writeJson } from './store.ts';

const CHAT_SIZE = { width: 400, height: 600 };
const SETTINGS_FILE = 'chat-settings';
const USAGE_FILE = 'ai-usage';
/** 사용자가 추가한 AI (이름, 명령, 인자). */
const CUSTOM_FILE = 'ai-custom';

export interface ChatOptions {
  /** 모델 목록 (v2, 하루 한 번 받아 바뀐다) */
  catalog: () => Catalog;
  /** AI 마다 고른 모델 (설정) */
  aiModels: () => Record<string, string>;
  /** 지금 펫 이름 (설정에서 바뀔 수 있어 쓸 때마다 읽는다) */
  petName: () => string;
  /** AI 를 사용자 설정 없이 격리해서 부를지 (설정) */
  aiIsolation: () => boolean;
  /** 펫 성격 (설정) */
  personaId: () => PersonaId;
  /** 내 할 일 같이 보내기 (설정). 켜면 todoContext() 를 질문 앞에 붙인다 */
  knowsTodos: () => boolean;
  setKnowsTodos: (on: boolean) => void;
  todoContext: () => string;
  /** 답을 메모로 */
  saveNote: (title: string, body: string) => void;
  /** 답을 할 일로. 넣은 개수 */
  addTodos: (titles: string[]) => number;
  /** 내 MCP 도구를 쓸 서버 이름 (v2). 안 쓰면 빈 목록 */
  mcpServers: () => readonly string[];
  /** 펫에게 AI 상태를 알린다 (생각 중, 답함). */
  onPetAi: (state: PetAiState) => void;
  /** 답이 다 왔다. 채팅 창이 앞에 없으면 펫이 말풍선으로 알린다. */
  onAnswer?: (text: string, chatInFront: boolean) => void;
  log: (tag: string, ...rest: unknown[]) => void;
}

/**
 * 채팅 상태와 채팅 창. 상태는 메인에 두어 창을 닫아도 대화가 남는다.
 * 창은 열 때 만들고 닫으면 없앤다 (L6: 메모리).
 */
export function createChat(o: ChatOptions) {
  const { petName, aiIsolation, onPetAi, onAnswer, log } = o;
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

  const push = () => {
    state = { ...state, knowsTodos: o.knowsTodos() };
    win?.webContents.send(CHAT.state, state);
  };
  const fromChat = (e: IpcMainEvent | Electron.IpcMainInvokeEvent) => !!win && e.sender === win.webContents;

  // 처음(고른 적 없음)이면 자동으로: 설치되고 로그인된 AI 가 있으면 그것, 없으면 무료 AI (v2).
  // 확인하는 몇 초 사이에 사용자가 직접 고르면 그 선택을 따른다
  let userPicked = false;
  if (!saved?.provider) {
    void (async () => {
      for (const id of ['claude', 'codex', 'cursor', 'gemini']) {
        const spec = specOf(id);
        const st = spec ? await checkStatus(spec) : undefined;
        if (st?.installed && st.loggedIn !== false) {
          if (userPicked) return;
          if (id !== state.provider && !state.pendingId) state = switchProvider(state, id);
          log('chat', 'auto provider', id);
          push();
          return;
        }
      }
      if (userPicked) return;
      if (!state.pendingId) state = switchProvider(state, 'local');
      log('chat', 'auto provider', 'local');
      push();
    })();
  }

  ipcMain.handle(CHAT.snapshot, (e): ChatSnapshot | undefined => {
    if (!fromChat(e)) return undefined;
    state = { ...state, knowsTodos: o.knowsTodos() };
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
    if (!fromChat(e)) return { ok: false, error: t('chat.reopenWindow') };
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
    if (fromChat(e)) ask(text, images);
  });

  /** 질문을 보낸다. 채팅 창의 보내기와 메모 "AI로 정리"가 같이 쓴다. 답을 기다리는 중이면 false */
  function ask(text: string, images: OutgoingImage[] = []): boolean {
    if (state.pendingId) return false;
    const question = text.trim();
    if (!question && images.length === 0) return false;
    const ids = { user: randomUUID(), pet: randomUUID() };
    const provider = state.provider;
    const spec = specOf(provider);
    if (!spec) return false;
    const history = historyFor(state, provider);
    // 기록 남기지 않기: 이어가기 대신 최근 대화를 붙여 보낸다 (claude, codex 만 켤 수 있다).
    const ephemeral = !!state.ephemeral && (spec.adapter === 'claude' || spec.adapter === 'codex');
    const base = question || t('chat.lookQuestion');
    const context = o.knowsTodos() ? o.todoContext() : '';
    const prompt = context + (ephemeral ? withHistory(history, base) : base);
    state = addQuestion(
      state,
      ids,
      question,
      images.map((i) => i.thumb),
    );
    push();
    onPetAi({ thinking: true, answered: false });
    const started = Date.now();
    log(
      'chat',
      'send',
      provider,
      `images=${images.length}`,
      ephemeral ? 'ephemeral' : '',
      context ? 'todos' : '',
    );

    const req = {
      spec,
      history,
      text: prompt,
      // 그림을 못 받는 AI 에는 글만 보낸다. 화면이 미리 알려 준다.
      images: spec.images ? images.map((i) => i.full) : [],
      sessionId: ephemeral ? undefined : state.sessions[provider]?.id,
      persona: persona(petName(), o.personaId()),
      isolate: aiIsolation(),
      ephemeral,
      mcpServers: aiIsolation() ? [] : o.mcpServers(),
      // 고른 모델 (v2). 목록에 없으면 그 AI 의 기본
      model: pickCli(o.catalog(), provider, o.aiModels()[provider]),
    };
    const onEvent = (event: AiEvent) => {
      state = applyEvent(state, ids.pet, event, randomUUID());
      if (event.type === 'usage') writeJson(USAGE_FILE, state.usage);
      // 기록을 안 남긴 세션은 이어 갈 수 없다. 받아 두지 않는다.
      if (ephemeral && event.type === 'session')
        state = { ...state, sessions: { ...state.sessions, [provider]: undefined } };
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
    };
    run =
      spec.adapter === 'local'
        ? runLocal(req, pickLocal(o.catalog(), o.aiModels().local), onEvent, log, {
            // 한국어이고 존댓말 성격이 아니면 반말 예시와 어미 고치기
            banmal: getLang() === 'ko' && o.personaId() !== 'polite',
            petName: petName(),
          })
        : runAi(req, onEvent);
    return true;
  }

  // 무료 AI 모델 받기 (v2). 사용자가 받기를 눌렀을 때만 받는다. 다 받으면 마지막 질문을 다시 묻는다
  let downloading: AbortController | undefined;
  ipcMain.on(CHAT.downloadModel, (e) => {
    if (!fromChat(e) || downloading) return;
    const model = pickLocal(o.catalog(), o.aiModels().local);
    downloading = new AbortController();
    state = { ...state, modelDownload: { pct: 0 } };
    push();
    log('chat', 'model download', model.id);
    downloadLocalModel(
      model,
      (r) => {
        state = { ...state, modelDownload: { pct: Math.round(r * 100) } };
        push();
      },
      downloading.signal,
    )
      .then(() => {
        state = { ...state, modelDownload: undefined };
        push();
        // 받는 사이 다른 AI 로 바꿨으면 그대로 둔다. 무료 AI 그대로면 마지막 질문을 다시 묻는다
        if (state.provider !== 'local' || state.pendingId) return;
        const lastUser = [...state.messages].reverse().find((m) => m.role === 'user');
        if (lastUser?.text) ask(lastUser.text);
      })
      .catch((err) => {
        const aborted = downloading?.signal.aborted;
        log(
          'chat',
          'model download',
          aborted ? 'cancelled' : 'failed',
          err instanceof Error ? err.message : String(err),
        );
        state = { ...state, modelDownload: aborted ? undefined : { pct: 0, failed: true } };
        push();
      })
      .finally(() => {
        downloading = undefined;
      });
  });

  ipcMain.on(CHAT.setEphemeral, (e, on: boolean) => {
    if (!fromChat(e) || state.pendingId) return;
    // 켜고 끌 때 새 대화로: 안 남긴 대화는 이어 갈 수 없고, 남긴 대화를 안 남긴 채 이어 갈 수도 없다.
    state = { ...resetChat(state), ephemeral: !!on };
    push();
  });
  ipcMain.on(CHAT.setKnowsTodos, (e, on: boolean) => {
    if (!fromChat(e)) return;
    o.setKnowsTodos(!!on);
    push();
  });
  /** 답 메시지와 그 앞 질문 */
  const answerOf = (id: string) => {
    const i = state.messages.findIndex((m) => m.id === id);
    const a = state.messages[i];
    if (a?.role !== 'pet' || a.status !== 'done' || !a.text.trim()) return undefined;
    const q = state.messages[i - 1];
    return { answer: a.text, question: q?.role === 'user' ? q.text : '' };
  };
  ipcMain.handle(CHAT.toNote, (e, id: string) => {
    const r = fromChat(e) ? answerOf(id) : undefined;
    if (!r) return false;
    o.saveNote(noteTitleFromQuestion(r.question), r.answer);
    log('chat', 'to-note');
    return true;
  });
  ipcMain.handle(CHAT.toTodos, (e, id: string) => {
    const r = fromChat(e) ? answerOf(id) : undefined;
    if (!r) return 0;
    const n = o.addTodos(extractTodos(r.answer));
    log('chat', 'to-todos', n);
    return n;
  });
  ipcMain.on(CHAT.retryWith, (e, provider: AiProvider) => {
    if (!fromChat(e) || state.pendingId || !specOf(provider)) return;
    userPicked = true;
    // 마지막 질문을 찾아 그 AI 로 다시 묻는다 (그림은 다시 보내지 않는다: 원본을 상태에 두지 않는다).
    const lastUser = [...state.messages].reverse().find((m) => m.role === 'user');
    state = switchProvider(state, provider);
    writeJson(SETTINGS_FILE, { provider: state.provider });
    push();
    if (lastUser?.text) ask(lastUser.text);
  });

  ipcMain.on(CHAT.cancel, (e) => {
    if (!fromChat(e)) return;
    run?.cancel();
    downloading?.abort(); // 모델 받기도 멈춘다 (받기 진행 옆 취소 단추)
  });
  ipcMain.on(CHAT.reset, (e) => {
    if (!fromChat(e)) return;
    state = resetChat(state);
    push();
  });
  ipcMain.on(CHAT.provider, (e, provider: AiProvider) => {
    if (!fromChat(e) || !specOf(provider)) return;
    userPicked = true;
    state = switchProvider(state, provider);
    writeJson(SETTINGS_FILE, { provider: state.provider });
    push();
  });

  function open(near?: Rectangle) {
    // 펫 앱은 Dock 없이 떠 있어서 창만 앞으로 부르면 키보드가 다른 앱에 남는다. 사용자가 부른 것이니 앱을 앞으로.
    stealFocus();
    if (win && !win.isDestroyed()) {
      focusWindow(win);
      return;
    }
    win = new BrowserWindow({
      ...placeNear(near),
      title: t('chat.title', { name: petName() }),
      minWidth: 320,
      minHeight: 360,
      show: false,
      // 맥은 제목 표시줄을 내용과 합쳐 한 장처럼 보이게 한다. 창 이동은 머리줄을 잡고 한다.
      ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const } : {}),
      webPreferences: {
        preload: join(import.meta.dirname, '../preload/index.cjs'),
        additionalArguments: ['--jj-window=chat', langArg()],
        sandbox: true,
        contextIsolation: true,
      },
    });
    win.once('ready-to-show', () => showWindow(win));
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
    /** 창을 열고 질문을 보낸다 (메모 "AI로 정리"). 답을 기다리는 중이면 false */
    askInWindow(text: string, near?: Rectangle): boolean {
      open(near);
      return ask(text);
    },
    get window() {
      return win;
    },
    /** 설정에서 펫 이름이 바뀌었다. 열린 채팅 창에 알린다. */
    petNameChanged() {
      if (!win || win.isDestroyed()) return;
      win.setTitle(t('chat.title', { name: petName() }));
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
    ephemeral: p.adapter === 'claude' || p.adapter === 'codex',
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
