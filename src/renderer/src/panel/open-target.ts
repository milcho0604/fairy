// 한 번에 찾기에서 고른 곳으로 가는 길 (#146). 탭을 바꾼 뒤 그 줄을 찾아 굴려 보이고 잠깐 알린다.

/** data-find-key 가 key 인 줄(할 일 "todo:12", 일정 "event:7")이 그려질 때까지 기다렸다가 굴려 보이고 1초 알린다. 찾았으면 true */
export async function revealRow(key: string, tries = 30): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    const el = document.querySelector<HTMLElement>(`[data-find-key="${key}"]`);
    if (el) {
      const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      el.scrollIntoView({ block: 'center', behavior: calm ? 'auto' : 'smooth' });
      el.classList.add('flash');
      el.focus({ preventScroll: true });
      setTimeout(() => el.classList.remove('flash'), 1000);
      return true;
    }
    await new Promise((r) => setTimeout(r, 60));
  }
  return false;
}

// 메모는 줄이 아니라 편집기를 연다. 메모 탭이 아직 없으면(탭을 바꾸는 중) 그릴 때 가져가고, 이미 떠 있으면 알림을 듣는다
const NOTE_EVENT = 'jj:open-note';
let pendingNote: number | undefined;

export function openNoteById(id: number): void {
  pendingNote = id;
  window.dispatchEvent(new Event(NOTE_EVENT));
}

/** 열라고 맡겨 둔 메모 번호를 한 번만 가져간다 */
export function takePendingNote(): number | undefined {
  const id = pendingNote;
  pendingNote = undefined;
  return id;
}

export function onOpenNote(fn: () => void): () => void {
  window.addEventListener(NOTE_EVENT, fn);
  return () => window.removeEventListener(NOTE_EVENT, fn);
}

// 큰 창에서 메모 구역을 골랐다: 빈 새 메모 칸이 커서를 받아도 된다는 한 번짜리 신호.
// 구역을 고르며 맡겨 두면 칸이 그릴 때 가져가고, 이미 떠 있으면 알림을 듣는다. 오래 묵은 신호는 버린다
const NOTE_FOCUS_EVENT = 'jj:focus-note-draft';
const NOTE_FOCUS_TTL_MS = 1500;
let noteFocusAt: number | undefined;

export function requestNoteFocus(): void {
  noteFocusAt = Date.now();
  window.dispatchEvent(new Event(NOTE_FOCUS_EVENT));
}

/** 맡겨 둔 커서 신호를 한 번만 가져간다 */
export function takeNoteFocus(now = Date.now()): boolean {
  const at = noteFocusAt;
  noteFocusAt = undefined;
  return at !== undefined && now - at < NOTE_FOCUS_TTL_MS;
}

export function onNoteFocus(fn: () => void): () => void {
  window.addEventListener(NOTE_FOCUS_EVENT, fn);
  return () => window.removeEventListener(NOTE_FOCUS_EVENT, fn);
}
