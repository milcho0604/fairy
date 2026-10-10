// 내 Mac에서 그리기 (AI 일러스트 로컬 엔진, 2026-10-10). 메인과 창이 같이 보는 값만 둔다.
// 실제 설치와 그리기는 src/main/local-draw.ts, 순수 계산은 src/main/local-draw-core.ts

/** 그림을 어디서 그릴지: cloud 무료 Hugging Face 서버(하루 몇 번), mac 이 Mac 에서 (횟수 제한 없음) */
export const ILLUST_ENGINES = ['cloud', 'mac'] as const;
export type IllustEngine = (typeof ILLUST_ENGINES)[number];
export const isIllustEngine = (v: unknown): v is IllustEngine =>
  (ILLUST_ENGINES as readonly unknown[]).includes(v);

/** 안내에 보이는 크기 (GB). 실제로 받는 양: 도구(uv, 파이썬, mflux) 1GB 안팎 + 원본 모델 15GB 쯤 */
export const LOCAL_DRAW_GB = { download: 16, keep: 5, memory: 8, free: 20 } as const;

/** 이 Mac 에서 그릴 수 있는지와 준비됐는지 (펫 만들기 창이 받는다) */
export interface LocalDrawInfo {
  supported: boolean;
  ready: boolean;
}

/**
 * 준비 단계와 전체 진행률에서 차지하는 몫. 받는 바이트에 맞춰 나눴다 (도구 1GB, 모델 15GB),
 * 모델 줄이기(4비트로 저장)는 받기가 없지만 1~2분 걸려 조금 준다
 */
export const SETUP_STAGES = [
  { id: 'uv', share: 0.01 },
  { id: 'tools', share: 0.05 },
  { id: 'model', share: 0.88 },
  { id: 'pack', share: 0.06 },
] as const;
export type SetupStage = (typeof SETUP_STAGES)[number]['id'];

/** 단계 안 진행률(0~1)을 전체 진행률로 */
export function setupRatio(stage: SetupStage, within: number): number {
  let before = 0;
  for (const s of SETUP_STAGES) {
    if (s.id === stage) return Math.min(1, before + s.share * Math.min(1, Math.max(0, within || 0)));
    before += s.share;
  }
  return 0;
}

/** 전체 진행률로 지금 단계를 고른다 (창의 단계 점) */
export function setupStageOf(ratio: number): SetupStage {
  let end = 0;
  for (const s of SETUP_STAGES) {
    end += s.share;
    if (ratio < end - 1e-9) return s.id;
  }
  return 'pack';
}
