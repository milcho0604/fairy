import { useCallback, useEffect, useRef, useState } from 'react';
import type { PanelDraftKind } from '../../../shared/draft-store.ts';

// 쓰던 글 보관 (이슈 #145). 입력칸 값을 메인에 맡기고, 창이 새로 뜨면 돌려받는다.
// 메인 메모리에만 있다(디스크에 안 쓴다). 큰 창과 작은 패널이 같은 글을 보게 하려고 렌더러 localStorage 를 쓰지 않는다.

const bridge = window.jjakkungPanel;
/** 타자마다 보내지 않고 이만큼 멈추면 보낸다 */
export const DRAFT_SAVE_MS = 250;

/**
 * 입력칸 값 하나를 메인과 맞춘다. 처음 값은 메인이 들고 있던 글.
 * 비우기(보내기, 지우기)는 바로 보내고, 쓰는 중에는 멈추면 보내며, 창이 닫힐 때도 보낸다.
 */
export function useDraft(kind: PanelDraftKind): [string, (next: string) => void] {
  const [text, setTextState] = useState(() => bridge.draftGet(kind));
  const latest = useRef(text);
  /** 아직 메인에 안 보낸 값이 있다 */
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
    if (!dirty.current) return;
    dirty.current = false;
    bridge.draftSet(kind, latest.current);
  }, [kind]);

  const setText = useCallback(
    (next: string) => {
      latest.current = next;
      dirty.current = true;
      setTextState(next);
      clearTimeout(timer.current);
      if (!next) flush();
      else timer.current = setTimeout(flush, DRAFT_SAVE_MS);
    },
    [flush],
  );

  useEffect(() => {
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', flush);
      flush();
    };
  }, [flush]);

  return [text, setText];
}
