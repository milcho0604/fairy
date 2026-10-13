// 지난 대화 목록. 대화마다 파일 하나(main/chat-threads.ts)와 목차 하나를 둔다.
// 목차에는 목록에 그릴 것(제목, 날짜, AI, 첫 질문 앞부분)만 있어 대화가 수백 개여도 목차 하나만 읽고 그린다.
// 여기는 파일을 만지지 않는 계산만 둔다 (시험에서 그대로 부른다).

import type { AiProvider } from './ai/types.ts';
import type { SavedChat } from './chat-state.ts';

export interface ThreadMeta {
  id: string;
  /** 목록 제목. 사용자가 바꾸지 않았으면 첫 질문에서 만든다 */
  title: string;
  /** 사용자가 이름을 바꿨다 (첫 질문으로 다시 덮지 않는다) */
  renamed?: true;
  /** 마지막으로 답한 AI. 규칙 답만 있으면 없다 */
  provider?: AiProvider;
  createdAt: number;
  updatedAt: number;
  /** 남긴 메시지 수 */
  count: number;
  /** 찾기용 첫 질문 앞부분 (제목을 바꿔도 첫 질문으로 찾게) */
  first: string;
  /** 저장할 때 AI 를 격리해서 불렀는지. 설정이 바뀌었으면 AI 쪽 세션이 다른 폴더라 이어 갈 수 없다 */
  isolated?: boolean;
}

export interface ThreadIndex {
  /** 지금 채팅 창에 열린 대화. 새 대화(아직 답이 없음)면 없다 */
  current?: string;
  threads: ThreadMeta[];
}

/** 목록 제목 길이 */
export const TITLE_MAX = 40;
/** 이름 바꾸기 상한 */
export const RENAME_MAX = 80;
/** 찾기용 첫 질문 길이 */
export const FIRST_MAX = 200;
/** 목차에 둘 대화 수 상한. 넘으면 오래 안 연 것부터 목차와 파일을 지운다 (main 이 파일도 지운다) */
export const MAX_THREADS = 1000;
/**
 * claude 는 세션 기록을 기본 30일 뒤 지운다(cleanupPeriodDays). 이보다 오래된 대화를 열면
 * --resume 이 없는 세션을 찾다 실패하므로 세션 대신 최근 문답을 글로 붙여 이어 간다
 */
export const CLAUDE_SESSION_DAYS = 30;

/** 파일 이름으로 쓰는 id 라 모양을 좁힌다 (../ 같은 것으로 다른 파일을 열거나 지우지 못하게) */
export const isThreadId = (v: unknown): v is string =>
  typeof v === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(v);

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

/** 글자 수로 자른다. 이모지나 한글 조합이 반으로 갈리지 않게 코드 포인트로 센다 */
export function cut(s: string, max: number): string {
  const chars = [...s];
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : s;
}

/** 첫 질문으로 만든 제목. 질문이 없으면(그림만, 규칙 답만) 빈 글이고 화면이 "제목 없음"을 쓴다 */
export function titleFrom(messages: SavedChat['messages']): string {
  const q = messages.find((m) => m.role === 'user' && oneLine(m.text));
  return q ? cut(oneLine(q.text), TITLE_MAX) : '';
}

/** 마지막으로 답한 AI (규칙 답은 AI 가 아니라 뺀다) */
export function providerOf(messages: SavedChat['messages']): AiProvider | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role === 'pet' && !m.byRules && m.provider) return m.provider;
  }
  return undefined;
}

/** 대화를 저장할 때 목차 줄을 새로 만들거나 고친다. 이름 바꾼 제목과 만든 날은 그대로 둔다 */
export function upsertMeta(
  index: ThreadIndex,
  id: string,
  saved: SavedChat,
  now: number,
  isolated?: boolean,
): ThreadIndex {
  const prev = index.threads.find((m) => m.id === id);
  const first = saved.messages.find((m) => m.role === 'user' && oneLine(m.text));
  const meta: ThreadMeta = {
    id,
    title: prev?.renamed ? prev.title : titleFrom(saved.messages),
    ...(prev?.renamed ? { renamed: true as const } : {}),
    ...(() => {
      const p = providerOf(saved.messages) ?? prev?.provider;
      return p ? { provider: p } : {};
    })(),
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
    count: saved.messages.length,
    first: first ? cut(oneLine(first.text), FIRST_MAX) : '',
    ...(isolated !== undefined ? { isolated } : {}),
  };
  return {
    ...index,
    threads: prev ? index.threads.map((m) => (m.id === id ? meta : m)) : [...index.threads, meta],
  };
}

/** 이름 바꾸기. 비우면 다시 첫 질문 제목으로 돌아간다 */
export function renameMeta(index: ThreadIndex, id: string, title: string, saved?: SavedChat): ThreadIndex {
  const name = cut(oneLine(title), RENAME_MAX);
  return {
    ...index,
    threads: index.threads.map((m) => {
      if (m.id !== id) return m;
      if (name) return { ...m, title: name, renamed: true as const };
      const { renamed: _r, ...rest } = m;
      return { ...rest, title: saved ? titleFrom(saved.messages) : m.first ? cut(m.first, TITLE_MAX) : '' };
    }),
  };
}

/** 목차에서 뺀다. 지금 열린 대화였으면 current 도 비운다 */
export function removeMeta(index: ThreadIndex, id: string): ThreadIndex {
  return {
    ...(index.current && index.current !== id ? { current: index.current } : {}),
    threads: index.threads.filter((m) => m.id !== id),
  };
}

/** 상한을 넘으면 오래된 것(마지막 대화 기준)부터 뺄 id. 지금 열린 대화는 남긴다 */
export function overflow(index: ThreadIndex, max = MAX_THREADS): string[] {
  if (index.threads.length <= max) return [];
  return [...index.threads]
    .filter((m) => m.id !== index.current)
    .sort((a, b) => a.updatedAt - b.updatedAt)
    .slice(0, index.threads.length - max)
    .map((m) => m.id);
}

/** 최근에 이야기한 것부터. 찾는 말이 있으면 제목이나 첫 질문에 든 것만 (대소문자 무시) */
export function listThreads(index: ThreadIndex, query = ''): ThreadMeta[] {
  const q = oneLine(query).toLocaleLowerCase();
  const all = [...index.threads].sort((a, b) => b.updatedAt - a.updatedAt);
  if (!q) return all;
  return all.filter(
    (m) => m.title.toLocaleLowerCase().includes(q) || m.first.toLocaleLowerCase().includes(q),
  );
}

/** 목차 파일을 읽는다. 모양이 틀린 줄과 겹치는 id 는 버린다. 아예 틀리면 빈 목차 */
export function parseIndex(raw: unknown): ThreadIndex {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const seen = new Set<string>();
  const threads: ThreadMeta[] = [];
  for (const t of Array.isArray(r.threads) ? r.threads : []) {
    const v = (typeof t === 'object' && t !== null ? t : {}) as Record<string, unknown>;
    if (!isThreadId(v.id) || seen.has(v.id)) continue;
    if (typeof v.createdAt !== 'number' || typeof v.updatedAt !== 'number') continue;
    seen.add(v.id);
    threads.push({
      id: v.id,
      title: typeof v.title === 'string' ? cut(v.title, RENAME_MAX) : '',
      ...(v.renamed === true ? { renamed: true as const } : {}),
      ...(typeof v.provider === 'string' && v.provider ? { provider: v.provider } : {}),
      createdAt: v.createdAt,
      updatedAt: v.updatedAt,
      count: Number.isInteger(v.count) && (v.count as number) >= 0 ? (v.count as number) : 0,
      first: typeof v.first === 'string' ? cut(v.first, FIRST_MAX) : '',
      ...(typeof v.isolated === 'boolean' ? { isolated: v.isolated } : {}),
    });
  }
  const current = isThreadId(r.current) && seen.has(r.current) ? r.current : undefined;
  return { ...(current ? { current } : {}), threads };
}

/**
 * 켤 때 지금 대화(chat-history)를 목록의 어느 대화로 볼지.
 * - 목차의 current 와 메시지가 겹치면 그 대화를 이어 간다
 * - 겹치지 않거나 current 가 없는데 대화가 있으면(옛 판에서 올라옴, 옛 판으로 내렸다 다시 올림) 새 대화로 목록에 넣는다
 * - 대화가 비었으면 아무것도 아니다
 */
export function startThread(
  index: ThreadIndex,
  history: SavedChat,
  thread: SavedChat | undefined,
): 'continue' | 'adopt' | 'none' {
  if (history.messages.length === 0) return 'none';
  if (index.current && thread) {
    const ids = new Set(thread.messages.map((m) => m.id));
    if (history.messages.some((m) => ids.has(m.id))) return 'continue';
  }
  return 'adopt';
}

/**
 * 지난 대화를 열 때 세션을 그대로 이어 갈지. 못 이으면 그 AI 세션을 빼고 최근 문답을 글로 붙인다(chat.ts carry).
 * - AI 격리 설정이 저장할 때와 다르면 세션이 다른 폴더에 있다
 * - claude 는 오래된 세션을 지운다 (CLAUDE_SESSION_DAYS)
 */
export function staleSessions(
  meta: ThreadMeta,
  sessions: SavedChat['sessions'],
  now: number,
  isolatedNow: boolean,
  adapterOf: (p: AiProvider) => string | undefined,
): AiProvider[] {
  const out: AiProvider[] = [];
  const old = now - meta.updatedAt > CLAUDE_SESSION_DAYS * 86_400_000;
  for (const p of Object.keys(sessions)) {
    if (meta.isolated !== undefined && meta.isolated !== isolatedNow) out.push(p);
    else if (old && adapterOf(p) === 'claude') out.push(p);
  }
  return out;
}
