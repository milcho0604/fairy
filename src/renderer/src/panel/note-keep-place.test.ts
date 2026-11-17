import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openFromKept, placeKeepOf } from './note-save.ts';

const pos = { field: 'body' as const, start: 1, end: 2, scroll: 3 };

// 탭을 떠날 때 적는 보관 글에 draft 와 base 가 있으면, 나가며 보낸 저장이 성공해도 낡은 글이 남는다
test('자리만 적는 보관 글에는 draft 와 base 가 없다', () => {
  const k = placeKeepOf(1, pos, 5, false);
  assert.equal(k.draft, undefined);
  assert.equal(k.base, undefined);
  assert.equal(k.conflict, undefined);
  assert.deepEqual({ field: k.field, start: k.start, end: k.end, scroll: k.scroll }, pos);
  assert.equal(k.parked, undefined);
  assert.equal(placeKeepOf(1, pos, 5, true).parked, true);
});

test('저장 성공 뒤 다른 곳이 제목을 고쳐도 낡은 제목으로 덮지 않는다', () => {
  const r = openFromKept(placeKeepOf(1, pos, 5, false), { title: 'B', body: 'b2', updatedAt: 9 });
  assert.equal(r, undefined);
});

test('저장 성공 뒤 다른 곳이 본문을 고쳐도 가짜 충돌을 띄우지 않는다', () => {
  const r = openFromKept(placeKeepOf(1, pos, 5, false), { title: 'A', body: 'b3', updatedAt: 9 });
  assert.equal(r, undefined);
});
