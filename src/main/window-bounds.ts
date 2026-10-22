import {
  BaseWindow,
  type BaseWindowConstructorOptions,
  BrowserWindow,
  type BrowserWindowConstructorOptions,
  type Rectangle,
  screen,
} from 'electron';
import { fitSavedBounds } from '../shared/geometry.ts';
import { readJson, writeJson } from './store.ts';

// 창 크기와 자리 기억 (채팅, 설정, 펫 만들기, 알아보기, 패널). 닫거나 크기, 자리를 바꿀 때 window-bounds.json 에 창별로 적고,
// 다시 열 때 지금 화면에 맞춰 쓴다 (모니터를 뺐으면 남은 화면 안으로). 패널은 크기만 여기에 적고 자리는 펫 기준 거리로
// 따로 기억한다(panel-place.ts)

const FILE = 'window-bounds';

export type WindowKey = 'chat' | 'settings' | 'maker' | 'knows' | 'panel' | 'home';

interface Saved {
  width: number;
  height: number;
  /** 사용자가 옮긴 적이 있을 때만. 없으면 창마다 처음 자리(채팅은 펫 옆, 나머지는 화면 가운데) */
  x?: number;
  y?: number;
}

function all(): Partial<Record<WindowKey, Saved>> {
  const raw = readJson(FILE);
  return typeof raw === 'object' && raw !== null ? (raw as Partial<Record<WindowKey, Saved>>) : {};
}

/** 저장해 둔 모습을 지금 화면에 맞춰서. 없거나 틀리면 undefined */
export function savedBounds(key: WindowKey, min: { width: number; height: number }) {
  return fitSavedBounds(
    all()[key],
    screen.getAllDisplays().map((d) => d.workArea),
    min,
  );
}

/** 지금 창 모습을 적는다. withPlace 가 아니면 크기만 (패널처럼 자리를 따로 기억하는 창) */
export function saveBounds(win: BaseWindow, key: WindowKey, withPlace: boolean): void {
  if (win.isDestroyed()) return;
  const b = win.getNormalBounds();
  const next: Saved = { width: b.width, height: b.height, ...(withPlace ? { x: b.x, y: b.y } : {}) };
  try {
    writeJson(FILE, { ...all(), [key]: next });
  } catch {
    // 못 적으면 다음에 처음 모습으로 연다. 창은 그대로 쓴다
  }
}

/**
 * 창이 바뀔 때마다 기억한다. 크기는 늘, 자리는 사용자가 옮겼거나(moved) 전에 옮겨 둔 자리로 연 창만
 * (채팅 창을 옮긴 적 없으면 계속 펫 옆에 열리게). 최대화, 전체 화면은 그 전 크기를 적는다
 */
export function rememberBounds(win: BaseWindow, key: WindowKey, placed: boolean): void {
  let keepPlace = placed;
  const save = () => saveBounds(win, key, keepPlace);
  win.on('moved', () => {
    keepPlace = true;
    save();
  });
  win.on('resized', save);
  win.on('close', save);
}

export interface RememberedWindow<O = BrowserWindowConstructorOptions> {
  /** 처음 크기 (적어 둔 크기가 없을 때) */
  size: { width: number; height: number };
  /** 이보다 작게는 못 줄인다 */
  min: { width: number; height: number };
  /**
   * 자리를 정하는 함수. 주면 사용자가 옮긴 적이 있을 때만 자리를 기억하고, 아니면 이 자리에 연다 (채팅은 펫 옆).
   * 안 주면 늘 자리를 기억하고, 적어 둔 자리가 없으면 화면 가운데
   */
  place?: (size: { width: number; height: number }) => Rectangle;
  /** 창 나머지 옵션 (제목, show, webPreferences 등) */
  options: O;
}

/** 적어 둔 모습을 지금 화면에 맞춰 창이 설 자리와 자리를 기억할지를 정한다 */
function resolve<O>(key: WindowKey, o: RememberedWindow<O>) {
  const saved = savedBounds(key, o.min);
  const size = saved ? { width: saved.width, height: saved.height } : o.size;
  const placed = saved?.x !== undefined && saved.y !== undefined;
  const where = placed ? saved : o.place ? o.place(size) : size;
  return { where, remember: o.place ? placed : true };
}

/**
 * 크기와 자리를 기억하는 창을 연다: 적어 둔 모습을 지금 화면에 맞추고(savedBounds), 창 옵션을 조립하고,
 * 바뀔 때마다 적도록 잇는다(rememberBounds). 채팅, 설정, 펫 만들기, 알아보기 창이 같은 길로 연다.
 */
export function openRemembered(key: WindowKey, o: RememberedWindow): BrowserWindow {
  const { where, remember } = resolve(key, o);
  const win = new BrowserWindow({
    ...where,
    minWidth: o.min.width,
    minHeight: o.min.height,
    ...o.options,
  });
  rememberBounds(win, key, remember);
  return win;
}

/** openRemembered 와 같되 화면을 직접 갖지 않는 창(BaseWindow). 큰 창이 본문과 채팅을 view 로 싣는다 */
export function openRememberedBase(
  key: WindowKey,
  o: RememberedWindow<BaseWindowConstructorOptions>,
): BaseWindow {
  const { where, remember } = resolve(key, o);
  const win = new BaseWindow({
    ...where,
    minWidth: o.min.width,
    minHeight: o.min.height,
    ...o.options,
  });
  rememberBounds(win, key, remember);
  return win;
}
