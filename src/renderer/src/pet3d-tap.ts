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
  /**
   * 날개만: 어깨에서 끝까지 뻗는 방향을 정해 둔다 (안쪽 아래, 조금 앞). 없으면 어깨에서 닿을 자리를 곧장 본다.
   * 날개는 옆으로 얇고 위아래로 긴 판이라 곧장 보면 키 위에 똑바로 선 판처럼 볼을 가리고 키를 누르는지 안 보였다.
   * 안쪽으로 비스듬히 눕히면 어깨에서 키까지 손처럼 뻗어 보인다 (삐약이, 2026-10-11)
   */
  lean?: Vector3;
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

/** 키보드를 카메라 쪽으로 세우는 각 (먼 쪽 모서리가 올라간다). 카메라가 9도 위에서만 봐서 바닥에 눕히면 키가 안 보였다 */
export const BOARD_TILT = 0.55;

/**
 * 부품 상자와 관절 자리(root 기준)로 키보드 자리와 앞발이 닿을 자리를 잰다. 몸이나 앞발이 없으면 undefined.
 * 키보드는 배 앞 무릎 높이에 몸 너비 0.86 쯤으로 두고 카메라 쪽으로 세운다 (노트북을 무릎에 얹은 것처럼, 키가 보이게).
 * 앞발 끝은 가운데에서 몸 너비 0.2 씩 떨어진 두 키 위. 철마다 옷(목도리)이 배 앞에 있으면 그보다 앞에 둔다
 * (worn: 입는 옷 상자. 목도리 고리가 손을 덮었다, 2026-10-11 검토)
 */
export function tapRigOf(
  boxes: ReadonlyMap<Slot, Box3>,
  pivots: Readonly<Record<Slot, Vector3>>,
  worn?: Box3,
): TapRig | undefined {
  const body = boxes.get('body');
  if (!body) return undefined;
  const size = body.getSize(new Vector3());
  const c = body.getCenter(new Vector3());
  // 옆으로 넓은 몸(콩이)은 몸 높이로 줄인다: 판이 너무 크면 앞 모서리가 캔버스 밑으로 잘린다
  const w = Math.min(size.x * 0.86, size.y * 0.95);
  const d = Math.min(size.z * 0.38, w * 0.42);
  const h = Math.max(0.02, size.y * 0.06);
  // 배 높이(아래 0.45)까지 앞으로 나온 부품의 앞면 (다리, 발, 앞발이 몸보다 나온 펫도 있다)
  const belly = body.min.y + size.y * 0.45;
  let front = body.max.z;
  for (const b of boxes.values()) if (b.min.y < belly) front = Math.max(front, b.max.z);
  if (worn && !worn.isEmpty() && worn.min.y < belly) front = Math.max(front, worn.max.z);
  // 키보드 가운데: 앞면에서 반 깊이 + 조금 앞, 바닥에서 몸 높이 0.13 위 (무릎에 얹은 높이. 더 낮으면 앞 모서리가 캔버스 밑으로 잘린다)
  const z = front + d * 0.5 + size.z * 0.04;
  // 앞으로 많이 나온 만큼 더 띄운다 (카메라가 위에서 보니 앞으로 나온 만큼 화면에서 내려간다)
  const y = body.min.y + size.y * 0.13 + Math.max(0, z + d / 2 - body.max.z) * 0.16;
  // 세운 판 윗면에서 앞발이 누를 줄(둘째 줄, 판 가운데)의 자리
  const along = 0;
  const up = h * 1.6;
  const top = y + up * Math.cos(BOARD_TILT) - along * Math.sin(BOARD_TILT);
  const tipZ = z + along * Math.cos(BOARD_TILT) + up * Math.sin(BOARD_TILT);
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
    const wing = slot.startsWith('wing');
    paws[slot] = {
      pivot,
      rest: rest.normalize(),
      len,
      tip: new Vector3(c.x + side * size.x * 0.2, top, tipZ),
      // 끝은 키에, 날개 뿌리는 원래 어깨 가까이에 온다
      ...(wing ? { lean: new Vector3(-side * 0.72, -0.62, 0.32).normalize() } : {}),
    };
  }
  if (Object.keys(paws).length === 0) return undefined;
  return {
    paws,
    pen: new Vector3(c.x + size.x * 0.24, body.min.y + size.y * 0.3, body.max.z),
    hold: { y: body.min.y + size.y * 0.22, z: body.max.z + size.z * 0.04, dx: size.x * 0.13 },
    lift: size.y * 0.09,
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
  if (p.lean) tmpDir.copy(p.lean);
  else tmpDir.copy(tmpTip).sub(p.pivot).normalize();
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

/**
 * 입체 키보드: 둥근 판 위에 두 줄 키와 스페이스, 카메라 쪽으로 세운다(BOARD_TILT). mat 은 펫 재질 만들기,
 * edge 는 게임 모습 테두리 선. 판은 짙은 회색, 키는 흰색이라 작은 크기에서도 키가 하나하나 보인다
 */
export function buildKeyboard(
  rig: TapRig,
  mat: (color: string, shiny?: boolean) => Material,
  edge?: (mesh: Mesh) => void,
): Keyboard3D {
  const { w, d, h } = rig.board;
  const group = new Group();
  group.name = 'tap-keyboard';
  const tilt = new Group();
  tilt.rotation.x = BOARD_TILT;
  group.add(tilt);
  const base = new Mesh(new RoundedBoxGeometry(w, h, d, 3, Math.min(h, d) * 0.45), mat('#6f7782'));
  base.position.y = h / 2;
  edge?.(base);
  tilt.add(base);
  const key = mat('#fbfbfd');
  const lit = mat('#ffc53d', true);
  const cols = 6;
  const gap = w * 0.025;
  const kw = (w * 0.9 - gap * (cols - 1)) / cols;
  const kd = (d * 0.84 - gap * 2) / 3;
  const kh = h * 0.8;
  const keyGeo = new RoundedBoxGeometry(kw, kh, kd, 2, Math.min(kw, kd) * 0.22);
  const keyY = h + kh / 2 - kh * 0.35;
  const keys: Mesh[][] = [];
  for (let row = 0; row < 2; row++) {
    keys.push([]);
    for (let col = 0; col < cols; col++) {
      const m = new Mesh(keyGeo, key);
      m.position.set(-w * 0.45 + kw / 2 + col * (kw + gap), keyY, -d * 0.42 + kd / 2 + row * (kd + gap));
      tilt.add(m);
      keys[row]?.push(m);
    }
  }
  const space = new Mesh(new RoundedBoxGeometry(w * 0.5, kh, kd, 2, kd * 0.22), key);
  space.position.set(0, keyY, -d * 0.42 + kd / 2 + 2 * (kd + gap));
  tilt.add(space);
  const row = keys[1] ?? [];
  // 앞발 밑 키: 가운데에서 몸 너비 0.2 (판 너비의 0.23) 쯤인 키
  const under: [Mesh, Mesh] = [row[1] ?? space, row[4] ?? space];
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
