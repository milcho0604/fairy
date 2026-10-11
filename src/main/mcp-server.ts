// 펫 MCP 서버 (v1). Claude Code, Codex 같은 AI 도구가 "펫 할 일에 넣어 줘"를 할 수 있게 한다.
// 짝꿍 실행 파일을 Node 로 돌려(ELECTRON_RUN_AS_NODE=1) 표준 입출력으로 MCP(JSON-RPC 2.0, 줄 단위)를 주고받는다.
// 짝꿍과 같은 저장 파일(jjakkung.db)을 연다. 짝꿍이 켜져 있으면 몇 초 안에 패널에 보인다 (data_version 을 본다).
// Electron 을 불러오지 않는다. 이 파일은 electron-vite 가 out/main/mcp-server.js 로 따로 낸다.

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { DatabaseSync } from 'node:sqlite';
import { nextUp } from '../shared/briefing.ts';
import { plusDays } from '../shared/day.ts';
import { type Db, SCHEMA_VERSION, schemaVersion } from '../shared/db-schema.ts';
import { findSameEvent } from '../shared/event-dup.ts';
import { overlapping, spanEnd } from '../shared/event-overlap.ts';
import { ALL_DAY_MAX_DAYS, allDaySpan, allDayTimes, EventStore } from '../shared/event-store.ts';
import { NOTE_BODY_MAX, NoteStore, notePreview, noteTitle, searchNotes } from '../shared/note-store.ts';
import { cleanMemoryItem } from '../shared/pet-memory.ts';
import { filterTodos } from '../shared/todo-filter.ts';
import { isRepeat, localDay, STEP_MAX, stepProgress, type Todo, TodoStore } from '../shared/todo-store.ts';
import { writeInbox } from './memory-inbox.ts';

const VERSION = '0.1.0';
const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];

/** 짝꿍 메인과 같은 데이터 폴더 (index.ts 의 setPath 와 맞춘다). */
function userDataDir(): string {
  if (process.env.JJ_USER_DATA) return process.env.JJ_USER_DATA;
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'jjakkung');
  if (process.platform === 'win32')
    return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'jjakkung');
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'jjakkung');
}

let stores: { todos: TodoStore; notes: NoteStore; events: EventStore } | undefined;

/** 저장 파일은 짝꿍이 만들고 판을 올린다. 여기서는 열기만 하고 판이 다르면 거절한다 (덮어쓰지 않게). */
function open() {
  if (stores) return stores;
  const file = join(userDataDir(), 'jjakkung.db');
  if (!existsSync(file)) throw new Error('짝꿍 저장 파일이 없어. 짝꿍을 한 번 켜 줘.');
  const db = new DatabaseSync(file);
  db.exec('pragma journal_mode = wal; pragma busy_timeout = 3000;');
  const v = schemaVersion(db as unknown as Db);
  if (v !== SCHEMA_VERSION)
    throw new Error(`저장 파일(${v}판)과 이 서버(${SCHEMA_VERSION}판)의 판이 달라. 짝꿍을 최신으로 켜 줘.`);
  const d = db as unknown as Db;
  stores = { todos: new TodoStore(d), notes: new NoteStore(d), events: new EventStore(d) };
  return stores;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
/** 2026-02-30 같은 없는 날짜를 거른다 */
const validDay = (day: string) => {
  const d = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === day;
};
const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})$/;

interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (args: Record<string, unknown>) => string;
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** 알림 분: 숫자만 받는다. null, "" 를 Number 로 바꾸면 0 이 되어 "알리지 않음"이 됐다. 없으면 기본 */
const remindOf = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/**
 * 할 일 id: 1 이상의 정수만 받는다. Number 로 바꾸면 "3", true(1), 1.5, [] (0) 같은 것도 통과해
 * 엉뚱한 할 일을 끝내거나 지울 수 있었다 (리뷰 LOW)
 */
export function idOf(v: unknown): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0) throw new Error('id 는 1 이상의 정수로 줘');
  return v;
}

/** 마감일: 비면 null, 모양이 틀리거나 없는 날(2026-02-30)이면 던진다 */
function dueOf(v: unknown): string | null {
  const due = str(v);
  if (!due) return null;
  if (!DAY_RE.test(due) || !validDay(due)) throw new Error('due 는 있는 날짜 YYYY-MM-DD 로 줘');
  return due;
}

const pad = (n: number) => String(n).padStart(2, '0');
const TIME_RE = /^(\d{1,2}):(\d{2})$/;

/** 마감 시각 "HH:mm" 을 하루 안의 분으로. 비면 null, 틀리면 던진다 */
function dueTimeOf(v: unknown): number | null {
  const s = str(v);
  if (!s) return null;
  const m = TIME_RE.exec(s);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw new Error('due_time 은 HH:mm (24시간) 로 줘');
  return Number(m[1]) * 60 + Number(m[2]);
}

/** 단계 목록 인자 (글 배열). 빈 것은 뺀다 */
const stepsOf = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').slice(0, STEP_MAX)
    : [];

/** 할 일 한 줄: [id] (중요) 제목 (마감 날 시각) (반복) [단계 2/5]. withSteps 면 아래에 단계를 번호와 함께 */
function todoLine(t: Todo, withSteps = false): string {
  const time = t.dueMin === null ? '' : ` ${pad(Math.floor(t.dueMin / 60))}:${pad(t.dueMin % 60)}`;
  const p = stepProgress(t.steps);
  const head = `- [${t.id}] ${t.important ? '(중요) ' : ''}${t.title}${t.due ? ` (마감 ${t.due}${time})` : ''}${
    t.repeat ? ` (반복 ${t.repeat})` : ''
  }${p ? ` [단계 ${p.done}/${p.total}]` : ''}`;
  if (!withSteps || t.steps.length === 0) return head;
  return [head, ...t.steps.map((st, i) => `    ${i + 1}. [${st.done ? 'x' : ' '}] ${st.title}`)].join('\n');
}

/** ms 를 현지 "YYYY-MM-DD HH:mm" */
function stamp(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "YYYY-MM-DDTHH:mm" (현지) 를 ms 로. 없는 날짜나 시각이면 던진다 */
function localStartOf(v: unknown): number {
  const m = LOCAL_RE.exec(str(v));
  if (!m) throw new Error('start 는 YYYY-MM-DDTHH:mm (현지 시간) 로 줘');
  if (!validDay(`${m[1]}-${m[2]}-${m[3]}`) || Number(m[4]) > 23 || Number(m[5]) > 59)
    throw new Error('start 가 없는 날짜나 시각이야');
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])).getTime();
}

/** 시각 일정과 시간이 겹치는 일정이 있으면 덧붙일 말 (event-overlap.ts) */
function clashNote(events: EventStore, ev: { id: number; startAt: number; endAt: number | null }): string {
  const span = { ...ev, title: '', allDay: false };
  const hit = overlapping(events.timedOverlapping(ev.startAt, spanEnd(span)), span);
  return hit.length > 0
    ? ` (주의: ${hit.map((e) => `${stamp(e.startAt).slice(11)} ${e.title}`).join(', ')} 일정과 시간이 겹쳐)`
    : '';
}

/** 같은 일정이 이미 있으면 그 일정 (제목, 시작, 종일이 같은 것. event-dup.ts) */
function sameEvent(events: EventStore, ev: { title: string; startAt: number; allDay?: boolean }) {
  return findSameEvent(events.between(ev.startAt, ev.startAt + 1), ev);
}

/** 기억 받은 편지함에 하나 더한다. 짝꿍이 켜져 있으면 곧 "기다리는 기억"으로 옮기고 사용자가 허락한다 */
function remember(text: string): boolean {
  return writeInbox(userDataDir(), text);
}

const TOOLS: Tool[] = [
  {
    name: 'add_todo',
    description: '짝꿍(데스크톱 펫) 할 일 목록에 할 일을 넣는다. 끝내면 사용자가 코인을 받는다.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '할 일 제목 (200자까지)' },
        due: { type: 'string', description: '마감일 YYYY-MM-DD (현지 날짜). 없으면 마감 없음' },
        important: { type: 'boolean', description: '중요 표시' },
        repeat: { type: 'string', enum: ['daily', 'weekdays', 'weekly'], description: '반복' },
        due_time: { type: 'string', description: '마감 시각 HH:mm (24시간, 현지). due 가 있을 때만' },
        steps: {
          type: 'array',
          items: { type: 'string' },
          description: `작은 단계(체크리스트), 위에서부터 (${STEP_MAX}개까지). 큰 일을 쪼갤 때`,
        },
      },
      required: ['title'],
    },
    run: (a) => {
      const title = str(a.title);
      if (!title) throw new Error('title 이 비었어');
      const due = dueOf(a.due);
      const dueMin = dueTimeOf(a.due_time);
      // 마감 날 없이 시각만 주면 저장이 시각을 버리는데 "넣었어"라고만 답해 AI 가 된 줄 알았다
      if (dueMin !== null && due === null) throw new Error('due_time 은 due 가 있을 때만 줄 수 있어');
      const now = Date.now();
      const s = open();
      const added = s.todos.add(
        {
          title,
          due,
          important: a.important === true,
          repeat: isRepeat(a.repeat) ? a.repeat : null,
          dueMin,
        },
        now,
      );
      s.todos.addSteps(added.id, stepsOf(a.steps), now);
      const t = s.todos.get(added.id) ?? added;
      const time = t.dueMin === null ? '' : ` ${pad(Math.floor(t.dueMin / 60))}:${pad(t.dueMin % 60)}`;
      return `할 일을 넣었어 (id ${t.id}): ${t.title}${t.due ? `, 마감 ${t.due}${time}` : ''}${t.repeat ? `, 반복 ${t.repeat}` : ''}${t.steps.length > 0 ? `, 단계 ${t.steps.length}개` : ''}`;
    },
  },
  {
    name: 'list_todos',
    description:
      '짝꿍의 안 끝낸 할 일과 오늘 끝낸 할 일을 본다. 단계(체크리스트)는 번호와 함께 보인다. query 로 제목과 단계에서 찾고, tag 로 제목 속 #태그 할 일만 본다.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '찾을 말 (제목, 단계 제목)' },
        tag: { type: 'string', description: '태그 (# 없이)' },
      },
    },
    run: (a) => {
      const now = Date.now();
      const { open: all, doneToday } = open().todos.list(now);
      const query = str(a.query);
      const tag = str(a.tag).replace(/^#/, '');
      const list = filterTodos(all, { query, tag: tag || null });
      const narrowed = query !== '' || tag !== '';
      return [
        `오늘 ${localDay(now)}`,
        narrowed
          ? `맞는 안 끝낸 할 일 ${list.length}개 (모두 ${all.length}개):`
          : `안 끝낸 할 일 ${list.length}개:`,
        ...list.map((t) => todoLine(t, true)),
        ...(narrowed ? [] : [`오늘 끝낸 일 ${doneToday.length}개:`, ...doneToday.map((t) => todoLine(t))]),
      ].join('\n');
    },
  },
  {
    name: 'complete_todo',
    description: '짝꿍 할 일을 끝낸 것으로 표시한다. id 는 list_todos 에서.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'integer', minimum: 1, description: '할 일 id' } },
      required: ['id'],
    },
    run: (a) => {
      const id = idOf(a.id);
      const s = open();
      const t = s.todos.get(id);
      if (!t) throw new Error(`id ${id} 할 일이 없어`);
      if (t.doneAt !== null) return `이미 끝낸 할 일이야: ${t.title}`;
      const coins = s.todos.complete(id, Date.now());
      return `끝냈어: ${t.title}${coins > 0 ? ` (코인 ${coins}개)` : ''}`;
    },
  },
  {
    name: 'update_todo',
    description: '짝꿍 할 일을 고친다 (제목, 마감, 중요). 준 것만 바꾼다. id 는 list_todos 에서.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'integer', minimum: 1, description: '할 일 id' },
        title: { type: 'string', description: '새 제목 (200자까지)' },
        due: {
          type: ['string', 'null'],
          description: '마감일 YYYY-MM-DD. 빈 글이나 null 이면 마감을 지운다',
        },
        important: { type: 'boolean', description: '중요 표시' },
        due_time: {
          type: ['string', 'null'],
          description: '마감 시각 HH:mm. 빈 글이나 null 이면 시각을 지운다',
        },
        repeat: {
          type: 'string',
          enum: ['daily', 'weekdays', 'weekly', 'none'],
          description: '반복 (none 이면 끔)',
        },
      },
      required: ['id'],
    },
    run: (a) => {
      const id = idOf(a.id);
      const s = open();
      const t = s.todos.get(id);
      if (!t) throw new Error(`id ${id} 할 일이 없어`);
      const patch: Parameters<TodoStore['update']>[1] = {};
      if (a.due_time !== undefined) patch.dueMin = dueTimeOf(a.due_time);
      if (a.repeat === 'none') patch.repeat = null;
      else if (isRepeat(a.repeat)) patch.repeat = a.repeat;
      if (a.title !== undefined) {
        const title = str(a.title);
        if (!title) throw new Error('title 이 비었어');
        patch.title = title;
      }
      if (a.due !== undefined) patch.due = dueOf(a.due);
      if (typeof a.important === 'boolean') patch.important = a.important;
      if (Object.keys(patch).length === 0)
        throw new Error('바꿀 것(title, due, due_time, important, repeat)을 줘');
      if (patch.dueMin != null && (patch.due === undefined ? t.due : patch.due) === null)
        throw new Error('due_time 은 마감 날(due)이 있는 할 일에만 줄 수 있어');
      const next = s.todos.update(id, patch, Date.now()) ?? t;
      const time =
        next.dueMin === null ? '' : ` ${pad(Math.floor(next.dueMin / 60))}:${pad(next.dueMin % 60)}`;
      return `고쳤어 (id ${id}): ${next.important ? '(중요) ' : ''}${next.title}${next.due ? `, 마감 ${next.due}${time}` : ''}${next.repeat ? `, 반복 ${next.repeat}` : ''}`;
    },
  },
  {
    name: 'delete_todo',
    description: '짝꿍 할 일을 지운다 (목록에서 빠진다. 받은 코인은 그대로). id 는 list_todos 에서.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'integer', minimum: 1, description: '할 일 id' } },
      required: ['id'],
    },
    run: (a) => {
      const id = idOf(a.id);
      const s = open();
      const t = s.todos.get(id);
      if (!t) throw new Error(`id ${id} 할 일이 없어`);
      // 패널의 지우기와 같다: 지운 표시만 해서 짝꿍에서 되살릴 수 있다
      s.todos.remove(id, Date.now());
      return `지웠어: ${t.title}`;
    },
  },
  {
    name: 'add_todo_steps',
    description: `짝꿍 할 일에 작은 단계(체크리스트)를 더한다. 큰 일을 쪼갤 때 쓴다 (할 일 하나에 ${STEP_MAX}개까지).`,
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'integer', minimum: 1, description: '할 일 id' },
        steps: { type: 'array', items: { type: 'string' }, description: '단계 제목들, 위에서부터' },
      },
      required: ['id', 'steps'],
    },
    run: (a) => {
      const id = idOf(a.id);
      const s = open();
      const t = s.todos.get(id);
      if (!t) throw new Error(`id ${id} 할 일이 없어`);
      if (t.doneAt !== null) throw new Error(`이미 끝낸 할 일이야: ${t.title}`);
      const steps = stepsOf(a.steps);
      if (steps.length === 0) throw new Error('steps 가 비었어');
      const n = s.todos.addSteps(id, steps, Date.now());
      const after = s.todos.get(id) ?? t;
      const left = steps.length - n;
      return `단계 ${n}개를 더했어${left > 0 ? ` (${STEP_MAX}개까지라 ${left}개는 못 넣었어)` : ''}:\n${todoLine(after, true)}`;
    },
  },
  {
    name: 'check_todo_step',
    description:
      '짝꿍 할 일의 단계를 끝낸 것으로 (done:false 면 되돌린다). step 은 list_todos 에 보이는 단계 번호(1부터).',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'integer', minimum: 1, description: '할 일 id' },
        step: { type: 'integer', minimum: 1, description: '단계 번호 (1부터)' },
        done: { type: 'boolean', description: '기본 true' },
      },
      required: ['id', 'step'],
    },
    run: (a) => {
      const id = idOf(a.id);
      const s = open();
      const t = s.todos.get(id);
      if (!t) throw new Error(`id ${id} 할 일이 없어`);
      const n = typeof a.step === 'number' && Number.isInteger(a.step) ? a.step : 0;
      const st = t.steps[n - 1];
      if (!st) throw new Error(`단계 ${String(a.step)} 이 없어 (단계 ${t.steps.length}개)`);
      const done = a.done !== false;
      s.todos.toggleStep(st.id, done);
      const p = stepProgress((s.todos.get(id) ?? t).steps);
      const all = p && p.done === p.total ? ' 단계를 다 했어. 할 일도 끝낼지 사용자에게 물어봐.' : '';
      return `${done ? '끝냈어' : '되돌렸어'}: ${st.title}${p ? ` (${p.done}/${p.total})` : ''}.${all}`;
    },
  },
  {
    name: 'add_note',
    description: '짝꿍 메모에 마크다운 메모를 남긴다.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '제목 (없으면 본문 첫 줄이 제목처럼 보인다)' },
        body: { type: 'string', description: '본문 (마크다운)' },
      },
      required: ['body'],
    },
    run: (a) => {
      const body = typeof a.body === 'string' ? a.body : '';
      if (!body.trim()) throw new Error('body 가 비었어');
      const n = open().notes.add({ title: str(a.title), body, source: 'ai' }, Date.now());
      return `메모를 남겼어 (id ${n.id})`;
    },
  },
  {
    name: 'search_notes',
    description: '짝꿍 메모를 찾는다 (제목과 본문). 최근에 고친 것부터 제목과 찾은 곳 둘레 글을 준다.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '찾을 말' },
        limit: { type: 'number', description: '몇 개까지 (기본 5, 최대 20)' },
      },
      required: ['query'],
    },
    run: (a) => {
      const query = str(a.query);
      if (!query) throw new Error('query 가 비었어');
      const limit =
        typeof a.limit === 'number' && Number.isFinite(a.limit)
          ? Math.max(1, Math.min(20, Math.floor(a.limit)))
          : 5;
      const list = open().notes.list();
      const byId = new Map(list.map((n) => [n.id, n]));
      const hits = searchNotes(list, query).slice(0, limit);
      if (hits.length === 0) return `찾는 말이 들어간 메모가 없어: ${query}`;
      return hits
        .map((h) => {
          const n = byId.get(h.id);
          return n ? `- [${n.id}] ${noteTitle(n)}: ${h.snippet ?? notePreview(n)}` : '';
        })
        .filter(Boolean)
        .join('\n');
    },
  },
  {
    name: 'read_note',
    description: '짝꿍 메모 하나의 본문 전체(마크다운)를 읽는다. id 는 search_notes 에서.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'integer', minimum: 1, description: '메모 id' } },
      required: ['id'],
    },
    run: (a) => {
      const n = open().notes.get(idOf(a.id));
      if (!n) throw new Error(`id ${String(a.id)} 메모가 없어`);
      return `# ${noteTitle(n)}\n(고친 때 ${stamp(n.updatedAt)})\n\n${n.body}`;
    },
  },
  {
    name: 'append_note',
    description: '짝꿍 메모 끝에 글을 덧붙인다 (원래 글은 그대로). 회의록에 결정 사항 더하기 같은 때.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'integer', minimum: 1, description: '메모 id' },
        text: { type: 'string', description: '덧붙일 글 (마크다운)' },
      },
      required: ['id', 'text'],
    },
    run: (a) => {
      const s = open();
      const n = s.notes.get(idOf(a.id));
      if (!n) throw new Error(`id ${String(a.id)} 메모가 없어`);
      const text = typeof a.text === 'string' ? a.text.trim() : '';
      if (!text) throw new Error('text 가 비었어');
      const body = n.body.trim() ? `${n.body.replace(/\s+$/, '')}\n\n${text}` : text;
      if (body.length > NOTE_BODY_MAX) throw new Error(`메모가 너무 길어져 (${NOTE_BODY_MAX}자까지)`);
      s.notes.update(n.id, { body }, Date.now());
      return `덧붙였어: ${noteTitle(n)}`;
    },
  },
  {
    name: 'add_event',
    description:
      '짝꿍 일정에 넣는다. 시작 전에 펫이 말풍선으로 알린다. start 를 날짜(YYYY-MM-DD)만 주면 종일 일정이고 아침 브리핑에 나온다. 여러 날이면 end_date 도 준다.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        start: {
          type: 'string',
          description: '시작 시각, 현지 시간 YYYY-MM-DDTHH:mm. 종일 일정이면 날짜만 YYYY-MM-DD',
        },
        end_date: {
          type: 'string',
          description: '종일 일정의 마지막 날 YYYY-MM-DD (그날도 든다). 하루면 비운다',
        },
        duration_min: { type: 'number', description: '길이(분). 시각 일정만' },
        remind_min: {
          type: 'number',
          description:
            '몇 분 전에 알릴지 (기본 10). 종일 일정은 첫날 0시 기준이고 기본 0(알리지 않음), 240 이면 전날 저녁 8시',
        },
      },
      required: ['title', 'start'],
    },
    run: (a) => {
      const title = str(a.title);
      if (!title) throw new Error('title 이 비었어');
      if (DAY_RE.test(str(a.start))) {
        const day = str(a.start);
        const end = str(a.end_date);
        if (!validDay(day)) throw new Error('start 날짜가 없는 날이야');
        if (end && (!DAY_RE.test(end) || !validDay(end))) throw new Error('end_date 는 YYYY-MM-DD 로 줘');
        if (end && end < day) throw new Error('end_date 가 start 보다 앞이야');
        if (end && end > plusDays(day, ALL_DAY_MAX_DAYS - 1))
          throw new Error(`종일 일정은 ${ALL_DAY_MAX_DAYS}일까지야`);
        const { events } = open();
        const times = allDayTimes(day, end || null);
        const dup = sameEvent(events, { title, startAt: times.startAt, allDay: true });
        if (dup) return `이미 있어 (id ${dup.id}): ${day} 종일 ${dup.title}`;
        const e = events.add(
          { title, ...times, allDay: true, remindMin: remindOf(a.remind_min) },
          Date.now(),
        );
        return `종일 일정을 넣었어 (id ${e.id}): ${end && end !== day ? `${day}~${end}` : day} ${e.title}`;
      }
      const m = LOCAL_RE.exec(str(a.start));
      if (!m) throw new Error('start 는 YYYY-MM-DDTHH:mm (현지 시간) 로, 종일이면 YYYY-MM-DD 로 줘');
      // 2026-02-30T25:61 을 Date 가 다음 달, 다음 날로 넘겨 받아들이던 것을 막는다
      if (!validDay(`${m[1]}-${m[2]}-${m[3]}`) || Number(m[4]) > 23 || Number(m[5]) > 59)
        throw new Error('start 가 없는 날짜나 시각이야');
      const startAt = new Date(
        Number(m[1]),
        Number(m[2]) - 1,
        Number(m[3]),
        Number(m[4]),
        Number(m[5]),
      ).getTime();
      const dur = Number(a.duration_min);
      const { events } = open();
      const dup = sameEvent(events, { title, startAt });
      if (dup) return `이미 있어 (id ${dup.id}): ${str(a.start)} ${dup.title}`;
      const e = events.add(
        {
          title,
          startAt,
          endAt: Number.isFinite(dur) && dur > 0 ? startAt + dur * 60_000 : null,
          remindMin: remindOf(a.remind_min),
        },
        Date.now(),
      );
      return `일정을 넣었어 (id ${e.id}): ${str(a.start)} ${e.title}${clashNote(events, e)}`;
    },
  },
  {
    name: 'list_events',
    description: '짝꿍 일정을 본다 (오늘부터 며칠).',
    inputSchema: {
      type: 'object',
      properties: { days: { type: 'number', description: '며칠 치 (기본 7, 최대 60)' } },
    },
    run: (a) => {
      const days = Math.max(1, Math.min(60, Number(a.days) || 7));
      const d = new Date();
      // 서머타임이 바뀌는 날이 끼면 하루가 23, 25시간이라 24시간씩 더하지 않고 n 일 뒤 0시를 만든다
      const from = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      const to = new Date(d.getFullYear(), d.getMonth(), d.getDate() + days).getTime();
      const list = open().events.between(from, to);
      if (list.length === 0) return `앞으로 ${days}일 안에 일정이 없어.`;
      const p = (n: number) => String(n).padStart(2, '0');
      return list
        .map((e) => {
          if (e.allDay) {
            const { first, last } = allDaySpan(e);
            return `- [${e.id}] ${first === last ? first : `${first}~${last}`} 종일 ${e.title}`;
          }
          const d = new Date(e.startAt);
          return `- [${e.id}] ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())} ${e.title}`;
        })
        .join('\n');
    },
  },
  {
    name: 'update_event',
    description:
      '짝꿍 일정을 고친다 (제목, 시작 시각, 길이). 준 칸만 바뀐다. 시작을 옮기면 길이는 그대로. 종일 일정은 제목만.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'integer', minimum: 1, description: '일정 id (list_events 에서)' },
        title: { type: 'string' },
        start: { type: 'string', description: '새 시작 시각 YYYY-MM-DDTHH:mm (현지)' },
        duration_min: { type: 'number', description: '새 길이(분). 0 이면 끝 시각 없음' },
      },
      required: ['id'],
    },
    run: (a) => {
      const s = open();
      const e = s.events.get(idOf(a.id));
      if (!e) throw new Error(`id ${String(a.id)} 일정이 없어`);
      if (e.allDay && (a.start !== undefined || a.duration_min !== undefined))
        throw new Error('종일 일정은 제목만 고칠 수 있어');
      const patch: Parameters<EventStore['update']>[1] = {};
      if (a.title !== undefined) {
        const title = str(a.title);
        if (!title) throw new Error('title 이 비었어');
        patch.title = title;
      }
      const startAt = a.start !== undefined ? localStartOf(a.start) : e.startAt;
      if (a.start !== undefined) patch.startAt = startAt;
      const dur =
        typeof a.duration_min === 'number' && Number.isFinite(a.duration_min) ? a.duration_min : undefined;
      if (dur !== undefined) patch.endAt = dur > 0 ? startAt + dur * 60_000 : null;
      else if (a.start !== undefined && e.endAt !== null) patch.endAt = startAt + (e.endAt - e.startAt);
      if (Object.keys(patch).length === 0) throw new Error('바꿀 것(title, start, duration_min)을 줘');
      const after = s.events.update(e.id, patch, Date.now()) ?? e;
      return `고쳤어 (id ${after.id}): ${after.allDay ? '종일' : stamp(after.startAt)} ${after.title}${
        after.allDay ? '' : clashNote(s.events, after)
      }`;
    },
  },
  {
    name: 'delete_event',
    description:
      '짝꿍 일정을 지운다. 캘린더에서 가져온 일정이면 다음 가져오기에서도 되살리지 않는다. 사용자가 지워 달라고 할 때만.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'integer', minimum: 1, description: '일정 id' } },
      required: ['id'],
    },
    run: (a) => {
      const s = open();
      const e = s.events.get(idOf(a.id));
      if (!e) throw new Error(`id ${String(a.id)} 일정이 없어`);
      s.events.remove(e.id, Date.now());
      return `지웠어: ${e.title}`;
    },
  },
  {
    name: 'today_overview',
    description:
      '짝꿍이 보는 오늘 한눈에: 먼저 할 일, 오늘 일정, 지난 마감과 오늘 마감, 중요 할 일, 오늘 끝낸 수. 하루 계획을 도울 때 먼저 부른다.',
    inputSchema: { type: 'object', properties: {} },
    run: () => {
      const now = Date.now();
      const s = open();
      const today = localDay(now);
      const d = new Date(now);
      // 서머타임 날은 하루가 23, 25시간이라 24시간을 더하지 않고 다음 날 0시를 만든다
      const from = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      const events = s.events.between(
        from,
        new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime(),
      );
      const { open: list, doneToday } = s.todos.list(now);
      const next = nextUp({ todos: list, events, now });
      const overdue = list.filter((t) => t.due !== null && t.due < today);
      const due = list.filter((t) => t.due === today);
      const important = list.filter((t) => t.important && (t.due === null || t.due > today));
      const section = (head: string, lines: string[]) => (lines.length ? [head, ...lines] : []);
      return [
        `오늘 ${today}, 지금 ${stamp(now).slice(11)}`,
        ...(next
          ? [
              `먼저 할 일: ${next.title}${next.kind === 'event' ? ` (${stamp(next.startAt).slice(11)} 일정 준비)` : ''}`,
            ]
          : []),
        ...section(
          `일정 ${events.length}개:`,
          events.map((e) => `- [${e.id}] ${e.allDay ? '종일' : stamp(e.startAt).slice(11)} ${e.title}`),
        ),
        ...section(
          `지난 마감 ${overdue.length}개:`,
          overdue.map((t) => todoLine(t)),
        ),
        ...section(
          `오늘 마감 ${due.length}개:`,
          due.map((t) => todoLine(t)),
        ),
        ...section(
          `중요 ${important.length}개:`,
          important.map((t) => todoLine(t)),
        ),
        `오늘 끝낸 일 ${doneToday.length}개, 남은 할 일 모두 ${list.length}개`,
      ].join('\n');
    },
  },
  {
    name: 'remember',
    description:
      '짝꿍이 사용자에 대해 오래 기억할 짧은 글을 남긴다 (예: "아침엔 회의가 많다"). 바로 기억하지 않고 사용자가 짝꿍 설정에서 허락해야 기억이 된다. 100자까지. 사용자가 기억해 달라고 할 때만 쓴다.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', description: '기억할 글 (한 줄, 100자까지)' } },
      required: ['text'],
    },
    run: (a) => {
      const text = cleanMemoryItem(a.text);
      if (!text) throw new Error('text 가 비었어');
      if (!remember(text)) return `이미 기억해 달라고 했어: ${text}`;
      return `짝꿍 설정에서 사용자가 허락하면 기억할게: ${text}`;
    },
  },
];

type Json = Record<string, unknown>;

/** 요청 하나를 처리해 응답(알림이면 undefined)을 돌려준다. 시험에서도 부른다. */
export function handle(msg: Json): Json | undefined {
  // null, 숫자, 배열(일괄 요청) 한 줄에 서버가 죽지 않게. 일괄 요청은 지원하지 않는다
  if (typeof msg !== 'object' || msg === null || Array.isArray(msg))
    return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } };
  const id = msg.id;
  const reply = (result: unknown) => ({ jsonrpc: '2.0', id, result });
  const fail = (code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } });
  if (id === undefined || id === null) return undefined; // 알림 (notifications/initialized 등)
  const params = (msg.params ?? {}) as Json;
  switch (msg.method) {
    case 'initialize': {
      const asked = typeof params.protocolVersion === 'string' ? params.protocolVersion : '';
      return reply({
        protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
        capabilities: { tools: {} },
        serverInfo: { name: 'jjakkung', version: VERSION },
        instructions: '데스크톱 펫 짝꿍의 할 일, 메모, 일정을 다룬다. 사용자가 펫에 넣어 달라고 할 때 쓴다.',
      });
    }
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({
        tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
      });
    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === params.name);
      if (!tool) return fail(-32602, `모르는 도구: ${String(params.name)}`);
      try {
        const text = tool.run((params.arguments ?? {}) as Json);
        return reply({ content: [{ type: 'text', text }] });
      } catch (err) {
        return reply({
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        });
      }
    }
    default:
      return fail(-32601, `모르는 요청: ${String(msg.method)}`);
  }
}

function main() {
  const rl = createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    if (!line.trim()) return;
    let msg: Json;
    try {
      msg = JSON.parse(line);
    } catch {
      process.stdout.write(
        `${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: '읽을 수 없는 JSON' } })}\n`,
      );
      return;
    }
    let out: Json | undefined;
    try {
      out = handle(msg);
    } catch (err) {
      // 도구 하나가 던져도 서버는 살아 있게
      const id = typeof msg === 'object' && msg !== null && !Array.isArray(msg) ? (msg.id ?? null) : null;
      out = {
        jsonrpc: '2.0',
        id,
        error: { code: -32603, message: err instanceof Error ? err.message : String(err) },
      };
    }
    if (out) process.stdout.write(`${JSON.stringify(out)}\n`);
  });
}

// 시험에서 불러올 때는 서버를 띄우지 않는다.
if (process.argv[1]?.endsWith('mcp-server.js')) main();
