// 네 발 걷기 계산 (pet3d.ts). 동물 펫이 걸을 때 몸을 앞으로 숙이고 네 다리를 대각선 쌍으로 번갈아 딛는다.
// three 없이 숫자만 다뤄 WebGL 없이 시험한다 (pet3d-gait.test.ts).
import type { Blueprint, Gait, Part } from '../../shared/pet3d/blueprint.ts';
import { DEFAULT_BLUEPRINTS } from '../../shared/pet3d/defaults.ts';
import type { PetKind } from '../../shared/settings.ts';

/** 2D 기본 펫도 네 발로 걷는지 (3D 기본 설계도의 gait 를 따른다: 냥이, 멍멍이, 토순이) */
export function isQuadKind(kind: PetKind | undefined): boolean {
  return !!kind && DEFAULT_BLUEPRINTS[kind]?.gait === 'quadruped';
}

/**
 * 한쪽 다리 부품들의 앞뒤 자리(z)를 앞발 무리와 뒷발 무리로 나누는 경계.
 * 가장 크게 벌어진 틈이 minGap 이상일 때만 나눈다 (발가락, 발바닥 무늬처럼 붙은 부품은 한 무리).
 * 나눌 수 없으면 undefined (다리가 한 무리뿐)
 */
export function legCut(zs: readonly number[], minGap: number): number | undefined {
  const s = [...zs].sort((a, b) => a - b);
  let best = 0;
  let at: number | undefined;
  for (let i = 1; i < s.length; i++) {
    const gap = (s[i] as number) - (s[i - 1] as number);
    if (gap > best) {
      best = gap;
      at = ((s[i] as number) + (s[i - 1] as number)) / 2;
    }
  }
  return best >= minGap ? at : undefined;
}

/** 다리 무리를 나눌 최소 틈: 몸 앞뒤 두께의 30% (최소 0.12) */
export function legGap(bodyDepth: number): number {
  return Math.max(0.12, bodyDepth * 0.3);
}

/**
 * 걸음새. 설계도에 적혀 있으면 그대로, 없으면(이전에 만든 펫) 다리 모양으로 짐작한다:
 * 왼다리와 오른다리가 둘 다 앞뒤 두 무리로 나뉘면(다리 넷) 네 발, 아니면 두 발
 */
export function gaitOf(bp: Pick<Blueprint, 'gait'>, parts: readonly Part[], bodyDepth: number): Gait {
  if (bp.gait) return bp.gait;
  const gap = legGap(bodyDepth);
  const split = (slot: Part['slot']) => {
    const zs = parts.filter((p) => p.slot === slot).map((p) => p.at[2]);
    return legCut(zs, gap) !== undefined;
  };
  return split('legL') && split('legR') ? 'quadruped' : 'biped';
}

/**
 * 앞발만 있는 네 발 펫(기본 냥이처럼 앉은 피규어)의 뒷발 자리: 몸 가운데(cz)를 기준으로 앞발을 뒤로 뒤집고
 * 조금 안쪽으로 당기고(0.85), 엉덩이가 넓게 조금 바깥으로(1.1)
 */
export function hindFrom(x: number, z: number, cz: number): { x: number; z: number } {
  return { x: x * 1.1, z: cz - (z - cz) * 0.85 };
}

const smooth = (a: number, b: number, x: number) => {
  const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
};

/** 돌아서는 시간: 출발할 때 옆으로 돌고, 멈출 때 다시 앞(보는 사람)을 본다 */
export const TURN_MS = 320;
/** 네 발로 숙이는 시간과 다시 일어나는 시간 */
export const LEAN_MS = 420;

/**
 * 걷기 진행에 따른 세기 0~1. 창은 처음과 끝이 느린 곡선(walkOffset)으로 움직이니 보폭(stride)도 빠르기를 따라
 * 처음과 끝에 0 이 된다 (멈춘 몸에서 다리만 헛도는 미끄러짐이 없다). 돌기(turn)와 숙이기(lean)는 시간으로:
 * 처음 TURN_MS, LEAN_MS 동안 들어가고 끝나기 전 같은 시간 동안 풀린다.
 * t, ms 를 모르면(옛 상태) 모두 1
 */
export function walkEnvelope(
  t: number | undefined,
  ms: number | undefined,
): { stride: number; turn: number; lean: number } {
  if (t === undefined || ms === undefined || !(ms > 0)) return { stride: 1, turn: 1, lean: 1 };
  const k = Math.min(1, Math.max(0, t));
  const v = k < 0.5 ? 2 * k : 2 * (1 - k);
  const edge = Math.min(k, 1 - k) * ms;
  // 짧은 걷기(1초 안팎)도 다 돌고 숙이게 시간은 걷기 길이의 절반을 넘지 않는다
  const turnMs = Math.min(TURN_MS, ms * 0.3);
  const leanMs = Math.min(LEAN_MS, ms * 0.4);
  return { stride: smooth(0, 0.5, v), turn: smooth(0, turnMs, edge), lean: smooth(0, leanMs, edge) };
}

export type LegId = 'fl' | 'fr' | 'hl' | 'hr';

/**
 * 대각선 쌍 걸음(속보, trot): 왼앞발과 오른뒷발이 한 쌍, 오른앞발과 왼뒷발이 반대 쌍.
 * 한 걸음(phase 0~1)에 두 쌍이 한 번씩 든다. 든 발은 앞으로 나가고(dz 가 커진다) 디딘 발은 뒤로 민다.
 * dz 는 -1~1(보폭 단위), lift 는 0~1(들어 올린 높이 단위)
 */
export function trotLeg(leg: LegId, phase: number): { dz: number; lift: number } {
  const pairA = leg === 'fl' || leg === 'hr';
  const a = phase * Math.PI * 2 + (pairA ? 0 : Math.PI);
  return { dz: Math.sin(a), lift: Math.max(0, Math.cos(a)) };
}

/**
 * 몸을 lean(라디안)만큼 앞으로 숙였을 때(몸 관절 기준 x 축 돌림) 다리 관절 높이가 바뀌는 양.
 * y 는 몸 관절에서 위로, z 는 앞으로. 앞발 관절은 내려가고(음수) 뒷발 관절은 올라간다
 */
export function hipRise(y: number, z: number, lean: number): number {
  return y * Math.cos(lean) - z * Math.sin(lean) - y;
}
