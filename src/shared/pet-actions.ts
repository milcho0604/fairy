// 사용자 확인을 받아야 하는 펫 도구 (2026-10-11 보안 점검, 프롬프트 주입).
// 채팅의 AI 는 화면, ICS 일정 제목, 메모처럼 남이 쓴 글을 읽는다. 그 글에 "할 일을 다 지워" 같은 말이 숨어 있으면
// AI 가 그대로 도구를 부를 수 있다. 그래서 채팅에서 부른 지우기, 고치기, 메모 덧붙이기는 바로 하지 않고
// 펫 MCP 서버가 받은 편지함(pet-actions-inbox.json)에 남기고, 짝꿍 메인이 펫 말풍선으로 물어 허락하면 한다.
// "다른 AI 에 붙이기"로 사용자가 직접 연결한 AI 는 그 AI 의 도구 허락 창이 있어 바로 한다.
// MCP 서버(Node)와 메인이 같이 쓴다. Electron 을 불러오지 않는다.

import { cutText } from './cut-text.ts';
import { EventSlotTakenError, type EventStore } from './event-store.ts';
import { NOTE_BODY_MAX, type NoteStore, noteTitle } from './note-store.ts';
import { isRepeat, type Repeat, type TodoStore } from './todo-store.ts';

export const PET_ACTIONS_INBOX = 'pet-actions-inbox';
/** 채팅이 펫 MCP 서버를 띄울 때 주는 환경 변수. 있으면 위 도구는 확인을 기다린다 */
export const CONFIRM_ENV = 'JJ_MCP_CONFIRM';
/** 한 번에 쌓아 둘 수 있는 수 (넘치면 옛것부터 버린다) */
export const PET_ACTIONS_MAX = 20;

export interface TodoPatch {
  title?: string;
  due?: string | null;
  important?: boolean;
  repeat?: Repeat | null;
  dueMin?: number | null;
}
export interface EventPatch {
  title?: string;
  startAt?: number;
  endAt?: number | null;
}

export type PetAction =
  | { tool: 'delete_todo'; id: number }
  | { tool: 'update_todo'; id: number; patch: TodoPatch }
  | { tool: 'delete_event'; id: number }
  | { tool: 'update_event'; id: number; patch: EventPatch }
  | { tool: 'append_note'; id: number; text: string };

export const CONFIRM_TOOLS: readonly PetAction['tool'][] = [
  'delete_todo',
  'update_todo',
  'delete_event',
  'update_event',
  'append_note',
];

const isId = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0;
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TITLE_MAX = 200;

function todoPatchOf(v: unknown): TodoPatch | undefined {
  if (!isObj(v)) return undefined;
  const p: TodoPatch = {};
  if (v.title !== undefined) {
    if (typeof v.title !== 'string' || !v.title.trim()) return undefined;
    p.title = cutText(v.title.trim(), TITLE_MAX);
  }
  if (v.due !== undefined) {
    if (v.due !== null && !(typeof v.due === 'string' && DAY_RE.test(v.due))) return undefined;
    p.due = v.due;
  }
  if (v.important !== undefined) {
    if (typeof v.important !== 'boolean') return undefined;
    p.important = v.important;
  }
  if (v.repeat !== undefined) {
    if (v.repeat !== null && !isRepeat(v.repeat)) return undefined;
    p.repeat = v.repeat;
  }
  if (v.dueMin !== undefined) {
    if (
      v.dueMin !== null &&
      !(Number.isInteger(v.dueMin) && (v.dueMin as number) >= 0 && (v.dueMin as number) < 1440)
    )
      return undefined;
    p.dueMin = v.dueMin as number | null;
  }
  return Object.keys(p).length ? p : undefined;
}

function eventPatchOf(v: unknown): EventPatch | undefined {
  if (!isObj(v)) return undefined;
  const p: EventPatch = {};
  if (v.title !== undefined) {
    if (typeof v.title !== 'string' || !v.title.trim()) return undefined;
    p.title = cutText(v.title.trim(), TITLE_MAX);
  }
  if (v.startAt !== undefined) {
    if (typeof v.startAt !== 'number' || !Number.isFinite(v.startAt)) return undefined;
    p.startAt = v.startAt;
  }
  if (v.endAt !== undefined) {
    if (v.endAt !== null && !(typeof v.endAt === 'number' && Number.isFinite(v.endAt))) return undefined;
    p.endAt = v.endAt;
  }
  return Object.keys(p).length ? p : undefined;
}

/** 편지함에서 읽은 것 하나를 검사한다 (손으로 고친 파일, 다른 프로그램이 쓴 것도 걸러지게). 틀리면 undefined */
export function parsePetAction(v: unknown): PetAction | undefined {
  if (!isObj(v) || !isId(v.id)) return undefined;
  switch (v.tool) {
    case 'delete_todo':
    case 'delete_event':
      return { tool: v.tool, id: v.id };
    case 'update_todo': {
      const patch = todoPatchOf(v.patch);
      return patch ? { tool: 'update_todo', id: v.id, patch } : undefined;
    }
    case 'update_event': {
      const patch = eventPatchOf(v.patch);
      return patch ? { tool: 'update_event', id: v.id, patch } : undefined;
    }
    case 'append_note':
      return typeof v.text === 'string' && v.text.trim()
        ? { tool: 'append_note', id: v.id, text: cutText(v.text.trim(), NOTE_BODY_MAX) }
        : undefined;
    default:
      return undefined;
  }
}

/** 편지함 파일 내용 → 검사한 목록 */
export function parsePetActions(v: unknown): PetAction[] {
  return (Array.isArray(v) ? v : []).map(parsePetAction).filter((a): a is PetAction => !!a);
}

export interface PetActionStores {
  todos: TodoStore;
  events: EventStore;
  notes: NoteStore;
}

/** 무엇을 할지 사람이 읽을 대상 이름 (할 일, 일정, 메모 제목). 대상이 없어졌으면 undefined */
export function actionTarget(s: PetActionStores, a: PetAction): string | undefined {
  if (a.tool === 'delete_todo' || a.tool === 'update_todo') return s.todos.get(a.id)?.title;
  if (a.tool === 'delete_event' || a.tool === 'update_event') return s.events.get(a.id)?.title;
  const n = s.notes.get(a.id);
  return n ? noteTitle(n) : undefined;
}

/**
 * 한다. 대상이 없어졌거나 할 수 없게 됐으면(메모가 너무 길어짐, 종일 일정 시각) false.
 * MCP 서버가 바로 할 때와 메인이 허락받고 할 때 같이 쓴다
 */
export function applyPetAction(s: PetActionStores, a: PetAction, now: number): boolean {
  switch (a.tool) {
    case 'delete_todo':
      if (!s.todos.get(a.id)) return false;
      // 패널의 지우기와 같다: 지운 표시만 해서 짝꿍에서 되살릴 수 있다
      s.todos.remove(a.id, now);
      return true;
    case 'update_todo':
      if (!s.todos.get(a.id)) return false;
      s.todos.update(a.id, a.patch, now);
      return true;
    case 'delete_event':
      if (!s.events.get(a.id)) return false;
      s.events.remove(a.id, now);
      return true;
    case 'update_event': {
      const e = s.events.get(a.id);
      if (!e || (e.allDay && (a.patch.startAt !== undefined || a.patch.endAt !== undefined))) return false;
      try {
        s.events.update(a.id, a.patch, now);
      } catch (err) {
        if (err instanceof EventSlotTakenError) return false;
        throw err;
      }
      return true;
    }
    case 'append_note': {
      const n = s.notes.get(a.id);
      if (!n) return false;
      const body = n.body.trim() ? `${n.body.replace(/\s+$/, '')}\n\n${a.text}` : a.text;
      if (body.length > NOTE_BODY_MAX) return false;
      s.notes.update(n.id, { body }, now);
      return true;
    }
  }
}

/** 편지함에 더한 목록 (같은 것은 한 번, 넘치면 옛것부터 버린다) */
export function addPetAction(list: readonly PetAction[], a: PetAction): PetAction[] {
  const key = JSON.stringify(a);
  return [...list.filter((x) => JSON.stringify(x) !== key), a].slice(-PET_ACTIONS_MAX);
}
