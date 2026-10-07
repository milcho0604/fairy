import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setLang } from '../i18n/index.ts';
import {
  CONTEXT_TODO_MAX,
  EXTRACT_MAX,
  extractTodos,
  isPersona,
  noteTitleFromQuestion,
  persona,
  todoContext,
  withRules,
} from './persona.ts';

test('성격: 이름과 말투가 들어가고, 모르는 성격은 거른다', () => {
  assert.match(persona('콩이'), /"콩이".*반말로 다정하게/);
  assert.match(persona('콩이', 'polite'), /존댓말/);
  assert.match(persona('콩이', 'tsundere'), /비꼬지는 않는다/);
  assert.match(persona('콩이', 'calm'), /이모지는 쓰지 않는다/);
  assert.equal(isPersona('polite'), true);
  assert.equal(isPersona('evil'), false);
});

test('내 상황: 일정과 할 일, 중요와 마감 순, 아무것도 없으면 빈 글', () => {
  const text = todoContext({
    today: '2026-10-06',
    todos: [
      { title: '책 읽기', due: null, important: false },
      { title: '정산', due: '2026-10-01', important: false },
      { title: '보고서', due: '2026-10-06', important: true },
      { title: '발표 준비', due: '2026-10-09', important: false },
    ],
    events: [{ time: '오후 3:00', title: '회의' }],
  });
  assert.equal(
    text,
    [
      '[내 오늘 상황, 2026-10-06]',
      '남은 일정:',
      '- 오후 3:00 회의',
      '안 끝낸 할 일:',
      '- [중요] 보고서 (오늘 마감)',
      '- 정산 (마감 지남)',
      '- 발표 준비 (마감 2026-10-09)',
      '- 책 읽기',
      '[질문]',
      '',
    ].join('\n'),
  );
  assert.equal(todoContext({ today: '2026-10-06', todos: [], events: [] }), '');
});

test('내 상황: 할 일이 많으면 상한까지만, 나머지는 개수로', () => {
  const todos = Array.from({ length: CONTEXT_TODO_MAX + 5 }, (_, i) => ({
    title: `일 ${i}`,
    due: null,
    important: false,
  }));
  const text = todoContext({ today: '2026-10-06', todos, events: [] });
  assert.equal(text.split('\n').filter((l) => l.startsWith('- ')).length, CONTEXT_TODO_MAX);
  assert.match(text, /그 밖에 5개 더/);
});

test('답에서 할 일: 목록 줄, 번호, 체크박스, 굵게 벗기기, 중복 빼기', () => {
  const answer = [
    '오늘 할 일을 이렇게 나눠 봤어.',
    '',
    '1. **보고서** 초안 쓰기',
    '2) 자료 `slides.key` 정리',
    '- [ ] 메일 답장',
    '* 메일 답장',
    '마지막 문장.',
  ].join('\n');
  assert.deepEqual(extractTodos(answer), ['보고서 초안 쓰기', '자료 slides.key 정리', '메일 답장']);
});

test('답에서 할 일: 목록이 없으면 첫 문장, 비면 없음, 많으면 상한', () => {
  assert.deepEqual(extractTodos('내일 오전에 치과 예약 전화하기. 그다음은 쉬어.'), [
    '내일 오전에 치과 예약 전화하기.',
  ]);
  assert.deepEqual(extractTodos('# 정리\n집 청소'), ['정리']);
  assert.deepEqual(extractTodos('   '), []);
  const many = Array.from({ length: 15 }, (_, i) => `- 일 ${i}`).join('\n');
  assert.equal(extractTodos(many).length, EXTRACT_MAX);
});

test('답에서 할 일: 앞의 [중요] 표시는 뺀다', () => {
  assert.deepEqual(extractTodos('1. [중요] 보고서부터\n2. (중요) 메일'), ['보고서부터', '메일']);
});

test('답을 메모로: 제목은 질문 첫 줄', () => {
  assert.equal(noteTitleFromQuestion('\n  정렬 알고리즘 뭐 써?\n자세히'), '정렬 알고리즘 뭐 써?');
  assert.equal(noteTitleFromQuestion(''), '');
});

test('짝꿍 규칙은 성격 뒤에 목록으로 붙고, 비면 붙지 않는다', () => {
  setLang('ko');
  assert.equal(withRules('  \n \n'), '');
  const p = persona('콩이', 'friend', '답은 세 줄 안으로\n\n- 코드는 TypeScript 로');
  assert.ok(p.endsWith('규칙을 따른다:\n- 답은 세 줄 안으로\n- 코드는 TypeScript 로'));
  assert.ok(!persona('콩이', 'friend').includes('규칙'));
});
