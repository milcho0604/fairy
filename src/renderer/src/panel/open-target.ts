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
