// 네 발 걷기 계산 (pet3d.ts). 동물 펫이 걸을 때 몸을 앞으로 숙이고 네 다리를 대각선 쌍으로 번갈아 딛는다.
// three 없이 숫자만 다뤄 WebGL 없이 시험한다 (pet3d-gait.test.ts).
import { type Blueprint, expandMirrors, type Gait, type Part } from '../../shared/pet3d/blueprint.ts';
import { DEFAULT_BLUEPRINTS } from '../../shared/pet3d/defaults.ts';
import type { PetKind } from '../../shared/settings.ts';
import { footSlide } from './walk-pace.ts';

/** 2D 기본 펫도 네 발로 걷는지 (3D 기본 설계도의 gait 를 따른다: 토순이. 냥이, 멍멍이는 팔이 있어 두 발) */
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
 * 왼다리와 오른다리가 둘 다 앞뒤 두 무리로 나뉘면(다리 넷) 네 발, 아니면 두 발.
 * 앞발만 있는 앉은 피규어(gait 칸이 생기기 전에 만든 사진 펫 "밀크")는 몸이 두 발 모양이라 두 발로 본다.
 * 귀와 꼬리로 네 발을 짐작하면 두 발로 만든 몸이 네 발로 걸어 어색했다 (2026-10-08 사용자 보고)
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
 * 몸 앞뒤 두께 어림값: 몸 슬롯 부품들의 z 범위(가운데 ± 반지름). 돌림은 보지 않는다.
 * 설정 창처럼 three 없이 몸 모양을 볼 때 쓴다 (펫 화면은 실제 상자로 잰다)
 */
export function bodyDepthOf(parts: readonly Part[]): number {
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const p of parts) {
    if (p.slot !== 'body') continue;
    lo = Math.min(lo, p.at[2] - p.size[2]);
    hi = Math.max(hi, p.at[2] + p.size[2]);
  }
  return hi > lo ? hi - lo : 0;
}

/** 설계도가 만든 몸 모양의 걸음새 (사용자가 고른 값을 덮기 전). 자동을 고르면 이대로 걷는다 */
export function shapeOf(bp: Pick<Blueprint, 'gait' | 'parts'>): Gait {
  const parts = expandMirrors(bp.parts);
  return gaitOf(bp, parts, bodyDepthOf(parts));
}

/** 사용자가 고른 걸음새를 설계도에 덮는다. 고른 값이 설계도 gait 보다 먼저다. 안 골랐거나 같으면 그대로 (새로 조립하지 않게) */
export function withGait<T extends Pick<Blueprint, 'gait'>>(bp: T, pick: Gait | undefined): T {
  return !pick || bp.gait === pick ? bp : { ...bp, gait: pick };
}

/** 고른 걸음새가 몸 모양과 다른지 (설정 창이 "이 걸음새에 맞게 다시 만들기"를 권한다). 자동은 늘 같다 */
export function gaitMismatch(pick: Gait | undefined, shape: Gait): boolean {
  return !!pick && pick !== shape;
}

/** 2D 기본 펫이 네 발로 걷는지: 고른 값이 있으면 그것, 없으면 기본 설계도(토순이) */
export function quadKind(kind: PetKind | undefined, pick: Gait | undefined): boolean {
  return pick ? pick === 'quadruped' : isQuadKind(kind);
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
 * 처음과 끝에 0 이 된다 (멈춘 몸에서 다리만 헛도는 미끄러짐이 없다). 돌기(turn)와 숙이기(lean)도 처음 TURN_MS,
 * LEAN_MS 동안 들어가고 끝나기 전 같은 시간 동안 풀린다.
 * 모두 시간으로 잰다: since 는 걷기를 시작하고 지난 시간, left 는 지금 토막이 끝날 때까지 남은 시간, segMs 는
 * 지금 토막 길이 (ms). 이어 받은 걷기(따라 달리기)는 처음 출발에서 올라가고 지금 토막 끝을 보고 내려간다.
 * 예전엔 이어 붙인 전체 길이에 대한 비율로 재서 오래 따라 달릴수록 보폭이 줄었다.
 * 모르면(옛 상태) 모두 1
 */
export function walkEnvelope(
  since: number | undefined,
  left: number | undefined,
  segMs: number | undefined,
): { stride: number; turn: number; lean: number } {
  if (since === undefined || left === undefined || segMs === undefined || !(segMs > 0))
    return { stride: 1, turn: 1, lean: 1 };
  const edge = Math.max(0, Math.min(since, left));
  // 보폭은 토막의 1/4 동안 오른다 (한 토막 걷기의 느린 곡선 빠르기와 맞다).
  // 짧은 걷기(1초 안팎)도 다 돌고 숙이게 시간은 걷기 길이의 절반을 넘지 않는다
  const turnMs = Math.min(TURN_MS, segMs * 0.3);
  const leanMs = Math.min(LEAN_MS, segMs * 0.4);
  return { stride: smooth(0, segMs / 4, edge), turn: smooth(0, turnMs, edge), lean: smooth(0, leanMs, edge) };
}

/** 그리기 상태의 걷기에서 세기를 얻는다 */
export function walkEnvelopeOf(w: { since?: number; left?: number; segMs?: number }): {
  stride: number;
  turn: number;
  lean: number;
} {
  return walkEnvelope(w.since, w.left, w.segMs);
}

export type LegId = 'fl' | 'fr' | 'hl' | 'hr';

/**
 * 대각선 쌍 걸음(속보, trot): 왼앞발과 오른뒷발이 한 쌍, 오른앞발과 왼뒷발이 반대 쌍.
 * 한 걸음(phase 0~1)에 두 쌍이 한 번씩 든다. 든 발은 앞으로 나가고(dz 가 커진다) 디딘 발은 뒤로 민다.
 * 디딘 발은 같은 빠르기로 민다 (2D 발 walk-pace.ts footSlide 와 같은 모양): 예전엔 사인 곡선이라 몸은 고르게 가는데 디딘 발은
 * 빨랐다 느렸다 해서 바닥에서 앞뒤로 미끄러졌다.
 * dz 는 -1~1(보폭 단위), lift 는 0~1(들어 올린 높이 단위)
 */
export function trotLeg(leg: LegId, phase: number): { dz: number; lift: number } {
  const pairA = leg === 'fl' || leg === 'hr';
  // 왼앞발 쌍은 phase 0 에 가장 높이 든다
  const swingAt = pairA ? 0.75 : 0.25;
  const p = (((phase - swingAt) % 1) + 1) % 1;
  return { dz: footSlide(phase, swingAt) * 4, lift: p < 0.5 ? Math.sin(Math.PI * (p / 0.5)) : 0 };
}

/**
 * 몸을 lean(라디안)만큼 앞으로 숙였을 때(몸 관절 기준 x 축 돌림) 다리 관절 높이가 바뀌는 양.
 * y 는 몸 관절에서 위로, z 는 앞으로. 앞발 관절은 내려가고(음수) 뒷발 관절은 올라간다
 */
export function hipRise(y: number, z: number, lean: number): number {
  return y * Math.cos(lean) - z * Math.sin(lean) - y;
}

/** 두 발 다리를 관절에서 돌리는 가장 큰 각 (라디안). 그 넘게 나가야 하는 발은 다리째 앞뒤로 옮긴다 */
export const BIPED_SWING_MAX = 0.6;

/**
 * 다리를 관절에서 돌려 딛는 정도 0~1 (나머지는 다리째 옮긴다). 관절에서 발바닥까지(leg)가 짧은 몸은 다리가 곧 발 한 덩이라
 * 관절(발 위쪽)에서 돌리면 발이 앞뒤로 가지 않고 기울기만 해서 몸만 미끄러졌다 (콩이, 큰 머리 꼬마 피규어).
 * 네 발 걷기(walkQuad)의 긴 다리 기준(0.18)과 맞춘다
 */
export function swingShare(leg: number): number {
  return smooth(0.12, 0.22, leg);
}

/**
 * 두 발로 선 입체 몸(앉은 피규어, 말로 만든 캐릭터)의 발 하나. 예전엔 다리 길이와 상관없이 관절에서 ±0.7 라디안 돌려,
 * 짧은 다리는 발이 거의 안 움직여 몸만 미끄러지고 긴 다리는 몸보다 빨리 헛디뎠다.
 * 이제 2D 발(walk-pace.ts footSlide)처럼 디딘 발은 몸이 간 만큼 뒤로 밀리고 든 발은 앞으로 나간다. 그 거리를 다리 길이에 맞춰
 * 관절 돌리기(angle)와 다리째 옮기기(shift)로 나누고, 돌려서 들린 만큼 내려(rise 음수) 디딘 발바닥이 바닥에 붙어 있게 한다.
 * 다리째 옮기는 발은 드는 동안 발끝을 살짝 든다(pitch, 라디안. 발 위 관절에서 발끝이 올라가는 쪽이 +).
 * stridePx 는 한 걸음 길이(160 캔버스 px), pxPerUnit 은 몸 앞쪽으로 1 단위가 화면 가로로 보이는 길이(px),
 * leg 는 관절에서 발바닥까지 높이(몸 단위), go 는 걷기 세기 0~1. 앞이 +
 */
export function bipedFoot(
  phase: number,
  swingAt: number,
  stridePx: number,
  pxPerUnit: number,
  leg: number,
  go: number,
): { angle: number; shift: number; rise: number; pitch: number } {
  if (!(go > 0) || !(stridePx > 0) || !(pxPerUnit > 0) || !(leg > 0))
    return { angle: 0, shift: 0, rise: 0, pitch: 0 };
  const dz = (footSlide(phase, swingAt) * stridePx * go) / pxPerUnit;
  const share = swingShare(leg);
  const lim = Math.sin(BIPED_SWING_MAX);
  const s = Math.max(-lim, Math.min(lim, (dz * share) / leg));
  const angle = Math.asin(s);
  // 든 발: 걸음의 앞 반 동안 둥글게 든다. 다리 길이의 30% (짧은 다리도 조금은 들어 보이게, 긴 다리도 너무 높지 않게)
  const p = (((phase - swingAt) % 1) + 1) % 1;
  const up = p < 0.5 ? Math.sin(Math.PI * (p / 0.5)) : 0;
  const lift = Math.min(0.05, Math.max(0.015, leg * 0.3)) * up * go;
  return {
    angle,
    shift: dz - leg * s,
    rise: lift - leg * (1 - Math.cos(angle)),
    pitch: 0.3 * up * go * (1 - share),
  };
}
