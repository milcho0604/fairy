import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AiEvent } from '../../shared/ai/types.ts';
import { addQuestion, applyEvent, initialChat } from '../../shared/chat-state.ts';
import { setLang } from '../../shared/i18n/index.ts';
import type { AiChatOutcome } from '../server-api.ts';
import {
  MAX_LEAD,
  runTicket,
  TICKET_HISTORY,
  type TicketHooks,
  ticketError,
  ticketMessages,
} from './ticket.ts';

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
  // 앞에 붙인 글이 상한(MAX_LEAD)을 넘으면 질문이 아니라 앞에 붙인 글을 자른다
  const hugeLead = 'L'.repeat(20000);
  const big = ticketMessages([], hugeLead + q, q);
  assert.equal(big[0]?.content.length, MAX_LEAD + q.length);
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

test('ticketMessages: 질문과 머리글은 자르지 않고 할 일 목록이나 오래된 문답부터 줄인다, 글자 짝(서로게이트)은 쪼개지 않는다 (버그잡이 #123)', () => {
  const head = '지금은 2026-10-10(토) 오후 3:12.';
  const todos = Array.from({ length: 60 }, (_, i) => `- 😀할 일 ${i} ${'가'.repeat(90)}`).join('\n');
  const lead = `${head}\n[내 오늘 상황, 2026-10-10]\n<<<\n안 끝낸 할 일:\n${todos}\n>>>\n[질문]\n`;
  const q = '😀'.repeat(300);
  const m = ticketMessages([], lead + q, q);
  const last = m.at(-1)?.content ?? '';
  assert.ok(last.endsWith(`>>>\n[질문]\n${q}`), last.slice(-40));
  assert.ok(last.startsWith(head));
  assert.ok(last.length - q.length <= MAX_LEAD, String(last.length - q.length));
  assert.doesNotMatch(last, /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/);
  // 앞 문답의 글도 짝을 쪼개지 않는다
  const h = ticketMessages([{ question: '😀'.repeat(1000), answer: '😀'.repeat(1000) }], '질문', '질문');
  for (const x of h)
    assert.doesNotMatch(x.content, /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/);
  // 앞에 붙은 글은 그대로면 건드리지 않는다
  assert.equal(ticketMessages([], `${head}\n[질문]\n안녕`, '안녕').at(-1)?.content, `${head}\n[질문]\n안녕`);
});

test('거절(refusal): 받은 글이 있어도 말풍선의 그 글은 지우고 안내만 남긴다 (이용권은 서버가 되돌린다)', async () => {
  setLang('ko');
  const events: AiEvent[] = [];
  const hooks: TicketHooks = {
    available: () => true,
    tickets: () => 1,
    agreed: () => true,
    agree: () => {},
    report: async () => true,
    ask: async (_b, onText) => {
      onText('음... ');
      return { ok: false, status: 200, error: 'refusal', tickets: 1, refunded: true };
    },
  };
  await runTicket({ history: [], text: 'x', question: 'x', persona: '', lang: 'ko' }, hooks, (e) =>
    events.push(e),
  ).finished;
  const err = events.at(-1) as Extract<AiEvent, { type: 'error' }>;
  assert.equal(err.type, 'error');
  assert.equal(err.dropText, true);
  assert.match(err.error.message, /답하지 않기로/);
  let s = addQuestion(initialChat('claude'), { user: 'u1', pet: 'p1' }, 'q', []);
  for (const e of events) s = applyEvent(s, 'p1', e, 'n');
  assert.equal(s.messages[1]?.text, '');
  assert.equal(s.messages[1]?.status, 'error');
  // 다른 실패(끊김)는 받은 글을 그대로 둔다
  let t = addQuestion(initialChat('claude'), { user: 'u1', pet: 'p1' }, 'q', []);
  t = applyEvent(t, 'p1', { type: 'delta', text: '받은 글' }, 'n');
  t = applyEvent(t, 'p1', { type: 'error', error: { kind: 'failed', message: 'x' } }, 'n');
  assert.equal(t.messages[1]?.text, '받은 글');
});
