// 공 물어 오기 (공놀이, main play.ts). 네 발로 걷는 펫은 공을 입에 물고 돌아온다.
// 무는 동안 공은 따로 띄운 공 창이 아니라 펫 화면이 입 자리에 같이 그린다 (renderer draw.ts):
// 걸음마다 흔들리는 입을 그대로 따라가고, 늘 얼굴 앞에 보인다. 숫자만 다뤄 시험한다 (fetch.test.ts).
import type { Point, Rect } from './geometry.ts';

/** 장난감 공 (상점 공, 털실) */
export type CarryToy = 'ball' | 'yarn';

/** 공 지름 (화면 px) */
export const BALL = 30;

export const BALL_SVG = (yarn: boolean) =>
  yarn
    ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 30"><circle cx="15" cy="15" r="13" fill="#e87a90" stroke="#b9506a" stroke-width="2"/><path d="M5 11c7 3 14 3 20 0M4 17c7 4 15 4 22 0M10 4c4 7 4 15 0 22M19 4c-3 8-3 15 1 22" fill="none" stroke="#b9506a" stroke-width="1.6"/><path d="M26 22c3 2 3 5 1 7" fill="none" stroke="#e87a90" stroke-width="2"/></svg>`
    : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 30"><circle cx="15" cy="15" r="13" fill="#ffd166" stroke="#c99a2e" stroke-width="2"/><path d="M3 13c8 4 16 4 24 0" fill="none" stroke="#ef476f" stroke-width="3"/></svg>`;

/** 고개를 숙여 공을 물고 다시 드는 시간 */
export const PICK_MS = 900;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (x: number) => {
  const k = clamp01(x);
  return k * k * (3 - 2 * k);
};

/**
 * 물기 진행 t(0~1) 자세. dip 은 고개 숙인 정도 0~1 (가운데쯤 가장 낮다),
 * grab 은 공이 바닥 자리에서 입으로 옮겨 간 정도 0~1 (가장 낮을 때 물어서 같이 올라온다)
 */
export function pickPose(t: number): { dip: number; grab: number } {
  const k = clamp01(t);
  const dip = k < 0.4 ? smooth(k / 0.4) : k < 0.55 ? 1 : smooth((1 - k) / 0.45);
  return { dip, grab: smooth((k - 0.38) / 0.22) };
}

/** 문 공 가운데: 입 자리에서 반지름의 0.35 만큼 아래 (공 윗부분을 문다) */
export function heldAt(mouth: Point, r: number): Point {
  return { x: mouth.x, y: mouth.y + r * 0.35 };
}

/** 화면 좌표 → 펫 사각형 안 비율 (0~1, 밖이면 넘는다) */
export function toBox(p: Point, box: Rect): Point {
  return { x: (p.x - box.x) / box.width, y: (p.y - box.y) / box.height };
}

/** 펫 사각형 안 비율 → 화면 좌표 */
export function fromBox(p: Point, box: Rect): Point {
  return { x: box.x + p.x * box.width, y: box.y + p.y * box.height };
}

/**
 * 공 가운데가 펫 그림 안(조금 바깥까지)에 있어 입으로 옮겨 그릴 수 있는지. 펫이 창 위에 앉아 있어
 * 공이 저 아래 바닥에 있으면 못 문다 (그때는 두 발 펫처럼 공 창이 따라온다)
 */
export function canPick(ball: Point, box: Rect): boolean {
  const p = toBox(ball, box);
  return p.x >= -0.1 && p.x <= 1.1 && p.y >= 0 && p.y <= 1.05;
}

/** 입에서 떨어뜨리는 공의 처음 속도: 살짝 위로 떴다가 떨어져 통 튀고, 걸어온 쪽(dir)으로 조금 굴러 나간다 */
export function dropVelocity(dir: -1 | 1): { vx: number; vy: number } {
  return { vx: dir * 70, vy: -90 };
}
