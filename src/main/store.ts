import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import { renameRetry } from './safe-file.ts';

// 2단계에서 SQLite 로 옮기기 전까지 쓰는 작은 JSON 저장소. 파일은 사용자 데이터 폴더에 둔다.

function pathOf(name: string): string {
  return join(app.getPath('userData'), `${name}.json`);
}

/** 없거나 깨졌으면 undefined. 내용 검사는 부르는 쪽이 한다. */
export function readJson(name: string): unknown {
  try {
    return JSON.parse(readFileSync(pathOf(name), 'utf8'));
  } catch {
    return undefined;
  }
}

/** 임시 파일에 쓰고 이름을 바꿔, 쓰다가 꺼져도 파일이 반쯤 깨지지 않게 한다. */
export function writeJson(name: string, value: unknown): void {
  const file = pathOf(name);
  mkdirSync(app.getPath('userData'), { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2));
  // 윈도우에서 백신, 색인기가 잠깐 잡고 있으면 실패해 설정 저장이 날아갔다: 짧게 다시 해 본다
  renameRetry(`${file}.tmp`, file);
}

/** 지운다. 없으면 그냥 넘어간다 (떠난 친구 펫의 위치 파일 등) */
export function removeJson(name: string): void {
  rmSync(pathOf(name), { force: true });
}
