// 입체 펫 설계도의 표정과 몸짓 칸(face.eyes, motion)을 자세에 반영하는 계산 (pet3d.ts). WebGL 없이 시험한다.
import type { EnergyStage } from '../../shared/energy.ts';
import type { EyeLook } from '../../shared/pet3d/blueprint.ts';
import type { DrawState } from './draw.ts';

/** drowsy 는 쉬는 졸린 눈(얕은 ‿, 기운 졸림도). half 는 꾸벅 조는 상태 눈. heavy 는 눈꺼풀이 살짝 내려온 지친 눈 */
export type EyeState = 'open' | 'down' | 'up' | 'chevron' | 'half' | 'drowsy' | 'heavy';

/**
 * 보일 눈: 뜬 눈 자리에만 쉬는 눈 모양을 쓴다. 신남(up), 잠(down) 같은 상태 표정은 그대로.
 * 설계도가 정한 눈(웃는 눈, 졸린 눈)은 그 펫의 생김새라 기운보다 먼저다. 둥근 눈만 기운대로 (지침 heavy, 졸림 drowsy).
 * 졸림을 반쯤 감은 눈(half)으로 하면 평평한 눈꺼풀이 시큰둥한 눈으로 읽혀서 감기 직전의 ‿ 로
 */
export function restingEye(eye: EyeState, look: EyeLook | undefined, energy?: EnergyStage): EyeState {
  if (eye !== 'open') return eye;
  if (look === 'happy') return 'up';
  if (look === 'sleepy') return 'drowsy';
  return energy === 'tired' ? 'heavy' : energy === 'sleepy' ? 'drowsy' : 'open';
}

/**
 * 통통 튀는 세기(motion.bounce)를 신남과 걷기에만 곱한다: 뛰는 높이, 걸음 들썩임, 착지 찌그러짐(1 넘게 키우지는 않는다).
 * 잡혀 있을 때 올린 몸(6)은 발이 잘리지 않게 둔 것이고 앉기 찌그러짐은 자세라 그대로
 */
export function bounced(
  s: Pick<DrawState, 'mood'>,
  act: DrawState['activity'],
  bounce: number,
  lift: number,
  sx: number,
  sy: number,
): { lift: number; sx: number; sy: number } {
  const k = s.mood === 'excited' || act?.type === 'walk' ? bounce : 1;
  const squash = Math.min(1, k);
  return { lift: lift * k, sx: 1 + (sx - 1) * squash, sy: 1 + (sy - 1) * squash };
}

/**
 * 얼굴 부품의 두께 배율 (z). 겉면에 칠한 것처럼 비스듬히 보일수록 겉면 쪽으로 납작하게 한다: 도톰한 눈알이 그대로면
 * 3/4 와 옆에서 머리 가장자리에 붙은 먼 눈과 입이 실루엣 밖으로 삐져나왔다. facing 은 부품 겉면이 카메라를 향한 정도
 * (1 정면, 0 옆). 0.75 넘게는 그대로, 0.25 아래는 0.2 까지. keep 이면 제 두께 그대로
 */
export function faceDepth(facing: number, keep: boolean): number {
  if (keep) return 1;
  const k = Math.min(1, Math.max(0, (facing - 0.25) / 0.5));
  return 0.2 + 0.8 * k * k * (3 - 2 * k);
}

/**
 * 납작하게 하지 않고 제 두께를 지킬 얼굴 부품: 솟은 것(코, 부리, 볼 털 뭉치)과 네 발로 선 몸의 얼굴 전부.
 * 볼 털은 일부러 실루엣 밖으로 뻗게 붙인 것이다. 네 발로 선 몸(실사 냥이, 멍멍이, 햄찌, 곰돌이와 네 발로 세운 사진 펫)은
 * 2026-10-13 전후 비교에서 입을 납작하게 하면 3/4 에서 입 끝이 주둥이 아래로 삐져나왔고(실사 멍멍이), 복슬복슬 햄찌는
 * 털 결이 통째로 달라져서 그 몸의 얼굴은 예전대로 둔다
 */
export function keepsFaceDepth(o: { nose: boolean; beak: boolean; tuft: boolean; stance: boolean }): boolean {
  return o.nose || o.beak || o.tuft || o.stance;
}
