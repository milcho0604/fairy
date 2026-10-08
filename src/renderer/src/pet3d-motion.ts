// 입체 펫 설계도의 표정과 몸짓 칸(face.eyes, motion)을 자세에 반영하는 계산 (pet3d.ts). WebGL 없이 시험한다.
import type { EyeLook } from '../../shared/pet3d/blueprint.ts';
import type { DrawState } from './draw.ts';

/** drowsy 는 쉬는 졸린 눈(얕은 ‿). half 는 꾸벅 조는 상태 눈 */
export type EyeState = 'open' | 'down' | 'up' | 'chevron' | 'half' | 'drowsy';

/** 보일 눈: 뜬 눈 자리에만 쉬는 눈 모양을 쓴다. 신남(up), 잠(down) 같은 상태 표정은 그대로 */
export function restingEye(eye: EyeState, look: EyeLook | undefined): EyeState {
  if (eye !== 'open') return eye;
  return look === 'happy' ? 'up' : look === 'sleepy' ? 'drowsy' : 'open';
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
