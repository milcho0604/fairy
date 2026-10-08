import { BrowserWindow, Menu, screen } from 'electron';
import type { Rect } from '../shared/geometry.ts';
import {
  defaultHouseRect,
  doorStandX,
  type HouseSpot,
  houseHit,
  houseSize,
  parseHouseSpot,
  rectAtSpot,
  settleHouse,
  spotOf,
} from '../shared/house.ts';
import { t } from '../shared/i18n/index.ts';
import { bounce, GRAVITY } from '../shared/throw.ts';
import type { PetWindow } from './pet-window.ts';
import { readJson, removeJson, writeJson } from './store.ts';

const BALL = 30;
const BALL_SVG = (yarn: boolean) =>
  yarn
    ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 30"><circle cx="15" cy="15" r="13" fill="#e87a90" stroke="#b9506a" stroke-width="2"/><path d="M5 11c7 3 14 3 20 0M4 17c7 4 15 4 22 0M10 4c4 7 4 15 0 22M19 4c-3 8-3 15 1 22" fill="none" stroke="#b9506a" stroke-width="1.6"/><path d="M26 22c3 2 3 5 1 7" fill="none" stroke="#e87a90" stroke-width="2"/></svg>`
    : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 30"><circle cx="15" cy="15" r="13" fill="#ffd166" stroke="#c99a2e" stroke-width="2"/><path d="M3 13c8 4 16 4 24 0" fill="none" stroke="#ef476f" stroke-width="3"/></svg>`;

/** 투명 작은 창 하나에 그림 하나. 마우스는 다 통과한다 (집은 그림 위에서만 잡는다) */
function makeSprite(svg: string, size: number, at: { x: number; y: number }, css = ''): BrowserWindow {
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
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
  // 그림(SVG)과 모양(CSS)만 있는 창이라 다른 것은 다 막는다. CSP 가 없으면 개발 실행에서 Electron 보안 경고가 창마다 뜬다.
  // 들기, 착지 모양은 메인이 executeJavaScript 로 바꾸는데 그것은 페이지 CSP 를 따르지 않아 스크립트는 열지 않는다
  const csp = "default-src 'none'; style-src 'unsafe-inline'";
  const html = `<html><head><meta http-equiv="Content-Security-Policy" content="${csp}"><style>${css}</style></head><body style="margin:0;overflow:hidden;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`;
  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  win.once('ready-to-show', () => win.showInactive());
  return win;
}

/**
 * 공놀이 (v1): 펫 옆에서 공을 던지면 굴러가 멈추고, 펫이 쫓아가 물어 와서 제자리로 돌아온다.
 * 공은 상점에서 산 장난감(공, 털실)이다. 끝까지 하면 true.
 */
export async function playBall(pet: PetWindow, yarn: boolean): Promise<boolean> {
  const start = pet.bounds();
  const area = screen.getDisplayMatching(start).workArea;
  const floor = area.y + area.height - BALL;
  // 펫 머리 높이에서 화면 넓은 쪽으로 던진다
  const toRight = start.x + start.width / 2 < area.x + area.width / 2;
  let b = {
    x: start.x + start.width / 2 - BALL / 2,
    y: start.y + 20,
    vx: (toRight ? 1 : -1) * (600 + Math.random() * 500),
    vy: -700 - Math.random() * 300,
  };
  const ball = makeSprite(BALL_SVG(yarn), BALL, b);
  const areas = screen.getAllDisplays().map((d) => d.workArea);
  // 공이 굴러가 멈출 때까지
  await new Promise<void>((resolve) => {
    let last = Date.now();
    const started = last;
    const timer = setInterval(() => {
      const now = Date.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      b.vy += GRAVITY * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      const r = bounce(b, BALL, BALL, area, areas);
      b = r;
      if (!ball.isDestroyed()) ball.setPosition(Math.round(b.x), Math.round(b.y));
      if (r.rest || now - started > 5000) {
        clearInterval(timer);
        resolve();
      }
    }, 16);
  });
  // 쫓아가기 (공 쪽 펫 가운데를 맞춘다)
  const p = pet.bounds();
  const reach = b.x + BALL / 2 - p.width / 2;
  const got = await pet.walkTo(reach, 150);
  if (!got || ball.isDestroyed()) {
    ball.destroy();
    return false;
  }
  // 물고 돌아온다: 공이 펫 입 앞에 붙어 다닌다
  const carry = setInterval(() => {
    const q = pet.bounds();
    if (!ball.isDestroyed())
      ball.setPosition(
        Math.round(q.x + q.width / 2 - BALL / 2),
        Math.round(Math.min(floor, q.y + q.height * 0.55)),
      );
  }, 16);
  const back = await pet.walkTo(start.x, 110);
  clearInterval(carry);
  ball.destroy();
  return back;
}

function houseSvg(level: number): string {
  const roof = ['#c4854a', '#d9603b', '#4f7cac'][level - 1] ?? '#c4854a';
  const wall = ['#fff4e6', '#ffe8cc', '#f1f5fb'][level - 1] ?? '#fff4e6';
  const window =
    level >= 2
      ? '<rect x="70" y="62" width="18" height="16" rx="2" fill="#bfe3ff" stroke="#8a6a4a" stroke-width="2"/>'
      : '';
  const yard =
    level >= 3
      ? '<path d="M2 116h116" stroke="#6bbf59" stroke-width="6" stroke-linecap="round"/><circle cx="104" cy="104" r="7" fill="#6bbf59"/><circle cx="14" cy="106" r="5" fill="#ff8fab"/>'
      : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">${yard}<rect x="22" y="52" width="76" height="58" rx="4" fill="${wall}" stroke="#8a6a4a" stroke-width="2.5"/><path d="M12 56 60 18 108 56Z" fill="${roof}" stroke="#8a6a4a" stroke-width="2.5" stroke-linejoin="round"/><path d="M40 110V80a12 12 0 0 1 24 0v30" fill="#8a6a4a"/>${window}</svg>`;
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
@media (prefers-reduced-motion:reduce){svg{transition:none}body.lift svg{transform:none}body.land svg{animation:none}}`;

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
  log?: (tag: string, ...rest: unknown[]) => void;
}

export type House = ReturnType<typeof createHouse>;

/**
 * 펫 집 (v1 집 업그레이드, v2 집 옮기기). 처음엔 펫이 있는 모니터 왼쪽 아래 구석에 놓인다.
 * 그림 위를 끌면 옮겨지고 놓으면 그 모니터 바닥으로 떨어져 선다. 자리는 저장해 다음에 켜도 그 자리.
 * 모니터가 빠지거나 바뀌면 보이는 모니터 바닥으로 옮겨 두되, 저장한 자리는 그대로 둔다(다시 꽂으면 돌아간다).
 * 단계가 오르면 모습과 크기가 바뀌고 아래 가운데를 지킨다. 0 단계면 없다.
 */
export function createHouse({ onMoved, log }: HouseOptions = {}) {
  let win: BrowserWindow | undefined;
  let shownLevel = 0;
  let spot: HouseSpot | undefined = parseHouseSpot(readJson(HOUSE_FILE));
  /** 처음 자리를 정할 펫 자리 (옮긴 적 없을 때만 쓴다) */
  let lastNear: Rect | undefined;
  /** 지금 마우스를 받는 중 (그림 위) */
  let catching = false;
  let drag:
    | { timer: NodeJS.Timeout; offset: { x: number; y: number }; from: Rect; started: number }
    | undefined;
  let glideTimer: NodeJS.Timeout | undefined;

  const alive = () => !!win && !win.isDestroyed();
  const areas = () => screen.getAllDisplays().map((d) => d.workArea);

  /** 이 단계 집이 설 자리 */
  function target(size: number): Rect {
    if (spot) return settleHouse(rectAtSpot(spot, size), areas());
    const area = lastNear
      ? screen.getDisplayMatching(lastNear).workArea
      : screen.getPrimaryDisplay().workArea;
    return defaultHouseRect(area, size);
  }

  function setClass(name: string) {
    if (alive())
      void win?.webContents.executeJavaScript(`document.body.className=${JSON.stringify(name)}`, true);
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
      { label: t('pet.house.dragHint'), enabled: false },
      { type: 'separator' },
      { label: t('pet.house.reset'), enabled: !!spot, click: () => reset() },
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
      const over = houseHit(shownLevel, size, { x: m.x, y: m.y });
      if (m.type === 'mouseMove' || m.type === 'mouseEnter') catchMouse(over);
      else if (m.type === 'mouseDown' && m.button === 'left' && over) startDrag();
    });
    w.webContents.on('context-menu', () => menu());
    w.webContents.once('did-finish-load', () => land());
  }

  // 모니터가 빠지거나 해상도, 독 자리가 바뀌면 보이는 바닥으로 다시 놓는다 (저장한 자리는 그대로)
  const replace = () => {
    if (!alive() || drag || glideTimer || !win) return;
    win.setBounds(target(houseSize(shownLevel)));
  };
  screen.on('display-removed', replace);
  screen.on('display-added', replace);
  screen.on('display-metrics-changed', replace);

  function show(level: number, near: Rect) {
    lastNear = near;
    if (level <= 0) {
      win?.destroy();
      win = undefined;
      shownLevel = 0;
      return;
    }
    if (alive() && level === shownLevel) {
      if (!drag && !glideTimer) win?.setBounds(target(houseSize(level)));
      return;
    }
    endDrag();
    stopGlide();
    win?.destroy();
    shownLevel = level;
    const size = houseSize(level);
    win = makeSprite(houseSvg(level), size, target(size), HOUSE_CSS);
    wire(win);
  }

  return {
    show,
    hide: () => {
      endDrag();
      win?.hide();
    },
    unhide: () => {
      if (alive()) win?.showInactive();
    },
    /** 집 창 자리 (없으면 undefined) */
    bounds: (): Rect | undefined => (alive() ? win?.getBounds() : undefined),
    /** 펫이 자러 가거나 보러 갈 때 설 자리 (펫 가운데 x). petWidth 로 화면 밖으로 나가지 않게 고른다 */
    door(petWidth = 160): { x: number } | undefined {
      if (!alive() || !win) return undefined;
      const b = win.getBounds();
      return { x: doorStandX(b, screen.getDisplayMatching(b).workArea, petWidth) };
    },
    /** 우클릭 "집 원래 자리로" 와 같다 */
    reset,
    destroy: () => {
      endDrag();
      stopGlide();
      screen.off('display-removed', replace);
      screen.off('display-added', replace);
      screen.off('display-metrics-changed', replace);
      win?.destroy();
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
  void pet.say({ kind: 'answer', text: t('pet.houseMoved'), ttlMs: 3000 });
}
