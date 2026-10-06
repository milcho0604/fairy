import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, type BrowserWindow, dialog } from 'electron';
import { withParticle } from '../shared/josa.ts';
import { decodePet, encodePet, type SharedPet, shareFileName } from '../shared/pet-share.ts';
import { FRIENDS_MAX, POSE_KINDS } from '../shared/settings.ts';
import { petImages } from './maker.ts';
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
          title: '백업을 둘 폴더',
          properties: ['openDirectory', 'createDirectory'],
        })
      : dialog.showOpenDialog({ title: '백업을 둘 폴더', properties: ['openDirectory', 'createDirectory'] }));
    const base = pick.filePaths[0];
    if (pick.canceled || !base) return '';
    const out = join(base, `jjakkung-backup-${stamp()}`);
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
      ? dialog.showOpenDialog(parent, { title: '가져올 백업 폴더', properties: ['openDirectory'] })
      : dialog.showOpenDialog({ title: '가져올 백업 폴더', properties: ['openDirectory'] }));
    const from = pick.filePaths[0];
    if (pick.canceled || !from) return '';
    if (!existsSync(join(from, 'jjakkung-backup.json')) || !existsSync(join(from, 'jjakkung.db')))
      return '짝꿍 백업 폴더가 아니야';
    const ok = await dialog.showMessageBox({
      type: 'warning',
      message: '지금 할 일, 메모, 펫을 이 백업으로 바꿀까?',
      detail: '지금 데이터는 사용자 데이터 폴더의 before-import 폴더에 남겨 둬. 바꾼 뒤 짝꿍을 다시 켜.',
      buttons: ['바꾸기', '그만두기'],
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
    return '다시 켜는 중';
  }

  return { exportTo, importFrom };
}

/** 켤 때: 가져온 저장 파일이 기다리고 있으면 바꿔 끼운다 (저장 파일을 열기 전에 부른다) */
export function applyPendingImport(): void {
  const dir = app.getPath('userData');
  const pending = join(dir, 'jjakkung.db.import');
  if (!existsSync(pending)) return;
  for (const f of ['jjakkung.db-wal', 'jjakkung.db-shm']) rmSync(join(dir, f), { force: true });
  cpSync(pending, join(dir, 'jjakkung.db'));
  rmSync(pending, { force: true });
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

export async function exportPet(parent?: BrowserWindow): Promise<string> {
  const s = settings.get();
  const imgs = petImages();
  const pet: SharedPet = {
    name: s.petName,
    kind: s.petKind,
    ...(imgs.main ? { image: imgs.main } : {}),
    poses: imgs.poses,
  };
  const opts = {
    title: '펫 내보내기',
    defaultPath: shareFileName(s.petName),
    filters: [{ name: '짝꿍 펫', extensions: ['jjpet'] }],
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
    title: '펫 가져오기',
    properties: ['openFile' as const],
    filters: [{ name: '짝꿍 펫', extensions: ['jjpet'] }],
  };
  const r = await (parent ? dialog.showOpenDialog(parent, opts) : dialog.showOpenDialog(opts));
  const file = r.filePaths[0];
  if (r.canceled || !file) return { ok: false, message: '' };
  const pet = decodePet(readFileSync(file, 'utf8'));
  if ('error' in pet) return { ok: false, message: pet.error };
  if (asFriend) {
    const list = settings.get().friends;
    if (list.length >= FRIENDS_MAX) return { ok: false, message: `친구 펫은 ${FRIENDS_MAX}마리까지야.` };
    const friend = {
      id: `f-${Date.now().toString(36)}`,
      name: pet.name,
      kind: pet.kind,
      ...(pet.image ? { image: dataUrlToFile(pet.image, 'pet') } : {}),
    };
    settings.set({ friends: [...list, friend] });
    return { ok: true, message: `${withParticle(pet.name, '이')} 친구로 왔어` };
  }
  const ask = await dialog.showMessageBox({
    type: 'question',
    message: `${withParticle(pet.name, '으로')} 바꿀까?`,
    detail: '지금 펫의 이름과 모습이 바뀌어. 할 일, 코인, 친밀도는 그대로야.',
    buttons: ['바꾸기', '그만두기'],
    defaultId: 0,
    cancelId: 1,
  });
  if (ask.response !== 0) return { ok: false, message: '' };
  const poses: Record<string, string | null> = {};
  for (const { id } of POSE_KINDS)
    poses[id] = pet.poses[id] ? dataUrlToFile(pet.poses[id] as string, 'pose') : null;
  settings.set({
    petName: pet.name,
    petKind: pet.kind,
    petImage: pet.image ? dataUrlToFile(pet.image, 'pet') : null,
    petPoses: poses,
  });
  return { ok: true, message: `${withParticle(pet.name, '이')} 왔어` };
}
