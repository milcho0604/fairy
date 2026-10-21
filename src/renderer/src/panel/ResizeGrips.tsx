import { type KeyboardEvent, type PointerEvent, useRef } from 'react';
import { t } from '../../../shared/i18n/index.ts';

// 패널 크기 손잡이 (오른쪽 아래 모서리, 아래 가장자리, 오른쪽 가장자리). 투명한 틀 없는 창이라 운영체제 크기 조절은
// 플랫폼마다 보장되지 않아 카드 안에 손잡이를 둔다. 끌기 시작과 끝을 메인에 알리면 그동안 다른 곳을 눌러도 닫히지 않는다.
// 바라는 크기는 "손잡이를 잡은 자리 그대로 따라오는 크기"(마우스 x + 잡을 때 모서리까지 거리)라 창이 늦게 따라와도 쌓이지 않는다.

const bridge = window.jjakkungPanel;
const KEY_STEP = 10;
const KEY_STEP_BIG = 50;

type Edge = 'se' | 's' | 'e';

export function ResizeGrips() {
  /** 끄는 중이면 잡을 때 모서리까지 거리 */
  const drag = useRef<{ edge: Edge; gx: number; gy: number; id: number }>(undefined);
  const frame = useRef<number>(undefined);
  const want = useRef<{ w?: number; h?: number }>({});

  const flush = () => {
    frame.current = undefined;
    bridge.resize(want.current.w, want.current.h);
  };

  const down = (edge: Edge) => (e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0 || drag.current) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = {
      edge,
      gx: window.innerWidth - e.clientX,
      gy: window.innerHeight - e.clientY,
      id: e.pointerId,
    };
    want.current = {};
    bridge.resizeStart();
  };

  const move = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    want.current = {
      ...(d.edge !== 's' ? { w: e.clientX + d.gx } : {}),
      ...(d.edge !== 'e' ? { h: e.clientY + d.gy } : {}),
    };
    // 화면 갱신마다 한 번만 (초당 60번 안쪽)
    if (frame.current === undefined) frame.current = requestAnimationFrame(flush);
  };

  const end = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    drag.current = undefined;
    if (frame.current !== undefined) {
      cancelAnimationFrame(frame.current);
      flush();
    }
    bridge.resizeEnd();
  };

  const key = (e: KeyboardEvent<HTMLButtonElement>) => {
    const step = e.shiftKey ? KEY_STEP_BIG : KEY_STEP;
    const dx = e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0;
    const dy = e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0;
    if (!dx && !dy) return;
    e.preventDefault();
    bridge.resizeStart();
    bridge.resize(window.innerWidth + dx, window.innerHeight + dy);
    bridge.resizeEnd();
  };

  const handlers = (edge: Edge) => ({
    onPointerDown: down(edge),
    onPointerMove: move,
    onPointerUp: end,
    onPointerCancel: end,
    onDoubleClick: () => bridge.resizeReset(),
  });

  return (
    <>
      <div className="grip grip-e" aria-hidden="true" {...handlers('e')} />
      <div className="grip grip-s" aria-hidden="true" {...handlers('s')} />
      <button
        type="button"
        className="grip grip-se"
        aria-label={t('panel.resize.label')}
        title={t('panel.resize.hint')}
        onKeyDown={key}
        {...handlers('se')}
      >
        <svg viewBox="0 0 14 14" aria-hidden="true">
          <path
            d="M12 5L5 12M12 9L9 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </>
  );
}
