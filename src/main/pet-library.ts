// 만든 펫 보관함 (6단계). 사진 펫을 새로 만들거나 기본 펫으로 바꿔도 옛 펫을 지우지 않고 보관했다가 다시 꺼낸다.
// 파일(그림, 입체 설계도, 깊이 그림, 포즈)은 pets/ 에 그대로 두고 설정에는 이름만 적는다.
import { readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { app, nativeImage } from 'electron';
import { LIBRARY_MAX, type PetKind, type SavedPet, type Settings } from '../shared/settings.ts';
import { safeFileIn } from './safe-file.ts';
import { settings } from './settings.ts';

const petsDir = () => join(app.getPath('userData'), 'pets');
const THUMB_PX = 160;
/** 줄이지 못한 그림은 이보다 작을 때만 그대로 보낸다 (설정 창에 수백 MB 를 넘기지 않게) */
const RAW_THUMB_MAX = 512 * 1024;

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
  },

  /** 떠난 친구 펫의 파일처럼 설정에서 빠진 파일을 지운다 (아직 다른 곳에서 쓰면 남긴다) */
  cleanup(list: (string | undefined)[]): void {
    removeUnused(list.filter((f): f is string => !!f));
  },

  /** 설정 창에 보일 목록 (그림은 작게 줄인 data URL) */
  view(): { id: string; name: string; thumb: string; look: 'photo' | 'figure' | 'relief' }[] {
    return settings.get().petLibrary.map((p) => ({
      id: p.id,
      name: p.name,
      thumb: thumbOf(p.image),
      look: p.model ? 'figure' : p.depth ? 'relief' : 'photo',
    }));
  },
};

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
