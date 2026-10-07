import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { app, type BrowserWindow, dialog } from 'electron';
import { SCHEMA_VERSION } from '../shared/db-schema.ts';
import { t } from '../shared/i18n/index.ts';
import { decodePet, encodePet, type SharedPet, shareFileName } from '../shared/pet-share.ts';
import type { Blueprint } from '../shared/pet3d/blueprint.ts';
import { FRIENDS_MAX, POSE_KINDS } from '../shared/settings.ts';
import { petImages } from './maker.ts';
import { library } from './pet-library.ts';
import { settings } from './settings.ts';

/** 백업에 넣는 작은 설정 파일들 (로그인 셸 PATH, codex 폴더처럼 컴퓨터마다 다른 것은 뺀다) */
const FILES = ['settings', 'chat-settings', 'ai-custom', 'pet-position', 'planner'].map((n) => `${n}.json`);

const stamp = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
};

/**
 * 백업과 옮기기 (v2): 할 일, 메모, 일정, 코인, 펫, 설정을 폴더 하나로 내보내고 다른 컴퓨터에서 가져온다.
 * 저장 파일은 SQLite VACUUM INTO 로 쓰는 중에도 한 시점 그대로 복사한다.
 */
export function createBackup(o: {
  vacuumInto: (file: string) => void;
  log: (tag: string, ...rest: unknown[]) => void;
}) {
  const dir = () => app.getPath('userData');

  async function exportTo(parent?: BrowserWindow): Promise<string> {
    const pick = await (parent
      ? dialog.showOpenDialog(parent, {
          title: t('main.backup.exportTitle'),
          properties: ['openDirectory', 'createDirectory'],
        })
      : dialog.showOpenDialog({
          title: t('main.backup.exportTitle'),
          properties: ['openDirectory', 'createDirectory'],
        }));
    const base = pick.filePaths[0];
    if (pick.canceled || !base) return '';
    // 같은 분에 두 번 내보내도 겹치지 않게 (VACUUM INTO 는 있는 파일에 못 쓴다)
    let out = join(base, `jjakkung-backup-${stamp()}`);
    for (let i = 2; existsSync(out); i++) out = join(base, `jjakkung-backup-${stamp()}-${i}`);
    mkdirSync(out, { recursive: true });
    o.vacuumInto(join(out, 'jjakkung.db'));
    for (const f of FILES) if (existsSync(join(dir(), f))) cpSync(join(dir(), f), join(out, f));
    if (existsSync(join(dir(), 'pets'))) cpSync(join(dir(), 'pets'), join(out, 'pets'), { recursive: true });
    writeFileSync(
      join(out, 'jjakkung-backup.json'),
      JSON.stringify({ app: 'jjakkung', version: app.getVersion(), at: Date.now() }),
    );
    o.log('backup', '내보냄');
    return out;
  }

  /** 백업 폴더를 골라 지금 데이터를 바꾼다. 바꾸기 전 지금 것을 한 벌 남기고, 끝나면 다시 켠다 */
  async function importFrom(parent?: BrowserWindow): Promise<string> {
    const pick = await (parent
      ? dialog.showOpenDialog(parent, { title: t('main.backup.importTitle'), properties: ['openDirectory'] })
      : dialog.showOpenDialog({ title: t('main.backup.importTitle'), properties: ['openDirectory'] }));
    const from = pick.filePaths[0];
    if (pick.canceled || !from) return '';
    if (!existsSync(join(from, 'jjakkung-backup.json')) || !existsSync(join(from, 'jjakkung.db')))
      return t('main.backup.notBackup');
    // 새 판 짝꿍이 만든 백업은 이 판이 못 연다. 지금 데이터를 덮어쓰기 전에 거른다
    const version = dbVersion(join(from, 'jjakkung.db'));
    if (version === undefined) return t('main.backup.notBackup');
    if (version > SCHEMA_VERSION) return t('main.backup.newer');
    const ok = await dialog.showMessageBox({
      type: 'warning',
      message: t('main.backup.confirm'),
      detail: t('main.backup.confirmDetail'),
      buttons: [t('main.backup.replace'), t('main.backup.cancel')],
      defaultId: 1,
      cancelId: 1,
    });
    if (ok.response !== 0) return '';
    const keep = join(dir(), `before-import-${stamp()}`);
    mkdirSync(keep, { recursive: true });
    o.vacuumInto(join(keep, 'jjakkung.db'));
    for (const f of FILES) if (existsSync(join(dir(), f))) cpSync(join(dir(), f), join(keep, f));
    // 저장 파일은 앱이 연 채라 다음에 켤 때 바꾼다: 자리만 마련하고 다시 켠다
    cpSync(join(from, 'jjakkung.db'), join(dir(), 'jjakkung.db.import'));
    for (const f of FILES) if (existsSync(join(from, f))) cpSync(join(from, f), join(dir(), f));
    if (existsSync(join(from, 'pets'))) cpSync(join(from, 'pets'), join(dir(), 'pets'), { recursive: true });
    o.log('backup', '가져옴, 다시 켠다');
    app.relaunch();
    app.exit(0);
    return t('main.backup.restarting');
  }

  return { exportTo, importFrom };
}

/** 켤 때: 가져온 저장 파일이 기다리고 있으면 바꿔 끼운다 (저장 파일을 열기 전에 부른다) */
export function applyPendingImport(): void {
  const dir = app.getPath('userData');
  const pending = join(dir, 'jjakkung.db.import');
  if (!existsSync(pending)) return;
  // 못 여는 판이면 지금 저장 파일을 그대로 둔다 (가져오기에서 걸렀지만 한 번 더)
  const version = dbVersion(pending);
  if (version === undefined || version > SCHEMA_VERSION) {
    rmSync(pending, { force: true });
    return;
  }
  for (const f of ['jjakkung.db-wal', 'jjakkung.db-shm']) rmSync(join(dir, f), { force: true });
  cpSync(pending, join(dir, 'jjakkung.db'));
  rmSync(pending, { force: true });
}

/** 저장 파일의 판(user_version). 열 수 없으면 undefined */
function dbVersion(file: string): number | undefined {
  try {
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      return Number((db.prepare('pragma user_version').get() as { user_version: number }).user_version);
    } finally {
      db.close();
    }
  } catch {
    return undefined;
  }
}

// ---- 펫 공유 (v2) ----

function dataUrlToFile(dataUrl: string, prefix: string): string {
  const m = /^data:image\/(png|gif|webp);base64,(.+)$/.exec(dataUrl);
  if (!m) throw new Error('그림 형식');
  const file = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.${m[1]}`;
  mkdirSync(join(app.getPath('userData'), 'pets'), { recursive: true });
  writeFileSync(join(app.getPath('userData'), 'pets', file), Buffer.from(m[2] ?? '', 'base64'));
  return file;
}

/** 입체 설계도를 pets/ 에 저장하고 파일 이름을 돌려준다 */
function modelToFile(model: Blueprint): string {
  const file = `model-${Date.now()}${Math.floor(Math.random() * 1000)}.json`;
  mkdirSync(join(app.getPath('userData'), 'pets'), { recursive: true });
  writeFileSync(join(app.getPath('userData'), 'pets', file), JSON.stringify(model));
  return file;
}

export async function exportPet(parent?: BrowserWindow): Promise<string> {
  const s = settings.get();
  const imgs = petImages();
  const pet: SharedPet = {
    name: s.petName,
    kind: s.petKind,
    ...(imgs.main ? { image: imgs.main } : {}),
    poses: imgs.poses,
    ...(imgs.model ? { model: imgs.model } : {}),
    ...(imgs.depth ? { depth: imgs.depth } : {}),
  };
  const opts = {
    title: t('main.pet.exportTitle'),
    defaultPath: shareFileName(s.petName),
    filters: [{ name: t('main.pet.fileType'), extensions: ['jjpet'] }],
  };
  const r = await (parent ? dialog.showSaveDialog(parent, opts) : dialog.showSaveDialog(opts));
  if (r.canceled || !r.filePath) return '';
  writeFileSync(r.filePath, encodePet(pet));
  return r.filePath;
}

/** .jjpet 을 골라 지금 펫으로. 성공하면 펫 이름, 아니면 오류 글 */
/** asFriend 면 지금 펫을 바꾸지 않고 친구 펫으로 데려온다 (v2 여러 마리) */
export async function importPet(
  parent?: BrowserWindow,
  asFriend = false,
): Promise<{ ok: boolean; message: string }> {
  const opts = {
    title: t('main.pet.importTitle'),
    properties: ['openFile' as const],
    filters: [{ name: t('main.pet.fileType'), extensions: ['jjpet'] }],
  };
  const r = await (parent ? dialog.showOpenDialog(parent, opts) : dialog.showOpenDialog(opts));
  const file = r.filePaths[0];
  if (r.canceled || !file) return { ok: false, message: '' };
  const pet = decodePet(readFileSync(file, 'utf8'));
  if ('error' in pet) return { ok: false, message: pet.error };
  if (asFriend) {
    const list = settings.get().friends;
    if (list.length >= FRIENDS_MAX)
      return { ok: false, message: t('main.pet.friendsMax', { max: FRIENDS_MAX }) };
    const friend = {
      id: `f-${Date.now().toString(36)}`,
      name: pet.name,
      kind: pet.kind,
      ...(pet.image ? { image: dataUrlToFile(pet.image, 'pet') } : {}),
      ...(pet.model ? { model: modelToFile(pet.model) } : {}),
      ...(pet.depth ? { depth: dataUrlToFile(pet.depth, 'depth') } : {}),
    };
    settings.set({ friends: [...list, friend] });
    return { ok: true, message: t('main.pet.friendCame', { name: pet.name }) };
  }
  const ask = await dialog.showMessageBox({
    type: 'question',
    message: t('main.pet.replaceAsk', { name: pet.name }),
    detail: t('main.pet.replaceDetail'),
    buttons: [t('main.backup.replace'), t('main.backup.cancel')],
    defaultId: 0,
    cancelId: 1,
  });
  if (ask.response !== 0) return { ok: false, message: '' };
  // 지금 사진 펫은 보관함으로 (6단계)
  library.beforeNewPhoto();
  const poses: Record<string, string | null> = {};
  for (const { id } of POSE_KINDS)
    poses[id] = pet.poses[id] ? dataUrlToFile(pet.poses[id] as string, 'pose') : null;
  settings.set({
    petName: pet.name,
    petKind: pet.kind,
    petImage: pet.image ? dataUrlToFile(pet.image, 'pet') : null,
    petModel: pet.model ? modelToFile(pet.model) : null,
    petDepth: pet.depth ? dataUrlToFile(pet.depth, 'depth') : null,
    petPoses: poses,
  });
  return { ok: true, message: t('main.pet.came', { name: pet.name }) };
}
