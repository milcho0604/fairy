// 입체 펫 (6단계). 설계도(blueprint)를 three.js 로 조립해 따로 둔 WebGL 캔버스에 그리고, 그 그림을 펫 2D 캔버스에 옮긴다.
// 그래서 픽셀로 하는 마우스 판정, 말풍선, 하트, Zz 는 2D 펫과 똑같이 돈다.
// 그리기는 2D 와 같은 때만 한다(정지 상태는 한 번). 계속 돌리지 않는다 (L10).
import {
  Box3,
  type BufferGeometry,
  CanvasTexture,
  CapsuleGeometry,
  CatmullRomCurve3,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  type Material,
  Matrix3,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  NeutralToneMapping,
  type Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Quaternion,
  Raycaster,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  TubeGeometry,
  Vector3,
  WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import {
  type Blueprint,
  type EyeLook,
  expandMirrors,
  type Face,
  type Finish,
  inFace,
  type Part,
  SLOTS,
  type Slot,
} from '../../shared/pet3d/blueprint.ts';
import { type DrawState, danceTilt, gazeOf, type Model3D, movePoseOf, trickOf, waveSwing } from './draw.ts';
import type { MoveEyes } from './move-pose.ts';
import {
  gaitOf,
  hindFrom,
  hipRise,
  type LegId,
  legCut,
  legGap,
  trotLeg,
  walkEnvelope,
} from './pet3d-gait.ts';
import { bounced, type EyeState, restingEye } from './pet3d-motion.ts';

const CX = 80;
const GROUND = 154;
/** 쉬는 자세의 펫이 2D 캔버스(160)에서 차지할 최대 키와 너비 */
const FIT_H = 118;
const FIT_W = 140;
const DEG = Math.PI / 180;
const INK = '#1f2328';

type Act = DrawState['activity'];
type MouthState = 'smile' | 'open' | 'yawn' | 'o' | 'flat' | 'frown' | 'wavy';
/** 몸짓 눈 (move-pose.ts) → 입체 눈. 동그랗게(wide)는 뜬 눈을 조금 키운다 */
const MOVE_EYE: Record<MoveEyes, EyeState> = { closed: 'down', happy: 'up', half: 'half', wide: 'open' };

interface FaceRig {
  eyes: { side: -1 | 1; states: Record<EyeState, Object3D>; open: Object3D }[];
  mouth: Partial<Record<MouthState, Object3D>>;
  beakLower?: Object3D;
  style: Face['mouth'];
  /** 쉬는 눈 모양 (설계도 face.eyes) */
  eyeLook: EyeLook;
  /** 얼굴에 붙인 것들 (눈, 입, 볼, 수염). 옆으로 돌아 얼굴이 안 보일 때 숨긴다 */
  groups: Group[];
  /** 입 자리 (부리는 옆에서도 보여서 숨기지 않는다) */
  mouthAt: Group;
}

/** 네 발 걷기의 다리 하나 (pet3d-gait.ts) */
interface QuadLeg {
  id: LegId;
  /** 이 다리 부품을 묶은 관절. 다리 슬롯 관절(뒷발을 본떠 만든 것은 몸 관절) 아래에 있다 */
  g: Group;
  /** 쉬는 자리 (부모 기준) */
  base: Vector3;
  /** 몸 관절에서 다리 관절까지 (쉬는 자세, 세상 기준) */
  hip: Vector3;
  /** 다리 관절에서 발바닥까지 높이. 길면 다리를 돌려서, 짧은 발(꼬마 피규어)은 옮겨서 딛는다 */
  drop: number;
  /** 앞발을 본떠 만든 뒷발 */
  synth: boolean;
}

interface QuadRig {
  legs: QuadLeg[];
  /** 걸을 때 몸을 앞으로 숙이는 각(라디안). 앉은 피규어는 크게, 원래 네 발로 선 모양은 조금만 */
  lean: number;
  /** 보폭(앞뒤로 나가는 거리)과 발을 드는 높이 */
  stride: number;
  lift: number;
  /**
   * 앉은 피규어(동그란 몸 위에 큰 머리)를 네 발 자세로 바꾸는 것: 몸통을 앞뒤로 늘여 뒤로 빼고,
   * 머리는 앞으로 조금 내리고, 꼬리는 뒤로 눕힌다. 원래 네 발로 선 모양이면 없다
   */
  morph?: {
    /** 몸 부품만 묶은 것 (몸 관절 아래). 늘이고 옮긴다 */
    torso: Group;
    torsoBase: Vector3;
    headBase: Vector3;
    tailBase: Vector3;
    /** 몸 앞뒤 두께, 키 */
    depth: number;
    height: number;
  };
}

export class Pet3D implements Model3D {
  private readonly canvas = document.createElement('canvas');
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(20, 1, 0.1, 50);
  private root = new Group();
  private joints = {} as Record<Slot, Group>;
  private hasHead = false;
  /** 눈과 입을 머리 관절에 그렸는지 (아니면 몸이 곧 얼굴) */
  private faceOnHead = false;
  /** 손 흔들기에 들 팔이나 날개가 있는지 (없으면 wavePaw 를 들어 흔든다) */
  private hasHand = false;
  /** 팔이 없는 펫의 손 흔들기 앞발 (평소엔 숨김) */
  private wavePaw: Group | undefined;
  /** 네 발 걷기 (설계도 gait, pet3d-gait.ts). 두 발 펫이면 undefined */
  private quad: QuadRig | undefined;
  private face: FaceRig | undefined;
  /** 마지막으로 그린 자리 (2D 캔버스 좌표). 같이 보기 돋보기가 눈 자리를 찾을 때 쓴다 */
  private drawn: { x0: number; y0: number; d: number } | undefined;
  /** 몸짓 세기 (설계도 motion). 1 이 기본 동작 */
  private motion = { bounce: 1, sway: 1, tail: 1, ear: 1 };
  /** 그릴 것이 있는지 (설계도나 입체 판을 넣었는지) */
  private ready = false;
  /** 2.5D 입체 판 (사진 + 깊이). 있으면 관절 대신 몸 전체만 기울인다 */
  private relief: { texture: CanvasTexture } | undefined;
  /** 쉬는 자세가 화면(NDC)에서 차지하는 자리로 정한 2D 그림 크기와 위치 */
  private fit = { d: 160, cx: 0, bottom: -1, halfW: 0.5 };
  private px = 0;
  private lost = false;
  private readonly materials = new Map<string, Material>();
  private readonly box = new Box3();
  /** 쉬는 자세의 가운데 x (뒹굴 때 제자리를 지키려고) */
  private restX = 0;
  private readonly tmp = new Vector3();
  /** 얼굴 부품이 카메라 쪽을 보는지 잴 때 쓰는 벡터 (그릴 때마다 만들지 않게) */
  private readonly faceTmp = { at: new Vector3(), n: new Vector3(), eye: new Vector3() };

  /** WebGL 을 못 쓰는 컴퓨터면 undefined (2D 펫으로) */
  static create(onLost: () => void): Pet3D | undefined {
    try {
      return new Pet3D(onLost);
    } catch {
      return undefined;
    }
  }

  private constructor(onLost: () => void) {
    this.renderer = new WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
      powerPreference: 'low-power',
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(1);
    this.renderer.toneMapping = NeutralToneMapping;
    this.renderer.outputColorSpace = SRGBColorSpace;
    // 피규어 느낌: 방 조명을 비춰 비닐 광택이 나게 하고, 위 앞에서 주 조명, 뒤에서 테두리 빛
    const pmrem = new PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.scene.environment = pmrem.fromScene(room, 0.04).texture;
    this.scene.environmentIntensity = 0.55;
    room.dispose();
    pmrem.dispose();
    this.scene.add(new HemisphereLight(0xffffff, 0xd9c7b5, 1.1));
    const key = new DirectionalLight(0xffffff, 1.7);
    key.position.set(-1.2, 2.2, 2.4);
    const rim = new DirectionalLight(0xfff4e0, 1.3);
    rim.position.set(1.5, 1.4, -2.2);
    this.scene.add(key, rim);
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      // 직접 내린 것(dispose)은 잃은 것이 아니다. 알리면 펫이 2D 로 굳는다
      if (this.lost) return;
      this.lost = true;
      onLost();
    });
  }

  /** 빙글 도는 미리보기(펫 만들기 창)에서 더하는 몸 돌림(라디안) */
  spin = 0;
  /** 같은 미리보기에서 위(+) 아래(-)로 기울여 보는 각(라디안). 카메라가 몸 가운데를 축으로 돈다 */
  tilt = 0;
  /** 카메라가 도는 중심과 거리, 지금 카메라에 들어간 기울기 (frameCamera 가 정한다) */
  private orbit = { c: new Vector3(), dist: 1, tilt: 0 };
  /** 그리는 해상도 상한(px). 펫 화면은 768 이면 충분하고, 앱 아이콘은 더 크게 그린다 */
  maxPx = 768;

  get ok(): boolean {
    return !this.lost;
  }

  /** 그리던 모양을 내린다. 입체를 잠깐 안 쓸 때 (렌더러는 다시 쓴다) */
  clear(): void {
    this.resetRoot();
  }

  /**
   * GPU 를 돌려준다. 주의: three 의 공용 빈 텍스처가 렌더러를 붙잡아 컨텍스트가 다 풀리지 않는다
   * (버그잡이 점검 2026-10-07, 300번 만들고 버리면 컨텍스트 192개가 남았다). 그래서 창마다 하나만 만들어 다시 쓴다
   */
  dispose(): void {
    this.lost = true;
    this.disposeTree(this.root);
    for (const m of this.materials.values()) m.dispose();
    this.scene.environment?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }

  /** 옛 모양을 내리고 빈 몸을 준비한다 */
  private resetRoot() {
    this.scene.remove(this.root);
    this.disposeTree(this.root);
    this.relief?.texture.dispose();
    this.relief = undefined;
    this.face = undefined;
    this.quad = undefined;
    this.motion = { bounce: 1, sway: 1, tail: 1, ear: 1 };
    this.ready = false;
    // 색별 재질도 비운다 (펫을 갈아끼울 때마다 쌓이지 않게)
    for (const m of this.materials.values()) m.dispose();
    this.materials.clear();
    this.root = new Group();
    this.scene.add(this.root);
  }

  /**
   * 2.5D 입체 판 (6단계). 사진을 촘촘한 그물에 붙이고 깊이 그림만큼 앞으로 밀어 낸다.
   * 가장자리는 둥글게 부풀려(베개처럼) 옆에서 봐도 종이처럼 얇지 않게 한다. 돌기는 좌우 25도까지
   */
  setRelief(photo: CanvasImageSource & { width: number; height: number }, depth: CanvasImageSource): void {
    this.resetRoot();
    const aspect = photo.width / Math.max(1, photo.height);
    // 키 1 기준, 너무 넓으면 너비 1.3 에 맞춘다
    const h = aspect > 1.3 ? 1.3 / aspect : 1;
    const w = h * aspect;
    const segX = Math.round(Math.min(128, Math.max(32, 96 * Math.min(1, aspect))));
    const segY = Math.round(Math.min(128, Math.max(32, 96 * Math.min(1, 1 / aspect))));
    const cols = segX + 1;
    const rows = segY + 1;
    const sample = (src: CanvasImageSource) => {
      const c = document.createElement('canvas');
      c.width = cols;
      c.height = rows;
      const g = c.getContext('2d', { willReadFrequently: true });
      if (!g) return new Uint8ClampedArray(cols * rows * 4);
      g.imageSmoothingQuality = 'high';
      g.drawImage(src, 0, 0, cols, rows);
      return g.getImageData(0, 0, cols, rows).data;
    };
    const dep = sample(depth);
    const alpha = blurAlpha(sample(photo), cols, rows, 5);
    const geo = new PlaneGeometry(w, h, segX, segY);
    const pos = geo.attributes.position;
    if (pos) {
      for (let i = 0; i < pos.count; i++) {
        const d = (dep[i * 4] ?? 0) / 255;
        const a = alpha[i] ?? 0;
        // 깊이(앞뒤 굴곡) + 베개(가장자리에서 안으로 갈수록 부푼다)
        const pillow = a * a * (3 - 2 * a);
        pos.setZ(i, (d * 0.16 + 0.1) * pillow);
      }
    }
    geo.translate(0, h / 2, 0);
    geo.computeVertexNormals();
    const c = document.createElement('canvas');
    c.width = photo.width;
    c.height = photo.height;
    c.getContext('2d')?.drawImage(photo, 0, 0);
    const texture = new CanvasTexture(c);
    texture.colorSpace = SRGBColorSpace;
    const mat = new MeshStandardMaterial({ map: texture, alphaTest: 0.5, roughness: 0.7, side: DoubleSide });
    this.root.add(new Mesh(geo, mat));
    this.relief = { texture };
    this.hasHead = false;
    this.hasHand = false;
    this.ready = true;
    this.frameCamera();
  }

  setBlueprint(bp: Blueprint): void {
    this.resetRoot();
    const m = bp.motion;
    this.motion = {
      bounce: m?.bounce ?? 1,
      sway: m?.sway ?? 1,
      tail: m?.tailWag ?? 1,
      ear: m?.earWiggle ?? 1,
    };
    const parts = expandMirrors(bp.parts);
    const meshes = parts.map((p) => ({ part: p, mesh: this.partMesh(p) }));

    // 슬롯마다 부품이 차지하는 상자로 관절 자리를 정한다
    const boxes = new Map<Slot, Box3>();
    for (const { part, mesh } of meshes) {
      mesh.updateMatrixWorld(true);
      const b = new Box3().setFromObject(mesh);
      boxes.set(part.slot, boxes.get(part.slot)?.union(b) ?? b);
    }
    this.hasHead = boxes.has('head');
    // 손 흔들기에 쓸 팔: 몸 옆으로 나온 팔이나 날개만 (토순이처럼 가슴 앞 작은 앞발은 들어도 안 보인다)
    const bodyBox = boxes.get('body');
    const handBox = boxes.get('armR') ?? boxes.get('wingR');
    this.hasHand =
      !!handBox &&
      !!bodyBox &&
      handBox.max.x - bodyBox.getCenter(new Vector3()).x >= ((bodyBox.max.x - bodyBox.min.x) / 2) * 0.8;
    const pivots = {} as Record<Slot, Vector3>;
    const parentOf = (slot: Slot): Slot | undefined => {
      if (slot === 'body') return undefined;
      if ((slot === 'earL' || slot === 'earR' || slot === 'top') && this.hasHead) return 'head';
      return 'body';
    };
    for (const slot of SLOTS) {
      const b = boxes.get(slot);
      const parent = parentOf(slot);
      if (!b) {
        pivots[slot] = parent ? pivots[parent].clone() : new Vector3();
        continue;
      }
      const c = b.getCenter(new Vector3());
      if (slot === 'body') pivots[slot] = new Vector3(c.x, b.min.y, c.z);
      else if (slot === 'head') pivots[slot] = new Vector3(c.x, b.min.y + (b.max.y - b.min.y) * 0.15, c.z);
      else if (slot.startsWith('leg')) pivots[slot] = new Vector3(c.x, b.max.y, c.z);
      else if (slot.startsWith('arm') || slot.startsWith('wing'))
        // 어깨는 부품 위쪽 가운데. 몸 쪽 끝에 두면 팔을 들 때 몸 안으로 파묻힌다
        pivots[slot] = new Vector3(c.x, b.max.y - (b.max.y - b.min.y) * 0.2, c.z);
      else if (slot === 'tail') pivots[slot] = new Vector3(c.x, b.min.y, b.max.z);
      else pivots[slot] = new Vector3(c.x, b.min.y, c.z); // 귀, 머리 위
    }
    // body 를 먼저, head 를 다음에 만들어야 자식이 부모를 찾는다 (SLOTS 순서)
    for (const slot of SLOTS) {
      const g = new Group();
      g.name = slot;
      const parent = parentOf(slot);
      g.position.copy(pivots[slot]).sub(parent ? pivots[parent] : new Vector3());
      (parent ? this.joints[parent] : this.root).add(g);
      this.joints[slot] = g;
    }
    for (const { part, mesh } of meshes) {
      mesh.position.sub(pivots[part.slot]);
      this.joints[part.slot].add(mesh);
    }
    this.root.updateMatrixWorld(true);
    const faceSlot = bp.face.slot === 'head' && this.hasHead ? 'head' : 'body';
    this.faceOnHead = faceSlot === 'head';
    this.face = this.buildFace(
      bp.face,
      this.joints[faceSlot],
      meshes.filter((m) => m.part.slot === faceSlot).map((m) => m.mesh),
    );
    this.ready = true;
    this.frameCamera();
    // 옆으로 나온 팔이 없으면 손 흔들 때만 보이는 앞발을 몸 오른쪽 어깨에 붙인다 (카메라 맞춘 뒤라 화면 크기는 그대로)
    this.wavePaw = undefined;
    const bodyMesh = meshes.find((m) => m.part.slot === 'body')?.mesh;
    if (!this.hasHand && bodyBox && bodyMesh) {
      const c = bodyBox.getCenter(new Vector3());
      const size = bodyBox.getSize(new Vector3());
      const pivot = new Group();
      this.root.updateMatrixWorld(true);
      pivot.position.copy(
        this.joints.body.worldToLocal(
          new Vector3(c.x + size.x * 0.44, c.y + size.y * 0.24, c.z + size.z * 0.12),
        ),
      );
      const r = Math.max(0.045, size.x * 0.12);
      const paw = new Mesh(new SphereGeometry(1, 24, 16), bodyMesh.material);
      paw.scale.set(r, r * 1.35, r);
      paw.position.set(0, r * 1.1, 0);
      pivot.add(paw);
      pivot.visible = false;
      this.joints.body.add(pivot);
      this.wavePaw = pivot;
    }
    // 네 발 동물이면 다리를 앞발, 뒷발 네 개로 나눈다 (카메라 맞춘 뒤라 화면 크기는 그대로)
    this.quad = bodyBox ? this.buildQuad(bp, parts, meshes, bodyBox) : undefined;
  }

  /**
   * 네 발 걷기 준비. 다리 슬롯마다 부품을 앞뒤 무리로 나눠 각각 관절을 만든다.
   * 뒷발이 없으면(앉은 피규어) 앞발을 본떠 몸 뒤쪽에 만든다. 앞에서는 몸에 가려 쉬는 모습은 그대로다
   */
  private buildQuad(
    bp: Blueprint,
    parts: Part[],
    meshes: { part: Part; mesh: Mesh }[],
    bodyBox: Box3,
  ): QuadRig | undefined {
    const depth = bodyBox.max.z - bodyBox.min.z;
    if (gaitOf(bp, parts, depth) !== 'quadruped') return undefined;
    this.root.updateMatrixWorld(true);
    const cz = bodyBox.getCenter(new Vector3()).z;
    const bodyAt = this.joints.body.getWorldPosition(new Vector3());
    const group = (parent: Group, list: Mesh[], id: LegId, synth: boolean): QuadLeg => {
      const box = new Box3();
      for (const m of list) {
        m.updateMatrixWorld(true);
        box.union(new Box3().setFromObject(m));
      }
      const c = box.getCenter(new Vector3());
      const hip = new Vector3(c.x, box.max.y, c.z);
      const g = new Group();
      g.position.copy(parent.worldToLocal(hip.clone()));
      parent.add(g);
      g.updateMatrixWorld(true);
      for (const m of list) g.attach(m);
      return { id, g, base: g.position.clone(), hip: hip.sub(bodyAt), drop: box.max.y - box.min.y, synth };
    };
    const legs: QuadLeg[] = [];
    const meshOf = (m: { mesh: Mesh }) => m.mesh;
    for (const [slot, side] of [
      ['legL', 'l'],
      ['legR', 'r'],
    ] as const) {
      const mine = meshes.filter((m) => m.part.slot === slot);
      if (!mine.length) return undefined;
      const cut = legCut(
        mine.map((m) => m.part.at[2]),
        legGap(depth),
      );
      const front = cut === undefined ? mine : mine.filter((m) => m.part.at[2] > cut);
      const hind = cut === undefined ? [] : mine.filter((m) => m.part.at[2] <= cut);
      const own = this.joints[slot];
      legs.push(group(own, front.map(meshOf), `f${side}`, false));
      if (hind.length) {
        legs.push(group(own, hind.map(meshOf), `h${side}`, false));
        continue;
      }
      // 뒷발을 앞발에서 본뜬다: 몸 가운데를 기준으로 뒤로, 엉덩이처럼 조금 바깥으로, 조금 크게
      const copies = front.map(({ mesh }) => {
        const m = new Mesh(mesh.geometry, mesh.material);
        mesh.matrixWorld.decompose(m.position, m.quaternion, m.scale);
        const at = hindFrom(m.position.x, m.position.z, cz);
        m.position.x = at.x;
        m.position.z = at.z;
        m.scale.multiplyScalar(1.08);
        m.userData.hind = true;
        return m;
      });
      legs.push(group(this.joints.body, copies, `h${side}`, true));
    }
    const synth = legs.some((l) => l.synth);
    // 앉은 피규어는 몸통을 늘여 네 발 자세로 바꾼다. 얼굴이 머리에 있을 때만 (몸에 그린 얼굴은 몸과 같이 늘어나지 않는다)
    let morph: QuadRig['morph'];
    if (synth && this.hasHead && this.faceOnHead) {
      const torso = new Group();
      const c = bodyBox.getCenter(new Vector3());
      torso.position.copy(this.joints.body.worldToLocal(c.clone()));
      this.joints.body.add(torso);
      torso.updateMatrixWorld(true);
      for (const { part, mesh } of meshes) if (part.slot === 'body') torso.attach(mesh);
      morph = {
        torso,
        torsoBase: torso.position.clone(),
        headBase: this.joints.head.position.clone(),
        tailBase: this.joints.tail.position.clone(),
        depth,
        height: bodyBox.max.y - bodyBox.min.y,
      };
    }
    const z = (id: LegId) => legs.find((l) => l.id === id)?.hip.z ?? 0;
    const span = Math.max(0.1, (z('fl') + z('fr') - z('hl') - z('hr')) / 2);
    const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
    return {
      legs,
      // 늘이지 못하는 몸(얼굴이 몸에 있는 공 모양)은 많이 숙이면 얼굴이 바닥을 본다. 조금만
      lean: morph ? 0.12 : synth ? 0.1 : 0.06,
      morph,
      stride: clamp(span * 0.25, 0.03, 0.12),
      lift: clamp(span * 0.2, 0.03, 0.08),
    };
  }

  /** 펫을 ctx 에 그리고 머리 꼭대기 y 를 돌려준다. 그릴 수 없으면 undefined (2D 로) */
  draw(
    ctx: CanvasRenderingContext2D,
    s: DrawState,
    lift0: number,
    sx0: number,
    sy0: number,
    act: Act,
  ): number | undefined {
    if (this.lost || !this.ready) return undefined;
    // 통통 튀는 세기 (설계도 motion.bounce, pet3d-motion.ts)
    // 네 발 걷기는 걸음 들썩임도 출발과 멈춤에 맞춰 줄인다 (pet3d-gait.ts walkEnvelope)
    const bob = this.quad && act?.type === 'walk' ? walkEnvelope(act.along, act.ms).stride : 1;
    const { lift: up, sx, sy } = bounced(s, act, this.motion.bounce, lift0 * bob, sx0, sy0);
    this.pose(s, sx, sy, act);
    const { d, cx, bottom } = this.fit;
    // 몸짓으로 폴짝 뛰어도 귀 끝이 캔버스 위로 잘리지 않게 (토순이처럼 키가 큰 펫)
    const lift = movePoseOf(act, s.calm) ? Math.min(up, this.headTop(0) - 2) : up;
    // 2D 캔버스 변환(화면 배율 × 펫 크기)에 맞춰 선명하게
    const scale = ctx.getTransform().a || 1;
    const px = Math.max(64, Math.min(this.maxPx, Math.round(d * scale)));
    if (px !== this.px) {
      this.px = px;
      this.renderer.setSize(px, px, false);
    }
    if (this.tilt !== this.orbit.tilt) this.aim(this.tilt);
    this.renderer.render(this.scene, this.camera);
    const x0 = CX - d / 2 - (cx * d) / 2;
    const y0 = GROUND - d / 2 + (bottom * d) / 2 - lift;
    // 바닥 그림자: 떠오를수록 옅고 작게
    const away = Math.min(1, lift / 30);
    const rx = this.fit.halfW * d * 0.42 * sx * (1 - 0.3 * away);
    ctx.save();
    ctx.globalAlpha = 0.16 * (1 - 0.6 * away);
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(CX, GROUND - 1, rx, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.drawImage(this.canvas, x0, y0, d, d);
    this.drawn = { x0, y0, d };
    // 머리 꼭대기 (말풍선 대신 머리 위에 뜨는 것들 자리)
    return this.headTop(lift);
  }

  /** 지금 자세의 머리 꼭대기 y (2D 캔버스). lift 만큼 띄웠을 때 */
  private headTop(lift: number): number {
    const { d, bottom } = this.fit;
    const y0 = GROUND - d / 2 + (bottom * d) / 2 - lift;
    this.box.setFromObject(this.root);
    this.box.getCenter(this.tmp);
    this.tmp.y = this.box.max.y;
    this.tmp.project(this.camera);
    return y0 + d / 2 - (this.tmp.y * d) / 2;
  }

  /** 방금 그린 그림에서 side 쪽 눈 가운데 (2D 캔버스 좌표). 눈이 없으면 undefined (같이 보기 돋보기) */
  eye(side: -1 | 1): { x: number; y: number } | undefined {
    const e = this.face?.eyes.find((v) => v.side === side);
    if (!e || !this.drawn) return undefined;
    const { x0, y0, d } = this.drawn;
    const p = e.open.getWorldPosition(new Vector3()).project(this.camera);
    return { x: x0 + d / 2 + (p.x * d) / 2, y: y0 + d / 2 - (p.y * d) / 2 };
  }

  /**
   * 얼굴 부품만 그린다. 이름 옆 얼굴 그림용 (pet-face.ts). 머리, 귀, 얼굴, 머리 위 장식에 더해
   * 얼굴이 몸에 있으면(콩이처럼 몸이 곧 얼굴) 몸도 (blueprint.ts inFace).
   * 나머지(팔, 앞발, 다리, 꼬리, 목줄 같은 몸 장식)는 잠깐 숨겼다가 되돌린다
   */
  drawHead(ctx: CanvasRenderingContext2D, s: DrawState): number | undefined {
    if (this.relief) return this.draw(ctx, s, 0, 1, 1, undefined);
    const slotOf = new Map<Object3D, Slot>(SLOTS.map((slot) => [this.joints[slot], slot]));
    const hidden: Object3D[] = [];
    this.root.traverse((o) => {
      if (!(o instanceof Mesh) || !o.visible) return;
      // 부품이 매달린 가장 가까운 관절
      let p: Object3D | null = o.parent;
      while (p && !slotOf.has(p)) p = p.parent;
      const slot = p ? slotOf.get(p) : undefined;
      // 본떠 만든 뒷발은 몸 관절에 붙어 있어도 다리다
      if (slot && inFace(slot, this.faceOnHead) && !o.userData.hind) return;
      o.visible = false;
      hidden.push(o);
    });
    try {
      return this.draw(ctx, s, 0, 1, 1, undefined);
    } finally {
      for (const o of hidden) o.visible = true;
    }
  }

  // ---- 조립 ----

  private material(color: string, finish: Finish = 'soft'): Material {
    const key = `${color}/${finish}`;
    let m = this.materials.get(key);
    if (!m) {
      m = new MeshPhysicalMaterial(
        finish === 'shiny'
          ? { color, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.15 }
          : finish === 'fuzzy'
            ? { color, roughness: 0.85, sheen: 1, sheenRoughness: 0.45, sheenColor: '#ffffff' }
            : { color, roughness: 0.55, clearcoat: 0.35, clearcoatRoughness: 0.45 },
      );
      this.materials.set(key, m);
    }
    return m;
  }

  private partMesh(p: Part): Mesh {
    const [x, y, z] = p.size;
    let geo: BufferGeometry;
    const scale = new Vector3(x, y, z);
    switch (p.shape) {
      case 'capsule': {
        // 캡슐은 반지름 그대로 만들고 길이로 늘린다 (늘려서 만들면 둥근 끝이 찌그러진다)
        const r = Math.max(x, z);
        geo = new CapsuleGeometry(r, Math.max(0, 2 * y - 2 * r), 10, 24);
        scale.set(x / r, 1, z / r);
        break;
      }
      case 'cone':
        geo = new ConeGeometry(1, 2, 32);
        break;
      case 'cylinder':
        geo = new CylinderGeometry(1, 1, 2, 32);
        break;
      case 'box':
        geo = new RoundedBoxGeometry(2, 2, 2, 4, 0.35);
        break;
      case 'torus':
        geo = new TorusGeometry(1, 0.32, 16, 48);
        break;
      default:
        geo = new SphereGeometry(1, 40, 28);
    }
    const mesh = new Mesh(geo, this.material(p.color, p.finish));
    mesh.position.set(...p.at);
    mesh.scale.copy(scale);
    if (p.rot) mesh.rotation.set(p.rot[0] * DEG, p.rot[1] * DEG, p.rot[2] * DEG);
    return mesh;
  }

  /** 앞에서 쏜 선이 얼굴 겉면에 닿는 자리에 눈, 입, 볼, 수염을 붙인다 */
  private buildFace(f: Face, joint: Group, targets: Mesh[]): FaceRig {
    const ray = new Raycaster();
    const front = new Vector3(0, 0, -1);
    const s = f.eyeSize;
    // 얼굴 슬롯 상자. 설계도의 눈, 입 높이가 몸 밖이면 상자 안쪽으로 당겨 다시 쏜다 (허공에 뜨지 않게)
    const faceBox = new Box3();
    for (const t of targets) faceBox.union(new Box3().setFromObject(t));
    const shoot = (x: number, y: number) => {
      ray.set(new Vector3(x, y, 5), front);
      return ray.intersectObjects(targets, false)[0];
    };
    const groups: Group[] = [];
    const place = (x0: number, y0: number, out = 0.002): Group => {
      let x = x0;
      let y = y0;
      let hit = shoot(x, y);
      if (!hit && !faceBox.isEmpty()) {
        const c = faceBox.getCenter(new Vector3());
        const half = faceBox.getSize(new Vector3()).multiplyScalar(0.4);
        x = Math.min(c.x + half.x, Math.max(c.x - half.x, x));
        y = Math.min(c.y + half.y, Math.max(c.y - half.y, y));
        hit = shoot(x, y);
      }
      const faceZ = new Box3().setFromObject(joint).max.z;
      const p = hit?.point.clone() ?? new Vector3(x, y, Number.isFinite(faceZ) ? faceZ : 0);
      const n = new Vector3(0, 0, 1);
      if (hit?.face) {
        n.copy(hit.face.normal)
          .applyMatrix3(new Matrix3().getNormalMatrix(hit.object.matrixWorld))
          .normalize();
      }
      p.addScaledVector(n, out);
      const g = new Group();
      joint.add(g);
      groups.push(g);
      g.position.copy(joint.worldToLocal(p.clone()));
      g.updateMatrixWorld(true);
      g.lookAt(p.clone().add(n));
      return g;
    };
    // 눈 색(eyeColor)은 홍채에만. 감은 눈, 입 같은 선은 늘 먹색이다 (노란 눈 고양이의 선이 흐려 보였다)
    const eyeMat = new MeshPhysicalMaterial({
      color: INK,
      roughness: 0.15,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
    });
    const white = new MeshBasicMaterial({ color: '#ffffff' });
    const ink = new MeshBasicMaterial({ color: INK });
    const irisMat = f.eyeColor
      ? new MeshPhysicalMaterial({
          color: f.eyeColor,
          roughness: 0.2,
          clearcoat: 1,
          clearcoatRoughness: 0.05,
        })
      : undefined;
    const sphere = new SphereGeometry(1, 24, 16);

    const eyes: FaceRig['eyes'] = [];
    for (const side of [-1, 1] as const) {
      const g = place(side * f.eyeGap, f.eyeY);
      const open = new Group();
      const shine = new Mesh(sphere, white);
      shine.scale.setScalar(s * 0.26);
      shine.position.set(s * 0.24, s * 0.38, s * 0.36);
      if (irisMat) {
        // 색 홍채 위에 세로로 긴 검은 눈동자
        const iris = new Mesh(sphere, irisMat);
        iris.scale.set(s * 0.85, s * 1.02, s * 0.4);
        const pupil = new Mesh(sphere, eyeMat);
        pupil.scale.set(s * 0.42, s * 0.78, s * 0.3);
        pupil.position.z = s * 0.14;
        shine.position.z = s * 0.42;
        open.add(iris, pupil, shine);
      } else {
        const ball = new Mesh(sphere, eyeMat);
        ball.scale.set(s * 0.78, s, s * 0.42);
        open.add(ball, shine);
      }
      const down = arc(s * 0.75, s * 0.17, ink, true);
      const up = arc(s * 0.75, s * 0.17, ink, false);
      up.position.y = -s * 0.3;
      const chevron = new Group();
      // 왼눈 > 오른눈 <
      const dir = -side;
      for (const v of [-1, 1])
        chevron.add(stroke([dir * s * 0.55, 0], [-dir * s * 0.5, v * s * 0.6], s * 0.15, ink));
      const half = new Group();
      const lower = new Mesh(sphere, eyeMat);
      lower.scale.set(s * 0.78, s * 0.42, s * 0.4);
      lower.position.y = -s * 0.25;
      half.add(lower, stroke([-s * 0.85, s * 0.05], [s * 0.85, s * 0.05], s * 0.13, ink));
      if (f.eyes === 'sparkle') {
        // 반짝이는 눈: 큰 반짝이 하나 더, 아래에 작은 별빛
        shine.scale.setScalar(s * 0.34);
        const dot = new Mesh(sphere, white);
        dot.scale.setScalar(s * 0.14);
        dot.position.set(-s * 0.26, -s * 0.34, shine.position.z);
        open.add(dot);
      }
      // 졸린 눈 (설계도 face.eyes sleepy): 감기 직전의 얕은 ‿. 평평한 눈꺼풀(반달)은 시큰둥하거나 화난 눈으로 읽혀서
      // 선으로 그린다. 굵기는 다른 감은 눈(호)과 같고 끝은 둥글게. 잠든 눈(∪)보다 넓고 얕다
      const drowsy = new Group();
      const lash = Array.from({ length: 11 }, (_, i) => {
        const t = i / 10;
        return new Vector3((t - 0.5) * s * 1.7, -Math.sin(t * Math.PI) * s * 0.34, 0);
      });
      drowsy.add(new Mesh(new TubeGeometry(new CatmullRomCurve3(lash), 24, s * 0.17, 8), ink));
      for (const end of [lash[0], lash[10]]) {
        const cap = new Mesh(sphere, ink);
        cap.scale.setScalar(s * 0.17);
        if (end) cap.position.copy(end);
        drowsy.add(cap);
      }
      drowsy.position.y = -s * 0.05;
      // 얼굴 겉면을 따라 붙은 눈은 둥근 머리에서 안쪽이 내려가게 기운다. 평평한 눈꺼풀은 그러면 화난 눈썹처럼 보여서
      // 화면에서 수평으로 되돌리고 바깥쪽을 살짝 처지게 한다 (꾸벅 조는 눈 half 의 선도 수평으로)
      const level = levelRoll(g);
      drowsy.rotation.z = level - side * 0.1;
      half.rotation.z = level;
      const states = { open, down, up, chevron, half, drowsy };
      for (const o of Object.values(states)) g.add(o);
      eyes.push({ side, states, open });
    }

    const m = s;
    const mouthAt = place(0, f.mouthY);
    const mouth: FaceRig['mouth'] = {};
    let beakLower: Object3D | undefined;
    if (f.mouth === 'beak') {
      const beakMat = this.material(f.mouthColor ?? '#ff9f43', 'shiny');
      const cone = new ConeGeometry(1, 2, 24);
      const upper = new Mesh(cone, beakMat);
      upper.rotation.x = Math.PI / 2;
      upper.scale.set(m * 1.5, m * 1.1, m * 0.8);
      upper.position.set(0, m * 0.35, m * 0.9);
      const lowerPivot = new Group();
      lowerPivot.position.set(0, -m * 0.1, 0);
      const lower = new Mesh(cone, beakMat);
      lower.rotation.x = Math.PI / 2;
      lower.scale.set(m * 1.15, m * 0.8, m * 0.55);
      lower.position.set(0, -m * 0.25, m * 0.6);
      lowerPivot.add(lower);
      mouthAt.add(upper, lowerPivot);
      beakLower = lowerPivot;
    } else {
      const dark = new MeshBasicMaterial({ color: '#3a2326' });
      const tongue = new MeshBasicMaterial({ color: '#e66a7a' });
      if (f.mouth === 'cat') {
        const w = new Group();
        for (const side of [-1, 1]) {
          const a = arc(m * 0.62, m * 0.14, ink, true);
          a.position.set(side * m * 0.6, m * 0.3, 0);
          w.add(a);
        }
        mouth.smile = w;
        const nose = new Mesh(sphere, this.material(f.blush ?? '#ff8fa0', 'shiny'));
        nose.scale.set(m * 0.5, m * 0.32, m * 0.3);
        nose.position.set(0, m * 1.05, m * 0.05);
        mouthAt.add(nose);
      } else {
        const smile = arc(m * 1.25, m * 0.17, ink, true);
        smile.position.y = m * 0.6;
        mouth.smile = smile;
      }
      const open = new Group();
      const hole = new Mesh(sphere, dark);
      hole.scale.set(m * 0.85, m * 1.05, m * 0.3);
      const tip = new Mesh(sphere, tongue);
      tip.scale.set(m * 0.55, m * 0.35, m * 0.2);
      tip.position.set(0, -m * 0.55, m * 0.12);
      open.add(hole, tip);
      mouth.open = open;
      const yawn = open.clone();
      yawn.scale.setScalar(1.45);
      mouth.yawn = yawn;
      const o = new Mesh(new TorusGeometry(m * 0.5, m * 0.13, 8, 24), ink);
      mouth.o = o;
      mouth.flat = stroke([-m * 0.9, 0], [m * 0.9, 0], m * 0.14, ink);
      const frown = arc(m * 1.0, m * 0.16, ink, false);
      frown.position.y = -m * 0.7;
      mouth.frown = frown;
      const pts = Array.from({ length: 9 }, (_, i) => {
        const t = i / 8;
        return new Vector3((t - 0.5) * m * 2.2, Math.sin(t * Math.PI * 2) * m * 0.35, 0);
      });
      mouth.wavy = new Mesh(new TubeGeometry(new CatmullRomCurve3(pts), 24, m * 0.13, 6), ink);
      for (const o3 of Object.values(mouth)) mouthAt.add(o3);
    }

    if (f.blush) {
      const blush = new MeshBasicMaterial({
        color: f.blush,
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
      });
      for (const side of [-1, 1]) {
        const g = place(side * (f.eyeGap + s * 1.5), f.eyeY - s * 2.3, 0.004);
        const disc = new Mesh(sphere, blush);
        disc.scale.set(s * 1.55, s * 0.85, s * 0.12);
        g.add(disc);
      }
    }
    if (f.whiskers) {
      const mat = new MeshBasicMaterial({ color: f.whiskers });
      for (const side of [-1, 1]) {
        const g = place(side * (f.eyeGap + s * 1.4), f.mouthY + s * 0.4);
        for (const tilt of [-0.18, 0.12]) {
          g.add(stroke([side * s * 0.4, 0], [side * s * 4.2, s * 4 * tilt], s * 0.05, mat, -s * 0.6));
        }
      }
    }
    return { eyes, mouth, beakLower, style: f.mouth, eyeLook: f.eyes ?? 'round', groups, mouthAt };
  }

  /** 쉬는 자세가 2D 캔버스 안 바닥에 서도록 카메라와 옮길 자리를 정한다 */
  private frameCamera() {
    this.root.rotation.set(0, 0, 0);
    this.root.scale.set(1, 1, 1);
    this.root.updateMatrixWorld(true);
    const b = new Box3().setFromObject(this.root);
    const c = b.getCenter(new Vector3());
    const radius = b.getSize(new Vector3()).length() / 2;
    this.restX = c.x;
    // 쉬는 몸이 화면의 절반쯤: 뛰고 팔을 들어도 잘리지 않는 여유
    const fov = (this.camera.fov * DEG) / 2;
    const dist = radius / (0.5 * Math.tan(fov));
    // 맞추기는 늘 기울이지 않은 자리에서 (기울기는 다음 draw 에서 다시 넣는다)
    this.orbit = { c, dist, tilt: 0 };
    this.aim(0);
    this.camera.updateProjectionMatrix();
    let minX = 1;
    let maxX = -1;
    let minY = 1;
    let maxY = -1;
    for (const x of [b.min.x, b.max.x])
      for (const y of [b.min.y, b.max.y])
        for (const z of [b.min.z, b.max.z]) {
          const p = new Vector3(x, y, z).project(this.camera);
          minX = Math.min(minX, p.x);
          maxX = Math.max(maxX, p.x);
          minY = Math.min(minY, p.y);
          maxY = Math.max(maxY, p.y);
        }
    const d = Math.min(FIT_H / ((maxY - minY) / 2), FIT_W / ((maxX - minX) / 2));
    this.fit = { d, cx: (minX + maxX) / 2, bottom: minY, halfW: (maxX - minX) / 2 };
    // 숫자가 깨지면(빈 몸 등) 그리지 않고 2D 로 돌아간다
    if (!Object.values(this.fit).every(Number.isFinite) || d <= 0) this.ready = false;
  }

  /** 카메라를 몸 가운데에서 dist 만큼, 살짝 위(9도)에 tilt 를 더한 높이에 둔다 */
  private aim(tilt: number) {
    const { c, dist } = this.orbit;
    const el = 9 * DEG + tilt;
    this.camera.position.set(c.x, c.y + dist * Math.sin(el), c.z + dist * Math.cos(el));
    this.camera.lookAt(c);
    this.camera.updateMatrixWorld(true);
    this.orbit.tilt = tilt;
  }

  /** 펫을 바꿀 때 옛 모양을 GPU 에서 내린다. 색별 재질은 다음 펫이 다시 쓴다 */
  private disposeTree(o: Object3D) {
    const kept = new Set(this.materials.values());
    o.traverse((c) => {
      if (!(c instanceof Mesh)) return;
      c.geometry.dispose();
      for (const m of [c.material].flat() as Material[]) if (!kept.has(m)) m.dispose();
    });
  }

  // ---- 자세 ----

  /** 입체 판은 관절이 없어 몸 전체를 살짝 돌리고 기울인다. 옆이 보이지 않게 25도까지 */
  private poseRelief(s: DrawState, sx: number, sy: number, act: Act) {
    this.root.scale.set(sx, sy, sx);
    let y = 0;
    let z = 0;
    let x = 0;
    // 같이 보기 중(peer)에는 삐져도 그쪽을 본다
    if (s.mood === 'sulky' && !s.peer) y = 0.42;
    if (s.mood === 'sleeping' || s.mood === 'dozing') x = 0.12;
    if (s.mood === 'grabbed') z = 0.08;
    if (s.mood === 'thinking') z = 0.06;
    if (act?.type === 'walk') {
      y = act.dir * 0.35;
      z = Math.sin(act.phase * Math.PI * 2) * 0.05;
    } else if (act?.type === 'look') y = act.dir * 0.4;
    const g = gazeOf(s, act);
    if (g) {
      y = g.x * 0.3;
      x = -g.y * 0.08;
    }
    // 입체 판은 옆이 안 보이게 돌기만: 손 흔들기는 까딱, 빙글 춤은 크게 좌우로
    const trick = trickOf(s);
    if (trick?.type === 'wave') z = waveSwing(trick.t) * 0.08;
    if (trick?.type === 'dance') y = danceTilt(trick.t) * 1.7;
    // 제자리 몸짓: 입체 판도 몸 전체만 (돌기, 기울이기, 숙이기)
    const mv = movePoseOf(act, s.calm);
    if (mv) {
      y += mv.look * 0.3 + mv.twist * 0.6;
      z -= mv.turn + mv.tilt * 0.5;
      x += mv.pitch * 0.5;
    }
    const max = 0.44;
    this.root.rotation.set(x, Math.max(-max, Math.min(max, y + this.spin * 0.4)), z);
  }

  private pose(s: DrawState, sx: number, sy: number, act: Act) {
    if (this.relief) {
      this.poseRelief(s, sx, sy, act);
      return;
    }
    const j = this.joints;
    for (const slot of SLOTS) j[slot].rotation.set(0, 0, 0);
    if (this.wavePaw) this.wavePaw.visible = false;
    for (const leg of this.quad?.legs ?? []) {
      leg.g.position.copy(leg.base);
      leg.g.scale.set(1, 1, 1);
      // 들려 있으면 본뜬 뒷발도 앞발처럼 늘어진다
      leg.g.rotation.set(leg.synth && s.mood === 'grabbed' ? 0.3 : 0, 0, 0);
    }
    const mo = this.quad?.morph;
    if (mo) {
      mo.torso.position.copy(mo.torsoBase);
      mo.torso.scale.set(1, 1, 1);
      this.joints.head.position.copy(mo.headBase);
      this.joints.tail.position.copy(mo.tailBase);
    }
    this.root.rotation.set(0, 0, 0);
    this.root.position.set(0, 0, 0);
    this.root.scale.set(sx, sy, sx);
    const { mood, elapsed: e } = s;
    // 몸짓 세기 (설계도 motion): 흔들기(sway), 꼬리(tail), 귀(ear). 1 이면 기본 동작 그대로
    const { sway, tail, ear } = this.motion;
    const head = (x: number, y: number, z: number) => {
      if (this.hasHead) j.head.rotation.set(x, y, z);
      else this.root.rotation.set(x * 0.4, this.root.rotation.y + y * 0.6, z * 0.5);
    };
    const arms = (z: number, x = 0) => {
      j.armL.rotation.set(x, 0, -z);
      j.armR.rotation.set(x, 0, z);
    };
    const wings = (z: number) => {
      j.wingL.rotation.z = -z;
      j.wingR.rotation.z = z;
    };
    // 삐지면 고개를 돌린다 (얼굴이 보이게 옆으로만)
    if (mood === 'sulky' && !s.peer) this.root.rotation.y = 0.8;
    this.root.rotation.y += this.spin;
    let eye: EyeState = 'open';
    let mouth: MouthState = s.hungry && mood === 'idle' ? 'wavy' : 'smile';
    switch (mood) {
      case 'excited': {
        const w = Math.sin(e / 90);
        arms(2.2 - w * 0.35 * sway);
        wings(0.9 + w * 0.3 * sway);
        j.earL.rotation.z = w * 0.15 * ear;
        j.earR.rotation.z = -w * 0.15 * ear;
        j.tail.rotation.y = w * 0.5 * tail;
        j.top.rotation.z = w * 0.2 * sway;
        eye = 'up';
        break;
      }
      case 'grabbed':
        arms(1.0);
        wings(0.8);
        j.legL.rotation.x = 0.3;
        j.legR.rotation.x = 0.3;
        j.tail.rotation.x = 0.4;
        eye = 'chevron';
        mouth = 'open';
        break;
      case 'sleeping':
      case 'dozing':
        head(0.28, 0, 0);
        j.earL.rotation.z = 0.25;
        j.earR.rotation.z = -0.25;
        j.top.rotation.z = 0.3;
        eye = mood === 'sleeping' ? 'down' : 'half';
        mouth = 'o';
        break;
      case 'thinking':
        head(0, 0, 0.2);
        j.armR.rotation.set(-0.9, 0, 0.9);
        j.top.rotation.z = Math.sin(e / 400) * 0.15;
        mouth = 'flat';
        break;
      case 'busy':
        mouth = 'flat';
        break;
      case 'talking':
        mouth = 'open';
        break;
      case 'sulky':
        mouth = 'frown';
        break;
    }
    if (act?.type === 'walk' && this.quad) {
      this.walkQuad(this.quad, act);
    } else if (act?.type === 'walk') {
      const w = Math.sin(act.phase * Math.PI * 2);
      this.root.rotation.y = act.dir * 0.75;
      j.legL.rotation.x = w * 0.7;
      j.legR.rotation.x = -w * 0.7;
      j.armL.rotation.x = -w * 0.6 * sway;
      j.armR.rotation.x = w * 0.6 * sway;
      j.tail.rotation.y = w * 0.35 * tail;
      j.top.rotation.z = w * 0.12 * sway;
    } else if (act?.type === 'look') {
      head(0, act.dir * 0.55, 0);
    } else if (act?.type === 'sit') {
      // 앉는 정도 (처음에 앉고 끝에 일어난다)
      const down = act.down ?? 1;
      j.legL.rotation.x = -1.2 * down;
      j.legR.rotation.x = -1.2 * down;
      j.tail.rotation.y = 0.6 * down;
    } else if (act?.type === 'yawn') {
      const k = Math.sin(Math.min(1, act.t) * Math.PI);
      head(-0.3 * k, 0, 0);
      arms(1.3 * k);
      wings(0.6 * k);
      if (act.t > 0.15 && act.t < 0.85) {
        eye = 'down';
        mouth = 'yawn';
      }
    } else if (act?.type === 'stretch') {
      const k = Math.sin(Math.min(1, act.t) * Math.PI);
      arms(2.6 * k);
      wings(1.3 * k);
      eye = 'up';
    }
    // 제자리 몸짓 (꼬리 흔들기, 귀 쫑긋, 몸 털기, 점프, 뒹굴기 등. move-pose.ts).
    // 꼬리, 귀, 다리, 팔은 설계도에 그 부위가 있을 때만 보인다 (없는 관절은 빈 묶음이라 돌려도 아무것도 없다)
    const mv = movePoseOf(act, s.calm);
    let wide = false;
    if (mv) {
      head(mv.pitch, mv.look * 0.6, -mv.tilt);
      // 몸 털기는 세로축으로 비틀고, 꼬리를 흔들 땐 꼬리 쪽이 보이게 살짝 돈다 (꼬리는 몸 뒤에 있다)
      this.root.rotation.y += mv.look * 0.15 + mv.twist + (act?.type === 'wag' ? -0.6 * mv.tailOut : 0);
      // 발을 구를 때는 든 발 반대쪽으로 몸무게를 옮긴다
      this.root.rotation.z -= mv.turn + (mv.legs[1] - mv.legs[0]) * 0.12;
      j.earL.rotation.z = mv.ears[0] * ear;
      j.earR.rotation.z = -mv.ears[1] * ear;
      // 꼬리는 위로 선 채 좌우로 (몸 뒤에서 옆으로 끝이 보이게)
      j.tail.rotation.set(0, mv.tail * 0.6 * tail, -mv.tail * 1.3 * tail);
      j.legL.rotation.x = -mv.legs[0] * 0.9;
      j.legR.rotation.x = -mv.legs[1] * 0.9;
      if (mv.arms > 0) {
        arms(mv.arms * 2.2);
        wings(mv.arms * 0.9);
      }
      if (mv.eyes) eye = MOVE_EYE[mv.eyes];
      if (mv.mouth) mouth = mv.mouth;
      wide = mv.eyes === 'wide';
      // 뒹굴면 몸이 옆으로 눕는다: 바닥에 닿고 제자리(가운데)에 있게 옮긴다
      if (Math.abs(mv.turn) > 0.01) this.groundRoot();
    }
    // 친밀도로 열린 몸짓: 손 흔들기는 오른팔(날개)을 들고 흔든다, 빙글 춤은 한 바퀴 돈다
    const trick = trickOf(s);
    if (trick?.type === 'wave') {
      const sw = waveSwing(trick.t);
      const up = Math.min(1, trick.t * 5, (1 - trick.t) * 5);
      if (this.hasHand) {
        j.armR.rotation.set(0, 0, 2.8 + sw * 0.35);
        // 날개는 몸에 붙은 채 위로 작게 파닥 (크게 펼치면 납작한 노처럼 보였다)
        j.wingR.rotation.z = 0.1 + up * (0.1 + (0.5 + 0.5 * sw) * 0.22);
      } else if (this.wavePaw) {
        // 어깨에서 앞발을 들어 바깥 위로 흔든다 (음수 z 가 바깥쪽)
        this.wavePaw.visible = true;
        this.wavePaw.rotation.set(0, 0, -(0.55 + (1 - up) * 1.9) + sw * 0.35);
      }
      // 고개와 귀도 같이 까딱
      head(0, 0, sw * 0.1 * sway);
      j.earL.rotation.z = sw * 0.3 * ear;
      j.earR.rotation.z = -sw * 0.3 * ear;
      j.tail.rotation.y = sw * 0.6 * tail;
      eye = 'up';
    } else if (trick?.type === 'dance') {
      // 한 바퀴: 앞을 오래 보고 등은 빨리 지나가게 (가운데서 가장 빠르게)
      const e = trick.t < 0.5 ? 4 * trick.t ** 3 : 1 - (-2 * trick.t + 2) ** 3 / 2;
      this.root.rotation.y += e * Math.PI * 2;
      this.root.rotation.z = danceTilt(trick.t) * 0.5 * sway;
      arms(1.8);
      // 날개는 몸에 붙은 채 빠르게 파닥
      wings(0.12 + 0.2 * (0.5 + 0.5 * Math.sin(trick.t * Math.PI * 10)));
      eye = 'up';
    }
    // 커서 바라보기: 고개를 그쪽으로 (위를 보면 고개를 든다)
    const g = gazeOf(s, act);
    // 양수 x 가 고개를 숙이는 쪽 (잘 때 0.28). 아래는 조금만 숙인다 (많이 숙이면 눈이 찡그린 듯 납작해 보였다)
    if (g) head(g.y > 0 ? g.y * 0.12 : g.y * 0.22, g.x * 0.5, 0);
    this.setFace(eye, mouth, s, wide);
    // 옆이나 뒤로 돌아 안 보이는 얼굴 부품은 숨긴다 (가장자리에 조각처럼 떠 보였다). 부리는 옆에서도 보인다.
    // 얼굴 전체가 아니라 부품마다 겉면이 향한 쪽으로 본다: 옆모습에서 가까운 눈과 볼은 보이고 먼 쪽만 숨는다
    // (펫 만들기 미리보기에서 360도 돌릴 때 옆얼굴이 밋밋한 공처럼 보였다)
    if (this.face) {
      this.root.updateMatrixWorld(true);
      const { at, n, eye } = this.faceTmp;
      for (const g2 of this.face.groups) {
        g2.getWorldPosition(at);
        n.setFromMatrixColumn(g2.matrixWorld, 2).normalize();
        const facing = n.dot(eye.copy(this.camera.position).sub(at).normalize());
        g2.visible = facing > 0.25 || (g2 === this.face.mouthAt && this.face.style === 'beak');
      }
    }
  }

  /** 누운 몸을 바닥(y=0)에 붙이고 쉬는 자세의 가운데로 옮긴다 (뒹굴기) */
  private groundRoot() {
    this.root.updateMatrixWorld(true);
    this.box.setFromObject(this.root);
    this.box.getCenter(this.tmp);
    this.root.position.set(this.restX - this.tmp.x, -this.box.min.y, 0);
  }

  /**
   * 네 발 걷기: 가는 쪽으로 돌아서 몸을 앞으로 숙이고(고개는 들어 앞을 본다), 대각선 쌍으로 번갈아 딛는다.
   * 출발할 때 돌고 숙이며, 멈출 때 다시 앞을 보고 일어난다 (pet3d-gait.ts walkEnvelope).
   * 숙인 만큼 앞발 관절은 내려가고 뒷발 관절은 올라가니 다리마다 높이를 되돌려 발이 바닥에 붙어 있게 한다
   */
  private walkQuad(q: QuadRig, act: Extract<Act, { type: 'walk' }>) {
    const j = this.joints;
    const { sway, tail, ear } = this.motion;
    const env = walkEnvelope(act.along, act.ms);
    const lean = q.lean * env.lean;
    const a = act.phase * Math.PI * 2;
    const go = env.stride;
    this.root.rotation.y = act.dir * 1.1 * env.turn + this.spin;
    j.body.rotation.x = lean;
    // 걸음마다 엉덩이를 살짝 좌우로
    j.body.rotation.z = Math.sin(a) * 0.05 * sway * go;
    // 네 발 자세로 바꾸기 (숙이는 정도를 따라 들어가고 풀린다)
    const m = q.morph;
    const k = env.lean;
    let front = 0;
    let hind = 0;
    if (m) {
      const { depth: d, height: h } = m;
      m.torso.scale.set(1, 1 - 0.14 * k, 1 + 0.45 * k);
      m.torso.position.set(m.torsoBase.x, m.torsoBase.y - 0.05 * h * k, m.torsoBase.z - 0.16 * d * k);
      j.head.position.set(m.headBase.x, m.headBase.y - 0.16 * h * k, m.headBase.z + 0.16 * d * k);
      j.tail.position.set(m.tailBase.x, m.tailBase.y - 0.03 * h * k, m.tailBase.z - 0.3 * d * k);
      front = 0.08 * d * k;
      hind = -0.3 * d * k;
    }
    // 고개는 숙인 만큼 들고, 보는 사람 쪽으로 돌린다 (옆으로 걸어도 얼굴이 보이게)
    if (this.hasHead)
      j.head.rotation.set(
        -lean * 0.9 + Math.sin(a * 2) * 0.035 * go,
        -act.dir * 0.42 * env.turn,
        -Math.sin(a) * 0.04 * sway * go,
      );
    const c = Math.cos(lean);
    const sn = Math.sin(lean);
    for (const leg of q.legs) {
      const step = trotLeg(leg.id, act.phase);
      const z = step.dz * q.stride * go;
      const hz = leg.hip.z + (leg.id[0] === 'f' ? front : hind);
      // 숙여서 관절이 올라간 다리(뒷발)는 내리지 않고 늘여 바닥에 닿게 한다 (내리면 몸과 발 사이가 뜬다)
      const back = -hipRise(leg.hip.y, hz, lean);
      const reach = Math.max(0, -back);
      leg.g.scale.set(1, (leg.drop + reach) / Math.max(0.01, leg.drop), 1);
      const rise = Math.max(0, back) + step.lift * q.lift * go;
      // 긴 다리는 관절에서 돌려 딛고, 짧은 발은 앞뒤로 옮긴다
      const long = leg.drop >= 0.18;
      const fz = long ? 0 : z;
      // 몸이 숙어 있으니 세상 기준 위(rise)와 앞(fz)을 부모(몸) 좌표로 돌려 넣는다
      leg.g.position.set(
        leg.base.x,
        leg.base.y + rise * c + fz * sn,
        leg.base.z + hz - leg.hip.z - rise * sn + fz * c,
      );
      leg.g.rotation.x =
        -lean - (long ? Math.asin(Math.max(-1, Math.min(1, z / leg.drop))) : step.lift * 0.35 * go);
    }
    // 꼬리는 뒤로 조금 눕혀 살랑 (곧게 세우면 옆에서 볼 때 든 팔처럼 보였다)
    j.tail.rotation.set(-lean * 0.5 - 0.2 * k, Math.sin(a) * 0.45 * tail * (0.4 + 0.6 * go), 0);
    j.earL.rotation.z = Math.sin(a * 2) * 0.06 * ear * go;
    j.earR.rotation.z = -Math.sin(a * 2) * 0.06 * ear * go;
    j.top.rotation.z = Math.sin(a) * 0.1 * sway * go;
  }

  private setFace(eye: EyeState, mouth: MouthState, s: DrawState, wide = false) {
    const f = this.face;
    if (!f) return;
    const open = s.blink >= 0 ? Math.abs(1 - 2 * s.blink) : 1;
    // 쉬는 눈 모양 (설계도 face.eyes, pet3d-motion.ts)
    const shown = restingEye(eye, f.eyeLook);
    for (const e of f.eyes) {
      for (const [k, o] of Object.entries(e.states)) o.visible = k === shown;
      const small = s.mood === 'busy' ? 0.8 : wide ? 1.15 : 1;
      e.open.scale.set(small, small * Math.max(0.08, open), small);
    }
    if (f.style === 'beak') {
      if (f.beakLower) f.beakLower.rotation.x = mouth === 'open' || mouth === 'yawn' ? 0.55 : 0;
      return;
    }
    for (const [k, o] of Object.entries(f.mouth)) o.visible = k === mouth;
  }
}

/** 얼굴에 붙인 무리 g 안에서 화면 위쪽(세계 +y)이 향하는 각도. 자식을 이만큼 z 로 돌리면 수평이 된다 */
function levelRoll(g: Object3D): number {
  const up = new Vector3(0, 1, 0).applyQuaternion(g.getWorldQuaternion(new Quaternion()).invert());
  return Math.atan2(-up.x, up.y);
}

/** 반원 고리: down 이면 ∪ (웃는 입, 감은 눈), 아니면 ∩ */
function arc(radius: number, tube: number, mat: Material, down: boolean): Mesh {
  const m = new Mesh(new TorusGeometry(radius, tube, 8, 24, Math.PI), mat);
  if (down) m.rotation.z = Math.PI;
  return m;
}

/** 얼굴 평면(xy) 위의 짧은 막대. z 로 조금 앞뒤 */
function stroke(a: [number, number], b: [number, number], r: number, mat: Material, z = 0): Mesh {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  const m = new Mesh(new CapsuleGeometry(r, Math.max(0.0001, len), 4, 8), mat);
  m.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, z);
  m.rotation.z = Math.atan2(dy, dx) - Math.PI / 2;
  return m;
}

/** 알파(0~255 RGBA 의 A)를 0~1 로 읽어 상자 흐림을 r 칸 준다. 입체 판 가장자리를 둥글게 부풀릴 때 쓴다 */
function blurAlpha(rgba: Uint8ClampedArray, cols: number, rows: number, r: number): Float32Array {
  const a = new Float32Array(cols * rows);
  for (let i = 0; i < a.length; i++) a[i] = (rgba[i * 4 + 3] ?? 0) / 255;
  const tmp = new Float32Array(a.length);
  // 가로, 세로 두 번 (분리 가능한 상자 흐림)
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      let sum = 0;
      for (let k = -r; k <= r; k++) sum += a[y * cols + Math.min(cols - 1, Math.max(0, x + k))] ?? 0;
      tmp[y * cols + x] = sum / (2 * r + 1);
    }
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      let sum = 0;
      for (let k = -r; k <= r; k++) sum += tmp[Math.min(rows - 1, Math.max(0, y + k)) * cols + x] ?? 0;
      a[y * cols + x] = sum / (2 * r + 1);
    }
  return a;
}
