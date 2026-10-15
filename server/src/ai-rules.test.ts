import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AI_MAX_MESSAGE_CHARS,
  AI_MAX_MESSAGES,
  AI_MAX_OUTPUT_TOKENS,
  costMicros,
  parseChatRequest,
  parseReport,
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

test('비용: Haiku 4.5 는 100만 토큰당 1, 5 달러, 모르는 모델은 가장 비싼 값', () => {
  assert.equal(costMicros('claude-haiku-4-5', 2000, 300), 3500);
  assert.equal(costMicros('claude-unknown', 1, 1), 60);
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
