import { screen } from 'electron';
import { gazePollMs } from '../shared/gaze.ts';
import type { Rect } from '../shared/geometry.ts';
import { boostOn } from './boost.ts';

/**
 * 커서 바라보기용 커서 읽기. 펫 창(기본 펫, 친구)이 여럿이어도 커서는 한 번만 읽어 모두에게 준다.
 * 예전에는 창마다 250ms 타이머를 따로 돌려 친구 셋이면 1초에 16번 깨어났다 (쉬는 CPU 0.26%, 2026-10-07 측정).
 * 커서가 모든 펫에서 멀면 느슨히 본다 (gazePollMs).
 */
export interface CursorWatcher {
  /** 이 펫의 지금 자리 (가까운지 볼 때 쓴다) */
  rect: () => Rect;
  onCursor: (cursor: { x: number; y: number }) => void;
}

const watchers = new Set<CursorWatcher>();
let timer: ReturnType<typeof setTimeout> | undefined;

function tick() {
  timer = undefined;
  if (watchers.size === 0) return;
  const cursor = screen.getCursorScreenPoint();
  // 다음 차례를 먼저 건다. 듣는 쪽 하나가 던져도 커서 보기가 멈추지 않게
  timer = setTimeout(
    tick,
    gazePollMs(
      [...watchers].map((w) => w.rect()),
      cursor,
      boostOn(),
    ),
  );
  for (const w of watchers) w.onCursor(cursor);
}

export function watchCursor(w: CursorWatcher): () => void {
  watchers.add(w);
  timer ??= setTimeout(tick, 0);
  return () => {
    watchers.delete(w);
    if (watchers.size === 0) {
      clearTimeout(timer);
      timer = undefined;
    }
  };
}
