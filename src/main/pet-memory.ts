// MCP remember 가 남긴 기억(memory-inbox.json)을 설정의 "기다리는 기억"(petMemoryPending)으로 옮긴다.
// MCP 서버는 따로 도는 프로세스라 설정 파일을 직접 고치면 켜져 있는 짝꿍이 덮어쓴다 (shared/pet-memory.ts).
// 바로 기억(petMemory)에 넣지 않는다: 사용자가 설정에서 허락해야 AI 에게 보낸다 (리뷰 MED, 프롬프트 주입)
import { app } from 'electron';
import { mergePending } from '../shared/pet-memory.ts';
import { drainInbox } from './memory-inbox.ts';
import { settings } from './settings.ts';

/** 편지함이 있으면 기다리는 기억에 합치고 지운다 */
export function drainMemoryInbox(log: (tag: string, ...rest: unknown[]) => void): void {
  try {
    const n = drainInbox(app.getPath('userData'), (incoming) => {
      const s = settings.get();
      const next = mergePending(s.petMemoryPending, s.petMemory, incoming);
      if (next.join('\n') !== s.petMemoryPending.join('\n')) settings.set({ petMemoryPending: next });
    });
    if (n > 0) log('memory', 'inbox', settings.get().petMemoryPending.length);
  } catch (err) {
    log('memory', 'inbox failed', err instanceof Error ? err.message : String(err));
  }
}
