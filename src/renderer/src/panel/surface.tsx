// 면(surface) 문맥. 패널 구성요소가 "내가 작은 패널 안인가 큰 창 안인가"와 "창 닫기"를 껍데기에서 받는다 (큰 창 설계 #159).
// 모드 값은 배치가 아니라 동작에만 쓴다: 배치는 본문 칸 폭(컨테이너 쿼리, zone.ts)이 정한다.
import { createContext, type ReactNode, useContext } from 'react';
import { createPortal } from 'react-dom';
import type { SurfaceKind } from '../../../shared/surface-kind.ts';
import type { Zone } from './zone.ts';

export interface SurfaceValue {
  kind: SurfaceKind;
  /** 창 닫기. 작은 패널만 뜻이 있다 (큰 창은 일반 창이라 Esc 로 닫지 않는다) */
  close: () => void;
  /** 본문 칸 위에 덮는 것(시트, 어두운 막, 줄 메뉴)을 올릴 자리. 없으면 그 자리에 그린다 */
  overlayRoot: HTMLElement | null;
  /** 본문 칸 폭의 구간. 구조가 바뀌는 배치(CSS 만으로 안 되는 것)가 쓴다 (zone.ts) */
  zone: Zone;
}

const SurfaceContext = createContext<SurfaceValue>({
  kind: 'panel',
  close: () => {},
  overlayRoot: null,
  zone: 'narrow',
});

export const SurfaceProvider = SurfaceContext.Provider;

export function useSurface(): SurfaceValue {
  return useContext(SurfaceContext);
}

/**
 * 본문 칸 위에 덮는 것을 면의 덮개 자리에 올린다. 탭 본문 칸은 컨테이너(layout containment)라 안에서 fixed 로 그리면
 * 창이 아니라 그 칸이 기준이 되고 쌓임도 칸 안에 갇힌다. 덮개 자리로 올리면 늘 면 기준이다
 */
export function Overlay({ children }: { children: ReactNode }) {
  const { overlayRoot } = useSurface();
  return overlayRoot ? createPortal(children, overlayRoot) : children;
}
