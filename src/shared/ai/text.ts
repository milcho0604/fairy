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

/** 붙여 보낼 최근 대화 수 (예전 고정값. 지금은 글자 예산 HistoryBudget 이 먼저 자른다) */
export const HISTORY_TURNS = 4;

/** 붙여 보낼 최근 대화의 예산: 차례 수, 전체 글자 수, 한 말(질문이나 답)의 글자 수 */
export interface HistoryBudget {
  maxTurns: number;
  maxChars: number;
  maxPart: number;
}

/** 글로 붙여 보내는 CLI(gemini 등)와 기록 안 남기기: 이어가기가 없어 대화를 다 글로 준다 */
export const TEXT_BUDGET: HistoryBudget = { maxTurns: 12, maxChars: 6000, maxPart: 800 };
/** 무료 AI(로컬): 문맥이 2048 토큰이라 작게. 답 220 토큰과 지시가 들어갈 자리를 남긴다 */
export const LOCAL_BUDGET: HistoryBudget = { maxTurns: 8, maxChars: 1200, maxPart: 300 };

/** 한 말이 길면 앞부분만 남기고 줄임표를 단다 (글자 짝을 쪼개지 않는다) */
function clip(s: string, n: number): string {
  const text = s.trim();
  if (text.length <= n) return text;
  const c = text.charCodeAt(n - 1);
  return `${text.slice(0, c >= 0xd800 && c <= 0xdbff ? n - 1 : n)}…`;
}

/**
 * 같은 대화의 최근 문답을 예산 안에서 고른다. 가장 최근 것부터 담고 예산이 차면 오래된 것을 버린다.
 * 한 말이 길면 앞부분만 남기고, 빈 질문이나 빈 답은 뺀다. 순서는 오래된 것이 먼저다.
 * 가장 최근 문답 하나는 예산이 작아도 남긴다 (바로 앞 말을 잊지 않게)
 */
export function trimHistory(history: readonly Exchange[], budget: HistoryBudget): Exchange[] {
  const out: Exchange[] = [];
  let used = 0;
  for (let i = history.length - 1; i >= 0 && out.length < budget.maxTurns; i--) {
    const h = history[i];
    if (!h || !h.question.trim() || !h.answer.trim()) continue;
    const x = { question: clip(h.question, budget.maxPart), answer: clip(h.answer, budget.maxPart) };
    const size = x.question.length + x.answer.length;
    if (out.length > 0 && used + size > budget.maxChars) break;
    out.unshift(x);
    used += size;
  }
  return out;
}

/** 지난 대화 한 차례 (틀 글은 화면 말을 따른다) */
const turn = (h: Exchange) => `${t('ai.history.user')}: ${h.question}\n${t('ai.history.you')}: ${h.answer}`;

export function textPrompt(persona: string, history: readonly Exchange[], question: string): string {
  const recent = trimHistory(history, TEXT_BUDGET);
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
  const recent = trimHistory(history, TEXT_BUDGET);
  if (recent.length === 0) return question;
  return [t('ai.history.head'), ...recent.map(turn), `${t('ai.history.question')}: ${question}`].join('\n\n');
}

/** 터미널 색 코드와 커서 이동 같은 제어 문자를 지운다. */
export function stripAnsi(text: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: 터미널 제어 문자를 지우는 게 목적이다
  return text.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\u001b\][^\u0007]*\u0007/g, '');
}
