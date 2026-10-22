// 할 일, 메모, 일정을 한 번에 찾기 (#146). 찾는 규칙은 메모 찾기와 같다 (note-store noteQuery: 대소문자 무시,
// 띄어쓰기는 아무 빈칸, 조합 중인 한글 마지막 글자는 넓게). 종류마다 FIND_PER_KIND 개까지 보이고 넘치면 more.
import { type Note, noteQuery, noteTitle, searchNotes } from './note-store.ts';

/** 종류마다 보여 줄 수 */
export const FIND_PER_KIND = 8;

export interface FindTodoHit {
  id: number;
  title: string;
  due: string | null;
  /** 오늘 끝낸 것 */
  done: boolean;
}
export interface FindNoteHit {
  id: number;
  title: string;
  /** 본문에서만 찾았으면 찾은 곳 둘레 글과 그 안의 찾은 부분 */
  snippet?: string;
  mark?: [number, number];
}
export interface FindEventHit {
  id: number;
  title: string;
  startAt: number;
  allDay: boolean;
}
export interface FindAllResult {
  todos: FindTodoHit[];
  notes: FindNoteHit[];
  events: FindEventHit[];
  /** 종류별로 더 있는데 잘렸다 */
  more: { todos: number; notes: number; events: number };
}

const fold = (s: string) => s.normalize('NFC').toLowerCase();

export interface FindSource {
  /** 안 끝낸 할 일과 오늘 끝낸 할 일 */
  todos: readonly {
    id: number;
    title: string;
    due: string | null;
    doneAt: number | null;
    steps?: readonly { title: string }[];
  }[];
  notes: readonly Pick<Note, 'id' | 'title' | 'body'>[];
  events: readonly { id: number; title: string; startAt: number; allDay: boolean }[];
}

const EMPTY: FindAllResult = { todos: [], notes: [], events: [], more: { todos: 0, notes: 0, events: 0 } };

/** 빈 말이면 아무것도 돌려주지 않는다 (다 보여 주는 것은 각 탭의 몫) */
export function findAll(query: string, src: FindSource, now: number, composing = false): FindAllResult {
  const re = noteQuery(query, composing);
  if (!re) return EMPTY;
  const todos = src.todos
    .filter((x) => re.test(fold(x.title)) || (x.steps ?? []).some((s) => re.test(fold(s.title))))
    // 안 끝낸 것이 먼저
    .sort((a, b) => Number(a.doneAt !== null) - Number(b.doneAt !== null))
    .map((x) => ({ id: x.id, title: x.title, due: x.due, done: x.doneAt !== null }));
  const byId = new Map(src.notes.map((n) => [n.id, n]));
  const notes = searchNotes([...src.notes], query, composing).map((h) => {
    const n = byId.get(h.id) as Pick<Note, 'id' | 'title' | 'body'>;
    return { id: h.id, title: noteTitle(n), ...(h.snippet ? { snippet: h.snippet, mark: h.mark } : {}) };
  });
  // 일정은 앞으로 올 것(가까운 것부터)이 먼저, 지난 것은 최근 것부터
  const events = src.events
    .filter((e) => re.test(fold(e.title)))
    .sort((a, b) => {
      const fa = a.startAt >= now;
      const fb = b.startAt >= now;
      if (fa !== fb) return fa ? -1 : 1;
      return fa ? a.startAt - b.startAt : b.startAt - a.startAt;
    })
    .map((e) => ({ id: e.id, title: e.title, startAt: e.startAt, allDay: e.allDay }));
  return {
    todos: todos.slice(0, FIND_PER_KIND),
    notes: notes.slice(0, FIND_PER_KIND) as FindNoteHit[],
    events: events.slice(0, FIND_PER_KIND),
    more: {
      todos: Math.max(0, todos.length - FIND_PER_KIND),
      notes: Math.max(0, notes.length - FIND_PER_KIND),
      events: Math.max(0, events.length - FIND_PER_KIND),
    },
  };
}
