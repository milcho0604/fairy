// 백업 가져오기에서 무엇을 옮기고 무엇을 거를지 (버그잡이 7차). 메인의 backup.ts 가 쓴다.

/**
 * 가져올 작은 설정 파일. 사용자 AI(ai-custom.json)는 빠진다: 실행할 프로그램과 인자라 그 컴퓨터 것이 아니고,
 * 남이 만든 백업이면 이름을 "Claude" 로 속인 명령을 기본 AI 로 심을 수 있었다.
 */
/**
 * 펫과 같이 지낸 기록 (2026-10-11 에 생긴 작은 파일들): 자란 단계, 첫 7일 여정, 매일 쪽지함과 받은 편지, 기념일 인사,
 * 일기 다듬은 글, 생일 인사한 날. 백업에 없어 새 컴퓨터로 옮기면 첫 7일 여정이 다시 뜨고, 쪽지함이 비고,
 * 받았던 기념 편지(코인 선물)를 또 받았다. 읽을 때 모두 모양을 검사한다
 */
export const PET_STATE_FILES = [
  'grow.json',
  'journey.json',
  'daily-note.json',
  'pet-memory.json',
  'diary.json',
  'knows.json',
  // 사용자가 고친 펫 대사 (#125). 고친 칸만 든다. 읽을 때 사전에 맞춰 정리한다 (main/lines.ts)
  'speech-lines.json',
] as const;

export const IMPORT_FILES = [
  'settings.json',
  'chat-settings.json',
  'pet-position.json',
  'planner.json',
  ...PET_STATE_FILES,
] as const;

/**
 * 새 백업 파일(.fairybackup)에 담는 작은 파일: 가져오는 것만. 사용자 AI(ai-custom.json)는 복원에 쓰지 않으니 담지 않는다 (이슈 #90)
 */
export const BACKUP_FILE_ITEMS: readonly string[] = IMPORT_FILES;

/**
 * 백업 파일을 풀 때 받는 맨 위 파일. 담는 것에 더해, 이 규칙 전에 만든 파일에 든 ai-custom.json 도 받는다
 * (복원하지 않고 옮기지 않는다고 알릴 개수 세기에만 쓴다). 이 밖의 맨 위 이름은 거절한다
 */
export const BACKUP_READ_TOP: readonly string[] = ['jjakkung.db', ...IMPORT_FILES, 'ai-custom.json'];

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
