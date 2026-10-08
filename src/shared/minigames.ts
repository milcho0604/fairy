// 짧은 놀이 (미니 게임): 비눗방울, 레이저 쫓기, 간식 받아먹기, 가위바위보, 친구와 술래잡기, 두더지 잡기.
// 여기에는 규칙과 계산만 둔다 (시험할 수 있게). 창과 타이머는 main/minigames.ts.
// 일을 방해하지 않게: 다 짧고(30초 안), 입력을 뺏지 않고(비눗방울만 방울 위에서 누름을 받는다), 펫을 누르거나 우클릭 "그만 놀기"로 끝난다.
// 두더지 잡기만 펫 누르기가 잡기라, 그만두기는 우클릭 "그만 놀기"로 한다.
import type { Point, Rect } from './geometry.ts';

export type MiniGame = 'bubbles' | 'laser' | 'treats' | 'rps' | 'tag' | 'mole';
export const MINI_GAMES: readonly MiniGame[] = ['bubbles', 'laser', 'treats', 'rps', 'tag', 'mole'];

export const isMiniGame = (v: unknown): v is MiniGame => MINI_GAMES.includes(v as MiniGame);

/** 놀이 코인: 한 행에 1코인씩 'play' 로 적는다. 놀이를 다 합쳐 하루 이만큼까지 (기본 먹이 5코인 남짓) */
export const PLAY_COIN = { reason: 'play', dailyLimit: 6 } as const;
/** 새 놀이가 친밀도(play 활동)를 올리는 하루 판 수. 가위바위보를 연달아 눌러 친밀도를 쌓지 못하게 */
export const PLAY_AFFECTION_DAILY = 10;

/** 받고 싶은 코인 want 중 오늘 받을 수 있는 만큼 (earnedToday: 오늘 놀이로 받은 코인) */
export function grantCoins(want: number, earnedToday: number): number {
  return Math.max(0, Math.min(Math.floor(want), PLAY_COIN.dailyLimit - earnedToday));
}

/** 오늘 이미 playsToday 판 친밀도를 받았을 때 이번 판도 받는지 */
export const affectionAllowed = (playsToday: number): boolean => playsToday < PLAY_AFFECTION_DAILY;

/** 하루 판 수 기록 (저장 파일 모양). 날이 바뀌면 0 부터 */
export function playsOn(saved: unknown, day: string): number {
  if (!saved || typeof saved !== 'object') return 0;
  const s = saved as { day?: unknown; n?: unknown };
  return s.day === day && typeof s.n === 'number' && Number.isFinite(s.n) && s.n >= 0 ? Math.floor(s.n) : 0;
}

// ---- 시작해도 되는지 ----

export interface PlayGate {
  /** 숨음 (사용자 숨기기, 발표, 화면 공유) */
  hidden: boolean;
  /** 집중 타이머 중 (펫이 잔다) */
  focus: boolean;
  /** 화면 잠금 */
  locked: boolean;
  /** 끌거나 던져서 나는 중 */
  held: boolean;
  /** 집에서 쉬는 중 */
  resting: boolean;
  /** 다른 놀이 중 */
  playing: boolean;
  hungry: boolean;
  /** 같이 놀 친구 펫이 있다 (술래잡기) */
  friend: boolean;
}

export type PlayBlock =
  | 'hidden'
  | 'focus'
  | 'locked'
  | 'held'
  | 'resting'
  | 'playing'
  | 'hungry'
  | 'noFriend';

/** 뛰어다니는 놀이: 배가 고프면 안 한다 (밥 먼저) */
const RUNNING: readonly MiniGame[] = ['laser', 'tag'];

/** 시작 못 하는 까닭 (없으면 undefined). 말없이 그만둘 것(숨음, 잠금, 끌기, 놀이 중)과 말해 줄 것이 섞여 있다 */
export function playBlock(game: MiniGame, g: PlayGate): PlayBlock | undefined {
  if (g.hidden) return 'hidden';
  if (g.locked) return 'locked';
  if (g.held) return 'held';
  if (g.playing) return 'playing';
  if (g.focus) return 'focus';
  if (g.resting) return 'resting';
  if (game === 'tag' && !g.friend) return 'noFriend';
  if (g.hungry && RUNNING.includes(game)) return 'hungry';
  return undefined;
}

/** 말해 주지 않고 조용히 안 하는 까닭 (안 보이거나 사용자가 펫을 들고 있거나 이미 노는 중) */
export const silentBlock = (b: PlayBlock): boolean =>
  b === 'hidden' || b === 'locked' || b === 'held' || b === 'playing';

// ---- 비눗방울 ----

export const BUBBLES = {
  /** 한 판에 부는 방울 수 */
  count: 7,
  /** 방울 사이 간격 (ms) */
  everyMs: 650,
  /** 방울이 저절로 터지기까지 (ms) */
  lifeMs: 8000,
  /** 방울 지름 (px) */
  size: 46,
  /** 올라가는 빠르기 (px/초) 범위 */
  rise: [34, 58] as const,
  /** 좌우로 흔들리는 폭 (px)과 주기 (ms) */
  sway: 16,
  swayMs: 1700,
  /** 놀이 창 크기 (펫 위로 방울이 오르는 칸) */
  width: 300,
  height: 420,
  /** 이 개수를 터뜨리면 코인 1, 다 터뜨리면 2 */
  coinAt: 3,
} as const;

export interface Bubble {
  /** 놀이 창 안 처음 가운데 (px) */
  x0: number;
  y0: number;
  /** 올라가는 빠르기 (px/초) */
  speed: number;
  /** 흔들림 위상 (0~1) */
  phase: number;
}

/** 방울 하나 만들기. 펫 머리 근처(놀이 창 아래 가운데)에서 나온다 */
export function makeBubble(rand: () => number): Bubble {
  const [lo, hi] = BUBBLES.rise;
  return {
    x0: Math.round(BUBBLES.width / 2 + (rand() - 0.5) * 120),
    y0: BUBBLES.height - BUBBLES.size,
    speed: lo + rand() * (hi - lo),
    phase: rand(),
  };
}

/** ms 지난 방울 가운데 자리 (놀이 창 안). 화면은 같은 값을 CSS 로 그린다 */
export function bubbleAt(b: Bubble, ms: number): { x: number; y: number } {
  const t = Math.max(0, ms);
  return {
    x: b.x0 + BUBBLES.sway * Math.sin(2 * Math.PI * (t / BUBBLES.swayMs + b.phase)),
    y: b.y0 - (b.speed * t) / 1000,
  };
}

/** 이 방울이 아직 떠 있는지 (시간, 창 위로 다 나갔는지) */
export function bubbleAlive(b: Bubble, ms: number): boolean {
  return ms < BUBBLES.lifeMs && bubbleAt(b, ms).y > BUBBLES.size / 2;
}

/** (x, y) 를 누르면 맞는 방울. 누르기 쉽게 그림보다 조금 넉넉히 본다 */
export function bubbleHit(p: { x: number; y: number }, at: { x: number; y: number }): boolean {
  return Math.hypot(p.x - at.x, p.y - at.y) <= BUBBLES.size / 2 + 4;
}

/** 터뜨린 수에 따른 코인 (상한 전) */
export function bubbleCoins(popped: number, total: number): number {
  if (popped >= total && total > 0) return 2;
  return popped >= BUBBLES.coinAt ? 1 : 0;
}

/** 놀이 창 자리: 펫 위 가운데. 화면(area) 밖으로 나가지 않게 */
export function bubbleField(pet: Rect, area: Rect): Rect {
  const w = BUBBLES.width;
  const h = BUBBLES.height;
  const x = Math.round(pet.x + pet.width / 2 - w / 2);
  const y = Math.round(pet.y + pet.height * 0.35 - h);
  return {
    x: Math.max(area.x, Math.min(area.x + area.width - w, x)),
    y: Math.max(area.y, Math.min(area.y + area.height - h, y)),
    width: w,
    height: h,
  };
}

// ---- 레이저 쫓기 ----

export const LASER = {
  ms: 20_000,
  /** 펫이 달리는 빠르기 (px/초) */
  speed: 360,
  /** 점 지름 */
  size: 22,
  /** 펫 가운데와 점이 이만큼 가까우면 잡았다 */
  catchPx: 28,
  /** 잡은 뒤 이만큼은 다시 세지 않는다 */
  catchGapMs: 1200,
  /** 이만큼 잡으면 코인 1 */
  coinCatches: 3,
} as const;

/** 펫이 달려갈 x (펫 사각형 왼쪽). 점이 있는 쪽으로, 펫 화면 안에서만 */
export function chaseX(dot: { x: number }, pet: Rect, area: Rect): number {
  const x = Math.round(dot.x - pet.width / 2);
  return Math.max(area.x, Math.min(area.x + area.width - pet.width, x));
}

/** 점을 잡았는지: 점이 펫 가운데 가까이, 펫 키 안(발 아래~머리)에 있다 */
export function laserCaught(dot: { x: number; y: number }, pet: Rect): boolean {
  const cx = pet.x + pet.width / 2;
  return (
    Math.abs(dot.x - cx) <= LASER.catchPx && dot.y >= pet.y + pet.height * 0.2 && dot.y <= pet.y + pet.height
  );
}

// ---- 간식 받아먹기 ----

export const TREATS = {
  count: 4,
  size: 34,
  /** 떨어지는 가속 (px/초²). 펫이 따라갈 만큼 느리게 */
  gravity: 520,
  /** 펫이 달려가는 빠르기 (px/초) */
  speed: 340,
  /** 펫 위 이만큼 높이에서 떨어뜨린다 */
  dropAbove: 280,
  /** 펫 쪽에서 좌우로 이만큼 안에 떨어뜨린다 */
  spread: 320,
} as const;

/** 간식을 떨어뜨릴 가로 가운데. 펫에서 너무 가깝지 않게(조금은 달리게), 화면 안에 */
export function treatX(pet: Rect, area: Rect, rand: () => number): number {
  const cx = pet.x + pet.width / 2;
  const side = rand() < 0.5 ? -1 : 1;
  const dist = 90 + rand() * (TREATS.spread - 90);
  let x = cx + side * dist;
  const lo = area.x + pet.width / 2;
  const hi = area.x + area.width - pet.width / 2;
  // 화면 끝에 막히면 반대쪽으로
  if (x < lo || x > hi) x = cx - side * dist;
  return Math.round(Math.max(lo, Math.min(hi, x)));
}

/** 떨어지는 간식이 펫 입에 닿았는지 (간식 가운데 기준) */
export function treatCaught(treat: { x: number; y: number }, pet: Rect): boolean {
  const cx = pet.x + pet.width / 2;
  return Math.abs(treat.x - cx) <= pet.width * 0.28 && treat.y >= pet.y + pet.height * 0.35;
}

// ---- 가위바위보 ----

export type Hand = 'rock' | 'scissors' | 'paper';
export const HANDS: readonly Hand[] = ['rock', 'scissors', 'paper'];
/** 비기면 다시 묻는 횟수 */
export const RPS_MAX_ROUNDS = 3;

/** 사용자가 user, 펫이 pet 을 냈을 때 사용자 쪽 결과 */
export function rpsResult(user: Hand, pet: Hand): 'win' | 'lose' | 'draw' {
  if (user === pet) return 'draw';
  const beats: Record<Hand, Hand> = { rock: 'scissors', scissors: 'paper', paper: 'rock' };
  return beats[user] === pet ? 'win' : 'lose';
}

export const pickHand = (rand: () => number): Hand => HANDS[Math.floor(rand() * 3) % 3] ?? 'rock';

// ---- 친구와 술래잡기 ----

export const TAG = {
  /** 술래(쫓는 쪽)와 도망가는 쪽 빠르기 (px/초). 술래가 조금 빨라 결국 잡는다 */
  chaser: 250,
  runner: 190,
  /** 한 판 최대 (ms) */
  roundMs: 9000,
  /** 도망가는 쪽이 먼저 뛰는 시간 (ms). 바로 옆에서 시작해도 바로 잡히지 않게 */
  headStartMs: 900,
  /** 술래를 바꿔 두 판 */
  rounds: 2,
} as const;

/** 도망갈 x (도망가는 펫 사각형 왼쪽): 술래에게서 먼 화면 끝 */
export function fleeX(chaser: Rect, runner: Rect, area: Rect): number {
  const toRight = runner.x + runner.width / 2 >= chaser.x + chaser.width / 2;
  return toRight ? area.x + area.width - runner.width - 6 : area.x + 6;
}

/** 술래가 잡았는지 (두 펫 가운데 거리) */
export function tagged(chaser: Rect, runner: Rect): boolean {
  const d = Math.abs(chaser.x + chaser.width / 2 - (runner.x + runner.width / 2));
  return d <= (chaser.width + runner.width) * 0.3;
}

/** 술래가 쫓아갈 x: 도망가는 펫 바로 옆 (겹치지 않게 살짝 떨어져) */
export function chaseRunnerX(chaser: Rect, runner: Rect): number {
  const rc = runner.x + runner.width / 2;
  const cc = chaser.x + chaser.width / 2;
  const gap = (chaser.width + runner.width) * 0.25;
  return Math.round((cc <= rc ? rc - gap : rc + gap) - chaser.width / 2);
}

/** 같이 놀 수 있는 친구인지: 같은 화면, 같은 바닥 높이 (40px 안) */
export function samePlayground(a: Rect, b: Rect, sameDisplay: boolean): boolean {
  return sameDisplay && Math.abs(a.y + a.height - (b.y + b.height)) <= 40;
}

// ---- 두더지 잡기 (숨바꼭질처럼) ----
// 펫 자리 둘레에 구멍 여섯 개(3x2). 펫 창이 구멍에서 쏙 솟았다 들어간다. 솟아 있을 때 누르면 잡기.
// 가끔 다른 구멍에 돌멩이나 나뭇잎이 솟는다 (누르면 1점 깎인다). 갈수록 빨라진다.

export const MOLE = {
  ms: 22_000,
  cols: 3,
  rows: 2,
  /** 솟아 있는 시간 (ms): 처음, 끝 */
  upMs: [1150, 620] as const,
  /** 숨어 있는 틈 (ms): 처음, 끝. 여기에 0.8~1.2배 흔들림 */
  gapMs: [700, 320] as const,
  /** 솟는 데, 들어가는 데 (ms) */
  riseMs: 180,
  duckMs: 150,
  /** 들어가기 시작한 뒤에도 이만큼은 잡은 것으로 친다 (누름은 손을 뗄 때 온다) */
  graceMs: 160,
  /** 이만큼 솟은 뒤부터 가짜가 나온다, 나올 확률 */
  decoyAfter: 3,
  decoyChance: 0.25,
  /** 점수가 이만큼이면 코인 1, 2 */
  coinAt: [5, 10] as const,
  /** 점수, 남은 시간 칸 높이 (px) */
  header: 30,
} as const;

export type Decoy = 'pebble' | 'leaf';

export interface MoleField {
  /** 놀이 창 (화면 좌표) */
  rect: Rect;
  /** 구멍 가운데 (화면 좌표), 위 줄 왼쪽부터 */
  holes: Point[];
  /** 구멍 크기 (px) */
  holeW: number;
  holeH: number;
}

/**
 * 구멍 자리: 펫 크기에 맞춰 3x2, 펫 발밑이 아래 줄 가운데 구멍쯤. 화면(area) 안으로.
 * 화면이 좁으면 칸을 줄인다
 */
export function moleField(pet: Rect, area: Rect): MoleField {
  const size = pet.width;
  const colGap = Math.max(
    60,
    Math.min(Math.round(Math.max(size * 1.1, 120)), Math.floor(area.width / MOLE.cols)),
  );
  const holeW = Math.round(Math.min(colGap * 0.86, size * 0.95));
  const holeH = Math.round(holeW * 0.34);
  const rowGap = Math.round(Math.max(size * 0.6, holeH * 2.2));
  // 맨 위 구멍에서 솟은 펫 머리와 점수 칸까지 들어가게
  const top = MOLE.header + size;
  const width = colGap * MOLE.cols;
  const height = top + rowGap * (MOLE.rows - 1) + Math.ceil(holeH / 2) + 6;
  const lowY = pet.y + pet.height - footDrop(holeH);
  const x0 = Math.round(pet.x + pet.width / 2 - width / 2);
  const y0 = Math.round(lowY - top - rowGap * (MOLE.rows - 1));
  const x = Math.max(area.x, Math.min(area.x + area.width - width, x0));
  const y = Math.max(area.y, Math.min(area.y + area.height - height, y0));
  const holes: Point[] = [];
  for (let r = 0; r < MOLE.rows; r++)
    for (let c = 0; c < MOLE.cols; c++)
      holes.push({ x: Math.round(x + colGap * (c + 0.5)), y: Math.round(y + top + rowGap * r) });
  return { rect: { x, y, width, height }, holes, holeW, holeH };
}

/** 구멍 가운데보다 펫 발밑이 조금 아래 (발이 구멍 안에 있게) */
const footDrop = (holeH: number) => Math.round(holeH * 0.2);

/** 이 구멍에서 솟을 때 펫 발밑 가운데 (화면 좌표) */
export function moleFoot(f: MoleField, i: number): Point {
  const h = f.holes[i] ?? f.holes[0] ?? { x: 0, y: 0 };
  return { x: h.x, y: h.y + footDrop(f.holeH) };
}

/** 펫 발밑에서 가장 가까운 구멍 (처음 숨을 구멍) */
export function nearestHole(f: MoleField, foot: Point): number {
  let best = 0;
  let bestD = Number.POSITIVE_INFINITY;
  f.holes.forEach((h, i) => {
    const d = Math.hypot(h.x - foot.x, h.y - foot.y);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

/** 지난 시간(ms)에 따른 솟아 있는 시간과 숨는 틈. 갈수록 빨라진다 */
export function molePace(elapsed: number, rand: () => number): { upMs: number; gapMs: number } {
  const p = Math.min(1, Math.max(0, elapsed / MOLE.ms));
  const lerp = ([a, b]: readonly [number, number]) => a + (b - a) * p;
  return {
    upMs: Math.round(lerp(MOLE.upMs)),
    gapMs: Math.round(lerp(MOLE.gapMs) * (0.8 + 0.4 * rand())),
  };
}

/** 다음에 솟을 구멍: 방금 구멍은 빼고 아무 데나 */
export function nextHole(prev: number, n: number, rand: () => number): number {
  if (n <= 1) return 0;
  const k = Math.min(n - 2, Math.floor(rand() * (n - 1)));
  return k >= prev ? k + 1 : k;
}

/**
 * 가짜(돌멩이, 나뭇잎)를 둘 구멍: 펫과 다른 줄(세로 칸)이라 솟은 펫에 가리지 않는다.
 * 아직 이르거나 운이 아니면 undefined
 */
export function decoyHole(pet: number, shown: number, rand: () => number): number | undefined {
  if (shown < MOLE.decoyAfter || rand() >= MOLE.decoyChance) return undefined;
  const col = pet % MOLE.cols;
  const free: number[] = [];
  for (let i = 0; i < MOLE.cols * MOLE.rows; i++) if (i % MOLE.cols !== col) free.push(i);
  return free[Math.min(free.length - 1, Math.floor(rand() * free.length))];
}

export const pickDecoy = (rand: () => number): Decoy => (rand() < 0.5 ? 'pebble' : 'leaf');

/** 점수: 잡은 수에서 가짜 누른 수를 뺀다 (0 아래로는 안 간다) */
export const moleScore = (hits: number, oops: number): number => Math.max(0, hits - oops);

/** 점수에 따른 코인 (상한 전) */
export function moleCoins(score: number): number {
  const [one, two] = MOLE.coinAt;
  return score >= two ? 2 : score >= one ? 1 : 0;
}

/** 누른 때 잡은 것인지: 솟아 있거나, 들어가기 시작한 지 graceMs 안 (한 번 솟을 때 한 번만) */
export function moleHit(
  pop: { state: 'up' | 'down'; downAt: number; hit: boolean } | undefined,
  now: number,
): boolean {
  if (!pop || pop.hit) return false;
  return pop.state === 'up' || now - pop.downAt <= MOLE.graceMs;
}

/** 솟고 들어가는 펫 사각형: stand(구멍에서 다 솟은 펫)의 발밑을 붙잡고 크기만 u(0~1)로. 작게 솟아 나와 커진다 */
export function burrowFrame(stand: Rect, u: number): Rect {
  const k = Math.min(1, Math.max(0, u));
  // 끝에서 살짝 넘쳤다 돌아온다 (뿅). 넘침은 6% 안
  const ease = k >= 1 ? 1 : 1 - (1 - k) ** 3 + Math.sin(Math.PI * k) * 0.06;
  const size = Math.max(4, Math.round(stand.width * (BURROW_MIN + (1 - BURROW_MIN) * ease)));
  const cx = stand.x + stand.width / 2;
  const bottom = stand.y + stand.height;
  return { x: Math.round(cx - size / 2), y: bottom - size, width: size, height: size };
}

/** 구멍 속 가장 작은 크기 (펫 크기에 대한 비) */
export const BURROW_MIN = 0.1;
