// 만든 펫 보관함 (6단계). 사진 펫을 새로 만들거나 기본 펫으로 바꿔도 옛 펫을 지우지 않고 보관했다가 다시 꺼낸다.
// 파일(그림, 입체 설계도, 깊이 그림, 포즈)은 pets/ 에 그대로 두고 설정에는 이름만 적는다.
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import { LIBRARY_MAX, type PetKind, type SavedPet } from '../shared/settings.ts';
import { settings } from './settings.ts';

const petsDir = () => join(app.getPath('userData'), 'pets');

function files(p: Pick<SavedPet, 'image' | 'model' | 'depth' | 'poses'>): string[] {
  return [p.image, p.model, p.depth, ...Object.values(p.poses)].filter((f): f is string => !!f);
}

function removeFiles(p: SavedPet) {
  for (const f of files(p)) rmSync(join(petsDir(), f), { force: true });
}

/** 지금 사진 펫을 보관함 맨 앞에 넣는다. 사진 펫이 아니면 아무것도 안 한다. 넘치면 가장 오래된 것을 지운다 */
function archiveCurrent(): SavedPet[] {
  const s = settings.get();
  if (!s.petImage) return s.petLibrary;
  const saved: SavedPet = {
    id: `p-${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`,
    name: s.petName,
    image: s.petImage,
    ...(s.petModel ? { model: s.petModel } : {}),
    ...(s.petDepth ? { depth: s.petDepth } : {}),
    poses: { ...s.petPoses },
  };
  const next = [saved, ...s.petLibrary];
  for (const old of next.slice(LIBRARY_MAX)) removeFiles(old);
  return next.slice(0, LIBRARY_MAX);
}

export const library = {
  /** 펫 만들기에서 새 사진 펫을 저장하기 직전: 지금 펫을 보관하고 포즈는 비운다 (포즈는 옛 펫 것) */
  beforeNewPhoto(): void {
    const petLibrary = archiveCurrent();
    if (settings.get().petImage)
      settings.set({ petLibrary, petPoses: { happy: null, sleepy: null, hungry: null } });
  },

  /** 기본 펫으로: 지금 사진 펫은 보관하고 고른 모양으로 */
  toDefault(kind: PetKind): void {
    const petLibrary = archiveCurrent();
    settings.set({
      petLibrary,
      petKind: kind,
      petImage: null,
      petModel: null,
      petDepth: null,
      petPoses: { happy: null, sleepy: null, hungry: null },
    });
  },

  /** 보관한 펫을 다시 꺼낸다. 지금 사진 펫은 보관함으로 */
  restore(id: string): boolean {
    const pick = settings.get().petLibrary.find((p) => p.id === id);
    if (!pick) return false;
    const rest = archiveCurrent().filter((p) => p.id !== id);
    settings.set({
      petLibrary: rest,
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
    return true;
  },

  /** 보관한 펫을 파일까지 지운다 */
  remove(id: string): void {
    const s = settings.get();
    const pick = s.petLibrary.find((p) => p.id === id);
    if (!pick) return;
    settings.set({ petLibrary: s.petLibrary.filter((p) => p.id !== id) });
    removeFiles(pick);
  },

  /** 설정 창에 보일 목록 (그림은 data URL) */
  view(): { id: string; name: string; thumb: string; look: 'photo' | 'figure' | 'relief' }[] {
    return settings.get().petLibrary.map((p) => {
      let thumb = '';
      try {
        const ext = p.image.split('.').pop();
        const mime = ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : 'image/png';
        thumb = `data:${mime};base64,${readFileSync(join(petsDir(), p.image)).toString('base64')}`;
      } catch {
        // 파일이 없으면 그림 없이
      }
      return { id: p.id, name: p.name, thumb, look: p.model ? 'figure' : p.depth ? 'relief' : 'photo' };
    });
  },
};
