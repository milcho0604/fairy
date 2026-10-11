// 입체 펫 같이 타자 치기 (shared/together.ts): 몸 앞 바닥에 작은 입체 키보드를 두고, 앞발(팔, 날개)을 그 위로 옮겨
// 번갈아 누른다 (together-draw.ts tapPaws 와 같은 박자). 키보드도 몸과 같은 재질이라 피규어, 게임, 실사, 복슬복슬 모습을 따른다.
// 자리는 설계도를 조립할 때 잰 부품 상자로 정한다 (pet3d.ts setBlueprint). 쪽지 들기도 같은 자리로 손을 모은다
import { type Box3, Group, type Material, Mesh, type Object3D, Quaternion, Vector3 } from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { Slot } from '../../shared/pet3d/blueprint.ts';

export const HANDS = ['armL', 'armR', 'wingL', 'wingR'] as const;
export type HandSlot = (typeof HANDS)[number];

interface Paw {
  /** 어깨 (관절 자리, root 기준) */
  pivot: Vector3;
  /** 어깨에서 앞발 끝까지 쉬는 방향 (단위)과 길이 */
  rest: Vector3;
  len: number;
  /** 누를 때 앞발 끝이 닿을 자리 (키보드 윗면) */
  tip: Vector3;
}

export interface TapRig {
  paws: Partial<Record<HandSlot, Paw>>;
  /** 같이 일할 때 오른 앞발(연필 쥔 손) 끝 자리: 몸 앞 오른쪽 가슴 높이 */
  pen: Vector3;
  /** 쪽지를 들 때 앞발 끝 자리 (가운데에서 몸 너비 0.13 씩, 배 높이) */
  hold: { y: number; z: number; dx: number };
  /** 누르지 않을 때 앞발 끝을 드는 높이 */
  lift: number;
  /** 키보드 자리와 크기 (root 기준). y 는 바닥 */
  board: { x: number; y: number; z: number; w: number; d: number; h: number };
}

/**
 * 부품 상자와 관절 자리(root 기준)로 키보드 자리와 앞발이 닿을 자리를 잰다. 몸이나 앞발이 없으면 undefined.
 * 키보드는 발 앞 바닥에 몸 너비 0.7 쯤 (위에서 조금 내려다보는 카메라라 윗면 키가 보인다), 앞발 끝은 그 윗면,
 * 가운데에서 몸 너비 0.16 씩 떨어진 두 키 위
 */
export function tapRigOf(
  boxes: ReadonlyMap<Slot, Box3>,
  pivots: Readonly<Record<Slot, Vector3>>,
): TapRig | undefined {
  const body = boxes.get('body');
  if (!body) return undefined;
  const size = body.getSize(new Vector3());
  const c = body.getCenter(new Vector3());
  const w = size.x * 0.7;
  const d = size.z * 0.36;
  const h = Math.max(0.02, size.y * 0.08);
  // 다리와 발이 몸보다 앞으로 나온 펫도 있어 모든 부품의 앞면을 본다
  let front = body.max.z;
  for (const b of boxes.values()) if (b.min.y < body.min.y + size.y * 0.3) front = Math.max(front, b.max.z);
  const z = front + d * 0.42;
  // 카메라가 조금 위에서 보니 앞으로 나온 만큼 화면에서 아래로 내려가 캔버스 밖으로 잘린다.
  // 그만큼 띄워 키보드 앞 아래 모서리가 펫 발밑 줄에 오게 한다 (바닥 그림자는 2D 가 발밑에 그린다)
  const y = body.min.y + (z + d / 2 - body.max.z) * 0.2;
  const top = y + h * 1.3;
  const paws: TapRig['paws'] = {};
  for (const slot of HANDS) {
    const b = boxes.get(slot);
    if (!b) continue;
    const pivot = pivots[slot].clone();
    const hc = b.getCenter(new Vector3());
    const restTip = new Vector3(hc.x, b.min.y, hc.z);
    const rest = restTip.sub(pivot);
    const len = rest.length();
    if (len < 1e-4) continue;
    const side = slot.endsWith('L') ? -1 : 1;
    paws[slot] = {
      pivot,
      rest: rest.normalize(),
      len,
      tip: new Vector3(c.x + side * size.x * 0.16, top, z - d * 0.12),
    };
  }
  if (Object.keys(paws).length === 0) return undefined;
  return {
    paws,
    pen: new Vector3(c.x + size.x * 0.24, body.min.y + size.y * 0.3, body.max.z),
    hold: { y: body.min.y + size.y * 0.22, z: body.max.z + size.z * 0.04, dx: size.x * 0.13 },
    lift: size.y * 0.07,
    board: { x: c.x, y, z, w, d, h },
  };
}

const tmpDir = new Vector3();
const tmpTip = new Vector3();
const tmpQ = new Quaternion();
const ID = new Quaternion();

/** 앞발 끝이 닿을 자리: 키보드(press 만큼 누름), 연필(pen, 오른 앞발만), 쪽지(hold) */
export function pawTarget(
  rig: TapRig,
  slot: HandSlot,
  aim: { press: number } | 'pen' | 'hold',
): Vector3 | undefined {
  const p = rig.paws[slot];
  if (!p) return undefined;
  const side = slot.endsWith('L') ? -1 : 1;
  if (aim === 'pen') return side > 0 ? rig.pen.clone() : undefined;
  if (aim === 'hold') return new Vector3(rig.board.x + side * rig.hold.dx, rig.hold.y, rig.hold.z);
  return p.tip.clone().setY(p.tip.y + rig.lift * (1 - aim.press));
}

/**
 * 앞발 하나를 target 으로 뻗는다: 어깨에서 그쪽으로 돌리고, 길이가 모자라면 관절째 그만큼 옮긴다
 * (짧은 앞발인 콩이는 거의 옮기고, 긴 팔인 냥이는 거의 돌리기만). k 뻗은 정도 0~1
 */
export function reachPaw(
  rig: TapRig,
  slot: HandSlot,
  target: Vector3,
  k: number,
  joint: Object3D,
  base: Vector3,
): void {
  const p = rig.paws[slot];
  if (!p || k <= 0) return;
  tmpTip.copy(target);
  tmpDir.copy(tmpTip).sub(p.pivot).normalize();
  tmpQ.setFromUnitVectors(p.rest, tmpDir);
  joint.quaternion.copy(ID).slerp(tmpQ, k);
  // 돌린 끝에서 닿을 자리까지 모자란 만큼 관절을 옮긴다
  const off = tmpTip.sub(p.pivot).addScaledVector(tmpDir, -p.len);
  joint.position.set(base.x + off.x * k, base.y + off.y * k, base.z + off.z * k);
}

/** 앞발 끝 (그 관절 기준). 화면 자리를 잴 때 (연필, 쪽지를 손에 맞춰 그린다) */
export function pawTip(rig: TapRig, slot: HandSlot): Vector3 | undefined {
  const p = rig.paws[slot];
  return p ? p.rest.clone().multiplyScalar(p.len) : undefined;
}

export interface Keyboard3D {
  group: Group;
  /** 앞발 밑 키 [왼, 오른], 스페이스 */
  under: [Mesh, Mesh];
  space: Mesh;
  key: Material;
  lit: Material;
}

/** 입체 키보드: 둥근 판 위에 두 줄 키와 스페이스. mat 은 펫 재질 만들기, edge 는 게임 모습 테두리 선 */
export function buildKeyboard(
  rig: TapRig,
  mat: (color: string, shiny?: boolean) => Material,
  edge?: (mesh: Mesh) => void,
): Keyboard3D {
  const { w, d, h } = rig.board;
  const group = new Group();
  group.name = 'tap-keyboard';
  const base = new Mesh(new RoundedBoxGeometry(w, h, d, 3, Math.min(h, d) * 0.45), mat('#98a0ab'));
  base.position.y = h / 2;
  edge?.(base);
  group.add(base);
  const key = mat('#f7f8fa');
  const lit = mat('#ffd54a', true);
  const cols = 7;
  const gap = w * 0.02;
  const kw = (w * 0.9 - gap * (cols - 1)) / cols;
  const kd = (d * 0.8 - gap * 2) / 3;
  const kh = h * 0.45;
  const keyGeo = new RoundedBoxGeometry(kw, kh, kd, 2, Math.min(kw, kd) * 0.25);
  const keys: Mesh[][] = [];
  for (let row = 0; row < 2; row++) {
    keys.push([]);
    for (let col = 0; col < cols; col++) {
      const m = new Mesh(keyGeo, key);
      m.position.set(
        -w * 0.45 + kw / 2 + col * (kw + gap),
        h + kh / 2 - kh * 0.3,
        -d * 0.4 + kd / 2 + row * (kd + gap),
      );
      group.add(m);
      keys[row]?.push(m);
    }
  }
  const space = new Mesh(new RoundedBoxGeometry(w * 0.44, kh, kd, 2, kd * 0.25), key);
  space.position.set(0, h + kh / 2 - kh * 0.3, -d * 0.4 + kd / 2 + 2 * (kd + gap));
  group.add(space);
  const row = keys[1] ?? [];
  const under: [Mesh, Mesh] = [row[2] ?? space, row[4] ?? space];
  group.position.set(rig.board.x, rig.board.y, rig.board.z);
  group.visible = false;
  return { group, under, space, key, lit };
}

/** 키보드 보이기: k 나온 정도(작게 시작해 커진다), press 앞발 [왼, 오른] 누른 정도 (누른 키에 불) */
export function poseKeyboard(kb: Keyboard3D, k: number, press: readonly [number, number]): void {
  kb.group.visible = k > 0.01;
  kb.group.scale.setScalar(0.7 + 0.3 * k);
  const on = (p: number | undefined) => (p ?? 0) > 0.6;
  kb.under[0].material = on(press[0]) ? kb.lit : kb.key;
  kb.under[1].material = on(press[1]) ? kb.lit : kb.key;
  kb.space.material = on(press[0]) && on(press[1]) ? kb.lit : kb.key;
}
