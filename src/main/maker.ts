import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  app,
  BrowserWindow,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  ipcMain,
  net,
  protocol,
} from 'electron';
import { MAKER, type MakerInfo, MODEL_SCHEME, MODEL_URL } from '../shared/ipc.ts';
import { cleanPetName } from '../shared/settings.ts';
import { BG_MODEL, ensureModel, modelReady, verifiedModelUrl } from './bg-model.ts';
import { settings } from './settings.ts';

/** 다듬은 펫 그림 크기 상한. 화면에서 512px 로 줄여 보내므로 이보다 크면 이상한 값이다. */
const MAX_PNG_BYTES = 4 * 1024 * 1024;

/** 모델 주소(jj-model://)에서 fetch 를 쓸 수 있게 한다. 앱이 준비되기 전에 불러야 한다. */
export function registerModelScheme() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MODEL_SCHEME,
      privileges: { supportFetchAPI: true, stream: true, secure: true, corsEnabled: true },
    },
  ]);
}

function petsDir(): string {
  return join(app.getPath('userData'), 'pets');
}

/** 지금 사진 펫 그림 (PNG data URL). 없거나 못 읽으면 null. */
export function petImageDataUrl(): string | null {
  const file = settings.get().petImage;
  if (!file) return null;
  try {
    return `data:image/png;base64,${readFileSync(join(petsDir(), file)).toString('base64')}`;
  } catch {
    return null;
  }
}

/**
 * 사진으로 펫 만들기 창 (P1-08). 배경 제거는 창(렌더러)에서 onnxruntime-web 으로 하고,
 * 메인은 모델 파일 받기와 다듬은 그림 저장만 한다. 사진은 컴퓨터 밖으로 나가지 않는다.
 */
export function createMaker(log: (tag: string, ...rest: unknown[]) => void) {
  let win: BrowserWindow | undefined;
  let download: AbortController | undefined;
  const fromMaker = (e: IpcMainEvent | IpcMainInvokeEvent) =>
    !!win && !win.isDestroyed() && e.sender === win.webContents;

  ipcMain.handle(MAKER.modelReady, (e): MakerInfo | undefined =>
    fromMaker(e)
      ? {
          petName: settings.get().petName,
          hasPhotoPet: !!settings.get().petImage,
          modelReady: modelReady(),
          modelMB: Math.round(BG_MODEL.bytes / 1_000_000),
          size: BG_MODEL.size,
          mean: BG_MODEL.mean,
          std: BG_MODEL.std,
        }
      : undefined,
  );

  ipcMain.handle(MAKER.ensureModel, async (e) => {
    if (!fromMaker(e)) return { ok: false, error: '창을 다시 열어 줘.' };
    download = new AbortController();
    try {
      await ensureModel((ratio) => {
        if (win && !win.isDestroyed()) win.webContents.send(MAKER.progress, ratio);
      }, download.signal);
      return { ok: true };
    } catch (err) {
      log('maker', 'model', err instanceof Error ? err.message : String(err));
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    } finally {
      download = undefined;
    }
  });

  // 모델 파일을 디스크에서 그대로 흘려 보낸다. 해시를 맞춘 뒤에만, 정해진 주소 하나만.
  // 창은 file:// (개발 중에는 localhost)에서 열려 다른 출처라 CORS 허용 머리를 붙인다.
  protocol.handle(MODEL_SCHEME, async (req) => {
    const file = verifiedModelUrl();
    if (!file || req.url !== MODEL_URL) return new Response(null, { status: 404 });
    const res = await net.fetch(file);
    return new Response(res.body, {
      status: res.status,
      headers: { 'content-type': 'application/octet-stream', 'access-control-allow-origin': '*' },
    });
  });

  ipcMain.handle(MAKER.save, (e, png: string | null, name: string) => {
    if (!fromMaker(e)) return { ok: false };
    const old = settings.get().petImage;
    if (png === null) {
      settings.set({ petImage: null });
      if (old) rmSync(join(petsDir(), old), { force: true });
      log('maker', '기본 펫으로');
      return { ok: true };
    }
    const prefix = 'data:image/png;base64,';
    if (typeof png !== 'string' || !png.startsWith(prefix))
      return { ok: false, error: '그림 형식이 이상해.' };
    const bytes = Buffer.from(png.slice(prefix.length), 'base64');
    // PNG 머리말(89 50 4E 47)과 크기를 확인한다.
    if (bytes.length > MAX_PNG_BYTES || bytes.readUInt32BE(0) !== 0x89504e47)
      return { ok: false, error: '그림이 너무 크거나 PNG 가 아니야.' };
    mkdirSync(petsDir(), { recursive: true });
    const file = `pet-${Date.now()}.png`;
    writeFileSync(join(petsDir(), file), bytes);
    settings.set({ petImage: file, ...(cleanPetName(name) ? { petName: cleanPetName(name) } : {}) });
    if (old && old !== file) rmSync(join(petsDir(), old), { force: true });
    log('maker', 'saved', file, `${Math.round(bytes.length / 1024)}KB`);
    return { ok: true };
  });

  ipcMain.on(MAKER.close, (e) => {
    if (fromMaker(e)) win?.close();
  });

  function open() {
    if (process.platform === 'darwin') app.focus({ steal: true });
    if (win && !win.isDestroyed()) {
      win.show();
      win.focus();
      return;
    }
    win = new BrowserWindow({
      width: 560,
      height: 660,
      minWidth: 460,
      minHeight: 560,
      title: '사진으로 펫 만들기',
      show: false,
      ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const } : {}),
      webPreferences: {
        preload: join(import.meta.dirname, '../preload/index.cjs'),
        additionalArguments: ['--jj-window=maker'],
        sandbox: true,
        contextIsolation: true,
      },
    });
    win.once('ready-to-show', () => win?.show());
    win.on('closed', () => {
      download?.abort();
      win = undefined;
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (ev) => ev.preventDefault());
    const devUrl = process.env.ELECTRON_RENDERER_URL;
    if (devUrl) win.loadURL(`${devUrl}/maker.html`);
    else win.loadFile(join(import.meta.dirname, '../renderer/maker.html'));
  }

  return {
    open,
    get window() {
      return win;
    },
  };
}
