import { randomUUID } from 'node:crypto';
import { statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { app, BrowserWindow, type IpcMainEvent, ipcMain, type Rectangle, screen } from 'electron';
import { type Catalog, pickCli, pickLocal } from '../shared/ai/catalog.ts';
import { finalAnswer } from '../shared/ai/empty-answer.ts';
import {
  extractTodos,
  noteTitleFromQuestion,
  type PersonaId,
  persona,
  ticketVoice,
  turnPrompt,
} from '../shared/ai/persona.ts';
import {
  BUILTIN_PROVIDERS,
  type CustomProviderInput,
  customProvider,
  type ProviderSpec,
  TICKET_PROVIDER,
  TICKET_PROVIDER_ID,
} from '../shared/ai/providers.ts';
import { type Exchange, withHistory } from '../shared/ai/text.ts';
import type { AiEvent, AiProvider, ImageAttachment } from '../shared/ai/types.ts';
import type { AiUsage } from '../shared/ai/usage.ts';
import { cleanSendImages } from '../shared/capture.ts';
import {
  addQuestion,
  applyEvent,
  applyUsage,
  type ChatMessage,
  type ChatState,
  historyFor,
  initialChat,
  parseChat,
  resetChat,
  serializeChat,
  switchProvider,
  UNDO_RESET_MS,
  undoReset,
} from '../shared/chat-state.ts';
import { isThreadId, staleSessions } from '../shared/chat-threads.ts';
import { downloadErrorText } from '../shared/download-error.ts';
import { clampIntoAreas } from '../shared/geometry.ts';
import { getLang, t } from '../shared/i18n/index.ts';
import {
  CHAT,
  type ChatSnapshot,
  type OutgoingImage,
  type PetAiState,
  type ProviderView,
  type ThreadList,
} from '../shared/ipc.ts';
import { isBanmal } from '../shared/persona-voice.ts';
import { textAiOrder } from '../shared/pet3d/text-prompt.ts';
import { isWhatFirstQuestion } from '../shared/what-first.ts';
import { prepareCodexHome } from './ai/codex-home.ts';
import { downloadLocalModel, localModelReady, mb, runLocal } from './ai/local.ts';
import { type AiRun, checkStatus, readCodexUsage, runAi } from './ai/runner.ts';
import { getShellEnv } from './ai/shell-env.ts';
import { runTicket, type TicketHooks } from './ai/ticket.ts';
import { createThreadStore } from './chat-threads.ts';
import { devRendererUrl } from './dev-url.ts';
import { focusWindow, showWindow } from './focus.ts';
import { langArg } from './lang.ts';
import { jjMcpLaunch } from './mcp-launch.ts';
import { openLink } from './open-link.ts';
import { readJson, writeJson } from './store.ts';
import { rememberBounds, savedBounds } from './window-bounds.ts';

const CHAT_SIZE = { width: 400, height: 600 };
const CHAT_MIN = { width: 320, height: 360 };
const SETTINGS_FILE = 'chat-settings';
const USAGE_FILE = 'ai-usage';
/** 사용자가 추가한 AI (이름, 명령, 인자). */
const CUSTOM_FILE = 'ai-custom';
/** 다시 켜도 남는 대화 (최근 메시지와 이어갈 세션, chat-state.ts serializeChat) */
const HISTORY_FILE = 'chat-history';

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
  /** 짝꿍 규칙 (6단계, 설정) */
  rules: () => string;
  /** 내 할 일 같이 보내기 (설정). 켜면 todoContext() 를 질문 앞에 붙인다 */
  knowsTodos: () => boolean;
  setKnowsTodos: (on: boolean) => void;
  /** 짝꿍 도구 쓰기 (설정). 켜면 claude, codex 에 펫 MCP 서버를 실어 할 일, 메모, 일정을 만지게 한다 */
  petTools: () => boolean;
  /** 답이 끝났다 (답, 오류, 멈춤 모두). 짝꿍 도구로 바뀐 할 일을 패널에 바로 보인다 */
  onTurnEnd?: () => void;
  todoContext: () => string;
  /** 답을 메모로 */
  saveNote: (title: string, body: string) => void;
  /** 답을 할 일로. 넣은 개수 */
  addTodos: (titles: string[]) => number;
  /** 내 MCP 도구를 쓸 서버 이름 (v2). 안 쓰면 빈 목록 */
  mcpServers: () => readonly string[];
  /** 펫에게 AI 상태를 알린다 (생각 중, 답함). */
  onPetAi: (state: PetAiState) => void;
  /** 사용자가 채팅 창에서 보낸 말 (매운맛: 칭찬이나 사과면 토라진 펫이 풀린다). 보내졌을 때만 */
  onUserSaid?: (text: string) => void;
  /** 답이 다 왔다. 채팅 창이 앞에 없으면 펫이 말풍선으로 알린다. */
  onAnswer?: (text: string, chatInFront: boolean) => void;
  /**
   * "오늘 뭐부터 할까?" 규칙 답 (main/what-first.ts). AI 가 없거나(설치, 로그인 안 됨) 무료 AI 면 이 답을 바로 주고,
   * 클라우드 AI 면 AI 에 묻되 할 일 같이 보내기를 켰을 때 이 순서를 자료로 붙인다
   */
  whatFirst?: {
    answer: () => { text: string; focusTodoId?: number };
    context: () => string;
  };
  /** 규칙 답 아래 단추: 집중 시작(그 할 일로), 패널 열기 */
  onPlanAction?: (kind: 'focus' | 'panel', todoId?: number) => void;
  /** 강제 업데이트 전이라 AI 대화를 잠갔는지. 잠겼으면 창을 열지도 묻지도 않고 onLocked 를 부른다 */
  locked?: () => boolean;
  /** 잠긴 대화를 쓰려 했다 (펫이 까닭을 말한다) */
  onLocked?: () => void;
  /**
   * AI 없이 하는 말놀이 (끝말잇기, main/fun.ts). turn 이 글을 돌려주면 AI 에 보내지 않고 그 글로 바로 답한다.
   * undefined 면 보통 대화. 새 대화를 열면 reset
   */
  localGame?: { turn: (text: string) => string | undefined; reset: () => void };
  /**
   * AI 대화권 (#100, main/server.ts). 서버 모드, 만 18세 이상, 구글 로그인일 때만 "대화권 Claude" 가 목록에 들어간다.
   * 서버 주소가 비거나 14~17 이면 목록에도 화면에도 없다
   */
  ticket?: TicketHooks;
  log: (tag: string, ...rest: unknown[]) => void;
}

/**
 * 채팅 상태와 채팅 창. 상태는 메인에 두어 창을 닫아도 대화가 남는다.
 * 창은 열 때 만들고 닫으면 없앤다 (L6: 메모리).
 */
export function createChat(o: ChatOptions) {
  const { petName, aiIsolation, onPetAi, onAnswer, log } = o;
  // 사용자가 추가한 AI 는 입력값만 저장하고 켤 때마다 정의를 다시 만든다 (검사 규칙이 바뀌어도 맞게).
  // 파일이 깨졌거나 모양이 다르면(손으로 고침, 옛 판) 그 줄만 버린다. 여기서 던지면 앱이 반쯤 켜진 채 멈췄다
  const rawCustom = readJson(CUSTOM_FILE);
  let customInputs = (Array.isArray(rawCustom) ? rawCustom : []).filter(
    (c): c is { id: string; input: CustomProviderInput } =>
      typeof c?.id === 'string' &&
      c.id.startsWith('custom-') &&
      typeof c.input === 'object' &&
      c.input !== null,
  );
  const providers = (): ProviderSpec[] => [
    ...(o.ticket?.available() ? [TICKET_PROVIDER] : []),
    ...BUILTIN_PROVIDERS,
    ...customInputs.flatMap((c) => {
      try {
        const spec = customProvider(c.input, c.id);
        return typeof spec === 'string' ? [] : [spec];
      } catch {
        return [];
      }
    }),
  ];
  const specOf = (id: AiProvider) => providers().find((p) => p.id === id);

  const saved = readJson(SETTINGS_FILE) as { provider?: AiProvider } | undefined;
  // 사용량은 마지막으로 본 값을 남겨 두었다가 창을 열자마자 보여 준다 (몇 분 전 값인지 같이 표시).
  const savedUsage = usageOf(readJson(USAGE_FILE));
  const startProvider = saved?.provider && specOf(saved.provider) ? saved.provider : 'claude';
  // 지난번 대화를 이어 보여 준다. 세션도 같이 읽어 다음 질문이 --resume 으로 이어진다
  const history = parseChat(readJson(HISTORY_FILE));
  let state: ChatState = { ...initialChat(startProvider, savedUsage), ...history };
  // 지난 대화 목록 (chat-threads.ts). 옛 판에서 올라왔으면 지금 대화가 목록 첫 항목으로 들어간다
  const threads = createThreadStore(app.getPath('userData'), {
    history,
    historyAt: mtimeOf(join(app.getPath('userData'), `${HISTORY_FILE}.json`)),
    isolated: aiIsolation(),
    log: (...rest) => log('chat', ...rest),
    // 깨진 대화 파일은 옆으로 옮기고(json-file.ts) 그 대화만 못 연다. 이름만 남긴다
    onTrouble: (tr) => log('chat', 'thread file broken', basename(tr.file)),
  });
  let run: AiRun | undefined;
  let win: BrowserWindow | undefined;
  let draft: OutgoingImage[] = [];
  /** 그림 때문에 AI 쪽에 저장하지 않은 문답. 그 AI 의 다음 질문에 글로 붙여 이어 간다 */
  const carry = new Map<AiProvider, Exchange[]>();

  const push = () => {
    const ticketOn = !!o.ticket?.available();
    // 대화권을 고른 채 로그아웃하거나 나이를 바꾸면 쓸 수 없다: 기본 AI 로 돌린다
    if (!ticketOn && state.provider === TICKET_PROVIDER_ID && !state.pendingId)
      state = switchProvider(state, 'claude');
    state = {
      ...state,
      knowsTodos: o.knowsTodos(),
      ticket: ticketOn && o.ticket ? { tickets: o.ticket.tickets(), agreed: o.ticket.agreed() } : undefined,
    };
    win?.webContents.send(CHAT.state, state);
  };
  const fromChat = (e: IpcMainEvent | Electron.IpcMainInvokeEvent) => !!win && e.sender === win.webContents;
  /**
   * 대화를 파일에 남긴다 (답이 끝났을 때, 새 대화, 되돌리기). 기록 안 남김을 켠 동안은 쓰지 않는다:
   * 켤 때 새 대화로 비우며 한 번 써 두어서 파일에는 켜기 전 대화도 남지 않는다
   */
  const save = (force = false) => {
    if (state.ephemeral && !force) return;
    try {
      const saved = serializeChat(state);
      writeJson(HISTORY_FILE, saved);
      // 기록 안 남김 대화는 목록에도 넣지 않는다
      if (!state.ephemeral) threads.saveCurrent(saved, aiIsolation());
    } catch (err) {
      log('chat', 'history save failed', err instanceof Error ? err.message : String(err));
    }
  };

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
    // 대화권 남은 수는 창을 열 때 서버에서 다시 받는다 (기다리지 않는다)
    if (o.ticket?.available() && o.ticket.refresh) void o.ticket.refresh().then(push, () => {});
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
    return Promise.all(
      providers().map(async (p) => {
        const st = await checkStatus(p, refresh);
        // 무료 AI 는 앱 안에 있지만 고른 모델을 받기 전에는 답하지 못한다 (노란 점, "받기 전")
        if (p.adapter !== 'local') return st;
        return { ...st, needsModel: !localModelReady(pickLocal(o.catalog(), o.aiModels().local)) };
      }),
    );
  });

  ipcMain.handle(CHAT.providers, (e): ProviderView[] => (fromChat(e) ? providers().map(view) : []));

  ipcMain.handle(CHAT.addProvider, (e, input: CustomProviderInput) => {
    if (!fromChat(e)) return { ok: false, error: t('chat.reopenWindow') };
    const id = `custom-${randomUUID().slice(0, 8)}`;
    const spec = customProvider(input, id);
    if (typeof spec === 'string') return { ok: false, error: spec };
    customInputs = [...customInputs, { id, input }];
    writeJson(CUSTOM_FILE, customInputs);
    // 이름은 사용자가 지은 글이라 남기지 않는다 (의견 보내기 진단 기록)
    log('chat', 'provider added', id);
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

  ipcMain.on(CHAT.send, (e, text: unknown, images: unknown) => {
    if (!fromChat(e) || typeof text !== 'string') return;
    // 그림 형식은 codex 임시 파일 확장자가 되므로 메인에서 다시 본다
    const clean = cleanSendImages(images);
    if (clean && ask(text, clean)) o.onUserSaid?.(text);
  });

  /** "오늘 뭐부터" 를 AI 에 보낼지 보려고 설치, 로그인을 확인 중인 펫 메시지 id (멈추기) */
  let checking: string | undefined;

  /** 질문을 보낸다. 채팅 창의 보내기와 메모 "AI로 정리"가 같이 쓴다. 답을 기다리는 중이면 false */
  function ask(text: string, images: OutgoingImage[] = []): boolean {
    if (o.locked?.()) {
      o.onLocked?.();
      return false;
    }
    if (state.pendingId) return false;
    const question = text.trim();
    if (!question && images.length === 0) return false;
    // 끝말잇기 (main/fun.ts): 하자는 말이나 노는 중의 말이면 AI 를 부르지 않고 바로 답한다 (AI 가 없어도 된다)
    const local = images.length === 0 ? o.localGame?.turn(question) : undefined;
    if (local !== undefined) {
      answerLocal(question, local);
      return true;
    }
    const ids = { user: randomUUID(), pet: randomUUID() };
    const provider = state.provider;
    const spec = specOf(provider);
    if (!spec) return false;
    // 대화권은 국외 이전 안내를 읽고 쓰기로 한 뒤에만 보낸다 (화면도 그때까지 보내기를 막는다)
    if (spec.adapter === 'server' && !o.ticket?.agreed()) return false;
    const history = historyFor(state, provider);
    // 기록 남기지 않기: 이어가기 대신 최근 대화를 붙여 보낸다 (claude, codex 만 켤 수 있다).
    const canSkipSave = spec.adapter === 'claude' || spec.adapter === 'codex';
    // 화면(같이 보기, 붙인 그림)을 실은 질문은 기록 안 남김을 켜지 않았어도 AI 쪽에 저장하지 않는다
    // (2026-10-11 보안 점검: CLI 가 세션 기록에 그림을 base64 로 남겼다). 이어가기 대신 최근 대화를 붙여 보낸다
    const withImage = images.length > 0 && !!spec.images;
    const ephemeral = canSkipSave && (!!state.ephemeral || withImage);
    const base = question || t('chat.lookQuestion');
    // "오늘 뭐부터 할까?": 무료 AI 나 할 일을 AI 에 안 보내는 설정이면 규칙으로 바로 답한다 (할 일이 컴퓨터 밖으로 나가지 않는다).
    // 클라우드 AI 면 설치, 로그인을 보고 쓸 수 있으면 규칙 순서를 자료로 붙여 AI 에, 못 쓰면 규칙으로 답한다
    const first = images.length === 0 && !!o.whatFirst && isWhatFirstQuestion(question);
    const aiSeesTodos =
      o.knowsTodos() || (o.petTools() && (spec.adapter === 'claude' || spec.adapter === 'codex'));
    if (first && (spec.adapter === 'local' || !aiSeesTodos)) {
      answerByRules(question);
      return true;
    }
    const firstCtx = first ? (o.whatFirst?.context() ?? '') : '';
    const context = o.knowsTodos() ? firstCtx + o.todoContext() : '';
    // 그림 질문 뒤 이어 가는 세션은 그 문답을 모른다. 다음 질문에 글로만 붙인다
    const carried = !ephemeral ? (carry.get(provider) ?? []) : [];
    carry.delete(provider);
    // 지금 시각은 시스템 지시(persona)가 아니라 질문 앞에 붙인다 (프롬프트 캐시가 매번 깨지지 않게)
    const prompt = turnPrompt({
      context,
      question: ephemeral ? withHistory(history, base) : carried.length ? withHistory(carried, base) : base,
    });
    state = addQuestion(
      state,
      ids,
      question,
      images.map((i) => i.thumb),
    );
    push();
    // 그림을 받는 AI 에 그림을 보낼 때만 펫이 돋보기로 훑는다
    onPetAi({ thinking: true, answered: false, withImage: images.length > 0 && !!spec.images });
    if (first) {
      // 설치, 로그인 확인은 잠깐 기억해 두어 보통 바로 끝난다. 그사이 멈추기를 누르면 규칙으로 답하지 않고 멈춘다
      checking = ids.pet;
      void checkStatus(spec)
        .catch(() => undefined)
        .then((st) => {
          if (checking !== ids.pet || state.pendingId !== ids.pet) return;
          checking = undefined;
          if (st?.installed && st.loggedIn !== false) start();
          else finishByRules(ids.pet);
        });
      return true;
    }
    start();
    return true;

    function start() {
      if (!spec) return;
      const started = Date.now();
      log(
        'chat',
        'send',
        provider,
        `images=${images.length}`,
        ephemeral ? 'ephemeral' : '',
        context ? 'todos' : '',
      );

      const sessionBefore = state.sessions[provider];
      const req = {
        spec,
        history,
        text: prompt,
        // 그림을 못 받는 AI 에는 글만 보낸다. 화면이 미리 알려 준다.
        images: spec.images ? images.map((i) => i.full) : [],
        sessionId: ephemeral ? undefined : state.sessions[provider]?.id,
        persona: persona(petName(), o.personaId(), o.rules()),
        isolate: aiIsolation(),
        ephemeral,
        mcpServers: aiIsolation() ? [] : o.mcpServers(),
        // 짝꿍 도구: 격리해도 펫 MCP 서버 하나만 싣는다. 기본 도구(파일, 명령)는 그대로 끈다 (claude.ts, codex.ts)
        jjServer:
          o.petTools() && (spec.adapter === 'claude' || spec.adapter === 'codex') ? jjMcpLaunch() : undefined,
        // 고른 모델 (v2). 목록에 없으면 그 AI 의 기본
        model: pickCli(o.catalog(), provider, o.aiModels()[provider]),
      };
      const onEvent = (raw: AiEvent) => {
        // 글 없이 끝났으면 빈 말풍선 대신 안내 말 (이슈 #65). 대화 창 답에만: 일기 다듬기 같은 한 번 묻기는 빈 답을 그대로 받는다
        const streamed = () => state.messages.find((m) => m.id === ids.pet)?.text ?? '';
        const event =
          raw.type === 'done' ? { ...raw, text: finalAnswer(raw.text, streamed(), !!raw.tools) } : raw;
        state = applyEvent(state, ids.pet, event, randomUUID());
        if (event.type === 'usage') writeJson(USAGE_FILE, state.usage);
        // 기록을 안 남긴 세션은 이어 갈 수 없다. 받아 두지 않는다. 그림 때문에 이번만 안 남겼으면 전 세션을 그대로 둔다
        if (ephemeral && event.type === 'session')
          state = {
            ...state,
            sessions: { ...state.sessions, [provider]: state.ephemeral ? undefined : sessionBefore },
          };
        // 안내 말(빈 답)은 이어 붙이지 않는다
        if (ephemeral && !state.ephemeral && raw.type === 'done' && raw.text.trim())
          carry.set(
            provider,
            [...(carry.get(provider) ?? []), { question: base, answer: raw.text }].slice(-3),
          );
        if (event.type === 'delta') {
          const msg = state.messages.find((m) => m.id === ids.pet);
          win?.webContents.send(CHAT.delta, ids.pet, msg?.text ?? '');
          return;
        }
        if (event.type === 'done' || event.type === 'error') {
          run = undefined;
          onPetAi({ thinking: false, answered: event.type === 'done' });
          o.onTurnEnd?.();
          if (event.type === 'done') save();
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
        spec.adapter === 'server' && o.ticket
          ? runTicket(
              // 대화권은 펫 이름과 말투만 보낸다 (짝꿍 규칙과 기억은 빼고, #100)
              { history, text: prompt, persona: ticketVoice(petName(), o.personaId()), lang: getLang() },
              o.ticket,
              onEvent,
            )
          : spec.adapter === 'local'
            ? runLocal(req, pickLocal(o.catalog(), o.aiModels().local), onEvent, log, {
                // 한국어이고 존댓말 성격이 아니면 반말 예시와 어미 고치기
                banmal: getLang() === 'ko' && isBanmal(o.personaId()),
                petName: petName(),
                rules: o.rules(),
              })
            : runAi(req, onEvent);
    }
  }

  /**
   * 말놀이 답을 바로 단다 (AI 를 부르지 않는다). question 이 없으면 펫 말만 (메뉴에서 시작).
   * 펫 메시지에 AI 이름을 달지 않아 AI 대화 기록(historyFor)에 섞이지 않는다
   */
  function answerLocal(question: string | undefined, text: string) {
    const pet: ChatMessage = { id: randomUUID(), role: 'pet', text, status: 'done', game: true };
    const user: ChatMessage[] = question ? [{ id: randomUUID(), role: 'user', text: question }] : [];
    state = { ...state, messages: [...state.messages, ...user, pet] };
    log('chat', 'local-game');
    save();
    push();
  }

  /** 질문과 규칙 답을 바로 (AI 를 부르지 않는다) */
  function answerByRules(question: string) {
    const ids = { user: randomUUID(), pet: randomUUID() };
    state = addQuestion(state, ids, question, []);
    finishByRules(ids.pet);
  }

  /** 기다리는 펫 메시지를 규칙 답으로 채운다. AI 세션 회차는 세지 않는다 (AI 가 답한 것이 아니다) */
  function finishByRules(petId: string) {
    const a = o.whatFirst?.answer();
    if (!a) return;
    state = {
      ...state,
      pendingId: undefined,
      messages: state.messages.map((m) =>
        m.id === petId
          ? {
              ...m,
              text: a.text,
              status: 'done' as const,
              byRules: true as const,
              plan: a.focusTodoId !== undefined ? { focusTodoId: a.focusTodoId } : {},
            }
          : m,
      ),
    };
    log('chat', 'what-first', 'rules');
    onPetAi({ thinking: false, answered: true });
    save();
    push();
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
        // 원문은 기록에만. 화면에는 갈래(연결, 공간, 해시 등)에 맞춘 안내를 보낸다
        const message = downloadErrorText(err, { mb: mb(model) });
        state = { ...state, modelDownload: aborted ? undefined : { pct: 0, failed: true, message } };
        push();
      })
      .finally(() => {
        downloading = undefined;
      });
  });

  /** 새 대화로 지운 대화. 잠깐 동안 되돌릴 수 있다 (UNDO_RESET_MS). thread 는 그 대화의 목록 id */
  let cleared: { state: ChatState; at: number; thread?: string } | undefined;
  ipcMain.on(CHAT.setEphemeral, (e, on: boolean) => {
    if (!fromChat(e) || state.pendingId) return;
    // 켜고 끌 때 새 대화로: 안 남긴 대화는 이어 갈 수 없고, 남긴 대화를 안 남긴 채 이어 갈 수도 없다.
    state = { ...resetChat(state), ephemeral: !!on };
    threads.detach();
    carry.clear();
    // 지운 대화를 되돌릴 거리도 버린다 (안 남긴 대화가 되돌리기로 기록 파일에 쓰이지 않게)
    cleared = undefined;
    save(true);
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
  // 규칙 답 아래 단추 (집중 시작, 패널 열기). 할 일 id 는 메인이 다시 본다 (planner.startFocus)
  ipcMain.on(CHAT.planAction, (e, kind: unknown, todoId: unknown) => {
    if (!fromChat(e) || (kind !== 'focus' && kind !== 'panel')) return;
    o.onPlanAction?.(kind, Number.isInteger(todoId) ? (todoId as number) : undefined);
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

  // AI 대화권 (#100): 국외 이전 안내를 읽고 쓰기로 함, 답 신고 (화면에서 따로 확인한 뒤)
  ipcMain.on(CHAT.agreeTicket, (e) => {
    if (!fromChat(e) || !o.ticket?.available()) return;
    o.ticket.agree();
    log('chat', 'ticket agreed');
    push();
  });
  ipcMain.handle(CHAT.reportTicket, async (e, id: unknown) => {
    if (!fromChat(e) || typeof id !== 'string' || !o.ticket?.available()) return false;
    const msg = state.messages.find((m) => m.id === id);
    const r = answerOf(id);
    if (!r || msg?.provider !== TICKET_PROVIDER_ID) return false;
    const ok = await o.ticket.report(r.question, r.answer);
    log('chat', 'ticket report', ok ? 'sent' : 'failed');
    return ok;
  });

  ipcMain.on(CHAT.cancel, (e) => {
    if (!fromChat(e)) return;
    if (checking) {
      const id = checking;
      checking = undefined;
      state = applyEvent(
        state,
        id,
        { type: 'error', error: { kind: 'cancelled', message: t('ai.error.cancelled') } },
        randomUUID(),
      );
      onPetAi({ thinking: false, answered: false });
      push();
    }
    run?.cancel();
    downloading?.abort(); // 모델 받기도 멈춘다 (받기 진행 옆 취소 단추)
  });
  ipcMain.on(CHAT.reset, (e) => {
    if (!fromChat(e) || state.pendingId) return;
    if (state.messages.length > 0) cleared = { state, at: Date.now(), thread: threads.current };
    state = resetChat(state);
    // 지난 대화는 목록에 남는다 (답이 끝날 때마다 저장해 두었다). 다음 질문은 새 목록 항목이 된다
    threads.detach();
    carry.clear();
    o.localGame?.reset();
    save(true);
    push();
  });
  ipcMain.handle(CHAT.undoReset, (e) => {
    if (!fromChat(e) || !cleared || Date.now() - cleared.at > UNDO_RESET_MS) return false;
    const back = undoReset(state, cleared.state);
    const thread = cleared.thread;
    cleared = undefined;
    if (!back) return false;
    state = back;
    // 같은 목록 항목으로 돌아간다 (되돌린 대화가 목록에 두 번 생기지 않게)
    if (thread) threads.attach(thread);
    log('chat', 'undo reset');
    save();
    push();
    return true;
  });
  // 지난 대화 목록 (열기, 이름 바꾸기, 지우기)
  ipcMain.handle(CHAT.threads, (e, query: unknown): ThreadList => {
    if (!fromChat(e)) return { threads: [] };
    const current = threads.current;
    return {
      threads: threads.list(typeof query === 'string' ? query.slice(0, 200) : ''),
      ...(current ? { current } : {}),
    };
  });
  ipcMain.handle(CHAT.openThread, (e, id: unknown) => {
    // 답을 기다리는 중이나 기록 안 남김 중에는 열지 않는다 (안 남기는 중에 연 대화가 기록에 이어 쓰이지 않게)
    if (!fromChat(e) || !isThreadId(id) || state.pendingId || state.ephemeral) return false;
    if (threads.current === id) return true;
    const saved = threads.read(id);
    const meta = threads.meta(id);
    if (!saved || !meta || saved.messages.length === 0) return false;
    let next: ChatState = { ...resetChat(state), messages: saved.messages, sessions: saved.sessions };
    // 그 대화를 하던 AI 로 이어 간다 (세션은 AI 마다 따로라 다른 AI 로는 앞 대화를 모른다)
    if (meta.provider && specOf(meta.provider) && meta.provider !== next.provider) {
      next = switchProvider(next, meta.provider);
      userPicked = true;
      writeJson(SETTINGS_FILE, { provider: next.provider });
    }
    carry.clear();
    // 이어 갈 수 없는 세션(격리 설정이 바뀜, claude 의 오래된 세션)은 빼고 최근 문답을 글로 붙인다
    for (const p of staleSessions(
      meta,
      saved.sessions,
      Date.now(),
      aiIsolation(),
      (p) => specOf(p)?.adapter,
    )) {
      next = { ...next, sessions: { ...next.sessions, [p]: undefined } };
      carry.set(p, historyFor(next, p).slice(-3));
    }
    state = next;
    cleared = undefined;
    threads.attach(id);
    // 열기만 했을 때는 목록 순서(마지막 대화 날짜)를 바꾸지 않는다. 지금 대화 파일만 맞춘다
    try {
      writeJson(HISTORY_FILE, serializeChat(state));
    } catch (err) {
      log('chat', 'history save failed', err instanceof Error ? err.message : String(err));
    }
    log('chat', 'open thread', saved.messages.length);
    push();
    return true;
  });
  ipcMain.handle(CHAT.renameThread, (e, id: unknown, title: unknown) => {
    if (!fromChat(e) || !isThreadId(id) || typeof title !== 'string') return false;
    return threads.rename(id, title);
  });
  ipcMain.handle(CHAT.deleteThread, (e, id: unknown) => {
    if (!fromChat(e) || !isThreadId(id)) return false;
    // 답을 기다리는 대화는 지우지 않는다 (답이 끝나며 다시 저장된다)
    if (threads.current === id && state.pendingId) return false;
    // 되돌리기로 지운 대화가 살아나지 않게
    if (cleared?.thread === id) cleared = undefined;
    const wasCurrent = threads.remove(id);
    log('chat', 'delete thread', wasCurrent ? 'current' : '');
    if (wasCurrent) {
      state = resetChat(state);
      carry.clear();
      save(true);
      push();
    }
    return true;
  });
  // 답 속 주소는 기본 브라우저로. http, https 만 (safeExternalUrl), 창 안에서는 열지 않는다
  ipcMain.on(CHAT.openLink, (e, raw: unknown) => {
    if (fromChat(e)) openLink(raw, log);
  });
  ipcMain.on(CHAT.provider, (e, provider: AiProvider) => {
    if (!fromChat(e) || !specOf(provider)) return;
    userPicked = true;
    state = switchProvider(state, provider);
    writeJson(SETTINGS_FILE, { provider: state.provider });
    push();
  });

  function open(near?: Rectangle) {
    if (o.locked?.()) {
      o.onLocked?.();
      return;
    }
    // 앱을 앞으로 가져오는 것은 창을 띄울 때 한다 (focus.ts. 먼저 하면 맥이 다른 데스크톱으로 넘어간다)
    if (win && !win.isDestroyed()) {
      // 화면 프로세스가 죽었으면 빈 창만 남는다. 다시 부를 때 새로 읽는다 (대화 내용은 메인에 있다)
      if (win.webContents.isCrashed()) win.webContents.reload();
      focusWindow(win);
      return;
    }
    // 닫을 때 크기는 늘 기억한다. 자리는 사용자가 옮긴 적이 있을 때만 그 자리, 아니면 펫 옆 (window-bounds.ts)
    const saved = savedBounds('chat', CHAT_MIN);
    const size = saved ? { width: saved.width, height: saved.height } : CHAT_SIZE;
    const placed = saved?.x !== undefined && saved.y !== undefined;
    win = new BrowserWindow({
      ...(placed ? saved : placeNear(near, size)),
      title: t('chat.title', { name: petName() }),
      minWidth: CHAT_MIN.width,
      minHeight: CHAT_MIN.height,
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
    rememberBounds(win, 'chat', placed);
    win.once('ready-to-show', () => showWindow(win));
    win.on('closed', () => {
      win = undefined;
    });
    // 채팅 창 안의 링크는 앱 안에서 열지 않는다 (답 속 주소는 위 CHAT.openLink 로 기본 브라우저에서).
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (ev) => ev.preventDefault());

    const devUrl = devRendererUrl();
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

  /** 그림을 보는 claude, codex 중 지금 고른 것, 아니면 설치되고 로그인된 첫 번째 */
  async function visionSpec(): Promise<ProviderSpec | undefined> {
    for (const id of [state.provider, 'claude', 'codex']) {
      const s = specOf(id);
      if (!s?.images || (s.adapter !== 'claude' && s.adapter !== 'codex')) continue;
      const st = await checkStatus(s);
      if (st.installed && st.loggedIn !== false) return s;
    }
    return undefined;
  }

  /**
   * 글만으로 설계도를 쓸 수 있는 AI (말로 만들기, 2026-10-12): 앱에 든 CLI AI(claude, codex, cursor, gemini) 가운데
   * 지금 채팅에서 고른 것, 아니면 설치되고 로그인된 첫 번째. 무료 AI(작은 앱 안 모델)는 긴 설계도 JSON 을 잘 못 써서 빼고,
   * 사용자가 더한 AI 도 무엇을 할 수 있는지 몰라 뺀다
   */
  async function textSpec(): Promise<ProviderSpec | undefined> {
    for (const id of textAiOrder(state.provider)) {
      const s = specOf(id);
      // 대화권은 사용자가 채팅에서 묻는 질문에만 쓴다 (말로 만들기 같은 일에 대화권을 쓰지 않는다)
      if (!s || s.custom || s.adapter === 'server') continue;
      const st = await checkStatus(s);
      if (st.installed && st.loggedIn !== false) return s;
    }
    return undefined;
  }

  return {
    open,
    toggle,
    attach,
    /** 대화권 상태(남은 수, 쓸 수 있는지)가 바뀌었다. 열린 창에 다시 보낸다 */
    ticketChanged: () => push(),
    /** 말놀이 펫 말을 채팅에 단다 (펫 메뉴에서 끝말잇기 시작). 답을 기다리는 중이면 false */
    sayLocal: (text: string): boolean => {
      if (state.pendingId || o.locked?.()) return false;
      answerLocal(undefined, text);
      return true;
    },
    /** 말로 만들기를 쓸 AI 가 있는지 (만들기 창이 탭을 보일지) */
    hasTextAi: async () => !!(await textSpec()),
    /**
     * 대화 밖에서 글만으로 한 번 묻는다 (말로 만들기). 격리하고 기록을 남기지 않는다. claude 는 웹 검색 도구 하나만 켠다
     * (캐릭터 이름이면 모습을 찾아보게. 파일, 명령 도구는 그대로 끈다). 쓸 AI 가 없으면 noAi
     */
    async textShot(
      text: string,
      system: string,
      signal?: AbortSignal,
    ): Promise<{ ok: true; text: string; provider: string } | { ok: false; error: string; noAi?: true }> {
      if (o.locked?.()) return { ok: false, error: t('main.update.lockedShort') };
      const spec = await textSpec();
      if (!spec) return { ok: false, noAi: true, error: t('main.maker.noTextAi') };
      if (signal?.aborted) return { ok: false, error: t('main.maker.shapeCancelled') };
      log('chat', 'text-shot', spec.id);
      return new Promise((resolve) => {
        const run = runAi(
          {
            spec,
            history: [],
            text,
            images: [],
            persona: system,
            isolate: true,
            ephemeral: true,
            webSearch: spec.adapter === 'claude',
            model: pickCli(o.catalog(), spec.id, o.aiModels()[spec.id]),
          },
          (e) => {
            if (e.type === 'done') resolve({ ok: true, text: e.text, provider: spec.id });
            else if (e.type === 'error') resolve({ ok: false, error: e.error.message });
          },
        );
        signal?.addEventListener('abort', () => run.cancel());
        const ended = () => resolve({ ok: false, error: t('main.maker.shapeCancelled') });
        void run.finished.then(ended, ended);
      });
    },
    /** 창을 열고 질문을 보낸다 (메모 "AI로 정리"). 답을 기다리는 중이면 false */
    askInWindow(text: string, near?: Rectangle): boolean {
      open(near);
      return ask(text);
    },
    /** 설치되고 로그인된 AI 프로그램이 하나라도 있는지 (첫 안내의 AI 한 줄). 확인 결과는 잠깐 기억된다 */
    async hasCliAi(): Promise<boolean> {
      const found = await Promise.all(
        ['claude', 'codex', 'cursor', 'gemini'].map(async (id) => {
          const spec = specOf(id);
          const st = spec ? await checkStatus(spec) : undefined;
          return !!st?.installed && st.loggedIn !== false;
        }),
      );
      return found.some(Boolean);
    },
    /** 지금 고른 AI 의 id (도움 보내기 머리) */
    provider: (): string => state.provider,
    /**
     * 대화 글(내가 쓴 것과 AI 답) 최근 것들. 도움 보내기의 가리기가 글자 그대로 찾아 지운다 (이슈 #126).
     * 기록에는 원래 안 남지만 오류 글에 섞여 와도 새지 않게
     */
    privateTexts(): string[] {
      return state.messages
        .slice(-60)
        .map((m) => m.text)
        .filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
    },
    get window() {
      return win;
    },
    /** 사진을 볼 수 있는 AI 가 있는지 (펫 만들기 창이 입체 피규어와 2.5D 중 무엇을 권할지) */
    hasVisionAi: async () => !!(await visionSpec()),
    /**
     * 대화 밖에서 그림 한 장과 함께 한 번 묻는다 (입체 펫 설계도, 6단계). 그림을 보는 claude, codex 중
     * 지금 채팅에서 고른 것, 아니면 설치되고 로그인된 첫 번째. 기록은 남기지 않고 사용자 설정 없이 격리해 부른다.
     * 쓸 AI 가 없으면 noAi
     */
    async oneShot(
      text: string,
      image: ImageAttachment | readonly ImageAttachment[],
      system: string,
      signal?: AbortSignal,
    ): Promise<{ ok: true; text: string; provider: string } | { ok: false; error: string; noAi?: true }> {
      if (o.locked?.()) return { ok: false, error: t('main.update.lockedShort') };
      const spec = await visionSpec();
      if (!spec) return { ok: false, noAi: true, error: t('main.maker.noVisionAi') };
      if (signal?.aborted) return { ok: false, error: t('main.maker.shapeCancelled') };
      const use = spec;
      log('chat', 'one-shot', use.id);
      return new Promise((resolve) => {
        const run = runAi(
          {
            spec: use,
            history: [],
            text,
            images: Array.isArray(image) ? image : [image as ImageAttachment],
            persona: system,
            isolate: true,
            ephemeral: true,
            model: pickCli(o.catalog(), use.id, o.aiModels()[use.id]),
          },
          (e) => {
            if (e.type === 'done') resolve({ ok: true, text: e.text, provider: use.id });
            else if (e.type === 'error') resolve({ ok: false, error: e.error.message });
          },
        );
        signal?.addEventListener('abort', () => run.cancel());
        // 답도 오류도 없이 끝나면(취소) 실패로. 먼저 정해졌으면 이 값은 무시된다
        const ended = () => resolve({ ok: false, error: t('main.maker.shapeCancelled') });
        void run.finished.then(ended, ended);
      });
    },
    /**
     * AI 기록을 지운 뒤 (설정 "AI 기록 지우기"): 지운 세션은 이어 갈 수 없어 버린다. 화면의 대화는 그대로 두고
     * 다음 질문부터 AI 쪽은 새 대화로 시작한다
     */
    forgetSessions(): void {
      state = { ...state, sessions: {} };
      carry.clear();
      save(true);
    },
    /** 지금 고른 AI 이름 (메모 다듬기가 어느 AI 로 보내는지 보여 준다) */
    aiLabel: (): string | undefined => specOf(state.provider)?.label,
    /**
     * 글만 한 번 묻는다 (짝꿍 일기 다듬기). 지금 고른 AI 로, 격리하고 기록을 남기지 않는다.
     * 채팅 창에는 보이지 않는다. 무료 AI 모델이 없으면 받지 않고 실패로. 실패면 undefined
     */
    textOnce(text: string, system: string): Promise<string | undefined> {
      if (o.locked?.()) return Promise.resolve(undefined);
      const provider = state.provider;
      const spec = specOf(provider);
      // 대화권은 채팅 질문에만 쓴다 (일기 다듬기에 대화권을 쓰지 않는다)
      if (!spec || spec.adapter === 'server') return Promise.resolve(undefined);
      log('chat', 'text-once', provider);
      return new Promise((resolve) => {
        const req = {
          spec,
          history: [],
          text,
          images: [],
          persona: system,
          isolate: true,
          ephemeral: true,
          model: pickCli(o.catalog(), provider, o.aiModels()[provider]),
        };
        const onEvent = (e: AiEvent) => {
          if (e.type === 'done') resolve(e.text);
          else if (e.type === 'error') resolve(undefined);
        };
        const run =
          spec.adapter === 'local'
            ? runLocal(req, pickLocal(o.catalog(), o.aiModels().local), onEvent, log, {
                banmal: getLang() === 'ko' && isBanmal(o.personaId()),
                petName: petName(),
                rules: '',
              })
            : runAi(req, onEvent);
        const ended = () => resolve(undefined);
        void run.finished.then(ended, ended);
      });
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
      save();
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
    bin: p.custom ? p.bin : undefined,
    ephemeral: p.adapter === 'claude' || p.adapter === 'codex',
    ...(p.adapter === 'server' ? { ticket: true, detail: t('ticket.detail') } : {}),
  };
}

/** 펫 옆(왼쪽, 자리가 없으면 오른쪽)에 펫 아래쪽에 맞춰 둔다. 크기는 기억한 크기, 없으면 기본 */
function placeNear(near: Rectangle | undefined, size: { width: number; height: number }) {
  const area = near ? screen.getDisplayMatching(near).workArea : screen.getPrimaryDisplay().workArea;
  const fit = { width: Math.min(size.width, area.width), height: Math.min(size.height, area.height) };
  if (!near) return { ...fit, x: area.x + area.width - fit.width - 40, y: area.y + 40 };
  const gap = 8;
  const leftX = near.x - fit.width - gap;
  const x = leftX >= area.x ? leftX : near.x + near.width + gap;
  const y = near.y + near.height - fit.height;
  return clampIntoAreas({ x, y, ...fit }, [area]);
}

/** 파일을 마지막으로 쓴 때. 없으면 undefined (옛 판 대화를 목록에 넣을 때 날짜로 쓴다) */
function mtimeOf(path: string): number | undefined {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return undefined;
  }
}

/** 저장해 둔 사용량을 고른다. 모양이 틀린 것은 버린다 (틀린 값이 채팅 창을 빈 화면으로 만들었다) */
function usageOf(raw: unknown): ChatState['usage'] {
  if (typeof raw !== 'object' || raw === null) return {};
  const out: ChatState['usage'] = {};
  for (const [id, u] of Object.entries(raw as Record<string, unknown>)) {
    const v = u as Partial<AiUsage> | null;
    if (
      typeof v === 'object' &&
      v !== null &&
      typeof v.checkedAt === 'number' &&
      Array.isArray(v.windows) &&
      v.windows.every((w) => typeof w?.label === 'string' && typeof w.usedPercent === 'number')
    )
      out[id] = v as AiUsage;
  }
  return out;
}
