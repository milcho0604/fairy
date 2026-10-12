// 그림으로 들어 있는 기본 캐릭터(밀크, 초코)의 PNG 를 사용자 데이터 pets/ 로 복사한다 (shared/starter-pets.ts).
// electron 없이 시험할 수 있게 폴더를 받는다. 앱에 든 파일이라도 형식과 크기를 확인한다 (깨진 설치, 바꿔 끼운 파일)
import { existsSync, lstatSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { imageKind, sizeOk } from '../shared/image-head.ts';
import {
  isStarterId,
  STARTER_MAX_BYTES,
  STARTER_WALK_FRAMES,
  STARTER_WALK_MAX_BYTES,
  type StarterId,
  starterFileName,
  starterResource,
  starterWalkResource,
} from '../shared/starter-pets.ts';
import { writeFileAtomic } from './safe-file.ts';

/** 앱에 든 그림을 읽는다. 일반 파일이 아니거나 크거나 PNG 가 아니거나 가로세로가 터무니없으면 undefined */
export function readStarter(srcDir: string, id: StarterId): Buffer | undefined {
  if (!isStarterId(id)) return undefined;
  const path = join(srcDir, starterResource(id));
  try {
    // 링크는 따라가지 않는다 (lstat)
    const st = lstatSync(path);
    if (!st.isFile() || st.size > STARTER_MAX_BYTES) return undefined;
    const bytes = readFileSync(path);
    if (bytes.length > STARTER_MAX_BYTES || imageKind(bytes) !== 'png' || !sizeOk(bytes)) return undefined;
    return bytes;
  } catch {
    return undefined;
  }
}

/**
 * 그림을 destDir 에 새 이름(pet-<id>-<시각>.png)으로 쓰고 파일 이름을 돌려준다. 같은 이름이 있으면 시각을 늘려
 * 덮어쓰지 않는다 (보관함에 있는 다른 복사본을 지키려고). 그림을 못 읽으면 undefined
 */
export function copyStarter(
  srcDir: string,
  destDir: string,
  id: StarterId,
  now = Date.now(),
): string | undefined {
  const bytes = readStarter(srcDir, id);
  if (!bytes) return undefined;
  mkdirSync(destDir, { recursive: true });
  let at = now;
  let file = starterFileName(id, at);
  while (existsSync(join(destDir, file))) file = starterFileName(id, ++at);
  writeFileAtomic(join(destDir, file), bytes);
  return file;
}

/**
 * 앱에 든 옆모습 걷기 그림들 (shared/starter-pets.ts STARTER_WALK_FRAMES). 한 장이라도 못 읽으면 빈 배열:
 * 몇 장 빠진 채로 넘기면 다리가 튀어 보여서, 그때는 예전처럼 사진 한 장으로 걷는다
 */
export function readStarterWalk(srcDir: string, id: StarterId): Buffer[] {
  if (!isStarterId(id)) return [];
  const n = STARTER_WALK_FRAMES[id] ?? 0;
  const out: Buffer[] = [];
  for (let i = 0; i < n; i++) {
    try {
      const path = join(srcDir, starterWalkResource(id, i));
      const st = lstatSync(path);
      if (!st.isFile() || st.size > STARTER_WALK_MAX_BYTES) return [];
      const bytes = readFileSync(path);
      if (imageKind(bytes) !== 'webp' || !sizeOk(bytes)) return [];
      out.push(bytes);
    } catch {
      return [];
    }
  }
  return out;
}
