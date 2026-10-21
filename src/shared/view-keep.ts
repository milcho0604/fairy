// 보던 위치 보관 (이슈 #145). 패널은 탭을 바꾸면 그 탭을 새로 그리고, 닫았다 열면 창이 새로 생겨서
// 할 일의 검색어, 고른 태그, 완료 목록 펼침, 쪽 수, 일정의 고른 날, 탭마다 스크롤이 처음으로 돌아갔다.
// 메인이 메모리에 들고 있다가 창을 열 때 돌려준다 (디스크에 쓰지 않는다). 오래 두면 헷갈리니 한 시간이 지나면 버린다.

export interface ViewKeep {
  todo: {
    finding: boolean;
    query: string;
    tag: string | null;
    showDone: boolean;
    /** 찾는 말과 태그가 같을 때만 쓰는 쪽 수 (paging.key 와 같은 열쇠) */
    pageKey: string;
    pages: number;
  };
  event: {
    /** 달력에서 고른 날 (YYYY-MM-DD). 없으면 오늘 */
    day: string | null;
    /** 그 날을 고른 때의 오늘 (자정을 넘겼는지 가리려고) */
    today: string | null;
  };
  /** 탭 이름별 스크롤 위치 (CSS px) */
  scroll: Record<string, number>;
  /** 마지막으로 바꾼 때 (밀리초) */
  at: number;
}

/** 이만큼 지나면 잊는다 */
export const VIEW_KEEP_MS = 60 * 60_000;
const SCROLL_MAX = 1_000_000;
const QUERY_MAX = 200;
const PAGES_MAX = 1000;
const SCROLL_KEYS = 8;

export function emptyViewKeep(): ViewKeep {
  return {
    todo: { finding: false, query: '', tag: null, showDone: false, pageKey: '', pages: 1 },
    event: { day: null, today: null },
    scroll: {},
    at: 0,
  };
}

const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const str = (v: unknown, max: number, d = ''): string => (typeof v === 'string' ? v.slice(0, max) : d);

/** 렌더러가 보낸 값을 믿지 않고 다시 읽는다. 틀린 칸은 기본값 */
export function parseViewKeep(raw: unknown, now: number): ViewKeep {
  const base = emptyViewKeep();
  if (typeof raw !== 'object' || raw === null) return base;
  const r = raw as Record<string, unknown>;
  const todo = (typeof r.todo === 'object' && r.todo !== null ? r.todo : {}) as Record<string, unknown>;
  const event = (typeof r.event === 'object' && r.event !== null ? r.event : {}) as Record<string, unknown>;
  const scroll: Record<string, number> = {};
  if (typeof r.scroll === 'object' && r.scroll !== null) {
    for (const [k, v] of Object.entries(r.scroll).slice(0, SCROLL_KEYS)) {
      if (typeof v === 'number' && Number.isFinite(v) && v > 0)
        scroll[k.slice(0, 24)] = Math.min(v, SCROLL_MAX);
    }
  }
  const pages = typeof todo.pages === 'number' && Number.isInteger(todo.pages) ? todo.pages : 1;
  return {
    todo: {
      finding: todo.finding === true,
      query: str(todo.query, QUERY_MAX),
      tag: typeof todo.tag === 'string' && todo.tag ? todo.tag.slice(0, 60) : null,
      showDone: todo.showDone === true,
      pageKey: str(todo.pageKey, QUERY_MAX + 80),
      pages: Math.min(Math.max(pages, 1), PAGES_MAX),
    },
    event: { day: isDay(event.day) ? event.day : null, today: isDay(event.today) ? event.today : null },
    scroll,
    at: now,
  };
}

/** 보관한 것이 너무 오래됐으면 빈 값 */
export function freshViewKeep(kept: ViewKeep, now: number): ViewKeep {
  return kept.at > 0 && now - kept.at <= VIEW_KEEP_MS ? kept : emptyViewKeep();
}

/** 일정에서 고른 날을 다시 쓸 날: 자정을 넘겨 "오늘"을 고르고 있던 사람은 새 오늘로 */
export function restoredEventDay(kept: ViewKeep['event'], today: string): string {
  if (!kept.day) return today;
  return kept.day === kept.today && kept.today !== today ? today : kept.day;
}
