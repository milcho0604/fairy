import { app, BrowserWindow, Menu, screen } from 'electron';
import { CrashGuard } from '../shared/crash-guard.ts';
import { BALL, BALL_SVG, canPick, dropVelocity, PICK_MS } from '../shared/fetch.ts';
import type { Point, Rect } from '../shared/geometry.ts';
import {
  defaultHouseRect,
  doorStandX,
  type HouseSpot,
  houseChange,
  houseDoorSprite,
  houseHit,
  houseRepair,
  houseSize,
  parseHouseSpot,
  rectAtSpot,
  settleHouse,
  spotOf,
} from '../shared/house.ts';
import { type HouseStyle, houseLayout, houseSvg } from '../shared/house-art.ts';
import type { HouseSprites } from '../shared/house-room.ts';
import { type HouseHideReason, houseVisible } from '../shared/house-stow.ts';
import { t } from '../shared/i18n/index.ts';
import { IPC } from '../shared/ipc.ts';
import { MOVE_SPECS } from '../shared/moves.ts';
import { voiced } from '../shared/persona-voice.ts';
import { type Body, bounce, GRAVITY } from '../shared/throw.ts';
import { KEEP_APP_TYPE } from './active-space.ts';
import { onDisplaysChanged as watchDisplays } from './display-watch.ts';
import type { PetWindow } from './pet-window.ts';
import { readJson, removeJson, writeJson } from './store.ts';

/**
 * 투명 작은 창 하나에 그림 하나. 마우스는 다 통과한다 (집은 그림 위에서만 잡는다).
 * visible 이 거짓이면 다 그려도 띄우지 않는다 (숨겨 둔 집을 단계, 모양 바꾸기로 새로 만들 때)
 */
function makeSprite(
  svg: string,
  size: number,
  at: { x: number; y: number },
  css = '',
  visible: () => boolean = () => true,
): BrowserWindow {
  const win = new BrowserWindow({
    x: Math.round(at.x),
    y: Math.round(at.y),
    width: size,
    height: size,
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
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false, ...KEEP_APP_TYPE });
  // 그림(SVG)과 모양(CSS)만 있는 창이라 다른 것은 다 막는다. CSP 가 없으면 개발 실행에서 Electron 보안 경고가 창마다 뜬다.
  // 들기, 착지 모양은 메인이 executeJavaScript 로 바꾸는데 그것은 페이지 CSP 를 따르지 않아 스크립트는 열지 않는다.
  // 그림은 data: 만 (집 안의 펫 그림은 펫 화면이 그린 PNG data URL 이다)
  const csp = "default-src 'none'; style-src 'unsafe-inline'; img-src data:";
  const html = `<html><head><meta http-equiv="Content-Security-Policy" content="${csp}"><style>${css}</style></head><body style="margin:0;overflow:hidden;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`;
  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  win.once('ready-to-show', () => {
    if (visible()) win.showInactive();
  });
  return win;
}

/**
 * 공놀이 (v1): 펫 옆에서 공을 던지면 굴러가 멈추고, 펫이 쫓아가 물어 와서 제자리로 돌아온다.
 * 네 발로 걷는 펫은 고개를 숙여 공을 입에 물고 와서 내려놓고 꼬리를 흔든다 (fetchBall).
 * 공은 상점에서 산 장난감(공, 털실)이다. 끝까지 하면 true.
 */
export async function playBall(pet: PetWindow, yarn: boolean): Promise<boolean> {
  const start = pet.bounds();
  const area = screen.getDisplayMatching(start).workArea;
  const floor = area.y + area.height - BALL;
  // 펫 머리 높이에서 화면 넓은 쪽으로 던진다
  const toRight = start.x + start.width / 2 < area.x + area.width / 2;
  const thrown = {
    x: start.x + start.width / 2 - BALL / 2,
    y: start.y + 20,
    vx: (toRight ? 1 : -1) * (600 + Math.random() * 500),
    vy: -700 - Math.random() * 300,
  };
  const ball = makeSprite(BALL_SVG(yarn), BALL, thrown);
  // 공이 굴러가 멈출 때까지
  const b = await roll(ball, thrown, area, 5000);
  // 쫓아가기 (공 쪽 펫 가운데를 맞춘다)
  const p = pet.bounds();
  const reach = b.x + BALL / 2 - p.width / 2;
  const got = await pet.walkTo(reach, 150);
  if (!got || ball.isDestroyed()) {
    ball.destroy();
    return false;
  }
  const center = { x: b.x + BALL / 2, y: b.y + BALL / 2 };
  if (pet.body().quad && canPick(center, pet.bounds())) return fetchBall(pet, ball, center, start, yarn);
  // 들고 돌아온다 (두 발 펫): 공을 얼굴이 아니라 가슴 앞에 안는다 (0.55 면 입과 눈 안쪽을 가렸다)
  const carry = setInterval(() => {
    const q = pet.bounds();
    if (!ball.isDestroyed())
      ball.setPosition(
        Math.round(q.x + q.width / 2 - BALL / 2),
        Math.round(Math.min(floor, q.y + q.height * 0.68)),
      );
  }, 16);
  const back = await pet.walkTo(start.x, 110);
  clearInterval(carry);
  ball.destroy();
  return back;
}

/** 공 창을 던진 속도로 튕기며 굴린다. 바닥에 멈추거나 maxMs 가 지나면 끝 자리 */
function roll(ball: BrowserWindow, from: Body, area: Rect, maxMs: number): Promise<Body> {
  const areas = screen.getAllDisplays().map((d) => d.workArea);
  let b = from;
  return new Promise((resolve) => {
    let last = Date.now();
    const started = last;
    const timer = setInterval(() => {
      const now = Date.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const r = bounce(
        { x: b.x + b.vx * dt, y: b.y + (b.vy + GRAVITY * dt) * dt, vx: b.vx, vy: b.vy + GRAVITY * dt },
        BALL,
        BALL,
        area,
        areas,
      );
      b = r;
      if (!ball.isDestroyed()) ball.setPosition(Math.round(b.x), Math.round(b.y));
      if (r.rest || now - started > maxMs || ball.isDestroyed()) {
        clearInterval(timer);
        resolve(b);
      }
    }, 16);
  });
}

/**
 * 네 발 펫의 공 물어 오기: 공 앞에서 고개를 숙여 물고(공 창은 숨기고 펫 화면이 입에 그린다),
 * 문 채로 제자리로 걸어와 입에서 떨어뜨려 통 튀게 하고, 꼬리가 있으면 흔든다.
 * 잡히거나 숨거나 그만 놀기면 공을 치우고 false
 */
async function fetchBall(
  pet: PetWindow,
  ball: BrowserWindow,
  center: Point,
  start: Rect,
  yarn: boolean,
): Promise<boolean> {
  try {
    pet.carry(yarn ? 'yarn' : 'ball', center, BALL);
    // 펫 화면이 같은 자리에 공을 그린 뒤 공 창을 숨긴다 (사이에 공이 깜빡 사라지지 않게)
    setTimeout(() => {
      if (!ball.isDestroyed()) ball.hide();
    }, 80);
    if (!(await pet.pause(PICK_MS))) return false;
    // 걸어온 쪽으로 살짝 굴러 나가게 떨어뜨린다
    const dir = start.x < pet.bounds().x ? -1 : 1;
    if (!(await pet.walkTo(start.x, 110))) return false;
    // 멈춰 앞을 본 뒤 (펫 화면의 걷기 끝 그림이 따라오게 잠깐)
    if (!(await pet.pause(150))) return false;
    // 입에서 떨어뜨린다: 공 창을 문 자리에 다시 띄운 뒤 펫 화면의 공을 지운다
    const at = await pet.carriedAt();
    if (ball.isDestroyed()) return false;
    const q = pet.bounds();
    const drop = at ?? { x: q.x + q.width / 2, y: q.y + q.height * 0.7 };
    const from = { x: drop.x - BALL / 2, y: drop.y - BALL / 2 };
    ball.setPosition(Math.round(from.x), Math.round(from.y));
    ball.showInactive();
    await new Promise((r) => setTimeout(r, 50));
    pet.carry(null);
    const area = screen.getDisplayMatching(q).workArea;
    const wag = pet.body().tail ? MOVE_SPECS.wag.ms : 0;
    if (wag && !pet.win.isDestroyed()) pet.win.webContents.send(IPC.activity, { type: 'wag', ms: wag });
    await Promise.all([roll(ball, { ...from, ...dropVelocity(dir) }, area, 2000), pet.pause(wag)]);
    return true;
  } finally {
    pet.carry(null);
    if (!ball.isDestroyed()) ball.destroy();
  }
}

/**
 * 집 창 모양. 그림 위에서만 마우스를 받아 손 모양(grab)이 되고, 들면 살짝 기울고 작아지며,
 * 바닥에 닿으면 납작했다 튀어 오른다. 처음 놓일 때(산 날, 업그레이드)도 한 번 튄다.
 */
const HOUSE_CSS = `html,body{cursor:grab;user-select:none}
svg{display:block;transform-origin:50% 100%;transition:transform .16s ease-out}
body.lift{cursor:grabbing}
body.lift svg{transform:rotate(-5deg) scale(.94)}
body.land svg{animation:land .45s ease-out}
@keyframes land{0%{transform:scale(1.1,.86)}35%{transform:scale(.95,1.06)}65%{transform:scale(1.03,.97)}100%{transform:none}}
.rest,.letter{display:none}
body.home .rest,body.mail .letter{display:inline}
.letter,.blk,.slp,.wkg,.wk{transform-box:fill-box;transform-origin:50% 100%}
.zzz text{opacity:0}
body.z1 .zzz text:nth-child(1),body.z2 .zzz text:nth-child(-n+2),body.z3 .zzz text{opacity:1}
body.mail.b .letter{transform:translateY(-3px) rotate(-6deg)}
.leaf{transform-box:fill-box;transform-origin:0 50%;transition:transform .3s ease-in-out}
body.open .leaf{transform:scaleX(.14)}
.bars{transition:opacity .2s}
body.open .bars{opacity:0}
.walker{visibility:hidden}
body.wk-at .walker,body.wk-in .walker{visibility:visible}
.wkg{transition:transform .56s ease-in,opacity .56s ease-in,filter .56s ease-in}
body.wk-in .wkg{transform:translateY(-4%) scale(.62);opacity:0;filter:brightness(.35)}
body.wk-at .wk,body.wk-in .wk{animation:wb .14s ease-in-out 4 alternate}
@keyframes wb{to{transform:translateY(-5%)}}
body.nt .wkg,body.nt .leaf{transition:none}
.room{opacity:0;visibility:hidden;transition:opacity .5s,visibility .5s}
body.home .room{opacity:1;visibility:visible}
body.home.b .blk{transform:scaleY(1.1)}
body.home.b .slp{transform:translateY(-3%)}
@media (prefers-reduced-motion:reduce){svg,.leaf,.wkg,.room{transition:none}body.lift svg{transform:none}body.land svg,.wk{animation:none}.zzz text{opacity:1}body.b .letter,body.b .blk,body.b .slp{transform:none}}`;
/**
 * 쉬는 중 움직임은 메인이 0.7초마다 칸을 바꿔 그린다 (z 하나, 둘, 셋, 비움 / 이불이 부풀고 얼굴이 오르는 숨쉬기).
 * CSS 무한 애니메이션으로 돌리면 투명 창이 쉬지 않고 다시 그려 CPU 가 20% 가까이 늘었다 (2026-10-08 측정).
 * 문 열고 닫기, 걸어 들어가기, 방 열기는 한 번 하고 끝나는 CSS 전환이라 그때만 그린다
 */
const REST_TICK_MS = 700;

/** 옮긴 집 자리 (사용자 데이터 폴더). 집 아래 가운데 점 */
const HOUSE_FILE = 'house-position';
/** 이만큼(px) 안 움직이고 놓으면 끈 것이 아니라 누른 것 */
const HOUSE_CLICK_PX = 4;
/** 손을 놓은 신호를 놓쳐도 집이 커서에 영영 붙어 다니지 않게 */
const HOUSE_DRAG_MAX_MS = 30_000;
const FRAME_MS = 16;

export interface HouseOptions {
  /** 사용자가 집을 끌어 옮겼거나 원래 자리로 돌렸다 (펫이 보러 간다) */
  onMoved?: () => void;
  /** 집을 눌렀다 (끌지 않고). 쉬는 중이면 펫을 부른다 */
  onClick?: () => void;
  /** 우클릭 메뉴 맨 위에 붙일 집에서 쉬기 항목 (house-rest.ts) */
  restItem?: () => Electron.MenuItemConstructorOptions;
  /** 우클릭 "집 숨기기" (shared/house-stow.ts). 없으면 항목이 없다 */
  onStow?: () => void;
  log?: (tag: string, ...rest: unknown[]) => void;
}

export type House = ReturnType<typeof createHouse>;

/**
 * 펫 집 (v1 집 업그레이드, v2 집 옮기기). 처음엔 펫이 있는 모니터 왼쪽 아래 구석에 놓인다.
 * 그림 위를 끌면 옮겨지고 놓으면 그 모니터 바닥으로 떨어져 선다. 자리는 저장해 다음에 켜도 그 자리.
 * 모니터가 빠지거나 바뀌면 보이는 모니터 바닥으로 옮겨 두되, 저장한 자리는 그대로 둔다(다시 꽂으면 돌아간다).
 * 단계가 오르면 모습과 크기가 바뀌고 아래 가운데를 지킨다. 모양(나무집, 버섯집, 눈집, 성)을 바꾸면 크기는 그대로. 0 단계면 없다.
 */
export function createHouse({ onMoved, onClick, restItem, onStow, log }: HouseOptions = {}) {
  let win: BrowserWindow | undefined;
  let shownLevel = 0;
  let shownStyle: HouseStyle = 'wood';
  let spot: HouseSpot | undefined = parseHouseSpot(readJson(HOUSE_FILE));
  /** 처음 자리를 정할 펫 자리 (옮긴 적 없을 때만 쓴다) */
  let lastNear: Rect | undefined;
  /** 지금 마우스를 받는 중 (그림 위) */
  let catching = false;
  let drag:
    | { timer: NodeJS.Timeout; offset: { x: number; y: number }; from: Rect; started: number }
    | undefined;
  let glideTimer: NodeJS.Timeout | undefined;
  /** 펫이 집 안에서 쉬는 중 (불빛, Zzz), 쉬는 동안 놓치면 안 되는 말이 왔다 (편지) */
  let home = false;
  let mail = false;
  /** 들기, 착지 같은 잠깐 모양. 쉬는 중 칸을 바꿀 때도 지킨다 */
  let transient = '';
  /** 문이 열렸다, 문간 펫 그림(at 문 앞, in 문 안으로 들어갔다), 전환 없이 바로(nt) */
  let open = false;
  let walker: 'none' | 'at' | 'in' = 'none';
  let instant = false;
  /** 펫 화면이 그린 집 안 그림. 집 창을 새로 만들면(단계, 모양 바꾸기) 다시 넣는다 */
  let sprites: HouseSprites | undefined;
  let restTick = 0;
  let restTimer: NodeJS.Timeout | undefined;
  /** 집 창을 감춘 까닭 (사용자가 숨김, 펫과 같이 숨음). 하나라도 있으면 감춘다 */
  const hiddenBy = new Set<HouseHideReason>();
  const visible = () => houseVisible(hiddenBy);
  /** 사용자가 숨겨 두었다: 집이 없는 것처럼 자리를 알려 주지 않는다 (쉬기, 보러 가기, 집 앞에서 졸기를 안 한다) */
  const stowed = () => hiddenBy.has('stowed');

  const alive = () => !!win && !win.isDestroyed();
  /** 그림 화면(렌더러)이 죽으면 창은 남고 그림만 사라진다. 빈 창은 없는 집과 같다 */
  const crashed = () => alive() && !!win?.webContents.isCrashed();
  /** 마지막으로 보이라고 한 단계와 모양. 처음 show 전에는 살리지 않는다 (펫 화면을 다 불러온 뒤에 나온다) */
  let wanted: { level: number; style: HouseStyle } | undefined;
  /** 끄는 중에는 닫힌 창을 다시 만들지 않는다 */
  let quitting = false;
  app.once('before-quit', () => {
    quitting = true;
  });
  /** 그림 화면이 1분에 네 번 넘게 죽으면 원인이 그대로라 보고 다시 만들지 않는다 (펫 화면과 같은 규칙) */
  const crashes = new CrashGuard();
  const areas = () => screen.getAllDisplays().map((d) => d.workArea);

  /** 이 단계 집이 설 자리 */
  function target(size: number): Rect {
    if (spot) return settleHouse(rectAtSpot(spot, size), areas());
    const area = lastNear
      ? screen.getDisplayMatching(lastNear).workArea
      : screen.getPrimaryDisplay().workArea;
    return defaultHouseRect(area, size);
  }

  /** 들기, 착지 같은 잠깐 모양(name)에 쉬는 중, 편지 표시를 늘 같이 붙인다 */
  function setClass(name: string) {
    transient = name;
    const step = restTick % 4;
    const names = [
      name,
      home ? 'home' : '',
      mail ? 'mail' : '',
      home && step < 3 ? `z${step + 1}` : '',
      (home || mail) && step % 2 === 1 ? 'b' : '',
      open ? 'open' : '',
      walker === 'none' ? '' : `wk-${walker}`,
      instant ? 'nt' : '',
    ]
      .filter(Boolean)
      .join(' ');
    if (alive())
      void win?.webContents.executeJavaScript(`document.body.className=${JSON.stringify(names)}`, true);
  }

  /** 집 안 그림을 그림에 넣는다 (문간 깬 몸, 침대 자는 얼굴) */
  function applySprites() {
    if (!alive() || !sprites) return;
    const js = `(() => { const s = ${JSON.stringify({ wk: sprites.awake, slp: sprites.sleep })};
      for (const k of Object.keys(s)) for (const el of document.querySelectorAll('image.' + k)) el.setAttribute('href', s[k]); })()`;
    void win?.webContents.executeJavaScript(js, true);
  }

  function land() {
    setClass('');
    // 같은 이름을 다시 붙여도 애니메이션이 다시 돌게 한 틀 비운다
    setTimeout(() => setClass('land'), 20);
  }

  function catchMouse(on: boolean) {
    if (on === catching || !alive()) return;
    catching = on;
    win?.setIgnoreMouseEvents(!on, { forward: true });
  }

  function stopGlide() {
    clearInterval(glideTimer);
    glideTimer = undefined;
  }

  /**
   * 지금 자리에서 to 까지 옮긴다. 떨어질 때는 중력처럼 점점 빨라지고(가로는 같이 미끄러진다),
   * hop 이면 폴짝 뛰어 넘어간다(원래 자리로). 닿으면 납작 튄다.
   */
  function glide(to: Rect, hop = false, done?: () => void) {
    stopGlide();
    if (!alive() || !win) return;
    const from = win.getBounds();
    const h = to.y - from.y;
    const dist = Math.hypot(to.x - from.x, h);
    if (dist < 1) {
      win.setBounds(to);
      done?.();
      return;
    }
    // 떨어지는 시간은 실제 낙하 시간(√(2h/g)), 너무 짧거나 길지 않게
    const ms = hop
      ? Math.min(700, 280 + dist * 0.25)
      : h > 0
        ? Math.min(600, Math.max(140, Math.sqrt((2 * h) / GRAVITY) * 1000))
        : 150;
    const started = Date.now();
    glideTimer = setInterval(() => {
      if (!alive() || !win) return stopGlide();
      const u = Math.min(1, (Date.now() - started) / ms);
      // 떨어질 땐 가속(u²), 바닥 아래서 올라올 땐 감속, 폴짝은 고르게 + 포물선
      const ey = hop ? u : h > 0 ? u * u : 1 - (1 - u) * (1 - u);
      const ex = hop ? u : 1 - (1 - u) * (1 - u);
      const arc = hop ? -Math.min(90, 30 + dist * 0.12) * 4 * u * (1 - u) : 0;
      win.setBounds({
        x: Math.round(from.x + (to.x - from.x) * ex),
        y: Math.round(from.y + h * ey + arc),
        width: to.width,
        height: to.height,
      });
      if (u >= 1) {
        stopGlide();
        win.setBounds(to);
        land();
        done?.();
      }
    }, FRAME_MS);
  }

  function startDrag() {
    if (!alive() || !win || drag) return;
    stopGlide();
    const b = win.getBounds();
    const cursor = screen.getCursorScreenPoint();
    const offset = { x: cursor.x - b.x, y: cursor.y - b.y };
    setClass('lift');
    const timer = setInterval(() => {
      if (!alive() || !win || !drag) return;
      if (Date.now() - drag.started > HOUSE_DRAG_MAX_MS) return endDrag();
      const c = screen.getCursorScreenPoint();
      win.setPosition(Math.round(c.x - offset.x), Math.round(c.y - offset.y));
    }, FRAME_MS);
    drag = { timer, offset, from: b, started: Date.now() };
  }

  function endDrag() {
    if (!drag) return;
    clearInterval(drag.timer);
    const { from } = drag;
    drag = undefined;
    if (!alive() || !win) return;
    const now = win.getBounds();
    // 거의 안 움직였으면 누른 것: 제자리에서 꿈틀만
    if (Math.hypot(now.x - from.x, now.y - from.y) < HOUSE_CLICK_PX) {
      win.setBounds(from);
      land();
      onClick?.();
      return;
    }
    const to = settleHouse(now, areas());
    spot = spotOf(to);
    try {
      writeJson(HOUSE_FILE, spot);
    } catch (e) {
      log?.('house', '자리 저장 실패', String(e));
    }
    glide(to, false, () => onMoved?.());
  }

  /** 우클릭: 끌어 옮길 수 있다는 안내와 원래 자리로 */
  function menu() {
    if (!alive() || !win) return;
    Menu.buildFromTemplate([
      ...(restItem ? [restItem(), { type: 'separator' as const }] : []),
      { label: t('pet.house.dragHint'), enabled: false },
      { type: 'separator' },
      { label: t('pet.house.reset'), enabled: !!spot, click: () => reset() },
      ...(onStow
        ? [{ type: 'separator' as const }, { label: t('pet.menu.houseHide'), click: () => onStow() }]
        : []),
    ]).popup({ window: win });
  }

  function reset() {
    spot = undefined;
    try {
      removeJson(HOUSE_FILE);
    } catch (e) {
      log?.('house', '자리 지우기 실패', String(e));
    }
    if (alive()) glide(target(houseSize(shownLevel)), true, () => onMoved?.());
  }

  function wire(w: BrowserWindow) {
    w.setIgnoreMouseEvents(true, { forward: true });
    catching = false;
    // 미리 불러 둔 그림 페이지에는 스크립트가 없다. 마우스는 메인이 받아 판정한다:
    // 비켜 있을 땐 움직임만 넘겨받고(forward), 그림 위면 잡는다. 투명한 곳은 아래 앱이 받는다.
    w.webContents.on('before-mouse-event', (_e, m) => {
      if (drag) {
        if (m.type === 'mouseUp' && m.button !== 'right') endDrag();
        return;
      }
      if (m.type === 'mouseLeave') return catchMouse(false);
      const size = w.getBounds().width;
      const over = houseHit(shownStyle, shownLevel, size, { x: m.x, y: m.y });
      if (m.type === 'mouseMove' || m.type === 'mouseEnter') catchMouse(over);
      else if (m.type === 'mouseDown' && m.button === 'left' && over) startDrag();
    });
    w.webContents.on('context-menu', () => menu());
    // 잠자기나 메모리 부족으로 그림 화면이 죽으면 창은 그대로라 집이 영영 안 보였다 (#74): 새로 만든다
    w.webContents.on('render-process-gone', (_e, d) => {
      if (w !== win || d.reason === 'clean-exit' || quitting) return;
      const next = crashes.crashed(Date.now());
      log?.('house', 'render-process-gone', d.reason, d.exitCode, next);
      if (next === 'reload') heal();
    });
    let loaded = false;
    w.webContents.on('did-finish-load', () => {
      if (w !== win) return;
      applySprites();
      if (loaded) {
        setClass(transient);
        heal();
      } else land();
      loaded = true;
    });
  }

  // 모니터가 빠지거나 해상도, 독 자리가 바뀌면 보이는 바닥으로 다시 놓는다 (저장한 자리는 그대로)
  const replace = () => {
    if (!alive() || drag || glideTimer || !win) return;
    win.setBounds(target(houseSize(shownLevel)));
    // 모니터를 다시 꽂는 사이 맥이 창을 내려 두기도 한다
    heal();
  };
  // 값이 실제로 바뀐 때만 온다 (맥이 변화 없이 몰아 보내는 알림은 display-watch.ts 가 거른다)
  const stopDisplayWatch = watchDisplays(replace);

  /** 단계와 모양에 맞는 집을 보인다. 같은 모습이면 자리만 맞춘다 */
  function show({ level, style }: { level: number; style: HouseStyle }, near: Rect) {
    lastNear = near;
    wanted = { level, style };
    // 그림이 죽은 창은 같은 모습이어도 새로 만든다 (자리만 맞추면 빈 창이 남는다)
    const plan = houseChange(
      { alive: alive() && !crashed(), level: shownLevel, style: shownStyle },
      { level, style },
    );
    if (plan === 'remove') {
      drop();
      shownLevel = 0;
      return;
    }
    if (plan === 'place') {
      if (!drag && !glideTimer) win?.setBounds(target(houseSize(level)));
      return;
    }
    endDrag();
    stopGlide();
    drop();
    shownLevel = level;
    shownStyle = style;
    const size = houseSize(level);
    win = makeSprite(houseSvg(style, level), size, target(size), HOUSE_CSS, visible);
    wire(win);
  }

  /** 지금 창을 없앤다. 먼저 놓아야 닫힘 알림이 이 창을 지금 집으로 보지 않는다 */
  function drop() {
    const old = win;
    win = undefined;
    old?.destroy();
  }

  /**
   * 집이 있어야 하는데 안 보이면 살린다 (#74). 재부팅, 잠자기, 모니터 바꾸기 뒤에 창이 닫히거나, 그림이 죽거나,
   * 내려가 있거나, 화면 밖에 남으면 다시 볼 길이 상점에서 집을 바꾸는 것뿐이었다. 단계와 모양은 마지막 show 그대로.
   * 메인이 2초마다, 모니터가 바뀔 때, 그림이 죽었을 때 부른다. 앱을 끄는 중이면 그만두고, 끌거나 미끄러지는 중이면 다음 차례로 미룬다
   */
  function heal() {
    if (!wanted || quitting || drag || glideTimer) return;
    const plan = houseRepair(
      {
        level: wanted.level,
        alive: alive(),
        crashed: crashed(),
        wantVisible: visible(),
        isVisible: alive() && !!win?.isVisible(),
        bounds: alive() ? win?.getBounds() : undefined,
      },
      areas(),
    );
    if (plan === 'none') return;
    if (plan === 'rebuild' && crashed() && crashes.stopped) return;
    log?.('house', 'repair', plan);
    if (plan === 'rebuild') {
      drop();
      show(wanted, lastNear ?? screen.getPrimaryDisplay().workArea);
      return;
    }
    if (!win) return;
    win.setBounds(target(houseSize(shownLevel)));
    if (plan === 'show') win.showInactive();
  }

  /**
   * 감출 까닭이 바뀌었다. 감출 때는 끌기와 미끄러지기를 끝내고 마우스를 놓는다(끌던 자리는 저장된다).
   * 다시 보일 때는 저장한 자리(그새 모니터가 바뀌었으면 보이는 바닥)에 지금 단계 크기로 둔다
   */
  function setHiddenBy(reason: HouseHideReason, on: boolean) {
    if (on === hiddenBy.has(reason)) return;
    if (on) hiddenBy.add(reason);
    else hiddenBy.delete(reason);
    if (!alive() || !win) return;
    if (!visible()) {
      endDrag();
      stopGlide();
      catchMouse(false);
      win.hide();
      return;
    }
    win.setBounds(target(houseSize(shownLevel)));
    win.showInactive();
  }

  return {
    show,
    heal,
    /** Dock 전환 뒤 집도 모든 데스크톱/항상 위 설정을 다시 건다. 숨김 이유는 유지한다. */
    reassertSpaces() {
      if (!alive() || !win) return;
      win.setAlwaysOnTop(true, 'floating');
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false, ...KEEP_APP_TYPE });
      heal();
    },
    /** 펫과 같이 숨는다 (발표, 펫 숨기기) */
    hide: () => setHiddenBy('pet', true),
    unhide: () => setHiddenBy('pet', false),
    /** 사용자가 집을 숨겨 둔다, 다시 보인다 (설정 houseHidden). 창, 단계, 모양, 자리는 그대로 */
    stow: (on: boolean) => setHiddenBy('stowed', on),
    stowed,
    /** 지금 화면에 보이는지 (창이 있고 감출 까닭이 없다) */
    visible: () => alive() && visible() && !!win?.isVisible(),
    /** 집 창 자리 (없거나 숨겨 두었으면 undefined) */
    bounds: (): Rect | undefined => (alive() && !stowed() ? win?.getBounds() : undefined),
    /** 펫이 자러 가거나 보러 갈 때 설 자리 (펫 가운데 x). petWidth 로 화면 밖으로 나가지 않게 고른다 */
    door(petWidth = 160): { x: number } | undefined {
      if (!alive() || !win || stowed()) return undefined;
      const b = win.getBounds();
      return { x: doorStandX(b, screen.getDisplayMatching(b).workArea, petWidth) };
    },
    /** 지금 집 그림(120 칸)의 문 가운데 x 와 문턱 y */
    doorArt: () => houseLayout(shownStyle, shownLevel).door,
    /** 문간 펫 그림 자리 (화면 좌표). 집이 없으면 undefined */
    doorSprite(): Rect | undefined {
      if (!alive() || !win || stowed()) return undefined;
      return houseDoorSprite(win.getBounds(), shownStyle, shownLevel);
    },
    /** 펫 화면이 그린 집 안 그림을 넣는다 */
    setSprites(next: HouseSprites | undefined) {
      if (!next || next === sprites) return;
      sprites = next;
      applySprites();
    },
    /** 문을 연다, 닫는다 (전환 0.3초) */
    setDoor(on: boolean) {
      if (open === on) return;
      open = on;
      setClass(transient);
    },
    /**
     * 문간 펫 그림. at 은 문 앞에 선 모습, in 은 문 안 어둠 속(작고 어둡게 사라짐). 둘 사이는 0.56초 전환.
     * now 면 전환 없이 바로 (나올 때 문 안에서 시작하려고)
     */
    setWalker(state: 'none' | 'at' | 'in', now = false) {
      walker = state;
      instant = now;
      setClass(transient);
      if (now) {
        // 다음 칸부터는 다시 전환한다
        instant = false;
        setTimeout(() => setClass(transient), 34);
      }
    },
    /** 우클릭 "집 원래 자리로" 와 같다 */
    reset,
    /** 펫이 집 안에서 쉬는 중 표시 (불빛, Zzz). 끄면 편지 표시도 지운다 */
    setResting(on: boolean) {
      if (home === on) return;
      home = on;
      if (!on) mail = false;
      clearInterval(restTimer);
      restTimer = undefined;
      restTick = 0;
      if (on)
        restTimer = setInterval(() => {
          restTick++;
          setClass(transient);
        }, REST_TICK_MS);
      setClass('');
    },
    /** 쉬는 동안 놓치면 안 되는 말이 왔다 (편지) */
    setMail(on: boolean) {
      if (mail === on) return;
      mail = on;
      setClass('');
    },
    destroy: () => {
      endDrag();
      stopGlide();
      clearInterval(restTimer);
      stopDisplayWatch();
      wanted = undefined;
      drop();
    },
  };
}

/**
 * 집을 옮겼다: 펫이 한가하면 새 집에 가 본다. 같은 모니터 바닥에 서 있으면 문간까지 걸어가고,
 * 아니면(창 위, 다른 모니터) 그 자리에서 좋아하기만 한다.
 */
export async function visitHouse(pet: PetWindow, house: House): Promise<void> {
  const hb = house.bounds();
  if (!hb || pet.isHidden() || !pet.isIdle()) return;
  const p = pet.bounds();
  const homeDisplay = screen.getDisplayMatching(hb);
  const floor = homeDisplay.workArea.y + homeDisplay.workArea.height;
  const onFloor = screen.getDisplayMatching(p).id === homeDisplay.id && Math.abs(p.y + p.height - floor) <= 8;
  const door = house.door(p.width);
  if (onFloor && door && !(await pet.walkTo(door.x - p.width / 2, 200))) return;
  pet.react('happy');
  void pet.say({ kind: 'answer', text: voiced('pet.houseMoved'), ttlMs: 3000 });
}
