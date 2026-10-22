import { type KeyboardEvent, type PointerEvent, useEffect, useRef } from 'react';
import { createExpandHint } from '../../../shared/expand-hint.ts';
import { t } from '../../../shared/i18n/index.ts';
import { PANEL_MAX_WIDTH } from '../../../shared/panel-place.ts';

// 패널 크기 손잡이 (오른쪽 아래 모서리, 아래 가장자리, 오른쪽 가장자리). 투명한 틀 없는 창이라 운영체제 크기 조절은
// 플랫폼마다 보장되지 않아 카드 안에 손잡이를 둔다. 끌기 시작과 끝을 메인에 알리면 그동안 다른 곳을 눌러도 닫히지 않는다.
// 바라는 크기는 "손잡이를 잡은 자리 그대로 따라오는 크기"(마우스 x + 잡을 때 모서리까지 거리)라 창이 늦게 따라와도 쌓이지 않는다.

const bridge = window.jjakkungPanel;
const KEY_STEP = 10;
const KEY_STEP_BIG = 50;
/** 잡고 있는 동안 가만히 있어도 이 간격으로 바라는 크기를 다시 보낸다 (메인이 끝 알림이 끊겼는지 보는 기한보다 짧게) */
const KEEPALIVE_MS = 700;

type Edge = 'se' | 's' | 'e';

/** 가장 넓게 만든 채 더 넓히려 하면 "크게 볼까요?" 를 권한다 (shared/expand-hint.ts). 마지막으로 띄운 때는 메인이 들고 있어 패널을 닫았다 열어도 이어진다 */
const hint = createExpandHint(PANEL_MAX_WIDTH, Date.now, {
  get: () => bridge.expandHintAt(),
  set: () => bridge.expandHintShown(),
});

export function ResizeGrips({ onPastMax }: { onPastMax: () => void }) {
  /** 끄는 중이면 잡을 때 모서리까지 거리 */
  const drag = useRef<{ edge: Edge; gx: number; gy: number; id: number }>(undefined);
  const frame = useRef<number>(undefined);
  const want = useRef<{ w?: number; h?: number }>({});
  const keepalive = useRef<ReturnType<typeof setInterval>>(undefined);

  // 끄는 중에 이 화면이 사라지면 다시 보내기를 멈춘다
  useEffect(() => () => clearInterval(keepalive.current), []);

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
    hint.start();
    bridge.resizeStart();
    clearInterval(keepalive.current);
    keepalive.current = setInterval(() => bridge.resize(want.current.w, want.current.h), KEEPALIVE_MS);
  };

  const move = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    want.current = {
      ...(d.edge !== 's' ? { w: e.clientX + d.gx } : {}),
      ...(d.edge !== 'e' ? { h: e.clientY + d.gy } : {}),
    };
    if (
      hint.drag({ outerWidth: window.outerWidth, innerWidth: window.innerWidth, wantWidth: want.current.w })
    )
      onPastMax();
    // 화면 갱신마다 한 번만 (초당 60번 안쪽)
    if (frame.current === undefined) frame.current = requestAnimationFrame(flush);
  };

  const end = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    drag.current = undefined;
    clearInterval(keepalive.current);
    keepalive.current = undefined;
    if (frame.current !== undefined) {
      cancelAnimationFrame(frame.current);
      flush();
    }
    bridge.resizeEnd();
  };

  const key = (e: KeyboardEvent<HTMLButtonElement>) => {
    // Enter 는 처음 크기로 (손잡이를 두 번 누르는 것과 같다)
    if (e.key === 'Enter') {
      e.preventDefault();
      bridge.resizeReset();
      return;
    }
    const step = e.shiftKey ? KEY_STEP_BIG : KEY_STEP;
    const dx = e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0;
    const dy = e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0;
    if (!dx && !dy) return;
    e.preventDefault();
    hint.start();
    if (
      hint.drag({
        outerWidth: window.outerWidth,
        innerWidth: window.innerWidth,
        wantWidth: dx ? window.innerWidth + dx : undefined,
      })
    )
      onPastMax();
    bridge.resizeStart();
    bridge.resize(window.innerWidth + dx, window.innerHeight + dy);
    bridge.resizeEnd();
  };

  const handlers = (edge: Edge) => ({
    onPointerDown: down(edge),
    onPointerMove: move,
    onPointerUp: end,
    onPointerCancel: end,
    onLostPointerCapture: end,
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
