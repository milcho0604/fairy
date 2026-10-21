// 쓰던 글 보관소 (이슈 #145, 큰 창 설계 #159).
// 창을 닫으면 렌더러 쪽 상태는 사라진다. 일정 입력, 빠른 입력, 채팅 글과 붙인 그림, 할 일 입력은 메인이 메모리에 들고 있다가
// 창을 다시 열면 돌려준다. 큰 창과 작은 패널이 같은 글을 보게 하려는 것이라 렌더러 localStorage 에 두지 않는다.
// 디스크에는 쓰지 않는다: 앱을 끄면 사라진다 (쓰다 만 글이 파일로 남지 않는 쪽이 개인정보에 안전하다).

/** 글을 따로 보관하는 곳 */
export const DRAFT_TEXT_KINDS = ['todo', 'event', 'quick', 'chat'] as const;
export type DraftTextKind = (typeof DRAFT_TEXT_KINDS)[number];

export function isDraftTextKind(v: unknown): v is DraftTextKind {
  return typeof v === 'string' && (DRAFT_TEXT_KINDS as readonly string[]).includes(v);
}

/** 한 칸에 보관하는 글자 수 상한 (붙여 넣은 아주 긴 글이 메모리를 채우지 않게) */
export const DRAFT_TEXT_MAX = 20_000;

export interface DraftBox<I> {
  /** 보관한 글. 없으면 빈 글 */
  text(kind: DraftTextKind): string;
  /** 글을 보관한다. 빈 글(공백뿐인 글 포함)은 비우는 것과 같다. 문자열이 아니거나 종류가 틀리면 무시 */
  setText(kind: unknown, value: unknown): void;
  /** 채팅에 붙인 그림 */
  images(): readonly I[];
  setImages(list: readonly I[]): void;
  /** 한 종류를 비운다 (보냈다, 넣었다) */
  clear(kind: DraftTextKind | 'images'): void;
  /** 전부 비운다 */
  clearAll(): void;
}

export function createDraftBox<I>(): DraftBox<I> {
  const texts = new Map<DraftTextKind, string>();
  let images: readonly I[] = [];
  return {
    text: (kind) => texts.get(kind) ?? '',
    setText(kind, value) {
      if (!isDraftTextKind(kind) || typeof value !== 'string') return;
      if (!value.trim()) {
        texts.delete(kind);
        return;
      }
      texts.set(kind, value.length > DRAFT_TEXT_MAX ? value.slice(0, DRAFT_TEXT_MAX) : value);
    },
    images: () => images,
    setImages(list) {
      images = list;
    },
    clear(kind) {
      if (kind === 'images') images = [];
      else texts.delete(kind);
    },
    clearAll() {
      texts.clear();
      images = [];
    },
  };
}
