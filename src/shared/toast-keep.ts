import type { EventClash } from './ipc.ts';

// 패널 알림(되돌리기) 보관 (이슈 #145). 알림은 패널 안 상태라 패널을 벗어나면 같이 사라졌다.
// 메인이 메모리에 들고 있다가 패널을 다시 열면 남은 시간 동안 돌려준다 (디스크에 쓰지 않는다).

/** 패널 알림 하나. 끝낸 것, 지운 것, 일정으로 넣은 것 등을 되돌리거나 고르게 한다 */
export type Toast =
  | { kind: 'done'; id: number; coins: number }
  | { kind: 'note-removed'; id: number }
  | { kind: 'event-removed'; id: number }
  | { kind: 'todo-removed'; id: number }
  /** 할 일 칸에 적은 한 줄이 시각이 있어 일정으로 들어갔다. text 는 적은 글 그대로 (할 일로 옮길 때) */
  /** am: 오전, 오후 없는 1~7시를 오후로 읽었다. 오전으로 바꾸면 이 시각으로 옮긴다 */
  | {
      kind: 'to-event';
      id: number;
      startAt: number;
      text: string;
      clash?: EventClash;
      am?: { startAt: number; endAt: number | null };
    }
  /** 지난 마감을 오늘로(to 없음), 못 한 것을 내일로(to: 'tomorrow') 옮겼다. 되돌리면 원래 마감으로 */
  | { kind: 'moved'; moved: { id: number; due: string | null }[]; to?: 'tomorrow'; key?: number }
  | { kind: 'added'; text: string }
  /** 지난 날("어제")이나 매달("매달 25일")로 읽은 할 일: 알리고 되돌리기, 지난 날이면 오늘로 */
  | { kind: 'flagged'; id: number; text: string; past: boolean };

export const TOAST_KINDS = [
  'done',
  'note-removed',
  'event-removed',
  'todo-removed',
  'to-event',
  'moved',
  'added',
  'flagged',
] as const;

/** 목록에 둔 알림. at: 생긴 때, until: 사라질 때 (밀리초) */
export interface KeptToast {
  key: number;
  at: number;
  until: number;
  toast: Toast;
}

/** 보관하는 알림 수 상한 */
export const TOAST_KEEP_MAX = 8;
/** 알림 하나가 이만큼(글자)을 넘으면 버린다 */
const TOAST_JSON_MAX = 20_000;
/** 지금보다 이만큼 넘게 먼 미래로 적힌 사라질 때는 줄인다 (고장 난 시계 값이 알림을 못 사라지게 하지 않게) */
const UNTIL_MAX_MS = 5 * 60_000;

const isKind = (v: unknown): boolean =>
  typeof v === 'string' && (TOAST_KINDS as readonly string[]).includes(v);

/** 창이 보낸 알림 목록을 다시 읽는다: 모양이 틀린 것, 이미 사라질 때가 지난 것은 뺀다. 최근 TOAST_KEEP_MAX 개 */
export function parseToasts(raw: unknown, now: number): KeptToast[] {
  if (!Array.isArray(raw)) return [];
  const out: KeptToast[] = [];
  for (const r of raw.slice(-TOAST_KEEP_MAX)) {
    if (typeof r !== 'object' || r === null) continue;
    const { key, at, until, toast } = r as Record<string, unknown>;
    if (typeof key !== 'number' || !Number.isInteger(key)) continue;
    if (typeof at !== 'number' || !Number.isFinite(at)) continue;
    if (typeof until !== 'number' || !Number.isFinite(until) || until <= now) continue;
    if (typeof toast !== 'object' || toast === null || !isKind((toast as { kind?: unknown }).kind)) continue;
    let size = 0;
    try {
      size = JSON.stringify(toast).length;
    } catch {
      continue;
    }
    if (size > TOAST_JSON_MAX) continue;
    out.push({ key, at, until: Math.min(until, now + UNTIL_MAX_MS), toast: toast as Toast });
  }
  return out;
}

/** 아직 사라질 때가 안 된 알림 */
export function liveToasts(list: readonly KeptToast[], now: number): KeptToast[] {
  return list.filter((k) => k.until > now);
}

/** 되돌릴 수 있는 알림 (끝, 지움, 옮김 등. "added" 는 알리기만 한다) */
export function undoable(list: readonly KeptToast[]): KeptToast[] {
  return list.filter((k) => k.toast.kind !== 'added');
}

/** 화면에 한꺼번에 펼쳐 보일 알림 수. 이보다 많으면 오래된 것은 "되돌릴 수 있는 것 N개" 한 줄로 합친다 */
export const TOAST_SHOWN = 3;

/** 쌓인 알림을 나눈다: shown 은 최근 TOAST_SHOWN 개(오래된 것이 위), folded 는 합칠 오래된 것 */
export function splitToasts(list: readonly KeptToast[]): { folded: KeptToast[]; shown: KeptToast[] } {
  if (list.length <= TOAST_SHOWN) return { folded: [], shown: [...list] };
  return { folded: list.slice(0, list.length - TOAST_SHOWN), shown: list.slice(-TOAST_SHOWN) };
}
