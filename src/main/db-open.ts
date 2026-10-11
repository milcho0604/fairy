// 저장 파일 열기와 고장 처리 (버그잡이 6차). Electron 없이 돌아 시험에서 그대로 부른다.
import { copyFileSync, existsSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { type Db, looksLikeOurs, migrate, SCHEMA_VERSION, schemaVersion } from '../shared/db-schema.ts';

/** 저장 파일을 그대로 쓰지 못한 까닭. 펫이 말풍선으로 알린다 */
export type StoreTrouble =
  /** 깨진 파일을 옆으로 옮기고 남아 있던 복사본(from, 그 시각 at)으로 되살렸다 */
  | { kind: 'recovered'; moved: string; from: string; at: number }
  /** 깨진 파일을 옆으로 옮기고 새로 시작했다 */
  | { kind: 'fresh'; moved: string }
  /** 이 앱보다 새 판 파일이라 건드리지 않고 이번 실행은 저장하지 않는다 */
  | { kind: 'newer'; version: number }
  /** 깨진 건 아닌데 열지 못했다(잠김, 권한, 판 올리기 실패). 건드리지 않고 이번 실행은 저장하지 않는다 */
  | { kind: 'unavailable' };

export interface OpenedDb {
  db: DatabaseSync;
  /** 파일이 아니라 메모리에 열었다 (끄면 사라진다) */
  memory: boolean;
  trouble?: StoreTrouble;
}

class NewerError extends Error {
  readonly version: number;
  constructor(version: number) {
    super(`이 저장 파일(${version}판)은 이 페어리(${SCHEMA_VERSION}판)보다 새 판이다`);
    this.version = version;
  }
}
class BrokenError extends Error {}

/** SQLITE_CORRUPT(11), SQLITE_NOTADB(26). 잠김(5), 권한, 디스크 가득 같은 것은 깨진 것이 아니다 */
function isBroken(err: unknown): boolean {
  if (err instanceof BrokenError) return true;
  const code = (err as { errcode?: unknown } | null)?.errcode;
  return typeof code === 'number' && [11, 26].includes(code & 0xff);
}

const quickCheckOk = (db: DatabaseSync) => {
  const rows = db.prepare('pragma quick_check').all() as { quick_check: string }[];
  return rows.length === 1 && rows[0]?.quick_check === 'ok';
};

/** 열고 검사하고 최신 판으로 올린다. 판을 올리기 전에 한 벌 복사해 둔다 (P2-01) */
function openFile(file: string, log: (tag: string, ...rest: unknown[]) => void): DatabaseSync {
  const existed = existsSync(file);
  const db = new DatabaseSync(file);
  try {
    // 판을 먼저 본다: 새 판 파일이면 저널 방식도 바꾸지 않고 그대로 닫는다
    db.exec('pragma busy_timeout = 2000;');
    const from = schemaVersion(db as unknown as Db);
    if (from > SCHEMA_VERSION) throw new NewerError(from);
    db.exec('pragma journal_mode = wal; pragma synchronous = normal;');
    if (!quickCheckOk(db)) throw new BrokenError('quick_check');
    if (existed && from > 0 && from < SCHEMA_VERSION) {
      db.exec('pragma wal_checkpoint(truncate)');
      copyFileSync(file, `${file}.bak-v${from}`);
      log('db', `판을 올리기 전 복사: ${from}판`);
    }
    const result = migrate(db as unknown as Db);
    if (result.from !== result.to) log('db', `저장 파일 ${result.from}판 → ${result.to}판`);
    return db;
  } catch (err) {
    db.close();
    throw err;
  }
}

function memoryDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  migrate(db as unknown as Db);
  return db;
}

const stampOf = (at: number) => {
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

/** 깨진 파일을 지우지 않고 옆으로 옮긴다. WAL, SHM 도 같은 이름으로 따라가 그대로 열어 볼 수 있다 */
function moveAside(file: string, at: number): string {
  const dir = dirname(file);
  let moved = join(dir, `jjakkung-broken-${stampOf(at)}.db`);
  for (let i = 2; existsSync(moved); i++) moved = join(dir, `jjakkung-broken-${stampOf(at)}-${i}.db`);
  renameSync(file, moved);
  for (const ext of ['-wal', '-shm']) if (existsSync(file + ext)) renameSync(file + ext, moved + ext);
  return moved;
}

/** 되살릴 복사본: 판 올리기 전 복사(jjakkung.db.bak-vN), 백업 가져오기 전 복사(before-import-*). 새것부터 */
function backupCandidates(file: string): { path: string; at: number }[] {
  const dir = dirname(file);
  const name = basename(file);
  const out: { path: string; at: number }[] = [];
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    const path = e.startsWith(`${name}.bak-v`)
      ? join(dir, e)
      : e.startsWith('before-import-')
        ? join(dir, e, name)
        : undefined;
    if (!path) continue;
    try {
      const st = statSync(path);
      if (st.isFile() && st.size > 0) out.push({ path, at: st.mtimeMs });
    } catch {
      // 없으면 넘어간다
    }
  }
  return out.sort((a, b) => b.at - a.at);
}

/** 복사본이 쓸 만한지: 열리고, 깨지지 않았고, 짝꿍 파일이고, 이 앱이 아는 판 */
function usable(path: string): boolean {
  try {
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      const d = db as unknown as Db;
      return looksLikeOurs(d) && schemaVersion(d) <= SCHEMA_VERSION && quickCheckOk(db);
    } finally {
      db.close();
    }
  } catch {
    return false;
  }
}

/**
 * 백업에서 가져올 저장 파일의 판(user_version). 열 수 없거나, 짝꿍 저장 파일이 아니거나(0바이트, 판 0, 할 일 표가 없는
 * 다른 SQLite), 깨졌으면(quick_check) undefined. 예전에는 판만 봐서 빈 파일도 통과해 지금 데이터를 빈 것으로 바꿀 수
 * 있었다 (버그잡이 6차). 깨진 파일을 끼우면 다음에 켤 때 깨진 것으로 보고 가져오기 전 복사본으로 되돌아가,
 * "가져왔어" 하고는 아무것도 바뀌지 않았다. 새 판인지는 부르는 쪽이 SCHEMA_VERSION 과 비교한다
 */
export function importableDbVersion(file: string): number | undefined {
  try {
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      const d = db as unknown as Db;
      if (!looksLikeOurs(d)) return undefined;
      // 새 판 파일은 판만 알린다 (그 판의 표 모양을 이 앱이 검사할 수는 없지만 quick_check 는 판과 상관없다)
      return quickCheckOk(db) ? schemaVersion(d) : undefined;
    } finally {
      db.close();
    }
  } catch {
    return undefined;
  }
}

/**
 * 저장 파일을 연다. 앱이 반만 켜진 채 멈추지 않게 어떤 경우에도 쓸 수 있는 DB 를 돌려준다.
 * - 깨졌으면 지우지 않고 옆으로 옮긴 뒤, 남은 복사본이 있으면 그것으로, 없으면 새로 시작한다.
 * - 새 판이면 덮어쓰지 않고 메모리에 연다 (앱을 업데이트해야 한다).
 * - 그 밖에 못 열면(잠김 등) 파일은 그대로 두고 메모리에 연다.
 */
export function openDbFile(
  file: string,
  log: (tag: string, ...rest: unknown[]) => void,
  now = Date.now(),
): OpenedDb {
  try {
    return { db: openFile(file, log), memory: false };
  } catch (err) {
    if (err instanceof NewerError) {
      log('db', '새 판 저장 파일', err.version);
      return { db: memoryDb(), memory: true, trouble: { kind: 'newer', version: err.version } };
    }
    if (!isBroken(err)) {
      log('db', '못 엶', err instanceof Error ? err.message : String(err));
      return { db: memoryDb(), memory: true, trouble: { kind: 'unavailable' } };
    }
    log('db', '깨진 저장 파일', err instanceof Error ? err.message : String(err));
  }
  let moved: string;
  try {
    moved = moveAside(file, now);
  } catch (err) {
    // 옮기지 못하면(윈도우에서 다른 프로그램이 잡고 있음 등) 덮어쓰지 않는다
    log('db', '옮기지 못함', err instanceof Error ? err.message : String(err));
    return { db: memoryDb(), memory: true, trouble: { kind: 'unavailable' } };
  }
  for (const c of backupCandidates(file)) {
    if (!usable(c.path)) continue;
    try {
      copyFileSync(c.path, file);
      const db = openFile(file, log);
      log('db', '복사본으로 되살림', basename(c.path));
      return { db, memory: false, trouble: { kind: 'recovered', moved, from: c.path, at: c.at } };
    } catch (err) {
      log('db', '복사본 실패', basename(c.path), err instanceof Error ? err.message : String(err));
      for (const ext of ['', '-wal', '-shm']) rmSync(file + ext, { force: true }); // 방금 복사한 것만
    }
  }
  try {
    return { db: openFile(file, log), memory: false, trouble: { kind: 'fresh', moved } };
  } catch (err) {
    log('db', '새로 만들지 못함', err instanceof Error ? err.message : String(err));
    return { db: memoryDb(), memory: true, trouble: { kind: 'unavailable' } };
  }
}

/**
 * 메모리에 열었을 때(새 판, 못 엶) 디스크의 저장 파일을 한 시점 그대로 target 한 파일로 복사한다 (백업 내보내기, 가져오기 전 복사).
 * 가져오기와 되살리기는 .db 하나만 옮기므로 -wal 을 따로 두면 그 안의 마지막 쓰기를 잃었다.
 * 읽기 전용으로 열어 VACUUM INTO 로 WAL 까지 합쳐 쓰고, 그래도 못 열면(잠김 등) .db, -wal 을 복사한 뒤 복사본에서 합친다.
 */
export function copyDbFile(file: string, target: string): void {
  if (!existsSync(file)) throw new Error('저장 파일이 없다');
  // VACUUM INTO 처럼 있는 파일에는 쓰지 않는다 (아래에서 실패한 것을 지울 때 남의 파일을 지우지 않게)
  if (existsSync(target)) throw new Error('복사할 곳에 이미 파일이 있다');
  try {
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      db.exec('pragma busy_timeout = 2000;');
      db.exec(`vacuum into '${target.replace(/'/g, "''")}'`);
      return;
    } finally {
      db.close();
    }
  } catch {
    for (const ext of ['', '-wal', '-shm']) rmSync(target + ext, { force: true });
  }
  copyFileSync(file, target);
  if (!existsSync(`${file}-wal`)) return;
  copyFileSync(`${file}-wal`, `${target}-wal`);
  try {
    // 복사본을 열어 WAL 을 본 파일에 합친다
    const db = new DatabaseSync(target);
    try {
      db.exec('pragma wal_checkpoint(truncate)');
    } finally {
      db.close();
    }
  } finally {
    for (const ext of ['-wal', '-shm']) rmSync(target + ext, { force: true });
  }
}
