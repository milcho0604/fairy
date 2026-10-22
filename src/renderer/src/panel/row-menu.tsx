// 줄 메뉴 (#146): 할 일 줄의 "..." 단추, 우클릭, 메뉴 키가 같이 쓰는 작은 메뉴와 마감 고르기 메뉴.
// 단추 6개를 줄 위에 겹쳐 띄우던 것을 메뉴 하나로 모았다. 화살표로 고르고 Enter 로 누르고 Esc 로 닫으면 연 자리로 돌아간다.
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { isEsc, takeEsc } from './keys.ts';
import { Overlay } from './surface.tsx';

export interface MenuItem {
  key: string;
  label: string;
  /** 오른쪽 작은 글 (날짜, 눌렀을 때 일어날 일) */
  hint?: string;
  icon?: ReactNode;
  /** 지금 고른 것 (마감 메뉴에서 지금 마감) */
  checked?: boolean;
  danger?: boolean;
  disabled?: boolean;
  /** 이 항목 위에 가는 선 */
  sepBefore?: boolean;
  onSelect: () => void;
}

interface At {
  x: number;
  y: number;
  /** x 가 메뉴의 오른쪽 끝인가 (단추 아래에 오른쪽을 맞춰 연다) */
  right: boolean;
}

/**
 * 메뉴 훅. items 는 그릴 때마다 새로 만들어 주면 된다(열려 있는 동안 상태가 바뀌어도 최신).
 * openAt 은 마우스 자리, openFrom 은 단추 아래. menu 를 줄 안에 그린다
 */
export function useMenu(label: string, items: () => MenuItem[]) {
  const [at, setAt] = useState<At>();
  const [pos, setPos] = useState<{ left: number; top: number }>();
  const ref = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const close = (back = false) => {
    setAt(undefined);
    setPos(undefined);
    // 키보드로 열었으면 연 자리로 돌아간다
    if (back) opener.current?.focus();
  };

  // 창 밖으로 넘지 않게 재서 자리를 잡는다
  useLayoutEffect(() => {
    if (!at || !ref.current) return;
    const box = ref.current.getBoundingClientRect();
    const left = at.right ? at.x - box.width : at.x;
    setPos({
      left: Math.max(4, Math.min(left, window.innerWidth - box.width - 4)),
      top: Math.max(4, Math.min(at.y, window.innerHeight - box.height - 4)),
    });
  }, [at]);

  // 자리가 잡혀 보이게 된 뒤에 첫 항목으로 (숨겨진 동안에는 초점이 가지 않는다)
  useEffect(() => {
    if (pos) ref.current?.querySelector<HTMLElement>('button:not([disabled])')?.focus();
  }, [pos]);

  useEffect(() => {
    if (!at) return;
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

  const remember = () => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  };
  const openAt = (x: number, y: number) => {
    remember();
    setPos(undefined);
    setAt({ x, y, right: false });
  };
  const openFrom = (el: HTMLElement) => {
    remember();
    const r = el.getBoundingClientRect();
    setPos(undefined);
    setAt({ x: r.right, y: r.bottom + 2, right: true });
  };
  /** 우클릭이나 메뉴 키. 고치는 칸 위에서는 글 메뉴(붙여 넣기)를 그대로 둔다 */
  const onContextMenu = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('input, textarea')) return;
    e.preventDefault();
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    // 키보드로 열면 마우스 자리가 없다(0, 0): 줄 왼쪽 아래에
    const keyboard = e.clientX === 0 && e.clientY === 0;
    openAt(keyboard ? box.left + 12 : e.clientX, keyboard ? box.bottom - 4 : e.clientY);
  };

  const list = at ? items() : [];
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (isEsc(e)) {
      takeEsc(e);
      close(true);
      return;
    }
    if (e.key === 'Tab') {
      close();
      return;
    }
    const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? [])];
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const to =
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? buttons.length - 1
          : (i + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[to]?.focus();
  };

  const menu = at ? (
    <Overlay>
      <div
        ref={ref}
        className="pin-menu row-menu"
        role="menu"
        aria-label={label}
        style={{ left: pos?.left ?? at.x, top: pos?.top ?? at.y, visibility: pos ? 'visible' : 'hidden' }}
        onKeyDown={onKeyDown}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        {list.map((item) => (
          <div key={item.key} role="none" className={item.sepBefore ? 'menu-sep' : undefined}>
            <button
              type="button"
              role={item.checked === undefined ? 'menuitem' : 'menuitemradio'}
              {...(item.checked === undefined ? {} : { 'aria-checked': item.checked })}
              className={item.danger ? 'danger' : undefined}
              disabled={item.disabled}
              onClick={() => {
                close(true);
                item.onSelect();
              }}
            >
              <span className="menu-icon" aria-hidden="true">
                {item.checked ? '✓' : item.icon}
              </span>
              <span className="menu-label">{item.label}</span>
              {item.hint && <small>{item.hint}</small>}
            </button>
          </div>
        ))}
      </div>
    </Overlay>
  ) : null;

  return { onContextMenu, openAt, openFrom, menu, open: !!at, close };
}
