// 짧은 놀이 (미니 게임) 실행: 비눗방울, 레이저 쫓기, 간식 받아먹기, 가위바위보, 친구와 술래잡기, 두더지 잡기, 웃겨 줘, 하이파이브.
// 규칙과 계산은 shared/minigames.ts. 여기는 작은 투명 창(방울, 점, 간식, 구멍)과 타이머만 다룬다.
// 한 번에 하나만 하고, 끝나면(다 함, 그만 놀기, 숨음, 화면 잠금, 모니터 바뀜, 끌기) 창과 타이머를 다 치운다.
import { BrowserWindow, powerMonitor, screen, systemPreferences } from 'electron';
import {
  HIGH_FIVE,
  highFiveResult,
  JOKE_PAUSE_MS,
  jokeMove,
  pickJoke,
  pickLine,
  rememberJoke,
} from '../shared/fun.ts';
import type { Rect } from '../shared/geometry.ts';
import { type I18nKey, t } from '../shared/i18n/index.ts';
import {
  affectionAllowed,
  BUBBLES,
  type Bubble,
  bubbleAlive,
  bubbleAt,
  bubbleCoins,
  bubbleField,
  bubbleHit,
  chaseRunnerX,
  chaseX,
  decoyHole,
  fleeX,
  grantCoins,
  HANDS,
  type Hand,
  LASER,
  laserCaught,
  type MiniGame,
  MOLE,
  makeBubble,
  moleCoins,
  moleField,
  moleFoot,
  moleHit,
  molePace,
  moleScore,
  nearestHole,
  nextHole,
  type PlayBlock,
  pickDecoy,
  pickHand,
  playBlock,
  playsOn,
  RPS_MAX_ROUNDS,
  rpsResult,
  samePlayground,
  silentBlock,
  TAG,
  TREATS,
  tagged,
  treatCaught,
  treatX,
} from '../shared/minigames.ts';
import { voiced } from '../shared/persona-voice.ts';
import { localDay } from '../shared/todo-store.ts';
import { onDisplaysChanged } from './display-watch.ts';
import { decoyBox, MOLE_CSS, moleBody } from './mole-art.ts';
import type { PetWindow } from './pet-window.ts';
import { readJson, writeJson } from './store.ts';

/** 하루 판 수 (친밀도 상한) 저장 파일 */
const PLAYS_FILE = 'play-day';
const FRAME_MS = 16;

/** 운영체제 "동작 줄이기". 켜져 있으면 펫이 솟고 들어가는 움직임 없이 바로 나타나고 사라진다 */
function reducedMotion(): boolean {
  try {
    return systemPreferences.getAnimationSettings().prefersReducedMotion;
  } catch {
    return false;
  }
}

export interface MiniGameOptions {
  pet: () => PetWindow;
  /** 지금 떠 있는 친구 펫 (술래잡기) */
  mates: () => { pet: PetWindow; name: string }[];
  /** 집중 타이머 중 (펫이 잔다) */
  focus: () => boolean;
  hungry: () => boolean;
  /** 오늘 놀이로 받은 코인 */
  coinsToday: () => number;
  /** 놀이 코인을 넣는다 (상한은 여기서 이미 셌다) */
  giveCoins: (coins: number) => void;
  /** 기분, 친밀도 (pet-life 의 play 활동) */
  played: () => void;
  log: (tag: string, ...rest: unknown[]) => void;
}

/** 놀이 창: 작은 투명 창 하나. 그림(SVG)과 모양(CSS)만, 스크립트 없음. 마우스는 기본으로 통과 */
function spriteWindow(rect: Rect, body: string, css: string): BrowserWindow {
  const win = new BrowserWindow({
    ...rect,
    transparent: true,
    frame: false,
    hasShadow: false,
    resizable: false,
    skipTaskbar: true,
    focusable: false,
    alwaysOnTop: true,
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true },
  });
  win.setAlwaysOnTop(true, 'floating');
  win.setIgnoreMouseEvents(true);
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
  // 메인이 executeJavaScript 로 방울을 더하고 모양을 바꾼다. 그것은 페이지 CSP 를 따르지 않아 스크립트는 열지 않는다
  const csp = "default-src 'none'; style-src 'unsafe-inline'";
  const html = `<html><head><meta http-equiv="Content-Security-Policy" content="${csp}"><style>html,body{margin:0;overflow:hidden;background:transparent;user-select:none}${css}</style></head><body>${body}</body></html>`;
  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) win.showInactive();
  });
  return win;
}

// ---- 그림 ----

/** 사인 곡선을 8토막으로 (화면 흔들림이 메인의 bubbleAt 과 1px 남짓 안에서 맞는다) */
const SWAY_KEYS = Array.from({ length: 9 }, (_, i) => {
  const x = BUBBLES.sway * Math.sin((i / 8) * 2 * Math.PI);
  return `${(i / 8) * 100}%{transform:translateX(${x.toFixed(2)}px)}`;
}).join('');

const BUBBLE_CSS = `
.b{position:absolute;left:0;top:0;width:${BUBBLES.size}px;height:${BUBBLES.size}px;margin:-${BUBBLES.size / 2}px 0 0 -${BUBBLES.size / 2}px;animation:rise linear forwards;cursor:pointer}
.b>i{display:block;width:100%;height:100%;animation:sway ${BUBBLES.swayMs}ms linear infinite}
.b svg{display:block;width:100%;height:100%;overflow:visible}
.b .s{position:absolute;inset:0;opacity:0}
.b.pop{animation-play-state:paused}
.b.pop>i{animation-play-state:paused}
.b.pop .m{animation:pop .26s ease-out forwards}
.b.pop .s{animation:spark .36s ease-out forwards}
.b.out .m{animation:fade .5s ease-in forwards}
.b{animation-name:rise}
@keyframes rise{from{transform:translate(var(--x),var(--y0))}to{transform:translate(var(--x),var(--y1))}}
@keyframes sway{${SWAY_KEYS}}
@keyframes pop{to{transform:scale(1.45);opacity:0}}
@keyframes spark{0%{opacity:1;transform:scale(.6)}100%{opacity:0;transform:scale(1.5)}}
@keyframes fade{to{transform:scale(.6);opacity:0}}
@media (prefers-reduced-motion:reduce){.b>i{animation:none}}`;

/** 무지갯빛 방울 (그라데이션은 한 번만 정의) */
const BUBBLE_DEFS = `<svg width="0" height="0" style="position:absolute"><defs>
<radialGradient id="g" cx="36%" cy="30%" r="78%"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset=".22" stop-color="#d9f3ff" stop-opacity=".35"/><stop offset=".62" stop-color="#c3b5ff" stop-opacity=".22"/><stop offset=".86" stop-color="#ffb3dd" stop-opacity=".5"/><stop offset="1" stop-color="#8fd3ff" stop-opacity=".75"/></radialGradient>
</defs></svg>`;
const BUBBLE_SVG = `<svg class="m" viewBox="0 0 46 46"><circle cx="23" cy="23" r="21" fill="url(#g)" stroke="#8fcff5" stroke-opacity=".85" stroke-width="1.4"/><ellipse cx="15" cy="13" rx="6.5" ry="3.6" fill="#fff" opacity=".92" transform="rotate(-32 15 13)"/><circle cx="31.5" cy="33" r="2.2" fill="#fff" opacity=".75"/></svg><svg class="s" viewBox="0 0 46 46"><g stroke="#8fcff5" stroke-width="2.4" stroke-linecap="round"><path d="M23 3v6M23 37v6M3 23h6M37 23h6M9 9l4 4M33 33l4 4M37 9l-4 4M13 33l-4 4"/></g></svg>`;

/** 레이저 점. 반짝이는 애니메이션은 넣지 않는다: 끝없는 CSS 애니메이션 하나가 CPU 를 20% 넘게 먹었다 (2026-10-08 측정) */
const DOT_CSS = `.d{position:absolute;inset:3px;border-radius:50%;background:radial-gradient(circle at 40% 38%,#fff 0 14%,#ff5a6e 34%,#e11d48 70%,rgba(225,29,72,0) 100%);box-shadow:0 0 8px 3px rgba(255,64,96,.55)}`;

/** 간식 세 가지: 쿠키, 별사탕, 생선 과자. body 의 class 로 고른다 */
const TREAT_SVGS = [
  `<svg class="k0" viewBox="0 0 34 34"><circle cx="17" cy="17" r="14" fill="#e9b872" stroke="#b07a3a" stroke-width="2"/><circle cx="12" cy="13" r="2.3" fill="#6b3f1e"/><circle cx="21" cy="11" r="2" fill="#6b3f1e"/><circle cx="20" cy="21" r="2.4" fill="#6b3f1e"/><circle cx="11" cy="21" r="1.8" fill="#6b3f1e"/></svg>`,
  `<svg class="k1" viewBox="0 0 34 34"><path d="M17 3l4 9 10 1-7.5 6.6L26 30l-9-5.2L8 30l2.5-10.4L3 13l10-1z" fill="#ffd166" stroke="#e0a526" stroke-width="2" stroke-linejoin="round"/><circle cx="14" cy="15" r="1.4" fill="#7a4b00"/><circle cx="20" cy="15" r="1.4" fill="#7a4b00"/><path d="M14.5 19q2.5 2 5 0" fill="none" stroke="#7a4b00" stroke-width="1.4" stroke-linecap="round"/></svg>`,
  `<svg class="k2" viewBox="0 0 34 34"><path d="M5 17c4-7 13-9 20-3l5-4v14l-5-4c-7 6-16 4-20-3z" fill="#8ecae6" stroke="#3d7ea6" stroke-width="2" stroke-linejoin="round"/><circle cx="11" cy="15.5" r="1.6" fill="#1d3557"/><path d="M16 12q2 5 0 10" fill="none" stroke="#3d7ea6" stroke-width="1.5"/></svg>`,
].join('');
// 떨어지며 빙글 도는 애니메이션은 넣지 않는다 (창을 옮기는 것만으로 충분히 움직이고, 끝없는 애니메이션은 CPU 를 먹는다)
const TREAT_CSS = `svg{position:absolute;inset:0;width:100%;height:100%;display:none;transform:rotate(-12deg)}
body.k0 .k0,body.k1 .k1,body.k2 .k2{display:block}
body.land svg{animation:squash .3s ease-out}
@keyframes squash{0%{transform:scale(1.25,.75)}100%{transform:rotate(-12deg)}}
@media (prefers-reduced-motion:reduce){svg{animation:none}}`;

// ---- 놀이 ----

export type MiniGames = ReturnType<typeof createMiniGames>;

export function createMiniGames(o: MiniGameOptions) {
  /** 지금 하는 놀이 */
  let current:
    | {
        game: MiniGame;
        abort: AbortController;
        wins: Set<BrowserWindow>;
        poke?: () => void;
        /** 펫 누르기를 놀이가 받는다 (두더지 잡기). 없으면 펫 누르기는 그만 놀기 */
        tap?: () => void;
      }
    | undefined;

  const say = (key: I18nKey, vars?: Record<string, string | number>, ttlMs = 3500) =>
    // 고른 성격 말투로 (존댓말 비서면 존댓말, 이슈 #65)
    o.pet().say({ kind: 'answer', text: voiced(key, vars), ttlMs });

  function blockOf(game: MiniGame): PlayBlock | undefined {
    const pet = o.pet();
    return playBlock(game, {
      hidden: pet.isHidden(),
      // 집에서 쉬는 중(숨김 까닭 house)도 숨음이라 위에서 걸린다. 따로 이름만 둔다
      resting: pet.isHidden('house'),
      focus: o.focus(),
      locked: powerMonitor.getSystemIdleState(60) === 'locked',
      held: pet.held(),
      playing: !!current,
      hungry: o.hungry(),
      friend: !!mate(),
    });
  }

  /** 술래잡기 친구: 보이고 한가하고 같은 화면 같은 바닥 (아니면 같은 화면에 있는 친구) */
  function mate(): { pet: PetWindow; name: string } | undefined {
    const main = o.pet().bounds();
    const display = screen.getDisplayMatching(main).id;
    const near = o
      .mates()
      .filter((m) => !m.pet.win.isDestroyed() && !m.pet.isHidden() && !m.pet.held())
      .filter((m) => screen.getDisplayMatching(m.pet.bounds()).id === display);
    return (
      near.find((m) => samePlayground(main, m.pet.bounds(), true) && m.pet.isIdle()) ??
      near.find((m) => m.pet.isIdle()) ??
      near[0]
    );
  }

  /**
   * 말하고 ms 뒤에 말풍선을 거둔다 (뛰는 놀이 전에). 말풍선이 떠 있으면 펫 화면이 걷기를 받지 않는다 (말하는 모습).
   * 그만 놀기를 누르면 바로 거둔다
   */
  async function sayFor(
    key: I18nKey,
    vars: Record<string, string | number> | undefined,
    ms: number,
    signal: AbortSignal,
  ) {
    const close = new AbortController();
    const stop = () => close.abort();
    signal.addEventListener('abort', stop, { once: true });
    void o.pet().say({
      kind: 'answer',
      text: voiced(key, vars),
      ttlMs: ms + 1000,
      signal: close.signal,
    });
    await wait(ms, signal);
    close.abort();
    signal.removeEventListener('abort', stop);
    // 말풍선이 닫히고 화면이 기본 모습으로 돌아올 틈
    await wait(150, signal);
  }

  /** 오늘 친밀도를 받은 판 수를 세고, 상한 안이면 기분, 친밀도를 올린다 */
  function countPlay() {
    const day = localDay(Date.now());
    const n = playsOn(readJson(PLAYS_FILE), day);
    try {
      writeJson(PLAYS_FILE, { day, n: n + 1 });
    } catch (e) {
      o.log('play', '판 수 저장 실패', String(e));
    }
    if (affectionAllowed(n)) o.played();
  }

  /** 놀이 코인: 원하는 만큼에서 오늘 상한을 넘지 않게. 실제로 준 수 */
  function pay(want: number): number {
    const coins = grantCoins(want, o.coinsToday());
    if (coins > 0) o.giveCoins(coins);
    return coins;
  }

  const wait = (ms: number, signal: AbortSignal) =>
    new Promise<void>((resolve) => {
      if (signal.aborted) return resolve();
      const timer = setTimeout(done, ms);
      function done() {
        clearTimeout(timer);
        signal.removeEventListener('abort', done);
        resolve();
      }
      signal.addEventListener('abort', done, { once: true });
    });

  /** 놀이 하나를 한다. 시작 못 하면 false (말해 줄 까닭이면 펫이 말한다) */
  async function start(game: MiniGame): Promise<boolean> {
    const block = blockOf(game);
    if (block) {
      o.log('play', game, '못 함', block);
      if (!silentBlock(block)) void say(`play.block.${block}` as I18nKey);
      return false;
    }
    const abort = new AbortController();
    const run: Run = { game, abort, wins: new Set<BrowserWindow>() };
    current = run;
    o.log('play', game, '시작');
    // 다 그만두는 때: 숨음(발표, 숨기기, 집), 화면 잠금, 잠자기, 모니터가 바뀜. 끌기는 놀이마다 본다
    const stop = (why: string) => () => abort.abort(why);
    const onLock = stop('lock');
    const onSuspend = stop('suspend');
    powerMonitor.on('lock-screen', onLock);
    powerMonitor.on('suspend', onSuspend);
    const stopDisplays = onDisplaysChanged(stop('display'));
    const watch = setInterval(() => {
      if (o.pet().isHidden()) abort.abort('hidden');
    }, 250);
    try {
      const done = await PLAYS[game](run);
      o.log('play', game, done ? '끝' : '그만', abort.signal.aborted ? String(abort.signal.reason) : '');
      return done;
    } catch (e) {
      o.log('play', game, '오류', String(e));
      return false;
    } finally {
      clearInterval(watch);
      stopDisplays();
      powerMonitor.off('lock-screen', onLock);
      powerMonitor.off('suspend', onSuspend);
      for (const w of run.wins) if (!w.isDestroyed()) w.destroy();
      run.wins.clear();
      if (current === run) current = undefined;
    }
  }

  type Run = NonNullable<typeof current>;

  function sprite(run: Run, rect: Rect, body: string, css: string): BrowserWindow {
    const w = spriteWindow(rect, body, css);
    run.wins.add(w);
    return w;
  }

  // ---- 비눗방울 ----
  // 펫 머리 위로 방울이 하나씩 올라간다. 눌러서 터뜨린다(방울 위에서만 마우스를 받는다). 펫은 터질 때마다 좋아한다.
  async function bubbles(run: Run): Promise<boolean> {
    const pet = o.pet();
    const signal = run.abort.signal;
    void say('play.bubbles.start', undefined, 2600);
    const area = screen.getDisplayMatching(pet.bounds()).workArea;
    const field = bubbleField(pet.bounds(), area);
    const w = sprite(run, field, BUBBLE_DEFS, BUBBLE_CSS);
    const list: { b: Bubble; at: number; state: 'up' | 'pop' | 'gone' }[] = [];
    let popped = 0;
    let catching = false;
    const js = (code: string) => {
      if (!w.isDestroyed()) void w.webContents.executeJavaScript(code, true).catch(() => {});
    };
    const catchMouse = (on: boolean) => {
      if (on === catching || w.isDestroyed()) return;
      catching = on;
      w.setIgnoreMouseEvents(!on, { forward: true });
    };
    w.setIgnoreMouseEvents(true, { forward: true });
    const hitAt = (p: { x: number; y: number }) => {
      const now = Date.now();
      return list.findIndex((it) => it.state === 'up' && bubbleHit(p, bubbleAt(it.b, now - it.at)));
    };
    function pop(i: number, byUser: boolean) {
      const it = list[i];
      if (it?.state !== 'up') return;
      it.state = byUser ? 'pop' : 'gone';
      js(`document.getElementById('b${i}')?.classList.add(${JSON.stringify(byUser ? 'pop' : 'out')})`);
      if (!byUser) return;
      popped++;
      pet.sound('pop');
      pet.react(popped % 3 === 0 ? 'love' : 'happy');
    }
    w.webContents.on('before-mouse-event', (_e, m) => {
      if (m.type === 'mouseLeave') return catchMouse(false);
      const i = hitAt({ x: m.x, y: m.y });
      if (m.type === 'mouseMove' || m.type === 'mouseEnter') catchMouse(i >= 0);
      else if (m.type === 'mouseDown' && m.button === 'left' && i >= 0) {
        pop(i, true);
        catchMouse(hitAt({ x: m.x, y: m.y }) >= 0);
      }
    });
    // 개발용: 떠 있는 첫 방울을 누른 것처럼
    run.poke = () => {
      const i = list.findIndex((it) => it.state === 'up');
      if (i >= 0) pop(i, true);
    };
    // 방울 위 우클릭은 그만 놀기
    w.webContents.on('context-menu', () => run.abort.abort('menu'));
    await new Promise<void>((resolve) => w.webContents.once('did-finish-load', () => resolve()));
    const total = BUBBLES.count;
    let blown = 0;
    let nextAt = Date.now() + 500;
    await new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        const now = Date.now();
        if (signal.aborted || pet.held()) {
          clearInterval(timer);
          return resolve();
        }
        if (blown < total && now >= nextAt) {
          const b = makeBubble(Math.random);
          const i = list.length;
          list.push({ b, at: now, state: 'up' });
          const dy = (b.speed * BUBBLES.lifeMs) / 1000;
          js(
            `(()=>{const e=document.createElement('div');e.className='b';e.id='b${i}';e.style.cssText='--x:${b.x0}px;--y0:${b.y0}px;--y1:${(b.y0 - dy).toFixed(1)}px;animation-duration:${BUBBLES.lifeMs}ms';e.innerHTML='<i style="animation-delay:-${Math.round(b.phase * BUBBLES.swayMs)}ms">${BUBBLE_SVG.replace(/'/g, "\\'")}</i>';document.body.appendChild(e)})()`,
          );
          blown++;
          nextAt = now + BUBBLES.everyMs;
        }
        list.forEach((it, i) => {
          if (it.state === 'up' && !bubbleAlive(it.b, now - it.at)) pop(i, false);
        });
        if (blown === total && list.every((it) => it.state !== 'up')) {
          clearInterval(timer);
          resolve();
        }
      }, 100);
      signal.addEventListener('abort', () => {
        clearInterval(timer);
        resolve();
      });
    });
    // 마지막 터지는 모양이 보이게 잠깐
    await wait(400, new AbortController().signal);
    w.destroy();
    if (signal.aborted && popped === 0) return false;
    countPlay();
    const coins = pay(bubbleCoins(popped, total));
    if (popped === 0) void say('play.bubbles.none');
    else if (coins > 0) void say('play.bubbles.endCoins', { popped, coins });
    else void say('play.bubbles.end', { popped });
    return !signal.aborted;
  }

  // ---- 레이저 쫓기 ----
  // 커서에 빨간 점이 붙고, 펫이 바닥에서 점 아래로 달린다. 점을 바닥 가까이(펫 키 안) 대면 잡는다.
  async function laser(run: Run): Promise<boolean> {
    const pet = o.pet();
    const signal = run.abort.signal;
    await pet.land();
    await sayFor('play.laser.start', undefined, 2600, signal);
    if (signal.aborted) return false;
    const half = LASER.size / 2;
    const c0 = screen.getCursorScreenPoint();
    const dot = sprite(
      run,
      { x: c0.x - half, y: c0.y - half, width: LASER.size, height: LASER.size },
      '<div class="d"></div>',
      DOT_CSS,
    );
    let cursor = c0;
    let catches = 0;
    let lastCatch = 0;
    const tick = setInterval(() => {
      const c = screen.getCursorScreenPoint();
      if (c.x !== cursor.x || c.y !== cursor.y) {
        cursor = c;
        if (!dot.isDestroyed()) dot.setPosition(Math.round(c.x - half), Math.round(c.y - half));
      }
      const now = Date.now();
      if (now - lastCatch > LASER.catchGapMs && laserCaught(cursor, pet.bounds())) {
        lastCatch = now;
        catches++;
        pet.sound('crunch');
        pet.react('love');
      }
    }, FRAME_MS);
    const end = Date.now() + LASER.ms;
    try {
      while (!signal.aborted && Date.now() < end) {
        // 모니터가 바뀌면 놀이가 끝나니 펫 화면은 한 번만 읽는다
        const area = screen.getDisplayMatching(pet.bounds()).workArea;
        const ok = await pet.follow(
          () => chaseX(cursor, pet.bounds(), area),
          LASER.speed,
          end - Date.now(),
          signal,
        );
        if (ok || signal.aborted) break;
        // 사용자가 들었거나 숨었으면 끝. 아니면(화면이 걷기를 멈춤) 잠깐 쉬고 다시 쫓는다
        if (pet.held() || pet.isHidden()) {
          run.abort.abort('held');
          break;
        }
        await wait(300, signal);
      }
    } finally {
      clearInterval(tick);
      dot.destroy();
    }
    if (signal.aborted && catches === 0) return false;
    countPlay();
    const coins = pay(catches >= LASER.coinCatches ? 1 : 0);
    if (catches === 0) void say('play.laser.none');
    else if (coins > 0) void say('play.laser.endCoins', { n: catches, coins });
    else void say('play.laser.end', { n: catches });
    pet.react();
    return !signal.aborted;
  }

  // ---- 간식 받아먹기 ----
  // 펫 위에서 간식이 하나씩 떨어진다. 펫이 달려가 받아먹고, 놓치면 바닥에서 주워 먹는다.
  async function treats(run: Run): Promise<boolean> {
    const pet = o.pet();
    const signal = run.abort.signal;
    await pet.land();
    await sayFor('play.treats.start', undefined, 1800, signal);
    if (signal.aborted) return false;
    const size = TREATS.size;
    const w = sprite(run, { x: -1000, y: -1000, width: size, height: size }, TREAT_SVGS, TREAT_CSS);
    await new Promise<void>((resolve) => w.webContents.once('did-finish-load', () => resolve()));
    const setKind = (cls: string) => {
      if (!w.isDestroyed())
        void w.webContents.executeJavaScript(`document.body.className='${cls}'`, true).catch(() => {});
    };
    let air = 0;
    let eaten = 0;
    for (let i = 0; i < TREATS.count && !signal.aborted; i++) {
      const p = pet.bounds();
      const area = screen.getDisplayMatching(p).workArea;
      const cx = treatX(p, area, Math.random);
      const floor = area.y + area.height - size;
      let y = Math.max(area.y, p.y - TREATS.dropAbove);
      let vy = 0;
      setKind(`k${i % 3}`);
      if (!w.isDestroyed()) w.setPosition(Math.round(cx - size / 2), Math.round(y));
      // 펫이 달려간다 (기다리지 않고), 간식은 떨어진다
      const run1 = pet.walkTo(cx - p.width / 2, TREATS.speed);
      const caught = await new Promise<boolean>((resolve) => {
        let last = Date.now();
        const timer = setInterval(() => {
          const now = Date.now();
          const dt = Math.min(0.05, (now - last) / 1000);
          last = now;
          if (signal.aborted || pet.held()) {
            clearInterval(timer);
            return resolve(false);
          }
          vy += TREATS.gravity * dt;
          y = Math.min(floor, y + vy * dt);
          if (!w.isDestroyed()) w.setPosition(Math.round(cx - size / 2), Math.round(y));
          if (treatCaught({ x: cx, y: y + size / 2 }, pet.bounds())) {
            clearInterval(timer);
            return resolve(true);
          }
          if (y >= floor) {
            clearInterval(timer);
            setKind(`k${i % 3} land`);
            resolve(false);
          }
        }, FRAME_MS);
      });
      if (signal.aborted || pet.held()) break;
      if (!caught) {
        // 바닥에 떨어졌으면 마저 가서 주워 먹는다
        if (!(await run1) && (pet.held() || signal.aborted)) break;
        await pet.walkTo(cx - pet.bounds().width / 2, TREATS.speed);
      } else air++;
      if (!w.isDestroyed()) w.setPosition(-1000, -1000);
      eaten++;
      pet.sound('crunch');
      pet.react(i === TREATS.count - 1 ? 'fed' : 'love');
      await wait(caught ? 500 : 700, signal);
    }
    w.destroy();
    if (eaten === 0) return false;
    countPlay();
    if (o.hungry()) void say('play.treats.endHungry');
    else if (air > 0) void say('play.treats.end', { n: air });
    else void say('play.treats.endFloor');
    return !signal.aborted;
  }

  // ---- 가위바위보 ----
  // 말풍선 단추 세 개. 펫은 아무거나 낸다. 비기면 한 번 더 (세 번까지). 이기면 코인 1 (하루 상한 안에서)
  async function rps(run: Run): Promise<boolean> {
    const pet = o.pet();
    const signal = run.abort.signal;
    const label = (h: Hand) => t(`play.rps.${h}` as I18nKey);
    for (let round = 0; round < RPS_MAX_ROUNDS && !signal.aborted; round++) {
      const answer = await pet.say({
        kind: 'answer',
        text: voiced(round === 0 ? 'play.rps.ask' : 'play.rps.again'),
        buttons: HANDS.map((h) => ({ id: h, label: label(h) })),
        ttlMs: 15_000,
        signal,
      });
      if (!HANDS.includes(answer as Hand)) return false;
      const user = answer as Hand;
      const mine = pickHand(Math.random);
      const result = rpsResult(user, mine);
      if (result === 'draw') {
        void say('play.rps.draw', { hand: label(mine) }, 1600);
        await wait(1700, signal);
        continue;
      }
      countPlay();
      if (result === 'win') {
        const coins = pay(1);
        pet.react();
        void say(coins > 0 ? 'play.rps.winCoins' : 'play.rps.win', { hand: label(mine), coins });
      } else {
        pet.react();
        void say('play.rps.lose', { hand: label(mine) });
      }
      return true;
    }
    if (!signal.aborted) void say('play.rps.tired');
    return false;
  }

  // ---- 친구와 술래잡기 ----
  // 기본 펫이 먼저 술래: 친구가 먼 화면 끝으로 도망가고 기본 펫이 쫓는다. 잡으면 술래를 바꿔 한 판 더. 끝나면 마주 보고 하트.
  async function tag(run: Run): Promise<boolean> {
    const main = o.pet();
    const signal = run.abort.signal;
    const m = mate();
    if (!m) return false;
    await Promise.all([main.land(), m.pet.land()]);
    if (!samePlayground(main.bounds(), m.pet.bounds(), true)) {
      void say('play.block.noFriend');
      return false;
    }
    await sayFor('play.tag.start', { name: m.name }, 2400, signal);
    let rounds = 0;
    const pairs: [PetWindow, PetWindow][] = [
      [main, m.pet],
      [m.pet, main],
    ];
    for (const [chaser, runner] of pairs.slice(0, TAG.rounds)) {
      if (signal.aborted) break;
      const area = screen.getDisplayMatching(chaser.bounds()).workArea;
      const round = new AbortController();
      const stopRound = () => round.abort();
      signal.addEventListener('abort', stopRound, { once: true });
      // 바로 옆에서 시작해도 도망갈 틈을 준다: 술래는 잠깐 기다렸다 쫓고, 그동안은 잡아도 세지 않는다
      const startedAt = Date.now();
      const check = setInterval(() => {
        if (Date.now() - startedAt > TAG.headStartMs + 400 && tagged(chaser.bounds(), runner.bounds()))
          stopRound();
        if (chaser.held() || runner.held() || runner.win.isDestroyed()) {
          stopRound();
          run.abort.abort('held');
        }
      }, 50);
      // 도망가는 쪽도 같은 빠르기로 바로 뛴다 (걷기는 천천히 출발해서 바로 잡혔다)
      const to = fleeX(chaser.bounds(), runner.bounds(), area);
      const flee = runner.follow(() => to, TAG.runner, TAG.roundMs, round.signal);
      await wait(TAG.headStartMs, round.signal);
      await chaser.follow(
        () => chaseRunnerX(chaser.bounds(), runner.bounds()),
        TAG.chaser,
        TAG.roundMs,
        round.signal,
      );
      clearInterval(check);
      signal.removeEventListener('abort', stopRound);
      runner.halt();
      await flee;
      if (signal.aborted) break;
      rounds++;
      const dir = (a: PetWindow, b: PetWindow): -1 | 1 => (a.bounds().x <= b.bounds().x ? 1 : -1);
      chaser.greet(dir(chaser, runner));
      runner.greet(dir(runner, chaser));
      chaser.sound('pop');
      if (rounds < TAG.rounds) {
        await wait(900, signal);
        await sayFor('play.tag.swap', { name: m.name }, 1600, signal);
      }
    }
    if (rounds === 0) return false;
    countPlay();
    void say('play.tag.end', { name: m.name });
    return !signal.aborted;
  }

  // ---- 두더지 잡기 ----
  // 펫 자리 둘레에 구멍 여섯 개를 그린 창을 펫 창 아래에 깔고, 펫 창이 구멍을 옮겨 다니며 솟았다 쏙 들어간다.
  // 솟아 있을 때 펫을 누르면 잡기(뿅). 가끔 다른 구멍에 돌멩이나 나뭇잎이 솟는데 누르면 1점 깎인다. 갈수록 빨라진다.
  // 펫 누르기가 잡기라 그만두기는 우클릭 "그만 놀기" (구멍 창 우클릭도).
  async function mole(run: Run): Promise<boolean> {
    const pet = o.pet();
    const signal = run.abort.signal;
    // 안내(2.6초) 동안 펫을 눌러도 그만 놀기가 아니다: 펫 누르기는 처음부터 놀이가 받는다 (그만두기는 우클릭)
    run.tap = () => {};
    await pet.land();
    await sayFor('play.mole.start', undefined, 2600, signal);
    if (signal.aborted || pet.held()) return false;
    const start = pet.bounds();
    const home = { x: start.x, y: start.y };
    const homeFoot = { x: start.x + start.width / 2, y: start.y + start.height };
    const f = moleField(start, screen.getDisplayMatching(start).workArea);
    const calm = reducedMotion();
    const rise = calm ? 0 : MOLE.riseMs;
    const duck = calm ? 0 : MOLE.duckMs;
    const w = sprite(run, f.rect, moleBody(f), MOLE_CSS);
    w.setIgnoreMouseEvents(true, { forward: true });
    // 구멍 창이 펫 창 위에 뜨면 펫이 구멍 뒤에 가린다. 펫을 같은 층 맨 위로 (숨은 창에 부르면 맥에서 나타난다)
    w.once('show', () => {
      if (!pet.win.isDestroyed() && pet.win.isVisible()) pet.win.moveTop();
    });
    const js = (code: string) => {
      if (!w.isDestroyed()) void w.webContents.executeJavaScript(code, true).catch(() => {});
    };
    let hits = 0;
    let oops = 0;
    let shown = 0;
    let pop:
      | { hole: number; state: 'up' | 'down'; downAt: number; hit: boolean; whack: AbortController }
      | undefined;
    let decoy: { hole: number; hit: boolean } | undefined;
    const showScore = () => js(`document.getElementById('n').textContent='${moleScore(hits, oops)}'`);
    /** 구멍 위 효과 (hit: 별과 +1, oops: -1). 같은 class 를 다시 붙여도 처음부터 */
    const flash = (hole: number, cls: 'hit' | 'oops') =>
      js(
        `(()=>{const e=document.getElementById('x${hole}');if(!e)return;e.className='fx';void e.offsetWidth;e.className='fx ${cls}'})()`,
      );
    const setDecoy = (hole?: number) =>
      js(
        `(()=>{for(const e of document.querySelectorAll('.h.on'))e.classList.remove('on','oops');${hole === undefined ? '' : `const h=document.getElementById('h${hole}');if(h){h.dataset.k='${pickDecoy(Math.random)}';h.classList.add('on')}`}})()`,
      );
    run.tap = () => {
      if (!pop || !moleHit(pop, Date.now())) return;
      pop.hit = true;
      hits++;
      pet.sound('pop');
      pet.react('happy');
      flash(pop.hole, 'hit');
      showScore();
      pop.whack.abort();
    };
    // 개발용: 솟은 펫을 누른 것처럼
    run.poke = run.tap;
    // 가짜 위에서만 마우스를 받는다 (비눗방울과 같은 방법)
    const box = decoyBox(f);
    let catching = false;
    const catchMouse = (on: boolean) => {
      if (on === catching || w.isDestroyed()) return;
      catching = on;
      w.setIgnoreMouseEvents(!on, { forward: true });
    };
    const overDecoy = (p: { x: number; y: number }) => {
      const h = decoy && !decoy.hit ? f.holes[decoy.hole] : undefined;
      if (!h) return false;
      const x = h.x - f.rect.x;
      const y = h.y - f.rect.y;
      return Math.abs(p.x - x) <= box.w / 2 && p.y >= y - box.h - 4 && p.y <= y + 4;
    };
    w.webContents.on('before-mouse-event', (_e, m) => {
      if (m.type === 'mouseLeave') return catchMouse(false);
      const over = overDecoy({ x: m.x, y: m.y });
      if (m.type === 'mouseMove' || m.type === 'mouseEnter') catchMouse(over);
      else if (m.type === 'mouseDown' && m.button === 'left' && over && decoy) {
        decoy.hit = true;
        oops++;
        js(`document.getElementById('h${decoy.hole}')?.classList.add('oops')`);
        flash(decoy.hole, 'oops');
        showScore();
        catchMouse(false);
      }
    });
    w.webContents.on('context-menu', () => run.abort.abort('menu'));
    await new Promise<void>((resolve) => w.webContents.once('did-finish-load', () => resolve()));
    let ok = false;
    try {
      // 먼저 발밑 구멍으로 쏙 숨는다
      if (signal.aborted || !(await pet.burrow(homeFoot, false, duck))) return false;
      js(`document.body.classList.add('go')`);
      const started = Date.now();
      const end = started + MOLE.ms;
      let prev = nearestHole(f, homeFoot);
      while (!signal.aborted && Date.now() < end) {
        const pace = molePace(Date.now() - started, Math.random);
        await wait(pace.gapMs, signal);
        if (signal.aborted || Date.now() >= end) break;
        const hole = nextHole(prev, f.holes.length, Math.random);
        prev = hole;
        const d = decoyHole(hole, shown, Math.random);
        decoy = d === undefined ? undefined : { hole: d, hit: false };
        if (d !== undefined) setDecoy(d);
        shown++;
        const whack = new AbortController();
        pop = { hole, state: 'up', downAt: 0, hit: false, whack };
        const foot = moleFoot(f, hole);
        if (!(await pet.burrow(foot, true, rise))) break;
        await wait(pace.upMs, AbortSignal.any([signal, whack.signal]));
        pop.state = 'down';
        pop.downAt = Date.now();
        if (decoy) setDecoy();
        decoy = undefined;
        catchMouse(false);
        // 잡히면 더 빨리 쏙
        if (!(await pet.burrow(foot, false, pop.hit ? Math.round(duck * 0.6) : duck))) break;
      }
      if (pet.held()) run.abort.abort('held');
      ok = !signal.aborted;
    } finally {
      run.tap = undefined;
      run.poke = undefined;
      if (!w.isDestroyed()) w.destroy();
      // 그만두면 바로 원래 자리에 (들려 있으면 끌기가 자리를 맡는다)
      if (!ok) pet.unburrow(pet.held() ? undefined : home);
    }
    // 다 놀았으면 원래 자리 구멍에서 솟아 나온다
    if (ok) {
      await pet.burrow(homeFoot, true, rise);
      pet.unburrow(home);
    }
    if (signal.aborted && hits === 0) return false;
    countPlay();
    const score = moleScore(hits, oops);
    const coins = pay(moleCoins(score));
    if (score === 0) void say('play.mole.none');
    else if (coins > 0) void say('play.mole.endCoins', { n: score, coins });
    else void say('play.mole.end', { n: score });
    pet.react();
    return !signal.aborted;
  }

  // ---- 웃겨 줘 ----
  // 말장난이나 몸개그 하나: 문제(또는 예고)를 말하고 잠깐 뒤 펀치와 몸짓. 최근 것은 다시 고르지 않는다. 코인은 없다
  let jokeRecent: number[] = [];
  async function joke(run: Run): Promise<boolean> {
    const pet = o.pet();
    const signal = run.abort.signal;
    const n = pickJoke(jokeRecent, Math.random);
    jokeRecent = rememberJoke(jokeRecent, n);
    await sayFor(`fun.joke.${n}.q` as I18nKey, undefined, JOKE_PAUSE_MS, signal);
    if (signal.aborted) return false;
    pet.react(jokeMove(n));
    void say(`fun.joke.${n}.a` as I18nKey, undefined, 4000);
    return true;
  }

  // ---- 하이파이브 ----
  // 말풍선 손바닥 단추 하나. 누르면 짝(놀이 친밀도, 하루 상한 안에서), 놓치면 허공에 하이파이브. 코인은 없다
  async function highfive(run: Run): Promise<boolean> {
    const pet = o.pet();
    const signal = run.abort.signal;
    const answer = await pet.say({
      kind: 'answer',
      text: voiced('fun.five.ask'),
      buttons: [{ id: 'five', label: t('fun.five.button') }],
      ttlMs: HIGH_FIVE.waitMs,
      signal,
    });
    const result = highFiveResult(answer, signal.aborted);
    if (result === 'stop') return false;
    if (result === 'hit') {
      countPlay();
      pet.react('cheer');
      void say(`fun.five.hit.${pickLine(HIGH_FIVE.hits, Math.random)}` as I18nKey, undefined, 3000);
    } else {
      pet.react('wave');
      void say('fun.five.miss', undefined, 3000);
    }
    return true;
  }

  const PLAYS: Record<MiniGame, (run: Run) => Promise<boolean>> = {
    bubbles,
    laser,
    treats,
    rps,
    tag,
    mole,
    joke,
    highfive,
  };

  return {
    start,
    /** 그만 놀기 (펫 누르기, 우클릭 메뉴) */
    stop: () => current?.abort.abort('user'),
    /** 펫을 눌렀다: 놀이가 받으면(두더지 잡기) true. 아니면 부른 쪽이 그만 놀기로 */
    tap: (): boolean => {
      if (!current?.tap) return false;
      current.tap();
      return true;
    },
    /** 지금 하는 놀이 */
    running: (): MiniGame | undefined => current?.game,
    /** 술래잡기 할 친구 이름 (메뉴). 없으면 undefined */
    mateName: () => mate()?.name,
    /** 개발용: 놀이 창들 (그림 판 찍기) */
    debugWindows: () => [...(current?.wins ?? [])].filter((w) => !w.isDestroyed()),
    /** 개발용: 방울 하나 터뜨리기 (시험 인스턴스는 마우스를 통과시켜 누를 수 없다) */
    debugPoke: () => current?.poke?.(),
    /** 개발용: 지금 이 놀이를 못 하는 까닭 */
    debugBlock: (game: MiniGame) => blockOf(game),
  };
}
