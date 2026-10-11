// 집 숨기기 (2026-10-12): 사용자가 화면의 집을 숨겨 둔다. 자리, 단계, 모양은 그대로 두고 창만 감춘다.
// 숨긴 동안은 집이 없는 것처럼 군다(집에서 쉬기, 집 보러 가기, 자리 비우면 집 앞에서 졸기를 하지 않는다).
// 여기는 판단만 (화면 없이 시험한다). 창은 main/play.ts, 묶는 곳은 main/index.ts
import type { RestPhase } from './house-rest.ts';

/** 집 창을 감추는 까닭. stowed 사용자가 숨겼다(설정 houseHidden, 저장한다), pet 펫이 숨거나 발표 중이라 같이 숨었다 */
export type HouseHideReason = 'stowed' | 'pet';

/** 감출 까닭이 하나도 없을 때만 보인다 */
export function houseVisible(reasons: ReadonlySet<HouseHideReason>): boolean {
  return reasons.size === 0;
}

/**
 * 숨기기 전에 펫을 어떻게 할지. 집이 먼저 사라지면 안에서 자던 펫이 갇히거나 문간 그림이 허공에 남는다.
 * 밖이고 문을 드나드는 중이 아니면 바로(now), 집으로 가는 중이거나 집 안이면 먼저 부르고(call),
 * 나오는 중이거나 문을 드나드는 중이면 다 끝나기를 기다린다(wait)
 */
export function stowStep(phase: RestPhase, doorBusy: boolean): 'now' | 'call' | 'wait' {
  if (phase === 'going' || phase === 'inside') return 'call';
  if (phase === 'leaving' || doorBusy) return 'wait';
  return 'now';
}

/** 펫 우클릭 메뉴의 집 항목 글. 집을 아직 안 샀으면 항목이 없다 */
export function houseMenuKey(
  level: number,
  stowed: boolean,
): 'pet.menu.houseHide' | 'pet.menu.houseShow' | undefined {
  if (level <= 0) return undefined;
  return stowed ? 'pet.menu.houseShow' : 'pet.menu.houseHide';
}

/** 집을 숨기거나 꺼낸 뒤 펫이 하는 말 */
export function stowSayKey(stowed: boolean): 'pet.home.stowed' | 'pet.home.unstowed' {
  return stowed ? 'pet.home.stowed' : 'pet.home.unstowed';
}

/**
 * 집이 바뀐(새 단계, 새 모양) 뒤 하는 말. 숨겨 둔 동안이면 "끌어서 옮길 수 있어" 대신 꺼내야 보인다고 한다.
 * 숨긴 채로 두고 저절로 꺼내지 않는다 (사용자가 숨긴 것을 앱이 되돌리지 않는다)
 */
export function houseNewsKey(
  what: 'level' | 'style',
  stowed: boolean,
): 'pet.newHouse' | 'pet.houseStyle' | 'pet.home.newStowed' | 'pet.home.styleStowed' {
  if (what === 'level') return stowed ? 'pet.home.newStowed' : 'pet.newHouse';
  return stowed ? 'pet.home.styleStowed' : 'pet.houseStyle';
}
