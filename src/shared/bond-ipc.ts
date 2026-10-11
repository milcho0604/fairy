// 짝꿍과 더 가까워지는 것들의 창 사이 통로 (2026-10-11): 짝꿍이 아는 것, 첫 7일 여정, 성장과 옷, 주간 회고 카드.
// 패널, 설정, 짝꿍이 아는 것 창이 window.jjakkungBond 로 쓴다 (preload). 메인 쪽은 main/knows.ts, journey.ts, wear.ts, week-card.ts.
import type { JourneyStep, JourneyView } from './journey.ts';
import type { Settings } from './settings.ts';
import type { GrowStage, Outfit } from './wear.ts';

export const BOND = {
  /** 아무 창 → 메인: 짝꿍이 아는 것 창 열기 */
  openKnows: 'bond:open-knows',
  /** 짝꿍이 아는 것 창 ↔ 메인 */
  knowsGet: 'bond:knows-get',
  knowsSet: 'bond:knows-set',
  knowsChanged: 'bond:knows-changed',
  /** 패널 ↔ 메인: 여정 칸 */
  journeyGet: 'bond:journey-get',
  journeyGo: 'bond:journey-go',
  journeyTried: 'bond:journey-tried',
  journeySkip: 'bond:journey-skip',
  journeyChanged: 'bond:journey-changed',
  /** 패널 ↔ 메인: 주간 회고 카드 */
  weekTitles: 'bond:week-titles',
  weekSave: 'bond:week-save',
  /** 설정 ↔ 메인: 성장 단계와 오늘 옷 */
  growGet: 'bond:grow-get',
} as const;

/** 짝꿍이 아는 것 창이 바꿀 수 있는 설정 칸 (다른 칸은 메인이 버린다) */
export const KNOWS_KEYS = ['petFacts', 'petMemory', 'petMemoryPending', 'petMemoryMeta', 'petRules'] as const;
export type KnowsPatch = Partial<Pick<Settings, (typeof KNOWS_KEYS)[number]>>;

export interface KnowsSnapshot {
  settings: Pick<Settings, (typeof KNOWS_KEYS)[number] | 'petName'>;
  platform: string;
}

export interface GrowInfo {
  stage: GrowStage;
  /** 함께한 날 (처음 만난 날이 1일째) */
  days: number;
  affection: number;
  /** 다음 단계까지 남은 날과 친밀도. 어른이면 없다 */
  next?: { stage: GrowStage; days: number; affection: number };
  /** 오늘 입을 옷 (옷을 꺼도 알려 준다: 켜면 무엇을 입는지) */
  outfit: Outfit;
  /** 사진 펫이면 성장과 옷이 보이지 않는다 */
  photo: boolean;
}

export interface BondBridge {
  openKnows(): void;
  // 짝꿍이 아는 것 창
  knowsGet(): Promise<KnowsSnapshot | undefined>;
  knowsSet(patch: KnowsPatch): Promise<KnowsSnapshot['settings'] | undefined>;
  onKnowsChanged(listener: (next: KnowsSnapshot['settings']) => void): void;
  // 패널
  journeyGet(): Promise<JourneyView | undefined>;
  journeyGo(step: JourneyStep): void;
  journeyTried(step: JourneyStep): void;
  journeySkip(): void;
  onJourney(listener: (view: JourneyView | undefined) => void): void;
  weekTitles(): Promise<string[]>;
  weekSave(png: string): Promise<{ ok: boolean; message: string }>;
  // 설정
  growGet(): Promise<GrowInfo | undefined>;
}
