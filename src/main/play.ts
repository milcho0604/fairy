import { BrowserWindow, screen } from 'electron';
import type { Rect } from '../shared/geometry.ts';
import { bounce, GRAVITY } from '../shared/throw.ts';
import type { PetWindow } from './pet-window.ts';

const BALL = 30;
const BALL_SVG = (yarn: boolean) =>
  yarn
    ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 30"><circle cx="15" cy="15" r="13" fill="#e87a90" stroke="#b9506a" stroke-width="2"/><path d="M5 11c7 3 14 3 20 0M4 17c7 4 15 4 22 0M10 4c4 7 4 15 0 22M19 4c-3 8-3 15 1 22" fill="none" stroke="#b9506a" stroke-width="1.6"/><path d="M26 22c3 2 3 5 1 7" fill="none" stroke="#e87a90" stroke-width="2"/></svg>`
    : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 30"><circle cx="15" cy="15" r="13" fill="#ffd166" stroke="#c99a2e" stroke-width="2"/><path d="M3 13c8 4 16 4 24 0" fill="none" stroke="#ef476f" stroke-width="3"/></svg>`;

/** 투명 작은 창 하나에 그림 하나. 마우스는 다 통과한다 */
function makeSprite(svg: string, size: number, at: { x: number; y: number }): BrowserWindow {
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
  const html = `<html><body style="margin:0;overflow:hidden;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`;
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

const HOUSE_SIZE = 120;

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
 * 펫 집 (v1 집 업그레이드): 펫이 있는 모니터 왼쪽 아래 구석에 놓인다. 마우스는 통과한다.
 * 단계가 오르면 모습이 바뀐다. 0 단계면 없다.
 */
export function createHouse() {
  let win: BrowserWindow | undefined;
  let shownLevel = 0;

  function place(near: Rect) {
    const area = screen.getDisplayMatching(near).workArea;
    return { x: area.x + 12, y: area.y + area.height - HOUSE_SIZE };
  }

  function show(level: number, near: Rect) {
    if (level <= 0) {
      win?.destroy();
      win = undefined;
      shownLevel = 0;
      return;
    }
    if (win && !win.isDestroyed() && level === shownLevel) {
      const at = place(near);
      win.setPosition(at.x, at.y);
      return;
    }
    win?.destroy();
    shownLevel = level;
    win = makeSprite(houseSvg(level), HOUSE_SIZE, place(near));
  }

  return {
    show,
    hide: () => win?.hide(),
    unhide: () => {
      if (win && !win.isDestroyed()) win.showInactive();
    },
    /** 집 문 앞 (펫이 자러 가는 곳) */
    door(): { x: number } | undefined {
      if (!win || win.isDestroyed()) return undefined;
      const b = win.getBounds();
      return { x: b.x + b.width - 20 };
    },
    destroy: () => win?.destroy(),
  };
}
