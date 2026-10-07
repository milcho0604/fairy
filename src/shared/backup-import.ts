// 백업 가져오기에서 무엇을 옮기고 무엇을 거를지 (버그잡이 7차). 메인의 backup.ts 가 쓴다.

/**
 * 가져올 작은 설정 파일. 사용자 AI(ai-custom.json)는 빠진다: 실행할 프로그램과 인자라 그 컴퓨터 것이 아니고,
 * 남이 만든 백업이면 이름을 "Claude" 로 속인 명령을 기본 AI 로 심을 수 있었다.
 */
export const IMPORT_FILES = [
  'settings.json',
  'chat-settings.json',
  'pet-position.json',
  'planner.json',
] as const;

/** 가져온 채팅 설정: 고른 AI 가 사용자 AI(custom-)면 기본으로 되돌린다 (그 AI 는 가져오지 않으니까) */
export function importedChatSettings(raw: unknown): { provider?: string } {
  const p = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const provider = p.provider;
  if (typeof provider !== 'string' || !/^[a-z][\w-]{0,40}$/.test(provider) || provider.startsWith('custom-'))
    return {};
  return { provider };
}

/** 백업에 들어 있던 사용자 AI 수 (옮기지 않았다고 알릴 때) */
export function customAiCount(raw: unknown): number {
  return Array.isArray(raw) ? raw.filter((c) => typeof c === 'object' && c !== null).length : 0;
}
