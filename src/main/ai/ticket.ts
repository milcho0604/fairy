// AI 대화권으로 묻기 (기획서 8절, 이슈 #100). 앱은 API 키를 모르고 페어리 서버가 Claude 를 중계한다.
// 이어가기 세션이 없어 최근 문답 몇 개를 붙여 보낸다(서버 상한 안으로). Electron 없이 돌아 시험에서 그대로 부른다.
import type { Exchange } from '../../shared/ai/text.ts';
import type { AiError, AiEvent } from '../../shared/ai/types.ts';
import { type Lang, t } from '../../shared/i18n/index.ts';
import type { AiChatBody, AiChatOutcome } from '../server-api.ts';

/** 붙여 보낼 최근 문답 수 */
export const TICKET_HISTORY = 4;
/**
 * 서버 상한 안으로 자른다. 질문 글자 수는 사용자가 친 마지막 질문만 센다 (서버 .env 상한 AI_MAX_TOTAL_CHARS 8000 이하,
 * 운영자가 더 낮추면 서버가 too_long). 요청 전체(앞 문답 + 앱이 붙인 글 + 질문)는 서버 안전 상한 12000 보다 낮은 11500 으로 묶는다
 */
export const MAX_QUESTION = 8000;
const MAX_HISTORY_PART = 1500;
const MAX_TOTAL = 11500;
/** 질문 앞에 붙는 글의 상한 (서버 AI_MAX_PREFIX_CHARS 3000 안) */
export const MAX_LEAD = 3000;
const MAX_PERSONA = 600;

/** 채팅이 쓰는 대화권 손잡이 (main/server.ts 가 server-core 를 붙인다) */
export interface TicketHooks {
  /** 서버 모드, 만 18세 이상, 구글 로그인 */
  available(): boolean;
  tickets(): number | null;
  /** 국외 이전 안내를 읽고 쓰기로 했다 */
  agreed(): boolean;
  agree(): void;
  ask(body: AiChatBody, onText: (text: string) => void, signal?: AbortSignal): Promise<AiChatOutcome>;
  report(question: string, answer: string): Promise<boolean>;
  /** 남은 수를 서버에서 다시 받는다 (채팅 창을 열 때) */
  refresh?(): Promise<void>;
}

/** 글자 짝(서로게이트)을 쪼개지 않고 앞에서 n 칸(UTF-16, 서버가 세는 단위)까지 */
function cutHead(s: string, n: number): string {
  if (s.length <= n) return s;
  const c = s.charCodeAt(n - 1);
  return s.slice(0, c >= 0xd800 && c <= 0xdbff ? n - 1 : n);
}

/** 앞에서 n 칸 까지가 아니라 뒤에서 n 칸 (짝을 쪼개지 않는다) */
function cutTail(s: string, n: number): string {
  if (s.length <= n) return s;
  const c = s.charCodeAt(s.length - n);
  return s.slice(c >= 0xdc00 && c <= 0xdfff ? s.length - n + 1 : s.length - n);
}

/**
 * 질문 앞에 붙은 글(시각 줄 + 오늘 상황 목록 + "[질문]" 머리글)을 max 칸 안으로. 첫 줄(시각)과 끝 세 줄(목록을 닫는 줄,
 * "[질문]" 머리글, 빈 줄)은 지키고 가운데 할 일 목록을 줄인다
 */
export function fitLead(lead: string, max: number): string {
  if (lead.length <= max) return lead;
  const lines = lead.split('\n');
  const first = lines[0] ?? '';
  const tail = lines.slice(-3);
  const middle = lines.slice(1, -3).join('\n');
  const head = `${first}\n`;
  const end = `\n${tail.join('\n')}`;
  const room = Math.max(0, max - head.length - end.length);
  if (lines.length <= 4 || room <= 0) return cutTail(lead, max);
  return head + cutHead(middle, room) + end;
}

/**
 * 질문과 최근 문답을 서버에 보낼 메시지로. prompt 는 질문 앞에 시각 줄, 머리글, 할 일 목록을 붙인 글이고
 * question 은 사용자가 친 글 그대로다 (질문 글자 수는 이것만 센다. 서버는 마지막 말이 이 글로 끝나는지도 본다).
 * 오래된 문답부터 빼서 전체 상한 안으로. 그래도 넘거나 앞에 붙은 글이 길면 할 일 목록을 줄이고, 머리글과 질문은 자르지 않는다
 */
export function ticketMessages(
  history: readonly Exchange[],
  prompt: string,
  question: string = prompt,
): AiChatBody['messages'] {
  const pairs = history
    .slice(-TICKET_HISTORY)
    .filter((x) => x.question.trim() && x.answer.trim())
    .map((x) => [cutHead(x.question, MAX_HISTORY_PART), cutHead(x.answer, MAX_HISTORY_PART)] as const);
  const splits = prompt.endsWith(question);
  let lead = splits ? fitLead(prompt.slice(0, prompt.length - question.length), MAX_LEAD) : '';
  const body = splits ? question : prompt;
  const used = () => lead.length + body.length + pairs.reduce((n, [a, b]) => n + a.length + b.length, 0);
  while (pairs.length > 0 && used() > MAX_TOTAL) pairs.shift();
  if (used() > MAX_TOTAL) lead = fitLead(lead, Math.max(0, MAX_TOTAL - body.length));
  return [
    ...pairs.flatMap(([a, b]) => [
      { role: 'user' as const, content: a },
      { role: 'assistant' as const, content: b },
    ]),
    { role: 'user' as const, content: lead + body },
  ];
}

/** 서버의 실패 까닭을 채팅 오류로. got: 끊기기 전에 받은 글이 있다 */
export function ticketError(r: Extract<AiChatOutcome, { ok: false }>, got: boolean): AiError {
  switch (r.error) {
    case 'no_tickets':
      return { kind: 'no-tickets', message: t('ticket.empty') };
    case 'daily_limit':
      return { kind: 'rate-limit', message: t('ticket.daily') };
    case 'budget':
      return { kind: 'rate-limit', message: t('ticket.budget') };
    case 'rate_limited':
      return { kind: 'rate-limit', message: t('ai.error.rateLimit', { label: t('ticket.label') }) };
    case 'timeout':
      return { kind: 'timeout', message: t('ticket.timeout') };
    case 'cancelled':
      return { kind: 'cancelled', message: t('ai.error.cancelled') };
    case 'ai_off':
      return { kind: 'failed', message: t('ticket.off') };
    case 'not_allowed':
      return { kind: 'failed', message: t('ticket.notAllowed') };
    case 'blocked':
      return { kind: 'failed', message: t('ticket.blocked') };
    case 'waitlisted':
      return { kind: 'failed', message: t('ticket.waitlisted') };
    case 'refusal':
      return { kind: 'failed', message: t('ticket.refusal') };
    // 426: 서버 관문이 낡은 앱이라고 막았다 (이슈 #120). 이용권은 쓰지 않았다
    case 'update_required':
      return { kind: 'failed', message: t('ticket.update') };
    case 'login':
    case 'age':
    case 'token':
      return { kind: 'not-logged-in', message: t('ticket.login') };
    case 'too_long':
    case 'messages':
      return { kind: 'failed', message: t('ticket.tooLong') };
    case 'offline':
      return { kind: 'failed', message: got ? t('ticket.cut') : t('ticket.offline') };
    default:
      return { kind: 'failed', message: t('ticket.failed') };
  }
}

export interface TicketRun {
  cancel(): void;
  finished: Promise<void>;
}

/** 대화권 질문 하나. 사건은 다른 AI 와 같은 모양(delta, done, error)으로 */
export function runTicket(
  req: { history: readonly Exchange[]; text: string; question: string; persona: string; lang: Lang },
  hooks: TicketHooks,
  onEvent: (e: AiEvent) => void,
): TicketRun {
  const ac = new AbortController();
  let text = '';
  // 질문이 서버 최대(8000자)를 넘으면 보내지 않는다 (서버의 too_long 과 같은 안내, 이용권은 쓰지 않는다)
  if (req.question.length > MAX_QUESTION) {
    const error = ticketError({ ok: false, status: 400, error: 'too_long' }, false);
    return { cancel: () => {}, finished: Promise.resolve().then(() => onEvent({ type: 'error', error })) };
  }
  const finished = hooks
    .ask(
      {
        messages: ticketMessages(req.history, req.text, req.question),
        question: req.question,
        lang: req.lang,
        persona: req.persona.slice(0, MAX_PERSONA),
      },
      (piece) => {
        text += piece;
        onEvent({ type: 'delta', text: piece });
      },
      ac.signal,
    )
    .then(
      (r) => {
        if (r.ok) onEvent({ type: 'done', text });
        else
          onEvent({
            type: 'error',
            error: ticketError(ac.signal.aborted ? { ...r, error: 'cancelled' } : r, !!text),
            // 거절은 받은 앞부분이 답이 아니다: 말풍선에서 그 글을 지우고 안내만 남긴다 (이용권은 서버가 되돌렸다)
            ...(r.error === 'refusal' && !ac.signal.aborted ? { dropText: true } : {}),
          });
      },
      () => onEvent({ type: 'error', error: { kind: 'failed', message: t('ticket.failed') } }),
    );
  return { cancel: () => ac.abort(), finished };
}
