// 대화 창 아래 따라가기 (2026-10-12). 새 메시지, 오는 답 조각, "생각 중" 표시가 생기면 맨 아래로 내려 보여 준다.
// 사용자가 위로 올려 옛 대화를 읽는 중이면 끌어내리지 않고 "새 메시지" 단추를 띄운다(누르면 맨 아래로).
// 예전에는 React 가 다시 그릴 때만 내렸다: 5초 뒤 붙는 "오래 걸려" 안내, 늦게 뜨는 그림, 창 크기 바뀜은 다시 그리기가
// 없어 마지막 줄이 가려졌고, 한 번 위로 올린 뒤에는 새 대화나 다른 AI 로 바꿔도 아래로 돌아오지 않았다.

/** 맨 아래에서 이만큼(px) 안이면 "아래를 보고 있다" (손가락 스크롤이 몇 px 남겨도 따라가게) */
export const NEAR_BOTTOM_PX = 48;

export interface ScrollBox {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
}

/** 맨 아래까지 남은 거리 (px, 0 이상) */
export const gapBelow = (b: ScrollBox): number => Math.max(0, b.scrollHeight - b.scrollTop - b.clientHeight);

export const isNearBottom = (b: ScrollBox, px = NEAR_BOTTOM_PX): boolean => gapBelow(b) <= px;

/** 대화 내용의 지문: 이것이 바뀌면 "새로 온 것"이 있다 (입력칸 글자만 바뀐 다시 그리기와 가른다) */
export function contentKey(
  messages: readonly { id: string; status?: string; text?: string; images?: readonly unknown[] }[],
  pendingId: string | undefined,
): string {
  const last = messages.at(-1);
  return [
    messages.length,
    last?.id ?? '',
    last?.status ?? '',
    last?.text?.length ?? 0,
    last?.images?.length ?? 0,
    pendingId ?? '',
  ].join('|');
}

/** 대화가 통째로 바뀌었다 (새 대화, 되돌리기, 다른 대화): 첫 메시지가 다르거나 줄었다 */
export function conversationChanged(
  prev: readonly { id: string }[] | undefined,
  next: readonly { id: string }[],
): boolean {
  if (!prev) return true;
  if (next.length < prev.length) return true;
  return (prev[0]?.id ?? '') !== (next[0]?.id ?? '');
}

/**
 * 무엇이 바뀐 뒤 어떻게 할지.
 * - follow: 맨 아래로 (아래를 보고 있었거나, 내가 막 보냈거나, 대화가 바뀌었다)
 * - notify: 위를 읽는 중에 새것이 왔다. 끌어내리지 않고 "새 메시지" 단추
 * - top: 긴 답이 한 번에 왔다. 답 말풍선 위쪽에 맞추고 "아래로" 단추만 띄운다
 * - stay: 그대로 (새것이 없다)
 */
export function scrollDecision(o: {
  /** 긴 답이 한 번에 왔다 (answerLanding 이 'top'). 따라가기 대신 답 위쪽에 맞춘다 */
  longAnswer?: boolean;
  following: boolean;
  /** 내용 지문이 바뀌었다 (새 메시지, 답 조각, 생각 중 표시) */
  grew: boolean;
  /** 내가 방금 보냈다 */
  sent?: boolean;
  /** 대화나 AI 가 바뀌었다 */
  switched?: boolean;
  /** 크기만 바뀌었다 (그림이 늦게 뜸, 창 크기, "오래 걸려" 안내) */
  resized?: boolean;
}): 'follow' | 'notify' | 'top' | 'stay' {
  if (o.sent || o.switched) return 'follow';
  if (o.following) {
    if (o.grew && o.longAnswer) return 'top';
    return o.grew || o.resized ? 'follow' : 'stay';
  }
  return o.grew ? 'notify' : 'stay';
}

/** 움직임 줄이기면 바로, 아니면 부드럽게 ("새 메시지" 단추로 내려갈 때). 따라가기는 늘 바로 (조각마다 출렁이지 않게) */
export const jumpBehavior = (reducedMotion: boolean): ScrollBehavior => (reducedMotion ? 'auto' : 'smooth');

/** 답이 조각으로 오지 않고 한 번에 왔나: 직전 마지막 메시지가 같은 답의 "오는 중"이 아니었고, 지금은 글이 있는 끝난 답이다 */
export function arrivedWhole(
  prev: { id: string; status?: string } | undefined,
  last: { id: string; role: string; status?: string; text?: string } | undefined,
): boolean {
  if (last?.role !== 'pet' || last.status !== 'done' || !last.text) return false;
  return !(prev?.id === last.id && prev.status === 'streaming');
}

/** 한 번에 온 답이 창 한 면보다 길면 위쪽에 맞춘다 (끝에 서면 처음 몇 줄을 읽으러 되올라가야 한다). 한 면 안이면 맨 아래 */
export const LONG_ANSWER_MARGIN_PX = 24;
export const isLongAnswer = (answerHeight: number, viewHeight: number): boolean =>
  answerHeight > viewHeight - LONG_ANSWER_MARGIN_PX;

/** 답 위쪽에 맞출 scrollTop: 답 위에 조금 여백을 남긴다. 맨 아래보다 더 내려가지 않는다 */
export function answerTopScroll(box: ScrollBox, answerTopInContent: number, pad = 8): number {
  const max = Math.max(0, box.scrollHeight - box.clientHeight);
  return Math.min(max, Math.max(0, answerTopInContent - pad));
}
