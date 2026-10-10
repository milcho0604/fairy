// 내 컴퓨터에서 그리기 (AI 일러스트 로컬 엔진, 2026-10-10). 메인과 창이 같이 보는 값만 둔다.
// 엔진은 둘이다: Apple 칩 Mac(macOS 14+)은 mflux (src/main/local-draw.ts), 나머지는 sd.cpp (src/main/sdcpp.ts).
// 고르기와 순수 계산은 src/main/local-draw-core.ts, src/main/sdcpp-core.ts

/** 그림을 어디서 그릴지: cloud 무료 Hugging Face 서버(하루 몇 번), local 이 컴퓨터에서 (횟수 제한 없음) */
export const ILLUST_ENGINES = ['cloud', 'local'] as const;
export type IllustEngine = (typeof ILLUST_ENGINES)[number];
export const isIllustEngine = (v: unknown): v is IllustEngine =>
  (ILLUST_ENGINES as readonly unknown[]).includes(v);

/** 옛 설정 값 'mac'(Mac 전용이던 때)은 local 로 읽는다. 모르는 값은 undefined */
export function illustEngineOf(v: unknown): IllustEngine | undefined {
  if (v === 'mac') return 'local';
  return isIllustEngine(v) ? v : undefined;
}

/** 이 컴퓨터에서 쓰는 엔진: mflux(Apple 칩, MLX) 또는 sd.cpp(Windows, 인텔 Mac, macOS 12~13) */
export type LocalEngine = 'mflux' | 'sdcpp';
/** 걸리는 시간 단계: mflux, 그래픽 칩(Vulkan, Metal), CPU 만 */
export type LocalTier = 'mflux' | 'gpu' | 'cpu';

/** mflux 안내에 보이는 크기 (GB). 실제로 받는 양: 도구(uv, 파이썬, mflux) 1GB 안팎 + 원본 모델 15GB 쯤 */
export const LOCAL_DRAW_GB = { download: 16, keep: 5, memory: 8, free: 20 } as const;
/** sd.cpp 안내에 보이는 크기 (GB). 모델 셋 5.2GB + 도구 0.05GB 를 받아 그대로 둔다 */
export const SD_DRAW_GB = { download: 5.3, keep: 5.3, memory: 8, free: 7 } as const;

/**
 * 이 컴퓨터에서 그릴 수 없는 까닭: os 운영체제, chip 칩(윈도우 ARM, AVX2 없는 인텔 Mac), macos 너무 옛 macOS,
 * memory 메모리 8GB 미만, rosetta Apple 칩 Mac 에 인텔용 앱
 */
export type LocalUnsupported = 'os' | 'chip' | 'macos' | 'memory' | 'rosetta';

/** 이 컴퓨터에서 그릴 수 있는지와 준비됐는지 (펫 만들기 창이 받는다) */
export interface LocalDrawInfo {
  supported: boolean;
  ready: boolean;
  /** 안 되는 컴퓨터만: 까닭 (창이 알맞은 안내를 보인다. 로제타면 Apple 칩용 앱을 깔라고) */
  reason?: LocalUnsupported;
  /** 되는 컴퓨터만: 쓰는 엔진, 시간 단계, 안내 숫자, 한 장(그리기 + 털 다듬기) 걸리는 어림 분 */
  engine?: LocalEngine;
  tier?: LocalTier;
  need?: { download: number; keep: number; memory: number; free: number };
  minutes?: { min: number; max: number };
}

export type SetupStage = 'uv' | 'tools' | 'model' | 'pack';
export type SetupStages = readonly { id: SetupStage; share: number }[];

/**
 * mflux 준비 단계와 전체 진행률에서 차지하는 몫. 받는 바이트에 맞춰 나눴다 (도구 1GB, 모델 15GB),
 * 모델 줄이기(4비트로 저장)는 받기가 없지만 1~2분 걸려 조금 준다
 */
export const SETUP_STAGES = [
  { id: 'uv', share: 0.01 },
  { id: 'tools', share: 0.05 },
  { id: 'model', share: 0.88 },
  { id: 'pack', share: 0.06 },
] as const satisfies SetupStages;

/** sd.cpp 준비 단계: 도구 받기(Windows 만, 50MB 쯤)와 모델 받기(5.2GB). 이름표는 mflux 와 같은 글을 쓴다 */
export const SD_SETUP_STAGES = [
  { id: 'uv', share: 0.01 },
  { id: 'model', share: 0.99 },
] as const satisfies SetupStages;

export const setupStagesFor = (engine: LocalEngine | undefined): SetupStages =>
  engine === 'sdcpp' ? SD_SETUP_STAGES : SETUP_STAGES;

/** 단계 안 진행률(0~1)을 전체 진행률로 */
export function setupRatio(stage: SetupStage, within: number, stages: SetupStages = SETUP_STAGES): number {
  let before = 0;
  for (const s of stages) {
    if (s.id === stage) return Math.min(1, before + s.share * Math.min(1, Math.max(0, within || 0)));
    before += s.share;
  }
  return 0;
}

/** 전체 진행률로 지금 단계를 고른다 (창의 단계 점) */
export function setupStageOf(ratio: number, stages: SetupStages = SETUP_STAGES): SetupStage {
  let end = 0;
  for (const s of stages) {
    end += s.share;
    if (ratio < end - 1e-9) return s.id;
  }
  return stages[stages.length - 1]?.id ?? 'pack';
}
