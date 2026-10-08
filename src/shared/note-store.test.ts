import assert from 'node:assert/strict';
import { test } from 'node:test';
import { noteQuery, searchNotes } from './note-store.ts';

const note = (id: number, title: string, body: string) => ({ id, title, body });

test('메모 찾기는 미리보기 80자 너머 본문 끝까지 본다', () => {
  const long = `${'가나다라 '.repeat(40)}\n\n맨 끝에 숨은 회의록`;
  const hits = searchNotes([note(1, '긴 메모', long), note(2, '다른 메모', '상관없는 글')], '회의록');
  assert.deepEqual(
    hits.map((h) => h.id),
    [1],
  );
  const h = hits[0];
  assert.ok(h?.snippet && h.mark);
  assert.equal(h.snippet.slice(h.mark[0], h.mark[1]), '회의록');
  assert.ok(h.snippet.startsWith('…'), '앞을 잘랐으면 말줄임표');
});

test('대소문자와 풀린 한글(NFD)을 가리지 않는다', () => {
  const nfd = '프로젝트 회의'.normalize('NFD');
  assert.deepEqual(
    searchNotes([note(1, '', `Weekly ${nfd}`)], 'WEEKLY 프로젝트').map((h) => h.id),
    [1],
  );
  assert.deepEqual(
    searchNotes([note(1, 'MEMO', '')], 'memo').map((h) => h.id),
    [1],
  );
});

test('제목에서 찾으면 둘레 글 없이, 본문에서만 찾으면 둘레 글과 찾은 부분', () => {
  const [a, b] = searchNotes(
    [note(1, '장보기', '우유'), note(2, '오늘', '장보기 목록\n우유 계란')],
    '장보기',
  );
  assert.deepEqual(a, { id: 1 });
  // 2번은 제목이 "오늘" 이라 본문에서 찾았다. 줄바꿈은 한 칸으로
  assert.equal(b?.snippet, '장보기 목록 우유 계란');
  assert.deepEqual(b?.mark, [0, 3]);
});

test('띄어쓰기는 줄바꿈과 여러 칸도 맞춘다', () => {
  assert.equal(searchNotes([note(1, '제목', '보고서\n\n  마감')], '보고서 마감').length, 1);
});

test('정규식 기호를 글자 그대로 찾는다', () => {
  assert.equal(searchNotes([note(1, '제목', 'a+b (1)')], 'a+b (1)').length, 1);
  assert.equal(searchNotes([note(1, '제목', 'aab 1')], 'a+b').length, 0);
});

test('한글 조합 중이면 마지막 글자를 넓게 본다', () => {
  const notes = [note(1, '제목', '강아지 산책'), note(2, '제목', '가방 챙기기')];
  // "강" 을 치는 중에는 입력칸에 "가" 가 먼저 보인다
  assert.deepEqual(
    searchNotes(notes, '가', true).map((h) => h.id),
    [1, 2],
  );
  assert.deepEqual(
    searchNotes(notes, '가', false).map((h) => h.id),
    [2],
  );
  // 홀로 선 자음: "산ㅊ" 은 "산책" 을 찾는다
  assert.deepEqual(
    searchNotes(notes, '산ㅊ', true).map((h) => h.id),
    [1],
  );
  assert.equal(searchNotes(notes, '산ㅊ', false).length, 0);
});

test('빈 말이면 전부, 정규식은 null', () => {
  assert.equal(noteQuery('   '), null);
  assert.equal(searchNotes([note(1, 'a', ''), note(2, 'b', '')], ' ').length, 2);
});
