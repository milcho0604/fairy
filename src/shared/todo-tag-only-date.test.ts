import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseTodoLine, splitRemind } from './remind-parse.ts';
import { autoLeadInput, readTagOnlyTodo, splitLeadTags, tagToEnd } from './todo-tag-prefix.ts';

// panel.ts addTodo 와 같은 순서: 앞머리를 떼고, 나머지가 날짜 낱말뿐이면 태그까지 한 줄로 읽는다
function viaPanel(full: string) {
  const { lead, rest } = splitLeadTags(full);
  const text = splitRemind(rest).rest;
  const only = readTagOnlyTodo(lead, text, '2026-11-17', 600);
  if (only) return { title: only.title, due: only.due };
  const p = parseTodoLine(text, '2026-11-17', 600);
  return { title: lead + p.title, due: p.due };
}

test('"#회사 내일" 은 제목 태그, 마감 내일', () => {
  assert.deepEqual(viaPanel('#회사 내일'), { title: '#회사', due: '2026-11-18' });
});
test('"#회사 내일까지" 도 같다', () => {
  assert.deepEqual(viaPanel('#회사 내일까지'), { title: '#회사', due: '2026-11-18' });
});
test('나머지에 제목이 있으면 그대로 태그 + 제목', () => {
  assert.deepEqual(viaPanel('#회사 내일 보고서'), { title: '#회사 보고서', due: '2026-11-18' });
  assert.equal(readTagOnlyTodo('#회사 ', '보고서', '2026-11-17', 600), null);
});
test('태그가 둘이어도 제목은 태그들', () => {
  assert.deepEqual(viaPanel('#회사 #급함 내일'), { title: '#회사 #급함', due: '2026-11-18' });
});

test('자동 앞머리는 "#태그 " 하나 모양만 받는다', () => {
  assert.equal(autoLeadInput('#회사 '), '#회사 ');
  assert.equal(autoLeadInput('#회사'), null);
  assert.equal(autoLeadInput('#회사 x '), null);
  assert.equal(autoLeadInput('#123 '), null);
  assert.equal(autoLeadInput(5), null);
});

test('자동 태그는 제목 끝으로 옮긴다', () => {
  assert.equal(tagToEnd('점검표 쓰기', '#회사 '), '점검표 쓰기 #회사');
});
