// 그 밖의 CLI(Gemini, 사용자가 추가한 AI)는 질문을 인자로 주고 표준 출력을 그대로 답으로 본다.
// 대화를 이어 가는 기능이 없다고 보고, 최근 대화를 질문 앞에 붙여 보낸다.

export interface Exchange {
  question: string;
  answer: string;
}

/** 붙여 보낼 최근 대화 수. 길수록 정확하지만 느리고 비싸다. */
export const HISTORY_TURNS = 4;

export function textPrompt(persona: string, history: readonly Exchange[], question: string): string {
  const recent = history.slice(-HISTORY_TURNS);
  const parts = [persona];
  if (recent.length) {
    parts.push('지금까지 대화:', ...recent.map((h) => `사용자: ${h.question}\n너: ${h.answer}`));
  }
  parts.push(`사용자 질문: ${question}`);
  return parts.join('\n\n');
}

/** 터미널 색 코드와 커서 이동 같은 제어 문자를 지운다. */
export function stripAnsi(text: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: 터미널 제어 문자를 지우는 게 목적이다
  return text.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\u001b\][^\u0007]*\u0007/g, '');
}
