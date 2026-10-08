// 그 밖의 CLI(Gemini, 사용자가 추가한 AI)는 질문을 인자로 주고 표준 출력을 그대로 답으로 본다.
// 대화를 이어 가는 기능이 없다고 보고, 최근 대화를 질문 앞에 붙여 보낸다.

import { t } from '../i18n/index.ts';

export interface Exchange {
  question: string;
  answer: string;
}

/**
 * 질문을 CLI 인자로 넘길 때 "-" 로 시작하면 옵션으로 읽힌다 (codex: "unexpected argument").
 * 앞에 빈칸 하나를 붙이면 값으로 읽히고 답에는 영향이 없다.
 */
export const argText = (text: string) => (text.startsWith('-') ? ` ${text}` : text);

/** 붙여 보낼 최근 대화 수. 길수록 정확하지만 느리고 비싸다. */
export const HISTORY_TURNS = 4;

/** 지난 대화 한 차례 (틀 글은 화면 말을 따른다) */
const turn = (h: Exchange) => `${t('ai.history.user')}: ${h.question}\n${t('ai.history.you')}: ${h.answer}`;

export function textPrompt(persona: string, history: readonly Exchange[], question: string): string {
  const recent = history.slice(-HISTORY_TURNS);
  const parts = [persona];
  if (recent.length) parts.push(t('ai.history.head'), ...recent.map(turn));
  parts.push(`${t('ai.history.question')}: ${question}`);
  return parts.join('\n\n');
}

/**
 * 기록 남기지 않기(v1)일 때 claude, codex 는 이어가기를 못 쓴다. 최근 대화를 질문 앞에 붙인다.
 * 성격 지시는 따로 주므로 넣지 않는다. 앞 대화가 없으면 질문 그대로.
 */
export function withHistory(history: readonly Exchange[], question: string): string {
  const recent = history.slice(-HISTORY_TURNS);
  if (recent.length === 0) return question;
  return [t('ai.history.head'), ...recent.map(turn), `${t('ai.history.question')}: ${question}`].join('\n\n');
}

/** 터미널 색 코드와 커서 이동 같은 제어 문자를 지운다. */
export function stripAnsi(text: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: 터미널 제어 문자를 지우는 게 목적이다
  return text.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\u001b\][^\u0007]*\u0007/g, '');
}
