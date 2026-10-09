// 펫 만들기 진행 표시 계산 (펫 만들기 창, 설정의 몸 다시 만들기). 화면 없이 시험한다 (make-progress.test.ts).
// 진짜 진행률을 아는 일(모델 받기)은 그 값을, 모르는 일(AI 설계도, 배경 지우기, 깊이 재기)은 예상 시간으로 부드럽게.

/** 진행을 모르는 일이 넘지 않는 상한. 100% 는 진짜 끝났을 때만 채운다 */
export const GUESS_CAP = 0.97;
/** 예상 시간이 되었을 때 보이는 진행 */
export const AT_EXPECTED = 0.8;
/** 예상 시간까지의 곡선 기울기: 예상 시간에 딱 AT_EXPECTED 가 되게 */
const K = -Math.log(1 - AT_EXPECTED / GUESS_CAP);

/**
 * 진행을 모르는 일의 보이는 진행(0~GUESS_CAP). 처음엔 빠르게, 예상 시간에 80%.
 * 예상보다 오래 걸리면 그 뒤로는 더 천천히 상한 쪽으로 다가가고 멈추지 않는다 (같은 기울기로 이어 붙인다)
 */
export function guessRatio(elapsedMs: number, expectedMs: number): number {
  if (!(elapsedMs > 0) || !(expectedMs > 0)) return 0;
  const x = elapsedMs / expectedMs;
  if (x <= 1) return GUESS_CAP * (1 - Math.exp(-K * x));
  const rest = GUESS_CAP - AT_EXPECTED;
  const slope = GUESS_CAP * K * Math.exp(-K);
  return GUESS_CAP - rest / (1 + (slope / rest) * (x - 1));
}

/** 진행 구간: 대사와 안내 글을 고른다. long 은 예상보다 한참 오래 걸릴 때 */
export type Phase = 'start' | 'middle' | 'almost' | 'long';

/** 예상 시간으로 고른 구간 (진행을 모르는 일) */
export function guessPhase(elapsedMs: number, expectedMs: number): Phase {
  const x = expectedMs > 0 ? elapsedMs / expectedMs : 0;
  return x < 0.3 ? 'start' : x < 0.8 ? 'middle' : x < 1.6 ? 'almost' : 'long';
}

/** 진짜 진행률로 고른 구간 (모델 받기). 끝까지 받았으면 almost (해시를 맞춰 보는 중) */
export function ratioPhase(ratio: number): Phase {
  return ratio < 0.3 ? 'start' : ratio < 0.8 ? 'middle' : 'almost';
}

/**
 * 남은 시간을 보기 좋게 다듬는다(초). 1분 안쪽은 5초 단위로 올림, 그 위는 30초 단위.
 * 숫자가 1초마다 바뀌어 정신없지 않게
 */
export function roundLeft(sec: number): number {
  if (!(sec > 0)) return 0;
  return sec <= 60 ? Math.ceil(sec / 5) * 5 : Math.ceil(sec / 30) * 30;
}

/** 진행을 모르는 일의 남은 시간(초). 예상의 80% 를 넘으면 undefined (그때부터는 "거의 다 됐어") */
export function guessLeftSec(elapsedMs: number, expectedMs: number): number | undefined {
  if (!(expectedMs > 0) || elapsedMs >= expectedMs * 0.8) return undefined;
  return roundLeft((expectedMs - Math.max(0, elapsedMs)) / 1000);
}

/**
 * 받기의 남은 시간(초). 지금까지 받은 빠르기로 어림한다. 너무 일러 빠르기를 모르거나(2% 미만, 1.5초 미만)
 * 다 받았으면 undefined
 */
export function downloadLeftSec(ratio: number, elapsedMs: number): number | undefined {
  if (!(ratio >= 0.02) || ratio >= 1 || !(elapsedMs >= 1500)) return undefined;
  return roundLeft((elapsedMs * (1 - ratio)) / ratio / 1000);
}

/** 남은 시간 글 고르기: 10초 이하는 "금방", 90초 이상이면 분으로 (반올림), 아니면 초로 */
export function leftUnit(sec: number): { unit: 'soon' | 'sec' | 'min'; n: number } {
  if (sec <= 10) return { unit: 'soon', n: sec };
  return sec >= 90 ? { unit: 'min', n: Math.max(2, Math.round(sec / 60)) } : { unit: 'sec', n: sec };
}

/** 지난번 걸린 시간을 몇 번까지 기억할지 */
export const DURATION_KEEP = 5;
/** 기억할 만한 시간 범위. 이보다 짧거나 길면 이상한 값이라 버린다 */
export const DURATION_MIN = 300;
export const DURATION_MAX = 10 * 60_000;

const okDuration = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= DURATION_MIN && v <= DURATION_MAX;

/** 저장해 둔 걸린 시간 목록(JSON 글)을 읽는다. 깨졌거나 이상한 값은 빼고 최근 DURATION_KEEP 개 */
export function parseDurations(raw: string | null | undefined): number[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter(okDuration).slice(-DURATION_KEEP) : [];
  } catch {
    return [];
  }
}

/** 걸린 시간 하나를 더한 목록(JSON 글). 이상한 값이면 그대로 */
export function addDuration(raw: string | null | undefined, ms: number): string {
  const list = parseDurations(raw);
  if (okDuration(ms)) list.push(Math.round(ms));
  return JSON.stringify(list.slice(-DURATION_KEEP));
}

/**
 * 예상 시간: 지난 몇 번의 가운데 값에 10% 여유. 기록이 없으면 기본값.
 * 기본값의 4분의 1과 세 배 사이로 묶는다 (그래픽 카드로 1초면 끝나는 배경 지우기도 따라가되, 이상한 값에 끌려가지 않게)
 */
export function expectedMs(list: readonly number[], fallbackMs: number): number {
  if (list.length === 0) return fallbackMs;
  const sorted = [...list].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const median =
    sorted.length % 2 ? (sorted[mid] ?? fallbackMs) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
  return Math.min(fallbackMs * 3, Math.max(fallbackMs / 4, median * 1.1));
}

/** 일마다 기본 예상 시간 (기록이 없을 때). AI 설계도는 실제 기록 19초, 33초, 37초(2026-10-08) */
// AI 일러스트(Hugging Face 무료 Space)는 실제 1분쯤 (2026-10-09)
export const FALLBACK_MS = { figure: 35_000, cutout: 6_000, relief: 4_000, illust: 70_000 } as const;
export type TimedTask = keyof typeof FALLBACK_MS;

/** 브라우저 저장소 열쇠 (펫 만들기 창과 설정 창이 같은 출처라 같이 쓴다) */
export const durationKey = (task: TimedTask) => `jj.make-ms.${task}`;

/** 화면의 브라우저 저장소. 막혔거나(사생활 보호, 시험) 없으면 undefined */
export function browserStore(): Storage | undefined {
  try {
    return globalThis.window?.localStorage;
  } catch {
    return undefined;
  }
}

/** 저장소에서 예상 시간을 읽는다. 저장소를 못 쓰면 기본값 */
export function loadExpected(task: TimedTask, store: Pick<Storage, 'getItem'> | undefined): number {
  let raw: string | null = null;
  try {
    raw = store?.getItem(durationKey(task)) ?? null;
  } catch {
    raw = null;
  }
  return expectedMs(parseDurations(raw), FALLBACK_MS[task]);
}

/** 끝난 일의 걸린 시간을 저장소에 더한다. 저장소를 못 쓰면 조용히 넘어간다 */
export function saveDuration(
  task: TimedTask,
  ms: number,
  store: Pick<Storage, 'getItem' | 'setItem'> | undefined,
): void {
  try {
    store?.setItem(durationKey(task), addDuration(store.getItem(durationKey(task)), ms));
  } catch {
    // 저장소가 막혔으면 다음에도 기본값으로
  }
}
