import { join } from 'node:path';
import {
  BrowserWindow,
  type Display,
  desktopCapturer,
  dialog,
  type IpcMainEvent,
  ipcMain,
  type NativeImage,
  screen,
  shell,
  systemPreferences,
} from 'electron';
import {
  fitWithin,
  IMAGE_JPEG_QUALITY,
  IMAGE_MAX_SIDE,
  IMAGE_THUMB_SIDE,
  isClick,
  needsJpeg,
  THUMB_JPEG_QUALITY,
  toPixels,
} from '../shared/capture.ts';
import type { Rect } from '../shared/geometry.ts';
import { t } from '../shared/i18n/index.ts';
import { LOOK, type OutgoingImage } from '../shared/ipc.ts';
import { focusWindow, showWindow } from './focus.ts';
import { langArg } from './lang.ts';

/** 오버레이와 펫이 화면에서 사라질 때까지 기다리는 시간. 짧으면 반투명한 오버레이가 같이 찍힌다. */
const HIDE_SETTLE_MS = 150;
const MAC_SCREEN_SETTINGS = 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture';

export interface LookOptions {
  petName: () => string;
  /** 찍는 동안 펫과 채팅 창을 숨기고, 끝나면 다시 보인다. */
  hideOwnWindows: () => () => void;
  /** 찍은 그림을 채팅 입력칸에 붙인다. 보내지는 않는다. */
  onImage: (image: OutgoingImage) => void;
  log: (tag: string, ...rest: unknown[]) => void;
}

/**
 * "(이름)랑 같이 보기". 모니터마다 반투명 오버레이를 띄워 영역을 고르게 하고,
 * 오버레이를 치운 뒤 그 순간 화면을 찍어 채팅 입력칸에 붙인다.
 */
export function createLookTogether({ petName, hideOwnWindows, onImage, log }: LookOptions) {
  let overlays: { win: BrowserWindow; display: Display }[] = [];
  let restore: (() => void) | undefined;

  function closeOverlays() {
    // 목록을 먼저 비운다: destroy 가 부르는 closed 처리기가 "고르지 않고 닫힘"으로 보지 않게
    const list = overlays;
    overlays = [];
    for (const { win } of list) if (!win.isDestroyed()) win.destroy();
  }

  function finish() {
    closeOverlays();
    restore?.();
    restore = undefined;
  }

  async function start() {
    if (overlays.length > 0) return;
    // 맥에서 권한을 거절한 상태면 바로 안내한다. 아직 묻지 않은 상태면 첫 캡처 때 맥이 묻는다.
    if (process.platform === 'darwin') {
      const status = systemPreferences.getMediaAccessStatus('screen');
      if (status === 'denied' || status === 'restricted') {
        await explainPermission();
        return;
      }
    }
    restore = hideOwnWindows();
    const cursor = screen.getCursorScreenPoint();
    const under = screen.getDisplayNearestPoint(cursor);
    for (const display of screen.getAllDisplays()) {
      const win = new BrowserWindow({
        ...display.bounds,
        frame: false,
        transparent: true,
        hasShadow: false,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        enableLargerThanScreen: true,
        alwaysOnTop: true,
        show: false,
        webPreferences: {
          preload: join(import.meta.dirname, '../preload/index.cjs'),
          additionalArguments: ['--jj-window=overlay', langArg()],
          sandbox: true,
          contextIsolation: true,
        },
      });
      win.setAlwaysOnTop(true, 'screen-saver');
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      win.setBounds(display.bounds); // 맥이 메뉴 막대 아래로 밀어낸 경우를 되돌린다
      const query = { name: petName() };
      const devUrl = process.env.ELECTRON_RENDERER_URL;
      if (devUrl) win.loadURL(`${devUrl}/overlay.html?${new URLSearchParams(query)}`);
      else win.loadFile(join(import.meta.dirname, '../renderer/overlay.html'), { query });
      win.once('ready-to-show', () => {
        if (display.id === under.id) focusWindow(win);
        else showWindow(win);
      });
      // 고르지 않았는데 오버레이가 사라지면(모니터를 뽑음, 운영체제가 닫음) 같이 보기를 그만두고 펫을 되돌린다.
      // 그냥 두면 overlays 가 안 비워져 다음 같이 보기가 막히고 펫이 숨은 채 남았다 (버그잡이 6차)
      win.once('closed', () => {
        if (!overlays.some((o) => o.win === win)) return;
        log('look', 'overlay closed');
        finish();
      });
      overlays.push({ win, display });
    }
    log('look', 'start', overlays.length);
  }

  // 같이 보기 중에 모니터가 빠지면 그 모니터의 오버레이가 다른 화면으로 밀려 겹친다. 그만두고 펫을 되돌린다
  screen.on('display-removed', () => {
    if (overlays.length === 0) return;
    log('look', 'display removed');
    finish();
  });

  ipcMain.on(LOOK.select, async (e: IpcMainEvent, rect: Rect | null) => {
    const entry = overlays.find((o) => o.win.webContents === e.sender);
    if (!entry) return;
    closeOverlays();
    if (!rect) {
      log('look', 'cancel');
      finish();
      return;
    }
    await new Promise((r) => setTimeout(r, HIDE_SETTLE_MS));
    try {
      const image = await capture(entry.display, rect);
      finish();
      if (image) onImage(image);
    } catch (err) {
      log('look', 'error', err instanceof Error ? err.message : String(err));
      finish();
      await explainPermission();
    }
  });

  async function capture(display: Display, rect: Rect): Promise<OutgoingImage | undefined> {
    const started = Date.now();
    const all = screen.getAllDisplays();
    // 썸네일 상자는 하나라 가장 큰 모니터의 실제 픽셀에 맞춘다. 작은 모니터는 비율로 다시 계산한다.
    const box = all.reduce(
      (m, d) => ({
        width: Math.max(m.width, Math.round(d.size.width * d.scaleFactor)),
        height: Math.max(m.height, Math.round(d.size.height * d.scaleFactor)),
      }),
      { width: 1, height: 1 },
    );
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: box });
    // display_id 가 비어 있는 환경(일부 윈도우)은 모니터 순서로 맞춘다.
    const source =
      sources.find((s) => s.display_id === String(display.id)) ??
      (sources.length === all.length ? sources[all.findIndex((d) => d.id === display.id)] : undefined);
    if (!source || source.thumbnail.isEmpty()) throw new Error('화면 소스가 없다 (권한 없음 의심)');

    const shot = source.thumbnail;
    const area = isClick(rect) ? { x: 0, y: 0, ...display.size } : rect;
    let cropped = shot.crop(toPixels(area, display.size, shot.getSize()));
    if (looksBlank(cropped)) throw new Error('빈 화면 (권한 없음 의심)');

    // 크기 규칙은 채팅 붙이기와 같다: 긴 변 2000, PNG 가 3.5MB 를 넘으면 JPEG (shared/capture.ts)
    const fit = fitWithin(cropped.getSize(), IMAGE_MAX_SIDE);
    if (fit) cropped = cropped.resize({ ...fit, quality: 'best' });
    const thumbSize = fitWithin(cropped.getSize(), IMAGE_THUMB_SIDE) ?? cropped.getSize();
    const thumb = cropped
      .resize({ ...thumbSize, quality: 'good' })
      .toJPEG(THUMB_JPEG_QUALITY)
      .toString('base64');
    const png = cropped.toPNG();
    const jpeg = needsJpeg(png.length);
    const full = jpeg ? cropped.toJPEG(IMAGE_JPEG_QUALITY) : png;
    log(
      'look',
      'captured',
      JSON.stringify({ ...cropped.getSize(), bytes: full.length, jpeg, ms: Date.now() - started }),
    );
    return {
      full: { mediaType: jpeg ? 'image/jpeg' : 'image/png', data: full.toString('base64') },
      thumb: { thumb: `data:image/jpeg;base64,${thumb}` },
    };
  }

  async function explainPermission() {
    const isMac = process.platform === 'darwin';
    const { response } = await dialog.showMessageBox({
      type: 'info',
      message: t('chat.look.permission', { name: petName() }),
      detail: isMac ? t('chat.look.permissionMac') : t('chat.look.permissionOther'),
      buttons: isMac ? [t('chat.look.openSettings'), t('chat.close')] : [t('chat.close')],
      defaultId: 0,
    });
    if (isMac && response === 0) await shell.openExternal(MAC_SCREEN_SETTINGS);
  }

  return { start };
}

/** 권한이 없으면 맥은 바탕화면만, 또는 한 색으로 찍어 준다. 표본 픽셀의 색 가짓수로 본다. */
function looksBlank(image: NativeImage): boolean {
  const bitmap = image.toBitmap();
  const colors = new Set<number>();
  const step = 4 * 97;
  for (let i = 0; i + 4 <= bitmap.length && colors.size <= 2; i += step) colors.add(bitmap.readUInt32LE(i));
  return colors.size <= 1 && bitmap.length > 4 * 400;
}
