// 만든 펫 보관함 (6단계). 사진 펫을 새로 만들거나 기본 펫으로 바꿔도 옛 펫을 지우지 않고 보관했다가 다시 꺼낸다.
// 파일(그림, 입체 설계도, 깊이 그림, 포즈)은 pets/ 에 그대로 두고 설정에는 이름만 적는다.
import { closeSync, openSync, readFileSync, readSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { app, nativeImage } from 'electron';
import { sizeOk } from '../shared/image-head.ts';
import type { PetLookView, SavedPetView, StarterView } from '../shared/ipc.ts';
import type { PetMeta } from '../shared/pet-share.ts';
import { type Blueprint, parseBlueprint } from '../shared/pet3d/blueprint.ts';
import { LIBRARY_MAX, type PetKind, type SavedPet, type Settings } from '../shared/settings.ts';
import { isStarterName, STARTER_PETS, type StarterId, starterOf } from '../shared/starter-pets.ts';
import { readFileIn, safeFileIn } from './safe-file.ts';
import { settings } from './settings.ts';
import { copyStarter, readStarter } from './starter-copy.ts';

const petsDir = () => join(app.getPath('userData'), 'pets');
/** 앱에 든 기본 캐릭터 그림 (밀크, 초코). 설치판은 app.asar 안 resources/pets (tray.png 와 같은 자리) */
const startersDir = () => join(app.getAppPath(), 'resources', 'pets');
const THUMB_PX = 160;
/** 줄이지 못한 그림은 이보다 작을 때만 그대로 보낸다 (설정 창에 수백 MB 를 넘기지 않게) */
// 움직이는 그림(gif, webp)은 nativeImage 가 못 풀어 파일 그대로 보낸다. 2MB 까지 (예전 512KB 라 대부분 빈칸이었다.
// 더 크면 보관함 12마리가 설정 창에 백 MB 넘게 넘어간다)
const RAW_THUMB_MAX = 2 * 1024 * 1024;
/** 깊이 그림 상한. 펫 만들기가 저장할 때와 같다 (maker.ts lookOf) */
const MAX_DEPTH_BYTES = 1024 * 1024;
/** 설계도 파일 상한. 부품 40개면 10KB 안팎이라 넉넉하다 */
const MAX_MODEL_BYTES = 256 * 1024;

type PetFiles = Pick<SavedPet, 'image' | 'model' | 'depth' | 'poses'>;

function files(p: Partial<PetFiles>): string[] {
  return [p.image, p.model, p.depth, ...Object.values(p.poses ?? {})].filter((f): f is string => !!f);
}

/** 설정이 아직 가리키는 파일 (지금 펫, 보관함, 친구) */
function inUse(s: Settings, lib: SavedPet[]): Set<string> {
  const used = new Set<string>([
    ...files({ image: s.petImage, model: s.petModel, depth: s.petDepth, poses: s.petPoses }),
    ...lib.flatMap(files),
  ]);
  for (const f of s.friends) for (const x of [f.image, f.model, f.depth]) if (x) used.add(x);
  return used;
}

/** 아무도 안 쓰는 파일만 지운다. 설정을 바꾼 뒤에 부른다 */
function removeUnused(list: string[]) {
  const s = settings.get();
  const used = inUse(s, s.petLibrary);
  for (const f of list) if (!used.has(f)) rmSync(join(petsDir(), f), { force: true });
}

/** 지금 사진 펫을 보관함 맨 앞에 넣은 목록. 고를 펫(skip)은 먼저 빼고 자른다. 넘친 것은 dropped 로 */
function archiveCurrent(skip?: string): { list: SavedPet[]; dropped: SavedPet[] } {
  const s = settings.get();
  const rest = s.petLibrary.filter((p) => p.id !== skip);
  if (!s.petImage) return { list: rest, dropped: [] };
  // 손대지 않은 밀크, 초코 복사본은 보관하지 않는다 (다시 고르면 새로 복사된다. 보관함에 같은 그림이 쌓이지 않게)
  if (untouchedStarter(s))
    return { list: rest, dropped: [{ id: '', name: s.petName, image: s.petImage, poses: {} }] };
  const saved: SavedPet = {
    id: `p-${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`,
    name: s.petName,
    image: s.petImage,
    ...(s.petModel ? { model: s.petModel } : {}),
    ...(s.petDepth ? { depth: s.petDepth } : {}),
    ...(s.petAge ? { age: s.petAge } : {}),
    poses: { ...s.petPoses },
    ...(s.petMeta ? { meta: s.petMeta } : {}),
  };
  const next = [saved, ...rest];
  return { list: next.slice(0, LIBRARY_MAX), dropped: next.slice(LIBRARY_MAX) };
}

const NO_POSES = { happy: null, sleepy: null, hungry: null };

/** 지금 펫이 고른 그대로의 밀크, 초코인지: 이름, 입체 피규어, 깊이 그림, 포즈 어느 것도 손대지 않았다 */
function untouchedStarter(s: Settings): boolean {
  const id = starterOf(s.petImage);
  if (!id || s.petModel || s.petDepth || Object.values(s.petPoses).some(Boolean)) return false;
  return isStarterName(id, s.petName);
}

export const library = {
  /** 펫 만들기에서 새 사진 펫을 저장하기 직전: 지금 펫을 보관하고 포즈는 비운다 (포즈는 옛 펫 것) */
  /**
   * 새 사진 펫을 넣기 전: 지금 펫을 보관함에 넣는 설정 조각과, 저장이 된 뒤 지울 파일 치우기.
   * 새 펫 설정과 한 번에 저장한다 (두 번 나눠 쓰다 둘째가 실패하면 보관함만 바뀌고 포즈는 지워진 채 남았다)
   */
  newPhotoPatch(): {
    patch: { petLibrary: Settings['petLibrary']; petPoses: typeof NO_POSES; petMeta: null };
    cleanup: () => void;
  } {
    const old = settings.get().petPoses;
    const { list, dropped } = archiveCurrent();
    return {
      // 새 펫은 직접 만든 것: 옛 펫 이름표(만든 사람, 허락)는 보관함으로만 간다 (펫 파일에서 데려오면 adoptPet 이 다시 채운다)
      patch: { petLibrary: list, petPoses: NO_POSES, petMeta: null },
      cleanup: () =>
        removeUnused([...dropped.flatMap(files), ...Object.values(old).filter((f): f is string => !!f)]),
    };
  },

  /** 기본 펫으로: 지금 사진 펫은 보관하고 고른 모양으로 */
  toDefault(kind: PetKind): void {
    const s = settings.get();
    const old = files({ image: s.petImage, model: s.petModel, depth: s.petDepth });
    const oldPoses = Object.values(s.petPoses).filter((f): f is string => !!f);
    const { list, dropped } = archiveCurrent();
    settings.set({
      petLibrary: list,
      petKind: kind,
      petImage: null,
      petModel: null,
      petDepth: null,
      petAge: null,
      petMeta: null,
      petPoses: NO_POSES,
    });
    removeUnused([...dropped.flatMap(files), ...old, ...oldPoses]);
  },

  /** 보관한 펫을 다시 꺼낸다. 지금 사진 펫은 보관함으로 */
  restore(id: string): boolean {
    const pick = settings.get().petLibrary.find((p) => p.id === id);
    if (!pick) return false;
    const { list, dropped } = archiveCurrent(id);
    settings.set({
      petLibrary: list,
      petName: pick.name,
      petImage: pick.image,
      petModel: pick.model ?? null,
      petDepth: pick.depth ?? null,
      petAge: pick.age ?? null,
      petMeta: pick.meta ?? null,
      petPoses: {
        happy: pick.poses.happy ?? null,
        sleepy: pick.poses.sleepy ?? null,
        hungry: pick.poses.hungry ?? null,
      },
    });
    removeUnused(dropped.flatMap(files));
    return true;
  },

  /**
   * 그림으로 들어 있는 기본 캐릭터(밀크, 초코)로. 이미 그 캐릭터면 그대로, 보관함에 그 캐릭터 복사본이 있으면
   * 그것을 꺼낸다 (지은 이름, 만든 입체 피규어를 살린다). 아니면 그림을 pets/ 에 복사해 새 사진 펫으로 둔다:
   * 지금 사진 펫은 보관하고 포즈는 비운다 (펫 만들기 저장과 같은 newPhotoPatch, 설정은 한 번에 쓴다)
   */
  fromStarter(id: StarterId): boolean {
    const s = settings.get();
    if (starterOf(s.petImage) === id) return true;
    const saved = s.petLibrary.find((p) => starterOf(p.image) === id);
    if (saved) return library.restore(saved.id);
    const pick = STARTER_PETS.find((p) => p.id === id);
    if (!pick) return false;
    const file = copyStarter(startersDir(), petsDir(), id);
    if (!file) return false;
    try {
      const prep = library.newPhotoPatch();
      settings.set({
        ...prep.patch,
        petImage: file,
        petModel: null,
        petDepth: null,
        // AI 일러스트로 그린 어른 모습 (화면 크기 배율 1)
        petAge: 'adult',
        petName: pick.name,
      });
      // 저장은 끝났다: 옛 파일 치우기가 실패해도(윈도우 파일 잠김) 새 그림은 둔다
      try {
        prep.cleanup();
      } catch {
        // 다음 정리 때 지운다
      }
    } catch (err) {
      rmSync(join(petsDir(), file), { force: true });
      throw err;
    }
    return true;
  },

  /** 고르기 칸에 보일 기본 캐릭터 (이름과 작은 그림). 그림을 못 읽으면 빠진다 */
  starters(): StarterView[] {
    return STARTER_PETS.flatMap((p) => {
      const thumb = starterThumb(p.id);
      return thumb ? [{ id: p.id, name: p.name, desc: p.desc, thumb }] : [];
    });
  },

  /** 보관한 펫을 파일까지 지운다 (다른 곳에서 쓰는 파일은 남긴다) */
  remove(id: string): void {
    const s = settings.get();
    const pick = s.petLibrary.find((p) => p.id === id);
    if (!pick) return;
    settings.set({ petLibrary: s.petLibrary.filter((p) => p.id !== id) });
    removeUnused(files(pick));
    thumbs.delete(pick.image);
    if (pick.model) models.delete(pick.model);
    if (pick.depth) depths.delete(pick.depth);
  },

  /** 떠난 친구 펫의 파일처럼 설정에서 빠진 파일을 지운다 (아직 다른 곳에서 쓰면 남긴다) */
  cleanup(list: (string | undefined)[]): void {
    removeUnused(list.filter((f): f is string => !!f));
  },

  /** 설정 창에 보일 목록 (그림은 작게 줄인 data URL, 입체면 설계도나 깊이 그림도) */
  view(): SavedPetView[] {
    return settings.get().petLibrary.map((p) => ({
      id: p.id,
      name: p.name,
      ...lookView(p),
      ...(p.age ? { age: p.age } : {}),
      ...metaView(p.meta),
    }));
  },

  /** 설정 창 지금 펫 카드. 기본 펫이면 null */
  current(): PetLookView | null {
    const s = settings.get();
    if (!s.petImage) return null;
    const view = lookView({
      image: s.petImage,
      model: s.petModel ?? undefined,
      depth: s.petDepth ?? undefined,
    });
    return { ...view, ...(s.petAge ? { age: s.petAge } : {}), ...metaView(s.petMeta) };
  },
};

/** 카드에 보일 이름표 (만든 사람, 허락, 만든 날) */
function metaView(m: PetMeta | undefined): Pick<PetLookView, 'meta'> {
  return m
    ? { meta: { ...(m.author ? { author: m.author } : {}), license: m.license, created: m.created } }
    : {};
}

/**
 * 카드 그림 재료. 펫 화면과 같은 순서로 고른다: 읽을 수 있는 설계도면 figure, 아니면 깊이 그림이면 relief,
 * 둘 다 없거나 깨졌으면 photo (petImages 와 current3d)
 */
function lookView(p: Pick<SavedPet, 'image' | 'model' | 'depth'>): PetLookView {
  const key = [p.image, p.model ?? '', p.depth ?? ''].join('|');
  const thumb = thumbOf(p.image);
  const model = modelOf(p.model);
  if (model) return { key, thumb, look: 'figure', model };
  const depth = depthOf(p.depth);
  if (depth) return { key, thumb, look: 'relief', depth };
  return { key, thumb, look: 'photo' };
}

/** 기본 캐릭터 썸네일 (앱을 켠 동안 한 번만 만든다) */
const starterThumbs = new Map<StarterId, string>();
function starterThumb(id: StarterId): string {
  const hit = starterThumbs.get(id);
  if (hit !== undefined) return hit;
  let out = '';
  const bytes = readStarter(startersDir(), id);
  try {
    const img = bytes ? nativeImage.createFromBuffer(bytes) : nativeImage.createEmpty();
    if (!img.isEmpty()) {
      const { width, height } = img.getSize();
      const small =
        width >= height
          ? img.resize({
              width: THUMB_PX,
              height: Math.max(1, Math.round((height * THUMB_PX) / width)),
              quality: 'best',
            })
          : img.resize({
              height: THUMB_PX,
              width: Math.max(1, Math.round((width * THUMB_PX) / height)),
              quality: 'best',
            });
      out = small.toDataURL();
    }
  } catch {
    out = '';
  }
  starterThumbs.set(id, out);
  return out;
}

/** 설계도도 깊이 그림도 파일 이름마다 한 번만 읽는다 (이름은 만들 때마다 새로 붙고 내용은 안 바뀐다) */
const models = new Map<string, Blueprint | null>();
const depths = new Map<string, string>();

function modelOf(file: string | undefined): Blueprint | undefined {
  if (!file) return undefined;
  if (models.has(file)) return models.get(file) ?? undefined;
  let model: Blueprint | null = null;
  // pets/ 안 일반 파일만, 상한보다 크면 읽지 않는다 (safe-file.ts)
  const bytes = readFileIn(petsDir(), file, MAX_MODEL_BYTES);
  try {
    model = bytes ? (parseBlueprint(JSON.parse(bytes.toString('utf8'))) ?? null) : null;
  } catch {
    model = null;
  }
  models.set(file, model);
  return model ?? undefined;
}

/** 깊이 그림을 썸네일 크기로 줄인 data URL. PNG 가 아니거나 크면 빈 글 (사진으로 보인다) */
function depthOf(file: string | undefined): string | undefined {
  if (!file) return undefined;
  const hit = depths.get(file);
  if (hit !== undefined) return hit || undefined;
  let out = '';
  const bytes = readFileIn(petsDir(), file, MAX_DEPTH_BYTES);
  try {
    if (bytes && bytes.length > 12 && bytes.readUInt32BE(0) === 0x89504e47 && sizeOk(bytes)) {
      const img = nativeImage.createFromBuffer(bytes);
      if (!img.isEmpty()) {
        const { width, height } = img.getSize();
        const big = Math.max(width, height) > THUMB_PX;
        const small = !big
          ? img
          : width >= height
            ? img.resize({ width: THUMB_PX })
            : img.resize({ height: THUMB_PX });
        out = small.toDataURL();
      }
    }
  } catch {
    out = '';
  }
  depths.set(file, out);
  return out || undefined;
}

/** 파일 앞쪽만 읽는다 (그림 머리말 크기를 보려고 8MB 를 다 읽지 않게) */
function readHead(path: string, n: number): Buffer {
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(n);
    return buf.subarray(0, readSync(fd, buf, 0, n, 0));
  } finally {
    closeSync(fd);
  }
}

/** 썸네일은 파일 이름마다 한 번만 만든다 (파일 이름은 만들 때마다 새로 붙는다) */
const thumbs = new Map<string, string>();

function thumbOf(file: string): string {
  const hit = thumbs.get(file);
  if (hit !== undefined) return hit;
  // pets/ 안 일반 파일만 (링크를 따라 폴더 밖을 읽지 않게, safe-file.ts)
  const path = safeFileIn(petsDir(), file);
  let thumb = '';
  if (!path) return thumb;
  try {
    // 풀기 전에 머리말 크기를 본다 (가로세로가 터무니없는 그림은 풀면 메인이 멈춘다)
    const head = readHead(path, 64 * 1024);
    const img = sizeOk(head) ? nativeImage.createFromPath(path) : nativeImage.createEmpty();
    const { width, height } = img.isEmpty() ? { width: 0, height: 0 } : img.getSize();
    if (width > 0 && height > 0) {
      // 아주 가는 그림(1x5000)은 줄이면 0 이 되어 빈 data URL 이 나왔다
      const small =
        width >= height
          ? img.resize({ width: THUMB_PX, height: Math.max(1, Math.round((height * THUMB_PX) / width)) })
          : img.resize({ height: THUMB_PX, width: Math.max(1, Math.round((width * THUMB_PX) / height)) });
      if (!small.isEmpty()) thumb = small.toDataURL();
    } else if (sizeOk(head) && statSync(path).size <= RAW_THUMB_MAX) {
      const ext = file.split('.').pop();
      const mime = ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : 'image/png';
      thumb = `data:${mime};base64,${readFileSync(path).toString('base64')}`;
    }
  } catch {
    // 파일이 없으면 그림 없이
  }
  thumbs.set(file, thumb);
  return thumb;
}
