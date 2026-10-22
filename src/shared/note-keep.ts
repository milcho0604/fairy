// 메모 편집의 보관 글 (이슈 #160, #145 원칙). 쓰다 만 글과 "다른 곳이 먼저 고쳤다" 상태, 닫히기 전 자리를 메모 id 마다 둔다.
// 메인 메모리에만 있다(디스크에 안 쓴다): 앱을 끄면 사라진다. 렌더러 localStorage 는 디스크에 남아 쓰지 않는다.
// 한 메모의 보관 글은 그 메모를 저장했거나 고르기를 끝낼 때만 지운다 (다른 메모를 열고 닫는다고 사라지지 않는다).

import { NOTE_BODY_MAX, NOTE_TITLE_MAX } from './note-store.ts';

export interface NoteKept {
  id: number;
  /** 커서가 있던 칸 */
  field: 'title' | 'body';
  /** 고른 범위 (커서만 있으면 start === end) */
  start: number;
  end: number;
  /** 본문 스크롤 */
  scroll: number;
  /** 적어 둔 때 */
  at: number;
  /** 저장하지 못한 글 (디스크가 가득 찼거나 다른 곳이 먼저 고쳐 거절됐다). 다시 열면 이 글로 열고 다시 저장한다 */
  draft?: { title: string; body: string };
  /** 그 글이 다른 곳이 먼저 고친 메모 위에서 거절된 채였다: 그때 저장돼 있던 글과 시각. 다시 열면 자동 저장하지 않고 고르게 한다 */
  conflict?: { body: string; at: number; title?: string };
  /** 뒤로가기로 나갔다: 패널을 열 때 저절로 열지 않고, 그 메모를 열 때 보관 글을 돌려준다 */
  parked?: true;
}

/** 이보다 오래 지나면 목록에서 연다 (한참 뒤 열었는데 메모가 덜컥 열려 있으면 낯설다) */
export const RESUME_MS = 30 * 60_000;
/** 저장하지 못한 글이 있으면 이만큼은 둔다 (글을 잃지 않게) */
export const DRAFT_MS = 7 * 86_400_000;
/** 메모 몇 개까지 보관하는가 (가장 오래된 것부터 버린다) */
export const NOTE_KEEP_MAX = 30;

const whole = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/** 보관 글 하나를 읽는다. 모양이 틀렸거나 오래됐으면 없다. 글은 메모 상한으로 자른다 */
export function parseNoteKept(v: unknown, now: number): NoteKept | undefined {
  if (typeof v !== 'object' || v === null) return undefined;
  const r = v as Record<string, unknown>;
  if (!whole(r.id) || !whole(r.start) || !whole(r.end) || !whole(r.scroll) || !whole(r.at)) return undefined;
  if (r.field !== 'title' && r.field !== 'body') return undefined;
  const d = r.draft as { title?: unknown; body?: unknown } | undefined;
  const draft =
    typeof d === 'object' && d !== null && typeof d.title === 'string' && typeof d.body === 'string'
      ? { title: d.title.slice(0, NOTE_TITLE_MAX), body: d.body.slice(0, NOTE_BODY_MAX) }
      : undefined;
  const c = r.conflict as { body?: unknown; at?: unknown; title?: unknown } | undefined;
  const conflict =
    draft && typeof c === 'object' && c !== null && typeof c.body === 'string' && whole(c.at)
      ? {
          body: c.body.slice(0, NOTE_BODY_MAX),
          at: c.at,
          ...(typeof c.title === 'string' ? { title: c.title.slice(0, NOTE_TITLE_MAX) } : {}),
        }
      : undefined;
  if (now - r.at > (draft ? DRAFT_MS : RESUME_MS) || r.at > now + 60_000) return undefined;
  return {
    id: r.id,
    field: r.field,
    start: Math.min(r.start, r.end),
    end: Math.max(r.start, r.end),
    scroll: r.scroll,
    at: r.at,
    ...(draft ? { draft } : {}),
    ...(conflict ? { conflict } : {}),
    ...(r.parked === true ? { parked: true as const } : {}),
  };
}

export interface NoteKeep {
  /** 그 메모의 보관 글. 없거나 오래됐으면 undefined */
  get(id: unknown, now: number): NoteKept | undefined;
  /** 보관한다. 값이 비었거나 모양이 틀리면 그 메모의 보관 글을 지운다. 값의 id 는 id 로 덮는다 */
  set(id: unknown, value: unknown, now: number): void;
  /** 가장 나중에 적은 것 (패널을 열 때 그 메모로 돌아간다) */
  latest(now: number): NoteKept | undefined;
  clearAll(): void;
}

export function createNoteKeep(): NoteKeep {
  const map = new Map<number, NoteKept>();
  return {
    get(id, now) {
      if (!whole(id)) return undefined;
      const k = map.get(id);
      const ok = k && parseNoteKept(k, now);
      if (k && !ok) map.delete(id);
      return ok;
    },
    set(id, value, now) {
      if (!whole(id)) return;
      const k =
        typeof value === 'object' && value !== null
          ? parseNoteKept({ ...(value as object), id }, now)
          : undefined;
      map.delete(id);
      if (!k) return;
      map.set(id, k);
      // 넘치면 저장 못 한 글이 없는 칸(자리만 적힌 것)부터 오래된 순으로 버린다
      while (map.size > NOTE_KEEP_MAX) {
        let drop: number | undefined;
        for (const [key, v] of map) {
          if (!v.draft) {
            drop = key;
            break;
          }
        }
        if (drop === undefined) drop = map.keys().next().value;
        if (drop === undefined) break;
        map.delete(drop);
      }
    },
    latest(now) {
      let best: NoteKept | undefined;
      for (const [id, k] of map) {
        const ok = parseNoteKept(k, now);
        if (!ok) {
          map.delete(id);
          continue;
        }
        if (ok.parked || (!ok.draft && now - ok.at > RESUME_MS)) continue;
        if (!best || ok.at >= best.at) best = ok;
      }
      return best;
    },
    clearAll: () => map.clear(),
  };
}
