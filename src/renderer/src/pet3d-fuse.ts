// 복슬복슬 모습 (사용자 요청 2026-10-09: 블록 조립 말고 한 덩어리 몸). 한 관절에 붙은 부품들을 녹여 붙인 것처럼
// 매끈한 한 겉면으로 만든다. 부품마다 거리 함수(SDF)를 두고 부드러운 합(smooth min)으로 잇고, 격자에서 겉면을
// 뽑는다(surface nets). 색과 털 길이는 겉면에서 가장 가까운 부품을 따라 부드럽게 섞는다. three 없이 숫자만 다룬다.

export type FuseShape = 'sphere' | 'capsule' | 'cylinder' | 'cone' | 'box';

export interface FusePart {
  shape: FuseShape;
  /** 관절 공간 → 모양 공간 (열 우선 4x4, three Matrix4.elements 와 같은 순서) */
  inv: ArrayLike<number>;
  /** 모양 공간 거리를 관절 공간 거리로 (부품 크기의 가장 작은 배율) */
  scale: number;
  /** 캡슐: 반지름과 몸통 반 길이 (모양 공간) */
  capsule?: { r: number; half: number };
  color: [number, number, number];
  /** 털 길이 배율 (0 이면 털 없음) */
  fur: number;
}

export interface FusedMesh {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  /** 정점마다 털 길이 배율 */
  fur: Float32Array;
  indices: Uint32Array;
}

/** 모서리 반지름 (RoundedBoxGeometry(2,2,2,_,0.35) 와 같은 값) */
const BOX_R = 0.35;

/** 모양 공간에서의 거리 (모양은 pet3d.ts partMesh 의 기본 도형) */
export function shapeDistance(
  shape: FuseShape,
  x: number,
  y: number,
  z: number,
  cap?: FusePart['capsule'],
): number {
  switch (shape) {
    case 'capsule': {
      const r = cap?.r ?? 1;
      const h = cap?.half ?? 0;
      const cy = Math.max(-h, Math.min(h, y));
      return Math.hypot(x, y - cy, z) - r;
    }
    case 'cylinder': {
      const dx = Math.hypot(x, z) - 1;
      const dy = Math.abs(y) - 1;
      return Math.min(Math.max(dx, dy), 0) + Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
    }
    case 'cone': {
      // ConeGeometry(1, 2): 꼭짓점 (0,1), 밑면 반지름 1 (y=-1). 반지름-높이 평면의 세모까지 거리
      return triangle2d(Math.hypot(x, z), y);
    }
    case 'box': {
      const qx = Math.abs(x) - (1 - BOX_R);
      const qy = Math.abs(y) - (1 - BOX_R);
      const qz = Math.abs(z) - (1 - BOX_R);
      const out = Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0));
      return out + Math.min(Math.max(qx, qy, qz), 0) - BOX_R;
    }
    default:
      return Math.hypot(x, y, z) - 1;
  }
}

/** 세모 (0,1) (1,-1) (0,-1) 를 축으로 돌린 원뿔까지 부호 있는 거리 (r >= 0 반쪽) */
function triangle2d(r: number, y: number): number {
  // r=0 쪽 변은 회전축이라 겉면이 아니다 (넣으면 축 위 점이 모두 겉면이 된다)
  const segs: [number, number, number, number][] = [
    [0, 1, 1, -1],
    [1, -1, 0, -1],
  ];
  let d = Number.POSITIVE_INFINITY;
  for (const [ax, ay, bx, by] of segs) {
    const ex = bx - ax;
    const ey = by - ay;
    const t = Math.max(0, Math.min(1, ((r - ax) * ex + (y - ay) * ey) / (ex * ex + ey * ey)));
    d = Math.min(d, Math.hypot(r - ax - ex * t, y - ay - ey * t));
  }
  // 안: 밑면 위, 빗면 아래 (빗면 r = (1 - y) / 2)
  const inside = y >= -1 && y <= 1 && r <= (1 - y) / 2;
  return inside ? -d : d;
}

/** 부드러운 합. k 만큼 떨어진 곳까지 두 겉면을 둥글게 잇는다 */
export function smin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

/** 관절 공간 한 점에서 부품까지 거리 (관절 공간 단위, 대략) */
function partDistance(p: FusePart, x: number, y: number, z: number): number {
  const m = p.inv;
  const lx = (m[0] ?? 0) * x + (m[4] ?? 0) * y + (m[8] ?? 0) * z + (m[12] ?? 0);
  const ly = (m[1] ?? 0) * x + (m[5] ?? 0) * y + (m[9] ?? 0) * z + (m[13] ?? 0);
  const lz = (m[2] ?? 0) * x + (m[6] ?? 0) * y + (m[10] ?? 0) * z + (m[14] ?? 0);
  return shapeDistance(p.shape, lx, ly, lz, p.capsule) * p.scale;
}

export function fieldAt(parts: readonly FusePart[], k: number, x: number, y: number, z: number): number {
  let d = Number.POSITIVE_INFINITY;
  for (const p of parts) {
    const e = partDistance(p, x, y, z);
    d = d === Number.POSITIVE_INFINITY ? e : smin(d, e, k);
  }
  return d;
}

/** 겉면 한 점의 색과 털: 가까운 부품일수록 세게 (무늬처럼 겉에 얹은 얇은 부품이 이긴다) */
function paintAt(parts: readonly FusePart[], x: number, y: number, z: number, out: Float32Array, at: number) {
  let r = 0;
  let g = 0;
  let b = 0;
  let f = 0;
  let sum = 0;
  for (const p of parts) {
    const d = Math.max(-0.01, partDistance(p, x, y, z));
    const w = Math.exp(-d / 0.004);
    r += p.color[0] * w;
    g += p.color[1] * w;
    b += p.color[2] * w;
    f += p.fur * w;
    sum += w;
  }
  if (sum <= 0) sum = 1;
  out[at * 4] = r / sum;
  out[at * 4 + 1] = g / sum;
  out[at * 4 + 2] = b / sum;
  out[at * 4 + 3] = f / sum;
}

export interface Bounds {
  min: [number, number, number];
  max: [number, number, number];
}

/**
 * 부품들을 한 겉면으로 녹여 붙인다. cell 은 격자 간격(관절 공간), k 는 잇는 둥글기.
 * 겉면이 없으면 undefined
 */
export function fuseParts(
  parts: readonly FusePart[],
  bounds: Bounds,
  cell: number,
  k: number,
): FusedMesh | undefined {
  const steps = fuseSteps(parts, bounds, cell, k);
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
  }
}

/**
 * fuseParts 를 잘게 나눠 한다: 격자 한 층, 정점 몇백 개마다 멈춘다(yield). 펫 화면이 프레임 사이에 조금씩 돌려
 * 몸을 만드는 동안 화면이 멈추지 않는다 (한 번에 하면 펫 하나에 0.2~0.7초 걸렸다)
 */
export function* fuseSteps(
  parts: readonly FusePart[],
  bounds: Bounds,
  cell: number,
  k: number,
): Generator<void, FusedMesh | undefined> {
  if (!parts.length) return undefined;
  const pad = cell * 2 + k;
  const ox = bounds.min[0] - pad;
  const oy = bounds.min[1] - pad;
  const oz = bounds.min[2] - pad;
  const nx = Math.ceil((bounds.max[0] - bounds.min[0] + 2 * pad) / cell) + 1;
  const ny = Math.ceil((bounds.max[1] - bounds.min[1] + 2 * pad) / cell) + 1;
  const nz = Math.ceil((bounds.max[2] - bounds.min[2] + 2 * pad) / cell) + 1;
  const idx = (i: number, j: number, l: number) => i + nx * (j + ny * l);
  const f = new Float32Array(nx * ny * nz);
  for (let l = 0; l < nz; l++) {
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++)
        f[idx(i, j, l)] = fieldAt(parts, k, ox + i * cell, oy + j * cell, oz + l * cell);
    yield;
  }

  // 칸마다 정점 하나: 부호가 바뀌는 모서리들의 가운데
  const cellVert = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const cidx = (i: number, j: number, l: number) => i + (nx - 1) * (j + (ny - 1) * l);
  const verts: number[] = [];
  const corner = new Float32Array(8);
  const EDGES = [
    [0, 1],
    [2, 3],
    [4, 5],
    [6, 7],
    [0, 2],
    [1, 3],
    [4, 6],
    [5, 7],
    [0, 4],
    [1, 5],
    [2, 6],
    [3, 7],
  ] as const;
  const cornerXYZ = (c: number) => [c & 1, (c >> 1) & 1, (c >> 2) & 1] as const;
  for (let l = 0; l < nz - 1; l++) {
    yield;
    for (let j = 0; j < ny - 1; j++)
      for (let i = 0; i < nx - 1; i++) {
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const [a, b, d] = cornerXYZ(c);
          const v = f[idx(i + a, j + b, l + d)] ?? 1;
          corner[c] = v;
          if (v < 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;
        let sx = 0;
        let sy = 0;
        let sz = 0;
        let n = 0;
        for (const [c0, c1] of EDGES) {
          const v0 = corner[c0] ?? 0;
          const v1 = corner[c1] ?? 0;
          if (v0 < 0 === v1 < 0) continue;
          const t = v0 / (v0 - v1);
          const [ax, ay, az] = cornerXYZ(c0);
          const [bx, by, bz] = cornerXYZ(c1);
          sx += ax + (bx - ax) * t;
          sy += ay + (by - ay) * t;
          sz += az + (bz - az) * t;
          n++;
        }
        cellVert[cidx(i, j, l)] = verts.length / 3;
        verts.push(ox + (i + sx / n) * cell, oy + (j + sy / n) * cell, oz + (l + sz / n) * cell);
      }
  }
  if (!verts.length) return undefined;

  // 부호가 바뀌는 격자 모서리마다 둘레 네 칸의 정점으로 네모 하나 (바깥을 보게 돈다)
  const tris: number[] = [];
  const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) tris.push(a, c, b, a, d, c);
    else tris.push(a, b, c, a, c, d);
  };
  const cv = (i: number, j: number, l: number) =>
    i < 0 || j < 0 || l < 0 || i >= nx - 1 || j >= ny - 1 || l >= nz - 1
      ? -1
      : (cellVert[cidx(i, j, l)] ?? -1);
  for (let l = 0; l < nz; l++) {
    yield;
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const v0 = (f[idx(i, j, l)] ?? 1) < 0;
        if (i < nx - 1 && v0 !== (f[idx(i + 1, j, l)] ?? 1) < 0)
          quad(cv(i, j - 1, l - 1), cv(i, j, l - 1), cv(i, j, l), cv(i, j - 1, l), !v0);
        if (j < ny - 1 && v0 !== (f[idx(i, j + 1, l)] ?? 1) < 0)
          quad(cv(i - 1, j, l - 1), cv(i - 1, j, l), cv(i, j, l), cv(i, j, l - 1), !v0);
        if (l < nz - 1 && v0 !== (f[idx(i, j, l + 1)] ?? 1) < 0)
          quad(cv(i - 1, j - 1, l), cv(i, j - 1, l), cv(i, j, l), cv(i - 1, j, l), !v0);
      }
  }

  const count = verts.length / 3;
  const positions = new Float32Array(verts);
  const normals = new Float32Array(count * 3);
  const paint = new Float32Array(count * 4);
  const e = cell * 0.5;
  for (let v = 0; v < count; v++) {
    const x = positions[v * 3] ?? 0;
    const y = positions[v * 3 + 1] ?? 0;
    const z = positions[v * 3 + 2] ?? 0;
    // 거리 함수의 기울기 = 겉면 바깥 방향 (격자 모서리보다 매끈하다)
    const gx = fieldAt(parts, k, x + e, y, z) - fieldAt(parts, k, x - e, y, z);
    const gy = fieldAt(parts, k, x, y + e, z) - fieldAt(parts, k, x, y - e, z);
    const gz = fieldAt(parts, k, x, y, z + e) - fieldAt(parts, k, x, y, z - e);
    const len = Math.hypot(gx, gy, gz) || 1;
    normals[v * 3] = gx / len;
    normals[v * 3 + 1] = gy / len;
    normals[v * 3 + 2] = gz / len;
    paintAt(parts, x, y, z, paint, v);
    if (v % 400 === 399) yield;
  }
  const colors = new Float32Array(count * 3);
  const fur = new Float32Array(count);
  for (let v = 0; v < count; v++) {
    colors[v * 3] = paint[v * 4] ?? 0;
    colors[v * 3 + 1] = paint[v * 4 + 1] ?? 0;
    colors[v * 3 + 2] = paint[v * 4 + 2] ?? 0;
    fur[v] = paint[v * 4 + 3] ?? 0;
  }
  return { positions, normals, colors, fur, indices: new Uint32Array(tris) };
}
