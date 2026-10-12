// 고정(핀) 단추와 줄 메뉴 (우클릭, 메뉴 키, Shift+F10). 메모, 할 일, 일정 줄이 같이 쓴다 (shared/pin.ts)
import { useEffect, useRef, useState } from 'react';
import { t } from '../../../shared/i18n/index.ts';
import type { PinKind } from '../../../shared/pin.ts';
import { PinIcon } from './icons.tsx';
import { isEsc, takeEsc } from './keys.ts';

const bridge = window.jjakkungPanel;

/** 고정 단추. 고정 안 한 것은 줄에 마우스를 올리거나 키보드로 오면 보이고(놓는 자리가 정한다), 고정한 것은 늘 보인다 */
export function PinButton({
  kind,
  id,
  title,
  pinned,
  onToggle,
}: {
  kind: PinKind;
  id: number;
  /** 화면 읽기 이름에 넣는 항목 제목 */
  title: string;
  pinned: boolean;
  /** 눌렀다 (메모 편집 화면은 상태를 따로 들고 있어 바로 바꾼다) */
  onToggle?: (on: boolean) => void;
}) {
  return (
    <button
      type="button"
      className={`pin ${pinned ? 'on' : ''}`}
      aria-pressed={pinned}
      aria-label={pinned ? t('pin.unpinFor', { title }) : t('pin.pinFor', { title })}
      title={pinned ? t('pin.unpin') : t('pin.pin')}
      onClick={(e) => {
        e.stopPropagation();
        bridge.pin(kind, id, !pinned);
        onToggle?.(!pinned);
      }}
    >
      <PinIcon />
    </button>
  );
}

/** 고정한 줄에 늘 보이는 표시 (오늘 탭처럼 단추를 두지 않는 좁은 줄) */
export function PinMark() {
  return (
    <span className="pin-mark" role="img" aria-label={t('pin.pinned')} title={t('pin.pinned')}>
      <PinIcon />
    </span>
  );
}

/**
 * 줄 메뉴: 우클릭이나 메뉴 키(Shift+F10)로 연다. 지금은 고정과 풀기 하나.
 * onContextMenu 를 줄에 걸고, menu 를 줄 안에 그린다
 */
export function usePinMenu(kind: PinKind, id: number, title: string, pinned: boolean) {
  const [at, setAt] = useState<{ x: number; y: number }>();
  const ref = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const close = (back = false) => {
    setAt(undefined);
    // 키보드로 열었으면 연 자리로 돌아간다
    if (back) opener.current?.focus();
  };
  useEffect(() => {
    if (!at) return;
    ref.current?.querySelector('button')?.focus();
    const away = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) setAt(undefined);
    };
    const shut = () => setAt(undefined);
    window.addEventListener('mousedown', away, true);
    window.addEventListener('blur', shut);
    window.addEventListener('resize', shut);
    window.addEventListener('scroll', shut, true);
    return () => {
      window.removeEventListener('mousedown', away, true);
      window.removeEventListener('blur', shut);
      window.removeEventListener('resize', shut);
      window.removeEventListener('scroll', shut, true);
    };
  }, [at]);

  const onContextMenu = (e: React.MouseEvent) => {
    // 고치는 칸(제목 고치기)에서는 글 메뉴(붙여 넣기)를 그대로 둔다
    const el = e.target as HTMLElement;
    if (el.closest('input, textarea')) return;
    e.preventDefault();
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // 키보드로 열면 마우스 자리가 없다(0, 0): 줄 왼쪽 아래에
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const keyboard = e.clientX === 0 && e.clientY === 0;
    const x = keyboard ? box.left + 12 : e.clientX;
    const y = keyboard ? box.bottom - 4 : e.clientY;
    // 창 밖으로 넘지 않게 (메뉴 폭과 높이를 넉넉히 잡는다)
    setAt({
      x: Math.max(4, Math.min(x, window.innerWidth - 168)),
      y: Math.max(4, Math.min(y, window.innerHeight - 44)),
    });
  };

  const menu = at ? (
    <div
      ref={ref}
      className="pin-menu"
      role="menu"
      aria-label={t('pin.menu', { title })}
      style={{ left: at.x, top: at.y }}
      onKeyDown={(e) => {
        if (isEsc(e)) {
          takeEsc(e);
          close(true);
        }
        if (e.key === 'Tab') close();
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          bridge.pin(kind, id, !pinned);
          close(true);
        }}
      >
        <PinIcon />
        {pinned ? t('pin.unpin') : t('pin.pin')}
      </button>
    </div>
  ) : null;

  return { onContextMenu, menu };
}
