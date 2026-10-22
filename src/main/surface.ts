// 패널 구성요소가 뜨는 면 (창). 지금은 작은 패널 하나, 큰 창이 생기면 둘이 된다 (큰 창 설계 #159).
// 메인이 "지금 보이는 면"을 고르고, 열기 요청이 어느 면에서 왔는지 가른다. 창 객체에 기대지 않아 단위 시험이 된다.

import type { SurfaceKind } from '../shared/surface-kind.ts';

export type { SurfaceKind };

/** 지금 보이는 면: 큰 창이 살아 있으면 큰 창, 없으면 패널. 둘 다 없으면 undefined */
export function pickSurface<T>(
  home: T | undefined,
  panel: T | undefined,
  alive: (w: T) => boolean,
): T | undefined {
  if (home !== undefined && alive(home)) return home;
  if (panel !== undefined && alive(panel)) return panel;
  return undefined;
}

/** 보낸 곳이 어느 면인가. 큰 창이 아니면 패널로 본다 (예전 호출은 모두 패널에서 왔다) */
export function originOf<T>(sender: T, home: T | undefined): SurfaceKind {
  return home !== undefined && sender === home ? 'home' : 'panel';
}

/**
 * 설정, 채팅, 같이 보기를 열라는 요청이 패널을 먼저 닫아야 하는가.
 * 패널은 펫 옆에 뜬 팝오버라 다른 창을 열면 치운다. 큰 창은 일반 창이라 그대로 둔다
 */
export function closesPanelFor(origin: SurfaceKind): boolean {
  return origin === 'panel';
}
