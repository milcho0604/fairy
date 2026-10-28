import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  app,
  type BrowserWindow,
  clipboard,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  ipcMain,
  protocol,
  shell,
} from 'electron';
import type { ImageAttachment } from '../shared/ai/types.ts';
import { downloadErrorText, saveErrorText } from '../shared/download-error.ts';
import { GEMINI_URL, geminiPrompt, isGeminiStyle, isGeminiUrl } from '../shared/gemini.ts';
import { t } from '../shared/i18n/index.ts';
import { ILLUST_WISH_MAX, illustratePrompt, isAgeStage } from '../shared/illustrate.ts';
import { sizeOk } from '../shared/image-head.ts';
import {
  ANIME_URL,
  DEPTH_URL,
  MAKER,
  type MakerInfo,
  type MakerTarget,
  MODEL_SCHEME,
  MODEL_URL,
  ORT_WASM_URL,
  type PetImages,
  type SpriteRowResult,
  type SpriteSource,
} from '../shared/ipc.ts';
import { illustEngineOf, LOCAL_DRAW_GB, type LocalDrawInfo } from '../shared/local-draw.ts';
import { cleanSprites } from '../shared/pet-share.ts';
import { type PetSprites, spriteFiles } from '../shared/pet-sprites.ts';
import { type Blueprint, type Gait, parseBlueprint } from '../shared/pet3d/blueprint.ts';
import {
  BLUEPRINT_SYSTEM,
  blueprintPrompt,
  cleanWish,
  critiquePrompt,
  extractBlueprint,
  extractBlueprintWithFixes,
  WISH_MAX,
} from '../shared/pet3d/prompt.ts';
import { canStand } from '../shared/pet3d/stand.ts';
import { starterFigureOf } from '../shared/pet3d/starters.ts';
import {
  cleanDescribe,
  DESCRIBE_MAX,
  describePrompt,
  readTextAnswer,
  TEXT_SYSTEM,
  TWEAK_MAX,
  textLength,
  textOk,
  tweakPrompt,
} from '../shared/pet3d/text-prompt.ts';
import { cleanPetName, isGait, POSE_KINDS, photoPetName } from '../shared/settings.ts';
import { CUSTOM_FOOD_COST } from '../shared/shop.ts';
import { geminiStripPrompt, isRowId, KEY_COLORS, keyHex, rowOf } from '../shared/sprite-strip.ts';
import { starterOf } from '../shared/starter-pets.ts';
import { ANIME_MODEL, animeReady, ensureAnimeModel, verifiedAnimeUrl } from './anime-model.ts';
import { BG_MODEL, bgModelBytes, ensureModel, modelReady, verifiedModelUrl } from './bg-model.ts';
import {
  DEPTH_MODEL,
  depthModelBytes,
  depthReady,
  ensureDepthModel,
  verifiedDepthUrl,
} from './depth-model.ts';
import { devRendererUrl } from './dev-url.ts';
import { focusWindow, showWindow } from './focus.ts';
import {
  type FetchLike,
  IllustError,
  type IllustErrorKind,
  type ImageKind,
  illustrateFluffy,
  imageKind,
} from './hf-illust.ts';
import { hfToken } from './hf-token.ts';
import { langArg } from './lang.ts';
import { illustrateLocal, localDrawInfo, localDrawSupport, setupLocalDraw } from './local-draw.ts';
import { LocalDrawError, type LocalDrawErrorKind } from './local-draw-core.ts';
import { mainFetch } from './net-fetch.ts';
import { ensureOrtWasm, ORT_WASM, ortWasmReady, verifiedOrtWasmUrl } from './ort-wasm.ts';
import { library, spriteUrls } from './pet-library.ts';
import { readFileIn, writeFileAtomic } from './safe-file.ts';
import { settings } from './settings.ts';
import { drawStrip, drawStripLocal, type LocalStripDraw } from './sprite-gen.ts';
import { readStarterWalk } from './starter-copy.ts';
import { openRemembered } from './window-bounds.ts';

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

const toMb = (bytes: number) => Math.round(bytes / 1_000_000);
/** 아직 받을 사진 AI 엔진 크기 (받았으면 0) */
const engineBytes = () => (ortWasmReady() ? 0 : ORT_WASM.bytes);

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
  const sprites = s.petImage ? spriteUrls(s.petSprites) : undefined;
  const poses: PetImages['poses'] = {};
  for (const { id } of POSE_KINDS) {
    const url = dataUrlOf(s.petPoses[id]);
    if (url) poses[id] = url;
  }
  return {
    main: dataUrlOf(s.petImage),
    // 밀크, 초코 그림은 기본이 사진 그대로, 설정에서 네 발로 선 피규어를 켜면 앱에 든 피규어 (만들기로 고친 설계도가 있으면 그것)
    model: s.petImage ? (modelOf(s.petModel) ?? starterFigureOf(s.petImage, s.petStands)) : null,
    depth: s.petImage ? dataUrlOf(s.petDepth) : null,
    poses,
    ...(s.petImage && s.petAge ? { age: s.petAge } : {}),
    ...(starterOf(s.petImage) ? { starter: starterOf(s.petImage) } : {}),
    ...walkOf(s.petImage),
    ...(sprites ? { sprites } : {}),
  };
}

/** 밀크, 초코 그림이면 앱에 든 옆모습 걷기 그림 (data URL, 한 번 읽어 둔다). 없으면 빈 것 */
const walkCache = new Map<string, string[]>();
function walkOf(petImage: string | null | undefined): { walk?: string[] } {
  const id = starterOf(petImage);
  if (!id) return {};
  let urls = walkCache.get(id);
  if (!urls) {
    const dir = join(app.getAppPath(), 'resources', 'pets');
    urls = readStarterWalk(dir, id).map((b) => `data:image/webp;base64,${b.toString('base64')}`);
    walkCache.set(id, urls);
  }
  return urls.length > 0 ? { walk: urls } : {};
}

/** 깊이 그림 상한. 화면에서 256px 회색 PNG 로 보낸다 */
const MAX_DEPTH_BYTES = 1024 * 1024;

/**
 * 저장할 입체 모습을 고른다. 설계도는 다시 검사하고, 깊이 그림은 PNG 인지와 크기를 본다.
 * 설계도와 같이 온 요청사항(그 설계도를 만든 글)은 다듬어 둔다 (걸음새에 맞게 다시 만들 때 쓴다)
 */
function lookOf(raw: unknown): {
  model?: Blueprint;
  depth?: Buffer;
  wish?: string;
  personalOnly?: true;
  stand?: true;
  text?: string;
} {
  if (typeof raw !== 'object' || raw === null) return {};
  const r = raw as Record<string, unknown>;
  const model = parseBlueprint(r.model);
  if (model) {
    const wish = typeof r.wish === 'string' && r.wish.length <= WISH_MAX * 4 ? cleanWish(r.wish) : '';
    return {
      model,
      ...(wish ? { wish } : {}),
      // 말로 만들기: 개인 용도 표시와 네 발로 서기 (서기는 설 수 있는 몸일 때만)
      ...(r.personalOnly === true ? { personalOnly: true as const } : {}),
      ...(r.stand === true && canStand(model) ? { stand: true as const } : {}),
      // 말로 만든 처음 글 (걸음새를 바꿔 다시 만들 때 쓴다)
      ...(textOk(r.text, DESCRIBE_MAX) && cleanDescribe(r.text) ? { text: cleanDescribe(r.text) } : {}),
    };
  }
  const prefix = 'data:image/png;base64,';
  if (typeof r.depth === 'string' && r.depth.startsWith(prefix)) {
    const bytes = Buffer.from(r.depth.slice(prefix.length), 'base64');
    if (kindOf(bytes) === 'png' && bytes.length <= MAX_DEPTH_BYTES) return { depth: bytes };
  }
  return {};
}

/** 설계도 파일 상한. 부품 40개면 10KB 안팎이라 넉넉하다 (pet-library.ts 와 같다). 넘으면 읽지 않고 사진으로 */
const MAX_MODEL_BYTES = 256 * 1024;

/** 저장한 입체 설계도. 없거나 깨졌거나 너무 크면 null (사진으로 보인다) */
export function modelOf(file: string | undefined): Blueprint | null {
  const bytes = readFileIn(petsDir(), file, MAX_MODEL_BYTES);
  if (!bytes) return null;
  try {
    return parseBlueprint(JSON.parse(bytes.toString('utf8'))) ?? null;
  } catch {
    return null;
  }
}

/** 글만으로 AI 한 번 묻기 (chat.textShot, 말로 만들기) */
export type AskText = (
  text: string,
  system: string,
  signal?: AbortSignal,
) => Promise<{ ok: true; text: string; provider: string } | { ok: false; error: string; noAi?: true }>;

/** AI 한 번 묻기 (chat.oneShot) */
export type AskWithImage = (
  text: string,
  /** 그림 하나 또는 여럿 (사진과 그린 그림을 같이 보여 줄 때) */
  image: ImageAttachment | readonly ImageAttachment[],
  system: string,
  signal?: AbortSignal,
) => Promise<{ ok: true; text: string; provider: string } | { ok: false; error: string; noAi?: true }>;

/**
 * 사진으로 펫 만들기 창 (P1-08). 배경 제거는 창(렌더러)에서 onnxruntime-web 으로 하고,
 * 메인은 모델 파일 받기와 다듬은 그림 저장만 한다. 사진은 컴퓨터 밖으로 나가지 않는다
 * (사용자가 그때그때 AI 일러스트를 고를 때만 Hugging Face 로 간다, hf-illust.ts).
 */
export function createMaker(
  log: (tag: string, ...rest: unknown[]) => void,
  /** 커스텀 먹이 (v1 상점): 그림 파일을 저장한 뒤 상점에 넣는다. 코인이 모자라면 실패 */
  makeFood?: (name: string, file: string) => { ok: boolean; error?: string },
  /** 사진을 AI 에 보내 입체 설계도를 받는다 (6단계) */
  ai?: {
    ask: AskWithImage;
    hasVision: () => Promise<boolean>;
    /** 말로 만들기 (글만 보내는 AI) */
    text?: { ask: AskText; has: () => Promise<boolean> };
  },
) {
  const askWithImage = ai?.ask;
  /** 말로 만들기에 쓸 AI. 개발 시험은 __jj.maker.debugTextAi 로 가짜 AI 를 넣는다 (진짜 AI 를 부르지 않게) */
  let textAi = ai?.text;
  let win: BrowserWindow | undefined;
  let download: AbortController | undefined;
  let shaping: AbortController | undefined;
  let drawing: AbortController | undefined;
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
            newPetName: newPhotoName(),
            hasPhotoPet: !!settings.get().petImage,
            hasPose:
              target !== 'main' &&
              target !== 'food' &&
              target !== 'sprites' &&
              !!settings.get().petPoses[target],
            foodCost: CUSTOM_FOOD_COST,
            modelReady: modelReady() && ortWasmReady(),
            modelMB: toMb(bgModelBytes() + engineBytes()),
            size: BG_MODEL.size,
            mean: BG_MODEL.mean,
            std: BG_MODEL.std,
            visionAi: false,
            depth: {
              ready: depthReady() && ortWasmReady(),
              mb: toMb(depthModelBytes() + engineBytes()),
              size: DEPTH_MODEL.size,
              mean: DEPTH_MODEL.mean,
              std: DEPTH_MODEL.std,
            },
            anime: {
              ready: animeReady() && ortWasmReady(),
              mb: toMb(ANIME_MODEL.bytes + engineBytes()),
              size: ANIME_MODEL.size,
              mean: ANIME_MODEL.mean,
              std: ANIME_MODEL.std,
            },
            hfToken: hfToken.has(),
            localDraw: localDrawInfo(),
            illustEngine: settings.get().illustEngine,
          }
        : undefined,
  );

  const progress = (ratio: number) => {
    if (win && !win.isDestroyed()) win.webContents.send(MAKER.progress, ratio);
  };

  /**
   * 사진 AI 엔진 wasm 을 먼저, 그다음 모델을 받는다 (엔진은 설치 파일에 없다, ort-wasm.ts).
   * 진행률은 받을 크기만큼 나눠 하나로 잇는다
   */
  async function withEngine(
    modelBytes: number,
    haveModel: boolean,
    signal: AbortSignal,
    ensure: (onProgress: (ratio: number) => void) => Promise<unknown>,
  ) {
    const engine = engineBytes();
    const share = engine / (engine + (haveModel ? 0 : modelBytes)) || 0;
    await ensureOrtWasm((r) => progress(r * share), signal);
    await ensure((r) => progress(share + r * (1 - share)));
  }

  ipcMain.handle(MAKER.visionAi, async (e) => fromMaker(e) && target === 'main' && !!(await ai?.hasVision()));

  ipcMain.handle(MAKER.textAi, async (e) => fromMaker(e) && target === 'main' && !!(await textAi?.has()));

  /** 말로 만들기 한 번 (처음 만들기, 고치기). 글은 기록에 남기지 않고 길이만 */
  async function askText(kind: 'describe' | 'tweak', prompt: string, chars: number) {
    const ask = textAi?.ask;
    if (!ask) return { ok: false as const, noAi: true, error: t('main.maker.noTextAi') };
    shaping?.abort();
    const abort = new AbortController();
    shaping = abort;
    const started = Date.now();
    // AI 쪽이 던지면(시작 실패 등) 창의 진행 표시가 멈추지 않고 계속 돌았다: 알기 쉬운 실패로 돌려준다
    const r = await ask(prompt, TEXT_SYSTEM, abort.signal).catch((err: unknown) => {
      log('maker', kind, 'threw', err instanceof Error ? err.message : String(err));
      return { ok: false as const, error: t('main.maker.textFailed'), noAi: undefined };
    });
    if (shaping === abort) shaping = undefined;
    const secs = `${Math.round((Date.now() - started) / 1000)}s`;
    if (abort.signal.aborted) {
      log('maker', kind, 'cancelled', secs);
      return { ok: false as const, error: t('main.maker.shapeCancelled') };
    }
    if (!r.ok) {
      log('maker', kind, r.noAi ? 'no ai' : r.error);
      return r;
    }
    const got = readTextAnswer(r.text);
    log(
      'maker',
      kind,
      r.provider,
      secs,
      got.ok ? `${got.bp.parts.length} parts` : got.reason,
      `text ${chars}`,
      got.ok && got.namedCharacter ? 'named' : '',
      got.ok && got.fixes.length ? `fixed ${got.fixes.join(', ')}` : '',
    );
    return got.ok
      ? { ok: true as const, model: got.bp, namedCharacter: got.namedCharacter }
      : { ok: false as const, error: t('main.maker.textBad') };
  }

  // 말로 만들기: 적은 글(다듬어 자료 칸에 넣는다)만 AI 에 보낸다. 기록은 남기지 않는다
  ipcMain.handle(MAKER.describe, async (e, textRaw: unknown) => {
    if (!fromMaker(e) || target !== 'main') return { ok: false, error: t('main.maker.reopen') };
    if (!textOk(textRaw, DESCRIBE_MAX)) return { ok: false, error: t('main.maker.badFormat') };
    const text = cleanDescribe(textRaw);
    if (!text) return { ok: false, error: t('main.maker.textEmpty') };
    return askText('describe', describePrompt(text, { webSearch: true }), textLength(text));
  });

  // 말로 만들기 고치기: 지금 설계도(다시 검사)와 고칠 점. 처음 결과가 캐릭터였으면 고친 뒤에도 그대로 둔다
  ipcMain.handle(
    MAKER.tweak,
    async (e, modelRaw: unknown, askRaw: unknown, originalRaw: unknown, namedRaw: unknown) => {
      if (!fromMaker(e) || target !== 'main') return { ok: false, error: t('main.maker.reopen') };
      const model = parseBlueprint(modelRaw);
      if (!model || !textOk(askRaw, TWEAK_MAX) || (originalRaw != null && !textOk(originalRaw, DESCRIBE_MAX)))
        return { ok: false, error: t('main.maker.badFormat') };
      const ask = cleanDescribe(askRaw, TWEAK_MAX);
      if (!ask) return { ok: false, error: t('main.maker.textEmpty') };
      const named = namedRaw === true;
      const r = await askText(
        'tweak',
        tweakPrompt(model, ask, cleanDescribe(originalRaw), named),
        textLength(ask),
      );
      return r.ok ? { ...r, namedCharacter: r.namedCharacter || named } : r;
    },
  );

  ipcMain.handle(MAKER.ensureDepth, async (e) => {
    if (!fromMaker(e)) return { ok: false, error: t('main.maker.reopen') };
    const ac = new AbortController();
    download = ac;
    try {
      await withEngine(depthModelBytes(), depthReady(), ac.signal, (p) => ensureDepthModel(p, ac.signal));
      return { ok: true };
    } catch (err) {
      // 원문(net::ERR_..., ENOSPC ...)은 기록에만. 화면에는 할 일을 알려 주는 글
      log('maker', 'depth model', err instanceof Error ? err.message : String(err));
      const mb = toMb(depthModelBytes() + engineBytes());
      return { ok: false, error: downloadErrorText(err, { aborted: ac.signal.aborted, mb }) };
    } finally {
      // 그새 다른 받기가 시작했으면 그것은 두고 내 것만 지운다 (지우면 그만두기로 못 멈춘다)
      if (download === ac) download = undefined;
    }
  });

  ipcMain.handle(MAKER.ensureAnime, async (e) => {
    if (!fromMaker(e)) return { ok: false, error: t('main.maker.reopen') };
    const ac = new AbortController();
    download = ac;
    try {
      await withEngine(ANIME_MODEL.bytes, animeReady(), ac.signal, (p) => ensureAnimeModel(p, ac.signal));
      return { ok: true };
    } catch (err) {
      log('maker', 'anime model', err instanceof Error ? err.message : String(err));
      const mb = toMb(ANIME_MODEL.bytes + engineBytes());
      return { ok: false, error: downloadErrorText(err, { aborted: ac.signal.aborted, mb }) };
    } finally {
      if (download === ac) download = undefined;
    }
  });

  ipcMain.handle(MAKER.ensureModel, async (e) => {
    if (!fromMaker(e)) return { ok: false, error: t('main.maker.reopen') };
    const ac = new AbortController();
    download = ac;
    try {
      await withEngine(bgModelBytes(), modelReady(), ac.signal, (p) => ensureModel(p, ac.signal));
      return { ok: true };
    } catch (err) {
      // 원문(net::ERR_..., ENOSPC ...)은 기록에만. 화면에는 할 일을 알려 주는 글
      log('maker', 'model', err instanceof Error ? err.message : String(err));
      const mb = toMb(bgModelBytes() + engineBytes());
      return { ok: false, error: downloadErrorText(err, { aborted: ac.signal.aborted, mb }) };
    } finally {
      // 그새 다른 받기가 시작했으면 그것은 두고 내 것만 지운다 (지우면 그만두기로 못 멈춘다)
      if (download === ac) download = undefined;
    }
  });

  // 모델 파일을 디스크에서 그대로 흘려 보낸다. 해시를 맞춘 뒤에만, 정해진 주소 하나만.
  // 창은 file:// (개발 중에는 localhost)에서 열려 다른 출처라 CORS 허용 머리를 붙인다.
  protocol.handle(MODEL_SCHEME, async (req) => {
    const wasm = req.url === ORT_WASM_URL;
    const file = wasm
      ? verifiedOrtWasmUrl()
      : req.url === MODEL_URL
        ? verifiedModelUrl()
        : req.url === DEPTH_URL
          ? verifiedDepthUrl()
          : req.url === ANIME_URL
            ? verifiedAnimeUrl()
            : undefined;
    if (!file) return new Response(null, { status: 404 });
    const res = await mainFetch(file);
    return new Response(res.body, {
      status: res.status,
      // wasm 은 application/wasm 이어야 받으면서 바로 컴파일한다(instantiateStreaming)
      headers: {
        'content-type': wasm ? 'application/wasm' : 'application/octet-stream',
        'access-control-allow-origin': '*',
      },
    });
  });

  // 다듬은 사진(PNG)과 사용자 요청사항(글, 선택)만 AI 에 보낸다. 기록은 남기지 않는다(chat.oneShot)
  ipcMain.handle(MAKER.shape3d, async (e, dataUrl: string, wishRaw?: unknown, gaitRaw?: unknown) => {
    if (!fromMaker(e) || !askWithImage) return { ok: false, error: t('main.maker.reopen') };
    // 요청사항은 글이거나 없음만. 칸 상한(WISH_MAX)보다 한참 긴 글은 창이 보낸 값이 아니다
    if (wishRaw != null && (typeof wishRaw !== 'string' || wishRaw.length > WISH_MAX * 4))
      return { ok: false, error: t('main.maker.badFormat') };
    // 걸음새는 두 발, 네 발, 또는 없음(자동: AI 가 사진을 보고 정한다)
    if (gaitRaw != null && !isGait(gaitRaw)) return { ok: false, error: t('main.maker.badFormat') };
    const gait = gaitRaw ?? undefined;
    const wish = cleanWish(wishRaw);
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
      blueprintPrompt(settings.get().petName, wish, gait),
      { mediaType: 'image/png', data },
      BLUEPRINT_SYSTEM,
      abort.signal,
    );
    if (shaping === abort) shaping = undefined;
    // 그만두기(진행 표시)나 새로 만들기로 멈췄으면 AI 답이 와도 버린다
    if (abort.signal.aborted) {
      log('maker', 'shape3d', 'cancelled', `${Math.round((Date.now() - started) / 1000)}s`);
      return { ok: false, error: t('main.maker.shapeCancelled') };
    }
    if (!r.ok) {
      log('maker', 'shape3d', r.noAi ? 'no ai' : r.error);
      return r;
    }
    const got = extractBlueprintWithFixes(r.text, gait);
    const model = got?.bp;
    log(
      'maker',
      'shape3d',
      r.provider,
      `${Math.round((Date.now() - started) / 1000)}s`,
      model ? `${model.parts.length} parts` : 'bad',
      // 요청 글은 기록에 남기지 않고 길이만
      wish ? `wish ${[...wish].length}` : 'no wish',
      gait ?? 'gait auto',
      got?.fixes.length ? `fixed ${got.fixes.join(', ')}` : '',
    );
    return model ? { ok: true, model } : { ok: false, error: t('main.maker.shapeBad') };
  });

  /** PNG data URL 을 base64 로. 아니면 undefined */
  const pngOf = (dataUrl: unknown): string | undefined => {
    const prefix = 'data:image/png;base64,';
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith(prefix)) return undefined;
    const data = dataUrl.slice(prefix.length);
    const bytes = Buffer.from(data, 'base64');
    return kindOf(bytes) === 'png' && bytes.length <= MAX_PNG_BYTES ? data : undefined;
  };

  // 두 번째 보기 (선택): 사진과 앱이 그린 설계도 그림을 같이 보여 주고 한 번 고치게 한다. 실패하면 창이 처음 설계도를 그대로 쓴다
  ipcMain.handle(
    MAKER.refine3d,
    async (
      e,
      photoUrl: unknown,
      renderUrl: unknown,
      modelRaw: unknown,
      wishRaw?: unknown,
      gaitRaw?: unknown,
    ) => {
      if (!fromMaker(e) || !askWithImage) return { ok: false, error: t('main.maker.reopen') };
      if (wishRaw != null && (typeof wishRaw !== 'string' || wishRaw.length > WISH_MAX * 4))
        return { ok: false, error: t('main.maker.badFormat') };
      if (gaitRaw != null && !isGait(gaitRaw)) return { ok: false, error: t('main.maker.badFormat') };
      const gait = gaitRaw ?? undefined;
      const wish = cleanWish(wishRaw);
      const photo = pngOf(photoUrl);
      const render = pngOf(renderUrl);
      const model = parseBlueprint(modelRaw);
      if (!photo || !render || !model) return { ok: false, error: t('main.maker.badFormat') };
      shaping?.abort();
      const abort = new AbortController();
      shaping = abort;
      const started = Date.now();
      const r = await askWithImage(
        critiquePrompt(settings.get().petName, model, wish, gait),
        [
          { mediaType: 'image/png', data: photo },
          { mediaType: 'image/png', data: render },
        ],
        BLUEPRINT_SYSTEM,
        abort.signal,
      );
      if (shaping === abort) shaping = undefined;
      if (abort.signal.aborted) return { ok: false, error: t('main.maker.shapeCancelled') };
      if (!r.ok) {
        log('maker', 'refine3d', r.noAi ? 'no ai' : r.error);
        return r;
      }
      const got = extractBlueprintWithFixes(r.text, gait);
      log(
        'maker',
        'refine3d',
        r.provider,
        `${Math.round((Date.now() - started) / 1000)}s`,
        got ? `${got.bp.parts.length} parts` : 'bad',
        got?.fixes.length ? `fixed ${got.fixes.join(', ')}` : '',
      );
      return got ? { ok: true, model: got.bp } : { ok: false, error: t('main.maker.shapeBad') };
    },
  );

  // AI 일러스트 (2026-10-09): 사용자가 고를 때만 사진을 Hugging Face 무료 Space 로 보낸다. 사진, 요청문, 토큰은 기록에 남기지 않는다.
  // 내 컴퓨터에서(engine local, 옛 값 mac, 2026-10-10)는 사진이 이 컴퓨터 밖으로 나가지 않는다 (local-draw.ts)
  ipcMain.handle(
    MAKER.illustrate,
    async (e, photoRaw: unknown, ageRaw: unknown, wishRaw?: unknown, engineRaw?: unknown) => {
      const failed = (kind: IllustErrorKind | 'reopen' | 'format') => ({
        ok: false as const,
        kind,
        error:
          kind === 'reopen'
            ? t('main.maker.reopen')
            : kind === 'format'
              ? t('main.maker.badFormat')
              : illustText(kind),
      });
      if (!fromMaker(e) || target !== 'main') return failed('reopen');
      if (!isAgeStage(ageRaw)) return failed('format');
      const engine = engineRaw == null ? 'cloud' : illustEngineOf(engineRaw);
      if (!engine) return failed('format');
      if (wishRaw != null && (typeof wishRaw !== 'string' || wishRaw.length > ILLUST_WISH_MAX * 4))
        return failed('format');
      const m = typeof photoRaw === 'string' ? /^data:image\/(jpeg|png);base64,/.exec(photoRaw) : null;
      if (!m || typeof photoRaw !== 'string') return failed('format');
      const photo = Buffer.from(photoRaw.slice(m[0].length), 'base64');
      const kind = imageKind(photo);
      if ((kind !== 'jpeg' && kind !== 'png') || photo.length > MAX_PNG_BYTES) return failed('format');
      drawing?.abort();
      const abort = new AbortController();
      drawing = abort;
      if (engine === 'local') {
        try {
          const r = await illustrateLocal(photo, kind, illustratePrompt(ageRaw, wishRaw), {
            signal: abort.signal,
            onProgress: (ratio) => {
              if (win && !win.isDestroyed()) win.webContents.send(MAKER.progress, ratio);
            },
            log,
          });
          log(
            'maker',
            'illust',
            'local',
            ageRaw,
            r.fur ? 'fur' : 'no fur',
            `${Math.round(r.bytes.length / 1024)}KB`,
          );
          return {
            ok: true as const,
            image: dataUrlFrom(r.bytes, r.kind),
            ...(r.before ? { before: dataUrlFrom(r.before.bytes, r.before.kind) } : {}),
            // 그리다 CPU 로 되돌렸으면 걸리는 시간 안내가 바뀐다 (창이 새 값으로 바꾼다)
            localDraw: localDrawInfo(),
          };
        } catch (err) {
          const k: LocalDrawErrorKind = err instanceof LocalDrawError ? err.kind : 'failed';
          if (!(err instanceof LocalDrawError))
            log('maker', 'illust local', err instanceof Error ? err.message : String(err));
          return { ok: false as const, kind: k, error: localDrawText(k, 'draw'), localDraw: localDrawInfo() };
        } finally {
          if (drawing === abort) drawing = undefined;
        }
      }
      try {
        // 그린 뒤 털 다듬기까지 (다리 털이 매끈하게 나왔다, hf-illust.ts FUR_PROMPT)
        const r = await illustrateFluffy(
          photo,
          kind === 'png' ? 'image/png' : 'image/jpeg',
          illustratePrompt(ageRaw, wishRaw),
          {
            // 운영체제 프록시를 따르는 Electron fetch
            fetch: mainFetch,
            token: hfToken.get(),
            signal: abort.signal,
            log,
          },
        );
        log(
          'maker',
          'illust',
          r.space,
          ageRaw,
          r.fur ? 'fur' : 'no fur',
          `${Math.round(r.bytes.length / 1024)}KB`,
        );
        return {
          ok: true as const,
          image: dataUrlFrom(r.bytes, r.kind),
          // 털 다듬기 전 그림: 창이 털색을 비교해 되돌리거나 맞춘다 (shared/color-match.ts)
          ...(r.before ? { before: dataUrlFrom(r.before.bytes, r.before.kind) } : {}),
        };
      } catch (err) {
        const k = err instanceof IllustError ? err.kind : 'busy';
        if (!(err instanceof IllustError))
          log('maker', 'illust', err instanceof Error ? err.message : String(err));
        return failed(k);
      } finally {
        if (drawing === abort) drawing = undefined;
      }
    },
  );

  // 내 컴퓨터에서 그리기 준비 (처음 한 번 mflux 16GB, sd.cpp 5.2GB 쯤 받기). 그만두기, 창 닫기로 멈추고 다음에 이어서 한다
  ipcMain.handle(MAKER.setupLocalDraw, async (e) => {
    if (!fromMaker(e)) return { ok: false, kind: 'reopen', error: t('main.maker.reopen') };
    const ac = new AbortController();
    download = ac;
    try {
      await setupLocalDraw(
        (ratio) => {
          if (win && !win.isDestroyed()) win.webContents.send(MAKER.progress, ratio);
        },
        ac.signal,
        log,
      );
      // 준비하며 Vulkan 장치가 없어 CPU 로 바꿨을 수 있다: 시간 안내를 새로 (창이 바꾼다)
      return { ok: true, localDraw: localDrawInfo() };
    } catch (err) {
      const k: LocalDrawErrorKind = err instanceof LocalDrawError ? err.kind : 'failed';
      if (!(err instanceof LocalDrawError))
        log('maker', 'local setup', err instanceof Error ? err.message : String(err));
      const gb = err instanceof LocalDrawError ? err.gb : undefined;
      return { ok: false, kind: k, error: localDrawText(k, 'setup', gb), localDraw: localDrawInfo() };
    } finally {
      if (download === ac) download = undefined;
    }
  });

  ipcMain.handle(MAKER.setIllustEngine, (e, raw: unknown) => {
    const engine = illustEngineOf(raw);
    if (fromMaker(e) && engine) settings.set({ illustEngine: engine });
    return settings.get().illustEngine;
  });

  // Gemini 앱(무료)에서 만들기 (2026-10-11): 요청문은 메인이 만들어 클립보드에 넣는다 (창이 보낸 글을 그대로 넣지 않는다).
  // 여는 주소는 gemini.google.com/app 하나뿐. 사진은 사용자가 직접 올린다
  ipcMain.handle(MAKER.openGemini, async (e, styleRaw: unknown, ageRaw: unknown, wishRaw?: unknown) => {
    if (!fromMaker(e) || !isGeminiStyle(styleRaw) || !isAgeStage(ageRaw))
      return { copied: false, opened: false };
    if (wishRaw != null && (typeof wishRaw !== 'string' || wishRaw.length > ILLUST_WISH_MAX * 4))
      return { copied: false, opened: false };
    clipboard.writeText(geminiPrompt(styleRaw, ageRaw, wishRaw));
    if (!isGeminiUrl(GEMINI_URL)) return { copied: true, opened: false };
    try {
      await shell.openExternal(GEMINI_URL);
      log('maker', 'gemini', 'open', styleRaw, ageRaw);
      return { copied: true, opened: true };
    } catch (err) {
      log('maker', 'gemini', 'open failed', err instanceof Error ? err.message : String(err));
      return { copied: true, opened: false };
    }
  });

  // Gemini 에 올릴 사진: 창이 다듬어 보낸 JPEG(흰 바탕, 긴 변 1024)를 임시 폴더에 두고 파일 관리자로 보여 준다.
  // 붙여 넣은 사진처럼 파일이 없는 사진도 올릴 수 있게. 창을 닫으면 지운다
  ipcMain.handle(MAKER.revealGeminiPhoto, (e, photoRaw: unknown) => {
    if (!fromMaker(e)) return false;
    const prefix = 'data:image/jpeg;base64,';
    if (typeof photoRaw !== 'string' || !photoRaw.startsWith(prefix)) return false;
    const bytes = Buffer.from(photoRaw.slice(prefix.length), 'base64');
    if (imageKind(bytes) !== 'jpeg' || bytes.length > MAX_PNG_BYTES || !sizeOk(bytes)) return false;
    try {
      mkdirSync(geminiDir(), { recursive: true });
      const file = join(geminiDir(), GEMINI_PHOTO);
      writeFileAtomic(file, bytes);
      shell.showItemInFolder(file);
      return true;
    } catch (err) {
      log('maker', 'gemini photo', err instanceof Error ? err.message : String(err));
      return false;
    }
  });

  ipcMain.handle(MAKER.setHfToken, (e, raw: unknown) => {
    if (!fromMaker(e)) return { ok: false, has: hfToken.has() };
    try {
      const ok = hfToken.set(raw === null ? null : raw);
      return ok ? { ok, has: hfToken.has() } : { ok, has: hfToken.has(), error: t('main.illust.tokenShape') };
    } catch (err) {
      log('maker', 'hf token save failed', err instanceof Error ? err.message : String(err));
      return { ok: false, has: hfToken.has(), error: saveErrorText(err) };
    }
  });

  ipcMain.handle(MAKER.save, (e, dataUrl: string | null, name: string, lookRaw?: unknown) => {
    if (!fromMaker(e) || target === 'sprites') return { ok: false };
    // 디스크가 차거나 폴더에 쓸 수 없으면 쓰기가 던진다. 던진 채 두면 창이 "저장하는 중"에서 멈춰서 안내 글로 돌려준다
    try {
      return target === 'food' ? saveFood(dataUrl, name) : savePet(target, dataUrl, name, lookRaw);
    } catch (err) {
      log('maker', 'save failed', err instanceof Error ? err.message : String(err));
      return { ok: false, error: saveErrorText(err) };
    }
  });

  /** 이름 없이 만든 사진 펫의 이름: 지금 펫, 보관한 펫과 겹치지 않는 "찰칵이" */
  function newPhotoName(): string {
    const s = settings.get();
    return photoPetName([s.petName, ...s.petLibrary.map((p) => p.name)]);
  }

  function savePet(
    to: Exclude<MakerTarget, 'food' | 'sprites'>,
    dataUrl: string | null,
    name: string,
    lookRaw?: unknown,
  ) {
    // 펫 본 그림은 지우지 않고 보관함에 넣는다(6단계). 포즈 그림만 바꿀 때 옛 것을 지운다
    const old = to === 'main' ? undefined : settings.get().petPoses[to];
    if (dataUrl === null) {
      if (to === 'main') library.toDefault(settings.get().petKind);
      else settings.set({ petPoses: { [to]: null } });
      if (old) rmSync(join(petsDir(), old), { force: true });
      log('maker', to === 'main' ? '기본 펫으로 (보관함에 둠)' : `포즈 지움 ${to}`);
      return { ok: true };
    }
    const m = typeof dataUrl === 'string' ? /^data:image\/(png|gif|webp);base64,/.exec(dataUrl) : null;
    if (!m) return { ok: false, error: t('main.maker.badFormat') };
    const bytes = Buffer.from(dataUrl.slice(m[0].length), 'base64');
    // 머리말로 형식을 확인하고 크기를 본다 (data URL 의 형식 글자는 믿지 않는다).
    const kind = kindOf(bytes);
    const max = kind === 'png' ? MAX_PNG_BYTES : MAX_ANIMATED_BYTES;
    // 작은 파일이라도 가로세로가 터무니없으면(23000x23000) 풀 때 메모리를 몇 GB 쓴다
    if (!kind || bytes.length > max || !sizeOk(bytes)) return { ok: false, error: t('main.maker.tooBigAny') };
    mkdirSync(petsDir(), { recursive: true });
    const file = to === 'main' ? `pet-${Date.now()}.${kind}` : `pose-${to}-${Date.now()}.${kind}`;
    // 그림을 쓴 뒤 설계도, 깊이 그림, 설정 저장이 실패하면 방금 쓴 파일을 지운다 (pets/ 에 주인 없는 그림이 쌓이지 않게)
    const written: string[] = [];
    const write = (name: string, data: string | Uint8Array) => {
      writeFileAtomic(join(petsDir(), name), data);
      written.push(name);
    };
    try {
      write(file, bytes);
      // 입체 모습은 펫 본 그림에만: AI 설계도(다시 고르기를 거쳐) 또는 2.5D 깊이 그림(PNG 머리말과 크기 확인)
      const look = to === 'main' && kind === 'png' ? lookOf(lookRaw) : {};
      const modelFile = look.model ? `model-${Date.now()}.json` : undefined;
      if (look.model && modelFile) write(modelFile, JSON.stringify(look.model));
      const depthFile = look.depth ? `depth-${Date.now()}.png` : undefined;
      // AI 일러스트 나이 단계 (펫 본 그림에만, 모르는 값이면 없음)
      const age =
        to === 'main' && typeof lookRaw === 'object' && lookRaw !== null
          ? (lookRaw as Record<string, unknown>).age
          : undefined;
      if (look.depth && depthFile) write(depthFile, look.depth);
      if (to === 'main') {
        // 이름 칸을 비우면 지금 펫 이름이 아니라 새 이름 (보관함에 같은 이름이 쌓이지 않게). 보관하기 전에 정한다
        const petName = cleanPetName(name) ?? newPhotoName();
        const prep = library.newPhotoPatch();
        settings.set({
          ...prep.patch,
          petImage: file,
          petModel: modelFile ?? null,
          petDepth: depthFile ?? null,
          petAge: isAgeStage(age) ? age : null,
          petName,
          // 설계도를 만든 요청사항은 그 설계도 이름으로 (걸음새에 맞게 다시 만들 때 같은 글로)
          ...(modelFile && look.wish
            ? { petWishes: { ...settings.get().petWishes, [modelFile]: look.wish } }
            : {}),
          // 말로 만든 펫: 개인 용도 표시, 네 발로 선 피규어 (설계도 이름으로. 설정에서 바꿀 수 있다)
          ...(modelFile && look.personalOnly
            ? { petPersonal: { ...settings.get().petPersonal, [modelFile]: true } }
            : {}),
          ...(modelFile && look.stand
            ? { petStands: { ...settings.get().petStands, [modelFile]: true } }
            : {}),
          ...(modelFile && look.text
            ? { petTexts: { ...settings.get().petTexts, [modelFile]: look.text } }
            : {}),
        });
        // 저장은 끝났다: 옛 파일 치우기가 실패해도(윈도우 파일 잠김) 방금 쓴 새 펫 파일을 지우지 않는다
        try {
          prep.cleanup();
        } catch (err) {
          log('maker', '옛 파일 치우기 실패', err instanceof Error ? err.name : 'error');
        }
      } else settings.set({ petPoses: { [to]: file } });
    } catch (err) {
      for (const f of written) rmSync(join(petsDir(), f), { force: true });
      throw err;
    }
    if (old && old !== file) rmSync(join(petsDir(), old), { force: true });
    log('maker', 'saved', file, `${Math.round(bytes.length / 1024)}KB`);
    return { ok: true };
  }

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
    writeFileAtomic(join(petsDir(), file), bytes);
    const r = makeFood(name, file);
    if (!r.ok) rmSync(join(petsDir(), file), { force: true });
    log('maker', 'food', r.ok ? file : r.error);
    return r;
  }

  /** 설계도 정면 그림을 그려 줄 곳 (펫 화면, pet-window.ts shot). index 가 펫 창을 만든 뒤 넣는다 */
  let shot: ((model: Blueprint) => Promise<string | undefined>) | undefined;

  /**
   * 걸음새로 다시 만든 말로 만든 펫의 펫 그림을 새 몸으로 바꾼다. 만들기 창에서 저장할 때와 같은 PNG(바탕 없이 둘레를
   * 자른 512px)를 펫 화면에서 받아, 형식과 크기를 보고 새 파일로 한 번에 쓴다. 그사이 펫이 바뀌었거나 못 그리면 옛 그림 그대로
   */
  async function redrawFlat(model: Blueprint, modelFile: string, oldImage: string): Promise<void> {
    const png = await shot?.(model).catch(() => undefined);
    const prefix = 'data:image/png;base64,';
    if (!png?.startsWith(prefix)) return log('maker', 'remake picture', 'none');
    const bytes = Buffer.from(png.slice(prefix.length), 'base64');
    if (kindOf(bytes) !== 'png' || bytes.length > MAX_PNG_BYTES || !sizeOk(bytes))
      return log('maker', 'remake picture', 'bad');
    const now = settings.get();
    if (now.petModel !== modelFile || now.petImage !== oldImage)
      return log('maker', 'remake picture', 'changed');
    const file = `pet-${Date.now()}.png`;
    try {
      writeFileAtomic(join(petsDir(), file), bytes);
    } catch (err) {
      return log('maker', 'remake picture save failed', err instanceof Error ? err.message : String(err));
    }
    settings.set({ petImage: file });
    library.cleanup([oldImage]);
    log('maker', 'remake picture', file, `${Math.round(bytes.length / 1024)}KB`);
  }

  /** 몸 다시 만들기 (설정 창). 하나만 돈다: 새로 부르면 앞의 것을 멈춘다 */
  let remaking: AbortController | undefined;

  /**
   * 지금 사진 펫의 몸을 고른 걸음새에 맞게 다시 만든다 (설정 짝꿍 걸음새). 같은 사진, 같은 요청사항으로 AI 에 한 번 묻고
   * 새 설계도 파일로 바꾼다. 이름, 포즈, 보관함은 그대로. 옛 설계도는 아무도 안 쓰면 지운다.
   * 기다리는 사이 펫이 바뀌면(보관함에서 다른 펫, 새 펫) 결과를 버린다
   */
  async function remake(gait: Gait): Promise<{ ok: true } | { ok: false; error: string; noAi?: boolean }> {
    const s = settings.get();
    const oldModel = s.petModel;
    if (!s.petImage || !oldModel) return { ok: false, error: t('main.remake.notFigure') };
    // 말로 만든 펫은 처음 글로 다시 만든다 (펫 그림은 설계도를 그린 것이라 사진 길로 보내면 처음 글을 잃었다)
    const desc = s.petTexts[oldModel];
    const wish = s.petWishes[oldModel] ?? '';
    remaking?.abort();
    const abort = new AbortController();
    remaking = abort;
    const started = Date.now();
    let model: Blueprint | undefined;
    let provider = '';
    if (desc && textAi) {
      const r = await textAi
        .ask(describePrompt(desc, { webSearch: true, gait }), TEXT_SYSTEM, abort.signal)
        .catch((err: unknown) => {
          log('maker', 'remake text threw', err instanceof Error ? err.message : String(err));
          return { ok: false as const, error: t('main.maker.textFailed'), noAi: undefined };
        });
      if (remaking === abort) remaking = undefined;
      if (abort.signal.aborted) return { ok: false, error: t('main.maker.shapeCancelled') };
      if (!r.ok) {
        log('maker', 'remake text', r.noAi ? 'no ai' : r.error);
        return r;
      }
      provider = r.provider;
      const got = readTextAnswer(r.text, gait);
      model = got.ok ? got.bp : undefined;
    } else {
      if (!askWithImage || !s.petImage.endsWith('.png')) {
        if (remaking === abort) remaking = undefined;
        return { ok: false, error: t('main.remake.notFigure') };
      }
      const bytes = readFileIn(petsDir(), s.petImage, MAX_PNG_BYTES);
      if (!bytes || kindOf(bytes) !== 'png') {
        if (remaking === abort) remaking = undefined;
        return { ok: false, error: t('main.remake.notFigure') };
      }
      const r = await askWithImage(
        blueprintPrompt(s.petName, wish, gait),
        { mediaType: 'image/png', data: bytes.toString('base64') },
        BLUEPRINT_SYSTEM,
        abort.signal,
      );
      if (remaking === abort) remaking = undefined;
      if (abort.signal.aborted) return { ok: false, error: t('main.maker.shapeCancelled') };
      if (!r.ok) {
        log('maker', 'remake', r.noAi ? 'no ai' : r.error);
        return r;
      }
      provider = r.provider;
      model = extractBlueprint(r.text, gait);
    }
    log(
      'maker',
      'remake',
      provider,
      `${Math.round((Date.now() - started) / 1000)}s`,
      model ? `${model.parts.length} parts` : 'bad',
      gait,
      desc ? `text ${textLength(desc)}` : wish ? `wish ${[...wish].length}` : 'no wish',
    );
    if (!model) return { ok: false, error: t('main.maker.shapeBad') };
    const now = settings.get();
    if (now.petImage !== s.petImage || now.petModel !== oldModel)
      return { ok: false, error: t('main.remake.changed') };
    const file = `model-${Date.now()}.json`;
    try {
      writeFileAtomic(join(petsDir(), file), JSON.stringify(model));
    } catch (err) {
      log('maker', 'remake save failed', err instanceof Error ? err.message : String(err));
      return { ok: false, error: saveErrorText(err) };
    }
    // 새 몸은 고른 걸음새로 만들었으니 자동으로 둔다 (설계도 gait 가 고른 값). 옛 열쇠는 설정 검사가 뺀다
    settings.set({
      petModel: file,
      ...(wish ? { petWishes: { ...now.petWishes, [file]: wish } } : {}),
      // 개인 용도 표시는 새 몸에도 (말로 만든 펫. 다시 만들어도 갤러리에 못 올리는 것은 같다)
      ...(now.petPersonal[oldModel] ? { petPersonal: { ...now.petPersonal, [file]: true } } : {}),
      // 처음 글도 새 몸으로 넘긴다 (다음에 또 걸음새를 바꿔도 글로 만든다)
      ...(desc ? { petTexts: { ...now.petTexts, [file]: desc } } : {}),
    });
    library.cleanup([oldModel]);
    // 말로 만든 펫의 펫 그림은 설계도를 그린 것이라 옛 몸 그대로 남았다 (평면 보기, 보관함). 새 몸으로 다시 그린다.
    // 사진 펫은 펫 그림이 사진 자체라(몸은 그 사진에서 만든다) 그대로 둔다
    if (desc) await redrawFlat(model, file, s.petImage);
    return { ok: true };
  }

  ipcMain.on(MAKER.close, (e) => {
    if (fromMaker(e)) win?.close();
  });

  // 2D 그림 세트 만들기 (#89). 그림 세트는 이 그림(petImage)의 것: 만드는 사이 페어리가 바뀌면 저장하지 않는다
  let spriteFor: string | undefined;
  /** 개발 시험은 __jj.maker.debugSpriteFetch 로 가짜 Space 를 넣는다 (진짜 무료 횟수를 쓰지 않게) */
  let spriteFetch: FetchLike | undefined;
  /**
   * 개발 시험은 __jj.maker.debugSpriteLocal 로 가짜 내 컴퓨터 엔진(준비 상태와 그리기)을 넣는다.
   * 진짜 mflux, sd.cpp 를 돌리거나 모델을 받지 않게
   */
  let spriteLocal: { info?: LocalDrawInfo; draw?: LocalStripDraw } | undefined;
  /** 개발 시험은 __jj.maker.debugSpriteOut 으로 클립보드, 브라우저 열기, 파일 관리자 보이기를 가로챈다 */
  let spriteOut:
    | {
        copy?: (text: string) => void;
        open?: (url: string) => Promise<void>;
        reveal?: (file: string) => void;
      }
    | undefined;
  const spriteLocalInfo = (): LocalDrawInfo => spriteLocal?.info ?? localDrawInfo();
  ipcMain.handle(MAKER.spriteSource, (e): SpriteSource | undefined => {
    if (!fromMaker(e) || target !== 'sprites') return undefined;
    const s = settings.get();
    spriteFor = s.petImage ?? undefined;
    return {
      image: s.petImage ? dataUrlOf(s.petImage) : null,
      name: s.petName,
      hasSprites: !!s.petSprites,
      hfToken: hfToken.has(),
      localDraw: spriteLocalInfo(),
    };
  });

  /** 창이 보낸 기준 그림 (배경색 위 PNG data URL) 검사. 안 맞으면 undefined */
  function spriteRef(refRaw: unknown): Buffer | undefined {
    const prefix = 'data:image/png;base64,';
    if (typeof refRaw !== 'string' || !refRaw.startsWith(prefix)) return undefined;
    const ref = Buffer.from(refRaw.slice(prefix.length), 'base64');
    if (kindOf(ref) !== 'png' || ref.length > MAX_PNG_BYTES || !sizeOk(ref)) return undefined;
    return ref;
  }

  // 동작 하나 = 무료 Space 한 번, 또는 내 컴퓨터에서 한 번 (2026-10-15). 기준 그림(지금 페어리 그림을 배경색 위에 놓은 PNG)만 보낸다.
  // 그림, 요청문, 토큰은 기록에 남기지 않는다
  ipcMain.handle(
    MAKER.spriteRow,
    async (
      e,
      rowRaw: unknown,
      refRaw: unknown,
      keyRaw: unknown,
      engineRaw?: unknown,
    ): Promise<SpriteRowResult> => {
      const failed = (kind: IllustErrorKind | 'reopen' | 'format'): SpriteRowResult => ({
        ok: false,
        kind,
        error:
          kind === 'reopen'
            ? t('main.maker.reopen')
            : kind === 'format'
              ? t('main.maker.badFormat')
              : spriteText(kind),
      });
      if (!fromMaker(e) || target !== 'sprites') return failed('reopen');
      const key = KEY_COLORS.find((k) => keyHex(k) === keyRaw);
      const row = isRowId(rowRaw) ? rowOf(rowRaw) : undefined;
      const engine = engineRaw == null ? 'cloud' : illustEngineOf(engineRaw);
      if (!row || !key || !engine) return failed('format');
      const ref = spriteRef(refRaw);
      if (!ref) return failed('format');
      drawing?.abort();
      const abort = new AbortController();
      drawing = abort;
      const started = Date.now();
      if (engine === 'local') {
        try {
          // 준비가 안 됐으면 그리지 않는다 (준비는 사진으로 만들기 창에서. 여기서 새로 받지 않는다)
          if (!spriteLocalInfo().ready) throw new LocalDrawError('notReady');
          const r = await drawStripLocal(
            spriteLocal?.draw ?? ((photo, kind, prompt, o) => illustrateLocal(photo, kind, prompt, o)),
            ref,
            row,
            key,
            {
              signal: abort.signal,
              onProgress: (ratio) => {
                if (win && !win.isDestroyed()) win.webContents.send(MAKER.progress, ratio);
              },
              log,
            },
          );
          // 그만둔 뒤 끝난 그림은 쓰지 않는다 (hf-illust.ts 와 같다)
          if (abort.signal.aborted) throw new LocalDrawError('cancelled');
          log(
            'maker',
            'sprite row',
            row.id,
            'local',
            `${Math.round((Date.now() - started) / 1000)}s`,
            `${Math.round(r.bytes.length / 1024)}KB`,
          );
          return { ok: true, image: dataUrlFrom(r.bytes, r.kind) };
        } catch (err) {
          // 그만두기로 멈췄으면 엔진이 무엇을 던졌든 그만두기 (남은 동작을 기다림으로 둔다)
          const k: LocalDrawErrorKind = abort.signal.aborted
            ? 'cancelled'
            : err instanceof LocalDrawError
              ? err.kind
              : 'failed';
          log(
            'maker',
            'sprite row',
            row.id,
            'local',
            k,
            err instanceof LocalDrawError ? '' : err instanceof Error ? err.message : String(err),
          );
          return { ok: false, kind: k, error: localDrawText(k, 'draw'), localDraw: spriteLocalInfo() };
        } finally {
          if (drawing === abort) drawing = undefined;
        }
      }
      try {
        const r = await drawStrip(ref, row, key, {
          fetch: spriteFetch ?? mainFetch,
          token: hfToken.get(),
          signal: abort.signal,
          log,
        });
        log(
          'maker',
          'sprite row',
          row.id,
          `${Math.round((Date.now() - started) / 1000)}s`,
          `${Math.round(r.bytes.length / 1024)}KB`,
        );
        return { ok: true, image: dataUrlFrom(r.bytes, r.kind) };
      } catch (err) {
        const k = err instanceof IllustError ? err.kind : 'busy';
        log(
          'maker',
          'sprite row',
          row.id,
          k,
          err instanceof IllustError ? '' : err instanceof Error ? err.message : String(err),
        );
        return failed(k);
      } finally {
        if (drawing === abort) drawing = undefined;
      }
    },
  );

  // 동작 하나만 Gemini 앱으로 (2026-10-15): 요청문은 메인이 동작과 배경색으로 만들어 클립보드에 넣는다 (창이 보낸 글을 넣지 않는다).
  // 여는 주소는 gemini.google.com/app 하나뿐. 기준 그림은 사용자가 올리고, 받은 그림은 창이 자르고 검사한다
  ipcMain.handle(MAKER.spriteGemini, async (e, rowRaw: unknown, keyRaw: unknown) => {
    if (!fromMaker(e) || target !== 'sprites') return { copied: false, opened: false };
    const key = KEY_COLORS.find((k) => keyHex(k) === keyRaw);
    const row = isRowId(rowRaw) ? rowOf(rowRaw) : undefined;
    if (!row || !key) return { copied: false, opened: false };
    try {
      (spriteOut?.copy ?? ((text: string) => clipboard.writeText(text)))(geminiStripPrompt(row, key));
    } catch {
      return { copied: false, opened: false };
    }
    if (!isGeminiUrl(GEMINI_URL)) return { copied: true, opened: false };
    try {
      await (spriteOut?.open ?? ((url: string) => shell.openExternal(url)))(GEMINI_URL);
      log('maker', 'gemini', 'sprite row', row.id);
      return { copied: true, opened: true };
    } catch (err) {
      log('maker', 'gemini', 'open failed', err instanceof Error ? err.message : String(err));
      return { copied: true, opened: false };
    }
  });

  // Gemini 에 올릴 기준 그림: 창이 보낸 PNG(배경색 위 지금 페어리 그림)를 임시 폴더에 두고 파일 관리자로 보여 준다. 창을 닫으면 지운다
  ipcMain.handle(MAKER.revealSpriteRef, (e, refRaw: unknown) => {
    if (!fromMaker(e) || target !== 'sprites') return false;
    const ref = spriteRef(refRaw);
    if (!ref) return false;
    try {
      mkdirSync(geminiDir(), { recursive: true });
      const file = join(geminiDir(), GEMINI_SPRITE_REF);
      writeFileAtomic(file, ref);
      (spriteOut?.reveal ?? ((f: string) => shell.showItemInFolder(f)))(file);
      return true;
    } catch (err) {
      log('maker', 'gemini sprite ref', err instanceof Error ? err.message : String(err));
      return false;
    }
  });

  ipcMain.handle(MAKER.saveSprites, (e, raw: unknown) => {
    if (!fromMaker(e) || target !== 'sprites') return { ok: false, error: t('main.maker.reopen') };
    const s = settings.get();
    if (!s.petImage || s.petImage !== spriteFor) return { ok: false, error: t('main.sprites.changed') };
    // .fairy 가져오기와 같은 검사 (PNG 만, 한 장 512KB, 같은 크기, 합 4MB, 서기 꼭)
    const clean = cleanSprites(raw);
    if (!clean) return { ok: false, error: t('main.sprites.bad') };
    try {
      return saveSpriteSet(clean);
    } catch (err) {
      log('maker', 'sprites save failed', err instanceof Error ? err.message : String(err));
      return { ok: false, error: saveErrorText(err) };
    }
  });

  ipcMain.on(MAKER.openSprites, (e) => {
    if (fromMaker(e) && target === 'main' && settings.get().petImage) open('sprites');
  });

  /** 검사한 그림 세트(data URL)를 pets/ 의 sprite-*.png 로 쓰고 지금 페어리 것으로. 옛 세트 파일은 쓰는 곳이 없으면 지운다 */
  function saveSpriteSet(sprites: PetSprites) {
    mkdirSync(petsDir(), { recursive: true });
    const stamp = Date.now();
    const files: PetSprites = {};
    const written: string[] = [];
    try {
      for (const [name, url] of Object.entries(sprites) as [keyof PetSprites, string][]) {
        const file = `sprite-${stamp}-${name}.png`;
        writeFileAtomic(join(petsDir(), file), Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
        written.push(file);
        files[name] = file;
      }
      const old = spriteFiles(settings.get().petSprites);
      settings.set({ petSprites: files });
      try {
        library.cleanup(old);
      } catch (err) {
        log('maker', '옛 그림 세트 치우기 실패', err instanceof Error ? err.name : 'error');
      }
    } catch (err) {
      for (const f of written) rmSync(join(petsDir(), f), { force: true });
      throw err;
    }
    log('maker', 'sprites saved', `${written.length}`);
    return { ok: true };
  }

  // 진행 표시의 그만두기: 받는 중인 모델과 AI 에 묻는 중인 입체를 멈춘다. 멈춘 일은 각자 실패로 끝난다
  ipcMain.on(MAKER.cancel, (e) => {
    if (!fromMaker(e)) return;
    download?.abort();
    shaping?.abort();
    drawing?.abort();
  });

  /** 펫 본 그림(main)이나 상태별 포즈를 만든다. 다른 것을 만드는 창이 열려 있으면 다시 연다 */
  function open(next: MakerTarget = 'main') {
    if (win && !win.isDestroyed()) {
      if (target === next) {
        focusWindow(win);
        return;
      }
      // 다시 불러오면 앞 화면이 기다리던 일은 받을 곳이 없다. 그림 그리기(하루 무료 횟수)와 입체, 모델 받기를 멈춘다
      download?.abort();
      shaping?.abort();
      drawing?.abort();
      target = next;
      win.reload();
      focusWindow(win);
      return;
    }
    target = next;
    // 닫을 때 크기와 자리를 기억해 다음에 그대로 연다. 처음이면 화면 가운데 (window-bounds.ts)
    win = openRemembered('maker', {
      size: { width: 560, height: 660 },
      min: { width: 460, height: 560 },
      options: {
        title: t('main.maker.title'),
        show: false,
        ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const } : {}),
        webPreferences: {
          preload: join(import.meta.dirname, '../preload/index.cjs'),
          additionalArguments: ['--jj-window=maker', langArg()],
          sandbox: true,
          contextIsolation: true,
        },
      },
    });
    win.once('ready-to-show', () => showWindow(win));
    win.on('closed', () => {
      download?.abort();
      shaping?.abort();
      drawing?.abort();
      win = undefined;
      // Gemini 에 올리려고 꺼내 둔 사진을 치운다
      try {
        rmSync(geminiDir(), { recursive: true, force: true });
      } catch {
        // 윈도우에서 파일이 열려 있으면 실패할 수 있다. 다음에 덮어쓴다
      }
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (ev) => ev.preventDefault());
    const devUrl = devRendererUrl();
    if (devUrl) win.loadURL(`${devUrl}/maker.html`);
    else win.loadFile(join(import.meta.dirname, '../renderer/maker.html'));
  }

  return {
    open,
    remake,
    /**
     * 개발용 (__jj): 말로 만들기에 가짜 AI 를 넣는다. 답할 글을 돌려주는 함수, undefined 면 원래 AI 로.
     * 시험이 진짜 AI 를 부르지 않게 한다. 설치한 앱에서는 __jj 가 없어 부를 수 없다
     */
    debugTextAi(answer?: (prompt: string) => string | Promise<string>) {
      textAi = answer
        ? {
            has: async () => true,
            ask: async (prompt) => ({ ok: true, text: await answer(prompt), provider: 'stub' }),
          }
        : ai?.text;
    },
    /** 개발용 (__jj): 2D 그림 세트 띠를 받을 가짜 fetch. undefined 면 진짜 Space 로. 설치한 앱에서는 부를 수 없다 */
    debugSpriteFetch(fetch?: FetchLike) {
      spriteFetch = fetch;
    },
    /**
     * 개발용 (__jj): 2D 그림 세트의 내 컴퓨터 엔진을 가짜로. info 는 준비 상태(없으면 진짜 값), draw 는 그리기
     * (없으면 진짜 엔진). undefined 면 둘 다 진짜로. 진짜 mflux, sd.cpp 를 돌리지 않고 경우를 시험한다
     */
    debugSpriteLocal(fake?: { info?: LocalDrawInfo; draw?: LocalStripDraw }) {
      spriteLocal = fake;
    },
    /** 개발용 (__jj): 그림 세트 Gemini 길의 클립보드, 브라우저 열기, 파일 보이기를 가로챈다 (시험이 진짜 브라우저를 열지 않게) */
    debugSpriteOut(fake?: typeof spriteOut) {
      spriteOut = fake;
    },
    /** 펫 화면의 설계도 정면 그림 (걸음새로 다시 만든 말로 만든 펫의 새 펫 그림) */
    useShot(fn: (model: Blueprint) => Promise<string | undefined>) {
      shot = fn;
    },
    /** 다시 만들기를 멈춘다 (설정 창의 그만두기, 창 닫기) */
    cancelRemake: () => remaking?.abort(),
    get window() {
      return win;
    },
  };
}

/** Gemini 에 올릴 사진을 잠깐 두는 폴더와 이름 */
const geminiDir = () => join(app.getPath('temp'), 'jjakkung-gemini');
const GEMINI_PHOTO = 'jjakkung-pet-photo.jpg';
/** 그림 세트 Gemini 길에 올릴 기준 그림 이름 */
const GEMINI_SPRITE_REF = 'jjakkung-fairy-reference.png';

/** 일러스트 실패 종류마다 화면 글 */
function illustText(kind: IllustErrorKind): string {
  switch (kind) {
    case 'quota':
      // 쿼터는 사용자(인터넷 연결)마다 따로, 하루면 다시 찬다. Gemini 앱, 토큰, (되면) 내 컴퓨터에서 그리기를 권한다
      if (hfToken.has()) return t('main.illust.quotaToken');
      return t(localDrawInfo().supported ? 'main.illust.quotaLocal' : 'main.illust.quota');
    case 'limit':
      return t(hfToken.has() ? 'main.illust.down' : 'main.illust.limit');
    case 'auth':
      return t('main.illust.auth');
    case 'refused':
      if (hfToken.has()) return t('main.illust.refusedToken');
      return t(localDrawInfo().supported ? 'main.illust.refusedLocal' : 'main.illust.refused');
    case 'network':
      return t('main.illust.offline');
    case 'timeout':
      return t('main.illust.timeout');
    case 'cancelled':
      return t('main.illust.cancelled');
    case 'same':
    case 'bad':
      return t('main.illust.bad');
    default:
      return t('main.illust.down');
  }
}

/**
 * 2D 그림 세트 띠 실패 종류마다 화면 글. 무료 횟수가 끝났으면 이어 갈 길을 붙인다:
 * 내 컴퓨터에서 그리기는 이 컴퓨터가 될 때만, Gemini 는 늘, 토큰은 아직 없을 때만
 */
function spriteText(kind: IllustErrorKind): string {
  if (kind !== 'quota' && kind !== 'refused') return illustText(kind);
  const token = hfToken.has();
  const head =
    kind === 'quota'
      ? t(token ? 'main.sprites.quotaToken' : 'main.sprites.quota')
      : t(token ? 'main.sprites.refusedToken' : 'main.sprites.refused');
  const next = t(localDrawInfo().supported ? 'main.sprites.nextLocal' : 'main.sprites.nextGemini');
  return token ? `${head} ${next}` : `${head} ${next} ${t('main.sprites.nextToken')}`;
}

/** 내 컴퓨터에서 그리기 실패 종류마다 화면 글. 준비와 그리기에서 멈춤 글만 다르다. gb 는 이번 준비에 필요한 빈 공간 */
function localDrawText(kind: LocalDrawErrorKind, phase: 'setup' | 'draw', gb?: number): string {
  switch (kind) {
    case 'unsupported': {
      // 로제타로 도는 인텔용 앱이면 Apple 칩용을 깔면 된다
      const pick = localDrawSupport();
      return t(
        !pick.ok && pick.reason === 'rosetta' ? 'main.localDraw.rosetta' : 'main.localDraw.unsupported',
      );
    }
    case 'notReady':
      return t('main.localDraw.notReady');
    case 'busy':
      return t('main.localDraw.busy');
    case 'disk':
      return phase === 'setup'
        ? t('main.localDraw.diskSetup', { gb: gb ?? localDrawInfo().need?.free ?? LOCAL_DRAW_GB.free })
        : t('main.localDraw.disk');
    case 'offline':
      return t('main.localDraw.offline');
    case 'memory':
      return t('main.localDraw.memory');
    case 'battery':
      return t('main.localDraw.battery');
    case 'timeout':
      return t('main.localDraw.timeout');
    case 'cancelled':
      return t(phase === 'setup' ? 'main.localDraw.setupCancelled' : 'main.illust.cancelled');
    case 'bad':
      return t('main.localDraw.bad');
    default:
      return t(phase === 'setup' ? 'main.localDraw.setupFailed' : 'main.localDraw.failed');
  }
}

/** 그림 바이트를 data URL 로 (머리말로 본 형식) */
function dataUrlFrom(bytes: Uint8Array, kind: ImageKind): string {
  const mime = kind === 'jpeg' ? 'image/jpeg' : `image/${kind}`;
  return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
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
