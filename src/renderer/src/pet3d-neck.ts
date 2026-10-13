// 머리와 몸 잇기 (말로 만들기 다듬기 2026-10-12). 큰 공 머리를 작은 공 몸 위에 겹쳐 놓으면 두 겉면이 만나는 자리에 골이 파여
// 목 주름 선이 보였다 (찹쌀떡 같은 한 덩어리 캐릭터가 머리, 몸 두 공으로 갈라져 보였다). 골 가까이 두 공의 겉면 정점을
// 가로 단면 반지름의 부드러운 최댓값(smooth max)까지 밀어내 골을 둥글게 메운다. (따로 띠를 덧대면 띠가 겉면을 뚫고 나오는
// 자리에 톱니 선이 생겼다.) three 없이 숫자만 다룬다 (pet3d.ts 가 공 모양 정점을 넘긴다)
import type { Part } from '../../shared/pet3d/blueprint.ts';

/** 골을 메우는 둥글기: 몸 가로 반지름의 배 */
const BLEND = 0.3;
/** 같은 색으로 볼 만큼 (채널 차, 0~1) */
const SAME_COLOR = 0.08;

function rgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** 두 색이 거의 같은지 */
export function sameColor(a: string, b: string): boolean {
  const x = rgb(a);
  const y = rgb(b);
  return x.every((v, i) => Math.abs(v - (y[i] ?? 0)) <= SAME_COLOR);
}

/** 머리 아래쪽 색: 아래를 덮는 두 색 나누기면 그 색, 아니면 머리 색 */
function headBottomColor(head: Part): string {
  const pat = head.pattern;
  return pat?.type === 'split' && pat.side === 'bottom' ? pat.color : head.color;
}

/**
 * 이을 머리와 몸. 둘 다 돌리지 않은 공이고, 머리가 몸 위에 겹쳐 얹혀 있고(가운데가 거의 같은 세로줄), 맞닿는 색이 같을 때만.
 * 무늬 있는 몸, 다른 색 옷처럼 갈라진 것이 맞는 경우는 그대로 둔다
 */
export function neckPair(parts: readonly Part[]): { head: Part; body: Part } | undefined {
  const biggest = (slot: Part['slot']) =>
    parts
      .filter((p) => p.slot === slot && p.shape === 'sphere' && !p.wear && !p.mirror)
      .sort((a, b) => b.size[0] * b.size[1] * b.size[2] - a.size[0] * a.size[1] * a.size[2])[0];
  const head = biggest('head');
  const body = biggest('body');
  if (!head || !body) return undefined;
  const flat = (p: Part) => !p.rot || p.rot.every((v) => Math.abs(v) < 1);
  if (!flat(head) || !flat(body) || body.pattern) return undefined;
  if (body.finish === 'shiny' || head.finish === 'shiny') return undefined;
  const [hx, hy, hz] = head.at;
  const [bx, by, bz] = body.at;
  const [, hry] = head.size;
  const [brx, bry, brz] = body.size;
  // 머리가 몸 바로 위 (앞으로 내민 머리, 옆으로 비킨 머리는 아니다)
  if (Math.abs(hx - bx) > 0.02 || Math.abs(hz - bz) > Math.min(brx, brz) * 0.25) return undefined;
  if (hy - by < bry * 0.3) return undefined;
  // 겹쳐 있어야 골이 있다
  if (hy - hry >= by + bry) return undefined;
  if (!sameColor(headBottomColor(head), body.color)) return undefined;
  return { head, body };
}

/** 타원체까지의 거리 (근사. 겉면 가까이에서는 거의 맞다) */
function ellipsoid(p: Part, x: number, y: number, z: number): number {
  const [cx, cy, cz] = p.at;
  const [a, b, c] = p.size;
  const qx = x - cx;
  const qy = y - cy;
  const qz = z - cz;
  const k0 = Math.hypot(qx / a, qy / b, qz / c);
  const k1 = Math.hypot(qx / (a * a), qy / (b * b), qz / (c * c));
  return k1 < 1e-9 ? -Math.min(a, b, c) : (k0 * (k0 - 1)) / k1;
}

/** 부드러운 최솟값 (다항식). 두 거리가 k 안으로 가까우면 둥글게 메운다 */
export function smin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

/** 이음 둥글기 (세상 단위): 몸 가로 반지름의 BLEND 배 */
export function filletK(body: Part): number {
  return BLEND * Math.min(body.size[0], body.size[2]);
}

/**
 * 한 공(self)의 겉면 정점을 두 공을 부드럽게 합친 겉면(smooth union)으로 옮긴다. pos 는 모양 공간 정점(단위 공, three
 * SphereGeometry 의 position), nrm 은 그 법선이고 그 자리에서 바꾼다. 합친 겉면이 제 겉면보다 밖인 정점(골 가까이)만
 * 거리 함수의 기울기를 따라 겉면까지 밀고, 법선도 합친 겉면의 기울기로 바꾼다. 두 공이 같은 겉면, 같은 법선이 되어
 * 골이 둥글게 메워지고 겹친 자리에 선이 생기지 않는다. 다른 공 안 깊이 묻힌 정점은 그대로 둔다(보이지 않는다). 옮긴 정점 수
 */
export function filletSphere(self: Part, other: Part, pos: Float32Array, nrm: Float32Array): number {
  const body = self.slot === 'body' ? self : other;
  const k = filletK(body);
  const su = (x: number, y: number, z: number) =>
    smin(ellipsoid(self, x, y, z), ellipsoid(other, x, y, z), k);
  const e = 1e-4;
  const grad = (x: number, y: number, z: number): [number, number, number] => [
    (su(x + e, y, z) - su(x - e, y, z)) / (2 * e),
    (su(x, y + e, z) - su(x, y - e, z)) / (2 * e),
    (su(x, y, z + e) - su(x, y, z - e)) / (2 * e),
  ];
  const [sx, sy, sz] = self.at;
  const [rx, ry, rz] = self.size;
  let moved = 0;
  for (let i = 0; i < pos.length; i += 3) {
    let x = sx + (pos[i] ?? 0) * rx;
    let y = sy + (pos[i + 1] ?? 0) * ry;
    let z = sz + (pos[i + 2] ?? 0) * rz;
    const d0 = su(x, y, z);
    // 합친 겉면이 여기보다 밖일 때만 (d0 < 0). 너무 깊으면 다른 공 속이라 둔다
    if (d0 > -1e-5 || d0 < -k) continue;
    const x0 = x;
    const y0 = y;
    const z0 = z;
    for (let n = 0; n < 4; n++) {
      const d = su(x, y, z);
      const [gx, gy, gz] = grad(x, y, z);
      const g2 = gx * gx + gy * gy + gz * gz;
      if (g2 < 1e-9) break;
      x -= (d * gx) / g2;
      y -= (d * gy) / g2;
      z -= (d * gz) / g2;
    }
    if (Math.hypot(x - x0, y - y0, z - z0) > k) continue;
    const [gx, gy, gz] = grad(x, y, z);
    // 세상 법선 → 모양 공간 법선 (모양 공간은 크기로 늘린 공이라 크기를 곱한다)
    const nx = gx * rx;
    const ny = gy * ry;
    const nz = gz * rz;
    const l = Math.hypot(nx, ny, nz) || 1;
    pos[i] = (x - sx) / rx;
    pos[i + 1] = (y - sy) / ry;
    pos[i + 2] = (z - sz) / rz;
    nrm[i] = nx / l;
    nrm[i + 1] = ny / l;
    nrm[i + 2] = nz / l;
    moved++;
  }
  return moved;
}
