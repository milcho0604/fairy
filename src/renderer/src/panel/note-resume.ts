// 메모를 쓰다 패널이 닫히면(다른 곳을 눌러서) 다음에 열 때 그 메모, 그 자리로 돌아간다.
// 글은 이미 저절로 저장되니(400ms 뒤, 창이 닫히기 전에 한 번 더) 여기에는 어디였는지만 둔다.

export interface NoteResume {
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
  /**
   * 저장하지 못한 글 (디스크가 가득 차 저장이 실패한 채 패널이 닫혔다). 다시 열면 이 글로 열고 다시 저장한다 (버그잡이 4)
   */
  draft?: { title: string; body: string };
}

export const RESUME_KEY = 'jj.panel.noteResume';
/** 이보다 오래 지나면 목록에서 연다 (한참 뒤 열었는데 메모가 덜컥 열려 있으면 낯설다) */
export const RESUME_MS = 30 * 60_000;
/** 저장하지 못한 글이 있으면 이만큼은 둔다 (글을 잃지 않게) */
export const DRAFT_MS = 7 * 86_400_000;

const whole = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/** 적어 둔 자리를 읽는다. 모양이 틀렸거나 오래됐으면 없다 */
export function parseResume(raw: string | null, now: number): NoteResume | undefined {
  if (!raw) return undefined;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof v !== 'object' || v === null) return undefined;
  const r = v as Record<string, unknown>;
  if (!whole(r.id) || !whole(r.start) || !whole(r.end) || !whole(r.scroll) || !whole(r.at)) return undefined;
  if (r.field !== 'title' && r.field !== 'body') return undefined;
  const d = r.draft as { title?: unknown; body?: unknown } | undefined;
  const draft =
    typeof d === 'object' && d !== null && typeof d.title === 'string' && typeof d.body === 'string'
      ? { title: d.title, body: d.body }
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
  };
}
