import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AiEvent } from '../../shared/ai/types.ts';
import { setLang } from '../../shared/i18n/index.ts';
import type { AiChatOutcome } from '../server-api.ts';
import { runTicket, TICKET_HISTORY, type TicketHooks, ticketError, ticketMessages } from './ticket.ts';

test('보낼 메시지: 최근 문답 몇 개와 질문, 오래된 것부터 빼서 서버 상한 안으로', () => {
  assert.deepEqual(ticketMessages([], '안녕'), [{ role: 'user', content: '안녕' }]);
  const history = Array.from({ length: 6 }, (_, i) => ({ question: `q${i}`, answer: `a${i}` }));
  const m = ticketMessages(history, '지금');
  assert.equal(m.length, TICKET_HISTORY * 2 + 1);
  assert.deepEqual(m[0], { role: 'user', content: 'q2' });
  assert.deepEqual(m.at(-1), { role: 'user', content: '지금' });
  const long = Array.from({ length: 4 }, () => ({ question: 'q'.repeat(2000), answer: 'a'.repeat(2000) }));
  const cut = ticketMessages(long, 'x'.repeat(4500));
  const total = cut.reduce((n, x) => n + x.content.length, 0);
  assert.ok(total <= 7500, String(total));
  assert.equal(cut.at(-1)?.content.length, 4000);
  // 빈 답(안내 말 등)은 붙이지 않는다
  assert.equal(ticketMessages([{ question: 'q', answer: ' ' }], 'z').length, 1);
});

test('서버 실패를 채팅 오류로 (다 씀은 no-tickets, 상한은 rate-limit 이라 다른 AI 로 다시 묻기가 뜬다)', () => {
  setLang('ko');
  const f = (error: string): Extract<AiChatOutcome, { ok: false }> => ({ ok: false, status: 400, error });
  assert.deepEqual(ticketError(f('no_tickets'), false), {
    kind: 'no-tickets',
    message: '대화권을 다 썼어. 내 컴퓨터의 AI로 이어서 할까?',
  });
  assert.equal(ticketError(f('daily_limit'), false).kind, 'rate-limit');
  assert.equal(ticketError(f('budget'), false).kind, 'rate-limit');
  assert.equal(ticketError(f('age'), false).kind, 'not-logged-in');
  assert.equal(ticketError(f('timeout'), false).kind, 'timeout');
  assert.match(ticketError(f('upstream'), false).message, /돌려놓았어/);
  assert.match(ticketError(f('offline'), false).message, /쓰지 않았어/);
  assert.match(ticketError(f('offline'), true).message, /끊겼어/);
  setLang('en');
  assert.equal(
    ticketError(f('no_tickets'), false).message,
    "You've used all your tickets. Continue with the AI on your computer?",
  );
  setLang('ko');
});

test('runTicket: 조각은 delta, 끝은 done(모은 글), 실패는 error, 멈추면 cancelled', async () => {
  const hooks = (r: AiChatOutcome, pieces: string[] = []): TicketHooks & { bodies: unknown[] } => {
    const bodies: unknown[] = [];
    return {
      bodies,
      available: () => true,
      tickets: () => 3,
      agreed: () => true,
      agree: () => {},
      report: async () => true,
      ask: async (body, onText, signal) => {
        bodies.push(body);
        await Promise.resolve();
        for (const p of pieces) onText(p);
        if (signal?.aborted) return { ok: false, status: 0, error: 'offline' };
        return r;
      },
    };
  };
  const events: AiEvent[] = [];
  const h = hooks({ ok: true, tickets: 2 }, ['안녕', '!']);
  await runTicket(
    { history: [{ question: 'q', answer: 'a' }], text: '질문', persona: 'p'.repeat(3000), lang: 'en' },
    h,
    (e) => events.push(e),
  ).finished;
  assert.deepEqual(events, [
    { type: 'delta', text: '안녕' },
    { type: 'delta', text: '!' },
    { type: 'done', text: '안녕!' },
  ]);
  const body = h.bodies[0] as { messages: unknown[]; lang: string; persona: string };
  assert.equal(body.lang, 'en');
  assert.equal(body.persona.length, 2000);
  assert.equal(body.messages.length, 3);

  const errs: AiEvent[] = [];
  await runTicket(
    { history: [], text: 'x', persona: '', lang: 'ko' },
    hooks({ ok: false, status: 409, error: 'no_tickets', tickets: 0 }),
    (e) => errs.push(e),
  ).finished;
  assert.equal(errs.at(-1)?.type === 'error' && errs.at(-1)?.type, 'error');
  assert.equal((errs.at(-1) as Extract<AiEvent, { type: 'error' }>).error.kind, 'no-tickets');

  const stopped: AiEvent[] = [];
  const run = runTicket(
    { history: [], text: 'x', persona: '', lang: 'ko' },
    hooks({ ok: true, tickets: 1 }),
    (e) => stopped.push(e),
  );
  run.cancel();
  await run.finished;
  assert.equal((stopped.at(-1) as Extract<AiEvent, { type: 'error' }>).error.kind, 'cancelled');
});
