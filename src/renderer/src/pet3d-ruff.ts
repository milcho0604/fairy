// 실사 네 발로 선 몸의 덧털 (설계도 fur.ruff, 이슈 #68). 털 길이(fur.length)를 통째로 올리면 윤곽에 새긴 털
// 다발이 계단처럼, 몸통의 가로 털 결이 압축 잡음처럼 보여 "화질 저하 같다"는 평을 받았다 (PR #42, 04d58a5 되돌림).
// 그래서 길이와 기본 털 껍질은 그대로 두고, 그 바깥에 다른 방식으로 그린 껍질(RUFF_LAYERS)을 더 쌓는다 (pet3d.ts addFur):
// - 가는 결: 가닥 덮임을 높이 네 단으로 미리 구워(RGBA) 밉맵으로 줄인다. 높이 그림을 줄여 자르면 160pt 에서
//   가닥이 뭉개져 얼룩이 되지만, 덮임 그림을 줄이면 한 픽셀 안 덮임 비율이 그대로라 털끝이 고르게 옅어진다
// - 반투명 끝: 자르기(alphaTest) 대신 섞는다. 바깥 껍질일수록 옅어 윤곽이 계단 없이 부드럽게 풀린다
// - 부위별 방향: 몸은 머리에서 꼬리로, 옆구리는 등에서 배로, 다리는 아래로 눕는다 (가로 결 하나로 고정하지 않는다)
// - 국소 덧털: 윗가슴, 얼굴 쪽 볼, 꼬리에서만 보이고 겉면 방향으로 더 민다. 등, 배 아래, 다리에는 없어 다리 모양이 같다
import {
  BufferAttribute,
  type Color,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  type Material,
  type Mesh,
  MeshStandardMaterial,
  Quaternion,
  RepeatWrapping,
  RGBAFormat,
  Vector3,
} from 'three';
import type { Slot } from '../../shared/pet3d/blueprint.ts';

/** 덮임 그림의 네 단 높이 (가닥 높이 0~1 에서 이 높이를 자른 단면). 껍질 층 t 는 둘 사이를 잇는다 */
export const RUFF_BANDS = [0.04, 0.38, 0.64, 0.86] as const;

/** 기본 털 껍질 바깥에 더 쌓는 덧털 껍질 수 */
export const RUFF_LAYERS = 14;

/** 덧털 가닥 그림 한 장이 덮는 세상 길이 (실사 털 TILE 0.22 보다 조금 커서 확대해도 가닥이 한 픽셀 남짓) */
export const RUFF_TILE = 0.28;

/**
 * 덧털 가닥 그림 (256x256, 이어 붙여도 끊기지 않는다). RGBA 네 칸이 RUFF_BANDS 높이에서 가닥이 덮은 정도.
 * 가닥은 끝으로 갈수록 가늘어지는 원뿔이라 높은 단일수록 점이 작고 드물다. 가장자리는 픽셀 덮임으로 부드럽게 칠한다
 */
export function ruffTexture(seed = 23): DataTexture {
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
  for (let s = 0; s < 15000; s++) {
    const x = rand() * n;
    const y = rand() * n;
    const r = 0.8 + rand() * 0.7;
    const h = 0.3 + rand() * 0.7;
    for (let py = Math.floor(y - r - 1); py <= y + r + 1; py++)
      for (let px = Math.floor(x - r - 1); px <= x + r + 1; px++) {
        const d = Math.hypot(px + 0.5 - x, py + 0.5 - y);
        const at = ((((py % n) + n) % n) * n + (((px % n) + n) % n)) * 4;
        RUFF_BANDS.forEach((band, k) => {
          if (h <= band) return;
          // 그 높이에서 가닥 단면 반지름 (원뿔), 픽셀이 덮인 정도
          const rk = r * (1 - band / h);
          const cover = Math.min(1, Math.max(0, rk - d + 0.5));
          data[at + k] = Math.max(data[at + k] ?? 0, Math.round(255 * cover));
        });
      }
  }
  const tex = new DataTexture(data, n, n, RGBAFormat);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  // 실사 털 껍질 UV 는 그림 한 장이 세상 0.22 (pet3d.ts addFur). 덧털은 RUFF_TILE 마다 한 장
  tex.repeat.set(0.22 / RUFF_TILE, 0.22 / RUFF_TILE);
  tex.needsUpdate = true;
  return tex;
}

const smooth = (a: number, b: number, x: number) => {
  const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
};

/** 부위의 털 결 방향 (펫 몸 기준: 앞이 +z, 위가 +y). 겉면에 눕혀 쓴다 */
export function ruffFlow(slot: Slot): Vector3 {
  if (slot.startsWith('leg') || slot.startsWith('arm')) return new Vector3(0, -1, 0);
  if (slot.startsWith('ear') || slot === 'top') return new Vector3(0, 1, 0);
  if (slot === 'head') return new Vector3(0, -0.3, -1).normalize();
  if (slot === 'tail') return new Vector3(0, -0.2, -1).normalize();
  // 몸: 머리에서 꼬리로, 옆구리는 등에서 배로
  return new Vector3(0, -0.5, -1).normalize();
}

/** 겉면 방향 n(펫 몸 기준)에서 털을 더할 정도 0~1: 가슴, 배 아래, 볼, 턱 아래, 꼬리. 등과 다리는 0 */
export function ruffAmount(slot: Slot, n: Vector3): number {
  if (slot === 'body') {
    // 목 아래 윗가슴만 (아래까지 더하면 앉을 때 앞다리를 덮어 공처럼 보였다)
    const chest = smooth(0.2, 0.8, n.z) * smooth(0.6, 0.2, n.y) * smooth(-0.35, 0.05, n.y);
    return chest;
  }
  if (slot === 'head') {
    // 볼은 얼굴 쪽 옆 아래만 (넓게 잡으면 머리 옆에 판판한 털 덩이가 붙고, 뒤통수 쪽까지 더하면 3/4 모습에서 먼 쪽 볼 털이 얼굴 밖에 떨어진 띠로 보였다)
    const cheek =
      0.35 * smooth(0.45, 0.9, Math.abs(n.x)) * smooth(0.15, -0.5, n.y) * smooth(-0.05, 0.35, n.z);
    // 턱 아래는 더하지 않는다: 머리 털 색이 흰 가슴을 덮어 목도리처럼 보였다
    return cheek;
  }
  if (slot === 'tail') return 0.5;
  return 0;
}

/**
 * 덧털 껍질을 밀 방향을 모양에 붙인다 (껍질은 부품 모양을 같이 쓴다). 모양 좌표(늘리기 전)로:
 * jjFurN 겉면 방향 덧털 (바깥 껍질에서 이만큼), jjFurF 털 결 방향으로 눕기 (층의 제곱만큼, 끝이 더 눕는다).
 * len 은 이 부품의 털 길이(세상), ruff 는 설계도 덧털 0~1, minExt 는 부품 반지름 가운데 가장 작은 것
 */
export function ruffAttributes(mesh: Mesh, slot: Slot, len: number, ruff: number, minExt: number): void {
  const geo = mesh.geometry;
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  if (!pos || !nor) return;
  const s = mesh.scale;
  const q = mesh.quaternion;
  const qi = new Quaternion().copy(q).invert();
  const flow = ruffFlow(slot);
  // 작은 부품(주둥이, 볼 털 덩이)은 덧털에 파묻히지 않게
  const cap = minExt * 0.3;
  // 작은 부품(주둥이, 볼 털 덩이, 코. 꼬리는 원래 가늘어 빼고)에는 더하지 않는다: 3/4 모습에서 먼 쪽 주둥이 털이 얼굴 밖으로 번졌다
  const small = slot === 'tail' ? 1 : smooth(0.06, 0.09, minExt);
  const N = new Float32Array(pos.count * 3);
  const F = new Float32Array(pos.count * 3);
  const W = new Float32Array(pos.count);
  const n = new Vector3();
  const f = new Vector3();
  const toLocal = (v: Vector3) => {
    v.applyQuaternion(qi);
    v.set(v.x / s.x, v.y / s.y, v.z / s.z);
  };
  for (let i = 0; i < pos.count; i++) {
    // 겉면 방향을 펫 몸 기준으로 (늘린 모양이면 늘린 축으로 나눈다)
    n.set(nor.getX(i) / s.x, nor.getY(i) / s.y, nor.getZ(i) / s.z)
      .normalize()
      .applyQuaternion(q);
    // 털 결을 겉면에 눕힌다. 결이 겉면과 거의 수직(다리 바닥)이면 덜 눕는다
    f.copy(flow).addScaledVector(n, -flow.dot(n));
    const fl = f.length();
    // 얼굴은 덜 눕힌다: 3/4 모습에서 먼 쪽 볼 털끝이 뒤로 밀려 얼굴에서 떨어진 띠처럼 보였다
    if (fl > 1e-4) f.multiplyScalar((len * (slot === 'head' ? 0.15 : 0.5) * Math.min(1, fl * 2)) / fl);
    else f.set(0, 0, 0);
    const amount = ruffAmount(slot, n) * small;
    const extra = Math.min(cap, len * 0.8 * ruff * amount);
    W[i] = amount;
    n.multiplyScalar(extra);
    toLocal(n);
    toLocal(f);
    N.set([n.x, n.y, n.z], i * 3);
    F.set([f.x, f.y, f.z], i * 3);
  }
  geo.setAttribute('jjFurN', new BufferAttribute(N, 3));
  geo.setAttribute('jjFurF', new BufferAttribute(F, 3));
  geo.setAttribute('jjFurW', new BufferAttribute(W, 1));
}

/**
 * 덧털 껍질 재질 (층 t, 0 뿌리 ~ 1 끝). 덮임 그림의 두 단을 이어 이 높이의 가닥 덮임을 알파로 섞는다.
 * 깊이를 쓰지 않아 껍질끼리 가리지 않고, renderOrder(층)대로 안에서 밖으로 쌓인다
 */
export function ruffShellMaterial(color: Color, tex: DataTexture, t: number): Material {
  const m = new MeshStandardMaterial({
    color,
    alphaMap: tex,
    // 섞어 그린다 (기본 껍질처럼 자르면 덧털이 끝이 잘린 판처럼 보였다). 깊이를 쓰지 않아 껍질끼리 가리지 않고
    // renderOrder(층)대로 안에서 밖으로 쌓인다
    transparent: true,
    depthWrite: false,
    // 빈 자리는 버린다 (겹쳐 그리는 수를 줄인다)
    alphaTest: 0.004,
    roughness: 0.9,
  });
  const h = 0.1 + 0.78 * t;
  let b = 0;
  while (b < RUFF_BANDS.length - 2 && h > (RUFF_BANDS[b + 1] ?? 1)) b++;
  const lo = RUFF_BANDS[b] ?? 0;
  const hi = RUFF_BANDS[b + 1] ?? 1;
  const k = Math.min(1, Math.max(0, (h - lo) / (hi - lo)));
  const ch = 'rgba';
  // 바깥 껍질일수록 옅게 (윤곽이 계단 없이 부드럽게 풀린다)
  const fade = 0.95 * (1 - t) ** 0.5;
  const T = t.toFixed(4);
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec3 jjFurN;\nattribute vec3 jjFurF;\nattribute float jjFurW;\nvarying float vJjW;',
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>\ntransformed += jjFurN * ${T} + jjFurF * (${T} * ${T});\nvJjW = jjFurW;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vJjW;')
      .replace(
        '#include <alphamap_fragment>',
        `vec4 jjC = texture2D( alphaMap, vAlphaMapUv );
      // 덧털이 없는 자리(등, 다리)는 그리지 않는다
      diffuseColor.a *= smoothstep(0.0, 0.6, vJjW);
      // 겉면을 비스듬히 볼수록(윤곽) 조금 옅게: 껍질이 겹쳐 보여 줄무늬 띠가 생기지 않게
      diffuseColor.a *= mix(0.6, 1.0, smoothstep(0.05, 0.45, abs(dot(normalize(vNormal), normalize(vViewPosition)))));
      diffuseColor.a *= clamp(mix(jjC.${ch[b]}, jjC.${ch[b + 1]}, ${k.toFixed(4)}) * 2.2, 0.0, 1.0) * ${fade.toFixed(4)};`,
      );
  };
  m.customProgramCacheKey = () => `jj-ruff-${T}`;
  return m;
}
