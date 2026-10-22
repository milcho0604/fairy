// 답을 기다리는 동안 보여 줄 경과 시간. 이 시간부터 "N초째" 를 붙인다 (짧은 답은 숫자 없이 지나간다)
export const ELAPSED_SHOW_AFTER_SEC = 8;
/** 화면 읽기 프로그램에는 이 간격으로만 알린다 (매초 읽으면 시끄럽다) */
export const ELAPSED_ANNOUNCE_SEC = 30;
/** 대기 중 Enter 안내가 떠 있는 시간 */
export const WAIT_NOTE_MS = 4000;

export interface Elapsed {
  min: number;
  sec: number;
}

export const elapsedOf = (ms: number): Elapsed => {
  const total = Math.max(0, Math.floor(ms / 1000));
  return { min: Math.floor(total / 60), sec: total % 60 };
};

/** 읽어 줄 값: 30초 단위로 내린 초 (0 이면 아직 알릴 것이 없다) */
export const announceStep = (ms: number): number =>
  Math.floor(Math.max(0, ms) / 1000 / ELAPSED_ANNOUNCE_SEC) * ELAPSED_ANNOUNCE_SEC;
