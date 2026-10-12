// 채팅 창의 같이 보기 (2026-10-13 "채팅창에서도 같이 보기가 가능하도록"). 켜 두면 질문을 보낼 때마다 채팅 창이 있는 모니터 화면을
// 찍어 질문과 함께 AI 에 보낸다. 무엇을 찍고 어디로 보내는지는 채팅 창 안에 늘 적어 두고, 처음 켤 때 한 번 묻는다.

/** 화면 기록 권한 (맥 systemPreferences.getMediaAccessStatus('screen'), 윈도우와 리눅스는 늘 granted) */
export type ScreenAccess = 'granted' | 'denied' | 'not-determined' | 'restricted' | 'unknown';

/** 메인이 채팅 창에 주는 같이 보기 상태 */
export interface ChatLookView {
  /** 켰다 (앱을 다시 켜면 꺼진다: 모르는 사이에 화면이 나가지 않게) */
  on: boolean;
  /** 처음 켤 때 안내를 보고 동의했다 (한 번만 묻는다, 파일에 남는다) */
  agreed: boolean;
  access: ScreenAccess;
}

/** 지금 AI 가 화면을 볼 수 있는지 (채팅 창이 고른 AI 와 설치, 로그인 상태로 정한다) */
export interface LookAi {
  /** 그림을 받는 AI (claude, codex 등) */
  images: boolean;
  /** 설치되고 로그인됐다 */
  ready: boolean;
}

/**
 * 채팅 창 아래 같이 보기 줄에 보일 모습.
 * - off: 꺼짐 (켜기 칸만)
 * - confirm: 처음 켜려는 중. 무엇을 찍고 어디로 보내는지 보이고 켜기, 취소
 * - on: 켬. 보낼 때 화면을 찍어 보낸다
 * - no-permission: 켰지만 화면 기록 권한이 거절됨 (설정 열기)
 * - no-ai: 켰지만 지금 AI 가 화면을 못 본다 (그림을 받는 AI 로 바꾸라는 안내)
 */
export type ChatLookPhase = 'off' | 'confirm' | 'on' | 'no-permission' | 'no-ai';

export function lookPhase(view: ChatLookView, ai: LookAi | undefined, confirming: boolean): ChatLookPhase {
  if (confirming && !view.on) return 'confirm';
  if (!view.on) return 'off';
  if (view.access === 'denied' || view.access === 'restricted') return 'no-permission';
  if (!ai?.images || !ai.ready) return 'no-ai';
  return 'on';
}

/** 이번에 보낼 때 화면을 찍어 붙일지. 켬 상태일 때만 (권한, AI 가 안 되면 글만 보낸다) */
export const shouldShoot = (phase: ChatLookPhase): boolean => phase === 'on';

/**
 * 같이 보기를 꺼 둔 채 "지금 화면 봐 줘" 처럼 물었는지. 그러면 글만 보내지 않고 화면을 같이 볼지 먼저 묻는다.
 * "화면 보호기", "화면 밝기" 같은 말까지 잡지 않게 보다, 봐 같은 보기 말이 함께 있을 때만
 */
export function asksScreen(text: string): boolean {
  const s = text.toLowerCase();
  if (/(화면|스크린)/.test(s) && /(봐|보여|보고|볼래|보이|읽어|확인)/.test(s)) return true;
  return /\bscreen\b/.test(s) && /\b(look|see|check|read|what'?s on|whats on)\b/.test(s);
}
