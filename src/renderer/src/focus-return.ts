import { useEffect, useRef } from 'react';

/**
 * 시트나 확인 상자가 닫히면 포커스를 그것을 연 단추로 돌려준다 (키보드 사용자가 처음 자리로 돌아오게).
 * active 가 켜지는 렌더에서 그때의 포커스 자리를 기억한다(마운트하면서 열리는 시트는 true 를 넘긴다).
 * 닫힌 뒤 포커스가 이미 다른 곳에 있으면(사용자가 옮겼거나 다음 화면이 가져감) 건드리지 않는다
 */
export function useReturnFocus(active: boolean): void {
  const opener = useRef<Element | null>(null);
  const was = useRef(false);
  if (active && !was.current) opener.current = document.activeElement;
  was.current = active;
  useEffect(() => {
    if (!active) return;
    const el = opener.current;
    return () => {
      if (!(el instanceof HTMLElement)) return;
      requestAnimationFrame(() => {
        const now = document.activeElement;
        if (el.isConnected && (!now || now === document.body)) el.focus();
      });
    };
  }, [active]);
}
