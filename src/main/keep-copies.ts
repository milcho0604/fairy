// 안전 복사본 정리 (2026-10-11 데이터 점검). 짝꿍이 지우지 않고 남겨 두는 것들이 끝없이 쌓이지 않게 한다.
// - before-import-<시각>/   백업을 가져오기 전 지금 데이터 (backup.ts)
// - jjakkung.db.bak-v<판>    저장 파일 판을 올리기 전 복사 (db-open.ts)
// - jjakkung-broken-<시각>.db(-wal, -shm), <이름>-broken-<시각>.json   깨져서 옆으로 옮긴 파일 (db-open.ts, json-file.ts)
// 종류마다 새것 3개는 늘 남기고, 그보다 오래된 것도 30일이 안 됐으면 남긴다. 설정의 저장 공간에서 보고 지울 수 있다.
// Electron 없이 시험하려고 폴더를 받는다.
import { lstatSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export type CopyKind = 'beforeImport' | 'dbVersion' | 'broken';

export interface KeptCopy {
  /** 데이터 폴더 안 이름 (폴더면 폴더 이름) */
  name: string;
  kind: CopyKind;
  /** 고친 때 (ms) */
  at: number;
  bytes: number;
}

export const KEEP_NEWEST = 3;
export const KEEP_DAYS = 30;

/** 이름으로 종류를 본다. 따라붙는 -wal, -shm 은 본 파일과 같이 다루므로 따로 세지 않는다 */
export function copyKind(name: string): CopyKind | undefined {
  if (/^before-import-\d{8}-\d{4}(-\d+)?$/.test(name)) return 'beforeImport';
  if (/^jjakkung\.db\.bak-v\d+$/.test(name)) return 'dbVersion';
  if (/^jjakkung-broken-\d{8}-\d{6}(-\d+)?\.db$/.test(name)) return 'broken';
  if (/^[\w.-]+-broken-\d{8}-\d{6}(-\d+)?\.json$/.test(name)) return 'broken';
  return undefined;
}

function bytesOf(p: string): number {
  try {
    const st = lstatSync(p);
    if (!st.isDirectory()) return st.isFile() ? st.size : 0;
    let n = 0;
    for (const f of readdirSync(p)) n += bytesOf(join(p, f));
    return n;
  } catch {
    return 0;
  }
}

/** 데이터 폴더의 안전 복사본, 새것부터 */
export function listCopies(dir: string): KeptCopy[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const out: KeptCopy[] = [];
  for (const name of names) {
    const kind = copyKind(name);
    if (!kind) continue;
    try {
      const st = lstatSync(join(dir, name));
      if (st.isSymbolicLink()) continue;
      const side = kind === 'broken' && name.endsWith('.db') ? ['-wal', '-shm'] : [];
      const bytes = bytesOf(join(dir, name)) + side.reduce((a, s) => a + bytesOf(join(dir, name + s)), 0);
      out.push({ name, kind, at: st.mtimeMs, bytes });
    } catch {
      // 그새 없어졌다
    }
  }
  return out.sort((a, b) => b.at - a.at);
}

/** 하나 지운다 (이름이 안전 복사본 모양일 때만). 깨진 저장 파일은 -wal, -shm 도 같이 */
export function removeCopy(dir: string, name: string): boolean {
  const kind = copyKind(name);
  if (!kind || name.includes('/') || name.includes('\\')) return false;
  try {
    rmSync(join(dir, name), { recursive: true, force: true });
    if (kind === 'broken' && name.endsWith('.db'))
      for (const s of ['-wal', '-shm']) rmSync(join(dir, name + s), { force: true });
    return true;
  } catch {
    return false;
  }
}

/** 그 종류의 가장 새 복사본에서 이만큼 안인 것은 시계와 상관없이 남긴다 (일) */
export const KEEP_RECENT_DAYS = 7;

/**
 * 지울 것: 종류마다 새것 KEEP_NEWEST 개 밖이면서 KEEP_DAYS 일이 지났고, 그 종류의 가장 새 복사본보다
 * KEEP_RECENT_DAYS 일 넘게 오래된 것. 뒤 조건은 시계가 앞으로 튄 때(배터리 나간 컴퓨터, 잘못 맞춘 날짜)
 * 최근 되살리기 복사본을 한꺼번에 지우지 않게 한다 (버그잡이 4)
 */
export function expiredCopies(list: readonly KeptCopy[], now: number): KeptCopy[] {
  const seen = new Map<CopyKind, number>();
  const newest = new Map<CopyKind, number>();
  const out: KeptCopy[] = [];
  for (const c of [...list].sort((a, b) => b.at - a.at)) {
    const n = (seen.get(c.kind) ?? 0) + 1;
    seen.set(c.kind, n);
    if (!newest.has(c.kind)) newest.set(c.kind, c.at);
    const fromNewest = (newest.get(c.kind) ?? c.at) - c.at;
    if (n > KEEP_NEWEST && now - c.at > KEEP_DAYS * 86_400_000 && fromNewest > KEEP_RECENT_DAYS * 86_400_000)
      out.push(c);
  }
  return out;
}

/** 켤 때 한 번: 오래된 안전 복사본을 지운다. 지운 이름들 */
export function pruneCopies(dir: string, now = Date.now()): string[] {
  const gone: string[] = [];
  for (const c of expiredCopies(listCopies(dir), now)) if (removeCopy(dir, c.name)) gone.push(c.name);
  return gone;
}
