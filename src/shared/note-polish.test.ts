import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanPolished, POLISH_FENCE, polishRequest, splicePolished } from './note-polish.ts';

test('원문을 경계 줄 사이에 넣어 보낸다', () => {
  assert.equal(polishRequest('다듬어 줘', '안녕'), `다듬어 줘\n${POLISH_FENCE}\n안녕\n${POLISH_FENCE}`);
});

test('답에서 머리말, 경계 줄, 코드 칸 감싸기를 걷는다', () => {
  assert.equal(cleanPolished('다듬은 글:\n좋은 글이야.', '원문'), '좋은 글이야.');
  assert.equal(cleanPolished("Here's the polished version:\nNice.", 'x'), 'Nice.');
  assert.equal(cleanPolished(`${POLISH_FENCE}\n가나다\n${POLISH_FENCE}`, '원문'), '가나다');
  assert.equal(cleanPolished('```markdown\n# 제목\n- 하나\n```', '# 제목'), '# 제목\n- 하나');
  // 원문이 코드 칸이면 그대로
  assert.equal(cleanPolished('```js\nx()\n```', '```js\nx( )\n```'), '```js\nx()\n```');
  assert.equal(cleanPolished('  \n ', '원문'), undefined);
  assert.equal(cleanPolished(undefined, '원문'), undefined);
});

test('마크다운 본문은 건드리지 않는다', () => {
  const md = '# 회의\n\n- 결정: 금요일 배포\n- 담당: 민수';
  assert.equal(cleanPolished(md, md), md);
});

test('고른 부분만 바꾸거나 전체를 바꾼다', () => {
  assert.equal(splicePolished('앞 가운데 뒤', 2, 5, '중간'), '앞 중간 뒤');
  assert.equal(splicePolished('전체 글', 0, 0, '새 글'), '새 글');
  assert.equal(splicePolished('전체 글', 3, 3, '새 글'), '새 글');
});
