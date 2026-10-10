import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { app, type BrowserWindow, dialog } from 'electron';
import { customAiCount, IMPORT_FILES, importedChatSettings } from '../shared/backup-import.ts';
import { type Db, looksLikeOurs, SCHEMA_VERSION, schemaVersion } from '../shared/db-schema.ts';
import { saveErrorText } from '../shared/download-error.ts';
import { t } from '../shared/i18n/index.ts';
import { decodePet, encodePet, SHARE_MAX_BYTES, type SharedPet, shareFileName } from '../shared/pet-share.ts';
import type { Blueprint } from '../shared/pet3d/blueprint.ts';
import { FRIENDS_MAX, POSE_KINDS } from '../shared/settings.ts';
import { petImages } from './maker.ts';
import { library } from './pet-library.ts';
import { freePath, plainEntry, writeFileAtomic } from './safe-file.ts';
import { settings } from './settings.ts';

/**
 * 백업에 넣는 작은 설정 파일들 (로그인 셸 PATH, codex 폴더처럼 컴퓨터마다 다른 것은 뺀다).
 * 가져올 때는 IMPORT_FILES 만 쓴다 (사용자 AI 는 옮기지 않는다).
 * 받은 모델(models/)과 내 Mac에서 그리기 폴더(local-draw/, 5GB 쯤)는 넣지 않는다: 다른 Mac 에서 다시 받으면 된다
 */
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
    // 링크는 따라가지 않고 일반 파일만 (버그잡이 7차)
    if (existsSync(join(dir(), 'pets')))
      cpSync(join(dir(), 'pets'), join(out, 'pets'), { recursive: true, filter: plainEntry });
    writeFileAtomic(
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
    // 같은 분에 두 번 가져와도 겹치지 않게 (freePath)
    const keep = freePath(join(dir(), `before-import-${stamp()}`));
    mkdirSync(keep, { recursive: true });
    o.vacuumInto(join(keep, 'jjakkung.db'));
    for (const f of FILES) if (existsSync(join(dir(), f))) cpSync(join(dir(), f), join(keep, f));
    // 설정 파일도 저장 파일처럼 다음에 켤 때 바꾼다. 지금 덮으면 끄기 전까지 도는 앱(펫 자리 저장, 플래너,
    // 설정 바꾸기, 끄면서 하는 저장)이 가져온 것을 다시 덮는다. 앞서 하다 만 가져오기의 것은 먼저 치운다
    for (const f of IMPORT_FILES) rmSync(join(dir(), staged(f)), { force: true });
    // 사용자 AI(ai-custom.json)는 옮기지 않는다: 실행할 명령이라 그 컴퓨터 것이 아니다. 채팅 설정은 고른 AI 만,
    // 사용자 AI 를 골랐으면 기본으로 (버그잡이 7차)
    for (const f of IMPORT_FILES) {
      if (!existsSync(join(from, f))) continue;
      if (f === 'chat-settings.json')
        writeFileAtomic(
          join(dir(), staged(f)),
          JSON.stringify(importedChatSettings(readJsonFile(join(from, f)))),
        );
      else cpSync(join(from, f), join(dir(), staged(f)));
    }
    // 저장 파일은 앱이 연 채라 다음에 켤 때 바꾼다: 자리만 마련하고 다시 켠다.
    // 맨 끝에 놓는다: 켤 때 이것이 있어야 설정 파일도 바꿔 끼우므로, 중간에 실패하면 반쪽만 바뀌지 않는다
    cpSync(join(from, 'jjakkung.db'), join(dir(), PENDING_DB));
    // pets/ 는 링크를 빼고 일반 파일만 (링크로 사용자 데이터 폴더 밖 파일을 읽게 하지 못하게)
    if (existsSync(join(from, 'pets')))
      cpSync(join(from, 'pets'), join(dir(), 'pets'), { recursive: true, filter: plainEntry });
    const skipped = customAiCount(readJsonFile(join(from, 'ai-custom.json')));
    o.log('backup', '가져옴, 다시 켠다', skipped ? `사용자 AI ${skipped}개 뺌` : '');
    if (skipped > 0)
      await dialog.showMessageBox({
        type: 'info',
        message: t('main.backup.customAiSkipped', { n: skipped }),
        detail: t('main.backup.customAiSkippedDetail'),
        buttons: [t('common.ok')],
      });
    // exit 대신 quit: will-quit 정리(실행 표시 지우기, AI 끝내기, 저장 파일 닫기, 단축키 풀기)가 돌게 한다
    app.relaunch();
    app.quit();
    return t('main.backup.restarting');
  }

  return { exportTo, importFrom };
}

/** 백업 폴더의 JSON. 없거나 깨졌으면 undefined */
function readJsonFile(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
}

/** 가져온 저장 파일이 다음에 켤 때까지 기다리는 이름 */
const PENDING_DB = 'jjakkung.db.import';
/** 가져온 설정 파일이 다음에 켤 때까지 기다리는 이름 */
const staged = (f: string) => `${f}.import`;

/**
 * 켤 때: 가져온 저장 파일과 설정 파일이 기다리고 있으면 바꿔 끼운다.
 * 저장 파일을 열기 전, 설정을 처음 읽기 전에 부른다 (설정은 처음 읽은 것을 기억해 두고 그 위에 쓴다)
 */
export function applyPendingImport(): void {
  const dir = app.getPath('userData');
  const pending = join(dir, PENDING_DB);
  const dropStaged = () => {
    for (const f of IMPORT_FILES) rmSync(join(dir, staged(f)), { force: true });
  };
  // 저장 파일 없이 남은 설정 파일은 하다 만 가져오기다: 반쪽만 바꾸지 않는다
  if (!existsSync(pending)) {
    dropStaged();
    return;
  }
  // 못 여는 판이면 지금 저장 파일을 그대로 둔다 (가져오기에서 걸렀지만 한 번 더)
  const version = dbVersion(pending);
  if (version === undefined || version > SCHEMA_VERSION) {
    rmSync(pending, { force: true });
    dropStaged();
    return;
  }
  for (const f of ['jjakkung.db-wal', 'jjakkung.db-shm']) rmSync(join(dir, f), { force: true });
  cpSync(pending, join(dir, 'jjakkung.db'));
  rmSync(pending, { force: true });
  for (const f of IMPORT_FILES)
    if (existsSync(join(dir, staged(f)))) renameSync(join(dir, staged(f)), join(dir, f));
}

/**
 * 저장 파일의 판(user_version). 열 수 없거나 짝꿍 저장 파일이 아니면(0바이트, 판 0, 할 일 표가 없는 다른 SQLite) undefined.
 * 예전에는 판만 봐서 빈 파일도 통과해 지금 데이터를 빈 것으로 바꿀 수 있었다 (버그잡이 6차)
 */
function dbVersion(file: string): number | undefined {
  try {
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      const d = db as unknown as Db;
      return looksLikeOurs(d) ? schemaVersion(d) : undefined;
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
  writeFileAtomic(join(app.getPath('userData'), 'pets', file), Buffer.from(m[2] ?? '', 'base64'));
  return file;
}

/** 입체 설계도를 pets/ 에 저장하고 파일 이름을 돌려준다 */
function modelToFile(model: Blueprint): string {
  const file = `model-${Date.now()}${Math.floor(Math.random() * 1000)}.json`;
  mkdirSync(join(app.getPath('userData'), 'pets'), { recursive: true });
  writeFileAtomic(join(app.getPath('userData'), 'pets', file), JSON.stringify(model));
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
    ...(imgs.main && s.petAge ? { age: s.petAge } : {}),
  };
  const opts = {
    title: t('main.pet.exportTitle'),
    defaultPath: shareFileName(s.petName),
    filters: [{ name: t('main.pet.fileType'), extensions: ['jjpet'] }],
  };
  const r = await (parent ? dialog.showSaveDialog(parent, opts) : dialog.showSaveDialog(opts));
  if (r.canceled || !r.filePath) return '';
  writeFileAtomic(r.filePath, encodePet(pet));
  return r.filePath;
}

/** .jjpet 을 골라 지금 펫으로. 성공하면 펫 이름, 아니면 오류 글 */
/** asFriend 면 지금 펫을 바꾸지 않고 친구 펫으로 데려온다 (v2 여러 마리) */
export async function importPet(
  parent?: BrowserWindow,
  asFriend = false,
  log?: (tag: string, ...rest: unknown[]) => void,
): Promise<{ ok: boolean; message: string }> {
  const opts = {
    title: t('main.pet.importTitle'),
    properties: ['openFile' as const],
    filters: [{ name: t('main.pet.fileType'), extensions: ['jjpet'] }],
  };
  const r = await (parent ? dialog.showOpenDialog(parent, opts) : dialog.showOpenDialog(opts));
  const file = r.filePaths[0];
  if (r.canceled || !file) return { ok: false, message: '' };
  // 읽기 전에 크기를 본다: 큰 파일을 통째로 메모리에 올리지 않게 (버그잡이 7차)
  // 고른 뒤 지워졌거나 읽을 권한이 없으면 읽기가 던진다. 던진 채 두면 설정 창에 아무 말도 안 뜬다
  let text: string;
  try {
    if (statSync(file).size > SHARE_MAX_BYTES) return { ok: false, message: t('pet.share.tooBig') };
    text = readFileSync(file, 'utf8');
  } catch {
    return { ok: false, message: t('main.pet.unreadable') };
  }
  const pet = decodePet(text);
  if ('error' in pet) return { ok: false, message: pet.error };
  if (!asFriend) {
    const ask = await dialog.showMessageBox({
      type: 'question',
      message: t('main.pet.replaceAsk', { name: pet.name }),
      detail: t('main.pet.replaceDetail'),
      buttons: [t('main.backup.replace'), t('main.backup.cancel')],
      defaultId: 0,
      cancelId: 1,
    });
    if (ask.response !== 0) return { ok: false, message: '' };
  } else if (settings.get().friends.length >= FRIENDS_MAX)
    return { ok: false, message: t('main.pet.friendsMax', { max: FRIENDS_MAX }) };
  // 그림 파일을 다 쓴 뒤에만 설정을 바꾼다. 쓰다가 실패하면(디스크 가득 등) 쓴 것을 지우고 지금 펫은 그대로 둔다
  const made: string[] = [];
  const keep = (f: string) => {
    made.push(f);
    return f;
  };
  try {
    if (asFriend) {
      const friend = {
        id: `f-${Date.now().toString(36)}`,
        name: pet.name,
        kind: pet.kind,
        ...(pet.image ? { image: keep(dataUrlToFile(pet.image, 'pet')) } : {}),
        ...(pet.model ? { model: keep(modelToFile(pet.model)) } : {}),
        ...(pet.depth ? { depth: keep(dataUrlToFile(pet.depth, 'depth')) } : {}),
        ...(pet.age ? { age: pet.age } : {}),
      };
      settings.set({ friends: [...settings.get().friends, friend] });
      return { ok: true, message: t('main.pet.friendCame', { name: pet.name }) };
    }
    const poses: Record<string, string | null> = {};
    // 포즈는 사진 펫에만 붙는다 (그림 없는 기본 펫에 남으면 다음 사진 펫으로 넘어간다)
    for (const { id } of POSE_KINDS)
      poses[id] = pet.image && pet.poses[id] ? keep(dataUrlToFile(pet.poses[id] as string, 'pose')) : null;
    const next = {
      petName: pet.name,
      petKind: pet.kind,
      petImage: pet.image ? keep(dataUrlToFile(pet.image, 'pet')) : null,
      petModel: pet.model ? keep(modelToFile(pet.model)) : null,
      petDepth: pet.depth ? keep(dataUrlToFile(pet.depth, 'depth')) : null,
      petPoses: poses,
      // 나이 단계는 파일에 있을 때만 (없으면 지운다: 옛 펫 나이가 남지 않게)
      petAge: pet.age ?? null,
    };
    // 지금 사진 펫은 보관함으로 (6단계)
    library.beforeNewPhoto();
    settings.set(next);
    return { ok: true, message: t('main.pet.came', { name: pet.name }) };
  } catch (err) {
    for (const f of made) rmSync(join(app.getPath('userData'), 'pets', f), { force: true });
    log?.('backup', '펫 가져오기 실패', err instanceof Error ? err.message : String(err));
    return { ok: false, message: saveErrorText(err) };
  }
}
