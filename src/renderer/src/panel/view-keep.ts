import { type RefObject, useLayoutEffect } from 'react';
import type { ViewKeep } from '../../../shared/view-keep.ts';

// 보던 위치 보관 (이슈 #145). 패널은 탭을 바꾸면 그 탭을 새로 그리고 닫았다 열면 창이 새로 생긴다.
// 이 창이 도는 동안은 모듈 안 값이 지켜 주고, 닫았다 열 때를 위해 메인에도 맡긴다 (메모리에만, shared/view-keep.ts).

const bridge = window.jjakkungPanel;
const SAVE_MS = 300;

/** 창이 뜰 때 한 번 메인에서 받아 온다 (동기) */
let kept: ViewKeep = bridge.viewGet();
let timer: ReturnType<typeof setTimeout> | undefined;
let dirty = false;

export function viewNow(): ViewKeep {
  return kept;
}

function flush() {
  clearTimeout(timer);
  timer = undefined;
  if (!dirty) return;
  dirty = false;
  bridge.viewSet(kept);
}

/** 보던 위치 일부를 바꾼다. 멈추면 메인에 보낸다 */
export function updateView(patch: (v: ViewKeep) => ViewKeep): void {
  kept = patch(kept);
  dirty = true;
  clearTimeout(timer);
  timer = setTimeout(flush, SAVE_MS);
}

window.addEventListener('pagehide', flush);
window.addEventListener('beforeunload', flush);

/**
 * 스크롤 칸의 위치를 기억하고, 칸이 다시 생기면 그 자리로 돌려놓는다.
 * 칸이 바뀔 수 있는 화면(목록과 달력)은 name 을 다르게 준다.
 */
export function useKeepScroll(ref: RefObject<HTMLElement | null>, name: string): void {
  // biome-ignore lint/correctness/useExhaustiveDependencies: 칸이 새로 생길 때(name 이 바뀔 때)만
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const at = kept.scroll[name] ?? 0;
    if (at > 0) el.scrollTop = at;
    let frame: number | undefined;
    const onScroll = () => {
      if (frame !== undefined) return;
      frame = requestAnimationFrame(() => {
        frame = undefined;
        const top = Math.round(el.scrollTop);
        if ((kept.scroll[name] ?? 0) === top) return;
        const scroll = { ...kept.scroll };
        if (top > 0) scroll[name] = top;
        else delete scroll[name];
        updateView((v) => ({ ...v, scroll }));
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [name]);
}
