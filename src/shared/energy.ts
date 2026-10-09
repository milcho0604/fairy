// 펫의 기운: 하루 리듬과 연속 작업 피로를 합친 값. 사용자 컴퓨터 시각 그대로 아침엔 잠이 덜 깨고, 낮엔 활발하고,
// 저녁엔 차분하고, 밤엔 졸리다. 쉬지 않고 오래 일하면(휴식 권유 RestCoach 가 세는 연속 작업 시간) 같이 지치고,
// 5분 넘게 쉬고 오면 피로가 풀린다. 메인(pet-life.ts)이 1분에 한 번 계산해 단계가 바뀔 때만 펫 화면에 보낸다.
// 화면은 그 단계로 눈 표정, 깜빡임, 몸짓 빈도와 걸음 빠르기를 바꾼다 (계속 다시 그리지 않는다, L10).
import type { IdleKey } from './idle-talk.ts';

export const ENERGY_STAGES = ['lively', 'normal', 'tired', 'sleepy'] as const;
/** 활발, 보통, 지침(눈꺼풀 살짝), 졸림(눈꺼풀 반, 처진 눈썹) */
export type EnergyStage = (typeof ENERGY_STAGES)[number];

/** 펫 화면에 보내는 기운 (PetStatus.energy). 단계와 녹초(눈 밑 그늘)만: 값을 보내면 1분마다 다시 그린다 */
export interface EnergyLook {
  stage: EnergyStage;
  /** 2시간 넘게 쉬지 않고 일했다: 눈 밑 그늘과 처진 눈썹 */
  worn: boolean;
}

export interface Energy extends EnergyLook {
  /** 0~1. 하루 리듬에서 피로를 뺀 값 */
  level: number;
  /** 하루 리듬만의 값 0~1 */
  rhythm: number;
  /** 연속 작업 피로: 0 없음, 1 살짝 지침(90분), 2 확실히 피곤(120분) */
  fatigue: 0 | 1 | 2;
}

/**
 * 하루 리듬 (시각, 값). 사이는 곧게 잇는다. 0시와 24시가 같아 자정을 넘어도 이어진다.
 * 6시부터 깨어나 10시쯤 가장 활발, 점심 뒤(14시)에 살짝 처지고(식곤증), 18시부터 차분해져 22시 넘으면 졸리다
 */
export const RHYTHM: readonly (readonly [hour: number, value: number])[] = [
  [0, 0.15],
  [5, 0.15],
  [6, 0.3],
  [7, 0.45],
  [8.5, 0.7],
  [10, 0.95],
  [13, 0.95],
  [14, 0.8],
  [15.5, 0.95],
  [18, 0.85],
  [21, 0.62],
  [22, 0.4],
  [23, 0.25],
  [24, 0.15],
];

/** 연속 작업 피로가 시작되는 분 (살짝 지침, 확실히 피곤) */
export const FATIGUE_MIN = [90, 120] as const;
/** 피로 단계마다 리듬에서 빼는 값. 살짝 지침이 한낮에도 지침 단계가 되게 */
const FATIGUE_COST = [0, 0.4, 0.55] as const;
/** 단계 경계: 이 값 이상이면 그 단계 */
export const STAGE_AT = { lively: 0.85, normal: 0.62, tired: 0.35 } as const;
/**
 * 몸 시계 낮(리듬이 보통 이상, 대략 8시~21시)에는 피로만으로 졸림까지 내려가지 않는다(지침과 녹초까지).
 * 이만큼(분) 이상 쉬지 않고 일했을 때만 낮에도 졸리다 (사용자 결정 2026-10-09: 점심 뒤 2시간 일하면 한낮에 졸던 것)
 */
export const DAY_SLEEPY_WORK_MIN = 240;

/** 하루 리듬 값. minuteOfDay 는 0~1439 (몸 시계: 사용자 컴퓨터 시각, 만나는 시간을 켰으면 그 시간이 9시가 되게 옮긴 것) */
export function rhythmAt(minuteOfDay: number): number {
  const h = (((minuteOfDay % 1440) + 1440) % 1440) / 60;
  for (let i = 1; i < RHYTHM.length; i++) {
    const [h1, v1] = RHYTHM[i] as readonly [number, number];
    if (h > h1) continue;
    const [h0, v0] = RHYTHM[i - 1] as readonly [number, number];
    return v0 + ((v1 - v0) * (h - h0)) / (h1 - h0);
  }
  return RHYTHM[0]?.[1] ?? 0.15;
}

export function fatigueOf(workedMin: number): 0 | 1 | 2 {
  return workedMin >= FATIGUE_MIN[1] ? 2 : workedMin >= FATIGUE_MIN[0] ? 1 : 0;
}

/** 몸 시계 낮인지 (하루 리듬이 보통 단계 이상) */
export const isBodyDay = (rhythm: number): boolean => rhythm >= STAGE_AT.normal;

export function stageOf(level: number): EnergyStage {
  if (level >= STAGE_AT.lively) return 'lively';
  if (level >= STAGE_AT.normal) return 'normal';
  if (level >= STAGE_AT.tired) return 'tired';
  return 'sleepy';
}

/**
 * 지금 기운. at 은 사용자 컴퓨터 시각, workedMin 은 쉬지 않고 일한 분.
 * bodyMinute 는 몸 시계 (shared/routine.ts bodyClock: 만나는 시간이 9시가 되게 옮긴 분). 없으면 at 의 시각 그대로.
 * 몸 시계 낮에는 피로만으로 졸림이 되지 않는다 (DAY_SLEEPY_WORK_MIN 이상 일했을 때만)
 */
export function energyOf(at: Date, workedMin: number, bodyMinute?: number): Energy {
  const rhythm = rhythmAt(bodyMinute ?? at.getHours() * 60 + at.getMinutes());
  const worked = Math.max(0, workedMin);
  const fatigue = fatigueOf(worked);
  let level = Math.max(0, Math.min(1, rhythm - FATIGUE_COST[fatigue]));
  if (isBodyDay(rhythm) && worked < DAY_SLEEPY_WORK_MIN) level = Math.max(level, STAGE_AT.tired);
  return { stage: stageOf(level), worn: fatigue >= 2, level, rhythm, fatigue };
}

export const sameLook = (a: EnergyLook | undefined, b: EnergyLook | undefined) =>
  a?.stage === b?.stage && a?.worn === b?.worn;

/** 화면이 받은 값을 고른다. 모르는 단계면 undefined (예전처럼 그린다) */
export function energyLookOf(raw: unknown): EnergyLook | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  if (!(ENERGY_STAGES as readonly unknown[]).includes(r.stage)) return undefined;
  return { stage: r.stage as EnergyStage, worn: r.worn === true };
}

/** 몸짓 무게 곱 (moves.ts). 졸린 몸짓(하품, 꾸벅 졸다 깨기)과 기운 쓰는 몸짓(폴짝, 뒹굴기) */
export const ENERGY_MOVE: Record<EnergyStage, { sleepy: number; energetic: number }> = {
  lively: { sleepy: 0.3, energetic: 1.8 },
  normal: { sleepy: 1, energetic: 1 },
  tired: { sleepy: 2.5, energetic: 0.4 },
  sleepy: { sleepy: 3.5, energetic: 0.15 },
};

/** 걷기와 앉기 확률, 걷는 빠르기 곱 (behavior.ts), 다음 행동까지 기다리는 시간 곱 (펫 화면) */
export const ENERGY_PACE: Record<EnergyStage, { walk: number; sit: number; speed: number; wait: number }> = {
  lively: { walk: 0.42, sit: 0.12, speed: 1.25, wait: 0.8 },
  normal: { walk: 0.35, sit: 0.17, speed: 1, wait: 1 },
  tired: { walk: 0.28, sit: 0.25, speed: 0.75, wait: 1.2 },
  sleepy: { walk: 0.2, sit: 0.32, speed: 0.6, wait: 1.4 },
};

/** 눈 깜빡임: 걸리는 시간(ms), 다음 깜빡임까지 최소와 폭(ms), 그리는 틀 수. 졸릴수록 천천히 감았다 뜬다 */
export const ENERGY_BLINK: Record<
  EnergyStage,
  { ms: number; every: number; spread: number; frames: number }
> = {
  lively: { ms: 160, every: 2500, spread: 3500, frames: 4 },
  normal: { ms: 180, every: 3000, spread: 4000, frames: 4 },
  tired: { ms: 320, every: 4000, spread: 5000, frames: 6 },
  sleepy: { ms: 460, every: 4500, spread: 5500, frames: 7 },
};

/** 개운함은 사용자가 이만큼 안에 손을 댔을 때 (자리에 돌아왔을 때) */
export const BACK_IF_IDLE_UNDER_SEC = 60;

/**
 * 수다쟁이 혼잣말(shared/idle-talk.ts IdleFacts.more)에 더할 기운 대사. 펫 자신의 몸 상태만 말한다
 * (쉬자고 권하는 말은 휴식 권유가, 오래 일한 것 칭찬은 idle.work 가 한다). 보통 단계는 없다
 */
export function energyTalkKeys(look: EnergyLook | undefined): IdleKey[] {
  if (!look) return [];
  if (look.worn) return ['idle.energy.worn.1', 'idle.energy.worn.2'];
  if (look.stage === 'sleepy') return ['idle.energy.sleepy.1', 'idle.energy.sleepy.2'];
  if (look.stage === 'tired') return ['idle.energy.tired.1', 'idle.energy.tired.2'];
  if (look.stage === 'lively') return ['idle.energy.lively.1', 'idle.energy.lively.2'];
  return [];
}

export interface EnergyTick {
  energy: Energy;
  /** 화면에 보낼 모습(단계, 녹초)이 바뀌었다 */
  changed: boolean;
  /** 지쳤다가 쉬고 돌아왔다: 개운한 기지개 한 번 */
  fresh: boolean;
}

/**
 * 1분마다 부른다 (pet-life.ts). 기운을 계산하고, 지쳤다가(90분 넘게 쉬지 않음) 쉬고 돌아오면 개운한 표정 한 번을 정한다.
 * 개운함은 쉬는 동안(자리 비움) 미뤄 두었다가 사용자가 돌아온 첫 틱에
 */
export class EnergyWatch {
  #look: EnergyLook | undefined;
  #peak: 0 | 1 | 2 = 0;
  #freshPending = false;

  tick(at: Date, workedMin: number, idleSec: number, bodyMinute?: number): EnergyTick {
    const energy = energyOf(at, workedMin, bodyMinute);
    const changed = !sameLook(this.#look, energy);
    this.#look = { stage: energy.stage, worn: energy.worn };
    // 쉬어서 피로가 풀렸다 (5분 넘게 자리를 비움, 또는 권유대로 쉬고 옴). 지쳤던 적이 있으면 돌아올 때 개운하게
    if (energy.fatigue === 0 && this.#peak > 0) {
      this.#freshPending = true;
      this.#peak = 0;
    }
    if (energy.fatigue > this.#peak) this.#peak = energy.fatigue;
    let fresh = false;
    if (this.#freshPending && idleSec < BACK_IF_IDLE_UNDER_SEC) {
      this.#freshPending = false;
      fresh = true;
    }
    return { energy, changed, fresh };
  }
}
