// MCP remember 가 남긴 기억(memory-inbox.json)을 설정의 petMemory 로 옮긴다.
// MCP 서버는 따로 도는 프로세스라 설정 파일을 직접 고치면 켜져 있는 짝꿍이 덮어쓴다 (shared/pet-memory.ts)
import { readFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import { MEMORY_INBOX, mergeMemory } from '../shared/pet-memory.ts';
import { settings } from './settings.ts';

/** 편지함이 있으면 합치고 지운다. 이름을 먼저 바꿔 읽는 사이에 MCP 가 새로 쓴 것을 잃지 않게 */
export function drainMemoryInbox(log: (tag: string, ...rest: unknown[]) => void): void {
  const file = join(app.getPath('userData'), `${MEMORY_INBOX}.json`);
  const taking = `${file}.taking`;
  try {
    renameSync(file, taking);
  } catch {
    return; // 없음 (거의 늘 이쪽)
  }
  try {
    const incoming = JSON.parse(readFileSync(taking, 'utf8'));
    const prev = settings.get().petMemory;
    const next = mergeMemory(prev, incoming);
    if (next.join('\n') !== prev.join('\n')) settings.set({ petMemory: next });
    log('memory', 'inbox', next.length);
  } catch (err) {
    log('memory', 'inbox failed', err instanceof Error ? err.message : String(err));
  } finally {
    rmSync(taking, { force: true });
  }
}
