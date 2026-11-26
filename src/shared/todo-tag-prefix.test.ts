import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseTodoLine } from './remind-parse.ts';
import { todoTags } from './todo-filter.ts';
import { caretOutOfAuto, keepAuto, splitLeadTags, syncTagPrefix, tagPrefix } from './todo-tag-prefix.ts';

test('빈 칸에 태그를 고르면 앞머리를 넣는다', () => {
  assert.deepEqual(syncTagPrefix('', null, '회사'), { text: '#회사 ', auto: '#회사 ', changed: true });
  assert.deepEqual(syncTagPrefix('  ', null, '회사'), { text: '#회사 ', auto: '#회사 ', changed: true });
});

test('사용자가 쓴 글이 있으면 건드리지 않는다', () => {
  assert.deepEqual(syncTagPrefix('보고서', null, '회사'), { text: '보고서', auto: null, changed: false });
  assert.deepEqual(syncTagPrefix('#집 청소', null, '회사'), { text: '#집 청소', auto: null, changed: false });
});

test('태그를 바꾸면 자동 앞머리만 바뀌고 뒤에 쓴 글은 그대로', () => {
  const r = syncTagPrefix('#회사 보고서', '#회사 ', '집');
  assert.deepEqual(r, { text: '#집 보고서', auto: '#집 ', changed: true });
});

test('태그를 풀면 자동 앞머리만 지운다', () => {
  assert.deepEqual(syncTagPrefix('#회사 ', '#회사 ', null), { text: '', auto: null, changed: true });
  assert.deepEqual(syncTagPrefix('#회사 보고서', '#회사 ', null), {
    text: '보고서',
    auto: null,
    changed: true,
  });
});

test('사용자가 고친 앞머리는 우리 것이 아니라 안 지우고 안 바꾼다', () => {
  assert.equal(keepAuto('#회사', '#회사 '), null);
  assert.equal(keepAuto('#회사 a', '#회사 '), '#회사 ');
  assert.deepEqual(syncTagPrefix('#회사', null, null), { text: '#회사', auto: null, changed: false });
  assert.deepEqual(syncTagPrefix('#회사 보고서', null, '집'), {
    text: '#회사 보고서',
    auto: null,
    changed: false,
  });
});

test('사용자가 직접 친 같은 태그 글은 풀어도 남는다', () => {
  assert.deepEqual(syncTagPrefix('#회사 보고서', null, null), {
    text: '#회사 보고서',
    auto: null,
    changed: false,
  });
});

test('앞머리를 지우고 다른 글을 쓴 칸에서 태그를 바꿔도 글은 그대로', () => {
  assert.deepEqual(syncTagPrefix('보고서', keepAuto('보고서', '#회사 '), '집'), {
    text: '보고서',
    auto: null,
    changed: false,
  });
});

test('같은 태그를 다시 맞춰도 변하지 않는다', () => {
  assert.deepEqual(syncTagPrefix('#회사 ', '#회사 ', '회사'), {
    text: '#회사 ',
    auto: '#회사 ',
    changed: false,
  });
});

test('앞머리 태그 떼기', () => {
  assert.deepEqual(splitLeadTags('#회사 내일 보고서'), { lead: '#회사 ', rest: '내일 보고서' });
  assert.deepEqual(splitLeadTags('#회사 #급함 보고서'), { lead: '#회사 #급함 ', rest: '보고서' });
  assert.deepEqual(splitLeadTags('#1 번'), { lead: '', rest: '#1 번' });
  assert.deepEqual(splitLeadTags('#회사 '), { lead: '', rest: '#회사 ' });
  assert.deepEqual(splitLeadTags('보고서 #회사'), { lead: '', rest: '보고서 #회사' });
});

test('앞머리를 떼고 읽으면 날짜와 반복이 읽히고 제목에 되붙여 태그가 된다', () => {
  const today = '2026-11-17';
  const { lead, rest } = splitLeadTags(`${tagPrefix('회사')}내일 보고서 쓰기`);
  const p = parseTodoLine(rest, today, 600);
  assert.equal(p.due, '2026-11-18');
  assert.deepEqual(todoTags(lead + p.title), ['회사']);
  const q = splitLeadTags('#운동 매일 스트레칭');
  assert.equal(parseTodoLine(q.rest, today, 600).repeat, 'daily');
  // 떼지 않으면 읽히지 않는다 (이 함수가 필요한 까닭)
  assert.equal(parseTodoLine('#회사 내일 보고서 쓰기', today, 600).due, null);
});

test('앞머리 글자 위를 누르면 커서를 글 끝으로 보낸다', () => {
  // "#회사 " 의 앞, 가운데: 끝으로
  assert.equal(caretOutOfAuto('#회사 ', '#회사 ', 0, 0), 4);
  assert.equal(caretOutOfAuto('#회사 ', '#회사 ', 2, 2), 4);
  // 앞머리 뒤에 쓴 글이 있어도 앞머리 안이면 글 끝으로
  assert.equal(caretOutOfAuto('#회사 보고서', '#회사 ', 1, 1), 7);
});

test('사용자가 정한 커서 자리는 그대로 둔다', () => {
  // 이미 끝, 앞머리 바로 뒤, 쓴 글 가운데
  assert.equal(caretOutOfAuto('#회사 ', '#회사 ', 4, 4), null);
  assert.equal(caretOutOfAuto('#회사 보고서', '#회사 ', 4, 4), null);
  assert.equal(caretOutOfAuto('#회사 보고서', '#회사 ', 6, 6), null);
  // 끌어서 고른 글자
  assert.equal(caretOutOfAuto('#회사 ', '#회사 ', 0, 4), null);
  assert.equal(caretOutOfAuto('#회사 보고서', '#회사 ', 0, 3), null);
  assert.equal(caretOutOfAuto('#회사 보고서', '#회사 ', 0, 7), null);
  // 자동 앞머리가 없거나 이미 고쳐진 글
  assert.equal(caretOutOfAuto('#회사 ', null, 0, 0), null);
  assert.equal(caretOutOfAuto('#회 ', '#회사 ', 0, 0), null);
});
