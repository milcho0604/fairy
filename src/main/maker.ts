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
import {
  MAKER,
  type MakerInfo,
  type MakerTarget,
  MODEL_SCHEME,
  MODEL_URL,
  type PetImages,
} from '../shared/ipc.ts';
import { cleanPetName, POSE_KINDS } from '../shared/settings.ts';
import { CUSTOM_FOOD_COST } from '../shared/shop.ts';
import { BG_MODEL, ensureModel, modelReady, verifiedModelUrl } from './bg-model.ts';
import { focusWindow, showWindow, stealFocus } from './focus.ts';
import { settings } from './settings.ts';

/** 다듬은 펫 그림 크기 상한. 화면에서 512px 로 줄여 보내므로 이보다 크면 이상한 값이다. */
const MAX_PNG_BYTES = 4 * 1024 * 1024;
/** 움직이는 그림(gif, webp)은 줄이지 않고 그대로 저장해서 조금 더 받는다 */
const MAX_ANIMATED_BYTES = 8 * 1024 * 1024;

const MIME: Record<string, string> = { png: 'image/png', gif: 'image/gif', webp: 'image/webp' };

/** 파일 머리말로 형식을 확인한다. 모르는 형식이면 undefined */
function kindOf(bytes: Buffer): 'png' | 'gif' | 'webp' | undefined {
  if (bytes.length > 12 && bytes.readUInt32BE(0) === 0x89504e47) return 'png';
  if (bytes.subarray(0, 4).toString('latin1') === 'GIF8') return 'gif';
  if (
    bytes.subarray(0, 4).toString('latin1') === 'RIFF' &&
    bytes.subarray(8, 12).toString('latin1') === 'WEBP'
  )
    return 'webp';
  return undefined;
}

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

function dataUrlOf(file: string | undefined): string | null {
  if (!file) return null;
  try {
    const mime = MIME[file.split('.').pop() ?? ''] ?? 'image/png';
    return `data:${mime};base64,${readFileSync(join(petsDir(), file)).toString('base64')}`;
  } catch {
    return null;
  }
}

/** 지금 펫 그림들 (data URL). 사진 펫이 없으면 main 이 null 이고 포즈도 쓰지 않는다. */
export function petImages(): PetImages {
  const s = settings.get();
  const poses: PetImages['poses'] = {};
  for (const { id } of POSE_KINDS) {
    const url = dataUrlOf(s.petPoses[id]);
    if (url) poses[id] = url;
  }
  return { main: dataUrlOf(s.petImage), poses };
}

/**
 * 사진으로 펫 만들기 창 (P1-08). 배경 제거는 창(렌더러)에서 onnxruntime-web 으로 하고,
 * 메인은 모델 파일 받기와 다듬은 그림 저장만 한다. 사진은 컴퓨터 밖으로 나가지 않는다.
 */
export function createMaker(
  log: (tag: string, ...rest: unknown[]) => void,
  /** 커스텀 먹이 (v1 상점): 그림 파일을 저장한 뒤 상점에 넣는다. 코인이 모자라면 실패 */
  makeFood?: (name: string, file: string) => { ok: boolean; error?: string },
) {
  let win: BrowserWindow | undefined;
  let download: AbortController | undefined;
  let target: MakerTarget = 'main';
  const fromMaker = (e: IpcMainEvent | IpcMainInvokeEvent) =>
    !!win && !win.isDestroyed() && e.sender === win.webContents;

  ipcMain.handle(MAKER.modelReady, (e): MakerInfo | undefined =>
    fromMaker(e)
      ? {
          target,
          petName: settings.get().petName,
          hasPhotoPet: !!settings.get().petImage,
          hasPose: target !== 'main' && target !== 'food' && !!settings.get().petPoses[target],
          foodCost: CUSTOM_FOOD_COST,
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

  ipcMain.handle(MAKER.save, (e, dataUrl: string | null, name: string) => {
    if (!fromMaker(e)) return { ok: false };
    if (target === 'food') return saveFood(dataUrl, name);
    const old = target === 'main' ? settings.get().petImage : settings.get().petPoses[target];
    if (dataUrl === null) {
      if (target === 'main') settings.set({ petImage: null });
      else settings.set({ petPoses: { [target]: null } });
      if (old) rmSync(join(petsDir(), old), { force: true });
      log('maker', target === 'main' ? '기본 펫으로' : `포즈 지움 ${target}`);
      return { ok: true };
    }
    const m = typeof dataUrl === 'string' ? /^data:image\/(png|gif|webp);base64,/.exec(dataUrl) : null;
    if (!m) return { ok: false, error: '그림 형식이 이상해.' };
    const bytes = Buffer.from(dataUrl.slice(m[0].length), 'base64');
    // 머리말로 형식을 확인하고 크기를 본다 (data URL 의 형식 글자는 믿지 않는다).
    const kind = kindOf(bytes);
    const max = kind === 'png' ? MAX_PNG_BYTES : MAX_ANIMATED_BYTES;
    if (!kind || bytes.length > max)
      return { ok: false, error: '그림이 너무 크거나 PNG, GIF, WebP 가 아니야.' };
    mkdirSync(petsDir(), { recursive: true });
    const file = target === 'main' ? `pet-${Date.now()}.${kind}` : `pose-${target}-${Date.now()}.${kind}`;
    writeFileSync(join(petsDir(), file), bytes);
    if (target === 'main')
      settings.set({ petImage: file, ...(cleanPetName(name) ? { petName: cleanPetName(name) } : {}) });
    else settings.set({ petPoses: { [target]: file } });
    if (old && old !== file) rmSync(join(petsDir(), old), { force: true });
    log('maker', 'saved', file, `${Math.round(bytes.length / 1024)}KB`);
    return { ok: true };
  });

  /** 커스텀 먹이: PNG 만(배경 지운 사진), 상점이 코인을 받은 뒤에만 남긴다 */
  function saveFood(dataUrl: string | null, name: string) {
    const prefix = 'data:image/png;base64,';
    if (!makeFood || typeof dataUrl !== 'string' || !dataUrl.startsWith(prefix))
      return { ok: false, error: '그림 형식이 이상해.' };
    const bytes = Buffer.from(dataUrl.slice(prefix.length), 'base64');
    if (kindOf(bytes) !== 'png' || bytes.length > MAX_PNG_BYTES)
      return { ok: false, error: '그림이 너무 크거나 PNG 가 아니야.' };
    mkdirSync(petsDir(), { recursive: true });
    const file = `food-${Date.now()}.png`;
    writeFileSync(join(petsDir(), file), bytes);
    const r = makeFood(name, file);
    if (!r.ok) rmSync(join(petsDir(), file), { force: true });
    log('maker', 'food', r.ok ? file : r.error);
    return r;
  }

  ipcMain.on(MAKER.close, (e) => {
    if (fromMaker(e)) win?.close();
  });

  /** 펫 본 그림(main)이나 상태별 포즈를 만든다. 다른 것을 만드는 창이 열려 있으면 다시 연다 */
  function open(next: MakerTarget = 'main') {
    stealFocus();
    if (win && !win.isDestroyed()) {
      if (target === next) {
        focusWindow(win);
        return;
      }
      target = next;
      win.reload();
      focusWindow(win);
      return;
    }
    target = next;
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
    win.once('ready-to-show', () => showWindow(win));
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

/** 커스텀 먹이 그림 (data URL). 없으면 빈 글 */
export function foodImageDataUrl(file: string | undefined): string {
  if (!file || !/^food-\d+\.png$/.test(file)) return '';
  return dataUrlOf(file) ?? '';
}

/** 커스텀 먹이를 지울 때 그림 파일도 지운다 */
export function removeFoodImage(file: string | undefined): void {
  if (file && /^food-\d+\.png$/.test(file)) rmSync(join(petsDir(), file), { force: true });
}
