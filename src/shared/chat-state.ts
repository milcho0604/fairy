// 채팅 상태. 메인이 들고 있고 채팅 창은 그림만 그린다. 창을 닫았다 열어도 대화가 남는다.

import type { Exchange } from './ai/text.ts';
import type { AiError, AiEvent, AiProvider } from './ai/types.ts';
import type { AiUsage } from './ai/usage.ts';
import { cutText } from './cut-text.ts';
import { t } from './i18n/index.ts';

export interface ChatImage {
  /** 화면에 보일 작은 그림 (data URL). 원본은 보낼 때만 쓰고 상태에 두지 않는다. */
  thumb: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'pet' | 'notice';
  text: string;
  provider?: AiProvider;
  images?: ChatImage[];
  status?: 'waiting' | 'streaming' | 'done' | 'error';
  error?: AiError;
  /** AI 없이 규칙으로 답했다 ("오늘 뭐부터", shared/what-first.ts). 꼬리표가 AI 이름 대신 "AI 없이" */
  byRules?: true;
  /** AI 없이 하는 말놀이 답 (끝말잇기, shared/word-chain.ts). 꼬리표가 AI 이름 대신 놀이 이름 */
  game?: true;
  /** 규칙 답 아래 단추 (집중 시작, 패널 열기). focusTodoId 는 집중할 할 일 */
  plan?: { focusTodoId?: number };
}

export interface ChatState {
  provider: AiProvider;
  messages: ChatMessage[];
  /** 답을 기다리는 펫 메시지 id. 없으면 보낼 수 있다. */
  pendingId?: string;
  sessions: Partial<Record<AiProvider, { id: string; turns: number }>>;
  /** 마지막으로 알게 된 사용량. 새 대화를 열어도 남긴다. */
  usage: Partial<Record<AiProvider, AiUsage>>;
  /** 기록 남기지 않기 (v1): AI 쪽에도 대화를 저장하지 않는다. 켜는 동안은 이어가기 대신 최근 대화를 붙여 보낸다 */
  ephemeral?: boolean;
  /** 내 할 일 같이 보내기 (설정 aiKnowsTodos 를 비춘다) */
  knowsTodos?: boolean;
  /** 무료 AI 모델 받기 (v2): 받는 중이면 진행률(0~100), 실패하면 failed 와 안내 글(오류 원문이 아니다) */
  modelDownload?: { pct: number; failed?: boolean; message?: string };
  /** AI 대화권 (#100, 쓸 수 있을 때만): 남은 수(아직 모르면 null)와 국외 이전 안내를 읽었는지. 파일에 남기지 않는다 */
  ticket?: { tickets: number | null; agreed: boolean };
}

/** 대화가 이만큼 길어지면 새 대화를 권한다. 이어갈수록 입력 토큰이 쌓인다(L8: codex 2번째에 54K). */
export const LONG_CHAT_TURNS = 12;

export function initialChat(provider: AiProvider = 'claude', usage: ChatState['usage'] = {}): ChatState {
  return { provider, messages: [], sessions: {}, usage };
}

/** 사용량은 질문 중이 아니어도(끝난 뒤 늦게 읽혀도) 반영한다. */
export function applyUsage(s: ChatState, usage: AiUsage): ChatState {
  return { ...s, usage: { ...s.usage, [usage.provider]: usage } };
}

/** 사용자 질문과 답 자리를 더한다. */
export function addQuestion(
  s: ChatState,
  ids: { user: string; pet: string },
  text: string,
  images: ChatImage[],
): ChatState {
  return {
    ...s,
    pendingId: ids.pet,
    messages: [
      ...s.messages,
      { id: ids.user, role: 'user', text, images: images.length ? images : undefined },
      { id: ids.pet, role: 'pet', text: '', provider: s.provider, status: 'waiting' },
    ],
  };
}

/** AI 사건을 반영한다. 끝난 뒤 들어오는 사건은 무시한다. */
export function applyEvent(s: ChatState, petId: string, e: AiEvent, noticeId: string): ChatState {
  if (e.type === 'usage') return applyUsage(s, e.usage);
  if (s.pendingId !== petId) return s;
  const msg = s.messages.find((m) => m.id === petId);
  if (!msg) return s;
  const provider = msg.provider ?? s.provider;
  const update = (patch: Partial<ChatMessage>, extra: Partial<ChatState> = {}): ChatState => ({
    ...s,
    ...extra,
    messages: s.messages.map((m) => (m.id === petId ? { ...m, ...patch } : m)),
  });

  switch (e.type) {
    case 'session': {
      const prev = s.sessions[provider];
      const turns = prev?.id === e.id ? prev.turns : 0;
      return { ...s, sessions: { ...s.sessions, [provider]: { id: e.id, turns } } };
    }
    case 'delta':
      return update({ text: msg.text + e.text, status: 'streaming' });
    case 'reset':
      return update({ text: '', status: 'streaming' });
    case 'done': {
      const session = s.sessions[provider];
      const turns = (session?.turns ?? 0) + 1;
      let next = update(
        { text: e.text || msg.text, status: 'done' },
        {
          pendingId: undefined,
          sessions: session ? { ...s.sessions, [provider]: { ...session, turns } } : s.sessions,
        },
      );
      if (turns === LONG_CHAT_TURNS) {
        next = {
          ...next,
          messages: [...next.messages, { id: noticeId, role: 'notice', text: t('chat.longChat') }],
        };
      }
      return next;
    }
    case 'error':
      return update({ status: 'error', error: e.error }, { pendingId: undefined });
  }
}

/** AI 를 바꾼다. 대화 기록은 화면에 남기고, 각 AI 는 자기 세션을 이어간다. */
export function switchProvider(s: ChatState, provider: AiProvider): ChatState {
  return s.pendingId ? s : { ...s, provider };
}

/**
 * 새 대화: 화면과 세션을 비운다. 사용자가 고른 것(기록 남기지 않기, 할 일 같이 보내기)과
 * 받는 중인 모델 진행은 그대로 둔다 (예전엔 새 대화가 "기록 남기지 않기"를 몰래 껐다, 버그잡이 6차)
 */
export function resetChat(s: ChatState): ChatState {
  if (s.pendingId) return s;
  return {
    ...initialChat(s.provider, s.usage),
    ...(s.ephemeral ? { ephemeral: true } : {}),
    ...(s.knowsTodos !== undefined ? { knowsTodos: s.knowsTodos } : {}),
    ...(s.modelDownload ? { modelDownload: s.modelDownload } : {}),
  };
}

/** 새 대화를 누른 뒤 이만큼 안에는 되돌릴 수 있다 (채팅 창의 되돌리기 알림이 이보다 먼저 사라진다) */
export const UNDO_RESET_MS = 10_000;

/**
 * 새 대화 되돌리기: 지운 대화와 세션을 다시 놓는다. 그 사이 새 질문을 했거나 답을 기다리는 중이면 되돌리지 않는다(undefined).
 * 지운 뒤 바꾼 것(고른 AI, 사용량, 할 일 같이 보내기, 모델 받기)은 지금 것을 둔다
 */
export function undoReset(current: ChatState, before: ChatState): ChatState | undefined {
  if (current.pendingId || current.messages.length > 0 || before.messages.length === 0) return undefined;
  // 기록 안 남김을 켜거나 끈 사이에는 되돌리지 않는다. 안 남긴 대화가 남기는 대화로 돌아와
  // 기록 파일에 쓰이면 안 된다 (리뷰 HIGH, 개인 정보)
  if (!!current.ephemeral !== !!before.ephemeral) return undefined;
  return { ...current, messages: before.messages, sessions: before.sessions };
}

/** 이어가기 기능이 없는 AI 에 붙여 보낼 최근 대화: 같은 AI 와 끝까지 주고받은 것만. */
export function historyFor(state: ChatState, provider: AiProvider): Exchange[] {
  const out: Exchange[] = [];
  const msgs = state.messages;
  for (let i = 1; i < msgs.length; i++) {
    const a = msgs[i];
    const q = msgs[i - 1];
    if (a?.role === 'pet' && a.provider === provider && a.status === 'done' && q?.role === 'user') {
      out.push({ question: q.text, answer: a.text });
    }
  }
  return out;
}

/** 다시 켜도 남길 메시지 수. 이어가기는 AI 쪽 세션이 맡아서 화면에는 최근 것만 있으면 된다 */
export const SAVED_MESSAGES = 40;
/** 메시지 하나의 글 길이 상한. 손으로 고친 파일이 엄청 커도 창이 버티게 */
export const SAVED_TEXT_MAX = 20_000;

/** 파일에 남기는 대화. 그림(작은 그림도 data URL 이라 크다)과 끝나지 않은 답, 오류는 남기지 않는다 */
export interface SavedChat {
  messages: ChatMessage[];
  sessions: ChatState['sessions'];
}

/** 끝까지 주고받은 것만 고른다. 답 없이 남은 질문(오류, 멈춤)은 뺀다 */
export function serializeChat(s: ChatState): SavedChat {
  const msgs = s.messages;
  const keep: ChatMessage[] = [];
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    if (!m) continue;
    if (m.role === 'notice') keep.push({ id: m.id, role: 'notice', text: m.text });
    else if (m.role === 'pet' && m.status === 'done')
      keep.push({
        id: m.id,
        role: 'pet',
        text: m.text,
        status: 'done',
        ...(m.provider ? { provider: m.provider } : {}),
        ...(m.byRules ? { byRules: true as const } : {}),
        ...(m.game ? { game: true as const } : {}),
      });
    else if (m.role === 'user') {
      const answer = msgs[i + 1];
      // 그림만 보낸 질문은 그림을 빼면 빈 말풍선이라 뺀다
      if (answer?.role === 'pet' && answer.status === 'done' && m.text)
        keep.push({ id: m.id, role: 'user', text: m.text });
    }
  }
  // 기록 안 남김 대화는 세션 자리를 undefined 로 비워 둔다. 빈 자리는 옮기지 않는다
  const sessions = Object.fromEntries(Object.entries(s.sessions).filter(([, v]) => !!v));
  return { messages: keep.slice(-SAVED_MESSAGES), sessions };
}

/** 저장 파일을 읽는다. 모양이 틀린 줄은 버리고, 아예 틀리면 빈 대화 (깨진 파일이 채팅 창을 막지 않게) */
export function parseChat(raw: unknown): SavedChat {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const messages: ChatMessage[] = [];
  for (const m of Array.isArray(r.messages) ? r.messages : []) {
    const v = (typeof m === 'object' && m !== null ? m : {}) as Record<string, unknown>;
    if (typeof v.id !== 'string' || !v.id || typeof v.text !== 'string') continue;
    const text = cutText(v.text, SAVED_TEXT_MAX);
    if (v.role === 'user' || v.role === 'notice') messages.push({ id: v.id, role: v.role, text });
    else if (v.role === 'pet' && v.status === 'done')
      messages.push({
        id: v.id,
        role: 'pet',
        text,
        status: 'done',
        ...(typeof v.provider === 'string' ? { provider: v.provider } : {}),
        ...(v.byRules === true ? { byRules: true as const } : {}),
        ...(v.game === true ? { game: true as const } : {}),
      });
  }
  const sessions: ChatState['sessions'] = {};
  if (typeof r.sessions === 'object' && r.sessions !== null && !Array.isArray(r.sessions)) {
    for (const [provider, v] of Object.entries(r.sessions as Record<string, unknown>)) {
      const sv = (typeof v === 'object' && v !== null ? v : {}) as { id?: unknown; turns?: unknown };
      if (typeof sv.id === 'string' && sv.id && Number.isInteger(sv.turns) && (sv.turns as number) >= 0)
        sessions[provider] = { id: sv.id, turns: sv.turns as number };
    }
  }
  return { messages: messages.slice(-SAVED_MESSAGES), sessions };
}
