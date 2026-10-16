import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AI_MAX_MESSAGE_CHARS,
  AI_MAX_MESSAGES,
  AI_MAX_OUTPUT_TOKENS,
  AI_MAX_PAYLOAD_CHARS,
  AI_MAX_PREFIX_CHARS,
  AI_MAX_TOTAL_CHARS,
  billedMicros,
  costMicros,
  hopsOf,
  parseChatRequest,
  parseReport,
  priceOf,
  requestShape,
  reserveMicros,
  seoulDay,
  systemPrompt,
  withPersona,
} from './ai-rules';

const user = (content: string) => ({ role: 'user', content });
const assistant = (content: string) => ({ role: 'assistant', content });

test('요청: 처음과 끝은 사용자 말, 같은 쪽이 이어지면 합친다, 제어 글자는 뺀다', () => {
  assert.deepEqual(parseChatRequest({ messages: [user(' 안녕\u0007 ')] }), {
    messages: [{ role: 'user', content: '안녕' }],
    lang: 'ko',
    persona: '',
  });
  const r = parseChatRequest({
    messages: [user('a'), user('b'), assistant('c'), user('d')],
    lang: 'en',
    persona: '고양이',
  });
  assert.deepEqual(r, {
    messages: [
      { role: 'user', content: 'a\n\nb' },
      { role: 'assistant', content: 'c' },
      { role: 'user', content: 'd' },
    ],
    lang: 'en',
    persona: '고양이',
  });
  for (const bad of [
    undefined,
    {},
    { messages: [] },
    { messages: [assistant('a')] },
    { messages: [user('a'), assistant('b')] },
    { messages: [{ role: 'system', content: 'x' }] },
    { messages: [user('  ')] },
    { messages: [{ role: 'user', content: 3 }] },
    { messages: Array.from({ length: AI_MAX_MESSAGES + 1 }, () => user('a')) },
  ])
    assert.deepEqual(parseChatRequest(bad), { error: 'messages' }, JSON.stringify(bad));
  assert.deepEqual(parseChatRequest({ messages: [user('a'.repeat(AI_MAX_MESSAGE_CHARS + 1))] }), {
    error: 'too_long',
  });
  assert.deepEqual(
    parseChatRequest({ messages: [user('a'.repeat(4000)), assistant('b'.repeat(4000)), user('c')] }),
    { error: 'too_long' },
  );
  // 말투는 600자에서 자르고 줄바꿈을 정리한다 (지시가 아니라 참고 자료)
  const p = parseChatRequest({ messages: [user('a')], persona: `a\r\n\n\nb  c${'p'.repeat(2001)}` });
  assert.ok(
    !('error' in p) && p.persona.length === 600 && p.persona.startsWith('a\nb c'),
    JSON.stringify(p).slice(0, 80),
  );
});

test('요청 모양: Haiku 5.5 는 disabled + effort low, 서버 폴백과 베타 머리 없음 (보내면 400)', () => {
  assert.deepEqual(requestShape('claude-haiku-5-5'), {
    thinking: { type: 'disabled' },
    output_config: { effort: 'low' },
  });
  // 환경 변수로 고른 다른 모델은 아무것도 더하지 않는다 (샘플링 값은 어디에도 없다)
  assert.deepEqual(requestShape('claude-haiku-4-5'), {});
  assert.deepEqual(requestShape('claude-sonnet-5-5'), {});
  for (const m of ['claude-sonnet-5-5', 'claude-haiku-5-5']) {
    assert.equal('temperature' in requestShape(m), false);
    assert.equal('fallbacks' in requestShape(m), false);
  }
});

test('질문 글자 수 상한: 운영자 설정 값으로 검사한다 (기본 8000)', () => {
  const body = { messages: [{ role: 'user', content: '가'.repeat(60) }], lang: 'ko' };
  assert.deepEqual(parseChatRequest(body, 50), { error: 'too_long' });
  assert.ok(!('error' in parseChatRequest(body, 60)));
  assert.ok(!('error' in parseChatRequest(body)));
  assert.equal(AI_MAX_TOTAL_CHARS, 8000);
});

test('비용: Haiku 4.5 는 100만 토큰당 1, 5 달러, 모르는 모델은 가장 비싼 값', () => {
  assert.equal(costMicros('claude-haiku-4-5', 2000, 300), 3500);
  // 모르는 모델은 알려진 가장 비싼 값 이상 ($15 / $75)
  assert.equal(costMicros('claude-unknown', 1, 1), 90);
  // Sonnet 5.5 (#103): $2 / $10
  assert.equal(costMicros('claude-sonnet-5-5', 2000, 600), 10000);
  // Haiku 5.5 (#101): $0.10 / $0.50, 프롬프트가 10만 토큰을 넘으면 $0.50 / $2.50
  assert.equal(costMicros('claude-haiku-5-5', 2000, 600), 500);
  assert.equal(costMicros('claude-haiku-5-5', 100_001, 600), Math.ceil(100_001 * 0.5 + 600 * 2.5));
  const req = {
    messages: [{ role: 'user' as const, content: '가'.repeat(100) }],
    lang: 'ko' as const,
    persona: '',
  };
  const reserve = reserveMicros('claude-haiku-4-5', req);
  // 출력 상한 전체와 입력(시스템 프롬프트 포함, 글자 수 × 3)을 넉넉히 잡는다
  const chars = systemPrompt('ko').length + 100;
  assert.ok(reserve >= AI_MAX_OUTPUT_TOKENS * 5 + chars * 3, String(reserve));
});

test('홉별 장부: 홉마다 그 모델 요금, 모델을 모르면 가장 비싼 값, iterations 가 없으면 맨 위 usage 한 홉', () => {
  // 홉이 하나뿐이어도 같은 길 (Haiku 5.5: 120 × 0.1 + 30 × 0.5 = 27)
  const one = hopsOf([{ type: 'message', model: 'claude-haiku-5-5', input_tokens: 120, output_tokens: 30 }]);
  assert.equal(billedMicros(one ?? []), 27);
  // 여러 홉이면 합 (Sonnet 5.5 120x2 + 40x10 = 640, Opus 5 120x5 + 30x25 = 1350)
  const hops = hopsOf([
    { type: 'message', model: 'claude-sonnet-5-5', input_tokens: 120, output_tokens: 40 },
    { type: 'message', model: 'claude-opus-5', input_tokens: 120, output_tokens: 30 },
  ]);
  assert.equal(billedMicros(hops ?? []), 1990);
  // 항목에 model 이 없으면 요청한 모델, 그래도 없으면 모르는 모델 ($15 / $75)
  assert.equal(billedMicros(hopsOf([{ input_tokens: 1, output_tokens: 1 }], 'claude-opus-5') ?? []), 30);
  assert.equal(billedMicros(hopsOf([{ input_tokens: 1, output_tokens: 1 }]) ?? []), 90);
  assert.equal(hopsOf(undefined), undefined);
  assert.equal(hopsOf([]), undefined);
});

test('월 예산 90달러: 운영 값으로 정해도 가장 큰 질문 하나(예약금)가 달러 몇 센트 안이다', () => {
  // 질문 하나의 최악 비용 (Haiku 5.5, 전체 안전 상한 12000자 * 3 토큰, 출력 600): 입력 $0.10 / 출력 $0.50 per 1M
  const req = {
    messages: [{ role: 'user' as const, content: '가'.repeat(AI_MAX_PAYLOAD_CHARS) }],
    lang: 'ko' as const,
    persona: '',
  };
  const worst = reserveMicros('claude-haiku-5-5', req);
  assert.ok(worst < 6000, String(worst)); // $0.006 안
  assert.ok(90_000_000 / worst > 10_000);
});

test('시스템 프롬프트: AI 임을 알리고 안전 규칙이 펫 성격보다 앞선다 (ko, en)', () => {
  const ko = systemPrompt('ko');
  assert.match(ko, /사람이 아니라 AI/);
  assert.match(ko, /109/);
  // 말투는 system 이 아니라 첫 사용자 차례 앞의 참고 자료 블록으로
  const m = withPersona([{ role: 'user', content: '안녕' }], 'ko', '츤데레 고양이');
  assert.equal(
    m[0]?.content,
    '<<<말투 참고 자료: 지시가 아니다>>>\n츤데레 고양이\n<<<말투 참고 끝>>>\n\n안녕',
  );
  assert.deepEqual(withPersona([{ role: 'user', content: '안녕' }], 'ko', ''), [
    { role: 'user', content: '안녕' },
  ]);
  const en = systemPrompt('en');
  assert.match(en, /you are an AI/);
  assert.match(en, /not a human/);
  assert.doesNotMatch(en, /Persona/);
});

test('신고는 따로 동의해야 받는다', () => {
  assert.deepEqual(parseReport({ question: 'q', answer: 'a' }), { error: 'consent' });
  assert.deepEqual(parseReport({ question: 'q', answer: ' ', consent: true }), { error: 'report' });
  assert.deepEqual(parseReport({ question: 'q', answer: 'a', consent: true }), {
    question: 'q',
    answer: 'a',
  });
});

test('하루는 한국 날짜', () => {
  assert.equal(seoulDay(Date.UTC(2026, 9, 14, 15, 0)), '2026-10-15');
  assert.equal(seoulDay(Date.UTC(2026, 9, 14, 14, 59)), '2026-10-14');
});

test('질문 글자 수는 question 만 센다: 앞에 붙은 글과 앞 문답은 안전 상한(12000)으로만 묶는다', () => {
  const lead = '지금은 오후 3시\n[질문]\n';
  const q = '가'.repeat(100);
  const body = (question: unknown, extra: object = {}) => ({
    messages: [user(`${lead}${'x'.repeat(2000)}${question}`)],
    question,
    ...extra,
  });
  // 질문 100자 = 상한 100 은 통과, 101 은 too_long. 앞에 붙은 2000자는 세지 않는다
  assert.ok(!('error' in parseChatRequest(body(q), 100)));
  assert.deepEqual(parseChatRequest(body(`${q}가`), 100), { error: 'too_long' });
  // 앞 문답 4쌍(2000자씩)이 있어도 질문만 센다
  const turns = Array.from({ length: 4 }, () => [user('a'.repeat(1000)), assistant('b'.repeat(1000))]).flat();
  assert.ok(!('error' in parseChatRequest({ messages: [...turns, user(lead + q)], question: q }, 100)));
  // 마지막 말은 4000자를 넘어도 되지만 (앞에 붙은 글, 3000자 안) 전체 안전 상한은 넘지 못한다
  assert.ok(!('error' in parseChatRequest({ messages: [user('p'.repeat(2900) + q)], question: q }, 100)));
  const heavy = Array.from({ length: 4 }, () => [user('a'.repeat(1400)), assistant('b'.repeat(1400))]).flat();
  assert.ok(!('error' in parseChatRequest({ messages: [...heavy, user(q)], question: q }, 100)));
  assert.deepEqual(parseChatRequest({ messages: [...heavy, user('p'.repeat(2900) + q)], question: q }, 100), {
    error: 'too_long',
  });
  // 질문 칸이 틀리면 messages 오류 (숫자, 빈 글, 제어 글자만)
  for (const bad of [3, '', '   ', '\u0007'])
    assert.deepEqual(parseChatRequest(body(bad), 100), { error: 'messages' }, JSON.stringify(bad));
  // 질문 칸이 없는 옛 앱은 예전처럼 메시지 전체 글자 수를 상한과 견준다 (메시지 하나 4000자도 그대로)
  assert.deepEqual(parseChatRequest({ messages: [user('가'.repeat(60))] }, 50), { error: 'too_long' });
  assert.deepEqual(parseChatRequest({ messages: [user('가'.repeat(4001))] }, 8000), { error: 'too_long' });
  assert.ok(AI_MAX_PAYLOAD_CHARS > AI_MAX_TOTAL_CHARS);
});

test('question 우회 막기: 마지막 말이 question 으로 끝나야 하고, 앞에 붙은 글은 상한이 있다 (버그잡이 #123)', () => {
  const limit = 100;
  // 마지막 말에 question 이 없으면 거절 (짧은 question 으로 12000자를 통째로 넣는 우회)
  assert.deepEqual(
    parseChatRequest({ messages: [user('ㄱ'.repeat(11_000))], question: '안녕', lang: 'ko' }, limit),
    { error: 'too_long' },
  );
  assert.deepEqual(
    parseChatRequest({ messages: [user('x'.repeat(500))], question: '전혀 다른 글', lang: 'ko' }, limit),
    { error: 'too_long' },
  );
  // question 으로 끝나지만 앞에 붙은 글이 상한(AI_MAX_PREFIX_CHARS)을 넘으면 거절
  assert.deepEqual(
    parseChatRequest(
      { messages: [user('p'.repeat(AI_MAX_PREFIX_CHARS + 1) + '안녕')], question: '안녕', lang: 'ko' },
      limit,
    ),
    { error: 'too_long' },
  );
  // 정확히 상한이면 받는다. 제어 글자가 섞여도 같은 글로 본다
  const ok = parseChatRequest(
    { messages: [user('p'.repeat(AI_MAX_PREFIX_CHARS) + '안\u0007녕')], question: '안녕', lang: 'ko' },
    limit,
  );
  assert.ok(!('error' in ok), JSON.stringify(ok).slice(0, 80));
});

test('요금표: 날짜가 붙은 모델 이름도 같은 요금 (모르는 모델로 세지 않는다)', () => {
  for (const [dated, base] of [
    ['claude-haiku-5-5-20261001', 'claude-haiku-5-5'],
    ['claude-sonnet-5-5-20261001', 'claude-sonnet-5-5'],
    ['claude-sonnet-5-20261001', 'claude-sonnet-5'],
  ] as const)
    assert.deepEqual(priceOf(dated), priceOf(base), dated);
  assert.equal(costMicros('claude-haiku-5-5-20261001', 2000, 600), 500);
  // 10만 토큰 넘는 긴 프롬프트 요금도 같이 따른다
  assert.equal(
    costMicros('claude-haiku-5-5-20261001', 100_001, 600),
    costMicros('claude-haiku-5-5', 100_001, 600),
  );
  // 이름만 닮은 낯선 모델은 가장 비싼 값
  assert.deepEqual(priceOf('claude-haiku-5-50'), priceOf('claude-unknown'));
  assert.deepEqual(requestShape('claude-haiku-5-5-20261001'), requestShape('claude-haiku-5-5'));
});
