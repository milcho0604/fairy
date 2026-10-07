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
    super(`이 저장 파일(${version}판)은 이 짝꿍(${SCHEMA_VERSION}판)보다 새 판이다`);
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
