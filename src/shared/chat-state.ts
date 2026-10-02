// 채팅 상태. 메인이 들고 있고 채팅 창은 그림만 그린다. 창을 닫았다 열어도 대화가 남는다.
import type { AiError, AiEvent, AiProvider } from './ai/types.ts';
import type { AiUsage } from './ai/usage.ts';

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
}

export interface ChatState {
  provider: AiProvider;
  messages: ChatMessage[];
  /** 답을 기다리는 펫 메시지 id. 없으면 보낼 수 있다. */
  pendingId?: string;
  sessions: Partial<Record<AiProvider, { id: string; turns: number }>>;
  /** 마지막으로 알게 된 사용량. 새 대화를 열어도 남긴다. */
  usage: Partial<Record<AiProvider, AiUsage>>;
}

/** 대화가 이만큼 길어지면 새 대화를 권한다. 이어갈수록 입력 토큰이 쌓인다(L8: codex 2번째에 54K). */
export const LONG_CHAT_TURNS = 12;

export const LONG_CHAT_NOTICE =
  '대화가 길어졌어. 이어 갈수록 답이 느려지고 한도도 빨리 써. 새 대화로 시작하면 가벼워져.';

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
          messages: [...next.messages, { id: noticeId, role: 'notice', text: LONG_CHAT_NOTICE }],
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

/** 새 대화: 화면과 세션을 비운다. */
export function resetChat(s: ChatState): ChatState {
  return s.pendingId ? s : initialChat(s.provider, s.usage);
}
