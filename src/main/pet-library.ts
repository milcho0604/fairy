// 만든 펫 보관함 (6단계). 사진 펫을 새로 만들거나 기본 펫으로 바꿔도 옛 펫을 지우지 않고 보관했다가 다시 꺼낸다.
// 파일(그림, 입체 설계도, 깊이 그림, 포즈)은 pets/ 에 그대로 두고 설정에는 이름만 적는다.
import { readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { app, nativeImage } from 'electron';
import type { PetLookView, SavedPetView } from '../shared/ipc.ts';
import { type Blueprint, parseBlueprint } from '../shared/pet3d/blueprint.ts';
import { LIBRARY_MAX, type PetKind, type SavedPet, type Settings } from '../shared/settings.ts';
import { readFileIn, safeFileIn } from './safe-file.ts';
import { settings } from './settings.ts';

const petsDir = () => join(app.getPath('userData'), 'pets');
const THUMB_PX = 160;
/** 줄이지 못한 그림은 이보다 작을 때만 그대로 보낸다 (설정 창에 수백 MB 를 넘기지 않게) */
const RAW_THUMB_MAX = 512 * 1024;
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
  const saved: SavedPet = {
    id: `p-${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`,
    name: s.petName,
    image: s.petImage,
    ...(s.petModel ? { model: s.petModel } : {}),
    ...(s.petDepth ? { depth: s.petDepth } : {}),
    poses: { ...s.petPoses },
  };
  const next = [saved, ...rest];
  return { list: next.slice(0, LIBRARY_MAX), dropped: next.slice(LIBRARY_MAX) };
}

const NO_POSES = { happy: null, sleepy: null, hungry: null };

export const library = {
  /** 펫 만들기에서 새 사진 펫을 저장하기 직전: 지금 펫을 보관하고 포즈는 비운다 (포즈는 옛 펫 것) */
  beforeNewPhoto(): void {
    const old = settings.get().petPoses;
    const { list, dropped } = archiveCurrent();
    settings.set({ petLibrary: list, petPoses: NO_POSES });
    removeUnused([...dropped.flatMap(files), ...Object.values(old).filter((f): f is string => !!f)]);
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
      petPoses: {
        happy: pick.poses.happy ?? null,
        sleepy: pick.poses.sleepy ?? null,
        hungry: pick.poses.hungry ?? null,
      },
    });
    removeUnused(dropped.flatMap(files));
    return true;
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
    return settings.get().petLibrary.map((p) => ({ id: p.id, name: p.name, ...lookView(p) }));
  },

  /** 설정 창 지금 펫 카드. 기본 펫이면 null */
  current(): PetLookView | null {
    const s = settings.get();
    if (!s.petImage) return null;
    return lookView({ image: s.petImage, model: s.petModel ?? undefined, depth: s.petDepth ?? undefined });
  },
};

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
    if (bytes && bytes.length > 12 && bytes.readUInt32BE(0) === 0x89504e47) {
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
    const img = nativeImage.createFromPath(path);
    if (!img.isEmpty()) {
      const { width, height } = img.getSize();
      const small = width >= height ? img.resize({ width: THUMB_PX }) : img.resize({ height: THUMB_PX });
      thumb = small.toDataURL();
    } else if (statSync(path).size <= RAW_THUMB_MAX) {
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
