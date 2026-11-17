import assert from 'node:assert/strict';
import test from 'node:test';
import { setLang } from '../i18n/index.ts';
import { BANMAL_EXAMPLES, localHistory } from './local-text.ts';
import { persona, ticketVoice, todoContext, turnPrompt } from './persona.ts';
import { LOCAL_BUDGET, TEXT_BUDGET, textPrompt, trimHistory, withHistory } from './text.ts';

const pairs = (n: number, len = 10) =>
  Array.from({ length: n }, (_, i) => ({
    question: `q${i}${'가'.repeat(len)}`,
    answer: `a${i}${'나'.repeat(len)}`,
  }));

test('최근 대화 고르기: 차례 수 안에서 오래된 것부터 버리고 순서는 그대로', () => {
  const out = trimHistory(pairs(20), TEXT_BUDGET);
  assert.equal(out.length, TEXT_BUDGET.maxTurns);
  assert.ok(out[0]?.question.startsWith('q8'));
  assert.ok(out.at(-1)?.question.startsWith('q19'));
});

test('최근 대화 고르기: 글자 예산이 차면 오래된 것을 버린다', () => {
  const out = trimHistory(pairs(8, 200), LOCAL_BUDGET);
  const total = out.reduce((n, x) => n + x.question.length + x.answer.length, 0);
  assert.ok(total <= LOCAL_BUDGET.maxChars, String(total));
  assert.ok(out.length < 8);
  assert.ok(out.at(-1)?.question.startsWith('q7'));
});

test('최근 대화 고르기: 긴 말은 줄이고 빈 문답은 빼고, 바로 앞 문답은 예산이 작아도 남긴다', () => {
  const out = trimHistory([{ question: '빈', answer: ' ' }, ...pairs(1, 5000)], LOCAL_BUDGET);
  assert.equal(out.length, 1);
  assert.ok(out[0] && out[0].question.length <= LOCAL_BUDGET.maxPart + 1);
  assert.ok(out[0]?.answer.endsWith('…'));
  assert.deepEqual(trimHistory([], TEXT_BUDGET), []);
});

test('글로 붙이는 길(gemini, 기록 안 남김)은 4개를 넘어 예산까지 붙인다', () => {
  setLang('ko');
  const p = withHistory(pairs(7), '지금');
  assert.ok(p.includes('q0') && p.includes('q6'));
  assert.ok(p.endsWith('사용자 질문: 지금'));
  assert.ok(textPrompt('성격', pairs(7), '지금').includes('q1'));
  assert.equal(withHistory([], '지금'), '지금');
});

test('로컬: 대화가 쌓이면 반말 예시를 빼서 예시 말이 되풀이되지 않는다', () => {
  assert.deepEqual(localHistory([], true), BANMAL_EXAMPLES);
  assert.equal(localHistory(pairs(1), true).length, BANMAL_EXAMPLES.length + 1);
  const full = localHistory(pairs(5), true);
  assert.ok(!full.some((h) => BANMAL_EXAMPLES.includes(h)));
  assert.equal(full.length, 5);
  assert.deepEqual(localHistory([], false), []);
});

test('일정 편향: 오늘 상황 블록은 묻거나 꼭 필요할 때만 쓰라고 말하고, 성격 지시에도 같은 말이 있다', () => {
  setLang('ko');
  const todos = [{ title: '보고서', due: null, important: false }];
  const ctx = todoContext({ today: '2026-11-17', todos, events: [] });
  assert.match(ctx, /먼저 꺼내지 않는다/);
  assert.ok(ctx.indexOf('먼저 꺼내지 않는다') < ctx.indexOf('보고서'));
  assert.match(persona('콩이'), /일정이나 할 일은 사용자가 묻거나 꼭 필요할 때만/);
  assert.match(ticketVoice('콩이'), /물을 때만/);
  assert.match(turnPrompt({ context: ctx, question: '안녕' }), /안녕$/);
  setLang('en');
  assert.match(persona('Bean'), /never bring them up on your own/);
  assert.match(todoContext({ today: '2026-11-17', todos, events: [] }), /never bring it up/);
  setLang('ko');
});

test('반복: 성격 지시에 직전 답과 같은 시작과 문장을 피하라는 말이 있다', () => {
  setLang('ko');
  assert.match(persona('콩이'), /같은 시작, 같은 문장, 같은 인사를 되풀이하지 않는다/);
  assert.match(ticketVoice('콩이'), /되풀이하지 않는다/);
});
