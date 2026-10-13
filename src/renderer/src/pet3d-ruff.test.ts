import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Mesh, MeshStandardMaterial, SphereGeometry, Vector3 } from 'three';
import {
  RUFF_BANDS,
  ruffAmount,
  ruffAttributes,
  ruffFlow,
  ruffShellMaterial,
  ruffTexture,
} from './pet3d-ruff.ts';

const v = (x: number, y: number, z: number) => new Vector3(x, y, z).normalize();

test('덧털은 윗가슴, 볼, 꼬리에만 (등, 배 아래, 턱 아래, 다리는 그대로)', () => {
  assert.ok(ruffAmount('body', v(0, 0, 1)) > 0.8, '가슴');
  // 앉으면 앞다리를 덮어 공처럼 보였다
  assert.equal(ruffAmount('body', v(0, -1, 0)), 0, '배 아래');
  assert.equal(ruffAmount('body', v(0, -0.6, 0.8)), 0, '아랫가슴');
  assert.equal(ruffAmount('body', v(0, 1, 0)), 0, '등');
  assert.equal(ruffAmount('body', v(0, 0, -1)), 0, '엉덩이');
  const cheek = v(1, -0.3, 0.5);
  assert.ok(ruffAmount('head', cheek) > 0.15, `볼 ${ruffAmount('head', cheek)}`);
  assert.equal(ruffAmount('head', cheek), ruffAmount('head', v(-1, -0.3, 0.5)), '양 볼 같다');
  assert.equal(ruffAmount('head', v(0, 1, 0)), 0, '정수리');
  // 흰 가슴을 머리 털 색이 덮지 않게, 3/4 모습에서 먼 쪽 볼 털이 떨어져 보이지 않게
  assert.equal(ruffAmount('head', v(0, -1, 0)), 0, '턱 아래');
  assert.equal(ruffAmount('head', v(1, -0.3, -0.5)), 0, '뒤통수 쪽 볼');
  assert.ok(ruffAmount('tail', v(0, 1, 0)) >= 0.5, '꼬리');
  for (const leg of ['legL', 'legR', 'armL', 'armR', 'earL'] as const)
    for (const n of [v(1, 0, 0), v(0, 0, 1), v(0, -1, 0)]) assert.equal(ruffAmount(leg, n), 0, leg);
});

test('털 결은 부위마다 다르다: 몸은 꼬리 쪽 아래로, 다리는 아래로', () => {
  const body = ruffFlow('body');
  assert.ok(body.z < 0 && body.y < 0, '몸은 머리에서 꼬리로, 등에서 배로');
  assert.deepEqual(ruffFlow('legL').toArray(), [0, -1, 0]);
  assert.notDeepEqual(ruffFlow('head').toArray(), ruffFlow('legL').toArray());
});

/** 공 모양 부품 (늘린 크기, 돌림) 하나에 덧털 방향을 붙이고 겉면 방향별로 꺼낸다 */
function attrs(slot: 'body' | 'legL', scale: [number, number, number], rotX = 0) {
  const mesh = new Mesh(new SphereGeometry(1, 24, 16), new MeshStandardMaterial());
  mesh.scale.set(...scale);
  mesh.rotation.x = rotX;
  mesh.updateMatrix();
  ruffAttributes(mesh, slot, 0.05, 0.7, Math.min(...scale.map(Math.abs)));
  const g = mesh.geometry;
  const N = g.getAttribute('jjFurN');
  const F = g.getAttribute('jjFurF');
  const pos = g.attributes.position;
  assert.ok(N && F && pos);
  /** 몸 기준으로 dir 쪽 겉면 점의 덧털 길이와 털 결 (세상 길이) */
  const at = (dir: Vector3) => {
    let best = -1;
    let bi = 0;
    const p = new Vector3();
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i).multiply(mesh.scale).applyQuaternion(mesh.quaternion).normalize();
      const d = p.dot(dir);
      if (d > best) {
        best = d;
        bi = i;
      }
    }
    const world = (a: typeof N) =>
      new Vector3(a.getX(bi), a.getY(bi), a.getZ(bi)).multiply(mesh.scale).applyQuaternion(mesh.quaternion);
    return { n: world(N), f: world(F) };
  };
  return at;
}

test('덧털 밀기: 가슴은 겉으로 더 밀고 등은 0, 털 결은 겉면에 눕는다 (늘리고 돌린 부품도)', () => {
  for (const [scale, rot] of [
    [[0.18, 0.3, 0.19], Math.PI / 2],
    [[0.2, 0.2, 0.2], 0],
    [[-0.15, 0.12, 0.13], 0],
  ] as const) {
    const at = attrs('body', [...scale] as [number, number, number], rot);
    const chest = at(v(0, 0, 1));
    const back = at(v(0, 1, 0));
    assert.ok(chest.n.length() > 0.02, `가슴 덧털 ${chest.n.length()}`);
    assert.ok(chest.n.z > 0, '가슴은 앞으로 민다');
    assert.ok(back.n.length() < 1e-6, `등 덧털 ${back.n.length()}`);
    // 옆구리 털 결은 아래, 꼬리 쪽으로
    const side = at(v(1, 0, 0));
    assert.ok(side.f.y < 0 && side.f.z < 0, `옆구리 결 ${side.f.toArray()}`);
    // 털 결은 겉면에 눕는다 (겉면 방향 성분이 작다)
    assert.ok(Math.abs(side.f.x) < side.f.length() * 0.35, '옆구리 결이 겉면에 눕는다');
  }
});

test('작은 부품(주둥이, 코)에는 덧털을 더하지 않는다 (꼬리는 가늘어도 더한다)', () => {
  const at = attrs('body', [0.05, 0.05, 0.05]);
  assert.ok(at(v(0, 0, 1)).n.length() < 1e-9);
  const tail = new Mesh(new SphereGeometry(1, 12, 8), new MeshStandardMaterial());
  tail.scale.set(0.03, 0.03, 0.12);
  ruffAttributes(tail, 'tail', 0.05, 0.85, 0.03);
  const w = tail.geometry.getAttribute('jjFurW');
  assert.ok(w && w.getX(0) > 0.3);
});

test('다리에는 덧털을 더하지 않는다 (다리 모양 그대로), 결은 아래로', () => {
  const at = attrs('legL', [0.05, 0.12, 0.05]);
  for (const d of [v(1, 0, 0), v(0, 0, 1), v(0, -1, 0)]) assert.ok(at(d).n.length() < 1e-9);
  assert.ok(at(v(1, 0, 0)).f.y < 0);
});

test('덧털 가닥 그림: 높은 단일수록 덮임이 적고, 맨 끝 단도 비지 않는다', () => {
  const tex = ruffTexture();
  const data = tex.image.data as Uint8Array;
  const mean = [0, 0, 0, 0];
  for (let i = 0; i < data.length; i += 4)
    for (let k = 0; k < 4; k++) mean[k] = (mean[k] ?? 0) + (data[i + k] ?? 0);
  const m = mean.map((x) => x / (data.length / 4) / 255);
  assert.equal(m.length, RUFF_BANDS.length);
  for (let k = 1; k < 4; k++) assert.ok((m[k] ?? 0) < (m[k - 1] ?? 0), `단 ${k}: ${m}`);
  assert.ok((m[0] ?? 0) > 0.4 && (m[0] ?? 0) < 0.95, `뿌리 덮임 ${m[0]}`);
  assert.ok((m[3] ?? 0) > 0.005, `끝 덮임 ${m[3]}`);
  // 밉맵으로 줄여 160pt 에서 덮임 비율이 고르게 옅어진다
  assert.equal(tex.generateMipmaps, true);
  // 같은 씨앗이면 같은 그림
  assert.deepEqual(ruffTexture().image.data, data);
});

test('덧털 껍질 재질: 섞어 그리고 깊이를 쓰지 않으며, 층마다 셰이더 열쇠가 다르다', () => {
  const tex = ruffTexture();
  const a = ruffShellMaterial(new MeshStandardMaterial().color, tex, 0.25);
  const b = ruffShellMaterial(new MeshStandardMaterial().color, tex, 1);
  assert.equal(a.transparent, true);
  assert.equal(a.depthWrite, false);
  assert.notEqual(a.customProgramCacheKey(), b.customProgramCacheKey());
  // 셰이더 손질: 껍질을 덧털, 털 결만큼 밀고 덮임 그림 두 단을 잇는다
  const shader = {
    vertexShader: '#include <common>\n#include <begin_vertex>',
    fragmentShader: '#include <alphamap_fragment>',
    uniforms: {},
  };
  a.onBeforeCompile(shader as never, undefined as never);
  assert.match(shader.vertexShader, /attribute vec3 jjFurN;/);
  assert.match(shader.vertexShader, /transformed \+= jjFurN \* 0\.2500 \+ jjFurF/);
  assert.match(shader.fragmentShader, /mix\(jjC\.[rgba], jjC\.[rgba], /);
  assert.doesNotMatch(shader.fragmentShader, /#include <alphamap_fragment>/);
});
