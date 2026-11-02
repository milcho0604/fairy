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
  /** 있으면 누를 수 없는 작은 글 한 줄 (메뉴 맨 아래 풀이). 이때 label, onSelect 는 쓰지 않는다 */
  note?: string;
}

interface At {
  x: number;
  y: number;
  /** x 가 메뉴의 오른쪽 끝인가 (단추 아래에 오른쪽을 맞춰 연다) */
  right: boolean;
  /** 위로 펼칠 때 메뉴 아래 끝을 맞출 y (열어 준 단추의 위, 마우스 자리면 y 와 같다) */
  yUp: number;
}

/**
 * 메뉴 훅. items 는 그릴 때마다 새로 만들어 주면 된다(열려 있는 동안 상태가 바뀌어도 최신).
 * openAt 은 마우스 자리, openFrom 은 단추 아래. menu 를 줄 안에 그린다
 */
export function useMenu(label: string, items: () => MenuItem[]) {
  const [at, setAt] = useState<At>();
  const [pos, setPos] = useState<{ left: number; top: number; maxHeight?: number }>();
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
    // 아래 끝은 창 바닥이 아니라 바닥 단추 줄 위까지(단추를 가리지 않게)
    const footTop = document.querySelector('.panel > footer')?.getBoundingClientRect().top;
    const bottom = footTop !== undefined && at.y < footTop ? footTop : window.innerHeight;
    const below = bottom - at.y - 4;
    const above = at.yUp - 4;
    let top = at.y;
    let maxHeight: number | undefined;
    if (box.height > below) {
      if (box.height <= above) top = at.yUp - box.height;
      else {
        // 어느 쪽에도 다 안 들어간다: 큰 쪽에 붙이고 안에서 스크롤. 둘 다 80px 도 안 되면 단추를 덮더라도 80px 로 둔다
        const room = Math.max(below, above);
        maxHeight = Math.max(80, room);
        if (room < 80) top = Math.min(at.y, bottom - 4 - maxHeight);
        else if (below >= above) top = at.y;
        else top = at.yUp - maxHeight;
      }
    }
    setPos({
      left: Math.max(4, Math.min(left, window.innerWidth - box.width - 4)),
      top: Math.max(4, top),
      maxHeight,
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
    // 메뉴 안 스크롤(높이 제한으로 생긴 것)은 바깥 스크롤이 아니다
    const scrolled = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) setAt(undefined);
    };
    window.addEventListener('mousedown', away, true);
    window.addEventListener('blur', shut);
    window.addEventListener('resize', shut);
    window.addEventListener('scroll', scrolled, true);
    return () => {
      window.removeEventListener('mousedown', away, true);
      window.removeEventListener('blur', shut);
      window.removeEventListener('resize', shut);
      window.removeEventListener('scroll', scrolled, true);
    };
  }, [at]);

  const remember = () => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  };
  const openAt = (x: number, y: number) => {
    remember();
    setPos(undefined);
    setAt({ x, y, right: false, yUp: y });
  };
  const openFrom = (el: HTMLElement) => {
    remember();
    const r = el.getBoundingClientRect();
    setPos(undefined);
    setAt({ x: r.right, y: r.bottom + 2, right: true, yUp: r.top - 2 });
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
        style={{
          left: pos?.left ?? at.x,
          top: pos?.top ?? at.y,
          maxHeight: pos?.maxHeight,
          visibility: pos ? 'visible' : 'hidden',
        }}
        onKeyDown={onKeyDown}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        {list.map((item) =>
          item.note ? (
            <div key={item.key} role="none" className="menu-note">
              {item.note}
            </div>
          ) : (
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
          ),
        )}
      </div>
    </Overlay>
  ) : null;

  return { onContextMenu, openAt, openFrom, menu, open: !!at, close };
}
