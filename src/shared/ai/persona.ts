// 펫 성격과 말투 (v1), 내 할 일을 아는 대화 (v1), 답을 할 일로 (v1).
import { getLang, t } from '../i18n/index.ts';

export type PersonaId = 'friend' | 'polite' | 'tsundere' | 'calm';

// 이름과 설명은 지금 말로 읽는다 (getter)
const personaOf = (id: PersonaId) => ({
  id,
  get label() {
    return t(`ai.persona.${id}.label`);
  },
  get hint() {
    return t(`ai.persona.${id}.hint`);
  },
});

export const PERSONAS: readonly { id: PersonaId; readonly label: string; readonly hint: string }[] = [
  personaOf('friend'),
  personaOf('polite'),
  personaOf('tsundere'),
  personaOf('calm'),
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

// 영어 화면일 때 성격 지시. 영어로 답하라고 같이 말한다
const VOICE_EN: Record<PersonaId, string> = {
  friend: 'You talk casually and warmly, like a friend at the next desk.',
  polite: 'You talk politely, calmly and neatly, like an assistant helping the user.',
  tsundere:
    'You talk casually and grumble a little, but your answers are accurate and you always follow through. Never rude or sarcastic.',
  calm: 'You talk casually and unhurriedly, like a calm teacher, and briefly point out why when it helps.',
};

// 짝꿍이 기억하는 것(설정)을 읽는 곳. 메인이 시작할 때 정한다. 채팅이 persona 를 부를 때 따로 넘기지 않아도 붙게
let memorySource: () => readonly string[] = () => [];
export function setMemorySource(source: () => readonly string[]): void {
  memorySource = source;
}

/**
 * 펫 성격 지시. 이모지는 쓰지 않는다 (D5).
 * now: 지금 시각(현지)을 알려 준다. AI 가 오늘 날짜나 요일을 몰라 "내일"을 엉뚱하게 셌다.
 * memory: 짝꿍이 기억하는 것. 없으면 설정에서 읽은 것 (일기처럼 질문이 아닌 곳은 빈 목록을 준다)
 */
export function persona(
  petName: string,
  id: PersonaId = 'friend',
  rules = '',
  o: { now?: Date | number; memory?: readonly string[] } = {},
): string {
  const now = new Date(o.now ?? Date.now());
  const tail = withRules(rules) + withMemory(o.memory ?? memorySource());
  if (getLang() === 'en')
    return (
      [
        `You are "${petName}", a desktop pet living on the user's computer screen. ${VOICE_EN[id]}`,
        'Keep answers short and lead with the point. If it needs a long explanation, break it into a list.',
        'If the user sends a screenshot, answer as if you are looking at that screen together.',
        'Do not use emoji.',
        'Answer in English.',
        nowLine(now, 'en'),
      ].join(' ') + tail
    );
  return (
    [
      `너는 사용자 컴퓨터 화면 위에 사는 데스크톱 펫 "${petName}"다. ${VOICE[id]}`,
      '답은 짧게, 핵심부터. 길게 설명해야 하면 목록으로 나눈다.',
      '사용자가 화면 캡처를 보내면 그 화면을 같이 보고 있다고 생각하고 답한다.',
      '이모지는 쓰지 않는다.',
      nowLine(now, 'ko'),
    ].join(' ') + tail
  );
}

const KO_WD = ['일', '월', '화', '수', '목', '금', '토'];
const EN_WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const EN_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "지금은 2026-10-10(토) 오후 3:12." / "It is now Sat, Oct 10, 2026, 3:12 PM." (현지 시각) */
export function nowLine(d: Date, lang: 'ko' | 'en'): string {
  const h = d.getHours();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const mm = String(d.getMinutes()).padStart(2, '0');
  if (lang === 'en')
    return `It is now ${EN_WD[d.getDay()]}, ${EN_MON[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}, ${h12}:${mm} ${h < 12 ? 'AM' : 'PM'}.`;
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return `지금은 ${day}(${KO_WD[d.getDay()]}) ${h < 12 ? '오전' : '오후'} ${h12}:${mm}.`;
}

/** 짝꿍이 기억하는 것을 규칙 뒤에 붙인다. 없으면 빈 글 */
export function withMemory(memory: readonly string[]): string {
  const items = memory.map((m) => m.trim()).filter(Boolean);
  if (items.length === 0) return '';
  const head =
    getLang() === 'en'
      ? 'Things you remember about the user. Use them when they help; no need to bring them up:'
      : '사용자에 대해 기억하는 것이다. 도움이 될 때 참고하고 굳이 꺼내지는 않는다:';
  return `\n\n${head}\n${items.map((m) => `- ${m}`).join('\n')}`;
}

/**
 * 짝꿍 규칙 (6단계): 사용자가 설정에 적은 지시를 성격 뒤에 붙인다. 성격과 부딪치면 규칙이 먼저다.
 * 빈 줄은 빼고 앞뒤 공백을 다듬는다. 없으면 빈 글
 */
export function withRules(rules: string): string {
  const lines = rules
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return '';
  const head =
    getLang() === 'en'
      ? 'Rules the user set for you. Always follow them; they come before the style above:'
      : '사용자가 정한 규칙이다. 늘 지키고, 위의 말투와 부딪치면 규칙을 따른다:';
  return `\n\n${head}\n${lines.map((l) => (/^[-*\d]/.test(l) ? l : `- ${l}`)).join('\n')}`;
}

// ---- 내 할 일을 아는 대화 ----

export interface ContextTodo {
  title: string;
  due: string | null;
  important: boolean;
}

export interface ContextEvent {
  /** "오후 3:00" 같은 글. 종일 일정이면 빈 글 */
  time: string;
  title: string;
  /** 종일 일정: 시각 대신 "종일" */
  allDay?: boolean;
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
  // 틀 글은 화면 말을 따른다 (영어 화면에서 한국어 틀이 붙으면 AI 가 한국어로 답하기도 했다)
  const due = (todo: ContextTodo) => {
    if (!todo.due) return '';
    if (todo.due < o.today) return t('ai.ctx.overdue');
    if (todo.due === o.today) return t('ai.ctx.dueToday');
    return t('ai.ctx.due', { day: todo.due });
  };
  const lines = [t('ai.ctx.head', { day: o.today })];
  if (o.events.length > 0)
    lines.push(
      t('ai.ctx.events'),
      ...o.events.map((e) => `- ${e.allDay ? t('ai.ctx.allDay') : e.time} ${e.title}`),
    );
  if (todos.length > 0)
    lines.push(
      t('ai.ctx.todos'),
      ...todos.map((todo) => `- ${todo.important ? t('ai.ctx.important') : ''}${todo.title}${due(todo)}`),
    );
  if (o.todos.length > todos.length) lines.push(t('ai.ctx.more', { n: o.todos.length - todos.length }));
  lines.push(t('ai.ctx.question'));
  return `${lines.join('\n')}\n`;
}

// ---- 답을 할 일로 ----

export const EXTRACT_MAX = 10;
const TITLE_MAX = 80;

/**
 * 답에서 할 일 제목을 뽑는다. 목록(-, *, 1., [ ])이 있으면 그 줄들, 없으면 첫 문장 하나.
 * 마크다운 굵게, 코드 표시는 벗기고, 너무 길면 자른다.
 * 코드 블록(```) 안의 줄과 들여 쓴 아래 목록(세부 설명)은 할 일이 아니라 뺀다 (예전에는 명령어와 설명이 다 할 일로 들어갔다)
 */
export function extractTodos(answer: string): string[] {
  const clean = (s: string) =>
    s
      .replace(/\*\*|__|`/g, '')
      .replace(/^\s*[[(](중요|important)[\])]\s*/i, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, TITLE_MAX);
  let fenced = false;
  const lines: string[] = [];
  for (const l of answer.replace(/\r\n/g, '\n').split('\n')) {
    if (/^\s*(```|~~~)/.test(l)) {
      fenced = !fenced;
      continue;
    }
    if (!fenced) lines.push(l);
  }
  const bullets = lines
    .map((l) => /^([ \t]*)(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s*)?(.+)$/.exec(l))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => ({ indent: (m[1] ?? '').replace(/\t/g, '    ').length, text: m[2] ?? '' }));
  // 가장 바깥 목록만 (목록 전체가 들여 써져 있어도 그중 가장 얕은 것)
  const top = Math.min(...bullets.map((b) => b.indent));
  const items = bullets
    .filter((b) => b.indent <= top + 1)
    .map((b) => clean(b.text))
    .filter(Boolean);
  if (items.length > 0) return [...new Set(items)].slice(0, EXTRACT_MAX);
  const first = clean(
    lines
      .join('\n')
      .replace(/^#+\s*/gm, '')
      .trim()
      .split(/(?<=[.!?。])\s|\n/)[0] ?? '',
  );
  return first ? [first] : [];
}

/** 답을 메모로 남길 때 제목: 질문 첫 줄 (없으면 빈 제목이라 본문 첫 줄이 보인다) */
export function noteTitleFromQuestion(question: string): string {
  return (question.split('\n').find((l) => l.trim()) ?? '').trim().slice(0, 60);
}
