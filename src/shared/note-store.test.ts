import assert from 'node:assert/strict';
import { test } from 'node:test';
import { notePreview, noteQuery, searchNotes, staleNoteWrite } from './note-store.ts';

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

test('미리보기는 80자가 차면 남은 줄을 다듬지 않는다: 긴 메모가 많아도 패널 바꿈이 느려지지 않는다 (버그잡이 4)', () => {
  assert.equal(
    notePreview({ title: '', body: '# 제목\n\n- **첫** 항목\n> [둘](http://x)\n`셋`' }),
    '첫 항목 둘 셋',
  );
  assert.equal(notePreview({ title: '제목', body: '\n\n한 줄' }), '한 줄');
  assert.equal(notePreview({ title: '', body: `${'가'.repeat(100)}\n${'나'.repeat(100)}` }), '나'.repeat(80));
  // 50,000자 메모 2천 개: 예전에는 줄마다 정규식을 돌려 몇 초 걸렸다
  const body = Array.from({ length: 2500 }, (_, i) => `- **항목** ${i} [링크](http://x) 내용`)
    .join('\n')
    .slice(0, 50_000);
  const t0 = performance.now();
  for (let i = 0; i < 2000; i++) notePreview({ title: '긴 회의록', body });
  assert.ok(performance.now() - t0 < 1000);
  assert.equal(notePreview({ title: '긴 회의록', body }).length, 80);
});

// ---- 오래된 쓰기 거절 (같은 메모를 두 곳에서 고칠 때) ----

test('오래된 쓰기: 시각이 없는 옛 호출은 거절하지 않는다', () => {
  assert.equal(staleNoteWrite({ body: '다른 곳 글', updatedAt: 200 }, undefined, '내 글', '처음 글'), false);
});

test('오래된 쓰기: 그사이 아무도 안 고쳤으면(저장 시각이 같거나 이르면) 거절하지 않는다', () => {
  assert.equal(staleNoteWrite({ body: '처음 글', updatedAt: 100 }, 100, '내 글', '처음 글'), false);
  assert.equal(staleNoteWrite({ body: '처음 글', updatedAt: 90 }, 100, '내 글', '처음 글'), false);
});

test('오래된 쓰기: 다른 곳이 본문을 먼저 고쳤고 합칠 수 없으면 거절한다', () => {
  assert.equal(staleNoteWrite({ body: '다른 곳이 바꾼 글', updatedAt: 200 }, 100, '내 글', '처음 글'), true);
  // 처음 글을 몰라도(합칠 바탕이 없어도) 저장된 글과 다르면 거절한다
  assert.equal(staleNoteWrite({ body: '다른 곳이 바꾼 글', updatedAt: 200 }, 100, '내 글', undefined), true);
});

test('오래된 쓰기: 합칠 수 있는 경우는 거절하지 않는다 (덧붙임, 한쪽만 고침, 같은 글)', () => {
  // append_note 가 뒤에 덧붙였다: mergeNoteText 가 합친다
  assert.equal(
    staleNoteWrite({ body: '처음 글\n덧붙인 줄', updatedAt: 200 }, 100, '처음 글 고침', '처음 글'),
    false,
  );
  // 본문은 그대로이고 제목만 다른 곳이 고쳤다
  assert.equal(staleNoteWrite({ body: '처음 글', updatedAt: 200 }, 100, '내 글', '처음 글'), false);
  // 이 창은 본문을 안 건드렸다
  assert.equal(
    staleNoteWrite({ body: '다른 곳이 바꾼 글', updatedAt: 200 }, 100, '처음 글', '처음 글'),
    false,
  );
  // 둘이 같은 글로 고쳤다
  assert.equal(staleNoteWrite({ body: '같은 글', updatedAt: 200 }, 100, '같은 글', '처음 글'), false);
});

test('오래된 쓰기: 제목만 보내는 쓰기는 거절하지 않는다', () => {
  assert.equal(
    staleNoteWrite({ body: '다른 곳이 바꾼 글', updatedAt: 200 }, 100, undefined, '처음 글'),
    false,
  );
});
