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
import { fitWithin, isClick, toPixels } from '../shared/capture.ts';
import type { Rect } from '../shared/geometry.ts';
import { LOOK, type OutgoingImage } from '../shared/ipc.ts';
import { withParticle } from '../shared/josa.ts';

/** AI 에 보낼 그림의 긴 변 최대값 (채팅 창 붙이기와 같은 기준). */
const MAX_SIDE = 2000;
const THUMB_SIDE = 480;
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
    for (const { win } of overlays) if (!win.isDestroyed()) win.destroy();
    overlays = [];
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
          additionalArguments: ['--jj-window=overlay'],
          sandbox: true,
          contextIsolation: true,
        },
      });
      win.setAlwaysOnTop(true, 'screen-saver');
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      win.setBounds(display.bounds); // 맥이 메뉴 막대 아래로 밀어낸 경우를 되돌린다
      const query = { name: withParticle(petName(), '이랑') };
      const devUrl = process.env.ELECTRON_RENDERER_URL;
      if (devUrl) win.loadURL(`${devUrl}/overlay.html?${new URLSearchParams(query)}`);
      else win.loadFile(join(import.meta.dirname, '../renderer/overlay.html'), { query });
      win.once('ready-to-show', () => {
        win.show();
        if (display.id === under.id) win.focus();
      });
      overlays.push({ win, display });
    }
    log('look', 'start', overlays.length);
  }

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

    const fit = fitWithin(cropped.getSize(), MAX_SIDE);
    if (fit) cropped = cropped.resize({ ...fit, quality: 'best' });
    const thumbSize = fitWithin(cropped.getSize(), THUMB_SIDE) ?? cropped.getSize();
    const thumb = cropped
      .resize({ ...thumbSize, quality: 'good' })
      .toJPEG(80)
      .toString('base64');
    log('look', 'captured', JSON.stringify({ ...cropped.getSize(), ms: Date.now() - started }));
    return {
      full: { mediaType: 'image/png', data: cropped.toPNG().toString('base64') },
      thumb: { thumb: `data:image/jpeg;base64,${thumb}` },
    };
  }

  async function explainPermission() {
    const isMac = process.platform === 'darwin';
    const { response } = await dialog.showMessageBox({
      type: 'info',
      message: `${withParticle(petName(), '이')} 화면을 보려면 화면 기록 권한이 필요해`,
      detail: isMac
        ? '시스템 설정 > 개인정보 보호 및 보안 > 화면 및 시스템 오디오 녹화에서 짝꿍을 켜 줘. 켠 다음에는 짝꿍을 껐다 켜야 해.'
        : '화면을 찍지 못했어. 다른 프로그램이 화면 캡처를 막고 있지 않은지 확인해 줘.',
      buttons: isMac ? ['설정 열기', '닫기'] : ['닫기'],
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
