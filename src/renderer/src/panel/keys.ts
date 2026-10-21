// 패널과 빠른 입력의 Esc 순서: 입력칸이 먼저(비우기, 뒤로), 그다음 창 닫기. 한글 조합 중 Esc 는 조합만 끝낸다.

interface KeyLike {
  key: string;
  isComposing?: boolean;
  keyCode?: number;
  defaultPrevented?: boolean;
}

/** Esc 를 눌렀고 한글 조합 중이 아니다 (조합 중 Esc 는 글자를 마무리하는 키라 아무것도 하지 않는다) */
export function isEsc(e: KeyLike | { key: string; nativeEvent: KeyLike }): boolean {
  if (e.key !== 'Escape') return false;
  const n: KeyLike = 'nativeEvent' in e ? e.nativeEvent : e;
  return !n.isComposing && n.keyCode !== 229;
}

/** 창 전체에 건 Esc: 입력칸이 이미 처리했으면(preventDefault) 닫지 않는다 */
export function escClosesWindow(e: KeyLike): boolean {
  return isEsc(e) && !e.defaultPrevented;
}

/** 입력칸이 Esc 를 먹었다: 창 닫기까지 가지 않게 */
export function takeEsc(e: { preventDefault(): void; stopPropagation(): void }): void {
  e.preventDefault();
  e.stopPropagation();
}

/** 수식키가 있는 키 (탭 옮기기, 되돌리기) */
export interface ModKeyLike {
  key: string;
  code?: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  isComposing?: boolean;
}

/** 맥은 Cmd, 그 밖은 Ctrl 하나만 (Option, Shift 가 같이 눌렸으면 아니다) */
const onlyMod = (e: ModKeyLike, mac: boolean) =>
  (mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey) && !e.altKey && !e.shiftKey && !e.isComposing;

/** Cmd/Ctrl + 1~count 면 그 탭 번호(0부터). 한글 입력 중에도 되게 code(Digit1) 로 본다 */
export function tabByKey(e: ModKeyLike, mac: boolean, count: number): number | undefined {
  if (!onlyMod(e, mac)) return undefined;
  const m = /^Digit([1-9])$/.exec(e.code ?? '') ?? /^([1-9])$/.exec(e.key);
  const n = m ? Number(m[1]) : 0;
  return n >= 1 && n <= count ? n - 1 : undefined;
}

/**
 * Cmd/Ctrl+Z 를 알림의 "되돌리기"로 쓸지. 쓰던 글이 있는 입력칸에서는 글 되돌리기(운영체제 몫)라 아니다.
 * fieldText: 커서가 있는 입력칸의 글 (입력칸 밖이면 undefined)
 */
export function undoByKey(e: ModKeyLike, mac: boolean, fieldText: string | undefined): boolean {
  if (!onlyMod(e, mac)) return false;
  if ((e.code ?? '') !== 'KeyZ' && e.key.toLowerCase() !== 'z') return false;
  return !fieldText;
}

/**
 * 커서가 있는 입력칸의 "쓰던 글" 판정(undoByKey 의 fieldText). 가장 나중 일이 이긴다 (#145):
 * 입력칸에서 Enter 로 넣어 알림이 떴으면(알림이 마지막 글자 입력보다 나중) 칸이 비었든 아니든 알림을 되돌린다.
 * 알림 뒤에 다시 글을 적었으면 글 되돌리기(운영체제 몫). 알림이 없으면 예전처럼 글이 있거나 쓴 적이 있으면 글.
 * typedAt: 이 칸에 마지막으로 글을 적은 때(포커스를 받은 뒤, 없으면 undefined), toastAt: 되돌릴 알림 중 가장 나중 것이 뜬 때
 */
export function undoFieldText(
  value: string,
  typedAt: number | undefined,
  toastAt: number | undefined,
): string {
  if (toastAt !== undefined && (typedAt === undefined || toastAt > typedAt)) return '';
  return value || (typedAt !== undefined ? 'typed' : '');
}

/**
 * 탭 줄에서 ← → Home End (aria tablist 관례, 설정 창 탭과 같다): 지금 탭 자리(i)에서 갈 자리. 탭 키가 아니면 undefined.
 * 끝에서는 반대 끝으로 돌아 들어간다
 */
export function tabStepByKey(key: string, i: number, count: number): number | undefined {
  if (count <= 0) return undefined;
  if (key === 'ArrowLeft') return (i - 1 + count) % count;
  if (key === 'ArrowRight') return (i + 1) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return undefined;
}
