// 입체 펫 (6단계). 설계도(blueprint)를 three.js 로 조립해 따로 둔 WebGL 캔버스에 그리고, 그 그림을 펫 2D 캔버스에 옮긴다.
// 그래서 픽셀로 하는 마우스 판정, 말풍선, 하트, Zz 는 2D 펫과 똑같이 돈다.
// 그리기는 2D 와 같은 때만 한다(정지 상태는 한 번). 계속 돌리지 않는다 (L10).
import {
  BackSide,
  Box3,
  BufferAttribute,
  type BufferGeometry,
  CanvasTexture,
  CapsuleGeometry,
  CatmullRomCurve3,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DataTexture,
  DirectionalLight,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  HemisphereLight,
  LatheGeometry,
  type Material,
  Matrix3,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  MeshToonMaterial,
  NearestFilter,
  NeutralToneMapping,
  type Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Quaternion,
  Raycaster,
  RepeatWrapping,
  Scene,
  Shape,
  SphereGeometry,
  SRGBColorSpace,
  type Texture,
  TorusGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { WALK_SPEED } from '../../shared/behavior.ts';
import {
  type Blueprint,
  type EyeLook,
  expandParts,
  type Face,
  type Finish,
  type Fur,
  inFace,
  type Part,
  type Pattern,
  SLOTS,
  type Slot,
  type Vec3,
} from '../../shared/pet3d/blueprint.ts';
import { PATTERN_GLSL, patternMask, patternUniforms } from '../../shared/pet3d/pattern.ts';
import type { PetStyle } from '../../shared/settings.ts';
import {
  type DrawState,
  danceTilt,
  energyFace,
  gazeOf,
  type Model3D,
  movePoseOf,
  noteOf,
  sulkStage,
  tapOf,
  trickOf,
  waveSwing,
  workOf,
} from './draw.ts';
import { Eased } from './motion-ease.ts';
import type { MoveEyes } from './move-pose.ts';
import { hopScale, movePeak } from './move-pose.ts';
import {
  addShells,
  bumpFurSteps,
  fluffBaseMaterial,
  fluffLayers,
  fluffLength,
  fluffShellMaterial,
  fluffTexture,
  fusedGeometry,
  paintGeometry,
} from './pet3d-fluff.ts';
import {
  coverFur,
  type FuseClear,
  type FuseCover,
  type FusedMesh,
  type FusePart,
  type FuseShape,
  fuseSteps,
} from './pet3d-fuse.ts';
import {
  bipedFoot,
  gaitOf,
  hindFrom,
  hipRise,
  type LegId,
  legCut,
  legGap,
  trotLeg,
  walkEnvelopeOf,
} from './pet3d-gait.ts';
import { bounced, type EyeState, faceDepth, keepsFaceDepth, restingEye } from './pet3d-motion.ts';
import { filletSphere, neckPair } from './pet3d-neck.ts';
import { type FootOut, FootPlanter } from './pet3d-plant.ts';
import {
  type BodyPose,
  blendPose,
  CALM_EXCITEMENT,
  DUTY,
  type Excitement,
  excitement,
  footCycle,
  footPhase,
  type GaitKind,
  gaitFor,
  gaitPhase,
  liePose,
  type Pt,
  pitchAbout,
  type StanceDims,
  type StanceGoal,
  segAngle,
  sitPose,
  solveLeg,
  stanceGoal,
} from './pet3d-stance.ts';
import {
  buildKeyboard,
  HANDS,
  type Keyboard3D,
  pawTarget,
  pawTip,
  poseKeyboard,
  reachPaw,
  type TapRig,
  tapRigOf,
} from './pet3d-tap.ts';
import { eyedPhoto, photoEyeOpen } from './photo-eyes.ts';
import { photoStep, TurnWatch, turnSquash } from './photo-motion.ts';
import { neckRow } from './relief-warp.ts';
import { tapPaws } from './together-draw.ts';
import { strideLen } from './walk-pace.ts';

const CX = 80;
const GROUND = 154;
/** 돌아서기 빠르기 (ms, 1/e 시간: 세 배쯤이면 다 돈다) */
const HEADING_TAU = 90;
/** 걷기가 끝난 뒤 다리와 숙인 몸이 풀리는 빠르기 */
const WALK_OUT_TAU = 80;
/** 네 발로 선 몸이 도는 가장 빠른 빠르기 (라디안/초). 더 빨리 돌면 발을 옮겨 디딜 틈이 없어 다리가 꼬인다 */
const STANCE_TURN_RATE = 2.5;
/** 네 발로 선 몸의 한 걸음(네 발이 한 번씩) 거리 (다리 길이 배). 디딘 발이 다리가 닿는 곳 안에 있게 */
const STANCE_CYCLE = 0.95;
/** 앉으면 머리를 가슴 쪽으로 내리는 만큼 (다리 길이 배): 아래로, 앞으로 */
const HEAD_SINK = { down: 0.25, fwd: 0.1 };
/** 쉬는 자세의 펫이 2D 캔버스(160)에서 차지할 최대 키와 너비 */
const FIT_H = 118;
const FIT_W = 140;
const DEG = Math.PI / 180;
const INK = '#1f2328';
/** 게임 모습 테두리 선 색 (짙은 고동) */
const OUTLINE = '#4a3328';

type Act = DrawState['activity'];
type MouthState = 'smile' | 'open' | 'yawn' | 'o' | 'flat' | 'frown' | 'wavy';
/** 몸짓 눈 (move-pose.ts) → 입체 눈. 동그랗게(wide)는 뜬 눈을 조금 키운다 */
const MOVE_EYE: Record<MoveEyes, EyeState> = { closed: 'down', happy: 'up', half: 'half', wide: 'open' };

interface FaceRig {
  /** brow 는 처진 눈썹(졸림, 녹초), shade 는 눈 밑 그늘(녹초). 기운 (shared/energy.ts) */
  eyes: {
    side: -1 | 1;
    states: Record<EyeState, Object3D>;
    open: Object3D;
    heavy: Object3D;
    brow: Object3D;
    shade: Object3D;
  }[];
  mouth: Partial<Record<MouthState, Object3D>>;
  beakLower?: Object3D;
  style: Face['mouth'];
  /** 쉬는 눈 모양 (설계도 face.eyes) */
  eyeLook: EyeLook;
  /** 얼굴에 붙인 것들 (눈, 입, 볼, 수염). 옆으로 돌아 얼굴이 안 보일 때 숨긴다 */
  groups: Group[];
  /** 입 자리 (부리는 옆에서도 보여서 숨기지 않는다) */
  mouthAt: Group;
  /** 코 자리 (설계도 face.nose). 주둥이 끝에 솟아 있어 옆모습에서도 보인다 */
  noseAt?: Group;
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

/** 네 발로 선 몸의 다리 하나 (pet3d-stance.ts): 엉덩이(어깨) 관절 아래 윗마디, 무릎 관절 아래 아랫마디와 발 */
interface StanceLeg {
  id: LegId;
  front: boolean;
  hipG: Group;
  kneeG: Group;
  /** 발목 관절 (발을 매단다). 디딘 발은 바닥에 판판하게, 드는 발은 발끝을 굽힌다 */
  pawG: Group;
  /** 쉬는 자리 (root 기준): 엉덩이 관절, 발 가운데 */
  hip: Vector3;
  foot: Vector3;
  /** 발 가운데에서 발목까지 (발이 판판하면 그대로다). 다리는 발목을 바랄 자리에 둔다 */
  toAnkle: Vector3;
  /** 발 바닥 자리 (발목 관절 기준) */
  sole: Vector3;
  l1: number;
  l2: number;
  /** 쉬는 자세의 윗마디, 아랫마디 각 (곧장 아래에서 앞으로) */
  rest1: number;
  rest2: number;
}

interface StanceRig {
  legs: StanceLeg[];
  dims: StanceDims;
  /** 몸 관절 쉬는 자리 (root 기준) */
  pivot: Vector3;
  /** 앉은 자세, 엎드린 자세 */
  sit: BodyPose;
  lie: BodyPose;
  /** 다리 길이 (앞다리 두 마디 합). 걸음 크기와 발 드는 높이의 기준 */
  leg: number;
  /** 귀가 늘어진 귀인지 (관절이 위에 있다) */
  floppy: boolean;
  /** 쉬는 자리: 머리, 꼬리 관절 */
  headBase: Vector3;
  tailBase: Vector3;
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
  /** 같이 타자 치기: 앞발을 옮길 자리와 키보드 자리 (pet3d-tap.ts), 만든 입체 키보드 */
  private tapRig: TapRig | undefined;
  private keys: Keyboard3D | undefined;
  /** 네 발 걷기 (설계도 gait, pet3d-gait.ts). 두 발 펫이면 undefined */
  private quad: QuadRig | undefined;
  /**
   * 피규어 모습에서 털(fuzzy) 부품 겉에 새긴 털 결: curl 곱슬 뭉치(초코), long 아래로 빗은 긴 털 결(밀크).
   * 네 발로 선 몸의 설계도만 (예전 펫 모습은 그대로)
   */
  private sculpt: 'curl' | 'long' | undefined;
  /** 네 발로 선 몸 (설계도 stance, pet3d-stance.ts). 아니면 undefined */
  private stance: StanceRig | undefined;
  /** 실사 털 길이 배율 (네 발로 선 몸은 설계도 털 길이를 따른다) */
  private furK = 1;
  /** 네 발로 선 몸이 고양이인지 (고양이 입이나 수염): 발가락이 보이는 발, 고양이다운 신남 */
  private stanceToes = false;
  /** 네 발로 선 몸: 마지막으로 걸은 때와 쪽 (걷고 나서 잠깐 서 있다가 앉는다, 몸을 그쪽으로 조금 돌린다) */
  private walkedAt = Number.NEGATIVE_INFINITY;
  private walkedDir: -1 | 1 = 1;
  /** 네 발로 선 몸의 발 딛기 (디딘 발을 바닥에 붙여 두고 옮겨 딛는다, pet3d-plant.ts) */
  private planter = new FootPlanter();
  /** 지난 틀까지 걸은 걸음 수 (이번 틀에 간 거리를 셀 때) */
  private plantSteps: number | undefined;
  /** 지난 틀의 발 딛기 답 (점검용 debugFeet) */
  private lastFeet: Record<LegId, FootOut> | undefined;
  /** 카메라를 맞추려고 자세를 재는 중 (앉아 내린 머리는 빼고 잰다: 그림 크기가 그대로) */
  private fitting = false;
  /** 이번 틀의 신남 몸짓 (네 발로 선 몸, pet3d-stance.ts excitement) */
  private excite: Excitement = CALM_EXCITEMENT;
  private face: FaceRig | undefined;
  /** 마지막으로 그린 자리 (2D 캔버스 좌표). 같이 보기 돋보기가 눈 자리를 찾을 때 쓴다 */
  private drawn: { x0: number; y0: number; d: number } | undefined;
  /** 몸짓 세기 (설계도 motion). 1 이 기본 동작 */
  private motion = { bounce: 1, sway: 1, tail: 1, ear: 1 };
  /**
   * 짧게 따라가는 자세 값 (motion-ease.ts): 몸이 향한 쪽(heading), 두리번 고개(lookYaw), 걷기 세기(walk).
   * 펫 화면이 이어 그릴 때만 따라가고 얼굴 아이콘처럼 한 장 그릴 때는 바로 목표값
   */
  private ease = new Eased();
  /** 두 발 걷기에서 몸만 들썩이는 높이 (160 캔버스 px). 다리는 그만큼 내려 디딘 발이 바닥에 그대로 있다 */
  private bodyBob = 0;
  /** 다리 관절이 있는 몸인지 (두 발 걷기 들썩임을 몸에만 줄지) */
  private hasLegs = false;
  /** 2.5D 판이 걷다 돌아서는 때 (photo-motion.ts) */
  private reliefTurn = new TurnWatch();
  /** 2.5D 판이 돌아서는 중인지 (끝날 때까지 촘촘히 그린다) */
  private turning = false;
  /** 마지막 걸음 (걷기가 끝난 뒤 다리와 숙인 몸을 짧게 풀 때 쓴다) */
  private lastWalk: { dir: -1 | 1; phase: number; stride?: number; steps?: number } | undefined;
  /** 이번 틀에 몸을 띄운 높이 (160 캔버스 px). 네 발로 선 몸은 뛰는 동안 발을 몸 쪽으로 접는다 */
  private air = 0;
  /** 몸 1 단위가 정면에서 2D 캔버스(fit.d = 2)에서 차지하는 길이 비율 (NDC). 보폭을 간 거리에 맞출 때 */
  private unitNdc = 0;
  /** 그릴 것이 있는지 (설계도나 입체 판을 넣었는지) */
  private ready = false;
  /** 2.5D 입체 판 (사진 + 깊이). 있으면 관절 대신 몸 전체만 기울인다 */
  private relief:
    | {
        texture: CanvasTexture;
        /** 그림 휘기 값 (숨쉬기 -1~1, 머리 기울기 라디안). 셰이더가 읽는다 */
        warp: { uBreath: { value: number }; uTilt: { value: number } };
        /** 붙인 그림과 그 캔버스. 눈 자리를 아는 그림(밀크, 초코)은 감은 만큼 다시 그린다 (photo-eyes.ts) */
        photo: CanvasImageSource & { width: number; height: number };
        canvas: HTMLCanvasElement;
        open: number;
      }
    | undefined;
  /** 쉬는 자세가 화면(NDC)에서 차지하는 자리로 정한 2D 그림 크기와 위치 */
  private fit = { d: 160, cx: 0, bottom: -1, halfW: 0.5 };
  /** 맞춘 크기 (fit.d 는 여기에 나이 배율을 곱한 값) */
  private fitD = 160;
  /** 나이 배율 (AI 일러스트 펫, shared/illustrate.ts ageScale). 발은 바닥(GROUND)에 그대로 */
  private sizeK = 1;
  private px = 0;
  private lost = false;
  private readonly materials = new Map<string, Material>();
  /** 모습 (setStyle). figure 비닐 피규어, game 셀 셰이딩과 테두리, real 털 껍질과 유리 눈 */
  private style: PetStyle = 'figure';
  private get real(): boolean {
    return this.style === 'real';
  }
  private get game(): boolean {
    return this.style === 'game';
  }
  /** 복슬복슬 (시험판): 부품을 녹여 붙인 한 덩어리 몸에 긴 털 (pet3d-fuse.ts, pet3d-fluff.ts) */
  private get fluffy(): boolean {
    return this.style === 'fluffy';
  }
  /** 털 있는 모습 (실사, 복슬복슬): 유리알 눈, 볼 터치 없음, 따뜻한 빛 */
  private get furry(): boolean {
    return this.real || this.fluffy;
  }
  /** 복슬복슬 가닥 그림. 처음 쓸 때 만든다 */
  private fluffTex: DataTexture | undefined;
  /** 게임 모습의 명암 단계 그림 (3단). 처음 쓸 때 만든다 */
  private toonRamp: DataTexture | undefined;
  /** 털 무늬(가닥 높이)와 얼룩 그림. 실사로 처음 그릴 때 한 번 만든다 */
  private furTex: { strands: Texture; mottle: Texture } | undefined;
  /** 얼굴 부품을 털 끝 위로 띄울 거리 (실사일 때 얼굴 슬롯 털 길이) */
  private faceLift = 0;
  private readonly lights: { hemi: HemisphereLight; key: DirectionalLight; rim: DirectionalLight };
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
    // 셰이더 컴파일 오류를 프로그램마다 묻지 않는다 (물으면 컴파일이 끝날 때까지 기다려 켤 때 첫 그림이 늦었다).
    // 셰이더는 앱에 든 것뿐이고, 깨지면 그리지 못해 2D 로 돌아가는 길은 그대로다
    this.renderer.debug.checkShaderErrors = false;
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
    const hemi = new HemisphereLight(0xffffff, 0xd9c7b5, 1.1);
    const key = new DirectionalLight(0xffffff, 1.7);
    key.position.set(-1.2, 2.2, 2.4);
    const rim = new DirectionalLight(0xfff4e0, 1.3);
    rim.position.set(1.5, 1.4, -2.2);
    this.scene.add(hemi, key, rim);
    this.lights = { hemi, key, rim };
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
  /**
   * 그리는 해상도 상한(px). 그리는 크기는 펫 크기 × 화면 배율에 맞추고(draw), 이 값은 그 위 상한이다.
   * 레티나에서 300% 로 키운 펫이 약 900px 이라 768 이면 흐렸다 (2026-10-10 검토). 작은 펫은 그대로 작게 그린다.
   * 앱 아이콘, 얼굴 그림은 잠깐 더 크게 그린다
   */
  maxPx = 960;

  get ok(): boolean {
    return !this.lost;
  }

  /**
   * 모습을 바꾼다 (사용자 요청 2026-10-08). 조명은 바로 바뀌고, 털, 테두리, 눈은 다음 조립(setBlueprint)부터.
   * 바뀌었으면 true (부르는 쪽이 다시 조립한다)
   */
  setStyle(style: PetStyle): boolean {
    if (style === this.style) return false;
    this.style = style;
    const { hemi, key, rim } = this.lights;
    if (style === 'game') {
      // 게임 (귀여운 캐릭터 일러스트처럼): 색은 거의 그대로 평평하게, 그늘은 옅은 한 단만.
      // 고르게 밝히는 빛을 세게 두고 주 조명은 그늘 한 단을 만들 만큼만
      this.renderer.toneMapping = NeutralToneMapping;
      this.renderer.toneMappingExposure = 1;
      this.scene.environmentIntensity = 0.3;
      hemi.color.set(0xffffff);
      hemi.groundColor.set(0xffffff);
      hemi.intensity = 2.35;
      key.color.set(0xffffff);
      key.intensity = 0.9;
      rim.color.set(0xffffff);
      rim.intensity = 0;
    } else if (style === 'real' || style === 'fluffy') {
      // 실사: 색이 바래지 않게 중립 톤에 노출만 조금. 주 조명은 따뜻하게, 뒤 테두리 빛을 세게 해 털 끝이 빛나게
      this.renderer.toneMapping = NeutralToneMapping;
      this.renderer.toneMappingExposure = 1.05;
      this.scene.environmentIntensity = 0.4;
      hemi.color.set(0xfff6ea);
      hemi.groundColor.set(0x8c7a68);
      hemi.intensity = 0.9;
      key.color.set(0xfff3e4);
      key.intensity = 2.3;
      rim.color.set(0xfff8ee);
      rim.intensity = 2.2;
    } else {
      this.renderer.toneMapping = NeutralToneMapping;
      this.renderer.toneMappingExposure = 1;
      this.scene.environmentIntensity = 0.55;
      hemi.color.set(0xffffff);
      hemi.groundColor.set(0xd9c7b5);
      hemi.intensity = 1.1;
      key.color.set(0xffffff);
      key.intensity = 1.7;
      rim.color.set(0xfff4e0);
      rim.intensity = 1.3;
    }
    return true;
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
    // 하던 복슬복슬 몸 만들기도 멈춘다 (죽은 렌더러에 계속 만들고 이 객체를 붙잡았다)
    this.fuseToken++;
    this.finishFuse = () => {};
    this.fused.clear();
    this.disposeTree(this.root);
    for (const m of this.materials.values()) m.dispose();
    this.furTex?.strands.dispose();
    this.furTex?.mottle.dispose();
    this.toonRamp?.dispose();
    this.fluffTex?.dispose();
    this.scene.environment?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }

  /** 옛 모양을 내리고 빈 몸을 준비한다 */
  private resetRoot() {
    // 하던 복슬복슬 몸 만들기를 버린다
    this.fuseToken++;
    this.finishFuse = () => {};
    this.version++;
    this.scene.remove(this.root);
    this.disposeTree(this.root);
    this.relief?.texture.dispose();
    this.relief = undefined;
    this.face = undefined;
    this.quad = undefined;
    this.stance = undefined;
    this.walkedAt = Number.NEGATIVE_INFINITY;
    // 새 몸의 발은 옛 몸이 디딘 자리가 아니라 새 몸 바랄 자리에서 시작한다 (걸음 수는 이어 센다: 처음부터 세면
    // 이번 걷기에 간 거리 전부가 한 틀에 들어간다)
    this.planter.reset();
    this.lastFeet = undefined;
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
      const flat = reliefFlatten(cols, rows);
      for (let i = 0; i < pos.count; i++) {
        const d = (dep[i * 4] ?? 0) / 255;
        const a = alpha[i] ?? 0;
        // 깊이(앞뒤 굴곡) + 베개(가장자리에서 안으로 갈수록 부푼다)
        const pillow = a * a * (3 - 2 * a);
        pos.setZ(i, (d * 0.16 + 0.1) * pillow * (flat[i] ?? 1));
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
    // 그림 휘기 (사용자 요청 2026-10-09, AI 로 만든 일러스트를 입체감 있게): 몸통은 숨쉬듯 부풀고,
    // 목 위는 목을 축으로 기운다. 목은 그림에서 몸 너비가 가장 잘록한 줄로 짐작한다 (relief-warp.ts neckRow)
    const neck = h * (1 - neckRow(alpha, cols, rows) / segY);
    const warp = { uBreath: { value: 0 }, uTilt: { value: 0 } };
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, warp, { uNeck: { value: neck }, uH: { value: h } });
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
uniform float uBreath;
uniform float uTilt;
uniform float uNeck;
uniform float uH;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
float jjBody = 1.0 - smoothstep(uNeck - 0.1 * uH, uNeck + 0.15 * uH, transformed.y);
transformed.x *= 1.0 + uBreath * 0.022 * jjBody;
transformed.z *= 1.0 + uBreath * 0.05 * jjBody;
transformed.y *= 1.0 + uBreath * 0.012;
float jjHead = smoothstep(uNeck - 0.05 * uH, uNeck + 0.12 * uH, transformed.y);
vec2 jjQ = transformed.xy - vec2(0.0, uNeck);
float jjA = uTilt * jjHead;
transformed.xy = vec2(0.0, uNeck) + vec2(jjQ.x * cos(jjA) - jjQ.y * sin(jjA), jjQ.x * sin(jjA) + jjQ.y * cos(jjA));`,
        );
    };
    mat.customProgramCacheKey = () => 'jj-relief-warp';
    this.root.add(new Mesh(geo, mat));
    this.relief = { texture, warp, photo, canvas: c, open: 1 };
    this.hasHead = false;
    this.hasLegs = false;
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
    const parts = expandParts(bp.parts);
    const fur = bp.fur;
    this.sculpt =
      bp.stance && (this.style === 'figure' || this.style === 'real') && fur
        ? (fur.curl ?? 0) >= 0.5
          ? 'curl'
          : (fur.length ?? 0) >= 0.6
            ? 'long'
            : undefined
        : undefined;
    this.furK = bp.stance ? 0.75 + 0.75 * (fur?.length ?? 0.5) : 1;
    const meshes = parts.map((p) => ({ part: p, mesh: this.partMesh(p) }));

    // 슬롯마다 부품이 차지하는 상자로 관절 자리를 정한다
    const boxes = new Map<Slot, Box3>();
    for (const { part, mesh } of meshes) {
      // 입는 옷(철마다 옷)은 관절 자리를 바꾸지 않는다 (모자를 써도 고개 돌리는 축이 그대로)
      if (part.wear) continue;
      mesh.updateMatrixWorld(true);
      const b = new Box3().setFromObject(mesh);
      boxes.set(part.slot, boxes.get(part.slot)?.union(b) ?? b);
    }
    this.hasHead = boxes.has('head');
    this.hasLegs = boxes.has('legL') || boxes.has('legR');
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
    // 네 발로 선 몸: 목은 머리 뒤 아래 (앞으로 내민 머리가 목에서 돈다), 늘어진 귀는 위에서 매달려 흔들린다
    const standing = bp.stance === 'stand';
    const headBox = boxes.get('head');
    if (standing && headBox) {
      const c = headBox.getCenter(new Vector3());
      const size = headBox.getSize(new Vector3());
      pivots.head = new Vector3(c.x, headBox.min.y + size.y * 0.3, headBox.min.z + size.z * 0.3);
      for (const ear of ['earL', 'earR'] as const) {
        const b = boxes.get(ear);
        if (!b || b.getCenter(new Vector3()).y >= c.y) continue;
        const ec = b.getCenter(new Vector3());
        pivots[ear] = new Vector3(ec.x, b.max.y - (b.max.x - b.min.x) * 0.4, ec.z);
      }
    }
    // 철마다 옷(목도리 등)의 상자: 타자 칠 때 앞발을 그 앞에 둔다 (옷이 손을 덮지 않게)
    const worn = new Box3();
    for (const { part, mesh } of meshes) if (part.wear) worn.union(new Box3().setFromObject(mesh));
    this.tapRig = tapRigOf(boxes, pivots, worn);
    // body 를 먼저, head 를 다음에 만들어야 자식이 부모를 찾는다 (SLOTS 순서)
    for (const slot of SLOTS) {
      const g = new Group();
      g.name = slot;
      const parent = parentOf(slot);
      g.position.copy(pivots[slot]).sub(parent ? pivots[parent] : new Vector3());
      (parent ? this.joints[parent] : this.root).add(g);
      // 쉬는 자리 (네 발 걷기에서 팔을 앞발 자리로 옮겼다가 되돌린다)
      g.userData.base = g.position.clone();
      // 다리 관절에서 발바닥까지 높이 (두 발 걷기가 다리 길이에 맞춰 딛는다, pet3d-gait.ts bipedFoot)
      const lb = slot === 'legL' || slot === 'legR' ? boxes.get(slot) : undefined;
      if (lb) g.userData.drop = lb.max.y - lb.min.y;
      this.joints[slot] = g;
    }
    for (const { part, mesh } of meshes) {
      mesh.position.sub(pivots[part.slot]);
      this.joints[part.slot].add(mesh);
    }
    // 피규어: 공 머리와 공 몸이 만나는 골을 메워 한 덩어리로 (게임은 겹친 자리 테두리 선이 모습이고, 실사와 복슬복슬은 털이 덮는다)
    if (this.style === 'figure' && !standing) this.filletNeck(meshes);
    this.root.updateMatrixWorld(true);
    const faceSlot = bp.face.slot === 'head' && this.hasHead ? 'head' : 'body';
    this.faceOnHead = faceSlot === 'head';
    // 실사면 눈, 입을 털 끝에 얹는다 (살갗에 붙이면 털에 묻힌다)
    this.faceLift = this.real
      ? Math.max(
          0,
          ...meshes
            .filter((m) => m.part.slot === faceSlot && !m.part.wear)
            .map((m) => furLength(m.part) * this.furK * 0.8),
        )
      : this.fluffy
        ? // 네 발로 선 몸은 얼굴 둘레 털을 깎은 자리에 눈, 코가 앉는다 (털 끝까지 띄우면 옆에서 코가 주둥이 앞에 떠 보였다)
          fluffLength(furOfBlueprint(bp)) * (bp.stance ? 0.35 : 0.8)
        : 0;
    this.face = this.buildFace(
      bp.face,
      this.joints[faceSlot],
      // 눈과 입은 몸에만 붙인다 (목도리 겉에 붙지 않게)
      meshes.filter((m) => m.part.slot === faceSlot && !m.part.wear).map((m) => m.mesh),
      standing,
    );
    this.ready = true;
    this.frameCamera();
    // 옆으로 나온 팔이 없으면 손 흔들 때만 보이는 앞발을 몸 오른쪽 어깨에 붙인다 (카메라 맞춘 뒤라 화면 크기는 그대로)
    this.wavePaw = undefined;
    const bodyOf = meshes.find((m) => m.part.slot === 'body');
    const bodyMesh = bodyOf?.mesh;
    if (!this.hasHand && !standing && bodyBox && bodyOf && bodyMesh) {
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
      // 몸과 같은 겉: 실사는 털 껍질, 게임은 테두리 선 (몸 부품의 털 길이와 색을 따른다)
      if (this.real) this.addFur(paw, { ...bodyOf.part, shape: 'sphere', size: [r, r * 1.35, r] });
      if (this.fluffy) {
        paw.geometry = new SphereGeometry(r, 24, 16);
        paw.scale.set(1, 1.35, 1);
        this.fluffSkin(paw, new Color(bodyOf.part.color), bodyOf.part.finish === 'fuzzy' ? 1 : 0.75, bp);
      }
      if (this.game) this.addOutline(paw);
      pivot.add(paw);
      pivot.visible = false;
      this.joints.body.add(pivot);
      this.wavePaw = pivot;
    }
    // 네 발 동물이면 다리를 앞발, 뒷발 네 개로 나눈다 (카메라 맞춘 뒤라 화면 크기는 그대로)
    // 네 발로 선 몸은 따로 (앉고, 엎드리고, 옆으로 돌아 걷는다). 카메라는 그 자세들이 다 들어가게 다시 맞춘다
    this.stanceToes = bp.face.mouth === 'cat' || !!bp.face.whiskers;
    this.stance = standing && bodyBox ? this.buildStance(meshes, bodyBox) : undefined;
    this.quad = bodyBox && !this.stance ? this.buildQuad(bp, parts, meshes, bodyBox) : undefined;
    if (this.stance) this.fitStance();
    // 복슬복슬: 관절마다 부품을 녹여 한 덩어리로 (관절과 다리 나누기가 끝난 뒤라 움직임은 그대로)
    if (this.fluffy) this.fuseJoints(bp);
    // 실사 네 발로 선 몸: 관절마다 털 껍질을 층별로 합쳐 그리기 호출을 줄인다
    if (this.real && this.stance) this.mergeFurShells();
  }

  /**
   * 복슬복슬: 관절(묶음)마다 그 아래 부품 모양들을 한 겉면으로 녹여 붙이고 털을 입힌다. 반짝(코, 부리, 잎)과
   * 고리 모양은 또렷해야 해서 그대로 둔다. 얼굴은 녹이기 전 부품 겉면에 붙였고 녹인 겉면도 거의 같은 자리다
   */
  private fuseJoints(bp: Blueprint) {
    const groups = new Map<Object3D, Mesh[]>();
    // 털을 덮는 옷 (모자 꼭대기, 단, 챙, 몸통). 그 속과 둘레 털은 깎는다
    const wears: Mesh[] = [];
    this.root.updateMatrixWorld(true);
    this.root.traverse((o) => {
      const part = o.userData.part as Part | undefined;
      if (o instanceof Mesh && part?.wear && part.slot === 'top' && COVER_SHAPES.has(part.shape))
        wears.push(o);
    });
    this.root.traverse((o) => {
      const part = o.userData.part as Part | undefined;
      if (!(o instanceof Mesh) || !part || !o.parent) return;
      // 입는 옷도 녹이지 않는다 (모자, 목도리가 털 덩어리에 섞이지 않게)
      if (part.finish === 'shiny' || part.shape === 'torus' || part.wear) return;
      // 관(꼬리), 털 뭉치, 리본은 녹이지 않고 제 모양을 지킨다 (관은 털만 입힌다)
      if (part.shape === 'tube' || part.shape === 'tuft' || part.shape === 'bow') {
        if (part.shape !== 'bow' && o.geometry.attributes.position)
          this.fluffSkin(o, new Color(part.color), part.finish === 'fuzzy' ? 1 : 0.6, bp);
        return;
      }
      const list = groups.get(o.parent) ?? [];
      list.push(o);
      groups.set(o.parent, list);
    });
    const jobs: {
      group: Object3D;
      list: Mesh[];
      covers: FuseCover[];
      steps: Generator<void, FusedMesh | undefined>;
      /** 전에 녹인 몸을 다시 쓴다 */
      hit: boolean;
      /** 녹이기가 끝난 뒤 굴곡 내기 */
      bump?: Generator<void, BufferGeometry | undefined>;
    }[] = [];
    for (const [group, list] of groups) {
      const fparts: FusePart[] = [];
      const bounds = new Box3();
      for (const m of list) {
        const part = m.userData.part as Part;
        m.updateMatrix();
        const geo = m.geometry;
        geo.computeBoundingBox();
        if (geo.boundingBox) bounds.union(geo.boundingBox.clone().applyMatrix4(m.matrix));
        const prm = (geo as BufferGeometry & { parameters?: { radius?: number; height?: number } })
          .parameters;
        const c = new Color(part.color);
        const pat = part.pattern ? this.patternOf(part.pattern, geo, m.scale) : undefined;
        const patColor = part.pattern ? new Color(part.pattern.color) : undefined;
        fparts.push({
          shape: part.shape as FuseShape,
          inv: m.matrix.clone().invert().elements,
          scale: Math.min(m.scale.x, m.scale.y, m.scale.z),
          ...(part.shape === 'capsule'
            ? { capsule: { r: prm?.radius ?? 1, half: (prm?.height ?? 0) / 2 } }
            : {}),
          color: [c.r, c.g, c.b],
          ...(pat && patColor
            ? {
                colorAt: (x: number, y: number, z: number): [number, number, number] => {
                  const k = patternMask(pat.pattern, [x, y, z], pat.half, pat.scale);
                  return [
                    c.r + (patColor.r - c.r) * k,
                    c.g + (patColor.g - c.g) * k,
                    c.b + (patColor.b - c.b) * k,
                  ];
                },
              }
            : {}),
          // 귀는 짧은 털 (길면 부스스하다)
          fur: (part.finish === 'fuzzy' ? 1 : 0.75) * (part.slot.startsWith('ear') ? 0.35 : 1),
        });
      }
      if (bounds.isEmpty()) continue;
      // 얼굴 관절이면 눈, 입, 코(반짝 부품) 둘레 털을 짧게 깎아 얼굴이 털에 묻히지 않게
      const clears: FuseClear[] = [];
      if (this.face && this.face.groups[0]?.parent === group) {
        const r = Math.max(0.03, (bp.face.eyeSize ?? 0.05) * 1.6);
        for (const g of this.face.groups) clears.push({ at: g.position.toArray(), r });
      }
      for (const o of group.children)
        if (o instanceof Mesh && (o.userData.part as Part | undefined)?.finish === 'shiny') {
          const part = o.userData.part as Part;
          clears.push({ at: o.position.toArray(), r: Math.max(...part.size) * 1.3 });
        }
      const size = bounds.getSize(new Vector3());
      // 격자 간격: 한 관절을 48칸 남짓으로 (64칸이면 펫 하나 조립에 이 컴퓨터에서 0.9초까지 걸렸다)
      const cell = Math.min(0.018, Math.max(0.006, Math.max(size.x, size.y, size.z) / 48));
      // 같은 몸이면 전에 녹인 것을 다시 쓴다 (옷만 바꿨을 때. 옷은 녹이지 않아 몸은 그대로인데 다시 녹이는 몇 초 동안
      // 털 없는 매끈한 몸이 보였다)
      const key = JSON.stringify([
        list.map((m) => [m.userData.part, Array.from(m.matrix.elements)]),
        clears,
        cell,
      ]);
      const hit = this.fused.get(key);
      if (hit) {
        // 다시 쓴 것을 맨 뒤로 (오래 안 쓴 것부터 버린다)
        this.fused.delete(key);
        this.fused.set(key, hit);
      }
      jobs.push({
        group,
        list,
        covers: coversOf(group, wears),
        steps: hit
          ? reuseFused(hit)
          : this.rememberFused(
              key,
              fuseSteps(
                fparts,
                { min: bounds.min.toArray(), max: bounds.max.toArray() },
                cell,
                0.035,
                clears,
              ),
            ),
        hit: !!hit,
      });
    }
    const token = ++this.fuseToken;
    const fur = furOfBlueprint(bp);
    /** 녹인 몸에 털 뭉치 굴곡을 낸다 (나눠서) */
    const margin = fluffLength(fur);
    function* finish(
      fused: FusedMesh | undefined,
      covers: FuseCover[],
    ): Generator<void, BufferGeometry | undefined> {
      if (!fused) return undefined;
      const geo = fusedGeometry(fused);
      const len = geo.attributes.furLen;
      if (len) coverFur(fused.positions, len, covers, margin);
      yield* bumpFurSteps(geo, fur);
      return geo;
    }
    const apply = (job: (typeof jobs)[number], geo: BufferGeometry | undefined) => {
      if (!geo) return;
      const mesh = new Mesh(geo, this.fluffBase());
      mesh.userData.fused = true;
      // 네 발로 선 몸의 다리 마디는 화면에서 작아 털 껍질을 덜 겹친다 (마디가 여덟이라 걸을 때 그리기가 늘었다)
      this.addFluffShells(mesh, bp, job.group.userData.thin ? 0.6 : 1);
      for (const m of job.list) {
        job.group.remove(m);
        this.disposeTree(m);
      }
      job.group.add(mesh);
      this.root.updateMatrixWorld(true);
    };
    /** 남은 일을 budget ms 만큼 한다. 다 했으면 true */
    const work = (budget: number) => {
      const until = performance.now() + budget;
      while (jobs.length) {
        if (token !== this.fuseToken) return true;
        const job = jobs[0];
        if (!job) break;
        if (!job.bump) {
          const r = job.steps.next();
          if (r.done) job.bump = finish(r.value, job.covers);
        } else {
          const r = job.bump.next();
          if (r.done) {
            jobs.shift();
            apply(job, r.value);
            // 얼굴 아이콘과 집 그림(version 을 본다)은 다 녹은 뒤 한 번만 다시 그린다 (관절마다 다시 그렸다)
            if (jobs.length === 0) this.version++;
            this.onUpdate?.();
          }
        }
        if (performance.now() >= until) return jobs.length === 0;
      }
      return true;
    };
    this.finishFuse = () => {
      work(Number.POSITIVE_INFINITY);
      this.finishFuse = () => {};
    };
    // 모두 전에 녹인 몸이면 바로 마친다 (털과 굴곡만 다시 낸다. 매끈한 몸이 한 번도 보이지 않게)
    if (jobs.every((j) => j.hit)) {
      this.finishFuse();
      return;
    }
    // 프레임 사이에 8ms 씩. 그동안 펫은 녹이기 전 몸(털 없는 매끈한 부품)으로 보인다
    const tick = () => {
      if (token !== this.fuseToken) return;
      if (!work(8)) setTimeout(tick, 0);
    };
    setTimeout(tick, 0);
  }

  /**
   * 머리와 몸 사이 골을 메운다 (pet3d-neck.ts). 두 공의 모양을 잘게 나눈 공으로 바꾼 뒤 골 가까이 정점을 둥근 이음 겉면으로
   * 민다. 무늬 자리(모양 공간)는 거의 그대로다. 얼굴을 붙이기 전에 한다 (눈, 입이 바뀐 겉면에 앉게)
   */
  private filletNeck(meshes: readonly { part: Part; mesh: Mesh }[]) {
    const pair = neckPair(meshes.map((m) => m.part));
    if (!pair) return;
    for (const [self, other] of [
      [pair.head, pair.body],
      [pair.body, pair.head],
    ] as const) {
      const mesh = meshes.find((m) => m.part === self)?.mesh;
      if (!mesh) continue;
      const geo = new SphereGeometry(1, 64, 48);
      const pos = geo.attributes.position;
      const nrm = geo.attributes.normal;
      if (!pos || !nrm || !filletSphere(self, other, pos.array as Float32Array, nrm.array as Float32Array)) {
        geo.dispose();
        continue;
      }
      pos.needsUpdate = true;
      nrm.needsUpdate = true;
      mesh.geometry.dispose();
      mesh.geometry = geo;
    }
  }

  /** 복슬복슬 몸을 다 만들 때까지 바로 한다 (썸네일, 시험 그림처럼 한 번에 그려야 할 때) */
  finishFuse: () => void = () => {};
  /** 몸이 바뀔 때마다(복슬복슬 털이 붙을 때) 늘어난다. 얼굴 그림을 다시 그릴지 볼 때 쓴다 */
  version = 0;
  /** 복슬복슬 털이 붙어 다시 그려야 할 때 부른다 (펫 화면이 requestFrame 을 넣는다) */
  onUpdate: (() => void) | undefined;
  /** 이 값이 바뀌면 하던 녹이기를 버린다 (펫을 바꿨다) */
  private fuseToken = 0;
  /** 녹인 몸 (관절 부품과 자리 → 겉면). 옷을 바꾸거나 모습을 오가도 다시 녹이지 않는다. 오래 안 쓴 것부터 버린다 */
  private fused = new Map<string, FusedMesh>();

  /** 녹이기가 끝나면 그 몸을 기억해 둔다 (털 깎기와 굴곡이 바꾸지 않게 따로 떠서) */
  private *rememberFused(
    key: string,
    steps: Generator<void, FusedMesh | undefined>,
  ): Generator<void, FusedMesh | undefined> {
    const r = yield* steps;
    if (r) {
      this.fused.set(key, copyFused(r));
      for (const k of this.fused.keys()) {
        if (this.fused.size <= FUSED_KEEP) break;
        this.fused.delete(k);
      }
    }
    return r;
  }

  private fluffBase(): Material {
    let m = this.materials.get('fluff/base');
    if (!m) {
      m = fluffBaseMaterial();
      this.materials.set('fluff/base', m);
    }
    return m;
  }

  /** 겉면 모양 하나에 털 껍질을 붙인다 (재질은 층과 털 느낌마다 하나, 다른 관절과 같이 쓴다) */
  private addFluffShells(mesh: Mesh, bp: Blueprint, k = 1) {
    const fur = furOfBlueprint(bp);
    const n = Math.max(6, Math.round(fluffLayers(fur) * k));
    this.fluffTex ??= fluffTexture();
    const tex = this.fluffTex;
    // 네 발로 선 몸은 털 끝을 부드럽게 (fluffShellMaterial soft)
    const soft = !!bp.stance;
    addShells(mesh, n, (i) => {
      const key = `fluff/${i}/${n}/${fur.length}/${fur.curl}/${fur.clump}${soft ? '/soft' : ''}`;
      let m = this.materials.get(key);
      if (!m) {
        m = fluffShellMaterial(i, n, tex, fur, soft);
        this.materials.set(key, m);
      }
      return m;
    });
  }

  /** 녹이지 않은 모양(손 흔드는 앞발)을 한 색 털로 */
  private fluffSkin(mesh: Mesh, color: Color, fur: number, bp: Blueprint) {
    paintGeometry(mesh.geometry, color, fur);
    mesh.material = this.fluffBase();
    this.addFluffShells(mesh, bp);
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
      // 자식(게임 테두리 선, 실사 털 껍질)까지 같이 본떠 앞발과 같은 겉이 된다 (모양과 재질은 같이 쓴다)
      const copies = front.map(({ mesh }) => {
        const m = mesh.clone();
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

  /**
   * 네 발로 선 몸 준비 (설계도 stance: 'stand'). 다리 슬롯마다 부품을 앞다리, 뒷다리로 나누고, 다리마다 엉덩이(어깨) 관절
   * 아래 윗마디, 무릎 관절 아래 아랫마디(knee 칸 부품)를 묶는다. 앉은 자세와 엎드린 자세는 몸 치수로 미리 푼다
   */
  private buildStance(meshes: { part: Part; mesh: Mesh }[], bodyBox: Box3): StanceRig | undefined {
    this.root.updateMatrixWorld(true);
    const depth = bodyBox.max.z - bodyBox.min.z;
    const wp = (m: Mesh) => m.getWorldPosition(new Vector3());
    const pt = (v: Vector3): Pt => ({ y: v.y, z: v.z });
    const legs: StanceLeg[] = [];
    for (const [slot, side] of [
      ['legL', 'l'],
      ['legR', 'r'],
    ] as const) {
      const mine = meshes.filter((m) => m.part.slot === slot && !m.part.wear);
      const cut = legCut(
        mine.map((m) => m.part.at[2]),
        legGap(depth),
      );
      if (cut === undefined) return undefined;
      for (const front of [true, false]) {
        const list = mine.filter((m) => m.part.at[2] > cut === front);
        const upper = list.filter((m) => !m.part.knee);
        const lower = list.filter((m) => m.part.knee).sort((a, b) => wp(b.mesh).y - wp(a.mesh).y);
        const top = lower[0];
        const bottom = lower.at(-1);
        if (!top || !bottom || top === bottom) return undefined;
        const kneeAt = wp(top.mesh);
        const foot = wp(bottom.mesh);
        let hip = kneeAt.clone().add(new Vector3(0, 0.12, 0));
        if (upper.length) {
          const box = new Box3();
          for (const m of upper) box.union(new Box3().setFromObject(m.mesh));
          const c = box.getCenter(new Vector3());
          const size = box.getSize(new Vector3());
          // 관절은 윗마디 꼭대기에서 굵기 반만큼 아래 (캡슐 위쪽 둥근 끝의 가운데)
          hip = new Vector3(c.x, box.max.y - Math.min(size.x, size.z) / 2, c.z);
        }
        // 다리를 새로 짠다: 엉덩이(어깨) → 무릎(팔꿈치) → 발목 두 마디를 매끈하게 이어진 막대로, 발은 발목에 따로 매달아
        // 디딜 때 바닥에 판판하게 둔다. 쉬는 자세에서도 무릎을 조금 굽혀(다리 길이가 엉덩이 높이의 1.14 배) 걸을 때
        // 앞뒤로 디딘 발에 닿는다 (예전엔 쉬는 다리가 곧아서 보폭 끝의 발에 닿지 못하고 발이 끌렸다)
        const paw = bottom.part;
        const ps = paw.size;
        const ankle = new Vector3(foot.x, foot.y + ps[1] * 0.55, foot.z - ps[2] * 0.22);
        const drop = Math.hypot(hip.y - ankle.y, hip.z - ankle.z);
        const total = drop * 1.14;
        const l1 = total * (front ? 0.5 : 0.47);
        const l2 = total - l1;
        const kneeSolve = solveLeg(pt(hip), pt(ankle), l1, l2, front ? -1 : 1);
        const knee = new Vector3((hip.x + ankle.x) / 2, kneeSolve.knee.y, kneeSolve.knee.z);
        // 굵기: 윗마디 캡슐(앞다리) 굵기, 무릎은 무릎 공, 발목은 아랫마디 캡슐보다 조금 가늘게
        const radius = (m: { part: Part } | undefined, k: number, fallback: number) =>
          m ? Math.max(m.part.size[0], m.part.size[2]) * k : fallback;
        const upperCap = upper.find((m) => m.part.shape === 'capsule');
        const shin = lower.find((m) => m !== top && m !== bottom && m.part.shape === 'capsule');
        const rk = radius(top, 1.06, 0.048);
        const r0 = Math.max(rk * 1.15, radius(upperCap, 1, rk * 1.3));
        const ra = Math.min(rk * 0.95, radius(shin, 0.9, rk * 0.8));
        const look = (top.part.color ? top : bottom).part;
        const own = this.joints[slot];
        const hipG = new Group();
        hipG.position.copy(own.worldToLocal(hip.clone()));
        own.add(hipG);
        hipG.updateMatrixWorld(true);
        // 엉덩이 털(넓적다리 공)은 그대로 두고 윗마디 캡슐만 바꾼다
        const drop1 = (m: { mesh: Mesh }) => {
          m.mesh.parent?.remove(m.mesh);
          this.disposeTree(m.mesh);
        };
        for (const m of upper) {
          if (m === upperCap) drop1(m);
          else hipG.attach(m.mesh);
        }
        this.limbMesh(slot, look, hip, knee, r0, rk, hipG);
        hipG.userData.thin = true;
        const kneeG = new Group();
        kneeG.userData.thin = true;
        kneeG.position.copy(hipG.worldToLocal(knee.clone()));
        hipG.add(kneeG);
        kneeG.updateMatrixWorld(true);
        for (const m of lower) {
          if (m === top || m === bottom || m === shin) drop1(m);
          else kneeG.attach(m.mesh);
        }
        this.limbMesh(slot, look, knee, ankle, rk * 0.985, ra, kneeG);
        const pawG = new Group();
        pawG.userData.thin = true;
        pawG.position.copy(kneeG.worldToLocal(ankle.clone()));
        kneeG.add(pawG);
        pawG.updateMatrixWorld(true);
        this.pawMesh(paw, foot, pawG);
        const sole = new Vector3(foot.x - ankle.x, Math.max(0, foot.y - ps[1]) - ankle.y, foot.z - ankle.z);
        legs.push({
          sole,
          id: `${front ? 'f' : 'h'}${side}`,
          front,
          hipG,
          kneeG,
          pawG,
          hip,
          foot,
          toAnkle: ankle.clone().sub(foot),
          l1,
          l2,
          rest1: segAngle(pt(hip), pt(knee)),
          rest2: segAngle(pt(knee), pt(ankle)),
        });
      }
    }
    // 다리 마디와 발: 보는 쪽에 따라 광택과 그늘을 손질한다 (limbLook)
    if (!this.fluffy)
      for (const l of legs)
        l.hipG.traverse((o) => {
          if (o instanceof Mesh && o.userData.part) limbLook(o, this.root, l.front);
        });
    const avg = (list: StanceLeg[], f: (l: StanceLeg) => number) =>
      list.reduce((a, l) => a + f(l), 0) / Math.max(1, list.length);
    const fronts = legs.filter((l) => l.front);
    const hinds = legs.filter((l) => !l.front);
    const hip = { y: avg(hinds, (l) => l.hip.y), z: avg(hinds, (l) => l.hip.z) };
    const shoulder = { y: avg(fronts, (l) => l.hip.y), z: avg(fronts, (l) => l.hip.z) };
    const dims: StanceDims = {
      hip,
      shoulder,
      rump: hip.y - bodyBox.min.y,
      chest: shoulder.y - bodyBox.min.y,
      pawY: avg(legs, (l) => l.foot.y),
      frontFootZ: avg(fronts, (l) => l.foot.z),
      frontReach: avg(fronts, (l) => Math.hypot(l.hip.y - l.foot.y, l.hip.z - l.foot.z)),
    };
    // 늘어진 귀: 귀 관절이 귀 부품 가운데보다 위에 있다 (setBlueprint 가 위에 둔다)
    const earBox = new Box3();
    for (const m of meshes) if (m.part.slot === 'earL') earBox.union(new Box3().setFromObject(m.mesh));
    const floppy =
      !earBox.isEmpty() &&
      this.joints.earL.getWorldPosition(new Vector3()).y > earBox.getCenter(new Vector3()).y;
    return {
      legs,
      dims,
      pivot: this.joints.body.position.clone(),
      sit: sitPose(dims),
      lie: liePose(dims),
      // 다리 길이 (엉덩이에서 발목까지 곧게 잰 길이. 쉬는 다리는 조금 굽혀 이보다 14% 길다)
      leg: avg(fronts, (l) => (l.l1 + l.l2) / 1.14),
      floppy,
      headBase: this.joints.head.position.clone(),
      tailBase: this.joints.tail.position.clone(),
    };
  }

  /**
   * 네 발로 선 몸의 다리 마디 하나 (세상 자리 from → to, 굵기 r0 → r1) 를 만들어 parent 에 붙인다.
   * 복슬복슬은 녹여 붙이는 거리 함수가 아는 캡슐로 (털이 덮어 가늘어지는 모양은 안 보인다)
   */
  private limbMesh(
    slot: Slot,
    look: Part,
    from: Vector3,
    to: Vector3,
    r0: number,
    r1: number,
    parent: Group,
  ) {
    const len = from.distanceTo(to);
    const phi = Math.atan2(to.z - from.z, -(to.y - from.y));
    const mid = from.clone().add(to).multiplyScalar(0.5);
    const base: Part = {
      slot,
      shape: 'capsule',
      at: [mid.x, mid.y, mid.z],
      size: [r0, len / 2 + r0, r0],
      rot: [-phi / DEG, 0, 0],
      color: look.color,
      finish: look.finish ?? 'fuzzy',
      knee: true,
    };
    let mesh: Mesh;
    if (this.fluffy) {
      const r = (r0 + r1) / 2;
      mesh = this.partMesh({ ...base, size: [r, len / 2 + r, r] });
    } else mesh = this.partMesh(base, limbGeometry(r0, r1, len).translate(0, len / 2, 0));
    worldFurCoords(mesh);
    if (this.sculpt && !this.fluffy) sculptOutline(mesh.geometry, mesh.scale, this.sculpt);
    parent.attach(mesh);
  }

  /** 네 발로 선 몸의 발: 바닥이 판판한 둥근 발 (고양이는 발가락), 발바닥 살. center 는 발 가운데 (세상) */
  private pawMesh(paw: Part, center: Vector3, parent: Group) {
    const part: Part = { ...paw, shape: 'sphere', at: [center.x, center.y, center.z] };
    delete part.rot;
    if (this.fluffy) {
      // 복슬복슬은 발을 아랫마디와 같이 녹인다 (털이 발목을 덮어 판판한 발이 안 보이고, 녹인 덩어리와 털 껍질이 하나 준다)
      const mesh = this.partMesh(part);
      (parent.parent ?? parent).attach(mesh);
      return;
    }
    const [sx, sy, sz] = paw.size;
    const mesh = this.partMesh(part, pawGeometry(paw.size, this.stanceToes));
    worldFurCoords(mesh);
    if (this.sculpt) sculptOutline(mesh.geometry, mesh.scale, this.sculpt);
    // 발바닥 살: 밝은 발은 분홍, 어두운 발은 짙은 살 (발을 들어 발끝을 굽히면 보인다)
    const c = new Color(paw.color);
    const pad = this.material(c.r * 0.3 + c.g * 0.55 + c.b * 0.15 > 0.55 ? '#e9a59c' : '#2f2422', 'soft');
    const sphere = new SphereGeometry(1, 16, 10);
    const bean = (x: number, y: number, z: number, r: [number, number, number]) => {
      const m = new Mesh(sphere, pad);
      m.position.set(x, y, z);
      m.scale.set(...r);
      mesh.add(m);
    };
    bean(0, -sy * 0.8, -sz * 0.12, [sx * 0.42, sy * 0.2, sz * 0.32]);
    if (this.stanceToes)
      for (const x of [-0.62, -0.21, 0.21, 0.62])
        bean(x * sx * 0.82, -sy * 0.82, sz * (0.5 - Math.abs(x) * 0.12), [sx * 0.15, sy * 0.15, sz * 0.13]);
    parent.attach(mesh);
  }

  /**
   * 네 발로 선 몸의 카메라 맞추기: 앉아서 앞을 본 자세와 옆으로 돌아 걷는 자세가 다 캔버스에 들어가게.
   * 쉬는 모습(앉은 자세)으로 되돌린 뒤 맞춘다
   */
  private fitStance() {
    const still: DrawState = { mood: 'idle', elapsed: 0, blink: -1 };
    const box = new Box3();
    this.ease.frame(undefined);
    this.fitting = true;
    const measure = (act: Act, yaw: number) => {
      this.poseStance(still, 1, 1, act);
      this.root.rotation.y = yaw;
      this.root.updateMatrixWorld(true);
      box.union(new Box3().setFromObject(this.root));
    };
    for (const dir of [-1, 1] as const) measure({ type: 'walk', dir, phase: 0.3 }, dir * (Math.PI / 2));
    measure(undefined, 0);
    this.fitting = false;
    this.poseStance(still, 1, 1, undefined);
    this.frameCamera(box);
  }

  /** 방금 그린 자세가 아직 따라가는 중인지 (돌아서기, 걷기 풀기). 펫 화면이 몇 틀 더 그린다 */
  settling(): boolean {
    return this.ease.busy || this.turning;
  }

  /** 방금 그린 그림에서 side 쪽 앞발 끝 (2D 캔버스 좌표). 앞발이 없으면 undefined (연필, 쪽지를 손에 맞춘다) */
  hand(side: -1 | 1): { x: number; y: number } | undefined {
    const rig = this.tapRig;
    if (!rig || this.relief || !this.drawn) return undefined;
    for (const slot of side < 0 ? (['armL', 'wingL'] as const) : (['armR', 'wingR'] as const)) {
      const tip = pawTip(rig, slot);
      if (!tip) continue;
      const p = this.joints[slot].localToWorld(tip).project(this.camera);
      const { x0, y0, d } = this.drawn;
      return { x: x0 + d / 2 + (p.x * d) / 2, y: y0 + d / 2 - (p.y * d) / 2 };
    }
    return undefined;
  }

  /** 같이 타자 치기를 입체로 그린다 (조립한 몸이고 앞발이 있을 때. 입체 판은 2D 키보드를 얹는다) */
  ownsTap(): boolean {
    return !this.relief && !!this.tapRig;
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
    this.ease.frame(s.now);
    // 통통 튀는 세기 (설계도 motion.bounce, pet3d-motion.ts)
    // 네 발 걷기는 걸음 들썩임도 출발과 멈춤에 맞춰 줄인다 (pet3d-gait.ts walkEnvelope)
    // 네 발로 선 몸은 걸을 때 그림 전체를 띄우지 않는다 (몸통만 오르내리고 디딘 발은 바닥에 붙어 있다)
    // 두 발로 걷는 다리 있는 몸은 걸음 들썩임을 몸에만 준다 (그림 전체를 띄우면 디딘 발도 같이 떠올랐다, stepBiped)
    const legBob = !this.stance && act?.type === 'walk' && (!!this.quad || this.hasLegs);
    const bob =
      this.stance && act?.type === 'walk'
        ? 0
        : this.quad && act?.type === 'walk'
          ? walkEnvelopeOf(act).stride
          : 1;
    let { lift: up, sx, sy } = bounced(s, act, this.motion.bounce, lift0 * bob, sx0, sy0);
    this.bodyBob = legBob ? up : 0;
    if (legBob) up = 0;
    // 네 발로 선 몸은 신나면 그 동물답게 (고양이 꾹꾹과 작은 폴짝, 강아지 놀자 인사와 통통). 그림 전체를 크게 띄우지 않는다
    this.excite =
      this.stance && s.mood === 'excited' ? excitement(this.stanceToes, s.elapsed, s.calm) : CALM_EXCITEMENT;
    if (this.stance && s.mood === 'excited') {
      up = this.excite.hop;
      sx = 1;
      sy = 1;
    }
    this.air = up;
    this.pose(s, sx, sy, act);
    const { d, cx, bottom } = this.fit;
    // 몸짓으로 폴짝 뛰어도 귀 끝이 캔버스 위로 잘리지 않게 (토순이처럼 키가 큰 펫). 꼭대기만 자르면 판판하게 떠
    // 있다 떨어져서, 가장 높이 뛰는 높이가 들어가도록 뛰는 곡선 전체를 같은 배율로 낮춘다
    let lift = up;
    if (movePoseOf(act, s.calm) && act && 't' in act) {
      const room = this.headTop(0) - 2;
      lift = Math.min(up * hopScale(movePeak(act.type, s.calm).lift * this.motion.bounce, room), room);
    }
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
    const y0 = GROUND - d / 2 + (this.groundNdc(bottom) * d) / 2 - lift;
    // 바닥 그림자: 떠오를수록 옅고 작게
    const away = Math.min(1, lift / 30);
    const rx = this.fit.halfW * d * 0.42 * sx * (1 - 0.3 * away);
    // 얼굴 아이콘, 집 안 그림(pet-face.ts)에는 그리지 않는다
    if (!s.noShadow) {
      ctx.save();
      ctx.globalAlpha = 0.16 * (1 - 0.6 * away);
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.ellipse(CX, GROUND - 1, rx, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.drawImage(this.canvas, x0, y0, d, d);
    this.drawn = { x0, y0, d };
    // 머리 꼭대기 (말풍선 대신 머리 위에 뜨는 것들 자리)
    return this.headTop(lift);
  }

  /** 지금 자세의 머리 꼭대기 y (2D 캔버스). lift 만큼 띄웠을 때 */
  private headTop(lift: number): number {
    const { d, bottom } = this.fit;
    const y0 = GROUND - d / 2 + (this.groundNdc(bottom) * d) / 2 - lift;
    this.box.setFromObject(this.root);
    this.box.getCenter(this.tmp);
    this.tmp.y = this.box.max.y;
    this.tmp.project(this.camera);
    return y0 + d / 2 - (this.tmp.y * d) / 2;
  }

  /**
   * 바닥(GROUND)에 둘 화면 높이 (NDC). 네 발로 선 몸은 몸 아래 바닥 가운데를 그림자 가운데에 둔다: 돌아서면 가까운 발과
   * 먼 발이 원근으로 위아래로 나뉘는데(그림자 타원 앞뒤처럼), 쉬는 자세(앞을 본 앉은 자세)의 가장 낮은 점에 맞추면
   * 옆으로 걸을 때 발이 떠 보였다. 다른 몸은 쉬는 자세에서 잰 값 그대로
   */
  private groundNdc(bottom: number): number {
    if (!this.stance) return bottom;
    this.root.updateMatrixWorld(true);
    // 바닥 판(y=0) 위 몸 아래 점. 뒹굴 때 바닥에 붙이려고 옮긴 높이는 빼지 않는다
    const p = this.tmp.set(this.root.position.x, 0, this.root.position.z);
    p.project(this.camera);
    // 앞으로 뻗은 가까운 발(엎드리기)이 원근으로 캔버스 아래로 잘리지 않게: 가장 낮은 발바닥이 바닥 줄 아래 5.5px 까지만 (캔버스 끝 160, 바닥 154)
    let low = Number.POSITIVE_INFINITY;
    for (const leg of this.stance.legs) {
      const q = leg.pawG.localToWorld(this.faceTmp.eye.copy(leg.sole)).project(this.camera);
      low = Math.min(low, q.y);
    }
    return Math.min(p.y, low + 11 / Math.max(1, this.fit.d));
  }

  /** 방금 그린 그림에서 side 쪽 눈 가운데 (2D 캔버스 좌표). 눈이 없으면 undefined (같이 보기 돋보기) */
  eye(side: -1 | 1): { x: number; y: number } | undefined {
    const e = this.face?.eyes.find((v) => v.side === side);
    if (!e || !this.drawn) return undefined;
    const { x0, y0, d } = this.drawn;
    const p = e.open.getWorldPosition(new Vector3()).project(this.camera);
    return { x: x0 + d / 2 + (p.x * d) / 2, y: y0 + d / 2 - (p.y * d) / 2 };
  }

  /** 방금 그린 그림에서 입 가운데 (2D 캔버스 좌표). 얼굴이 없으면 undefined (문 공 자리, draw.ts) */
  mouth(): { x: number; y: number } | undefined {
    if (!this.face || !this.drawn) return undefined;
    const { x0, y0, d } = this.drawn;
    const p = this.face.mouthAt.getWorldPosition(this.tmp).project(this.camera);
    return { x: x0 + d / 2 + (p.x * d) / 2, y: y0 + d / 2 - (p.y * d) / 2 };
  }

  /**
   * 점검용: 방금 그린 그림에서 네 발로 선 몸의 발바닥 자리 (2D 캔버스 좌표)와 디딘 발인지. 디딘 발이 바닥에서
   * 미끄러지지 않는지 잴 때 쓴다 (scripts/dev). 네 발로 선 몸이 아니면 undefined
   */
  debugFeet(): { id: string; x: number; y: number; planted: boolean }[] | undefined {
    const st = this.stance;
    if (!this.drawn) return undefined;
    const { x0, y0, d } = this.drawn;
    if (!st && !this.quad) {
      // 두 발: 다리 관절 아래 발바닥 가운데 (디딘 발인지는 걸음 계획대로)
      this.root.updateMatrixWorld(true);
      return (['legL', 'legR'] as const).flatMap((id) => {
        const g = this.joints[id];
        const drop = g.userData.drop as number | undefined;
        if (drop === undefined) return [];
        const p = g.localToWorld(this.faceTmp.eye.set(0, -drop, 0)).project(this.camera);
        return [
          {
            id,
            x: x0 + d / 2 + (p.x * d) / 2,
            y: y0 + d / 2 - (p.y * d) / 2,
            planted: g.userData.planted !== false,
          },
        ];
      });
    }
    if (!st) {
      // 앉은 네 발 피규어: 다리마다 관절 아래 발바닥 가운데 (디딘 발인지는 걸음 계획대로)
      this.root.updateMatrixWorld(true);
      return (this.quad?.legs ?? []).map((leg) => {
        const p = leg.g.localToWorld(this.faceTmp.eye.set(0, -leg.drop, 0)).project(this.camera);
        return {
          id: leg.id,
          x: x0 + d / 2 + (p.x * d) / 2,
          y: y0 + d / 2 - (p.y * d) / 2,
          planted: leg.g.userData.planted !== false,
        };
      });
    }
    return st.legs.map((leg) => {
      const p = leg.pawG.localToWorld(this.faceTmp.eye.copy(leg.sole)).project(this.camera);
      return {
        id: leg.id,
        x: x0 + d / 2 + (p.x * d) / 2,
        y: y0 + d / 2 - (p.y * d) / 2,
        planted: this.lastFeet?.[leg.id]?.planted ?? true,
      };
    });
  }

  /** 관절 없는 2.5D 판인지 (draw.ts 가 걸음 몸짓을 사진처럼 몸 전체로 준다) */
  get flat(): boolean {
    return !!this.relief;
  }

  /** 네 발로 걷는 몸인지 (설계도 gait, 없으면 다리 모양 짐작). 입체 판은 두 발로 본다 */
  get fourLegged(): boolean {
    return (!!this.quad || !!this.stance) && !this.relief;
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

  /** 무늬 값: 설계도 무늬와 모양 상자 반 크기, 부품 배율 (셰이더와 녹인 몸이 같은 식을 쓴다) */
  private patternOf(pattern: Pattern, geo: BufferGeometry, scale: Vector3): PatternAt {
    geo.computeBoundingBox();
    const half = geo.boundingBox?.getSize(new Vector3()).multiplyScalar(0.5) ?? new Vector3(1, 1, 1);
    return {
      pattern,
      half: [Math.max(1e-3, half.x), Math.max(1e-3, half.y), Math.max(1e-3, half.z)],
      scale: [scale.x, scale.y, scale.z],
    };
  }

  /** 선 색 재질 (눈썹 같은 얼굴 선). 색마다 하나 */
  private inkOf(color: string): Material {
    const key = `ink/${color}`;
    let m = this.materials.get(key);
    if (!m) {
      m = new MeshBasicMaterial({ color });
      this.materials.set(key, m);
    }
    return m;
  }

  private material(
    color: string,
    finish: Finish = 'soft',
    pat?: PatternAt,
    sculpt?: 'curl' | 'long',
  ): Material {
    const key = `${color}/${finish}/${this.style}${pat ? `/${patternKey(pat)}` : ''}${sculpt ? `/${sculpt}` : ''}`;
    let m = this.materials.get(key);
    if (m) return m;
    if (this.game) m = this.toonMaterial(color, finish);
    else if (this.furry) {
      // 실사: 털 아래 살갗과 속털. 겉색보다 조금 어둡고 얼룩이 있다. 반짝(코, 부리, 잎)은 촉촉하게
      m =
        finish === 'shiny'
          ? new MeshPhysicalMaterial({ color, roughness: 0.38, clearcoat: 0.6, clearcoatRoughness: 0.3 })
          : new MeshPhysicalMaterial({
              color: new Color(color).multiplyScalar(0.9),
              map: this.fur().mottle,
              roughness: 0.95,
              sheen: 1,
              sheenRoughness: 0.4,
              sheenColor: new Color(color).lerp(new Color('#ffffff'), 0.35),
            });
    } else {
      // 피규어: 비닐 광택. 반짝은 유리처럼, 털(fuzzy)은 보드라운 벨벳처럼
      m = new MeshPhysicalMaterial(
        finish === 'shiny'
          ? { color, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.15 }
          : finish === 'fuzzy'
            ? {
                color,
                roughness: 0.85,
                sheen: 1,
                sheenRoughness: 0.45,
                // 새긴 털 결(밀크, 초코)은 털 색 빛 (흰 빛이면 갈색 털 가장자리가 분홍빛 회색으로 떴다)
                sheenColor: sculpt ? new Color(color).lerp(new Color('#ffffff'), 0.3) : '#ffffff',
              }
            : { color, roughness: 0.55, clearcoat: 0.35, clearcoatRoughness: 0.45 },
      );
    }
    decorate(m, { pattern: pat, figure: this.style === 'figure' && finish !== 'shiny', sculpt });
    this.materials.set(key, m);
    return m;
  }

  /** 부품 하나를 만든다. geo 를 주면 그 모양을 그대로 쓴다 (크기는 모양에 들어 있다. 네 발로 선 몸의 다리 마디, 발) */
  private partMesh(p: Part, given?: BufferGeometry): Mesh {
    const [x, y, z] = p.size;
    let geo: BufferGeometry;
    const scale = given ? new Vector3(1, 1, 1) : new Vector3(x, y, z);
    // 새긴 털 결로 가장자리를 울퉁불퉁하게 하는 부품은 잘게 나눈다 (sculptOutline)
    // 피규어만 (실사는 털 껍질이 모양을 열여섯 번 겹쳐 그려 잘게 나누면 비싸고, 털이 가장자리를 덮는다)
    const fine = p.finish === 'fuzzy' && !p.wear && !!this.sculpt && this.style === 'figure';
    if (given) geo = given;
    else
      switch (p.shape) {
        case 'capsule': {
          // 캡슐은 반지름 그대로 만들고 길이로 늘린다 (늘려서 만들면 둥근 끝이 찌그러진다)
          const r = Math.max(x, z);
          geo = fine
            ? new CapsuleGeometry(r, Math.max(0, 2 * y - 2 * r), 16, 56, 4)
            : new CapsuleGeometry(r, Math.max(0, 2 * y - 2 * r), 10, 24);
          scale.set(x / r, 1, z / r);
          if (p.taper !== undefined && p.taper < 1) taperY(geo, p.taper);
          // 길게 선 귀(토끼 귀)는 곧은 막대 대신 가운데가 도톰한 잎 모양으로, 끝이 살짝 뒤로 휜다.
          // 게임 모습은 빼다 (테두리 선을 키운 사본으로 그려서 휜 귀 끝에 선이 겹쳐 보였다)
          if (
            (p.slot === 'earL' || p.slot === 'earR') &&
            !p.wear &&
            !this.game &&
            y >= LONG_EAR * Math.max(x, z)
          )
            earLeaf(geo, z / r);
          break;
        }
        case 'cone':
          geo = new ConeGeometry(1, 2, 32);
          break;
        case 'cylinder':
          geo = new CylinderGeometry(p.taper ?? 1, 1, 2, 32);
          break;
        case 'box':
          geo = new RoundedBoxGeometry(2, 2, 2, 4, Math.min(0.98, Math.max(0.02, p.round ?? 0.35)));
          break;
        case 'torus':
          geo = new TorusGeometry(1, 0.32, 16, 48);
          break;
        case 'tube':
          // 길은 절대 좌표라 at 를 뺀 자리로, 반지름은 모양에 넣는다 (배율로 키우면 길까지 늘어난다)
          geo = tubeGeometry(p.path ?? [], p.at, x, p.taper ?? 1, fine);
          scale.set(1, 1, 1);
          break;
        case 'tuft':
          geo = tuftGeometry();
          break;
        case 'bow':
          geo = bowGeometry();
          break;
        default:
          // 잘라 낸 공 (털모자 꼭대기): 위에서 cut 높이까지만
          geo =
            p.cut !== undefined && p.cut > -1
              ? new SphereGeometry(
                  1,
                  40,
                  28,
                  0,
                  Math.PI * 2,
                  0,
                  Math.acos(Math.max(-1, Math.min(0.95, p.cut))),
                )
              : fine
                ? new SphereGeometry(1, 72, 48)
                : new SphereGeometry(1, 40, 28);
      }
    const pat = p.pattern ? this.patternOf(p.pattern, geo, scale) : undefined;
    // 새긴 털 결은 모양 좌표 × 크기(세상 길이)로 찍는다: 부품 크기와 상관없이 같은 굵기, 움직여도 겉에 붙어 있다
    const sculpt = p.finish === 'fuzzy' && !p.wear ? this.sculpt : undefined;
    if (sculpt) {
      const pos = geo.attributes.position;
      if (pos) {
        const v = new Float32Array(pos.count * 3);
        for (let i = 0; i < pos.count; i++)
          v.set([pos.getX(i) * scale.x, pos.getY(i) * scale.y, pos.getZ(i) * scale.z], i * 3);
        geo.setAttribute('jjFurP', new BufferAttribute(v, 3));
        // 다리 마디와 발(given)은 세상 자리로 좌표를 옮긴 뒤 한다 (limbMesh, pawMesh)
        // 고양이 얼굴은 털이 짧다 (긴 털 다발은 몸, 꼬리, 다리만)
        if (!given) sculptOutline(geo, scale, sculpt, sculpt === 'long' && p.slot === 'head' ? 0.35 : 1);
      }
    }
    const mesh = new Mesh(geo, this.material(p.color, p.finish, pat, sculpt));
    mesh.position.set(...p.at);
    mesh.scale.copy(scale);
    if (p.rot) mesh.rotation.set(p.rot[0] * DEG, p.rot[1] * DEG, p.rot[2] * DEG);
    mesh.userData.part = p;
    if (this.real) this.addFur(mesh, p, pat);
    if (this.game) this.addOutline(mesh);
    return mesh;
  }

  /**
   * 게임 캐릭터 재질 (셀 셰이딩). 빛을 2단(옅은 그늘, 밝음)으로만 끊어 평평한 일러스트처럼 칠한다.
   * 반짝(코, 부리, 잎)만 위쪽에 작은 하이라이트
   */
  private toonMaterial(color: string, finish: Finish): Material {
    if (!this.toonRamp) {
      const steps = [175, 255];
      const data = new Uint8Array(steps.length * 4);
      for (const [i, v] of steps.entries()) data.set([v, v, v, 255], i * 4);
      this.toonRamp = new DataTexture(data, steps.length, 1);
      this.toonRamp.minFilter = NearestFilter;
      this.toonRamp.magFilter = NearestFilter;
      this.toonRamp.needsUpdate = true;
    }
    const m = new MeshToonMaterial({ color, gradientMap: this.toonRamp });
    if (finish !== 'shiny') return m;
    hook(m, 'toon-gloss', (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <opaque_fragment>',
        `{
          vec3 up = normalize(vec3(-0.35, 0.8, 0.5));
          float spot = dot(normal, up);
          outgoingLight = mix(outgoingLight, vec3(1.0), 0.55 * step(0.93, spot));
        }
        #include <opaque_fragment>`,
      );
    });
    return m;
  }

  /**
   * 게임 캐릭터 테두리 선. 같은 모양을 조금 크게 뒤집어(뒷면만) 그려 몸 둘레에 선이 생긴다.
   * 귀여운 캐릭터 일러스트처럼 굵은 짙은 고동색 한 가지 (검정보다 부드럽다). 부품끼리 겹친 자리에도 선이 생긴다
   */
  private addOutline(mesh: Mesh) {
    const geo = mesh.geometry;
    geo.computeBoundingBox();
    const half = geo.boundingBox?.getSize(new Vector3()).multiplyScalar(0.5);
    if (!half) return;
    const ext = half.multiply(mesh.scale);
    const w = Math.min(0.02, Math.min(ext.x, ext.y, ext.z) * 0.35);
    if (w < 0.002) return;
    const key = 'outline';
    let mat = this.materials.get(key);
    if (!mat) {
      mat = new MeshBasicMaterial({ color: OUTLINE, side: BackSide });
      this.materials.set(key, mat);
    }
    const line = new Mesh(geo, mat);
    line.scale.set(1 + w / ext.x, 1 + w / ext.y, 1 + w / ext.z);
    mesh.add(line);
  }

  /** 털 가닥 그림과 얼룩 그림 (실사). 한 번 만들어 모든 털 재질이 같이 쓴다 */
  private fur(): { strands: Texture; mottle: Texture } {
    if (this.furTex) return this.furTex;
    // 점마다 방사 그라데이션을 9칸씩 새로 만들면 처음 실사로 바꿀 때 펫 화면이 100ms 남짓 멈췄다.
    // 픽셀을 직접 칠한다 (그라데이션 점과 같은 셈: 가운데에서 멀어질수록 색과 불투명도가 같이 준다, 몇 ms).
    // 가장자리를 넘는 점은 반대쪽으로 이어져 같은 그림이 끊김 없이 이어진다
    const n = 256;
    const make = (paint: (px: Uint8ClampedArray) => void, color: boolean) => {
      const c = document.createElement('canvas');
      c.width = n;
      c.height = n;
      const g = c.getContext('2d');
      if (g) {
        const img = g.createImageData(n, n);
        paint(img.data);
        g.putImageData(img, 0, 0);
      }
      const tex = new CanvasTexture(c);
      tex.wrapS = RepeatWrapping;
      tex.wrapT = RepeatWrapping;
      if (color) tex.colorSpace = SRGBColorSpace;
      return tex;
    };
    /** (x, y) 둘레 r 안의 픽셀마다 가운데에서 얼마나 가까운지(1 가운데, 0 가장자리)로 섞는다. 회색 그림 */
    const dot = (
      px: Uint8ClampedArray,
      x: number,
      y: number,
      r: number,
      mix: (k: number, was: number) => number,
    ) => {
      for (let py = Math.floor(y - r); py < y + r; py++)
        for (let qx = Math.floor(x - r); qx < x + r; qx++) {
          const k = 1 - Math.hypot(qx + 0.5 - x, py + 0.5 - y) / r;
          if (k <= 0) continue;
          const i = ((((py % n) + n) % n) * n + (((qx % n) + n) % n)) * 4;
          const v = mix(k, px[i] ?? 0);
          px[i] = v;
          px[i + 1] = v;
          px[i + 2] = v;
        }
    };
    const fill = (px: Uint8ClampedArray, v: number) => {
      for (let i = 0; i < px.length; i += 4) {
        px[i] = v;
        px[i + 1] = v;
        px[i + 2] = v;
        px[i + 3] = 255;
      }
    };
    // 가닥: 검은 바탕에 가닥마다 높이(밝기)가 다른 점. 가운데가 가장 밝아 껍질이 높을수록 가늘어진다
    const rand = mulberry32(7);
    const strands = make((px) => {
      fill(px, 0);
      for (let i = 0; i < 15000; i++) {
        const x = rand() * n;
        const y = rand() * n;
        const r = 0.7 + rand() * 0.6;
        const h = Math.round((0.45 + rand() * 0.55) * 255);
        // 밝기 h 에서 투명한 검정으로 가는 점: 색 h*k 를 불투명도 k 로 얹는다
        dot(px, x, y, r, (k, was) => h * k * k + was * (1 - k));
      }
    }, false);
    // 얼룩: 아주 옅은 밝고 어두운 무늬 (진짜 털은 한 색이 아니다)
    const mottle = make((px) => {
      fill(px, 245);
      for (let i = 0; i < 260; i++) {
        const x = rand() * n;
        const y = rand() * n;
        const r = 6 + rand() * 22;
        const v = Math.round(200 + rand() * 55);
        // 색 v 를 불투명도 0.22 에서 0 으로
        dot(px, x, y, r, (k, was) => v * 0.22 * k + was * (1 - 0.22 * k));
      }
    }, true);
    this.furTex = { strands, mottle };
    return this.furTex;
  }

  /**
   * 털 (실사). 같은 모양을 조금씩 크게 겹쳐(껍질) 가닥 그림으로 구멍을 뚫는다. 바깥 껍질일수록 가닥이 가늘고
   * 밝아서 끝이 빛을 받는다. 반투명 섞기가 아니라 자르기(alphaTest)라 그리는 순서와 상관없다.
   * 털 크기가 부품 크기와 상관없이 같도록 UV 를 부품 크기만큼 늘린다
   */
  private addFur(mesh: Mesh, p: Part, pat?: PatternAt) {
    // 네 발로 선 몸(밀크, 초코)의 실사는 설계도 털 길이만큼 길게 (긴 털 고양이가 짧은 솜털 비닐처럼 보였다)
    const len0 = furLength(p) * this.furK;
    if (len0 <= 0 || p.shape === 'torus') return;
    const geo = mesh.geometry;
    geo.computeBoundingBox();
    const half = geo.boundingBox?.getSize(new Vector3()).multiplyScalar(0.5);
    if (!half) return;
    const ext = half.multiply(mesh.scale);
    // 아주 작은 부품은 털에 파묻히지 않게 짧게
    const len = Math.min(len0, Math.min(ext.x, ext.y, ext.z) * 0.35);
    if (len < 0.004) return;
    // 가닥 간격이 세상 기준 같도록 UV 를 늘린다 (그림 한 장이 TILE 만큼)
    const TILE = 0.22;
    const around = Math.PI * (ext.x + ext.z);
    const tall = p.shape === 'box' ? 2 * ext.y : Math.PI * ext.y;
    const ru = Math.max(
      1,
      Math.round(p.shape === 'box' ? (2 * Math.max(ext.x, ext.z)) / TILE : around / TILE),
    );
    const rv = Math.max(1, Math.round(tall / TILE));
    const uv = geo.attributes.uv;
    if (uv) {
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * ru, uv.getY(i) * rv);
      uv.needsUpdate = true;
    }
    const layers = p.finish === 'fuzzy' ? 16 : 8;
    for (let i = 1; i <= layers; i++) {
      const t = i / layers;
      const shell = new Mesh(geo, this.furShell(p.color, p.finish ?? 'soft', i, layers, pat));
      const grow = len * t;
      shell.scale.set(1 + grow / ext.x, 1 + grow / ext.y, 1 + grow / ext.z);
      // 끝으로 갈수록 살짝 아래로 눕는다 (무게)
      shell.position.y = -(0.25 * len * t * t) / Math.max(1e-3, mesh.scale.y);
      shell.renderOrder = i;
      // 무늬 없는 껍질은 관절 단위로 합칠 수 있다 (mergeFurShells. 무늬는 모양 좌표로 칠해 합치면 어긋난다)
      shell.userData.furShell = !pat;
      mesh.add(shell);
    }
  }

  /**
   * 실사 네 발로 선 몸(밀크, 초코): 같은 관절에 붙은 부품들의 털 껍질을 층(재질)마다 한 모양으로 합친다.
   * 껍질은 부품마다 16겹이라 갈기, 털 다발, 귀 덩이처럼 부품을 덧붙일 때마다 그리기 호출이 17번씩 늘었다.
   * 부품과 껍질은 관절 안에서 움직이지 않으니 관절 기준 자리로 구워도 그림은 같다 (관절이 돌면 같이 돈다).
   * 자세를 잡은 뒤 부른다 (다리 마디는 붙인 뒤에 자리와 털 결이 정해진다)
   */
  private mergeFurShells() {
    const keep = new Set(['position', 'normal', 'uv']);
    const byJoint = new Map<Object3D, Map<Material, Mesh[]>>();
    this.root.traverse((o) => {
      const part = o.parent;
      const joint = part?.parent;
      if (!(o instanceof Mesh) || !o.userData.furShell || !part || !joint) return;
      const mat = o.material as Material;
      const mats = byJoint.get(joint) ?? new Map<Material, Mesh[]>();
      byJoint.set(joint, mats);
      mats.set(mat, [...(mats.get(mat) ?? []), o]);
    });
    for (const [joint, mats] of byJoint)
      for (const [mat, shells] of mats) {
        if (shells.length < 2) continue;
        const geos: BufferGeometry[] = [];
        const used: Mesh[] = [];
        for (const s of shells) {
          const part = s.parent as Object3D;
          part.updateMatrix();
          s.updateMatrix();
          const rel = part.matrix.clone().multiply(s.matrix);
          // 뒤집힌 자리는 감기 방향이 바뀌어 그대로 둔다
          if (rel.determinant() <= 0) continue;
          const g = s.geometry.clone();
          for (const k of Object.keys(g.attributes)) if (!keep.has(k)) g.deleteAttribute(k);
          g.morphAttributes = {};
          g.clearGroups();
          const n = g.attributes.position?.count ?? 0;
          if (!g.attributes.uv) g.setAttribute('uv', new BufferAttribute(new Float32Array(n * 2), 2));
          if (!g.index) g.setIndex(Array.from({ length: n }, (_, i) => i));
          g.applyMatrix4(rel);
          geos.push(g);
          used.push(s);
        }
        const merged = used.length >= 2 ? mergeGeometries(geos) : null;
        for (const g of geos) g.dispose();
        if (!merged) continue;
        const one = new Mesh(merged, mat);
        one.renderOrder = used[0]?.renderOrder ?? 0;
        joint.add(one);
        // 껍질은 부품 모양을 같이 쓰므로 모양은 버리지 않는다
        for (const s of used) s.parent?.remove(s);
      }
  }

  /** 털 껍질 재질. 색과 겉 느낌, 층마다 하나 (같은 색 부품끼리 같이 쓴다) */
  private furShell(color: string, finish: Finish, i: number, layers: number, pat?: PatternAt): Material {
    const key = `${color}/${finish}/shell${i}of${layers}${pat ? `/${patternKey(pat)}` : ''}`;
    let m = this.materials.get(key);
    if (!m) {
      const t = i / layers;
      // 뿌리는 그늘져 어둡고 끝은 빛을 받아 밝다
      const shade = new Color(color).multiplyScalar(0.8 + 0.2 * t);
      if (t > 0.6) shade.lerp(new Color('#ffffff'), (t - 0.6) * 0.25);
      m = new MeshStandardMaterial({
        color: shade,
        alphaMap: this.fur().strands,
        alphaTest: 0.38 + 0.55 * t,
        roughness: 0.9,
      });
      decorate(m, { pattern: pat });
      this.materials.set(key, m);
    }
    return m;
  }

  /** 앞에서 쏜 선이 얼굴 겉면에 닿는 자리에 눈, 입, 볼, 수염을 붙인다 */
  private buildFace(f: Face, joint: Group, targets: Mesh[], muzzle = false): FaceRig {
    const ray = new Raycaster();
    const front = new Vector3(0, 0, -1);
    // 게임 캐릭터는 눈이 조금 크다
    const s = f.eyeSize * (this.game ? 1.25 : 1);
    // 얼굴 슬롯 상자. 설계도의 눈, 입 높이가 몸 밖이면 상자 안쪽으로 당겨 다시 쏜다 (허공에 뜨지 않게)
    const faceBox = new Box3();
    for (const t of targets) faceBox.union(new Box3().setFromObject(t));
    const shoot = (x: number, y: number) => {
      ray.set(new Vector3(x, y, 5), front);
      return ray.intersectObjects(targets, false)[0];
    };
    const groups: Group[] = [];
    const lift = this.faceLift;
    const place = (x0: number, y0: number, out0 = 0.002, liftK = 1): Group => {
      const out = out0 + lift * liftK;
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
    // 네 발로 선 몸의 주둥이는 작고 앞뒤로 얕아서, 겉면에 납작하게 댄 입과 코가 옆이나 3/4 에서 주둥이 둘레 밖 허공으로
    // 튀어나와 보였다. 정점마다 앞에서 쏜 선이 닿는 겉면 깊이만큼 앞뒤로만 옮겨 주둥이 곡면을 따라 휘게 한다
    // (앞에서 본 가로, 세로 자리는 그대로라 정면 모습은 같다)
    const hug = (g: Group) => {
      g.updateMatrixWorld(true);
      const c = g.getWorldPosition(new Vector3());
      const base = shoot(c.x, c.y)?.point.z;
      if (base === undefined) return;
      const v = new Vector3();
      g.traverse((o) => {
        if (!(o instanceof Mesh)) return;
        o.geometry = o.geometry.clone();
        const pos = o.geometry.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          o.localToWorld(v.fromBufferAttribute(pos, i));
          const z = shoot(v.x, v.y)?.point.z;
          if (z === undefined) continue;
          v.z += z - base;
          o.worldToLocal(v);
          pos.setXYZ(i, v.x, v.y, v.z);
        }
        o.geometry.computeVertexNormals();
      });
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
    // 실사면 눈 색이 없어도 갈색 홍채를 넣고, 위에 투명한 각막을 씌워 유리알처럼
    // 게임은 일러스트처럼 까만 눈에 반짝이 둘 (눈 색을 정한 펫만 홍채)
    const irisColor = f.eyeColor ?? (this.furry ? '#3b2416' : undefined);
    const cornea = this.furry
      ? new MeshPhysicalMaterial({
          color: '#ffffff',
          roughness: 0.03,
          transparent: true,
          opacity: 0.16,
          clearcoat: 1,
          clearcoatRoughness: 0.02,
          depthWrite: false,
        })
      : undefined;
    const irisMat = irisColor
      ? new MeshPhysicalMaterial({
          color: irisColor,
          roughness: 0.2,
          clearcoat: 1,
          clearcoatRoughness: 0.05,
        })
      : undefined;
    const sphere = new SphereGeometry(1, 24, 16);
    // 눈 밑 그늘 (녹초): 옅은 보라. 실사도 같이 (만화 표현이지만 지친 티가 가장 잘 난다)
    const shadeMat = new MeshBasicMaterial({
      color: '#7a62a8',
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
    });

    // 지친 눈 모양 (뜬 눈 세로 반지름 1 기준): 아래는 뜬 눈 둘레, 위는 가운데가 둥글게 솟은 눈꺼풀(∩).
    // 눈꺼풀 선은 눈 양 끝보다 조금 길게 그어 끝이 아래로 처진다 (무거운 눈꺼풀). 가운데가 처진 선(∪)은 끝이 치켜 올라가
    // 시큰둥하게 째려보는 눈으로 읽혔다 (사용자 지적 2026-10-08, 2D 와 같다)
    const LID = 0.26;
    const ARCH = 0.22;
    const edge = 0.78 * Math.sqrt(1 - LID * LID);
    const lidAt = (u: number) => new Vector3(u * edge, LID + ARCH * (1 - u * u), 0);
    const heavyLid = Array.from({ length: 13 }, (_, i) => lidAt(-1.22 + (i / 12) * 2.44));
    const heavyShape = new Shape();
    heavyShape.moveTo(-edge, LID);
    for (let i = 1; i <= 12; i++) {
      const p = lidAt(-1 + (i / 12) * 2);
      heavyShape.lineTo(p.x, p.y);
    }
    const a0 = Math.asin(LID);
    for (let i = 1; i <= 24; i++) {
      const a = a0 - (i / 24) * (Math.PI + 2 * a0);
      heavyShape.lineTo(0.78 * Math.cos(a), Math.sin(a));
    }
    const heavyGeo = new ExtrudeGeometry(heavyShape, {
      depth: 0.1,
      bevelEnabled: true,
      bevelThickness: 0.14,
      bevelSize: 0.05,
      bevelSegments: 3,
      curveSegments: 12,
    });

    // 눈 테두리 모양 (설계도 face.eyeShape): 가로, 세로 배율. droopy 는 바깥쪽을 아래로 기울인다
    const shape = f.eyeShape ?? 'round';
    const ew = shape === 'oval' ? 0.9 : shape === 'almond' ? 1.2 : shape === 'droopy' ? 1.05 : 1;
    const eh = shape === 'oval' ? 1.15 : shape === 'almond' ? 0.78 : shape === 'droopy' ? 0.95 : 1;
    // 반짝이 (face.catchlight): 없으면 게임은 점 둘, 나머지는 작은 점 하나. 반짝이는 눈(sparkle)은 늘 크게
    const catchlight = f.eyes === 'sparkle' ? 'big' : (f.catchlight ?? (this.game ? 'double' : 'small'));
    // 눈동자: 정했으면 그대로, 아니면 실사에서 눈 색을 정하지 않은 펫(강아지 같은)은 둥근 큰 눈동자, 아니면 세로로 긴 고양이 눈
    const slit = f.pupil ? f.pupil === 'slit' : !(this.furry && !f.eyeColor);
    const eyes: FaceRig['eyes'] = [];
    for (const side of [-1, 1] as const) {
      const g = place(side * f.eyeGap, f.eyeY);
      const open = new Group();
      const shine = new Mesh(sphere, white);
      shine.scale.setScalar(s * (catchlight === 'small' ? 0.26 : catchlight === 'double' ? 0.3 : 0.34));
      shine.position.set(s * 0.24 * ew, s * 0.38 * eh, s * 0.36);
      if (irisMat) {
        // 색 홍채 위에 검은 눈동자
        const iris = new Mesh(sphere, irisMat);
        iris.scale.set(s * 0.85 * ew, s * 1.02 * eh, s * 0.4);
        const pupil = new Mesh(sphere, eyeMat);
        if (slit) pupil.scale.set(s * 0.42, s * 0.78 * eh, s * 0.3);
        else pupil.scale.set(s * 0.58 * ew, s * 0.62 * eh, s * 0.3);
        pupil.position.z = s * 0.14;
        shine.position.z = s * 0.42;
        open.add(iris, pupil, shine);
        if (cornea) {
          const dome = new Mesh(sphere, cornea);
          dome.scale.set(s * 0.95 * ew, s * 1.1 * eh, s * 0.5);
          dome.position.z = s * 0.06;
          open.add(dome);
        }
      } else {
        const ball = new Mesh(sphere, eyeMat);
        ball.scale.set(s * 0.78 * ew, s * eh, s * 0.42);
        open.add(ball, shine);
      }
      if (shape === 'droopy') open.rotation.z = -side * 0.2;
      // 속눈썹 (face.lashes): 눈 위 바깥쪽에 짧은 선 셋
      if (f.lashes) {
        // 바깥 위 모서리에 짧은 속눈썹 둘 (많고 길면 더듬이처럼 보였다)
        for (const a of [0.95, 1.3]) {
          const rx = s * 0.78 * ew;
          const ry = s * eh;
          const from: [number, number] = [side * rx * Math.sin(a) * 0.96, ry * Math.cos(a) * 0.96];
          const dir = [Math.sin(a + 0.25), Math.cos(a + 0.25)] as const;
          const to: [number, number] = [from[0] + side * dir[0] * s * 0.32, from[1] + dir[1] * s * 0.32];
          open.add(stroke(from, to, s * 0.065, ink, s * 0.1));
        }
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
      if (catchlight !== 'small') {
        // 큰 반짝이 아래에 작은 별빛 하나 더 (게임 캐릭터 눈, 반짝이는 눈, 반짝이는 인형 눈)
        const dot = new Mesh(sphere, white);
        dot.scale.setScalar(s * (catchlight === 'big' ? 0.14 : 0.12));
        dot.position.set(-s * 0.25 * ew, -s * 0.35 * eh, shine.position.z);
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
      // 지친 눈 (기운 지침): 눈꺼풀이 위를 덮은 눈. 꾸벅 조는 눈(half)보다 크게 뜨고 반짝이가 남는다.
      // 눈꺼풀 끝선은 가운데가 둥글게 솟고 끝이 처진 선 (heavyLid). 둥근 얼굴에서는 안쪽이 내려가 화난 눈처럼 보여서
      // 화면에서 수평으로 되돌린 뒤 바깥쪽을 더 내린다
      const heavy = new Group();
      const heavyBall = new Mesh(heavyGeo, ink);
      heavyBall.scale.setScalar(s);
      heavyBall.position.z = s * 0.12;
      const heavyShine = new Mesh(sphere, white);
      heavyShine.scale.setScalar(s * 0.2);
      heavyShine.position.set(s * 0.26, -s * 0.12, s * 0.46);
      const lidLine = new Mesh(
        new TubeGeometry(
          new CatmullRomCurve3(heavyLid.map((p) => p.clone().multiplyScalar(s))),
          24,
          s * 0.13,
          8,
        ),
        ink,
      );
      lidLine.position.z = s * 0.4;
      heavy.add(heavyBall, heavyShine, lidLine);
      for (const end of [heavyLid[0], heavyLid.at(-1)]) {
        const cap = new Mesh(sphere, ink);
        cap.scale.setScalar(s * 0.13);
        if (end)
          cap.position
            .copy(end)
            .multiplyScalar(s)
            .setZ(s * 0.4);
        heavy.add(cap);
      }
      heavy.rotation.z = level - side * 0.22;
      // 팔자 눈썹: 안쪽(얼굴 가운데 쪽)이 올라가고 바깥으로 둥글게 내려간다. 곧은 막대는 찡그린 눈썹처럼 보여서 둥근 선
      const browPts = [
        new Vector3(-side * s * 0.5, s * 1.74, 0),
        new Vector3(side * s * 0.12, s * 1.7, 0),
        new Vector3(side * s * 0.66, s * 1.32, 0),
      ];
      const brow = new Mesh(new TubeGeometry(new CatmullRomCurve3(browPts), 16, s * 0.1, 8), ink);
      const browGroup = new Group();
      browGroup.add(brow);
      for (const end of [browPts[0], browPts[2]]) {
        const cap = new Mesh(sphere, ink);
        cap.scale.setScalar(s * 0.1);
        if (end) cap.position.copy(end);
        browGroup.add(cap);
      }
      browGroup.rotation.z = level;
      const shade = new Mesh(sphere, shadeMat);
      shade.scale.set(s * 0.82, s * 0.2, s * 0.08);
      shade.position.set(0, -s * 1.3, s * 0.02);
      g.add(browGroup, shade);
      // 늘 보이는 눈썹 (설계도 face.brows): 눈 위 짧은 선. tilt 가 양수면 안쪽 끝이 올라간 순한 눈썹
      if (f.brows) {
        // 짧고 가는 선 (길고 굵으면 눈 위에서 찡그린 눈썹으로 읽혔다). 높이는 눈 크기와 상관없이 설계도 크기로 잰다
        const by = f.brows.y ?? f.eyeY + f.eyeSize * 2.3;
        const bg = place(side * f.eyeGap, by, 0.003);
        const tilt = ((f.brows.tilt ?? 0) * Math.PI) / 180;
        const bw = f.eyeSize * 0.42;
        const dy = Math.sin(tilt) * bw;
        const line = stroke([-side * bw, dy], [side * bw, -dy], f.eyeSize * 0.1, this.inkOf(f.brows.color));
        line.rotation.z += levelRoll(bg);
        bg.add(line);
      }
      const states = { open, down, up, chevron, half, drowsy, heavy };
      for (const o of Object.values(states)) g.add(o);
      eyes.push({ side, states, open, heavy, brow: browGroup, shade });
    }

    const m = s;
    // 주둥이에 붙는 입과 코는 털 끝까지 띄우지 않는다 (실사 옆모습에서 코가 주둥이 앞에 떠 보였다)
    const muzzleLift = muzzle ? 0.3 : 1;
    const mouthAt = place(0, f.mouthY, 0.002, muzzleLift);
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
        // 코를 따로 정하지 않은 고양이 입은 분홍 코
        if (!f.nose) {
          const nose = new Mesh(sphere, this.material(f.blush ?? '#ff8fa0', 'shiny'));
          nose.scale.set(m * 0.5, m * 0.32, m * 0.3);
          nose.position.set(0, m * 1.05, m * 0.05);
          mouthAt.add(nose);
        }
      } else if (f.mouth === 'grin') {
        // 활짝 벌린 입: 웃는 호 안을 어둡게 채우고 혀를 내민다
        const grin = new Group();
        const rim = arc(m * 1.2, m * 0.16, ink, true);
        rim.position.y = m * 0.55;
        const inside = new Mesh(sphere, dark);
        inside.scale.set(m * 1.08, m * 0.72, m * 0.3);
        inside.position.set(0, m * 0.05, -m * 0.02);
        const tip = new Mesh(sphere, tongue);
        tip.scale.set(m * 0.5, m * 0.42, m * 0.22);
        tip.position.set(0, -m * 0.3, m * 0.14);
        grin.add(rim, inside, tip);
        // 내민 혀 (face.tongue): 입 아래로 늘어진 분홍 혀, 가운데 골. 입체로 빛을 받는다
        if (f.tongue) {
          const out = new Group();
          out.position.set(0, -m * 0.25, m * 0.2);
          out.rotation.x = 0.35;
          const blade = new Mesh(sphere, this.material('#e8798a', 'soft'));
          blade.scale.set(m * 0.95, m * 1.6, m * 0.32);
          blade.position.y = -m * 1.1;
          const groove = stroke(
            [0, -m * 0.2],
            [0, -m * 1.7],
            m * 0.08,
            new MeshBasicMaterial({ color: '#c4566a' }),
          );
          groove.position.z = m * 0.33;
          out.add(blade, groove);
          grin.add(out);
        }
        mouth.smile = grin;
      } else if (f.mouth === 'tiny') {
        // 짧은 선 (인형의 박음질 입)
        mouth.smile = stroke([-m * 0.42, m * 0.3], [m * 0.42, m * 0.3], m * 0.13, ink);
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

    // 볼 터치는 만화 표현이라 실사에서는 뺀다
    if (f.blush && !this.furry) {
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
        // 빗금 볼 (face.blushLines): 짧은 사선 셋, 볼 색보다 진한 선
        if (f.blushLines) {
          const lines = new Group();
          const mat = this.inkOf(`#${new Color(f.blush).multiplyScalar(0.62).getHexString()}`);
          for (const dx of [-0.75, 0, 0.75])
            lines.add(
              stroke([s * (dx - 0.18), -s * 0.38], [s * (dx + 0.18), s * 0.38], s * 0.075, mat, s * 0.08),
            );
          lines.rotation.z = levelRoll(g);
          g.add(lines);
        }
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
    let noseAt: Group | undefined;
    // 코 (설계도 face.nose): 눈과 입 사이. 세모(고양이, 토끼), 납작한 타원(강아지), 점. 위에 작은 반짝이
    if (f.nose?.color && f.nose.shape !== 'none') {
      const k = s * (f.nose.size ?? 1);
      const g = place(0, f.nose.y ?? f.mouthY + s * 1.0, 0.004, muzzleLift);
      noseAt = g;
      const mat = this.material(f.nose.color, 'shiny');
      let nose: Mesh;
      if (f.nose.shape === 'triangle') {
        nose = new Mesh(new ConeGeometry(1, 1.6, 24), mat);
        nose.rotation.z = Math.PI;
        nose.scale.set(k * 0.58, k * 0.5, k * 0.32);
      } else if (f.nose.shape === 'oval') {
        nose = new Mesh(sphere, mat);
        nose.scale.set(k * 0.64, k * 0.46, k * 0.36);
      } else {
        nose = new Mesh(sphere, mat);
        nose.scale.set(k * 0.4, k * 0.36, k * 0.3);
      }
      g.add(nose);
      if (!this.game) {
        const glint = new Mesh(sphere, white);
        glint.scale.setScalar(k * 0.11);
        glint.position.set(-k * 0.16, k * 0.14, k * 0.3);
        g.add(glint);
      } else this.addOutline(nose);
    }
    // 볼 털 (설계도 face.fluff): 볼 옆으로 바깥 아래를 향해 뻗는 털 뭉치
    if (f.fluff) {
      // 얼굴 가장자리(볼 바깥)에 붙여 털이 실루엣 밖으로 삐져나오게. 눈과 수염과 겹치지 않는다
      const halfW = faceBox.isEmpty() ? f.eyeGap * 2.4 : (faceBox.max.x - faceBox.min.x) / 2;
      const cx = faceBox.isEmpty() ? 0 : (faceBox.max.x + faceBox.min.x) / 2;
      for (const side of [-1, 1]) {
        const g = place(cx + side * halfW * 0.9, f.mouthY + s * 0.2, -0.004);
        const size: Vec3 = [s * 1.25, s * 1.7, s * 0.7];
        const part: Part = {
          slot: f.slot,
          shape: 'tuft',
          at: [0, 0, 0],
          size,
          color: f.fluff,
          finish: 'fuzzy',
        };
        const tuft = new Mesh(tuftGeometry(), this.material(f.fluff, 'fuzzy'));
        tuft.scale.set(...size);
        // 바깥 아래로 (볼 털은 옆으로 뻗고 조금 처진다). 얼굴 무리는 겉면을 보고 있어 화면 기준으로 되돌린다
        tuft.rotation.z = levelRoll(g) - side * (Math.PI / 2 + 0.45);
        tuft.userData.part = part;
        if (this.real) this.addFur(tuft, part);
        if (this.game) this.addOutline(tuft);
        g.add(tuft);
        // 볼 털은 일부러 실루엣 밖으로 뻗는다: 비스듬히 볼 때 납작하게 하지 않는다 (hideHiddenFace)
        g.userData.tuft = true;
      }
    }
    if (muzzle) {
      hug(mouthAt);
      if (noseAt) hug(noseAt);
    }
    return { eyes, mouth, beakLower, style: f.mouth, eyeLook: f.eyes ?? 'round', groups, mouthAt, noseAt };
  }

  /**
   * 크기 배율 (AI 일러스트 아기, 청소년 펫을 작게). 그리기, 머리 꼭대기, 눈 자리가 모두 fit.d 를 따라서
   * 발은 바닥에 그대로 있고 말풍선과 누르기(불투명한 곳)도 맞는다. 같으면 아무것도 안 한다
   */
  setSizeScale(k: number): void {
    const next = Number.isFinite(k) && k > 0 ? k : 1;
    if (next === this.sizeK) return;
    this.sizeK = next;
    this.fit.d = this.fitD * next;
  }

  /** 쉬는 자세가 2D 캔버스 안 바닥에 서도록 카메라와 옮길 자리를 정한다 */
  private frameCamera(fixed?: Box3) {
    this.root.rotation.set(0, 0, 0);
    this.root.scale.set(1, 1, 1);
    this.root.updateMatrixWorld(true);
    // 입는 옷은 빼고 잰다: 모자를 써도 펫 크기와 자리가 그대로다
    const b = fixed?.clone() ?? new Box3();
    const worn = (o: Object3D | null): boolean =>
      !!o && o !== this.root && (!!(o.userData.part as Part | undefined)?.wear || worn(o.parent));
    this.root.traverse((o) => {
      // 모양이 있는 것마다 (자식까지 넣어도 겹칠 뿐이다). 옷 메시와 그 테두리는 뺀다
      if (fixed || !('geometry' in o) || worn(o)) return;
      b.expandByObject(o, false);
    });
    if (b.isEmpty()) b.setFromObject(this.root);
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
    // 바닥(발 끝)은 상자 모서리가 아니라 실제 몸에서 가장 아래 보이는 점으로. 카메라가 살짝 위에서 보니 상자 앞 아래
    // 모서리는 발보다 낮게 비쳐, 그 자리를 바닥에 두면 펫이 그림자 위로 떠 보였다
    const low = this.lowestNdc();
    const bottom = low !== undefined && low > minY ? low : minY;
    const o = c.clone().project(this.camera);
    this.unitNdc = Math.abs(
      c
        .clone()
        .add(new Vector3(1, 0, 0))
        .project(this.camera).x - o.x,
    );
    this.fitD = d;
    this.fit = { d: d * this.sizeK, cx: (minX + maxX) / 2, bottom, halfW: (maxX - minX) / 2 };
    // 숫자가 깨지면(빈 몸 등) 그리지 않고 2D 로 돌아간다
    if (!Object.values(this.fit).every(Number.isFinite) || d <= 0) this.ready = false;
  }

  /** 보이는 몸 꼭짓점 가운데 화면(NDC)에서 가장 아래 y. 꼭짓점이 많으면 건너뛰며 본다. 없으면 undefined */
  private lowestNdc(): number | undefined {
    let low: number | undefined;
    const v = new Vector3();
    this.root.traverse((o) => {
      if (!(o instanceof Mesh) || !o.visible) return;
      const pos = o.geometry.getAttribute('position');
      if (!pos) return;
      // 숨긴 조상이 있으면(손 흔들 앞발 등) 보이지 않는다
      for (let a: Object3D | null = o.parent; a; a = a.parent) if (!a.visible) return;
      const step = Math.max(1, Math.floor(pos.count / 4000));
      for (let i = 0; i < pos.count; i += step) {
        v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld).project(this.camera);
        if (low === undefined || v.y < low) low = v.y;
      }
    });
    return low;
  }

  /**
   * 카메라를 몸 가운데에서 dist 만큼, 살짝 위(9도)에 tilt 를 더한 높이에 둔다.
   * 2.5D 판은 정면(0도)에서: 평평한 사진을 부풀린 판이라 위에서 보면 앞으로 부푼 배가 아래로 쏠려
   * 아래쪽이 턱처럼 뾰족해지고 두 발이 붙어 보였다 (2026-10-10 검토)
   */
  private aim(tilt: number) {
    const { c, dist } = this.orbit;
    const el = (this.relief ? 0 : 9 * DEG) + tilt;
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
    this.reliefEyes(s, act);
    let y = 0;
    let z = 0;
    let x = 0;
    // 같이 보기 중(peer)에는 삐져도 그쪽을 본다
    if (s.mood === 'sulky' && !s.peer) y = 0.42;
    if (s.mood === 'sleeping' || s.mood === 'dozing') x = 0.12;
    if (s.mood === 'grabbed') z = 0.08;
    if (s.mood === 'thinking') z = 0.06;
    // 걸을 때는 가는 쪽으로 돌고, 걸음마다 까딱이며 가는 쪽으로 살짝 숙인다 (photo-motion.ts, 출발과 멈춤에서 0 이라
    // 멈추는 틀에 툭 서지 않는다). 화면에서 시계 방향 + 인 각을 three 의 z 돌림(반시계 +)으로 뒤집어 넣는다
    let lean = 0;
    if (act?.type === 'walk') {
      y = act.dir * 0.35;
      const st = photoStep(act, s.calm);
      z = -st.rock;
      lean = -st.lean;
    } else if (act?.type === 'look') y = act.dir * 0.4;
    const g = gazeOf(s, act);
    if (g) {
      y = g.x * 0.3;
      x = -g.y * 0.08;
    }
    // 삐치거나 걷기 시작할 때, 두리번거릴 때 한 틀에 돌지 않고 짧게 돌아간다
    y = this.ease.to('heading', y, HEADING_TAU);
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
    // 그림 휘기: 숨은 늘 (자면 느리고 깊게), 고개는 생각, 쳐다보기, 몸짓에 따라 기운다
    const w = this.relief?.warp;
    if (w) {
      const t = s.elapsed / 1000;
      const asleep = s.mood === 'sleeping' || s.mood === 'dozing';
      // 숨과 살랑임은 계속 그릴 때만 (가끔 그리는 프레임마다 다른 위상을 집어 몸이 툭툭 튀었다)
      const live = !!s.breathe && !s.calm;
      w.uBreath.value = live ? Math.sin(t * (asleep ? 1.1 : 2.2)) * (asleep ? 1.3 : 1) : 0;
      let tilt = live ? Math.sin(t * 1.3) * 0.03 : 0;
      if (s.mood === 'thinking') tilt += 0.12;
      if (g) tilt += -g.x * 0.08;
      if (mv) tilt += mv.tilt * 0.6;
      w.uTilt.value = Math.max(-0.22, Math.min(0.22, tilt));
      // 머리를 기울이는 만큼 몸 전체 기울기는 덜
      z *= 0.5;
    }
    // 걷다 거꾸로 돌아서면 잠깐 좁아졌다 돌아온다 (판은 옆이 안 보이게 25도까지만 돌아서 돌기만으로는 돌아선 줄 몰랐다)
    const turnT = this.reliefTurn.update(s.now, act?.type === 'walk' ? act.dir : undefined);
    this.turning = turnT >= 0;
    const turn = turnSquash(turnT, s.calm);
    this.root.scale.set(sx * turn.sx, sy * turn.sy, sx);
    z += lean;
    this.root.rotation.set(x, Math.max(-max, Math.min(max, y + this.spin * 0.4)), z);
  }

  /** 2.5D 판도 사진처럼 잠, 졸음, 깜빡임에 눈을 감는다 (눈 자리를 아는 그림만, 2026-10-12) */
  private reliefEyes(s: DrawState, act: Act) {
    const r = this.relief;
    if (!r) return;
    const open = s.photoEyes
      ? photoEyeOpen({ ...s, activity: act, moveEyes: movePoseOf(act, s.calm)?.eyes, sulk: sulkStage(s) })
      : 1;
    if (open === r.open) return;
    r.open = open;
    const g = r.canvas.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, r.canvas.width, r.canvas.height);
    g.drawImage(eyedPhoto(r.photo, s.photoEyes, open), 0, 0);
    r.texture.needsUpdate = true;
  }

  private pose(s: DrawState, sx: number, sy: number, act: Act) {
    if (this.relief) {
      this.poseRelief(s, sx, sy, act);
      return;
    }
    if (this.stance) {
      this.poseStance(s, sx, sy, act);
      return;
    }
    const j = this.joints;
    for (const slot of SLOTS) j[slot].rotation.set(0, 0, 0);
    for (const arm of [j.body, j.armL, j.armR, j.wingL, j.wingR, j.legL, j.legR])
      if (arm.userData.base) arm.position.copy(arm.userData.base);
    if (this.wavePaw) this.wavePaw.visible = false;
    if (this.keys) this.keys.group.visible = false;
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
    // 숨쉬기: 몸통이 살짝 부풀었다 꺼진다 (자면 느리고 깊게). 계속 그릴 때만 (가끔 그리는 틀마다 다른 위상을 집으면 툭툭 튄다).
    // 몸 관절의 축은 몸 바닥이라 발은 그대로고 머리가 숨을 따라 조금 오르내린다
    const asleep = mood === 'sleeping' || mood === 'dozing';
    if (s.breathe && !s.calm) {
      const b = Math.sin((e / 1000) * (asleep ? 1.1 : 2.3)) * (asleep ? 1.3 : 1);
      j.body.scale.set(1 + 0.007 * b, 1 + 0.012 * b, 1 + 0.01 * b);
    } else j.body.scale.set(1, 1, 1);
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
    // 걷기: 걷는 동안 세기 1, 멈추면(따라 달리다 서기, 걷기 끝) 다리와 숙인 몸을 짧게 푼다.
    // 걷기가 끝나도 세기가 남아 있으면 마지막 걸음으로 이어 그린다 (한 틀에 정면 선 자세로 바뀌지 않게)
    const stepping = act?.type === 'walk' ? act : undefined;
    if (stepping) this.lastWalk = { dir: stepping.dir, phase: stepping.phase, stride: stepping.stride };
    const calmBody = mood === 'idle' || mood === 'sulky';
    const blend = this.ease.to('walk', stepping ? 1 : 0, calmBody ? WALK_OUT_TAU : 0);
    const walk: Extract<Act, { type: 'walk' }> | undefined =
      stepping ?? (blend > 0 && calmBody && this.lastWalk ? { type: 'walk', ...this.lastWalk } : undefined);
    // 몸이 향한 쪽: 삐지면 고개를 돌린다 (얼굴이 보이게 옆으로만). 매운맛 토라짐: 흥(2단계)이면 더 홱, 3단계면 등을 돌린다.
    // 걸으면 가는 쪽으로 (네 발은 더 옆으로). 한 틀에 돌지 않고 짧게 돌아선다
    let heading = mood === 'sulky' && !s.peer ? ([0, 0.8, 1.15, Math.PI][sulkStage(s)] ?? 0.8) : 0;
    if (stepping) heading = stepping.dir * (this.quad ? 1.1 : 0.75) * walkEnvelopeOf(stepping).turn;
    this.root.rotation.y = this.ease.to('heading', heading, HEADING_TAU) + this.spin;
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
        // 머리와 옆으로 나온 팔이 있으면(냥이, 멍멍이) 오른손을 앞으로 들어 턱 밑에 괸다.
        // 몸이 곧 얼굴인 콩이는 팔을 바깥 위로 (턱이 따로 없다)
        if (this.hasHead && this.hasHand) j.armR.rotation.set(-2.1, 0, -0.85);
        else j.armR.rotation.set(-0.9, 0, 0.9);
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
        // 흥(매운맛 토라짐 2단계부터): 턱을 살짝 들고 흘겨본다, 귀는 뒤로 젖힌다
        if (sulkStage(s) >= 2) {
          head(-0.14, 0, 0);
          eye = 'half';
          j.earL.rotation.z = 0.22 * ear;
          j.earR.rotation.z = -0.22 * ear;
        }
        break;
    }
    if (walk && this.quad) {
      this.walkQuad(this.quad, walk, blend);
    } else if (walk) {
      // 두 발: 다리와 팔 흔들기도 출발과 멈춤에 맞춰 줄인다 (멈춘 몸에서 다리만 헛돌지 않게)
      const go = walkEnvelopeOf(walk).stride * blend;
      const w = Math.sin(walk.phase * Math.PI * 2) * go;
      this.stepBiped(walk, go);
      j.armL.rotation.x = -w * 0.6 * sway;
      j.armR.rotation.x = w * 0.6 * sway;
      j.tail.rotation.y = w * 0.35 * tail;
      j.top.rotation.z = w * 0.12 * sway;
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
    // 두리번: 고개를 그쪽으로 돌렸다가 끝나면 다시 앞으로 (한 틀에 돌지 않게)
    const lookYaw = this.ease.to('lookYaw', act?.type === 'look' ? act.dir * 0.55 : 0, HEADING_TAU);
    if (lookYaw !== 0) {
      if (this.hasHead) j.head.rotation.y += lookYaw;
      else this.root.rotation.y += lookYaw * 0.6;
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
    // 같이 타자 치기, 쪽지 들기, 같이 일하기 (together-draw.ts): 앞발(팔, 날개)을 몸 앞으로 모아 키보드를 번갈아 누르고,
    // 쪽지는 두 팔로 몸 앞에 든다. 같이 일할 때는 오른팔을 조금 들어 연필을 쥔다 (연필과 키보드는 draw.ts 가 위에 그린다)
    if (!walk && !trick) {
      const tap = tapOf(s, act);
      if (tap) {
        const [l, r] = tapPaws(tap.ms, s.calm);
        this.forePaws(tap.k, (slot) => ({ press: slot.endsWith('L') ? l : r }), [l, r]);
      } else if (noteOf(s, act)) this.forePaws(1, () => 'hold');
      else if (workOf(s) !== undefined && !mv) {
        this.forePaws(1, () => 'pen');
        if (mouth === 'smile') mouth = 'flat';
      }
    }
    // 공을 물 때 고개를 숙이고 몸도 조금 앞으로 (shared/fetch.ts pickPose)
    const dip = s.carry?.dip ?? 0;
    if (dip > 0) {
      head(0.7 * dip, 0, 0);
      j.body.rotation.x += 0.3 * dip;
    }
    // 커서 바라보기: 고개를 그쪽으로 (위를 보면 고개를 든다)
    const g = gazeOf(s, act);
    // 양수 x 가 고개를 숙이는 쪽 (잘 때 0.28). 아래는 조금만 숙인다 (많이 숙이면 눈이 찡그린 듯 납작해 보였다)
    if (g) head(g.y > 0 ? g.y * 0.12 : g.y * 0.22, g.x * 0.5, 0);
    this.setFace(eye, mouth, s, wide);
    this.hideHiddenFace();
  }

  /**
   * 옆이나 뒤로 돌아 안 보이는 얼굴 부품은 숨긴다 (가장자리에 조각처럼 떠 보였다). 부리는 옆에서도 보인다.
   * 얼굴 전체가 아니라 부품마다 겉면이 향한 쪽으로 본다: 옆모습에서 가까운 눈과 볼은 보이고 먼 쪽만 숨는다
   * (펫 만들기 미리보기에서 360도 돌릴 때 옆얼굴이 밋밋한 공처럼 보였다)
   */
  private hideHiddenFace() {
    if (this.face) {
      this.root.updateMatrixWorld(true);
      const { at, n, eye } = this.faceTmp;
      for (const g2 of this.face.groups) {
        g2.getWorldPosition(at);
        n.setFromMatrixColumn(g2.matrixWorld, 2).normalize();
        const facing = n.dot(eye.copy(this.camera.position).sub(at).normalize());
        // 네 발로 선 몸의 코는 주둥이 끝에 솟아 옆모습에서도 보인다 (옆으로 걸을 때 코 없는 주둥이가 되었다)
        const nose = !!this.stance && g2 === this.face.noseAt;
        const beak = g2 === this.face.mouthAt && this.face.style === 'beak';
        g2.visible = facing > (nose ? -0.15 : 0.25) || beak;
        // 비스듬히 보일수록 눈, 입을 겉면 쪽으로 납작하게 (먼 눈과 입이 실루엣 밖으로 삐져나왔다. pet3d-motion.ts faceDepth)
        const keep = keepsFaceDepth({
          nose: g2 === this.face.noseAt,
          beak,
          tuft: g2.userData.tuft === true,
          stance: !!this.stance,
        });
        g2.scale.z = faceDepth(facing, keep);
      }
    }
  }

  /**
   * 네 발로 선 몸의 자세 (pet3d-stance.ts). 바라는 자세(서기, 앉기, 엎드리기)를 짧게 따라가며 섞고, 몸통을 그 자세로 놓은 뒤
   * 발 자리를 정해 다리마다 두 마디로 푼다. 걸을 때는 옆으로 돌아 옆 차례 걸음(빠르면 속보)으로 몸이 간 만큼 딛는다.
   * 디딘 발은 바닥에서 미끄러지지 않고, 그림 전체를 띄우지 않는다
   */
  private poseStance(s: DrawState, sx: number, sy: number, act: Act) {
    const st = this.stance;
    if (!st) return;
    const j = this.joints;
    const d = st.dims;
    const L = st.leg;
    for (const slot of SLOTS) j[slot].rotation.set(0, 0, 0);
    j.head.position.copy(st.headBase);
    j.tail.position.copy(st.tailBase);
    this.root.rotation.set(0, 0, 0);
    this.root.position.set(0, 0, 0);
    const live = s.now !== undefined;
    const { mood, elapsed: e } = s;
    const { sway, tail, ear } = this.motion;
    const asleep = mood === 'sleeping' || mood === 'dozing';
    // 걷기 (끝나면 마지막 걸음에서 짧게 풀린다)
    const stepping = act?.type === 'walk' ? act : undefined;
    if (stepping) {
      this.lastWalk = {
        dir: stepping.dir,
        phase: stepping.phase,
        stride: stepping.stride,
        steps: stepping.steps,
      };
      if (live && s.now !== undefined) {
        this.walkedAt = s.now;
        this.walkedDir = stepping.dir;
      }
    }
    const calmBody = mood === 'idle' || mood === 'sulky';
    const go = this.ease.to('walk', stepping ? 1 : 0, calmBody ? WALK_OUT_TAU * 1.6 : 0);
    const walk: Extract<Act, { type: 'walk' }> | undefined =
      stepping ?? (go > 0 && calmBody && this.lastWalk ? { type: 'walk', ...this.lastWalk } : undefined);
    const trick = trickOf(s);
    const mv = movePoseOf(act, s.calm);
    const tap = !walk && !trick ? tapOf(s, act) : undefined;
    const held = !walk && !trick && !tap && !!noteOf(s, act);
    const pen = !walk && !trick && !tap && !held && workOf(s) !== undefined && !mv;
    const goal: StanceGoal = stanceGoal({
      mood,
      act: act?.type,
      trick: trick?.type,
      sinceWalk: live && s.now !== undefined ? s.now - this.walkedAt : undefined,
      hands: !!tap || held || pen,
    });
    // 자세 무게: 앉기 몸짓(act sit)은 앉은 채 엎드린다 (down 만큼)
    const down = act?.type === 'sit' && goal === 'lie' ? (act.down ?? 1) : goal === 'lie' ? 1 : 0;
    const sitT = goal === 'sit' ? 1 : act?.type === 'sit' && goal === 'lie' ? 1 - down : 0;
    const w = {
      sit: this.ease.to('sit', sitT, 150),
      lie: this.ease.to('lie', down, act?.type === 'sit' ? 60 : 170),
    };
    const standW = Math.max(0, 1 - w.sit - w.lie);
    // 몸이 향한 쪽: 걸으면 가는 쪽 옆모습(얼굴이 조금 보이게), 서 있으면 3/4, 앉으면 거의 앞, 자면 비스듬히.
    // 집 문으로 들어가면 등을, 나오면 얼굴을 보인다. 한 장만 그릴 때(얼굴 아이콘, 집 그림)는 앞을 본다
    const env = walk ? walkEnvelopeOf(walk) : { stride: 0, turn: 0, lean: 0 };
    const side = this.walkedDir;
    let heading = live ? side * (0.6 * standW + 0.2 * w.sit + 0.5 * w.lie) : 0;
    if (stepping) {
      const away = stepping.facing === 'away';
      const toward = stepping.facing === 'toward';
      // 출발하고 멈추며 돌 때는 선 자세의 방향(3/4)과 걷는 방향 사이를 오간다. 멈추며 앞(0)까지 돌았다가 다시 3/4 로
      // 돌아오면 디딘 발이 몸을 따라 두 번 밀려 다리가 벌어지고 엇갈렸다 (한 장 그림은 선 자세 방향이 앞이라 그대로)
      const walkHeading = stepping.dir * (away ? Math.PI - 0.55 : toward ? 0.45 : 1.38);
      heading += (walkHeading - heading) * env.turn;
    }
    if (mood === 'sulky' && !s.peer) heading = side * ([0, 0.8, 1.15, Math.PI][sulkStage(s)] ?? 0.8);
    if (asleep && live) heading = side * 0.45;
    // 디딘 발이 따라 돌지 않게 발을 옮겨 디딜 틈을 두고 돈다 (초당 STANCE_TURN_RATE 라디안까지, pet3d-plant.ts)
    const yaw = this.ease.to('heading', heading, stepping ? HEADING_TAU : 240, STANCE_TURN_RATE / 1000);
    this.root.rotation.y = yaw + this.spin;
    // 그림 찌그러짐은 앉기, 기지개, 하품, 걷기에서 뺀다 (자세가 대신한다). 나머지(통통 뛰기)는 반만
    const squash =
      act?.type === 'walk' || act?.type === 'sit' || act?.type === 'stretch' || act?.type === 'yawn';
    const ksx = squash ? 1 : 1 + (sx - 1) * 0.5;
    const ksy = squash ? 1 : 1 + (sy - 1) * 0.5;
    this.root.scale.set(ksx, ksy, ksx);

    // 걸음: 몸이 간 거리로 센다 (act.steps × 한 걸음 길이를 펫 몸 단위로). 몸 단위 하나가 화면에서 몇 px 인지는
    // 바닥 높이에서 몸 앞쪽으로 한 단위 간 점을 비춰 잰다 (원근과 돌아선 각까지 맞아 디딘 발이 바닥에 붙어 있다)
    this.root.updateMatrixWorld(true);
    const g0 = this.root.localToWorld(this.faceTmp.at.set(0, d.pawY, 0)).project(this.camera).x;
    const g1 = this.root.localToWorld(this.faceTmp.n.set(0, d.pawY, 1)).project(this.camera).x;
    const pxPerUnit = Math.max(Math.abs(g1 - g0), this.unitNdc * 0.5) * (this.fit.d / 2);
    const strideWin = ((walk?.stride ?? 0) * (s.viewSize ?? 160)) / 160;
    const gait = gaitFor((strideWin / strideLen(WALK_SPEED)) ** 2);
    const cycle = L * STANCE_CYCLE * gait.cycleK;
    // 이어 그릴 때는 발 딛기(pet3d-plant.ts)가 몸이 간 거리를 이어 쌓아 걸음 박자를 센다 (빠르기가 바뀌어도 건너뛰지 않는다)
    const plant = live ? this.plantIn(stepping, heading, gait.kind, cycle, L) : undefined;
    const phase = plant
      ? plant.gait
        ? (this.planter.phase + Math.abs(plant.move) / cycle) % 1
        : this.planter.phase
      : !walk
        ? 0
        : walk.steps !== undefined && walk.stride && pxPerUnit > 0
          ? gaitPhase((walk.steps * walk.stride) / pxPerUnit, cycle)
          : walk.phase;
    const a = phase * Math.PI * 2;
    const trot = gait.kind === 'trot';

    // ---- 몸통 ----
    const stand: BodyPose = { pitch: 0, hip: { ...d.hip } };
    const body = blendPose(stand, st.sit, st.lie, w);
    let roll = 0;
    // 걸을 때 몸통은 걸음마다 살짝 오르내리고 좌우로 흔들린다 (속보는 더)
    if (walk) {
      body.hip.y += -Math.cos(a * 2) * L * (trot ? 0.035 : 0.018) * go;
      body.pitch += Math.sin(a * 2) * (trot ? 0.025 : 0.012) * go;
      roll = Math.sin(a) * 0.035 * sway * go;
    }
    // 기지개: 앞을 낮추고 엉덩이를 들어 앞발을 쭉 뻗는다 (고양이 기지개)
    const stretchK = act?.type === 'stretch' ? Math.sin(Math.min(1, act.t) * Math.PI) : 0;
    body.pitch -= 0.5 * stretchK;
    body.hip.y += 0.1 * L * stretchK;
    // 놀자 인사 (강아지 신남): 앞을 숙이고 엉덩이를 든다
    const bow = this.excite.bow;
    body.pitch -= 0.36 * bow;
    body.hip.y += 0.06 * L * bow;
    // 공을 물 때 앞을 숙인다
    const dip = s.carry?.dip ?? 0;
    body.pitch -= 0.18 * dip;
    // 몸 털기: 몸통을 좌우로 빠르게 비튼다
    if (mv) roll += mv.twist * 1.1;
    const pivot = { y: st.pivot.y, z: st.pivot.z };
    const turned = pitchAbout(d.hip, pivot, body.pitch);
    j.body.position.set(st.pivot.x, st.pivot.y + body.hip.y - turned.y, st.pivot.z + body.hip.z - turned.z);
    j.body.rotation.set(-body.pitch, 0, roll);
    // 숨쉬기 (계속 그릴 때만)
    if (s.breathe && !s.calm) {
      const b = Math.sin((e / 1000) * (asleep ? 1.1 : 2.3)) * (asleep ? 1.3 : 1);
      j.body.scale.set(1 + 0.008 * b, 1 + 0.012 * b, 1 + 0.004 * b);
    } else j.body.scale.set(1, 1, 1);

    // ---- 머리 ----
    let hx = body.pitch * (asleep ? 0.6 : 0.9);
    let hy = 0;
    let hz = 0;
    // 자면 고개를 앞발에 묻는다. 한 장만 그리는 자는 얼굴(집 침대 베개)은 얼굴이 보이게 조금만
    if (w.lie > 0) hx += (asleep ? (live ? 0.42 : 0.12) : 0.12) * w.lie;
    if (asleep) hy += -side * 0.35 * w.lie;
    if (mood === 'dozing') hx += 0.25 + Math.sin(e / 900) * 0.04;
    if (walk) {
      hx += Math.sin(a * 2) * 0.03 * go;
      hy += -walk.dir * 0.32 * env.turn * (stepping?.facing ? 0 : 1);
    }
    if (mood === 'thinking') hz += 0.2;
    if (mood === 'sulky' && sulkStage(s) >= 2) hx -= 0.14;
    if (act?.type === 'yawn') hx -= 0.35 * Math.sin(Math.min(1, act.t) * Math.PI);
    if (stretchK > 0) hx += 0.3 * stretchK;
    hx += 0.7 * dip;
    hy += this.ease.to('lookYaw', act?.type === 'look' ? act.dir * 0.6 : 0, HEADING_TAU);
    if (mv) {
      hx += mv.pitch;
      hy += mv.look * 0.6;
      hz -= mv.tilt;
    }
    if (trick?.type === 'wave') hz += waveSwing(trick.t) * 0.1 * sway;
    const g = gazeOf(s, act);
    if (g) {
      hx += g.y > 0 ? g.y * 0.15 : g.y * 0.25;
      hy += g.x * 0.55;
    }
    j.head.rotation.set(hx, Math.max(-1, Math.min(1, hy)), hz);
    // 앉으면 머리를 가슴 쪽으로 내리고 조금 앞으로 낸다 (몸통이 서면 머리가 긴 몸통 위에 얹혀 목이 드러났다).
    // 머리 관절은 몸통에 붙어 있어 몸통이 든 각(pitch)만큼 되돌려 바닥 기준으로 옮긴다
    if (w.sit > 0 && !this.fitting) {
      const down = HEAD_SINK.down * L * w.sit;
      const fwd = HEAD_SINK.fwd * L * w.sit;
      const c = Math.cos(body.pitch);
      const sn = Math.sin(body.pitch);
      j.head.position.y += -down * c - fwd * sn;
      j.head.position.z += -down * sn + fwd * c;
    }

    // ---- 꼬리, 귀 ----
    // 꼬리: 서면 위로, 앉으면 몸 옆 바닥에 감고, 자면 몸을 둘러 앞으로. 걸으면 살랑, 신나면 빠르게 흔든다
    // 먼저 뒤로 눕히고(x) 그다음 세로축으로 돌려(y) 몸 옆을 감는다
    j.tail.rotation.order = 'YXZ';
    let tx = -0.95 * w.sit - 1.15 * w.lie;
    let ty = side * (1.5 * w.sit + 2.1 * w.lie);
    let tz = 0;
    if (walk) ty += Math.sin(a) * 0.22 * tail * go;
    if (mood === 'excited') {
      ty += this.excite.wag * tail;
      tx += 0.35 * this.excite.tailUp;
      tz += this.excite.quiver;
    }
    if (mv) ty += mv.tail * 0.9 * tail;
    if (trick) ty += Math.sin(trick.t * Math.PI * 8) * 0.35 * tail;
    if (mood === 'grabbed') tx = 1.1;
    if (stretchK > 0) tx -= 0.5 * stretchK;
    if (mood === 'sulky' && sulkStage(s) >= 2) tz = side * 0.2;
    j.tail.rotation.set(tx, ty, tz);
    // 귀: 선 귀는 쫑긋, 늘어진 귀는 걸음과 몸짓에 따라 흔들린다
    let el = 0;
    let er = 0;
    if (walk) {
      const flap = Math.sin(a * 2) * (st.floppy ? 0.16 : 0.05) * ear * go;
      el += flap;
      er -= flap;
    }
    if (mood === 'excited') {
      el += Math.sin(e / 90) * 0.18 * ear;
      er -= Math.sin(e / 90) * 0.18 * ear;
    }
    if (mv) {
      el += mv.ears[0] * ear;
      er -= mv.ears[1] * ear;
    }
    if (asleep) {
      el += 0.2;
      er -= 0.2;
    }
    if (mood === 'sulky' && sulkStage(s) >= 2) {
      el += 0.3 * ear;
      er -= 0.3 * ear;
    }
    j.earL.rotation.z = st.floppy ? -el * 0.8 : el;
    j.earR.rotation.z = st.floppy ? -er * 0.8 : er;

    // ---- 다리 ----
    this.root.updateMatrixWorld(true);
    const sit = st.sit;
    const lie = st.lie;
    const airUnits = pxPerUnit > 0 ? Math.min(0.45 * L, this.air / pxPerUnit) : 0;
    const press = tap ? tapPaws(tap.ms, s.calm) : undefined;
    // 손 흔들기: 오른 앞발을 턱 높이까지 들어 조금 바깥으로 벌린다 (가슴 앞에 들면 흰 가슴에 묻혔다)
    const waving = trick?.type === 'wave';
    const waveUp = waving ? Math.min(1, trick.t * 5, (1 - trick.t) * 5) : 0;
    // 자세마다 바랄 발 자리 (root 기준 바닥). 걸음은 빼고 (걸음은 발 딛기가, 한 장 그림은 아래 footCycle 이 넣는다)
    const hips = new Map<LegId, Vector3>();
    const rest = {} as Record<LegId, { x: number; z: number }>;
    for (const leg of st.legs) {
      const hip = leg.hipG.getWorldPosition(new Vector3());
      this.root.worldToLocal(hip);
      hips.set(leg.id, hip);
      const sitZ = leg.front ? leg.foot.z : sit.hip.z + 0.26 * L;
      // 엎드리면 앞다리는 팔꿈치를 바닥에 대고 앞발을 앞으로 뻗는다 (스핑크스 자세). 팔꿈치가 바닥 아래로 꺾이지 않게
      // 지금 어깨 높이에서 팔꿈치가 바닥에 닿는 자리를 풀고 그 앞에 발을 둔다
      const elbowY = 0.05 * L * 3;
      const lieZ = leg.front
        ? hip.z -
          Math.sqrt(Math.max(0, leg.l1 ** 2 - (hip.y - elbowY) ** 2)) +
          Math.sqrt(Math.max(0, leg.l2 ** 2 - (elbowY - d.pawY) ** 2))
        : lie.hip.z + 0.5 * L;
      rest[leg.id] = { x: leg.foot.x, z: leg.foot.z * standW + sitZ * w.sit + lieZ * w.lie };
    }
    // 디딘 발은 바닥에 붙여 두고 몸이 가거나 돌면 옮겨 딛는다 (선 자세일 때. 앉고 엎드리고 들리고 뛰면 자세 그대로)
    const hold = this.ease.to(
      'hold',
      standW > 0.6 && mood !== 'grabbed' && mood !== 'excited' && this.air < 0.5 && stretchK < 0.05 ? 1 : 0,
      70,
    );
    const feet = plant
      ? this.planter.update({ now: s.now ?? 0, heading: this.root.rotation.y, rest, hold, L, ...plant })
      : undefined;
    this.lastFeet = feet;
    if (this.planter.busy && plant) this.ease.busy = true;
    for (const leg of st.legs) {
      const right = leg.id.endsWith('r');
      const hip = hips.get(leg.id) ?? new Vector3();
      const r = rest[leg.id];
      let x = r.x;
      let z = r.z;
      let y = d.pawY;
      let swing = -1;
      // 자세를 바꾸는 동안 옮기는 발은 살짝 들어 옮긴다 (바닥을 끌지 않게)
      y += (leg.front ? 0.1 * Math.sin(Math.PI * w.lie) : 0.14 * Math.sin(Math.PI * w.sit)) * L;
      const f = feet?.[leg.id];
      if (f) {
        x = f.x;
        z = f.z;
        y += f.lift;
        swing = f.swing;
      } else if (walk) {
        const c = footCycle(
          footPhase(leg.id, phase, gait.kind),
          DUTY[gait.kind],
          DUTY[gait.kind] * cycle,
          0.2 * L,
        );
        z += c.dz * go;
        y += c.dy * go;
        const u = footPhase(leg.id, phase, gait.kind);
        if (go > 0.5 && u >= DUTY[gait.kind]) swing = (u - DUTY[gait.kind]) / (1 - DUTY[gait.kind]);
      }
      if (leg.front) {
        z += 0.75 * L * stretchK + 0.32 * L * bow;
        if (mv) y += 0.16 * L * mv.legs[right ? 1 : 0];
        if (mood === 'thinking' && right) {
          y += 0.22 * L;
          z += 0.12 * L;
        }
        if (waving && right) {
          y += waveUp * (0.95 * L + waveSwing(trick?.t ?? 0) * 0.1 * L);
          z += waveUp * 0.4 * L;
        }
        if (press) y += 0.12 * L * (1 - (right ? press[1] : press[0])) * (tap?.k ?? 0);
        if (held || pen) {
          const k = held || right ? 1 : 0;
          y += 0.3 * L * k;
          z += 0.2 * L * k;
        }
      }
      y += this.excite.paws[leg.front ? (right ? 1 : 0) : 2] * L;
      // 뛰는 동안 발을 몸 쪽으로 접는다
      y += airUnits * 0.6;
      z += (leg.front ? -1 : 1) * airUnits * 0.25;
      // 들리면 다리가 늘어진다
      const grabbed = mood === 'grabbed';
      if (grabbed) {
        x = leg.foot.x;
        y = hip.y - (leg.l1 + leg.l2) * 0.9;
        z = hip.z + (leg.front ? 0.06 : -0.04) * L;
      }
      // 발목 자리 (발이 판판하면 발 가운데에서 늘 같은 만큼)
      const ax = x + leg.toAnkle.x;
      const ay = y + leg.toAnkle.y;
      const az = z + leg.toAnkle.z;
      // 옆으로 벗어난 만큼 엉덩이에서 다리를 벌린다 (돌아서며 디딘 발, 걸음의 옆 흔들림)
      const restDx = leg.foot.x + leg.toAnkle.x - leg.hip.x;
      const dx = ax - hip.x - restDx;
      const dy = Math.max(1e-4, hip.y - ay);
      const abduct = Math.atan2(dx, dy);
      const solved = solveLeg(
        { y: hip.y, z: hip.z },
        { y: hip.y - Math.hypot(dx, dy), z: az },
        leg.l1,
        leg.l2,
        leg.front ? -1 : 1,
      );
      const r1 = leg.rest1 - solved.a1 + body.pitch;
      // 흔드는 앞발은 몸 바깥쪽으로 벌린다 (오른다리는 -x 쪽이 바깥: 펫의 오른쪽이 화면 왼쪽)
      const out = waving && leg.front && right ? (leg.hip.x < 0 ? -1 : 1) * 0.35 * waveUp : 0;
      leg.hipG.rotation.order = 'ZYX';
      // 몸통이 좌우로 기운 만큼(roll) 되돌려 다리가 바닥 기준으로 벌어진다
      leg.hipG.rotation.set(r1, 0, abduct - roll - out);
      leg.kneeG.rotation.set(leg.rest2 - solved.a2 + body.pitch - r1, 0, 0);
      // 발: 디딘 발은 바닥에 판판하게. 드는 발은 처음에 발끝을 아래로 굽혀 차고(발바닥이 보인다) 내릴 때 편다.
      // 들린 몸은 발끝이 아래로 처진다
      const flex =
        swing >= 0
          ? swing < 0.55
            ? 0.85 * Math.sin((Math.PI * swing) / 0.55)
            : -0.2 * Math.sin((Math.PI * (swing - 0.55)) / 0.45)
          : grabbed
            ? 0.55
            : 0;
      leg.pawG.rotation.set(-(leg.rest2 - solved.a2) + flex, 0, -abduct);
    }

    // ---- 몸 전체 몸짓 ----
    if (mv) {
      this.root.rotation.y += mv.look * 0.15;
      this.root.rotation.z -= mv.turn;
      if (Math.abs(mv.turn) > 0.01) this.groundRoot();
    }
    if (trick?.type === 'dance') {
      const t = trick.t;
      const k = t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
      this.root.rotation.y += k * Math.PI * 2;
    }

    // ---- 얼굴 ----
    let eye: EyeState = 'open';
    let mouth: MouthState = s.hungry && mood === 'idle' ? 'wavy' : 'smile';
    if (mood === 'excited' || trick) eye = 'up';
    if (mood === 'grabbed') {
      eye = 'chevron';
      mouth = 'open';
    }
    if (asleep) {
      eye = mood === 'sleeping' ? 'down' : 'half';
      mouth = 'o';
    }
    if (mood === 'thinking' || mood === 'busy' || pen) mouth = 'flat';
    if (mood === 'talking') mouth = 'open';
    if (mood === 'sulky') {
      mouth = 'frown';
      if (sulkStage(s) >= 2) eye = 'half';
    }
    if (act?.type === 'yawn' && act.t > 0.15 && act.t < 0.85) {
      eye = 'down';
      mouth = 'yawn';
    }
    if (stretchK > 0.3) eye = 'up';
    let wide = false;
    if (mv) {
      if (mv.eyes) eye = MOVE_EYE[mv.eyes];
      if (mv.mouth) mouth = mv.mouth;
      wide = mv.eyes === 'wide';
    }
    this.setFace(eye, mouth, s, wide);
    this.hideHiddenFace();
  }

  /** 발 딛기(pet3d-plant.ts)에 줄 이번 틀의 몸: 몸이 무대 x 로 간 거리, 걸음 박자로 딛는지, 돌아가려는 각 */
  private plantIn(
    stepping: Extract<Act, { type: 'walk' }> | undefined,
    aim: number,
    kind: GaitKind,
    cycle: number,
    L: number,
  ): { move: number; gait?: { kind: GaitKind; duty: number; cycle: number; lift: number }; aim: number } {
    let move = 0;
    if (stepping?.steps !== undefined && stepping.stride) {
      const last = this.plantSteps;
      // 새 걷기(걸음 수가 줄었다)면 처음부터, 아니면 지난 틀에서 늘어난 걸음 수만큼 (창 px, 펫 그림 160 기준)
      const steps = stepping.steps;
      const px = (last && steps >= last ? steps - last : steps) * stepping.stride;
      this.plantSteps = steps;
      // 무대 x 로 몸 단위 하나가 화면에서 몇 px 인지 (바닥 높이, 원근 그대로)
      const y = this.stance?.dims.pawY ?? 0;
      const a = this.faceTmp.at.set(0, y, 0).project(this.camera).x;
      const b = this.faceTmp.n.set(1, y, 0).project(this.camera).x;
      const perUnit = Math.max(1e-6, Math.abs(b - a) * (this.fit.d / 2));
      move = (stepping.dir * px) / perUnit;
    } else this.plantSteps = undefined;
    const now = this.root.rotation.y - this.spin;
    const aligned = !!stepping && Math.abs(aim - now) < 0.1;
    return {
      move,
      aim: aim + this.spin,
      ...(aligned ? { gait: { kind, duty: DUTY[kind], cycle, lift: 0.2 * L } } : {}),
    };
  }

  /**
   * 앞발을 몸 앞으로 모은다 (같이 타자 치기, 쪽지 들기). k 는 모은 정도, l, r 은 누른 정도 0~1.
   * 앞발 관절을 몸 앞 키보드 위로 옮기고(pet3d-tap.ts) 누르지 않는 발은 조금 든다. board 면 입체 키보드도 보인다
   */
  private forePaws(
    k: number,
    aim: (slot: (typeof HANDS)[number]) => Parameters<typeof pawTarget>[2],
    board?: readonly [number, number],
  ) {
    const rig = this.tapRig;
    if (!rig) return;
    const j = this.joints;
    for (const slot of HANDS) {
      const base = j[slot].userData.base as Vector3 | undefined;
      const target = pawTarget(rig, slot, aim(slot));
      if (base && target) reachPaw(rig, slot, target, k, j[slot], base);
    }
    if (!board) return;
    const [l, r] = board;
    if (this.keys?.group.parent !== this.root) {
      // 펫을 다시 조립하면 옛 키보드는 옛 몸과 같이 버려졌다 (resetRoot). 새 몸에 새로 만든다
      this.keys = buildKeyboard(
        rig,
        (color, shiny) => this.material(color, shiny || this.furry ? 'shiny' : 'soft'),
        this.game ? (m) => this.addOutline(m) : undefined,
      );
      this.root.add(this.keys.group);
    }
    poseKeyboard(this.keys, k, [l, r]);
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
  /**
   * 두 발 걷기: 디딘 발은 몸이 간 만큼 뒤로 밀려 바닥에 붙어 있고 든 발은 앞으로 나간다 (pet3d-gait.ts bipedFoot).
   * 다리가 길면 관절에서 돌리고, 짧은 다리(큰 머리 꼬마 피규어)는 다리째 앞뒤로 옮긴다
   */
  private stepBiped(walk: Extract<Act, { type: 'walk' }>, go: number) {
    const j = this.joints;
    // 몸 앞쪽(+z)으로 1 단위 간 점이 화면 가로로 몇 px 인지 (돌아선 각과 원근까지)
    this.root.updateMatrixWorld(true);
    const g0 = this.root.localToWorld(this.faceTmp.at.set(0, 0, 0)).project(this.camera).x;
    const g1 = this.root.localToWorld(this.faceTmp.n.set(0, 0, 1)).project(this.camera).x;
    const pxPerUnit = Math.max(Math.abs(g1 - g0), this.unitNdc * 0.5) * (this.fit.d / 2);
    // 몸 앞쪽(+z)이 화면에서 가는 쪽인지 (아니면 다리 앞뒤를 뒤집는다)
    const fwd = Math.sign(g1 - g0) === -walk.dir ? -1 : 1;
    const bob = this.raiseBody();
    for (const [leg, swingAt] of [
      [j.legL, 0],
      [j.legR, 0.5],
    ] as const) {
      const drop = leg.userData.drop as number | undefined;
      const base = leg.userData.base as Vector3 | undefined;
      if (!drop || !base) continue;
      const f = bipedFoot(walk.phase, swingAt, walk.stride ?? 0, pxPerUnit, drop, go);
      leg.userData.planted = (((walk.phase - swingAt) % 1) + 1) % 1 >= 0.5;
      // x 돌림은 + 가 매단 발을 -z 로, 발끝을 아래로 보낸다. 몸이 들썩인 만큼 다리는 내려 디딘 발이 바닥에 그대로 있다
      leg.rotation.x = -fwd * (f.angle + f.pitch);
      leg.position.set(base.x, base.y + f.rise - bob, base.z + fwd * f.shift);
    }
  }

  /**
   * 걸음 들썩임(bodyBob, 160 캔버스 px)만큼 몸 관절을 올리고 그 높이(몸 단위)를 돌려준다. 다리는 그만큼 내려 디딘 발이
   * 바닥에 그대로 있게 한다 (그림 전체를 띄우면 디딘 발도 같이 떠올랐다)
   */
  private raiseBody(): number {
    if (!(this.bodyBob > 0)) return 0;
    this.root.updateMatrixWorld(true);
    const y0 = this.root.localToWorld(this.faceTmp.at.set(0, 0, 0)).project(this.camera).y;
    const y1 = this.root.localToWorld(this.faceTmp.n.set(0, 1, 0)).project(this.camera).y;
    const pxPerUp = Math.max(Math.abs(y1 - y0), this.unitNdc * 0.5) * (this.fit.d / 2);
    // 몸 관절 아래에서 잰 길이라 몸 크기 배율(sy)로 나눈다
    const bob = this.bodyBob / pxPerUp / Math.max(0.01, this.root.scale.y);
    const base = this.joints.body.userData.base as Vector3 | undefined;
    if (base) this.joints.body.position.set(base.x, base.y + bob, base.z);
    return bob;
  }

  private walkQuad(q: QuadRig, act: Extract<Act, { type: 'walk' }>, blend = 1) {
    const j = this.joints;
    const { sway, tail, ear } = this.motion;
    const e0 = walkEnvelopeOf(act);
    const env = { stride: e0.stride * blend, turn: e0.turn * blend, lean: e0.lean * blend };
    const lean = q.lean * env.lean;
    const a = act.phase * Math.PI * 2;
    const go = env.stride;
    // 보폭: 디딘 발이 몸이 간 만큼 뒤로 밀리게 (act.stride 는 한 걸음에 간 거리, 160 캔버스).
    // 한 걸음에 디딘 발 둘이 2 * stride 씩 민다. 옆으로 돈 만큼(1.1 라디안)만 화면 가로로 보인다
    const sweep = 4 * q.stride * this.unitNdc * (this.fit.d / 2) * Math.sin(1.1) * this.root.scale.x;
    // 다리가 아주 짧은 꼬마 피규어도 디딘 발이 몸을 따라 미끄러지지 않게 넓게 둔다 (예전 0.6~1.8 은 짧은 다리에서 모자랐다)
    const pace = act.stride && sweep > 0 ? Math.max(0.35, Math.min(3, act.stride / sweep)) : 1;
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
    const bob = this.raiseBody();
    for (const leg of q.legs) {
      const step = trotLeg(leg.id, act.phase);
      leg.g.userData.planted = step.lift === 0;
      const z = step.dz * q.stride * pace * go;
      const hz = leg.hip.z + (leg.id[0] === 'f' ? front : hind);
      // 숙여서 관절이 올라간 다리(뒷발)는 내리지 않고 늘여 바닥에 닿게 한다 (내리면 몸과 발 사이가 뜬다)
      const back = -hipRise(leg.hip.y, hz, lean);
      const reach = Math.max(0, -back);
      leg.g.scale.set(1, (leg.drop + reach) / Math.max(0.01, leg.drop), 1);
      const rise = Math.max(0, back) + step.lift * q.lift * Math.sqrt(pace) * go - bob;
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
    // 팔(두 발 몸을 네 발로 걷게 고른 냥이, 멍멍이, 콩이. 토순이 가슴 앞발)도 앞발처럼 딛는다: 숙인 만큼 되돌려 곧게
    // 바닥을 향하고, 같은 쪽 앞발과 같은 박자로 앞으로 나가며 들고 뒤로 민다 (늘어뜨린 채 매달려 가지 않게).
    // 몸통을 늘인 앉은 피규어는 앞발이 앞으로 나간 만큼 같이 나간다
    for (const [arm, id] of [
      [j.armL, 'fl'],
      [j.armR, 'fr'],
    ] as const) {
      const step = trotLeg(id, act.phase);
      arm.rotation.set(-lean - (step.dz * 0.45 + step.lift * 0.25) * go, 0, 0);
      const base = arm.userData.base as Vector3 | undefined;
      // 어깨 바깥에 늘어진 팔은 몸 밑으로 조금 당겨 앞발처럼 몸 아래를 딛는다 (옆으로 돌면 몸 가운데에 걸려 보였다)
      if (base) arm.position.set(base.x * (1 - 0.4 * k), base.y - bob, base.z + front);
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
    // 기운 (shared/energy.ts): 둥근 눈이면 지침은 눈꺼풀, 졸림은 감기 직전 눈. 졸림이나 녹초는 처진 눈썹, 녹초는 눈 밑 그늘.
    // 활발하면 눈이 조금 크다. 동그랗게 놀란 눈(몸짓 wide)에는 붙이지 않는다
    const energy = wide ? undefined : energyFace(s);
    const shown = restingEye(eye, f.eyeLook, eye === 'open' ? energy?.stage : undefined);
    const tiredFace = eye === 'open' && !!energy && (energy.stage === 'sleepy' || energy.worn);
    for (const e of f.eyes) {
      for (const [k, o] of Object.entries(e.states)) o.visible = k === shown;
      const small = s.mood === 'busy' ? 0.8 : wide ? 1.15 : energy?.stage === 'lively' ? 1.08 : 1;
      e.open.scale.set(small, small * Math.max(0.08, open), small);
      e.heavy.scale.set(1, Math.max(0.08, open), 1);
      e.brow.visible = tiredFace;
      e.shade.visible = eye === 'open' && !!energy?.worn;
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

/**
 * 2.5D 판을 납작하게 눌러 둘 비율 (0 이면 앞으로 안 부푼다, 1 이면 그대로). 칸마다.
 * 그림 테두리 쪽만 누른다: 몸이 그림 끝에 닿아 있으면(꽉 차게 오린 그림) 흐린 알파가 테두리에서 떨어지지 않아
 * 테두리째 앞으로 부풀었다. 그 줄이 카메라에 가까워 커 보여 아래 끝이 턱처럼 뾰족하게 튀어나왔다 (2026-10-10 검토).
 * 몸 아래 끝(발) 근처를 더 누르는 것도 해 봤는데, 검은 털에서 그늘진 띠가 보여 그만뒀다
 */
export function reliefFlatten(cols: number, rows: number): Float32Array {
  const out = new Float32Array(cols * rows);
  const rim = Math.max(2, Math.min(cols, rows) * 0.06);
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      const k = Math.min(1, Math.min(x, y, cols - 1 - x, rows - 1 - y) / rim);
      out[y * cols + x] = k * k * (3 - 2 * k);
    }
  return out;
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

/** 부품의 털 길이 (실사). fuzzy 는 복슬복슬, soft 는 짧은 솜털, shiny 는 없음 */
function furLength(p: Part): number {
  // 입는 옷에는 털이 없다 (철마다 옷)
  if (p.finish === 'shiny' || p.wear) return 0;
  return p.finish === 'fuzzy' ? 0.045 : 0.014;
}

/** 늘 같은 털 무늬가 나오게 씨앗 있는 난수 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 기억해 두는 녹인 몸 수 (관절 하나에 하나. 펫 둘, 셋 몫) */
const FUSED_KEEP = 24;

/** 털 깎기와 굴곡이 바꾸는 자리, 털 길이만 새로 뜬다 (나머지는 같이 쓴다) */
function copyFused(f: FusedMesh): FusedMesh {
  return { ...f, positions: f.positions.slice(), fur: f.fur.slice() };
}

/** 전에 녹인 몸을 한 걸음에 돌려준다 */
// biome-ignore lint/correctness/useYield: 녹이기 단계와 같은 모양으로 쓰려고 생성기로 둔다
function* reuseFused(f: FusedMesh): Generator<void, FusedMesh | undefined> {
  return copyFused(f);
}

/** 털을 덮는 옷 모양 (bow, tube 처럼 모양 거리를 모르는 것은 빼고) */
const COVER_SHAPES: ReadonlySet<string> = new Set(['sphere', 'cylinder', 'cone', 'box', 'torus']);

/** 옷 메시들을 관절 group 공간에서 본 덮개로 */
function coversOf(group: Object3D, wears: readonly Mesh[]): FuseCover[] {
  const gs = group.getWorldScale(new Vector3());
  return wears.map((w) => {
    const part = w.userData.part as Part;
    const inv = w.matrixWorld.clone().invert().multiply(group.matrixWorld);
    const ws = w.getWorldScale(new Vector3());
    return {
      shape: part.shape as FuseCover['shape'],
      inv: inv.elements,
      scale: Math.min(ws.x, ws.y, ws.z) / Math.max(1e-6, Math.min(gs.x, gs.y, gs.z)),
      ...(part.shape === 'sphere' && part.cut !== undefined ? { cut: part.cut } : {}),
    };
  });
}

/** 설계도의 털 느낌. 없으면 부품 겉 느낌으로: 복슬(fuzzy) 부품이 있으면 중간 길이, 없으면 짧은 솜털 */
function furOfBlueprint(bp: Blueprint): Fur {
  if (bp.fur) return bp.fur;
  return bp.parts.some((p) => p.finish === 'fuzzy')
    ? { length: 0.5, clump: 0.25 }
    : { length: 0.2, clump: 0.1 };
}

/** 부품 무늬 값 (shared/pet3d/pattern.ts patternMask 의 인자) */
interface PatternAt {
  pattern: Pattern;
  half: Vec3;
  scale: Vec3;
}

/** 재질 캐시 열쇠에 넣을 무늬 값 (같은 무늬, 같은 크기면 재질을 같이 쓴다) */
function patternKey(p: PatternAt): string {
  const r = (v: number) => Math.round(v * 100) / 100;
  return `${JSON.stringify(p.pattern)}/${p.half.map(r).join(',')}/${p.scale.map(r).join(',')}`;
}

type ShaderOf = Parameters<NonNullable<Material['onBeforeCompile']>>[0];

/**
 * 재질 셰이더에 손질을 하나 더한다. 이미 손질이 있으면 둘 다 하고, 프로그램 캐시 열쇠도 이어 붙인다
 * (three 는 열쇠가 같으면 같은 프로그램을 쓰니 손질마다 달라야 한다)
 */
function hook(m: Material, name: string, patch: (shader: ShaderOf) => void): void {
  const prev = m.onBeforeCompile;
  const prevKey = m.customProgramCacheKey;
  m.onBeforeCompile = (shader, renderer) => {
    prev?.call(m, shader, renderer);
    patch(shader);
  };
  m.customProgramCacheKey = () => `${prevKey ? prevKey.call(m) : ''}/jj-${name}`;
}

/**
 * 재질 손질. pattern: 무늬 색을 겉면 위에 섞는다 (모양 좌표로 같은 자리에 같은 무늬).
 * figure: 피규어 모습의 아래쪽 그늘(가벼운 AO)과 가장자리 빛 (비닐 피규어의 매끈한 입체감)
 */
function decorate(
  m: Material,
  opt: { pattern?: PatternAt; figure?: boolean; sculpt?: 'curl' | 'long' },
): void {
  const pat = opt.pattern;
  if (pat) {
    const uniforms = {
      ...patternUniforms(pat.pattern, pat.half, pat.scale),
      uPatColor: { value: new Color(pat.pattern.color) },
    };
    hook(m, `pattern-${pat.pattern.type}`, (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vJjP;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvJjP = position;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>\nvarying vec3 vJjP;\nuniform vec3 uPatColor;\n${PATTERN_GLSL}`,
        )
        .replace(
          '#include <color_fragment>',
          '#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, uPatColor, jjPattern(vJjP));',
        );
    });
  }
  if (opt.sculpt) {
    const curl = opt.sculpt === 'curl';
    hook(m, `sculpt-${opt.sculpt}`, (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nattribute vec3 jjFurP;\nvarying vec3 vJjFur;\nvarying vec3 vJjX;\nvarying vec3 vJjY;\nvarying vec3 vJjZ;',
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vJjFur = jjFurP;
          vJjX = normalize(modelViewMatrix[0].xyz);
          vJjY = normalize(modelViewMatrix[1].xyz);
          vJjZ = normalize(modelViewMatrix[2].xyz);`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>\nvarying vec3 vJjFur;\nvarying vec3 vJjX;\nvarying vec3 vJjY;\nvarying vec3 vJjZ;\n${SCULPT_GLSL}`,
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
          vec4 jjS = ${curl ? 'jjCurl(vJjFur)' : 'jjLong(vJjFur)'};
          // 한 픽셀보다 잘아지면 흐리게 (작은 화면에서 자글자글 깨지지 않게)
          float jjFade = clamp(1.7 - length(fwidth(vJjFur)) * ${curl ? '24.0' : '30.0'}, 0.0, 1.0);
          vec3 jjG = (jjS.y * vJjX + jjS.z * vJjY + jjS.w * vJjZ) * ${curl ? '0.013' : '0.006'} * jjFade;
          normal = normalize(normal - (jjG - dot(jjG, normal) * normal));
          float jjAo = mix(1.0, ${curl ? '0.6 + 0.48' : '0.9 + 0.11'} * jjS.x, jjFade);`,
        )
        .replace(
          '#include <opaque_fragment>',
          // 골은 조금 어둡게 (빛이 고르게 와도 털 결이 보인다)
          `outgoingLight *= jjAo;
          #include <opaque_fragment>`,
        );
    });
  }
  if (opt.figure) {
    hook(m, 'figure-shade', (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <opaque_fragment>',
        `{
          vec3 jjN = normalize(normal);
          // 아래를 보는 면은 바닥 그늘, 가장자리는 뒤에서 오는 빛을 조금 머금는다
          outgoingLight *= 1.0 - 0.16 * (0.5 - 0.5 * jjN.y);
          float jjRim = pow(1.0 - abs(jjN.z), 3.0);
          outgoingLight += diffuseColor.rgb * 0.1 * jjRim;
        }
        #include <opaque_fragment>`,
      );
    });
  }
}

/**
 * 새긴 털 결 (피규어 모습). jjCurl: 동글동글한 곱슬 뭉치 (3차원 세포 잡음, 뭉치 가운데가 볼록),
 * jjLong: 아래로 빗은 긴 털 결 (가로로 촘촘하고 세로로 긴 세포). 기울기를 셈으로 바로 구한다:
 * 화면 미분(dFdx)으로 구하면 작은 그림에서 2x2 픽셀 덩어리로 깨졌다
 */
const SCULPT_GLSL = `
vec3 jjHash3(vec3 p) {
  p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)));
  return fract(sin(p) * 43758.5453);
}
// 가장 가까운 점까지: x 거리, yzw 그 점으로 가는 방향 (칸 좌표)
vec4 jjCell(vec3 q) {
  vec3 i = floor(q);
  vec3 f = fract(q);
  float best = 9.0;
  vec3 near = vec3(0.0);
  for (int x = -1; x <= 1; x++)
    for (int y = -1; y <= 1; y++)
      for (int z = -1; z <= 1; z++) {
        vec3 o = vec3(float(x), float(y), float(z));
        vec3 r = o + jjHash3(i + o) - f;
        float d = dot(r, r);
        if (d < best) {
          best = d;
          near = r;
        }
      }
  return vec4(sqrt(best), near);
}
// 높이와 그 기울기 (세상 길이 좌표). 뭉치 가운데가 가장 높다
vec4 jjBumpOf(vec3 p, vec3 freq) {
  vec4 c = jjCell(p * freq);
  float d = min(1.0, c.x);
  float h = (1.0 - d) * (1.0 - d);
  vec3 g = c.x > 1e-4 ? 2.0 * (1.0 - d) * c.yzw / c.x * freq : vec3(0.0);
  return vec4(h, g);
}
vec4 jjCurl(vec3 p) {
  vec4 a = jjBumpOf(p, vec3(21.0));
  vec4 b = jjBumpOf(p + 0.37, vec3(37.0));
  return a * 0.8 + b * 0.3;
}
vec4 jjLong(vec3 p) {
  vec4 a = jjBumpOf(p, vec3(34.0, 4.5, 34.0));
  vec4 b = jjBumpOf(p + 0.21, vec3(60.0, 7.0, 60.0));
  return a * 0.7 + b * 0.35;
}
`;

/** 길게 선 귀로 볼 만큼: 반길이가 반지름의 이 배 넘게 */
const LONG_EAR = 2.5;

/**
 * 길게 선 귀를 잎 모양으로 (사용자 지적 2026-10-12: 말로 만든 토끼 귀가 막대처럼 뻣뻣했다). 밑동은 조금 가늘게, 가운데는
 * 도톰하게 넓히고, 위로 갈수록 뒤(-z)로 살짝 휜다. zScale 은 모양을 부품 크기로 늘리는 z 배율 (휜 만큼을 세상 길이로 맞춘다).
 * 안쪽 색(inner) 부품도 같은 귀 모양이라 같이 휜다
 */
function earLeaf(geo: BufferGeometry, zScale: number): void {
  geo.computeBoundingBox();
  const b = geo.boundingBox;
  const pos = geo.attributes.position;
  if (!b || !pos) return;
  const h = Math.max(1e-6, b.max.y - b.min.y);
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) - b.min.y) / h;
    const w = 0.8 + 0.42 * Math.sin(Math.PI * Math.min(1, t * 1.1));
    pos.setX(i, pos.getX(i) * w);
    pos.setZ(i, pos.getZ(i) * w - (0.12 * h * t * t) / Math.max(1e-6, zScale));
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
}

/** y 축 모양(캡슐)의 위쪽 반지름을 taper 배로 (아래 -1 에서 1, 위 +1 에서 taper 로 선형) */
function taperY(geo: BufferGeometry, taper: number): void {
  geo.computeBoundingBox();
  const b = geo.boundingBox;
  if (!b) return;
  const pos = geo.attributes.position;
  if (!pos) return;
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) - b.min.y) / Math.max(1e-6, b.max.y - b.min.y);
    const k = 1 - (1 - taper) * t;
    pos.setX(i, pos.getX(i) * k);
    pos.setZ(i, pos.getZ(i) * k);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
}

/**
 * 관 (꼬리). 길을 따라 반지름 r 의 관을 만들고 양 끝을 공으로 막는다. 끝으로 갈수록 taper 배로 가늘어진다.
 * 길이 짧으면(점 둘) 직선
 */
function tubeGeometry(
  path: readonly Vec3[],
  at: Vec3,
  r: number,
  taper: number,
  fine = false,
): BufferGeometry {
  const pts = path.map(([x, y, z]) => new Vector3(x - at[0], y - at[1], z - at[2]));
  if (pts.length < 2) pts.push(new Vector3(0, 0, 0), new Vector3(0, r * 4, 0));
  const curve = new CatmullRomCurve3(pts, false, 'centripetal');
  // fine: 새긴 털 결로 가장자리를 울퉁불퉁하게 할 꼬리는 잘게 (sculptOutline)
  const segs = (fine ? 24 : 10) * pts.length;
  const radial = fine ? 32 : 14;
  const tube = new TubeGeometry(curve, segs, r, radial, false);
  const pos = tube.attributes.position;
  if (pos) {
    for (let i = 0; i < pos.count; i++) {
      const ring = Math.floor(i / (radial + 1));
      const t = ring / segs;
      const c = curve.getPointAt(Math.min(1, Math.max(0, t)));
      const k = 1 - (1 - taper) * t;
      pos.setXYZ(
        i,
        c.x + (pos.getX(i) - c.x) * k,
        c.y + (pos.getY(i) - c.y) * k,
        c.z + (pos.getZ(i) - c.z) * k,
      );
    }
    pos.needsUpdate = true;
    tube.computeVertexNormals();
  }
  const [cw, ch] = fine ? [32, 20] : [16, 12];
  const start = new SphereGeometry(r, cw, ch).translate(pts[0]?.x ?? 0, pts[0]?.y ?? 0, pts[0]?.z ?? 0);
  const last = pts.at(-1) ?? new Vector3();
  const end = new SphereGeometry(r * Math.max(0.05, taper), cw, ch).translate(last.x, last.y, last.z);
  const merged = mergeGeometries([tube, start, end]);
  tube.dispose();
  start.dispose();
  end.dispose();
  return merged ?? tube;
}

/** 모양을 -1~1 상자에 맞춘다 (크기 칸이 반지름처럼 읽히게) */
function fitUnit(geo: BufferGeometry): BufferGeometry {
  geo.computeBoundingBox();
  const b = geo.boundingBox;
  if (!b) return geo;
  const c = b.getCenter(new Vector3());
  const h = b.getSize(new Vector3()).multiplyScalar(0.5);
  geo.translate(-c.x, -c.y, -c.z);
  geo.scale(1 / Math.max(1e-6, h.x), 1 / Math.max(1e-6, h.y), 1 / Math.max(1e-6, h.z));
  geo.computeVertexNormals();
  return geo;
}

/**
 * 털 뭉치: 끝이 둥글게 모인 물방울 가닥 셋 (가운데가 길고 양옆은 짧게 벌어진다, +y 쪽으로 뻗는다).
 * 뾰족한 원뿔은 작은 화면에서 가시처럼 보였다. 볼 털, 가슴 털, 머리 털
 */
function tuftGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const locks: [number, number, number][] = [
    [0, 1, 0],
    [0.5, 0.78, -0.42],
    [-0.5, 0.78, 0.42],
  ];
  for (const [ang, len, dx] of locks) {
    const g = new SphereGeometry(1, 18, 14);
    // 물방울: 위로 갈수록 가늘게 (끝은 둥글다)
    const pos = g.attributes.position;
    if (pos)
      for (let i = 0; i < pos.count; i++) {
        const t = (pos.getY(i) + 1) / 2;
        const k = 1 - 0.72 * t * t;
        pos.setXYZ(i, pos.getX(i) * k * 0.42, pos.getY(i) * len, pos.getZ(i) * k * 0.42);
      }
    g.computeVertexNormals();
    g.rotateZ(ang);
    g.translate(dx, 0, 0);
    parts.push(g);
  }
  const merged = mergeGeometries(parts) ?? parts[0] ?? new SphereGeometry(1);
  for (const g of parts) g.dispose();
  return fitUnit(merged);
}

/** 리본 매듭: 양쪽 고리 둘, 가운데 매듭, 아래로 늘어진 끝 둘 (xy 평면) */
function bowGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    const loop = new SphereGeometry(1, 20, 14);
    loop.scale(0.62, 0.4, 0.26);
    loop.rotateZ(side * 0.18);
    loop.translate(side * 0.6, 0.05, 0);
    parts.push(loop);
    const tail = new ConeGeometry(0.2, 0.7, 10);
    tail.rotateZ(Math.PI + side * 0.35);
    tail.translate(side * 0.3, -0.45, -0.05);
    parts.push(tail);
  }
  const knot = new SphereGeometry(0.26, 14, 10);
  knot.scale(1, 0.9, 1.1);
  parts.push(knot);
  const merged = mergeGeometries(parts) ?? parts[0] ?? new SphereGeometry(1);
  for (const g of parts) g.dispose();
  return fitUnit(merged);
}

/**
 * 네 발로 선 몸의 다리 마디: 위 끝 반지름 r0 에서 아래 끝 r1 로 가늘어지는 둥근 막대 (양 끝 공에 접한 원뿔).
 * 위 끝 공의 가운데가 원점(관절), 아래 끝 공의 가운데가 (0, -len, 0). 무릎에서 윗마디 끝 공과 아랫마디 첫 공이
 * 같은 가운데에 같은 크기라 어느 각으로 굽혀도 틈이나 혹(예전 무릎 공)이 보이지 않는다
 */
export function limbGeometry(r0: number, r1: number, len: number, radial = 24): BufferGeometry {
  const L = Math.max(1e-4, len);
  // 접선 기울기: sin β = (r0 - r1) / L
  const beta = Math.asin(Math.max(-0.95, Math.min(0.95, (r0 - r1) / L)));
  const pts: Vector2[] = [];
  const cap = 10;
  // 아래 끝 공 (맨 아래 → 접선)
  for (let i = 0; i <= cap; i++) {
    const th = Math.PI - (i / cap) * (Math.PI / 2 - beta);
    pts.push(new Vector2(Math.max(1e-5, r1 * Math.sin(th)), -L + r1 * Math.cos(th)));
  }
  // 옆 (원뿔), 중간 점을 몇 개 둬서 털 결과 빛이 고르게
  const a = new Vector2(r1 * Math.cos(beta), -L - r1 * Math.sin(beta));
  const b = new Vector2(r0 * Math.cos(beta), -r0 * Math.sin(beta));
  for (let i = 1; i < 6; i++) pts.push(a.clone().lerp(b, i / 6));
  // 위 끝 공 (접선 → 꼭대기)
  for (let i = 0; i <= cap; i++) {
    const th = Math.PI / 2 + beta - (i / cap) * (Math.PI / 2 + beta);
    pts.push(new Vector2(Math.max(1e-5, r0 * Math.sin(th)), r0 * Math.cos(th)));
  }
  const geo = new LatheGeometry(pts, radial);
  geo.computeVertexNormals();
  return geo;
}

/**
 * 발 (네 발로 선 몸). 바닥이 판판하고 앞으로 조금 긴 둥근 발. toes 면 앞 끝에 발가락 넷이 오목볼록하게 보인다
 * (고양이 발). 크기 size 는 반지름 (x 옆, y 키, z 앞뒤). 가운데가 원점, 바닥은 -size.y
 */
export function pawGeometry(size: Vec3, toes: boolean): BufferGeometry {
  const geo = new SphereGeometry(1, 40, 28);
  const pos = geo.attributes.position;
  const dirs = toes ? [-0.6, -0.2, 0.2, 0.6].map((x) => new Vector3(x, 0.18, 0.82).normalize()) : [];
  const v = new Vector3();
  if (pos)
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      let k = 1;
      for (const d of dirs) k += 0.1 * Math.exp(-v.distanceToSquared(d) / 0.035);
      // 발가락 사이 골 (앞쪽 위만)
      if (toes && v.z > 0.4 && v.y > -0.3) k -= 0.03 * Math.max(0, Math.cos(v.x * 7.8)) * v.z;
      let y = v.y * k;
      // 바닥은 판판하게 (발바닥이 바닥에 붙는다)
      if (y < -0.7) y = -0.7 + (y + 0.7) * 0.15;
      pos.setXYZ(i, v.x * k * size[0], (y / 0.745) * size[1], v.z * k * size[2]);
    }
  geo.computeVertexNormals();
  return geo;
}

/**
 * 새긴 털 결의 가장자리 (네 발로 선 몸의 피규어, 실사). 겉면을 털 뭉치 높이만큼 법선 쪽으로 밀어 실루엣이
 * 곱슬 뭉치(curl, 초코)나 아래로 빗은 긴 털 다발(long, 밀크)로 울퉁불퉁하게 한다 (셰이더의 털 결은 빛만 바꿔
 * 가장자리가 매끈한 고무 인형 같았다). 좌표는 jjFurP (세상 길이)라 무릎과 발목에서 이어진다. 법선은 그대로 둔다
 * (빛은 셰이더 털 결이 맡는다. 다시 구하면 공 이음매가 보인다). 작은 부품(주둥이, 발)은 덜 민다
 */
function sculptOutline(geo: BufferGeometry, scale: Vector3, sculpt: 'curl' | 'long', k = 1): void {
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const fur = geo.getAttribute('jjFurP');
  if (!pos || !nor || !fur) return;
  geo.computeBoundingBox();
  const half = geo.boundingBox?.getSize(new Vector3()).multiply(scale).multiplyScalar(0.5);
  if (!half) return;
  const curl = sculpt === 'curl';
  const small = Math.min(1, Math.max(0.35, (Math.min(half.x, half.y, half.z) - 0.02) / 0.07));
  const amp = (curl ? 0.034 : 0.03) * small * k;
  // 뭉치 크기 (세상 길이): 곱슬은 동글동글, 긴 털은 가로로 좁고 세로로 긴 다발
  const fx = curl ? 19 : 26;
  const fy = curl ? 19 : 5;
  const hash = (x: number, y: number, z: number, k: number) => {
    let h = (x * 374761393 + y * 668265263 + z * 2147483647 + k * 1274126177) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const n = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    const x = fur.getX(i) * fx;
    const y = fur.getY(i) * fy;
    const z = fur.getZ(i) * fx;
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    const cz = Math.floor(z);
    let d = 9;
    for (let a = -1; a <= 1; a++)
      for (let b = -1; b <= 1; b++)
        for (let c = -1; c <= 1; c++) {
          const px = cx + a + hash(cx + a, cy + b, cz + c, 1);
          const py = cy + b + hash(cx + a, cy + b, cz + c, 2);
          const pz = cz + c + hash(cx + a, cy + b, cz + c, 3);
          d = Math.min(d, Math.hypot(x - px, y - py, z - pz));
        }
    // 뭉치 가운데가 볼록, 골은 조금 들어간다 (평균 크기는 거의 그대로)
    const h = (Math.max(0, 1 - d) ** 2 - 0.3) * amp;
    // 법선을 세상 길이로 (늘린 모양이면 늘린 축으로 나눈다), 민 길이도 다시 모양 좌표로
    n.set(nor.getX(i) / scale.x, nor.getY(i) / scale.y, nor.getZ(i) / scale.z).normalize();
    // 긴 털 다발은 끝이 아래로 처진다 (배, 가슴 아래 가장자리에 늘어진 털끝)
    const drop = curl ? 0 : Math.max(0, h) * 0.9 * (1 - Math.max(0, n.y));
    pos.setXYZ(
      i,
      pos.getX(i) + (n.x * h) / scale.x,
      pos.getY(i) + (n.y * h - drop) / scale.y,
      pos.getZ(i) + (n.z * h) / scale.z,
    );
  }
  pos.needsUpdate = true;
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
}

/**
 * 새긴 털 결 좌표(jjFurP)를 부품 자리를 넣은 좌표로 (네 발로 선 몸의 다리 마디와 발). 마디마다 제 좌표로 찍으면
 * 무릎과 발목에서 털 결이 끊겨 이음매가 보였다. 지금 자리(mesh.position, rotation)를 넣으니 붙이기 전에 부른다
 */
function worldFurCoords(mesh: Mesh): void {
  const fur = mesh.geometry.getAttribute('jjFurP');
  const pos = mesh.geometry.getAttribute('position');
  if (!fur || !pos) return;
  mesh.updateMatrix();
  const v = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrix);
    fur.setXYZ(i, v.x, v.y, v.z);
  }
  fur.needsUpdate = true;
}

/**
 * 네 발로 선 몸의 다리 마디와 발을 보는 쪽에 맞춰 손질한다. 재질은 같은 색 부품끼리 같이 쓰므로 마디마다 따로 복사한다
 * (셰이더 손질은 그대로 물려받아 프로그램도 같다). 정면과 옆에서는 아무것도 바꾸지 않아 그 그림은 그대로다.
 * - 마디를 끝에서 보면(놀자 인사, 엎드린 앞다리) 보이는 겉이 다 비스듬해 벨벳 광택(sheen)이 하얗게 덮어 그 마디만
 *   옅은 분홍으로 비쳐 보였다. 마디 축이 시선과 겹칠수록(cos 0.75 위) 광택을 줄인다.
 * - 등을 보이면 앞다리는 몸통 너머 그늘 속인데 그림자가 없어 뒷다리만큼 밝았다. 흰 고양이는 뒷다리 사이로 보이는
 *   앞다리가 같은 밝기의 반투명한 다리가 겹친 것처럼 보였다. 몸 앞이 보는 쪽에서 멀어질수록 앞다리를 조금 어둡게
 */
function limbLook(mesh: Mesh, root: Object3D, front: boolean): void {
  const shared = mesh.material;
  if (!(shared instanceof MeshPhysicalMaterial)) return;
  const segment = mesh.userData.part?.shape === 'capsule' && shared.sheen > 0;
  if (!segment && !front) return;
  const mat = shared.clone();
  mat.onBeforeCompile = shared.onBeforeCompile;
  mat.customProgramCacheKey = shared.customProgramCacheKey;
  mesh.material = mat;
  const sheen = shared.sheen;
  const color = shared.color.clone();
  const axis = new Vector3();
  const look = new Vector3();
  const ease = (a: number, b: number, x: number) => {
    const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return k * k * (3 - 2 * k);
  };
  mesh.onBeforeRender = (_r, _s, camera) => {
    look.setFromMatrixPosition(mesh.matrixWorld).sub(camera.position).normalize();
    if (segment) {
      axis.setFromMatrixColumn(mesh.matrixWorld, 1).normalize();
      // 0 이 되면 셰이더가 바뀌어(USE_SHEEN) 다시 만든다. 조금은 남긴다
      mat.sheen = sheen * (1 - 0.8 * ease(0.75, 0.95, Math.abs(axis.dot(look))));
    }
    if (front) {
      axis.setFromMatrixColumn(root.matrixWorld, 2).normalize();
      mat.color.copy(color).multiplyScalar(1 - 0.25 * ease(0.3, 0.8, axis.dot(look)));
    }
  };
}
