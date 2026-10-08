import { type BrowserWindow, screen } from 'electron';
import { fitSavedBounds } from '../shared/geometry.ts';
import { readJson, writeJson } from './store.ts';

// 창 크기와 자리 기억 (채팅, 설정, 펫 만들기). 닫거나 크기, 자리를 바꿀 때 window-bounds.json 에 창별로 적고,
// 다시 열 때 지금 화면에 맞춰 쓴다 (모니터를 뺐으면 남은 화면 안으로). 패널은 펫 기준 거리로 따로 기억한다(panel-place.ts)

const FILE = 'window-bounds';

export type WindowKey = 'chat' | 'settings' | 'maker';

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

/**
 * 창이 바뀔 때마다 기억한다. 크기는 늘, 자리는 사용자가 옮겼거나(moved) 전에 옮겨 둔 자리로 연 창만
 * (채팅 창을 옮긴 적 없으면 계속 펫 옆에 열리게). 최대화, 전체 화면은 그 전 크기를 적는다
 */
export function rememberBounds(win: BrowserWindow, key: WindowKey, placed: boolean): void {
  let keepPlace = placed;
  const save = () => {
    if (win.isDestroyed()) return;
    const b = win.getNormalBounds();
    const next: Saved = { width: b.width, height: b.height, ...(keepPlace ? { x: b.x, y: b.y } : {}) };
    try {
      writeJson(FILE, { ...all(), [key]: next });
    } catch {
      // 못 적으면 다음에 처음 모습으로 연다. 창은 그대로 쓴다
    }
  };
  win.on('moved', () => {
    keepPlace = true;
    save();
  });
  win.on('resized', save);
  win.on('close', save);
}
