// 데이터 폴더 옮기기 (짝꿍 → 페어리 이름 바꾸기, 2026-10-11).
// 예전 이름 때 데이터는 <appData>/jjakkung 에 있었다. 새 이름은 <appData>/fairy.
// 처음 켤 때 새 폴더가 없고 예전 폴더에 데이터가 있으면 폴더째 이름만 바꾼다 (같은 부모 안 rename 이라 한 번에 되거나
// 아예 안 된다. 복사가 없어 큰 AI 모델 파일도 그대로). 옮긴 뒤 예전 자리에는 어디로 갔는지 적은 안내 파일만 남긴다.
// 예전 앱이 아직 떠 있거나(잠금이 살아 있음) 이름 바꾸기가 실패하면 이번에는 예전 폴더를 그대로 쓰고 다음에 다시 해 본다.
// 어느 쪽이든 데이터를 지우거나 덮어쓰지 않는다. 메인(index.ts)과 MCP 서버(mcp-server.ts)가 같이 쓴다. electron 을 부르지 않는다
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  renameSync,
  rmdirSync,
  writeFileSync,
} from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';

/** 새 데이터 폴더 이름 */
export const DATA_DIR_NAME = 'fairy';
/** 예전 이름(짝꿍) 때 데이터 폴더 이름 */
export const LEGACY_DATA_DIR_NAME = 'jjakkung';
/** 옮긴 뒤 예전 자리에 남기는 안내 파일. 이것이 있으면 다시 옮기지 않는다 */
export const MOVED_MARKER = 'MOVED-TO-FAIRY.txt';
/** 이 중 하나라도 있어야 옮길 데이터로 본다 (빈 폴더나 안내 파일만 있는 폴더는 옮기지 않는다) */
const DATA_FILES = ['jjakkung.db', 'settings.json'];

export type DataMove =
  /** 옮길 것 없음 (새로 설치했거나 이미 새 폴더) */
  | { kind: 'none' }
  /** 예전 폴더를 새 이름으로 옮겼다 */
  | { kind: 'moved'; from: string; to: string }
  /** 예전 앱이 그 폴더를 쓰는 중이라 이번에는 예전 폴더를 쓴다 */
  | { kind: 'in-use'; dir: string }
  /** 옮기지 못해 이번에는 예전 폴더를 쓴다 (다음에 켤 때 다시 해 본다) */
  | { kind: 'failed'; dir: string; error: string };

export type DataDirChoice = { dir: string; move: DataMove };

const hasData = (dir: string): boolean =>
  !existsSync(join(dir, MOVED_MARKER)) && DATA_FILES.some((f) => existsSync(join(dir, f)));

/**
 * 크로미엄 하나만 띄우기 잠금(SingletonLock, 맥과 리눅스)이 살아 있는지. 링크 내용은 "<호스트>-<pid>".
 * 다른 컴퓨터 이름이면(네트워크 홈 폴더) 살아 있다고 본다. 윈도우는 잠금이 열린 파일이라 이름 바꾸기가 실패하는 것으로 안다
 */
export function lockAlive(dir: string, isAlive: (pid: number) => boolean = pidAlive): boolean {
  const lock = join(dir, 'SingletonLock');
  let target: string;
  try {
    if (!lstatSync(lock).isSymbolicLink()) return false;
    target = readlinkSync(lock);
  } catch {
    return false;
  }
  const m = /^(.*)-(\d+)$/.exec(target);
  if (!m) return false;
  if (m[1] !== hostname()) return true;
  return isAlive(Number(m[2]));
}

function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: 있지만 다른 사용자 것. 살아 있다고 본다
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

const markerText = (to: string, at: Date) =>
  [
    '짝꿍은 이름이 페어리(fairy)로 바뀌었어요. 이 폴더의 데이터는 아래 폴더로 옮겼어요.',
    'Jjakkung is now called fairy. The data in this folder was moved to:',
    '',
    to,
    '',
    `(${at.toISOString()}) 이 안내 파일과 폴더는 지워도 돼요. / You can delete this note and folder.`,
    '',
  ].join('\n');

/**
 * 데이터 폴더를 정한다. 필요하면 예전 폴더를 옮긴다 (위 설명).
 * appData 는 운영체제의 앱 데이터 폴더 (맥 ~/Library/Application Support, 윈도우 %APPDATA%, 리눅스 ~/.config)
 */
export function chooseDataDir(
  appData: string,
  o: { now?: Date; inUse?: (dir: string) => boolean; rename?: (from: string, to: string) => void } = {},
): DataDirChoice {
  const to = join(appData, DATA_DIR_NAME);
  const from = join(appData, LEGACY_DATA_DIR_NAME);
  const none: DataDirChoice = { dir: to, move: { kind: 'none' } };
  if (!existsSync(from) || !hasData(from)) return none;
  if (existsSync(to)) {
    // 새 폴더가 비어 있을 때만(무엇이 먼저 만들어 둔 빈 폴더) 치우고 옮긴다. 무엇이든 들어 있으면 새 폴더가 주인이다
    let empty = false;
    try {
      empty = readdirSync(to).length === 0;
    } catch {
      empty = false;
    }
    if (!empty) return none;
    try {
      rmdirSync(to);
    } catch {
      return none;
    }
  }
  if ((o.inUse ?? lockAlive)(from)) return { dir: from, move: { kind: 'in-use', dir: from } };
  try {
    (o.rename ?? renameSync)(from, to);
  } catch (err) {
    // 같이 켠 다른 페어리가 먼저 옮겼으면 새 폴더를 쓴다
    if (existsSync(to) && !hasData(from)) return none;
    return { dir: from, move: { kind: 'failed', dir: from, error: (err as Error)?.message ?? String(err) } };
  }
  // 옮긴 뒤 예전 자리에 안내만 남긴다. 실패해도 데이터는 이미 새 폴더에 있다
  try {
    mkdirSync(from, { recursive: true });
    writeFileSync(join(from, MOVED_MARKER), markerText(to, o.now ?? new Date()));
  } catch {
    // 안내 파일은 없어도 된다
  }
  return { dir: to, move: { kind: 'moved', from, to } };
}

/**
 * MCP 서버용: 옮기지는 않고 읽기만. 새 폴더에 저장 파일이 없고 예전 폴더에 있으면(아직 새 앱을 켜지 않았다) 예전 폴더.
 * 옮기기는 앱이 켜질 때 한다 (MCP 서버가 옮기면 떠 있는 예전 앱과 부딪힌다)
 */
export function findDataDir(appData: string): string {
  const to = join(appData, DATA_DIR_NAME);
  const from = join(appData, LEGACY_DATA_DIR_NAME);
  if (!existsSync(join(to, 'jjakkung.db')) && hasData(from)) return from;
  return to;
}
