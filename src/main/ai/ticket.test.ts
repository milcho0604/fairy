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
  assert.ok(total <= 11500, String(total));
  // 질문은 자르지 않는다
  assert.equal(cut.at(-1)?.content.length, 4500);
  // 빈 답(안내 말 등)은 붙이지 않는다
  assert.equal(ticketMessages([{ question: 'q', answer: ' ' }], 'z').length, 1);
});

test('서버 실패를 채팅 오류로 (다 씀은 no-tickets, 상한은 rate-limit 이라 다른 AI 로 다시 묻기가 뜬다)', () => {
  setLang('ko');
  const f = (error: string): Extract<AiChatOutcome, { ok: false }> => ({ ok: false, status: 400, error });
  assert.deepEqual(ticketError(f('no_tickets'), false), {
    kind: 'no-tickets',
    message: '채팅 이용권을 다 썼어. 내 컴퓨터의 AI로 이어서 할까?',
  });
  // 업데이트 관문(426, 이슈 #120): 이용권은 쓰지 않았으니 "업데이트하면 다시 쓸 수 있어" 로
  assert.deepEqual(ticketError(f('update_required'), false), {
    kind: 'failed',
    message: '앱을 업데이트하면 채팅 이용권을 다시 쓸 수 있어. 이번에는 이용권을 쓰지 않았어.',
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
    "You've used all your chat passes. Continue with the AI on your computer?",
  );
  setLang('ko');
});

test('runTicket: 조각은 delta, 끝은 done(모은 글), 실패는 error, 멈추면 cancelled', async () => {
  const hooks = (
    r: AiChatOutcome,
    pieces: Array<string | 'reset'> = [],
  ): TicketHooks & { bodies: unknown[] } => {
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
        for (const p of pieces) onText(p === 'reset' ? { type: 'reset' } : { type: 'text', text: p });
        if (signal?.aborted) return { ok: false, status: 0, error: 'offline' };
        return r;
      },
    };
  };
  const events: AiEvent[] = [];
  const h = hooks({ ok: true, tickets: 2 }, ['안녕', '!']);
  await runTicket(
    {
      history: [{ question: 'q', answer: 'a' }],
      text: '질문',
      question: '질문',
      persona: 'p'.repeat(3000),
      lang: 'en',
    },
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
  assert.equal(body.persona.length, 600);
  assert.equal(body.messages.length, 3);

  // 서버 폴백: 앞의 글은 reset 으로 지워지고, 완료 글은 이어진 글만
  const fb: AiEvent[] = [];
  await runTicket(
    { history: [], text: 'x', question: 'x', persona: '', lang: 'ko' },
    hooks({ ok: true, tickets: 1 }, ['[A의 앞부분] ', 'reset', '새 ', '답']),
    (e) => fb.push(e),
  ).finished;
  assert.deepEqual(fb, [
    { type: 'delta', text: '[A의 앞부분] ' },
    { type: 'reset' },
    { type: 'delta', text: '새 ' },
    { type: 'delta', text: '답' },
    { type: 'done', text: '새 답' },
  ]);

  const errs: AiEvent[] = [];
  await runTicket(
    { history: [], text: 'x', question: 'x', persona: '', lang: 'ko' },
    hooks({ ok: false, status: 409, error: 'no_tickets', tickets: 0 }),
    (e) => errs.push(e),
  ).finished;
  assert.equal(errs.at(-1)?.type === 'error' && errs.at(-1)?.type, 'error');
  assert.equal((errs.at(-1) as Extract<AiEvent, { type: 'error' }>).error.kind, 'no-tickets');

  const stopped: AiEvent[] = [];
  const run = runTicket(
    { history: [], text: 'x', question: 'x', persona: '', lang: 'ko' },
    hooks({ ok: true, tickets: 1 }),
    (e) => stopped.push(e),
  );
  run.cancel();
  await run.finished;
  assert.equal((stopped.at(-1) as Extract<AiEvent, { type: 'error' }>).error.kind, 'cancelled');
});

test('질문 글자 수는 사용자가 친 글만: 앞에 붙인 글(시각, 머리글, 할 일)은 세지 않고, 서버에 question 으로 따로 보낸다', async () => {
  const lead = '지금은 오후 3시\n[할 일]\n- 빨래\n[질문]\n';
  const q = '가'.repeat(200);
  const m = ticketMessages([], lead + q, q);
  assert.equal(m.length, 1);
  assert.equal(m[0]?.content, lead + q);
  // 전체가 안전 상한을 넘으면 질문이 아니라 앞에 붙인 글을 자른다
  const hugeLead = 'L'.repeat(20000);
  const big = ticketMessages([], hugeLead + q, q);
  assert.equal(big[0]?.content.length, 11500);
  assert.ok(big[0]?.content.endsWith(q));
  // 앞 문답이 있으면 오래된 것부터 빼서 질문과 앞에 붙인 글을 살린다
  const hist = Array.from({ length: 4 }, () => ({ question: 'q'.repeat(1500), answer: 'a'.repeat(1500) }));
  const withHist = ticketMessages(hist, 'P'.repeat(3000) + q, q);
  assert.ok(withHist.reduce((n, x) => n + x.content.length, 0) <= 11500);
  assert.ok(withHist.at(-1)?.content.endsWith(q));
  assert.equal(withHist.at(-1)?.content.length, 3200);

  const bodies: { question?: string; messages: { content: string }[] }[] = [];
  const hooks: TicketHooks = {
    available: () => true,
    tickets: () => 1,
    agreed: () => true,
    agree: () => {},
    report: async () => true,
    ask: async (body) => {
      bodies.push(body);
      return { ok: true, tickets: 0 };
    },
  };
  await runTicket({ history: [], text: lead + q, question: q, persona: '', lang: 'ko' }, hooks, () => {})
    .finished;
  assert.equal(bodies[0]?.question, q);
  assert.equal(bodies[0]?.messages.at(-1)?.content, lead + q);

  // 서버 최대(8000자)를 넘는 질문은 보내지 않고 같은 안내를 낸다
  setLang('ko');
  const ev: AiEvent[] = [];
  await runTicket(
    { history: [], text: lead + 'z'.repeat(8001), question: 'z'.repeat(8001), persona: '', lang: 'ko' },
    hooks,
    (e) => ev.push(e),
  ).finished;
  assert.equal(bodies.length, 1);
  const last = ev.at(-1) as Extract<AiEvent, { type: 'error' }>;
  assert.equal(last.type, 'error');
  assert.match(last.error.message, /너무 길어/);
  // 8000자 딱 맞으면 보낸다
  await runTicket(
    { history: [], text: 'z'.repeat(8000), question: 'z'.repeat(8000), persona: '', lang: 'ko' },
    hooks,
    () => {},
  ).finished;
  assert.equal(bodies.length, 2);
});
