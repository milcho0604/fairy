import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
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
import type { ImageAttachment } from '../shared/ai/types.ts';
import { t } from '../shared/i18n/index.ts';
import {
  DEPTH_URL,
  MAKER,
  type MakerInfo,
  type MakerTarget,
  MODEL_SCHEME,
  MODEL_URL,
  type PetImages,
} from '../shared/ipc.ts';
import { type Blueprint, parseBlueprint } from '../shared/pet3d/blueprint.ts';
import { BLUEPRINT_SYSTEM, blueprintPrompt, extractBlueprint } from '../shared/pet3d/prompt.ts';
import { cleanPetName, POSE_KINDS } from '../shared/settings.ts';
import { CUSTOM_FOOD_COST } from '../shared/shop.ts';
import { BG_MODEL, ensureModel, modelReady, verifiedModelUrl } from './bg-model.ts';
import { DEPTH_MODEL, depthReady, ensureDepthModel, verifiedDepthUrl } from './depth-model.ts';
import { focusWindow, showWindow, stealFocus } from './focus.ts';
import { langArg } from './lang.ts';
import { library } from './pet-library.ts';
import { readFileIn } from './safe-file.ts';
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

/** pets/ 안 일반 파일만 읽는다 (링크를 따라 폴더 밖을 읽지 않게, safe-file.ts) */
function dataUrlOf(file: string | undefined): string | null {
  const bytes = readFileIn(petsDir(), file);
  if (!bytes || !file) return null;
  const mime = MIME[file.split('.').pop() ?? ''] ?? 'image/png';
  return `data:${mime};base64,${bytes.toString('base64')}`;
}

/** 지금 펫 그림들 (data URL). 사진 펫이 없으면 main 이 null 이고 포즈도 쓰지 않는다. */
export function petImages(): PetImages {
  const s = settings.get();
  const poses: PetImages['poses'] = {};
  for (const { id } of POSE_KINDS) {
    const url = dataUrlOf(s.petPoses[id]);
    if (url) poses[id] = url;
  }
  return {
    main: dataUrlOf(s.petImage),
    model: s.petImage ? modelOf(s.petModel) : null,
    depth: s.petImage ? dataUrlOf(s.petDepth) : null,
    poses,
  };
}

/** 깊이 그림 상한. 화면에서 256px 회색 PNG 로 보낸다 */
const MAX_DEPTH_BYTES = 1024 * 1024;

/** 저장할 입체 모습을 고른다. 설계도는 다시 검사하고, 깊이 그림은 PNG 인지와 크기를 본다 */
function lookOf(raw: unknown): { model?: Blueprint; depth?: Buffer } {
  if (typeof raw !== 'object' || raw === null) return {};
  const r = raw as Record<string, unknown>;
  const model = parseBlueprint(r.model);
  if (model) return { model };
  const prefix = 'data:image/png;base64,';
  if (typeof r.depth === 'string' && r.depth.startsWith(prefix)) {
    const bytes = Buffer.from(r.depth.slice(prefix.length), 'base64');
    if (kindOf(bytes) === 'png' && bytes.length <= MAX_DEPTH_BYTES) return { depth: bytes };
  }
  return {};
}

/** 저장한 입체 설계도. 없거나 깨졌으면 null (사진으로 보인다) */
function modelOf(file: string | undefined): Blueprint | null {
  const bytes = readFileIn(petsDir(), file);
  if (!bytes) return null;
  try {
    return parseBlueprint(JSON.parse(bytes.toString('utf8'))) ?? null;
  } catch {
    return null;
  }
}

/** AI 한 번 묻기 (chat.oneShot) */
export type AskWithImage = (
  text: string,
  image: ImageAttachment,
  system: string,
  signal?: AbortSignal,
) => Promise<{ ok: true; text: string; provider: string } | { ok: false; error: string; noAi?: true }>;

/**
 * 사진으로 펫 만들기 창 (P1-08). 배경 제거는 창(렌더러)에서 onnxruntime-web 으로 하고,
 * 메인은 모델 파일 받기와 다듬은 그림 저장만 한다. 사진은 컴퓨터 밖으로 나가지 않는다.
 */
export function createMaker(
  log: (tag: string, ...rest: unknown[]) => void,
  /** 커스텀 먹이 (v1 상점): 그림 파일을 저장한 뒤 상점에 넣는다. 코인이 모자라면 실패 */
  makeFood?: (name: string, file: string) => { ok: boolean; error?: string },
  /** 사진을 AI 에 보내 입체 설계도를 받는다 (6단계) */
  ai?: { ask: AskWithImage; hasVision: () => Promise<boolean> },
) {
  const askWithImage = ai?.ask;
  let win: BrowserWindow | undefined;
  let download: AbortController | undefined;
  let shaping: AbortController | undefined;
  let target: MakerTarget = 'main';
  const fromMaker = (e: IpcMainEvent | IpcMainInvokeEvent) =>
    !!win && !win.isDestroyed() && e.sender === win.webContents;

  ipcMain.handle(
    MAKER.modelReady,
    async (e): Promise<MakerInfo | undefined> =>
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
            visionAi: false,
            depth: {
              ready: depthReady(),
              mb: Math.round(DEPTH_MODEL.bytes / 1_000_000),
              size: DEPTH_MODEL.size,
              mean: DEPTH_MODEL.mean,
              std: DEPTH_MODEL.std,
            },
          }
        : undefined,
  );

  ipcMain.handle(MAKER.visionAi, async (e) => fromMaker(e) && target === 'main' && !!(await ai?.hasVision()));

  ipcMain.handle(MAKER.ensureDepth, async (e) => {
    if (!fromMaker(e)) return { ok: false, error: t('main.maker.reopen') };
    download = new AbortController();
    try {
      await ensureDepthModel((ratio) => {
        if (win && !win.isDestroyed()) win.webContents.send(MAKER.progress, ratio);
      }, download.signal);
      return { ok: true };
    } catch (err) {
      log('maker', 'depth model', err instanceof Error ? err.message : String(err));
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    } finally {
      download = undefined;
    }
  });

  ipcMain.handle(MAKER.ensureModel, async (e) => {
    if (!fromMaker(e)) return { ok: false, error: t('main.maker.reopen') };
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
    const file =
      req.url === MODEL_URL ? verifiedModelUrl() : req.url === DEPTH_URL ? verifiedDepthUrl() : undefined;
    if (!file) return new Response(null, { status: 404 });
    const res = await net.fetch(file);
    return new Response(res.body, {
      status: res.status,
      headers: { 'content-type': 'application/octet-stream', 'access-control-allow-origin': '*' },
    });
  });

  // 다듬은 사진(PNG)만 AI 에 보낸다. 기록은 남기지 않는다(chat.oneShot)
  ipcMain.handle(MAKER.shape3d, async (e, dataUrl: string) => {
    if (!fromMaker(e) || !askWithImage) return { ok: false, error: t('main.maker.reopen') };
    const prefix = 'data:image/png;base64,';
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith(prefix))
      return { ok: false, error: t('main.maker.badFormat') };
    const data = dataUrl.slice(prefix.length);
    const bytes = Buffer.from(data, 'base64');
    if (kindOf(bytes) !== 'png' || bytes.length > MAX_PNG_BYTES)
      return { ok: false, error: t('main.maker.tooBigPng') };
    shaping?.abort();
    const abort = new AbortController();
    shaping = abort;
    const started = Date.now();
    const r = await askWithImage(
      blueprintPrompt(settings.get().petName),
      { mediaType: 'image/png', data },
      BLUEPRINT_SYSTEM,
      abort.signal,
    );
    if (shaping === abort) shaping = undefined;
    if (!r.ok) {
      log('maker', 'shape3d', r.noAi ? 'no ai' : r.error);
      return r;
    }
    const model = extractBlueprint(r.text);
    log(
      'maker',
      'shape3d',
      r.provider,
      `${Math.round((Date.now() - started) / 1000)}s`,
      model ? `${model.parts.length} parts` : 'bad',
    );
    return model ? { ok: true, model } : { ok: false, error: t('main.maker.shapeBad') };
  });

  ipcMain.handle(MAKER.save, (e, dataUrl: string | null, name: string, lookRaw?: unknown) => {
    if (!fromMaker(e)) return { ok: false };
    if (target === 'food') return saveFood(dataUrl, name);
    // 펫 본 그림은 지우지 않고 보관함에 넣는다(6단계). 포즈 그림만 바꿀 때 옛 것을 지운다
    const old = target === 'main' ? undefined : settings.get().petPoses[target];
    if (dataUrl === null) {
      if (target === 'main') library.toDefault(settings.get().petKind);
      else settings.set({ petPoses: { [target]: null } });
      if (old) rmSync(join(petsDir(), old), { force: true });
      log('maker', target === 'main' ? '기본 펫으로 (보관함에 둠)' : `포즈 지움 ${target}`);
      return { ok: true };
    }
    const m = typeof dataUrl === 'string' ? /^data:image\/(png|gif|webp);base64,/.exec(dataUrl) : null;
    if (!m) return { ok: false, error: t('main.maker.badFormat') };
    const bytes = Buffer.from(dataUrl.slice(m[0].length), 'base64');
    // 머리말로 형식을 확인하고 크기를 본다 (data URL 의 형식 글자는 믿지 않는다).
    const kind = kindOf(bytes);
    const max = kind === 'png' ? MAX_PNG_BYTES : MAX_ANIMATED_BYTES;
    if (!kind || bytes.length > max) return { ok: false, error: t('main.maker.tooBigAny') };
    mkdirSync(petsDir(), { recursive: true });
    const file = target === 'main' ? `pet-${Date.now()}.${kind}` : `pose-${target}-${Date.now()}.${kind}`;
    writeFileSync(join(petsDir(), file), bytes);
    // 입체 모습은 펫 본 그림에만: AI 설계도(다시 고르기를 거쳐) 또는 2.5D 깊이 그림(PNG 머리말과 크기 확인)
    const look = target === 'main' && kind === 'png' ? lookOf(lookRaw) : {};
    const modelFile = look.model ? `model-${Date.now()}.json` : undefined;
    if (look.model && modelFile) writeFileSync(join(petsDir(), modelFile), JSON.stringify(look.model));
    const depthFile = look.depth ? `depth-${Date.now()}.png` : undefined;
    if (look.depth && depthFile) writeFileSync(join(petsDir(), depthFile), look.depth);
    if (target === 'main') {
      library.beforeNewPhoto();
      settings.set({
        petImage: file,
        petModel: modelFile ?? null,
        petDepth: depthFile ?? null,
        ...(cleanPetName(name) ? { petName: cleanPetName(name) } : {}),
      });
    } else settings.set({ petPoses: { [target]: file } });
    if (old && old !== file) rmSync(join(petsDir(), old), { force: true });
    log('maker', 'saved', file, `${Math.round(bytes.length / 1024)}KB`);
    return { ok: true };
  });

  /** 커스텀 먹이: PNG 만(배경 지운 사진), 상점이 코인을 받은 뒤에만 남긴다 */
  function saveFood(dataUrl: string | null, name: string) {
    const prefix = 'data:image/png;base64,';
    if (!makeFood || typeof dataUrl !== 'string' || !dataUrl.startsWith(prefix))
      return { ok: false, error: t('main.maker.badFormat') };
    const bytes = Buffer.from(dataUrl.slice(prefix.length), 'base64');
    if (kindOf(bytes) !== 'png' || bytes.length > MAX_PNG_BYTES)
      return { ok: false, error: t('main.maker.tooBigPng') };
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
      title: t('main.maker.title'),
      show: false,
      ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const } : {}),
      webPreferences: {
        preload: join(import.meta.dirname, '../preload/index.cjs'),
        additionalArguments: ['--jj-window=maker', langArg()],
        sandbox: true,
        contextIsolation: true,
      },
    });
    win.once('ready-to-show', () => showWindow(win));
    win.on('closed', () => {
      download?.abort();
      shaping?.abort();
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
