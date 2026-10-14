import { randomBytes } from 'node:crypto';
import {
  cpSync,
  type Dirent,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { app, type BrowserWindow, dialog, nativeImage } from 'electron';
import {
  BACKUP_FILE_EXT,
  type BackupHeader,
  backupDate,
  entryNameOk,
  isBackupFileName,
} from '../shared/backup-file.ts';
import {
  BACKUP_FILE_ITEMS,
  BACKUP_READ_TOP,
  customAiCount,
  IMPORT_FILES,
  importedChatSettings,
  PET_STATE_FILES,
} from '../shared/backup-import.ts';
import { SCHEMA_VERSION } from '../shared/db-schema.ts';
import { saveErrorText } from '../shared/download-error.ts';
import { t } from '../shared/i18n/index.ts';
import type { RestoreOffer, RestoreState } from '../shared/ipc.ts';
import {
  decodePet,
  encodePet,
  type PetMeta,
  reexportMeta,
  SHARE_MAX_BYTES,
  type SharedPet,
  shareFileName,
  THUMB_MAX_BYTES,
} from '../shared/pet-share.ts';
import type { PetSprites } from '../shared/pet-sprites.ts';
import type { Blueprint } from '../shared/pet3d/blueprint.ts';
import { FRIENDS_MAX, isPersonalPet, POSE_KINDS } from '../shared/settings.ts';
import { PET_FILE_EXT, PET_FILE_EXTS_READ } from '../shared/url-scheme.ts';
import { BackupReadError, extractBackupZip, writeBackupZip, type ZipSource } from './backup-zip.ts';
import { importableDbVersion } from './db-open.ts';
import { petImages } from './maker.ts';
import { library } from './pet-library.ts';
import { freePath, plainEntry, plainFile, readPlainCapped, writeFileAtomic } from './safe-file.ts';
import { settings } from './settings.ts';

/**
 * 백업에 넣는 작은 설정 파일들 (로그인 셸 PATH, codex 폴더처럼 컴퓨터마다 다른 것은 뺀다).
 * 가져올 때는 IMPORT_FILES 만 쓴다 (사용자 AI 는 옮기지 않는다).
 * 받은 모델(models/)과 내 컴퓨터에서 그리기 폴더(local-draw/, local-draw-sd/, 5GB 쯤)는 넣지 않는다: 다른 컴퓨터에서 다시 받으면 된다
 */
const FILES = [
  ...['settings', 'chat-settings', 'ai-custom', 'pet-position', 'planner'].map((n) => `${n}.json`),
  ...PET_STATE_FILES,
];

const stamp = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
};

/** 백업 파일을 풀 때 받는 맨 위 파일 (저장 파일, 작은 설정 파일, 예전 파일의 ai-custom.json). 이 밖은 받지 않는다 */
const TOP_LEVEL = BACKUP_READ_TOP;
/**
 * 예전 폴더 백업과 가져오기 전 보관 폴더의 표시 파일. 이름은 예전 그대로 둔다:
 * 예전 판 짝꿍과 새 판이 서로의 폴더 백업을 가져올 수 있게 (앱 안쪽 이름이라 사용자에게는 안 보인다)
 */
const FOLDER_MARK = 'jjakkung-backup.json';
/** 백업 파일을 풀어 확인 창의 답을 기다리는 폴더 (데이터 폴더 안이라 같은 디스크) */
const STAGING = 'restore-staging';
/** 백업 파일을 만드는 동안 저장 파일 사본을 두는 폴더 앞이름 */
const MAKING = 'backup-making-';
/** 가져오기 전 지금 데이터를 남기는 폴더 앞이름 (되돌리기가 가장 최근 것을 쓴다) */
const KEEP = 'before-import-';

type Offer = RestoreOffer & { dir: string; source: string };

/**
 * 백업과 옮기기 (v2, 이슈 #90 부터 파일 하나): 할 일, 메모, 일정, 코인, 펫, 설정을 백업 파일(.fairybackup) 하나로 만들고
 * 다른 컴퓨터에서 가져오거나 파일을 두 번 눌러 복원한다. 예전 폴더 백업도 계속 읽는다.
 * 저장 파일은 SQLite VACUUM INTO 로 쓰는 중에도 한 시점 그대로 복사한다.
 * 복원은 두 걸음이다: 먼저 풀어 검사하고(inspect) 설정 창 안 확인 칸에 보인 뒤, 사용자가 누르면(confirm) 바꾼다.
 * 확인은 OS 창이 아니라 설정 창 안에서 묻는다 (코인 초기화와 같은 꼴, 시험에서도 CDP 로 누를 수 있다)
 */
export function createBackup(o: {
  vacuumInto: (file: string) => void;
  log: (tag: string, ...rest: unknown[]) => void;
}) {
  const dir = () => app.getPath('userData');
  /** 확인을 기다리는 복원. 하나만 둔다 (새로 열면 앞의 것은 치운다) */
  let offer: Offer | undefined;
  /** 풀기나 바꾸기 중 (같은 파일을 연달아 두 번 열어도 한 번만) */
  let busy = false;
  let changed: () => void = () => {};

  /** pets/ 아래 일반 파일 (링크, 숨은 파일, 경로로 못 쓸 이름은 뺀다) */
  function petSources(): ZipSource[] {
    const out: ZipSource[] = [];
    const walk = (abs: string, rel: string) => {
      let list: Dirent[];
      try {
        list = readdirSync(abs, { withFileTypes: true });
      } catch {
        return;
      }
      for (const d of list) {
        const name = `${rel}/${d.name}`;
        if (d.isDirectory()) walk(join(abs, d.name), name);
        else if (d.isFile() && entryNameOk(name, TOP_LEVEL)) out.push({ name, path: join(abs, d.name) });
      }
    };
    walk(join(dir(), 'pets'), 'pets');
    return out;
  }

  /** 백업 파일을 target 에 만든다 (고르기 창 없이. 시험 손잡이도 이것을 쓴다) */
  async function exportFile(target: string): Promise<string> {
    const making = join(dir(), `${MAKING}${randomBytes(4).toString('hex')}`);
    mkdirSync(making, { recursive: true });
    try {
      o.vacuumInto(join(making, 'jjakkung.db'));
      await writeBackupZip(
        target,
        [
          { name: 'jjakkung.db', path: join(making, 'jjakkung.db') },
          // 사용자 AI(ai-custom.json)는 담지 않는다: 복원에 쓰지 않는다
          ...BACKUP_FILE_ITEMS.filter((f) => plainFile(join(dir(), f))).map((f) => ({
            name: f,
            path: join(dir(), f),
          })),
          ...petSources(),
        ],
        { app: app.getVersion(), at: Date.now() },
      );
    } finally {
      rmSync(making, { recursive: true, force: true });
    }
    o.log('backup', '백업 파일 만듦');
    return target;
  }

  /** 저장 창을 띄워 백업 파일을 만든다. 그만두면 빈 path */
  async function exportTo(parent?: BrowserWindow): Promise<{ ok: boolean; path: string; message: string }> {
    const opts = {
      title: t('main.backup.saveTitle'),
      defaultPath: join(
        app.getPath('documents'),
        `${t('main.backup.fileName', { date: backupDate(new Date()) })}${BACKUP_FILE_EXT}`,
      ),
      filters: [{ name: t('main.backup.fileType'), extensions: [BACKUP_FILE_EXT.slice(1)] }],
    };
    const r = await (parent ? dialog.showSaveDialog(parent, opts) : dialog.showSaveDialog(opts));
    if (r.canceled || !r.filePath) return { ok: true, path: '', message: '' };
    // 확장자를 지웠으면 붙인다 (두 번 눌러 열리게). 붙인 이름이 이미 있으면 저장 창이 묻지 않았으니 덮지 않는다
    let target = r.filePath;
    if (!isBackupFileName(target)) {
      const base = target;
      target = `${base}${BACKUP_FILE_EXT}`;
      for (let i = 2; existsSync(target); i++) target = `${base} (${i})${BACKUP_FILE_EXT}`;
    }
    try {
      return { ok: true, path: await exportFile(target), message: '' };
    } catch (err) {
      o.log('backup', '백업 파일 못 만듦', err instanceof Error ? err.message : String(err));
      const message =
        err instanceof BackupReadError && err.reason === 'tooBig'
          ? t('main.backup.exportTooBig')
          : saveErrorText(err);
      return { ok: false, path: '', message };
    }
  }

  /** 가져올 것을 고르는 창. 파일(.fairybackup) 이나 예전 백업 폴더 */
  async function importFrom(
    parent: BrowserWindow | undefined,
    kind: 'file' | 'folder',
  ): Promise<{ ok: boolean; message: string; offer?: RestoreOffer }> {
    const opts =
      kind === 'file'
        ? {
            title: t('main.backup.importTitle'),
            properties: ['openFile' as const],
            filters: [{ name: t('main.backup.fileType'), extensions: [BACKUP_FILE_EXT.slice(1)] }],
          }
        : { title: t('main.backup.importFolderTitle'), properties: ['openDirectory' as const] };
    const pick = await (parent ? dialog.showOpenDialog(parent, opts) : dialog.showOpenDialog(opts));
    const from = pick.filePaths[0];
    if (pick.canceled || !from) return { ok: true, message: '' };
    return inspect(from, kind);
  }

  /** 폴더가 가져올 수 있는 백업인지. 아니면 화면 글 */
  function checkFolder(from: string, needMark: boolean): string | undefined {
    // 저장 파일과 설정은 링크가 아닌 일반 파일만 (버그잡이 4). cpSync 는 링크를 링크 그대로 복사해, 링크로 된
    // jjakkung.db 를 가져오면 앱 저장 파일이 데이터 폴더 밖(백업 폴더, USB)을 가리킨 채 거기에 계속 썼다
    if ((needMark && !plainFile(join(from, FOLDER_MARK))) || !plainFile(join(from, 'jjakkung.db')))
      return t('main.backup.notBackup');
    // 새 판 페어리가 만든 백업은 이 판이 못 연다. 지금 데이터를 덮어쓰기 전에 거른다
    const version = importableDbVersion(join(from, 'jjakkung.db'));
    if (version === undefined) return t('main.backup.notBackup');
    if (version > SCHEMA_VERSION) return t('main.backup.newer');
    return undefined;
  }

  /** 폴더 표시 파일의 만든 때와 앱 판 (없거나 깨졌으면 폴더 시각) */
  function folderInfo(from: string): { at: number; app: string } {
    const m = readJsonFile(join(from, FOLDER_MARK)) as { at?: unknown; version?: unknown } | undefined;
    let at = typeof m?.at === 'number' && Number.isFinite(m.at) ? m.at : 0;
    if (!at)
      try {
        at = statSync(from).mtimeMs;
      } catch {
        at = 0;
      }
    return { at, app: typeof m?.version === 'string' ? m.version.slice(0, 40) : '' };
  }

  const view = (x: Offer): RestoreOffer => ({
    id: x.id,
    kind: x.kind,
    name: x.name,
    at: x.at,
    app: x.app,
    customAi: x.customAi,
  });

  /** 기다리던 복원을 치운다 (풀어 둔 것도) */
  function dropOffer() {
    if (offer?.kind === 'file') rmSync(offer.dir, { recursive: true, force: true });
    offer = undefined;
  }

  function setOffer(next: Omit<Offer, 'id' | 'customAi'>): RestoreOffer {
    offer = {
      ...next,
      id: randomBytes(6).toString('hex'),
      customAi: customAiCount(readJsonFile(join(next.dir, 'ai-custom.json'))),
    };
    changed();
    return view(offer);
  }

  /**
   * 백업 파일이나 폴더를 검사해 확인을 기다리는 복원으로 둔다 (아직 아무것도 바꾸지 않는다).
   * 설정의 가져오기, 두 번 눌러 열기, 시험 손잡이가 모두 이것을 거친다
   */
  async function inspect(
    path: string,
    kind: 'file' | 'folder',
  ): Promise<{ ok: boolean; message: string; offer?: RestoreOffer }> {
    if (busy) return { ok: false, message: t('main.backup.busy') };
    const source = resolve(path);
    // 같은 파일을 또 열었다: 다시 풀지 않고 기다리던 확인을 그대로 보인다
    if (offer && offer.source === source && offer.kind === kind) {
      changed();
      return { ok: true, message: '', offer: view(offer) };
    }
    busy = true;
    try {
      if (kind === 'folder') {
        const bad = checkFolder(source, true);
        if (bad) return { ok: false, message: bad };
        dropOffer();
        return {
          ok: true,
          message: '',
          offer: setOffer({ kind, dir: source, source, name: basename(source), ...folderInfo(source) }),
        };
      }
      dropOffer();
      const out = join(dir(), STAGING);
      rmSync(out, { recursive: true, force: true });
      mkdirSync(out, { recursive: true });
      let header: BackupHeader;
      try {
        header = await extractBackupZip(source, out, TOP_LEVEL);
      } catch (err) {
        rmSync(out, { recursive: true, force: true });
        o.log('backup', '백업 파일 거절', err instanceof Error ? err.message : String(err));
        changed();
        return { ok: false, message: readErrorText(err) };
      }
      // 풀린 저장 파일이 우리 것인지, 이 앱이 여는 판인지
      const bad = checkFolder(out, false);
      if (bad) {
        rmSync(out, { recursive: true, force: true });
        changed();
        return { ok: false, message: bad };
      }
      o.log('backup', '백업 파일 확인', header.entries.length);
      return {
        ok: true,
        message: '',
        offer: setOffer({ kind, dir: out, source, name: basename(source), at: header.at, app: header.app }),
      };
    } finally {
      busy = false;
    }
  }

  /** 가장 최근 가져오기 전 보관 폴더 (되돌리기) */
  function latestKeep(): { dir: string; at: number } | undefined {
    let best: { dir: string; at: number } | undefined;
    let list: Dirent[];
    try {
      list = readdirSync(dir(), { withFileTypes: true });
    } catch {
      return undefined;
    }
    for (const d of list) {
      if (!d.isDirectory() || !d.name.startsWith(KEEP)) continue;
      const p = join(dir(), d.name);
      if (!plainFile(join(p, 'jjakkung.db'))) continue;
      const { at } = folderInfo(p);
      if (!best || at > best.at) best = { dir: p, at };
    }
    return best;
  }

  /** 되돌리기: 가장 최근 보관 폴더를 확인을 기다리는 복원으로 */
  async function offerUndo(): Promise<{ ok: boolean; message: string; offer?: RestoreOffer }> {
    if (busy) return { ok: false, message: t('main.backup.busy') };
    const keep = latestKeep();
    if (!keep) return { ok: false, message: t('main.backup.noUndo') };
    const bad = checkFolder(keep.dir, false);
    if (bad) return { ok: false, message: bad };
    dropOffer();
    return {
      ok: true,
      message: '',
      offer: setOffer({
        kind: 'undo',
        dir: keep.dir,
        source: keep.dir,
        name: basename(keep.dir),
        at: keep.at,
        app: '',
      }),
    };
  }

  function cancel(id: string) {
    if (offer?.id !== id || busy) return;
    dropOffer();
    changed();
  }

  /** 설정 창이 보일 것: 기다리는 복원과 되돌릴 수 있는지 */
  function state(): RestoreState {
    const keep = latestKeep();
    return { ...(offer ? { offer: view(offer) } : {}), ...(keep ? { undoAt: keep.at } : {}) };
  }

  /** 확인 칸에서 "바꾸기"를 눌렀다. 바꾸기 전 지금 것을 한 벌 남기고, 끝나면 다시 켠다 */
  async function confirm(id: string): Promise<{ ok: boolean; message: string }> {
    if (busy) return { ok: false, message: t('main.backup.busy') };
    if (!offer || offer.id !== id) return { ok: false, message: t('main.backup.offerGone') };
    const from = offer.dir;
    // 확인을 기다리는 사이 폴더가 바뀌었을 수 있다 (예전 폴더 백업, 보관 폴더). 한 번 더 본다
    const bad = checkFolder(from, false);
    if (bad) {
      dropOffer();
      changed();
      return { ok: false, message: bad };
    }
    busy = true;
    try {
      const skipped = offer.customAi;
      // 같은 분에 두 번 가져와도 겹치지 않게 (freePath)
      const keep = freePath(join(dir(), `${KEEP}${stamp()}`));
      mkdirSync(keep, { recursive: true });
      o.vacuumInto(join(keep, 'jjakkung.db'));
      for (const f of FILES) if (existsSync(join(dir(), f))) cpSync(join(dir(), f), join(keep, f));
      // 펫 그림과 설계도도 남긴다: 가져오기가 같은 이름의 파일을 덮을 수 있다
      if (existsSync(join(dir(), 'pets')))
        cpSync(join(dir(), 'pets'), join(keep, 'pets'), { recursive: true, filter: plainEntry });
      // 표시 파일을 남겨 보관 폴더도 예전 폴더 백업처럼 가져올 수 있게 (되돌리기가 만든 때를 읽는다)
      writeFileAtomic(
        join(keep, FOLDER_MARK),
        JSON.stringify({ app: 'jjakkung', version: app.getVersion(), at: Date.now() }),
      );
      // 설정 파일도 저장 파일처럼 다음에 켤 때 바꾼다. 지금 덮으면 끄기 전까지 도는 앱(펫 자리 저장, 플래너,
      // 설정 바꾸기, 끄면서 하는 저장)이 가져온 것을 다시 덮는다. 앞서 하다 만 가져오기의 것은 먼저 치운다
      dropStaged(dir());
      // 사용자 AI(ai-custom.json)는 옮기지 않는다: 실행할 명령이라 그 컴퓨터 것이 아니다. 채팅 설정은 고른 AI 만,
      // 사용자 AI 를 골랐으면 기본으로 (버그잡이 7차)
      try {
        for (const f of IMPORT_FILES) {
          if (!plainFile(join(from, f))) continue;
          if (f === 'chat-settings.json')
            writeFileAtomic(
              join(dir(), staged(f)),
              JSON.stringify(importedChatSettings(readJsonFile(join(from, f)))),
            );
          else cpSync(join(from, f), join(dir(), staged(f)));
        }
        // 저장 파일은 앱이 연 채라 다음에 켤 때 바꾼다: 자리만 마련하고 다시 켠다.
        // 맨 끝에 놓는다: 켤 때 이것이 있어야 설정 파일도 바꿔 끼우므로, 중간에 실패하면 반쪽만 바뀌지 않는다
        // pets/ 도 저장 파일과 같이 기다렸다가 다음에 켤 때 넣는다 (저장 파일을 못 바꾸면 펫 파일도 그대로).
        // 링크를 빼고 일반 파일만 (링크로 사용자 데이터 폴더 밖 파일을 읽게 하지 못하게). 저장 파일보다 먼저 둔다
        if (existsSync(join(from, 'pets')))
          cpSync(join(from, 'pets'), join(dir(), PENDING_PETS), { recursive: true, filter: plainEntry });
        // 옆 이름에 다 복사한 뒤 이름을 바꾼다: 복사 중에 앱이 꺼지면 반쪽 저장 파일이 다음에 켤 때 끼워지지 않게
        cpSync(join(from, 'jjakkung.db'), join(dir(), `${PENDING_DB}.part`));
        renameSync(join(dir(), `${PENDING_DB}.part`), join(dir(), PENDING_DB));
      } catch (err) {
        // 디스크가 차서 반만 복사됐으면 다음에 켤 때 반쪽 저장 파일로 바꿔 끼웠다. 기다리던 것을 모두 치운다
        rmSync(join(dir(), PENDING_DB), { force: true });
        rmSync(join(dir(), `${PENDING_DB}.part`), { force: true });
        dropStaged(dir());
        o.log('backup', '가져오기 실패', err instanceof Error ? err.message : String(err));
        return { ok: false, message: saveErrorText(err) };
      }
      o.log('backup', '가져옴, 다시 켠다', offer.kind, skipped ? `사용자 AI ${skipped}개 뺌` : '');
      // 풀어 둔 것은 이제 필요 없다 (켤 때도 치운다)
      dropOffer();
      // exit 대신 quit: will-quit 정리(실행 표시 지우기, AI 끝내기, 저장 파일 닫기, 단축키 풀기)가 돌게 한다
      app.relaunch();
      app.quit();
      return { ok: true, message: t('main.backup.restarting') };
    } catch (err) {
      // 보관 폴더를 못 만들었다(디스크 가득 등): 아무것도 바꾸지 않았다
      o.log('backup', '가져오기 전 보관 실패', err instanceof Error ? err.message : String(err));
      return { ok: false, message: saveErrorText(err) };
    } finally {
      busy = false;
    }
  }

  return {
    exportTo,
    exportFile,
    importFrom,
    inspect,
    offerUndo,
    confirm,
    cancel,
    state,
    /** 기다리는 복원이 바뀌면 (설정 창에 다시 보낸다) */
    onChange(fn: () => void) {
      changed = fn;
    },
  };
}

/** 백업 읽기 실패를 화면 글로 (디스크 가득, 권한은 파일 저장과 같은 글) */
function readErrorText(err: unknown): string {
  if (err instanceof BackupReadError) return t(`main.backup.${err.reason}`);
  return saveErrorText(err);
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
/** 가져온 펫 그림 폴더가 다음에 켤 때까지 기다리는 이름 */
const PENDING_PETS = 'pets.import';
/** 가져온 설정 파일이 다음에 켤 때까지 기다리는 이름 */
const staged = (f: string) => `${f}.import`;

/** 기다리던 설정 파일과 펫 그림을 치운다 (하다 만 가져오기) */
function dropStaged(dir: string) {
  for (const f of IMPORT_FILES) rmSync(join(dir, staged(f)), { force: true });
  rmSync(join(dir, PENDING_PETS), { recursive: true, force: true });
}

/**
 * 켤 때: 지난번에 하다 만 것을 치운다. 확인을 기다리며 풀어 둔 백업 파일(복원 중에 앱을 끈 경우),
 * 백업 파일을 만들다 남은 저장 파일 사본, 다 복사하지 못한 저장 파일 (.part)
 */
function dropLeftovers(dir: string) {
  rmSync(join(dir, 'restore-staging'), { recursive: true, force: true });
  rmSync(join(dir, `${PENDING_DB}.part`), { force: true });
  try {
    for (const d of readdirSync(dir, { withFileTypes: true }))
      if (d.isDirectory() && d.name.startsWith('backup-making-'))
        rmSync(join(dir, d.name), { recursive: true, force: true });
  } catch {
    // 못 치우면 다음에 켤 때 다시
  }
}

/**
 * 켤 때: 가져온 저장 파일과 설정 파일이 기다리고 있으면 바꿔 끼운다.
 * 저장 파일을 열기 전, 설정을 처음 읽기 전에 부른다 (설정은 처음 읽은 것을 기억해 두고 그 위에 쓴다)
 */
export function applyPendingImport(): void {
  const dir = app.getPath('userData');
  const pending = join(dir, PENDING_DB);
  dropLeftovers(dir);
  // 저장 파일 없이 남은 설정 파일은 하다 만 가져오기다: 반쪽만 바꾸지 않는다
  if (!existsSync(pending)) {
    dropStaged(dir);
    return;
  }
  // 못 여는 판이면 지금 저장 파일을 그대로 둔다 (가져오기에서 걸렀지만 한 번 더)
  const version = importableDbVersion(pending);
  if (version === undefined || version > SCHEMA_VERSION) {
    rmSync(pending, { force: true });
    dropStaged(dir);
    return;
  }
  // 복사하지 않고 이름을 바꾼다: 켜는 중에 디스크가 차면 복사가 지금 저장 파일을 반쯤 덮은 채 던졌고,
  // 던지면 준비 뒤 일이 멈춰 펫도 메뉴 막대도 없이 떠 있었다. 같은 폴더 안 이름 바꾸기는 공간이 들지 않고 한 번에 바뀐다
  // 지금 저장 파일의 WAL 은 바꿔 끼운 뒤 남아 있으면 새 파일에 잘못 덧씌워진다. 하지만 바꿔 끼우기가 실패하면
  // 지금 파일에 필요하다. 먼저 합쳐(checkpoint) 비우고, 그래도 남은 것은 지우지 않고 옆으로 옮겼다가
  // 바꿔 끼운 뒤에야 지운다 (실패하면 되돌린다)
  const db = join(dir, 'jjakkung.db');
  checkpoint(db);
  const aside: [string, string][] = [];
  try {
    for (const ext of ['-wal', '-shm']) {
      if (!existsSync(db + ext)) continue;
      renameSync(db + ext, `${db}${ext}.before-import`);
      aside.push([db + ext, `${db}${ext}.before-import`]);
    }
    renameSync(pending, db);
  } catch {
    // 못 바꾸면 지금 저장 파일과 설정으로 켠다 (가져오기 전 복사본은 before-import 폴더에 있다)
    for (const [orig, moved] of aside)
      try {
        renameSync(moved, orig);
      } catch {
        // 되돌리지 못하면 옆 이름 그대로 둔다 (지우지 않는다)
      }
    for (const f of ['', '-wal', '-shm']) rmSync(pending + f, { force: true });
    dropStaged(dir);
    return;
  }
  for (const [, moved] of aside) rmSync(moved, { force: true });
  for (const f of ['-wal', '-shm']) rmSync(pending + f, { force: true });
  // 펫 그림은 지금 것 위에 더한다 (같은 이름이면 가져온 것. 지금 것은 before-import 폴더에 있다)
  const pets = join(dir, PENDING_PETS);
  if (existsSync(pets)) {
    try {
      cpSync(pets, join(dir, 'pets'), { recursive: true, filter: plainEntry });
    } catch {
      // 켜기를 멈추지 않는다: 못 넣은 그림은 펫이 기본 그림으로 보인다
    }
    rmSync(pets, { recursive: true, force: true });
  }
  // 구글 캘린더로 보낸 기록도 백업 때 것이라, 다음 보내기가 지금 일정과 다시 맞추게 표시해 둔다 (gcal.ts)
  try {
    writeFileSync(join(dir, 'google-calendar-reset'), '');
  } catch {
    // 표시를 못 남기면 바뀐 일정만 보낸다
  }
  for (const f of IMPORT_FILES) {
    try {
      if (existsSync(join(dir, staged(f)))) renameSync(join(dir, staged(f)), join(dir, f));
    } catch {
      // 켜기를 멈추지 않는다: 못 바꾼 설정 파일은 지금 것을 쓴다
      rmSync(join(dir, staged(f)), { force: true });
    }
  }
}

/** WAL 을 본 파일에 합쳐 비운다. 못 하면(잠김, 깨짐) 넘어간다: WAL 은 지우지 않고 옆으로 옮긴다 */
function checkpoint(file: string): void {
  if (!existsSync(file) || !existsSync(`${file}-wal`)) return;
  try {
    const db = new DatabaseSync(file);
    try {
      db.exec('pragma busy_timeout = 2000; pragma wal_checkpoint(truncate);');
    } finally {
      db.close();
    }
  } catch {
    // 아래에서 옆으로 옮긴다
  }
}

// ---- 펫 공유 (v2) ----

/** 한 번에 여러 장(그림 세트 22장)을 써도 이름이 겹치지 않게 붙이는 차례 번호 */
let fileSeq = 0;
function dataUrlToFile(dataUrl: string, prefix: string): string {
  const m = /^data:image\/(png|gif|webp);base64,(.+)$/.exec(dataUrl);
  if (!m) throw new Error('그림 형식');
  fileSeq = (fileSeq + 1) % 1000;
  const file = `${prefix}-${Date.now()}-${fileSeq}${Math.random().toString(36).slice(2, 6)}.${m[1]}`;
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

/** 갤러리 작은 그림: 본 그림을 긴 쪽 256 으로 줄인 PNG. 못 만들면(움직이는 그림 등) 없이 */
function thumbnailOf(image: string | null | undefined): string | undefined {
  if (!image?.startsWith('data:image/png') && !image?.startsWith('data:image/webp')) return undefined;
  try {
    const img = nativeImage.createFromDataURL(image);
    if (img.isEmpty()) return undefined;
    const { width, height } = img.getSize();
    const small =
      width >= height
        ? img.resize({ width: Math.min(256, width) })
        : img.resize({ height: Math.min(256, height) });
    const png = small.toPNG();
    return png.length <= THUMB_MAX_BYTES ? `data:image/png;base64,${png.toString('base64')}` : undefined;
  } catch {
    return undefined;
  }
}

/** 지금 펫을 공유 파일 모양으로 (판 2 이름표는 encodePet 이 채운다) */
export function currentSharedPet(): SharedPet {
  const s = settings.get();
  const imgs = petImages();
  const thumbnail = thumbnailOf(imgs.main);
  return {
    name: s.petName,
    kind: s.petKind,
    ...(imgs.main ? { image: imgs.main } : {}),
    poses: imgs.poses,
    ...(imgs.model ? { model: imgs.model } : {}),
    ...(imgs.depth ? { depth: imgs.depth } : {}),
    ...(imgs.main && s.petAge ? { age: s.petAge } : {}),
    ...(thumbnail ? { thumbnail } : {}),
    // 이미 있는 캐릭터로 말로 만든 펫 (이름표에 적혀 공식 갤러리가 받지 않는다)
    ...(imgs.model && isPersonalPet(s) ? { personalOnly: true } : {}),
    // 데려온 2D 그림 세트도 다시 담는다 (친구에게 보내도 자세 그림이 같이 간다)
    ...(imgs.main && imgs.sprites ? { sprites: imgs.sprites } : {}),
  };
}

/** .jjpet 판 2 로 저장한다. meta 로 만든 사람, 허락을 준다 (갤러리에 올리기). 저장한 경로, 그만두면 빈 글 */
export async function exportPet(
  parent?: BrowserWindow,
  meta?: Partial<PetMeta>,
  title?: string,
): Promise<string> {
  const pet = currentSharedPet();
  const opts = {
    title: title ?? t('main.pet.exportTitle'),
    // 개인 용도 페어리면 저장 창에도 한 줄 (맥만 보인다. 막지 않는다. 설정 창 내보내기 칸에도 같은 줄이 있다)
    ...(pet.personalOnly ? { message: t('pet.share.personalHint') } : {}),
    defaultPath: shareFileName(pet.name),
    filters: [{ name: t('main.pet.fileType'), extensions: [PET_FILE_EXT.slice(1)] }],
  };
  const r = await (parent ? dialog.showSaveDialog(parent, opts) : dialog.showSaveDialog(opts));
  if (r.canceled || !r.filePath) return '';
  // 데려온 펫이면 만든 사람, 허락, 만든 날을 그대로 (만든 사람을 바꿔 적으면 새 작품으로)
  writeFileAtomic(r.filePath, encodePet(pet, reexportMeta(settings.get().petMeta, meta, app.getVersion())));
  return r.filePath;
}

/** .jjpet 을 골라 지금 펫으로. 성공하면 펫 이름, 아니면 오류 글 */
/** asFriend 면 지금 펫을 바꾸지 않고 친구 펫으로 데려온다 (v2 여러 마리) */
export async function importPet(
  parent?: BrowserWindow,
  asFriend = false,
  log?: (tag: string, ...rest: unknown[]) => void,
  /** 고를 것 없이 이 파일로 (.jjpet 두 번 눌러 열기). 크기, 형식 검사와 바꿀지 묻기는 똑같이 한다 */
  picked?: string,
): Promise<{ ok: boolean; message: string }> {
  const opts = {
    title: t('main.pet.importTitle'),
    properties: ['openFile' as const],
    // 새 .fairy 와 예전 이름(짝꿍) 때 .jjpet 을 같이 고를 수 있다
    filters: [{ name: t('main.pet.fileType'), extensions: [...PET_FILE_EXTS_READ] }],
  };
  const r = picked
    ? { canceled: false, filePaths: [picked] }
    : await (parent ? dialog.showOpenDialog(parent, opts) : dialog.showOpenDialog(opts));
  const file = r.filePaths[0];
  if (r.canceled || !file) return { ok: false, message: '' };
  // 읽기 전에 크기를 본다: 큰 파일을 통째로 메모리에 올리지 않게 (버그잡이 7차)
  // 고른 뒤 지워졌거나 읽을 권한이 없으면 읽기가 던진다. 던진 채 두면 설정 창에 아무 말도 안 뜬다
  // 일반 파일만, 상한까지만 읽는다 (장치 파일이나 파이프를 가리키는 .fairy 에 앱이 멈추지 않게. 버그잡이 4)
  const bytes = readPlainCapped(file, SHARE_MAX_BYTES);
  if (bytes === 'tooBig') return { ok: false, message: t('pet.share.tooBig') };
  if (!bytes) return { ok: false, message: t('main.pet.unreadable') };
  const pet = decodePet(bytes.toString('utf8'));
  if ('error' in pet) return { ok: false, message: pet.error };
  return adoptPet(pet, asFriend, log);
}

/**
 * 검사를 마친 펫을 데려온다 (파일 가져오기, 펫 갤러리). asFriend 가 아니면 바꿀지 먼저 묻는다.
 * 성공하면 펫 이름이 든 안내, 그만두면 빈 글
 */
export async function adoptPet(
  pet: SharedPet,
  asFriend: boolean,
  log?: (tag: string, ...rest: unknown[]) => void,
): Promise<{ ok: boolean; message: string }> {
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
  // 2D 그림 세트 (사진 펫에만). 장마다 pets/ 안 sprite-*.png 로
  const spritesToFiles = (sprites: PetSprites | undefined): PetSprites | undefined => {
    if (!pet.image || !sprites?.idle) return undefined;
    const out: PetSprites = {};
    for (const [name, url] of Object.entries(sprites) as [keyof PetSprites, string][])
      out[name] = keep(dataUrlToFile(url, 'sprite'));
    return out;
  };
  try {
    const sprites = spritesToFiles(pet.sprites);
    if (asFriend) {
      const friend = {
        id: `f-${Date.now().toString(36)}`,
        name: pet.name,
        kind: pet.kind,
        ...(pet.image ? { image: keep(dataUrlToFile(pet.image, 'pet')) } : {}),
        ...(pet.model ? { model: keep(modelToFile(pet.model)) } : {}),
        ...(pet.depth ? { depth: keep(dataUrlToFile(pet.depth, 'depth')) } : {}),
        ...(pet.age ? { age: pet.age } : {}),
        ...(sprites ? { sprites } : {}),
      };
      settings.set({ friends: [...settings.get().friends, friend] });
      return { ok: true, message: t('main.pet.friendCame', { name: pet.name }) };
    }
    const poses: Record<string, string | null> = {};
    // 포즈는 사진 펫에만 붙는다 (그림 없는 기본 펫에 남으면 다음 사진 펫으로 넘어간다)
    for (const { id } of POSE_KINDS)
      poses[id] = pet.image && pet.poses[id] ? keep(dataUrlToFile(pet.poses[id] as string, 'pose')) : null;
    const model = pet.model ? keep(modelToFile(pet.model)) : null;
    const next = {
      petName: pet.name,
      petKind: pet.kind,
      petImage: pet.image ? keep(dataUrlToFile(pet.image, 'pet')) : null,
      petModel: model,
      petDepth: pet.depth ? keep(dataUrlToFile(pet.depth, 'depth')) : null,
      petPoses: poses,
      // 개인 용도 표시는 데려와도 그대로 (다시 내보낼 때도 이름표에 남는다)
      ...(model && pet.personalOnly
        ? { petPersonal: { ...settings.get().petPersonal, [model]: true as const } }
        : {}),
      // 나이 단계는 파일에 있을 때만 (없으면 지운다: 옛 펫 나이가 남지 않게)
      petAge: pet.age ?? null,
      // 만든 사람, 사용 허락, 만든 날, 앱 판 (판 2 파일). 다시 내보낼 때 그대로 넘긴다. 판 1 이면 지운다
      petMeta: pet.meta ?? null,
      // 2D 그림 세트 (없으면 지운다: 옛 펫 그림이 새 펫에 남지 않게)
      petSprites: sprites ?? null,
    };
    // 지금 사진 펫은 보관함으로 (6단계)
    const prep = library.newPhotoPatch();
    settings.set({ ...prep.patch, ...next });
    try {
      prep.cleanup();
    } catch {
      // 저장은 끝났다: 옛 파일 치우기가 실패해도 가져온 펫 파일은 둔다
    }
    return { ok: true, message: t('main.pet.came', { name: pet.name }) };
  } catch (err) {
    for (const f of made) rmSync(join(app.getPath('userData'), 'pets', f), { force: true });
    log?.('backup', '펫 가져오기 실패', err instanceof Error ? err.message : String(err));
    return { ok: false, message: saveErrorText(err) };
  }
}
