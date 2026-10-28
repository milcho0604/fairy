// 배터리 절약 (설정 편의). 노트북이 배터리로 돌거나 운영체제가 전력을 아끼는 중이면 펫이 덜 움직이고 덜 그린다.
// auto(켜기, 기본): 배터리, 저전력일 때만 / off: 끔 / always: 늘. 무엇을 바꾸는지는 아래 SAVER 한 곳에서 정한다.
// 사용자 요청 (2026-10-11): 몰래 바꾸지 않는다. 설정 편의, 펫 우클릭 메뉴에서 끄고, 처음 배터리로 바뀌면 펫이 한 번 알리며
// "그대로 움직이기" 단추로 바로 끌 수 있다 (main/index.ts)

export const SAVER_MODES = ['auto', 'off', 'always'] as const;
export type SaverMode = (typeof SAVER_MODES)[number];
export const isSaverMode = (v: unknown): v is SaverMode => SAVER_MODES.includes(v as SaverMode);

export interface PowerFacts {
  /** 배터리로 돈다 (powerMonitor.isOnBatteryPower, on-battery/on-ac) */
  onBattery: boolean;
  /**
   * 운영체제가 전력, 열을 아끼는 중: CPU 속도 제한(speed-limit-change < 100), 열 상태 serious/critical.
   * 맥 저전력 모드는 CPU 속도를 묶어 여기에 잡힌다
   */
  lowPower: boolean;
  /** 운영체제 "동작 줄이기"가 켜져 있다 (접근성). 있으면 설정이 꺼져 있어도 아낀다 */
  reducedMotion?: boolean;
}

/**
 * 움직임 줄이기 고르기 (설정 편의): system(기본) 운영체제 "동작 줄이기"를 따른다, always 늘 줄인다, off 줄이지 않는다.
 * 줄이면 화면을 가로질러 걷지 않는다(calmOn)
 */
export const MOTION_CHOICES = ['system', 'always', 'off'] as const;
export type MotionChoice = (typeof MOTION_CHOICES)[number];
export const isMotionChoice = (v: unknown): v is MotionChoice => MOTION_CHOICES.includes(v as MotionChoice);

/** 고른 값과 운영체제 설정으로 지금 줄일지 */
export const reducedMotionOf = (choice: MotionChoice, os: boolean): boolean =>
  choice === 'always' ? true : choice === 'off' ? false : os;

/** 예전 설정에는 이 값이 없다: 배터리 절약을 "항상"으로 해 둔 사람은 "항상 줄이기"로 잇는다 */
export const motionChoiceFromOld = (saved: unknown, saver: unknown): MotionChoice =>
  isMotionChoice(saved) ? saved : saver === 'always' ? 'always' : 'system';

/** 지금 절약할지 */
export function saverOn(mode: SaverMode, facts: PowerFacts): boolean {
  if (mode === 'off') return false;
  if (mode === 'always') return true;
  return facts.onBattery || facts.lowPower;
}

/** 돌아다니기, 손님 걷기, 집 문 걷기처럼 화면을 가로지르는 움직임을 멈출지 (운영체제 동작 줄이기만, 배터리는 해당 없음) */
export const calmOn = (facts: PowerFacts): boolean => facts.reducedMotion === true;

/** 열 상태와 속도 제한으로 본 저전력 */
export function lowPowerOf(speedLimit: number | undefined, thermal: string | undefined): boolean {
  const limited = typeof speedLimit === 'number' && speedLimit > 0 && speedLimit < 100;
  return limited || thermal === 'serious' || thermal === 'critical';
}

export const SAVER = {
  /** 펫 그리기 상한 (fps). 평소 30fps 움직임이 15, 걷기 12 는 그대로. 가만히 있으면 원래대로 0 (그리지 않는다) */
  fpsCap: 15,
  /** 한가할 때 행동을 고르는 간격 배수 (걷기, 몸짓이 이만큼 드물다) */
  idleWait: 2.5,
  /** 걷기에서 창을 옮기는 간격 (ms). 평소 50 (20Hz). 걷는 그림이 12fps 라 이보다 잦게 옮겨도 눈에 안 띈다 */
  walkTickMs: 83,
  /** 창 위에 앉은 동안 그 창이 그대로인지 보는 간격 (ms). 평소 1000 */
  perchPollMs: 3000,
  /** 창 위에 올라가 볼 확률 배수 (창 목록 읽기가 비싸다) */
  perchChance: 0.4,
} as const;

/** 그리기 빠르기 상한. 0(그리지 않음)은 그대로 둔다 */
export function capFps(fps: number, saver: boolean): number {
  if (!saver || fps <= 0) return fps;
  return Math.min(fps, SAVER.fpsCap);
}

export const perchPollMs = (saver: boolean): number => (saver ? SAVER.perchPollMs : 1000);
/** 걷기(제자리 걷는 그림, 12fps)에서 창을 옮기는 간격. 그림 틀보다 조금 잦게 */
export const walkTickMs = (saver: boolean, boost: boolean): number =>
  saver ? SAVER.walkTickMs : boost ? 16 : 50;
/** 커서나 친구를 따라 달릴 때 창을 옮기는 간격 (빨라서 걷기보다 촘촘히). 평소 33 (30Hz), 절약이면 66 */
export const followTickMs = (saver: boolean, boost: boolean): number => (saver ? 66 : boost ? 16 : 33);
export const idleWaitFactor = (saver: boolean): number => (saver ? SAVER.idleWait : 1);
