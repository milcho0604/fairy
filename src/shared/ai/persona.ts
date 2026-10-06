// 펫 성격과 말투 (v1), 내 할 일을 아는 대화 (v1), 답을 할 일로 (v1).

export type PersonaId = 'friend' | 'polite' | 'tsundere' | 'calm';

export const PERSONAS: readonly { id: PersonaId; label: string; hint: string }[] = [
  { id: 'friend', label: '다정한 친구', hint: '반말로 다정하게. 기본.' },
  { id: 'polite', label: '존댓말 비서', hint: '존댓말로 차분하고 깔끔하게.' },
  { id: 'tsundere', label: '츤데레', hint: '툴툴대지만 결국 잘 챙겨 준다.' },
  { id: 'calm', label: '차분한 선생님', hint: '반말로 천천히, 이유를 짚어 준다.' },
];

export function isPersona(v: unknown): v is PersonaId {
  return PERSONAS.some((p) => p.id === v);
}

const VOICE: Record<PersonaId, string> = {
  friend: '옆자리 짝꿍처럼 반말로 다정하게 말한다.',
  polite: '사용자를 돕는 비서처럼 존댓말로 차분하고 깔끔하게 말한다.',
  tsundere: '반말로 살짝 툴툴대며 말하지만 내용은 정확하고 끝까지 챙겨 준다. 무례하거나 비꼬지는 않는다.',
  calm: '차분한 선생님처럼 반말로 천천히 말하고, 필요하면 왜 그런지 한 줄로 짚어 준다.',
};

/** 펫 성격 지시. 이모지는 쓰지 않는다 (D5). */
export function persona(petName: string, id: PersonaId = 'friend'): string {
  return [
    `너는 사용자 컴퓨터 화면 위에 사는 데스크톱 펫 "${petName}"다. ${VOICE[id]}`,
    '답은 짧게, 핵심부터. 길게 설명해야 하면 목록으로 나눈다.',
    '사용자가 화면 캡처를 보내면 그 화면을 같이 보고 있다고 생각하고 답한다.',
    '이모지는 쓰지 않는다.',
  ].join(' ');
}

// ---- 내 할 일을 아는 대화 ----

export interface ContextTodo {
  title: string;
  due: string | null;
  important: boolean;
}

export interface ContextEvent {
  /** "오후 3:00" 같은 글 */
  time: string;
  title: string;
}

/** 보낼 할 일 수 상한. 넘치면 중요, 마감 빠른 순으로 자른다. */
export const CONTEXT_TODO_MAX = 20;

/**
 * 질문 앞에 붙일 "오늘 내 상황". 할 일 제목, 마감, 오늘 남은 일정 제목만 보낸다(기획서 개인정보 표).
 * 아무것도 없으면 빈 글.
 */
export function todoContext(o: {
  today: string;
  todos: readonly ContextTodo[];
  events: readonly ContextEvent[];
}) {
  const todos = [...o.todos]
    .sort(
      (a, b) => Number(b.important) - Number(a.important) || (a.due ?? '9999').localeCompare(b.due ?? '9999'),
    )
    .slice(0, CONTEXT_TODO_MAX);
  if (todos.length === 0 && o.events.length === 0) return '';
  const due = (t: ContextTodo) => {
    if (!t.due) return '';
    if (t.due < o.today) return ' (마감 지남)';
    if (t.due === o.today) return ' (오늘 마감)';
    return ` (마감 ${t.due})`;
  };
  const lines = [`[내 오늘 상황, ${o.today}]`];
  if (o.events.length > 0) lines.push('남은 일정:', ...o.events.map((e) => `- ${e.time} ${e.title}`));
  if (todos.length > 0)
    lines.push('안 끝낸 할 일:', ...todos.map((t) => `- ${t.important ? '[중요] ' : ''}${t.title}${due(t)}`));
  if (o.todos.length > todos.length) lines.push(`(그 밖에 ${o.todos.length - todos.length}개 더)`);
  lines.push('[질문]');
  return `${lines.join('\n')}\n`;
}

// ---- 답을 할 일로 ----

export const EXTRACT_MAX = 10;
const TITLE_MAX = 80;

/**
 * 답에서 할 일 제목을 뽑는다. 목록(-, *, 1., [ ])이 있으면 그 줄들, 없으면 첫 문장 하나.
 * 마크다운 굵게, 코드 표시는 벗기고, 너무 길면 자른다.
 */
export function extractTodos(answer: string): string[] {
  const clean = (s: string) =>
    s
      .replace(/\*\*|__|`/g, '')
      .replace(/^\s*[[(](중요|important)[\])]\s*/i, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, TITLE_MAX);
  const items = answer
    .split('\n')
    .map((l) => /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s*)?(.+)$/.exec(l)?.[1])
    .filter((t): t is string => !!t)
    .map(clean)
    .filter(Boolean);
  if (items.length > 0) return [...new Set(items)].slice(0, EXTRACT_MAX);
  const first = clean(answer.replace(/^#+\s*/gm, '').split(/(?<=[.!?。])\s|\n/)[0] ?? '');
  return first ? [first] : [];
}

/** 답을 메모로 남길 때 제목: 질문 첫 줄 (없으면 빈 제목이라 본문 첫 줄이 보인다) */
export function noteTitleFromQuestion(question: string): string {
  return (question.split('\n').find((l) => l.trim()) ?? '').trim().slice(0, 60);
}
