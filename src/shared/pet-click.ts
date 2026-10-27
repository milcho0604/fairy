/** 펫을 한 번 또는 두 번 눌렀을 때 실행할 동작. */
export const PET_CLICK_ACTIONS = ['panel', 'chat', 'hide', 'none'] as const;
export type PetClickAction = (typeof PET_CLICK_ACTIONS)[number];

export function isPetClickAction(value: unknown): value is PetClickAction {
  return typeof value === 'string' && (PET_CLICK_ACTIONS as readonly string[]).includes(value);
}
