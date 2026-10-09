import { mkdirSync, rmSync } from 'node:fs';
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
import { downloadErrorText, saveErrorText } from '../shared/download-error.ts';
import { t } from '../shared/i18n/index.ts';
import { ILLUST_WISH_MAX, illustratePrompt, isAgeStage } from '../shared/illustrate.ts';
import {
  DEPTH_URL,
  MAKER,
  type MakerInfo,
  type MakerTarget,
  MODEL_SCHEME,
  MODEL_URL,
  type PetImages,
} from '../shared/ipc.ts';
import { type Blueprint, type Gait, parseBlueprint } from '../shared/pet3d/blueprint.ts';
import {
  BLUEPRINT_SYSTEM,
  blueprintPrompt,
  cleanWish,
  extractBlueprint,
  WISH_MAX,
} from '../shared/pet3d/prompt.ts';
import { cleanPetName, isGait, POSE_KINDS, photoPetName } from '../shared/settings.ts';
import { CUSTOM_FOOD_COST } from '../shared/shop.ts';
import { BG_MODEL, ensureModel, modelReady, verifiedModelUrl } from './bg-model.ts';
import { DEPTH_MODEL, depthReady, ensureDepthModel, verifiedDepthUrl } from './depth-model.ts';
import { focusWindow, showWindow, stealFocus } from './focus.ts';
import { IllustError, type IllustErrorKind, illustrate, imageKind } from './hf-illust.ts';
import { hfToken } from './hf-token.ts';
import { langArg } from './lang.ts';
import { library } from './pet-library.ts';
import { readFileIn, writeFileAtomic } from './safe-file.ts';
import { settings } from './settings.ts';
import { rememberBounds, savedBounds } from './window-bounds.ts';

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
    ...(s.petImage && s.petAge ? { age: s.petAge } : {}),
  };
}

/** 깊이 그림 상한. 화면에서 256px 회색 PNG 로 보낸다 */
const MAX_DEPTH_BYTES = 1024 * 1024;

/**
 * 저장할 입체 모습을 고른다. 설계도는 다시 검사하고, 깊이 그림은 PNG 인지와 크기를 본다.
 * 설계도와 같이 온 요청사항(그 설계도를 만든 글)은 다듬어 둔다 (걸음새에 맞게 다시 만들 때 쓴다)
 */
function lookOf(raw: unknown): { model?: Blueprint; depth?: Buffer; wish?: string } {
  if (typeof raw !== 'object' || raw === null) return {};
  const r = raw as Record<string, unknown>;
  const model = parseBlueprint(r.model);
  if (model) {
    const wish = typeof r.wish === 'string' && r.wish.length <= WISH_MAX * 4 ? cleanWish(r.wish) : '';
    return wish ? { model, wish } : { model };
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

/** AI 한 번 묻기 (chat.oneShot) */
export type AskWithImage = (
  text: string,
  image: ImageAttachment,
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
  ai?: { ask: AskWithImage; hasVision: () => Promise<boolean> },
) {
  const askWithImage = ai?.ask;
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
            hfToken: hfToken.has(),
          }
        : undefined,
  );

  ipcMain.handle(MAKER.visionAi, async (e) => fromMaker(e) && target === 'main' && !!(await ai?.hasVision()));

  ipcMain.handle(MAKER.ensureDepth, async (e) => {
    if (!fromMaker(e)) return { ok: false, error: t('main.maker.reopen') };
    const ac = new AbortController();
    download = ac;
    try {
      await ensureDepthModel((ratio) => {
        if (win && !win.isDestroyed()) win.webContents.send(MAKER.progress, ratio);
      }, ac.signal);
      return { ok: true };
    } catch (err) {
      // 원문(net::ERR_..., ENOSPC ...)은 기록에만. 화면에는 할 일을 알려 주는 글
      log('maker', 'depth model', err instanceof Error ? err.message : String(err));
      const mb = Math.round(DEPTH_MODEL.bytes / 1_000_000);
      return { ok: false, error: downloadErrorText(err, { aborted: ac.signal.aborted, mb }) };
    } finally {
      download = undefined;
    }
  });

  ipcMain.handle(MAKER.ensureModel, async (e) => {
    if (!fromMaker(e)) return { ok: false, error: t('main.maker.reopen') };
    const ac = new AbortController();
    download = ac;
    try {
      await ensureModel((ratio) => {
        if (win && !win.isDestroyed()) win.webContents.send(MAKER.progress, ratio);
      }, ac.signal);
      return { ok: true };
    } catch (err) {
      // 원문(net::ERR_..., ENOSPC ...)은 기록에만. 화면에는 할 일을 알려 주는 글
      log('maker', 'model', err instanceof Error ? err.message : String(err));
      const mb = Math.round(BG_MODEL.bytes / 1_000_000);
      return { ok: false, error: downloadErrorText(err, { aborted: ac.signal.aborted, mb }) };
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
    const model = extractBlueprint(r.text, gait);
    log(
      'maker',
      'shape3d',
      r.provider,
      `${Math.round((Date.now() - started) / 1000)}s`,
      model ? `${model.parts.length} parts` : 'bad',
      // 요청 글은 기록에 남기지 않고 길이만
      wish ? `wish ${[...wish].length}` : 'no wish',
      gait ?? 'gait auto',
    );
    return model ? { ok: true, model } : { ok: false, error: t('main.maker.shapeBad') };
  });

  // AI 일러스트 (2026-10-09): 사용자가 고를 때만 사진을 Hugging Face 무료 Space 로 보낸다. 사진, 요청문, 토큰은 기록에 남기지 않는다
  ipcMain.handle(MAKER.illustrate, async (e, photoRaw: unknown, ageRaw: unknown, wishRaw?: unknown) => {
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
    try {
      const r = await illustrate(
        photo,
        kind === 'png' ? 'image/png' : 'image/jpeg',
        illustratePrompt(ageRaw, wishRaw),
        {
          // 운영체제 프록시를 따르는 Electron fetch
          fetch: (url, init) => net.fetch(url, init),
          token: hfToken.get(),
          signal: abort.signal,
          log,
        },
      );
      const mime = r.kind === 'jpeg' ? 'image/jpeg' : `image/${r.kind}`;
      log('maker', 'illust', r.space, ageRaw, `${Math.round(r.bytes.length / 1024)}KB`);
      return { ok: true as const, image: `data:${mime};base64,${Buffer.from(r.bytes).toString('base64')}` };
    } catch (err) {
      const k = err instanceof IllustError ? err.kind : 'busy';
      if (!(err instanceof IllustError))
        log('maker', 'illust', err instanceof Error ? err.message : String(err));
      return failed(k);
    } finally {
      if (drawing === abort) drawing = undefined;
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
    if (!fromMaker(e)) return { ok: false };
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
    to: Exclude<MakerTarget, 'food'>,
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
    if (!kind || bytes.length > max) return { ok: false, error: t('main.maker.tooBigAny') };
    mkdirSync(petsDir(), { recursive: true });
    const file = to === 'main' ? `pet-${Date.now()}.${kind}` : `pose-${to}-${Date.now()}.${kind}`;
    writeFileAtomic(join(petsDir(), file), bytes);
    // 입체 모습은 펫 본 그림에만: AI 설계도(다시 고르기를 거쳐) 또는 2.5D 깊이 그림(PNG 머리말과 크기 확인)
    const look = to === 'main' && kind === 'png' ? lookOf(lookRaw) : {};
    const modelFile = look.model ? `model-${Date.now()}.json` : undefined;
    if (look.model && modelFile) writeFileAtomic(join(petsDir(), modelFile), JSON.stringify(look.model));
    const depthFile = look.depth ? `depth-${Date.now()}.png` : undefined;
    // AI 일러스트 나이 단계 (펫 본 그림에만, 모르는 값이면 없음)
    const age =
      to === 'main' && typeof lookRaw === 'object' && lookRaw !== null
        ? (lookRaw as Record<string, unknown>).age
        : undefined;
    if (look.depth && depthFile) writeFileAtomic(join(petsDir(), depthFile), look.depth);
    if (to === 'main') {
      // 이름 칸을 비우면 지금 펫 이름이 아니라 새 이름 (보관함에 같은 이름이 쌓이지 않게). 보관하기 전에 정한다
      const petName = cleanPetName(name) ?? newPhotoName();
      library.beforeNewPhoto();
      settings.set({
        petImage: file,
        petModel: modelFile ?? null,
        petDepth: depthFile ?? null,
        petAge: isAgeStage(age) ? age : null,
        petName,
        // 설계도를 만든 요청사항은 그 설계도 이름으로 (걸음새에 맞게 다시 만들 때 같은 글로)
        ...(modelFile && look.wish
          ? { petWishes: { ...settings.get().petWishes, [modelFile]: look.wish } }
          : {}),
      });
    } else settings.set({ petPoses: { [to]: file } });
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
    if (!askWithImage || !s.petImage || !oldModel || !s.petImage.endsWith('.png'))
      return { ok: false, error: t('main.remake.notFigure') };
    const bytes = readFileIn(petsDir(), s.petImage, MAX_PNG_BYTES);
    if (!bytes || kindOf(bytes) !== 'png') return { ok: false, error: t('main.remake.notFigure') };
    const wish = s.petWishes[oldModel] ?? '';
    remaking?.abort();
    const abort = new AbortController();
    remaking = abort;
    const started = Date.now();
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
    const model = extractBlueprint(r.text, gait);
    log(
      'maker',
      'remake',
      r.provider,
      `${Math.round((Date.now() - started) / 1000)}s`,
      model ? `${model.parts.length} parts` : 'bad',
      gait,
      wish ? `wish ${[...wish].length}` : 'no wish',
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
    });
    library.cleanup([oldModel]);
    return { ok: true };
  }

  ipcMain.on(MAKER.close, (e) => {
    if (fromMaker(e)) win?.close();
  });

  // 진행 표시의 그만두기: 받는 중인 모델과 AI 에 묻는 중인 입체를 멈춘다. 멈춘 일은 각자 실패로 끝난다
  ipcMain.on(MAKER.cancel, (e) => {
    if (!fromMaker(e)) return;
    download?.abort();
    shaping?.abort();
    drawing?.abort();
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
    // 닫을 때 크기와 자리를 기억해 다음에 그대로 연다. 처음이면 화면 가운데 (window-bounds.ts)
    const min = { width: 460, height: 560 };
    win = new BrowserWindow({
      width: 560,
      height: 660,
      ...savedBounds('maker', min),
      minWidth: min.width,
      minHeight: min.height,
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
    rememberBounds(win, 'maker', true);
    win.once('ready-to-show', () => showWindow(win));
    win.on('closed', () => {
      download?.abort();
      shaping?.abort();
      drawing?.abort();
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
    remake,
    /** 다시 만들기를 멈춘다 (설정 창의 그만두기, 창 닫기) */
    cancelRemake: () => remaking?.abort(),
    get window() {
      return win;
    },
  };
}

/** 일러스트 실패 종류마다 화면 글 */
function illustText(kind: IllustErrorKind): string {
  switch (kind) {
    case 'quota':
      return t(hfToken.has() ? 'main.illust.quotaToken' : 'main.illust.quota');
    case 'limit':
      return t(hfToken.has() ? 'main.illust.down' : 'main.illust.limit');
    case 'auth':
      return t('main.illust.auth');
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

/** 커스텀 먹이 그림 (data URL). 없으면 빈 글 */
export function foodImageDataUrl(file: string | undefined): string {
  if (!file || !/^food-\d+\.png$/.test(file)) return '';
  return dataUrlOf(file) ?? '';
}

/** 커스텀 먹이를 지울 때 그림 파일도 지운다 */
export function removeFoodImage(file: string | undefined): void {
  if (file && /^food-\d+\.png$/.test(file)) rmSync(join(petsDir(), file), { force: true });
}
