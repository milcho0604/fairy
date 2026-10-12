// 복슬복슬 모습의 털 (사용자 요청 2026-10-09). 녹여 붙인 몸(pet3d-fuse.ts) 겉면을 법선 방향으로 조금씩 밀어 낸
// 껍질을 겹겹이 그리고, 가닥 그림으로 구멍을 뚫는다. 실사 모습(pet3d.ts addFur)과 다른 점:
// - 껍질을 배율이 아니라 겉면 방향으로 민다 (오목한 자리, 목, 다리 사이에서도 털 길이가 같다)
// - 가닥 그림을 UV 대신 세 방향에서 비춰 붙인다(triplanar). 녹인 몸에는 UV 가 없다
// - 정점마다 털 길이(부위 겉 느낌)와 색을 따로 둔다
// - 뭉침(clump): 가닥이 다발 가운데로 갈수록 길어 끝에서 다발로 갈라진다. 곱슬(curl): 층마다 가닥 자리를 돌려 꼬인다
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  LinearFilter,
  type Material,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  RepeatWrapping,
  RGBAFormat,
} from 'three';
import type { Fur } from '../../shared/pet3d/blueprint.ts';
import type { FusedMesh } from './pet3d-fuse.ts';

/** soft 털 (fluffShellMaterial): 이 층 바깥은 섞는다, 가닥 그림 배율 (작을수록 굵은 가닥) */
const SOFT_FROM = 0.4;
const SOFT_DEN = 0.5;

/** 털 길이(설계도 0~1)를 세상 길이로 (펫 키가 1 남짓) */
export const fluffLength = (fur: Fur) => 0.02 + 0.08 * (fur.length ?? 0.4);
/** 털 길이에 따른 껍질 수 */
export const fluffLayers = (fur: Fur) => Math.round(10 + 14 * (fur.length ?? 0.4));

/**
 * 가닥 그림 (256x256, 이어 붙여도 끊기지 않는다). R 고르게 흩어진 가닥, G 다발로 뭉친 가닥.
 * 밝기가 가닥 높이라서 바깥 껍질일수록(자르는 기준이 높을수록) 높은 가닥만 남는다
 */
export function fluffTexture(seed = 11): DataTexture {
  const n = 256;
  const data = new Uint8Array(n * n * 4);
  let a = seed >>> 0;
  const rand = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // 다발 가운데들
  const clumps = Array.from({ length: 150 }, () => ({ x: rand() * n, y: rand() * n, r: 7 + rand() * 7 }));
  const wrap = (d: number) => {
    const m = Math.abs(d) % n;
    return Math.min(m, n - m);
  };
  // 다발을 16칸 격자에 넣어 둘레 아홉 칸만 본다 (모든 다발을 다 보면 처음 털을 붙일 때 150ms 남짓 멈췄다)
  const G = 16;
  const cellOf = (v: number) => ((Math.floor(v / G) % (n / G)) + n / G) % (n / G);
  const grid = new Map<number, typeof clumps>();
  for (const c of clumps) {
    const key = cellOf(c.x) * 100 + cellOf(c.y);
    grid.set(key, [...(grid.get(key) ?? []), c]);
  }
  const profile = (x: number, y: number) => {
    let best = 0;
    for (let a = -1; a <= 1; a++)
      for (let b = -1; b <= 1; b++) {
        const list = grid.get(cellOf(x + a * G) * 100 + cellOf(y + b * G));
        if (!list) continue;
        for (const c of list) {
          const d = Math.hypot(wrap(x - c.x), wrap(y - c.y)) / c.r;
          if (d < 1) best = Math.max(best, (1 - d) ** 1.3);
        }
      }
    return best;
  };
  for (let i = 0; i < 7000; i++) {
    const x = rand() * n;
    const y = rand() * n;
    const r = 1.6 + rand() * 1;
    const h = 0.45 + rand() * 0.55;
    const clumped = h * (0.2 + 0.8 * profile(x, y));
    for (let py = Math.floor(y - r); py < y + r; py++)
      for (let px = Math.floor(x - r); px < x + r; px++) {
        const k = 1 - Math.hypot(px + 0.5 - x, py + 0.5 - y) / r;
        if (k <= 0) continue;
        const at = ((((py % n) + n) % n) * n + (((px % n) + n) % n)) * 4;
        data[at] = Math.max(data[at] ?? 0, Math.round(255 * h * k * k));
        data[at + 1] = Math.max(data[at + 1] ?? 0, Math.round(255 * clumped * k * k));
      }
  }
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  const tex = new DataTexture(data, n, n, RGBAFormat);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  // 밉맵을 쓰면 줄일 때 가닥이 회색으로 번져 자르기에 다 걸린다
  tex.minFilter = LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/** 녹인 몸 겉면 재질: 털 아래 속털 (겉색보다 어둡다) */
export function fluffBaseMaterial(): Material {
  return new MeshPhysicalMaterial({
    vertexColors: true,
    color: new Color(0.82, 0.82, 0.82),
    roughness: 1,
    sheen: 0.6,
    sheenRoughness: 0.5,
    sheenColor: new Color(0.5, 0.5, 0.5),
  });
}

/**
 * 털 껍질 재질 하나 (층 i / n). 모든 층과 모든 펫이 셰이더 하나를 같이 쓰고 값(uniform)만 다르다
 * (층마다 셰이더를 새로 엮으면 처음 그릴 때 멈칫한다).
 * soft: 바깥 층은 가닥을 자르지 않고 옅게 섞는다 (가닥이 한 픽셀보다 가늘어 잘린 점이 흩어져 가장자리가
 * 지글지글했다). 가닥도 굵게. 네 발로 선 몸(밀크, 초코)만 (다른 펫 모습은 그대로)
 */
export function fluffShellMaterial(i: number, n: number, tex: DataTexture, fur: Fur, soft = false): Material {
  const t = i / n;
  const length = fur.length ?? 0.4;
  const curl = fur.curl ?? 0;
  // 곱슬 털은 다발로 말린다
  const clump = Math.max(fur.clump ?? 0.2, curl * 0.8);
  // 뿌리는 그늘져 어둡고 끝은 빛을 받아 밝다
  const shade = 0.82 + 0.2 * t + (t > 0.75 ? (t - 0.75) * 0.25 : 0);
  // 안쪽 층은 거의 꽉 차 털 부피가 되고, 바깥 층만 성겨져 가장자리가 보송해진다
  const cut = 0.08 + 0.62 * t ** 1.8;
  // soft 의 섞는 바깥 층
  const blend = soft && t > SOFT_FROM;
  const m = new MeshStandardMaterial({
    vertexColors: true,
    color: new Color(shade, shade, shade),
    alphaMap: tex,
    alphaTest: blend ? 0.01 : cut,
    transparent: blend,
    depthWrite: !blend,
    roughness: 0.85,
  });
  const values = {
    uShell: t,
    uLen: fluffLength(fur),
    uGrav: fluffLength(fur) * (0.25 + 0.5 * length) * (1 - curl * 0.7),
    uCurl: curl,
    uClump: clump,
    // 가닥 간격: 곱슬은 다발이 굵다
    uDen: (4 / (1 + 0.6 * curl)) * (soft ? SOFT_DEN : 1),
    uCut: cut,
  };
  m.onBeforeCompile = (shader) => {
    for (const [k, v] of Object.entries(values)) shader.uniforms[k] = { value: v };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute float furLen;
uniform float uShell;
uniform float uLen;
uniform float uGrav;
varying vec3 vFurP;
varying vec3 vFurN;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vFurP = position;
vFurN = normal;
transformed += normalize(objectNormal) * (uShell * uLen * furLen);
transformed.y -= uGrav * furLen * uShell * uShell;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uShell;
uniform float uCurl;
uniform float uClump;
uniform float uDen;
uniform float uCut;
varying vec3 vFurP;
varying vec3 vFurN;`,
      )
      .replace(
        '#include <alphamap_fragment>',
        `{
  // 겉면이 가장 많이 보는 한 방향에서만 가닥 그림을 비춘다 (셋을 섞으면 가닥 끝이 뭉개져 다 잘려 나갔다)
  vec3 an = abs(vFurN);
  // 앞, 옆에서 보이는 면은 가닥 그림을 세로로 늘려 점이 아니라 아래로 빗은 결로 보이게 한다 (곱슬은 덜)
  float comb = mix(0.4, 0.85, uCurl);
  vec2 uv = an.x > an.y && an.x > an.z ? vec2(vFurP.z, vFurP.y * comb)
    : (an.y > an.z ? vFurP.xz : vec2(vFurP.x, vFurP.y * comb));
  float ang = uShell * 2.2 * 6.2832;
  // 층마다 가닥 자리를 아래로 조금씩 옮겨 가닥이 점이 아니라 아래로 눕는 이어진 털이 되게 (곱슬은 대신 돈다)
  vec2 cu = vec2(cos(ang), sin(ang)) * 0.035 * uCurl + vec2(0.0, uShell * 0.018 * (1.0 - uCurl));
  vec2 st = texture2D(alphaMap, uv * uDen + cu).rg;
  ${
    blend
      ? `// 자르는 대신 기준 둘레에서 옅게: 바깥 층일수록 더 옅다
  diffuseColor.a *= smoothstep(uCut - 0.18, uCut + 0.12, mix(st.r, st.g, uClump)) * (1.0 - 0.55 * uShell);`
      : 'diffuseColor.a *= mix(st.r, st.g, uClump);'
  }
  // 다발 사이 골은 그늘지고 다발 가운데는 밝다: 정면에서도 털 무늬가 읽힌다
  diffuseColor.rgb *= mix(0.9, 1.04, mix(st.r, st.g, max(uClump, 0.5)));
}`,
      )
      // 가장자리 털 끝이 빛을 머금어 보송하게 (바깥 층일수록)
      .replace(
        '#include <opaque_fragment>',
        `outgoingLight += diffuseColor.rgb * 0.35 * uShell * pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition))), 2.0);
#include <opaque_fragment>`,
      );
  };
  m.customProgramCacheKey = () => (blend ? 'jj-fluff-soft' : 'jj-fluff');
  return m;
}

/** 녹인 몸을 three 모양으로. 색, 털 길이, (가닥 그림 자리용) 빈 UV 를 같이 넣는다 */
export function fusedGeometry(f: FusedMesh): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(f.positions, 3));
  g.setAttribute('normal', new BufferAttribute(f.normals, 3));
  g.setAttribute('color', new BufferAttribute(f.colors, 3));
  g.setAttribute('furLen', new BufferAttribute(f.fur, 1));
  g.setAttribute('uv', new BufferAttribute(new Float32Array((f.positions.length / 3) * 2), 2));
  g.setIndex(new BufferAttribute(f.indices, 1));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** 이미 있는 모양(손 흔드는 앞발 등)에 한 가지 색과 털 길이를 넣어 녹인 몸처럼 쓸 수 있게 한다 */
export function paintGeometry(g: BufferGeometry, color: Color, fur: number): void {
  const count = g.attributes.position?.count ?? 0;
  const c = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) c.set([color.r, color.g, color.b], i * 3);
  g.setAttribute('color', new BufferAttribute(c, 3));
  g.setAttribute('furLen', new BufferAttribute(new Float32Array(count).fill(fur), 1));
}

/** 겉면 모양에 껍질들을 자식으로 붙인다 (재질은 부르는 쪽이 층마다 준다) */
export function addShells(mesh: Mesh, layers: number, shell: (i: number) => Material): void {
  for (let i = 1; i <= layers; i++) {
    const s = new Mesh(mesh.geometry, shell(i));
    s.renderOrder = i;
    s.userData.shell = true;
    mesh.add(s);
  }
}

/**
 * 털 덩이 굴곡 (곱슬은 동글동글한 털 뭉치, 긴 털은 완만한 결). 작은 화면에서는 가닥보다 덩이가 털로 읽힌다.
 * 겉면을 법선 방향으로 밀어 낸다: 3차원 세포 잡음(가장 가까운 점까지 거리)으로 뭉치 가운데가 볼록하다.
 * 정점이 움직였으니 법선은 다시 계산한다
 */
export function bumpFur(g: BufferGeometry, fur: Fur, seed = 5): void {
  const steps = bumpFurSteps(g, fur, seed);
  while (!steps.next().done);
}

/** bumpFur 를 정점 몇백 개마다 멈추며 한다 (펫 화면이 프레임 사이에 돌린다) */
export function* bumpFurSteps(g: BufferGeometry, fur: Fur, seed = 5): Generator<void, void> {
  const curl = fur.curl ?? 0;
  const clump = fur.clump ?? 0;
  const amp = 0.022 * curl + 0.007 * clump * (fur.length ?? 0.4);
  if (amp <= 0.0005) return;
  // 뭉치 크기: 곱슬은 작고 동그랗게, 긴 털은 크게
  const size = curl > 0.3 ? 0.045 : 0.07;
  const pos = g.attributes.position;
  const nor = g.attributes.normal;
  const len = g.attributes.furLen;
  if (!pos || !nor) return;
  const hash = (x: number, y: number, z: number, k: number) => {
    let h = (x * 374761393 + y * 668265263 + z * 2147483647 + k * 1274126177 + seed * 9737333) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) / size;
    const y = pos.getY(i) / size;
    const z = pos.getZ(i) / size;
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    const cz = Math.floor(z);
    let d1 = 9;
    for (let a = -1; a <= 1; a++)
      for (let b = -1; b <= 1; b++)
        for (let c = -1; c <= 1; c++) {
          const px = cx + a + hash(cx + a, cy + b, cz + c, 1);
          const py = cy + b + hash(cx + a, cy + b, cz + c, 2);
          const pz = cz + c + hash(cx + a, cy + b, cz + c, 3);
          d1 = Math.min(d1, Math.hypot(x - px, y - py, z - pz));
        }
    const bump = Math.max(0, 1 - d1) ** 2 * amp * (len ? len.getX(i) : 1);
    pos.setXYZ(
      i,
      pos.getX(i) + nor.getX(i) * bump,
      pos.getY(i) + nor.getY(i) * bump,
      pos.getZ(i) + nor.getZ(i) * bump,
    );
    if (i % 600 === 599) yield;
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
}
