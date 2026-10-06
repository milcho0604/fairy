import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanLocalAnswer } from './local-text.ts';

test('생각 표시를 지운다 (닫힌 것, 받는 중 안 닫힌 것)', () => {
  assert.equal(cleanLocalAnswer('<think>음...</think>\n안녕!'), '안녕!');
  assert.equal(cleanLocalAnswer('안녕 <think>음', { partial: true }), '안녕 ');
});

test('한자와 되풀이를 지운다 (시험에서 본 모양)', () => {
  assert.equal(cleanLocalAnswer('회의 준비사항定정'), '회의 준비사항정');
  assert.equal(cleanLocalAnswer('전화 전화 확인'), '전화 확인');
  assert.equal(cleanLocalAnswer('안녕하세요! 네! 네! 네! 네!'), '안녕하세요! 네!');
});

test('코드 블록 안은 건드리지 않는다', () => {
  const code = '이렇게 해:\n```py\nx = x x\nprint("中")\n```';
  assert.equal(cleanLocalAnswer(code), code);
});

test('그냥 글은 네 문장까지, 목록은 그대로', () => {
  assert.equal(cleanLocalAnswer('하나. 둘. 셋. 넷. 다섯. 여섯.'), '하나. 둘. 셋. 넷.');
  const list = '1. 하나\n2. 둘\n3. 셋\n4. 넷\n5. 다섯';
  assert.equal(cleanLocalAnswer(list), list);
});

test('되풀이 지우기는 낱말 경계에서만 (비교 점검에서 깨지던 글)', () => {
  for (const ok of [
    '사과 과일',
    '그 그림을 봤어',
    '다 다음에',
    'the theme',
    'an android',
    'I had had lunch',
  ]) {
    assert.equal(cleanLocalAnswer(ok), ok);
  }
  assert.equal(cleanLocalAnswer('ok ok ok fine'), 'ok fine');
});

test('받는 중에는 되풀이를 줄이지 않아 앞 글이 바뀌지 않는다', () => {
  const a = cleanLocalAnswer('그 그', { partial: true });
  const b = cleanLocalAnswer('그 그림을 봤어', { partial: true });
  assert.ok(b.startsWith(a));
});

test('반말로 바꾸기: 시험에서 나온 존댓말 어미 (모르는 꼴은 그대로)', () => {
  const ban = (s: string) => cleanLocalAnswer(s, { banmal: true });
  assert.equal(ban('대한민국의 수도는 서울입니다.'), '대한민국의 수도는 서울이야.');
  assert.equal(ban('안녕하세요! 오늘 회의 준비를 정리해 드릴게요.'), '안녕! 오늘 회의 준비를 정리해 줄게.');
  assert.equal(ban('`list[::-1]`로 해보세요.'), '`list[::-1]`로 해봐.');
  assert.equal(ban('있습니다. 좋습니다. 했습니다.'), '있어. 좋아. 했어.');
  assert.equal(ban('저는 콩이예요.'), '나는 콩이야.');
  assert.equal(ban('이건 중요. 필요해요?'), '이건 중요. 필요해?');
  assert.equal(ban('정말 아파요.'), '정말 아파요.');
  // 반말이 아닌 말(영어)은 그대로, 코드 블록 안도 그대로
  assert.equal(ban('Hello! How can I help?'), 'Hello! How can I help?');
  assert.equal(ban('이렇게 해요.\n```\nprint("합니다.")\n```'), '이렇게 해.\n```\nprint("합니다.")\n```');
});

test('혼자 이어 쓴 대화와 이름표, 이모지 여러 개', () => {
  assert.equal(cleanLocalAnswer('콩이: 안녕!\n사용자: 또 물어볼게'), '안녕!');
  assert.equal(cleanLocalAnswer('좋아 😊 정말 🐾🌟'), '좋아 😊 정말');
  // 문장은 점 뒤에 공백이 있을 때만 자른다 (list.reverse() 의 점)
  assert.equal(
    cleanLocalAnswer('list.reverse() 를 써. 하나. 둘. 셋. 넷.'),
    'list.reverse() 를 써. 하나. 둘. 셋.',
  );
});

test('같은 코드 블록, 같은 줄 되풀이는 처음 것만', () => {
  const block = '```python\nx[::-1]\n```';
  assert.equal(cleanLocalAnswer(`이렇게 해:\n${block}\n${block}\n${block}`), `이렇게 해:\n${block}`);
  assert.equal(cleanLocalAnswer('1. 자료 정리\n2. 자료 정리\n3. 시간 확인'), '1. 자료 정리\n3. 시간 확인');
});

test('일본어 가나도 지운다', () => {
  assert.equal(cleanLocalAnswer('피곤하면 떠上がって도 괜찮아.'), '피곤하면 떠도 괜찮아.');
});
