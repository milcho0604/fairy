// 키보드로 펫 다루기 (접근성). 펫 고르기 단축키로 펫에 포커스가 오면 펫 화면이 키를 이 명령으로 바꿔 메인에 보낸다.
// Enter, Space: 패널 (펫 누르기와 같다) / Shift+F10, 메뉴 키: 우클릭 메뉴 / ←→: 그쪽으로 걷기 /
// Shift+화살표, ↑↓: 조금 옮기기 / Esc: 나가기

export const PET_KEYS = [
  'open',
  'menu',
  'left',
  'right',
  'nudgeLeft',
  'nudgeRight',
  'nudgeUp',
  'nudgeDown',
  'leave',
] as const;
export type PetKey = (typeof PET_KEYS)[number];
export const isPetKey = (v: unknown): v is PetKey => PET_KEYS.includes(v as PetKey);

/** ←→ 한 번에 걷는 거리 (펫 너비 배수) */
export const KEY_WALK = 0.6;
/** 조금 옮기기 (px) */
export const KEY_NUDGE = 12;

export interface PetKeyPress {
  key: string;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

/** 키 하나를 명령으로. 모르는 키나 다른 조합(Cmd+화살표 등)은 undefined (운영체제, 화면 읽기 프로그램 몫으로 둔다) */
export function petKeyOf(e: PetKeyPress): PetKey | undefined {
  if (e.altKey || e.ctrlKey || e.metaKey) return undefined;
  if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) return 'menu';
  if (e.shiftKey) {
    if (e.key === 'ArrowLeft') return 'nudgeLeft';
    if (e.key === 'ArrowRight') return 'nudgeRight';
    if (e.key === 'ArrowUp') return 'nudgeUp';
    if (e.key === 'ArrowDown') return 'nudgeDown';
    return undefined;
  }
  switch (e.key) {
    case 'Enter':
    case ' ':
      return 'open';
    case 'ArrowLeft':
      return 'left';
    case 'ArrowRight':
      return 'right';
    case 'ArrowUp':
      return 'nudgeUp';
    case 'ArrowDown':
      return 'nudgeDown';
    case 'Escape':
      return 'leave';
    default:
      return undefined;
  }
}
