// 기억 받은 편지함 (userData/memory-inbox.json). MCP remember 가 쓰고 짝꿍이 읽어 "기다리는 기억"으로 옮긴다.
// Electron 을 불러오지 않는다 (MCP 서버도 이 파일을 쓴다). 두 프로세스가 같은 파일을 만지니 이름 바꾸기로 주고받는다.

import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { addMemory, cleanMemory, MEMORY_INBOX } from '../shared/pet-memory.ts';

const INBOX = `${MEMORY_INBOX}.json`;
/** 다른 프로세스와 겹치지 않는 이름 조각 */
const unique = () => `${process.pid}-${Date.now()}-${randomBytes(4).toString('hex')}`;
/** 읽는 중인 편지함 이름: memory-inbox.json.taking (예전) 또는 memory-inbox.json.<조각>.taking */
const isTaking = (name: string) => name.startsWith(`${INBOX}.`) && name.endsWith('.taking');

/**
 * 편지함을 읽어 apply 에 넘기고 지운다. 이름을 먼저 바꿔 읽는 사이에 MCP 가 새로 쓴 것을 잃지 않게 한다.
 * 지난번에 읽다 꺼져 남은 .taking 파일도 같이 읽는다 (리뷰: 예전에는 다음 이름 바꾸기가 그 위에 덮어써 잃었다).
 * apply 가 던지면 .taking 을 지우지 않고 남겨 다음에 다시 읽는다. 읽은 글 목록 수를 돌려준다
 */
export function drainInbox(dir: string, apply: (incoming: unknown) => void): number {
  const file = join(dir, INBOX);
  try {
    renameSync(file, join(dir, `${INBOX}.${unique()}.taking`));
  } catch {
    // 없음 (거의 늘 이쪽). 남은 .taking 은 그래도 본다
  }
  let names: string[];
  try {
    names = readdirSync(dir).filter(isTaking).sort();
  } catch {
    return 0;
  }
  let n = 0;
  for (const name of names) {
    const path = join(dir, name);
    let incoming: unknown;
    try {
      incoming = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      // 깨진 파일은 다시 읽어도 깨져 있다. 버린다
      rmSync(path, { force: true });
      continue;
    }
    apply(incoming);
    rmSync(path, { force: true });
    n++;
  }
  return n;
}

/**
 * 편지함에 하나 더한다 (MCP remember). 임시 파일은 프로세스마다 다른 이름으로 쓰고 이름을 바꾼다.
 * 다른 MCP 가 같은 때 써서 내 것이 덮였으면 다시 해 본다 (리뷰: 같은 .tmp 이름을 둘이 써서 깨지거나 잃었다).
 * 이미 편지함에 있으면 false
 */
export function writeInbox(dir: string, text: string, tries = 3): boolean {
  const file = join(dir, INBOX);
  for (let i = 0; i < tries; i++) {
    let list: string[] = [];
    try {
      list = cleanMemory(JSON.parse(readFileSync(file, 'utf8')));
    } catch {
      // 없거나 깨졌으면 새로
    }
    const next = addMemory(list, text);
    if (!next.added && i === 0) return false;
    if (!next.added) return true; // 다시 읽었더니 들어 있다
    const tmp = join(dir, `${INBOX}.${unique()}.tmp`);
    try {
      writeFileSync(tmp, JSON.stringify(next.list));
      renameSync(tmp, file);
    } catch (err) {
      rmSync(tmp, { force: true });
      if (i === tries - 1) throw err;
      continue;
    }
    // 내 것이 남았는지 본다. 짝꿍이 그새 가져갔으면(파일 없음) 가져간 것이니 된 것이다
    try {
      const now = cleanMemory(JSON.parse(readFileSync(file, 'utf8')));
      if (!addMemory(now, text).added) return true;
    } catch {
      return true;
    }
  }
  return true;
}
