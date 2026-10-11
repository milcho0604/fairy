// 같이 지내는 느낌 (2026-10-11): 같이 타자 치기, 같이 일하는 표정. 순수한 판단만 여기 둔다 (메인은 main/together.ts).
//
// 같이 타자 치기의 개인정보 (꼭 지킨다):
// - 어떤 키를 눌렀는지, 무슨 글을 썼는지 읽지 않는다. 전역 키 후크(uiohook, 키 이벤트 감시)도 쓰지 않는다.
// - 운영체제가 알려 주는 "마지막 입력 뒤 지난 초"(powerMonitor.getSystemIdleTime, 키보드와 마우스를 가리지 않는 한 숫자)와
//   커서 자리만 1초에 두 번까지 본다. 입력이 있는데 커서가 그대로면 키보드(또는 스크롤, 클릭)로 친다.
// - 아무것도 저장하거나 보내지 않는다. 판단 결과(지금 입력 중인지)만 펫 화면에 넘긴다.

/** 같이 타자 치기 빠르기 */
export const TYPING = {
  /** 입력이 이어지는 동안 보는 간격 (1초에 두 번) */
  pollMs: 500,
  /** 한동안 입력이 없을 때 보는 간격 */
  slowPollMs: 1000,
  /** 이만큼 넘게 손을 안 댔으면 느슨히 본다 (초) */
  slowAfterSec: 5,
  /** 키보드 같은 입력이 이만큼 연달아 보이면 시작 (500ms 간격이면 1.5초 동안 이어 쳤다) */
  startSamples: 3,
  /** 마지막 키보드 같은 입력에서 이만큼 지나면 그친다 */
  stopMs: 1500,
  /**
   * 이만큼 한 번도 쉬는 틈(입력 없는 1초)이 없으면 운영체제가 입력 시각을 못 주는 것으로 본다 (일부 리눅스는 늘 0).
   * 사람은 10분 동안 1초도 안 쉬고 치지 못한다. 그러면 다음 틈이 보일 때까지 같이 치지 않는다
   */
  brokenAfterMs: 10 * 60_000,
} as const;

/** 한 번 본 것 */
export interface TypingSample {
  /** 본 시각 (ms) */
  at: number;
  /** 운영체제가 알려 준 마지막 입력 뒤 지난 초 (정수) */
  idleSec: number;
  /** 지난번에 본 뒤로 커서가 움직였는지 */
  cursorMoved: boolean;
}

export interface TypingState {
  /** 지금 같이 치는 중 */
  active: boolean;
  /** 키보드 같은 입력이 연달아 보인 수 */
  run: number;
  /** 마지막 키보드 같은 입력을 본 때 (없으면 -1) */
  lastKeyAt: number;
  /** 마지막으로 쉬는 틈(입력 뒤 1초 넘음)을 본 때. 처음 보기 전이면 처음 본 때 (없으면 -1) */
  lastPauseAt?: number;
}

export const TYPING_IDLE: TypingState = { active: false, run: 0, lastKeyAt: -1 };

/** 키보드 같은 입력인지: 방금(1초 안) 입력이 있었고 커서는 그대로다 */
export const keyLike = (s: TypingSample): boolean => s.idleSec <= 0 && !s.cursorMoved;

/**
 * 다음 상태. 키보드 같은 입력이 startSamples 번 이어지면 시작, 마지막 것에서 stopMs 가 지나면 그친다.
 * 마우스만 움직인 것은 이어진 수를 끊지만 치는 중이면 바로 그치지 않는다 (치다가 잠깐 마우스를 만질 수 있다)
 */
export function nextTyping(state: TypingState, s: TypingSample): TypingState {
  const lastPauseAt = s.idleSec >= 1 || state.lastPauseAt === undefined ? s.at : state.lastPauseAt;
  // 입력 시각을 못 주는 운영체제 (늘 0): 다음 틈이 보일 때까지 쉰다
  if (s.at - lastPauseAt >= TYPING.brokenAfterMs)
    return { active: false, run: 0, lastKeyAt: -1, lastPauseAt };
  if (keyLike(s)) {
    const run = state.run + 1;
    return { active: state.active || run >= TYPING.startSamples, run, lastKeyAt: s.at, lastPauseAt };
  }
  const stale = state.lastKeyAt < 0 || s.at - state.lastKeyAt >= TYPING.stopMs;
  return { active: state.active && !stale, run: 0, lastKeyAt: state.lastKeyAt, lastPauseAt };
}

/** 다음에 볼 때까지 (ms): 손을 안 댄 지 오래면 느슨히, 아니면 촘촘히 */
export function typingPollMs(idleSec: number): number {
  return idleSec > TYPING.slowAfterSec ? TYPING.slowPollMs : TYPING.pollMs;
}

/** 같이 타자 치기를 볼지: 설정이 켜졌고, 배터리 절약이 아니고, 펫이 보이고 깨어 있을 때만 (자는 집중 중에는 안 본다) */
export function typingWanted(o: { on: boolean; saver: boolean; hidden: boolean; asleep: boolean }): boolean {
  return o.on && !o.saver && !o.hidden && !o.asleep;
}

// ---- 같이 일하는 표정 ----

/**
 * AI 도구(Claude Code, Codex)가 짝꿍 MCP 서버를 부르면 서버가 사용자 데이터 폴더의 이 파일 시각만 바꾼다
 * (무엇을 불렀는지는 적지 않는다). 메인이 시각을 보고 잠깐 같이 일하는 표정을 짓는다
 */
export const MCP_BEAT_FILE = 'mcp-beat';
/** 부른 뒤 이만큼 같이 일하는 표정 */
export const WORK_LOOK_MS = 20_000;
/** 파일 시각을 보는 간격 */
export const WORK_POLL_MS = 2000;

/** 펫 화면에 넘기는 모습 */
export interface TogetherLook {
  /** 사용자가 입력하는 중: 앞발로 작은 키보드를 두드린다 */
  typing: boolean;
  /** AI 가 짝꿍 도구를 쓰는 중: 집중한 눈썹, 연필, 반짝 */
  working: boolean;
  /** 들고 있는 쪽지 (note 쪽지, letter 특별한 편지). 없으면 안 든다 */
  note?: NoteLook;
}

export type NoteLook = 'note' | 'letter';

export const NO_TOGETHER: TogetherLook = { typing: false, working: false };

export function sameTogether(a: TogetherLook, b: TogetherLook): boolean {
  return a.typing === b.typing && a.working === b.working && a.note === b.note;
}

/** 새 beat 시각이 보이면 그때부터 WORK_LOOK_MS 동안 같이 일한다. 처음 본 시각(켜기 전에 남은 것)은 지난 일로 친다 */
export function workingNow(beatAt: number | undefined, seenAt: number | undefined, now: number): boolean {
  if (beatAt === undefined || seenAt === undefined || beatAt <= seenAt) return false;
  return now - beatAt < WORK_LOOK_MS;
}
