// 웃게 하기 (말장난, 몸개그), 하이파이브, 간지럼. AI 없이 정해진 글과 몸짓으로 한다.
// 여기에는 고르기와 세기만 둔다 (시험할 수 있게). 말풍선과 몸짓은 main/minigames.ts, main/fun.ts.
// 코인은 주지 않는다 (누르기만 하면 되는 놀이라 쌓기 쉽다). 하이파이브만 놀이 친밀도를 하루 상한 안에서 올린다.

/** 웃겨 줘 개수 (사전 fun.joke.{n}.q, fun.joke.{n}.a 가 1부터 이만큼 있다) */
export const JOKE_COUNT = 14;

/** 이어서 같은 웃음이 나오지 않게 최근 이만큼은 빼고 고른다 */
export const JOKE_RECENT = 5;

/** 웃음마다 펀치 때 몸짓. 몸개그는 춤, 말장난은 기뻐 깡충, 손 흔드는 말은 손 흔들기 */
export type JokeMove = 'dance' | 'happy' | 'wave';
const JOKE_MOVES: Record<number, JokeMove> = { 11: 'dance', 12: 'dance', 13: 'dance', 14: 'wave' };
export const jokeMove = (n: number): JokeMove => JOKE_MOVES[n] ?? 'happy';

/** 문제를 내고 펀치까지 기다리는 시간 (ms). 읽을 틈 */
export const JOKE_PAUSE_MS = 2400;

/** 다음 웃음 번호 (1부터). recent 는 최근에 한 번호들 (오래된 것부터) */
export function pickJoke(recent: readonly number[], rand: () => number): number {
  const skip = new Set(recent.slice(-JOKE_RECENT));
  const ok: number[] = [];
  for (let n = 1; n <= JOKE_COUNT; n++) if (!skip.has(n)) ok.push(n);
  const pool = ok.length ? ok : [1];
  return pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))] ?? 1;
}

/** 최근 목록에 더한다 (JOKE_RECENT 만큼만 남긴다) */
export const rememberJoke = (recent: readonly number[], n: number): number[] =>
  [...recent, n].slice(-JOKE_RECENT);

// ---- 하이파이브 ----

export const HIGH_FIVE = {
  /** 손바닥 단추를 기다리는 시간 (ms) */
  waitMs: 6000,
  /** 짝 했을 때 말 가짓수 (fun.five.hit.{n}) */
  hits: 3,
} as const;

/** 하이파이브 결과: 단추를 누름(hit), 시간 끝이나 말풍선 닫기(miss), 그만 놀기나 숨음(stop) */
export function highFiveResult(answer: string | undefined, aborted: boolean): 'hit' | 'miss' | 'stop' {
  if (aborted) return 'stop';
  if (answer === 'five') return 'hit';
  // 수다 빈도에 막혀 말풍선이 안 떴으면(undefined) 하이파이브를 안 한 것
  if (answer === undefined || answer === 'cleared' || answer === 'replaced') return 'stop';
  return 'miss';
}

// ---- 간지럼 ----
// 쓰다듬기(gesture.ts RubTracker)는 계속 문질러도 2초에 한 번만 온다. 짧은 사이에 여러 번 오면 오래 빠르게 문지른 것: 깔깔 웃는다.

export const TICKLE = {
  /** 이 시간 안에 */
  windowMs: 7000,
  /** 쓰다듬기가 이만큼 오면 간지럼 (쓰다듬기 사이 2초라 4초 넘게 계속 문질러야) */
  pats: 3,
  /** 한 번 웃으면 이만큼은 다시 웃지 않는다 (계속 문질러도 한 번) */
  cooldownMs: 45_000,
  /** 웃음 말 가짓수 (fun.tickle.{n}) */
  lines: 4,
} as const;

/** 쓰다듬은 시각들을 세어 간지럼인지 본다. 상태는 부른 쪽이 들고 다닌다 */
export function tickle(
  s: { pats: readonly number[]; lastAt: number },
  now: number,
): { tickled: boolean; pats: number[]; lastAt: number } {
  const pats = [...s.pats, now].filter((t) => now - t <= TICKLE.windowMs);
  if (now - s.lastAt < TICKLE.cooldownMs) return { tickled: false, pats, lastAt: s.lastAt };
  if (pats.length < TICKLE.pats) return { tickled: false, pats, lastAt: s.lastAt };
  return { tickled: true, pats: [], lastAt: now };
}

/** 처음 상태 (아직 웃은 적 없음) */
export const TICKLE_START = { pats: [] as number[], lastAt: Number.NEGATIVE_INFINITY };

/** 1부터 n 까지 중 하나 */
export const pickLine = (n: number, rand: () => number): number =>
  1 + Math.min(n - 1, Math.floor(rand() * n));
