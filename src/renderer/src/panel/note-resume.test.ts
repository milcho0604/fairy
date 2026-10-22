import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseResume, RESUME_MS } from './note-resume.ts';

const NOW = 1_800_000_000_000;
const ok = { id: 3, field: 'body', start: 5, end: 9, scroll: 120, at: NOW - 1000 };

test('적어 둔 메모 자리를 읽는다', () => {
  assert.deepEqual(parseResume(JSON.stringify(ok), NOW), ok);
});

test('오래됐거나 모양이 틀리면 목록에서 연다', () => {
  assert.equal(parseResume(JSON.stringify({ ...ok, at: NOW - RESUME_MS - 1 }), NOW), undefined);
  assert.equal(parseResume(JSON.stringify({ ...ok, field: 'x' }), NOW), undefined);
  assert.equal(parseResume(JSON.stringify({ ...ok, id: -1 }), NOW), undefined);
  assert.equal(parseResume(JSON.stringify({ ...ok, start: 1.5 }), NOW), undefined);
  assert.equal(parseResume('{', NOW), undefined);
  assert.equal(parseResume('null', NOW), undefined);
  assert.equal(parseResume(null, NOW), undefined);
});

test('뒤집힌 범위는 바로 세운다', () => {
  assert.deepEqual(parseResume(JSON.stringify({ ...ok, start: 9, end: 5 }), NOW), ok);
});

test('저장하지 못한 글(draft)도 같이 적어 두고, 하루가 지나도 읽는다 (디스크 가득, 버그잡이 4)', () => {
  const at = 1_000_000_000;
  const base = { id: 3, field: 'body', start: 1, end: 1, scroll: 0, at };
  const draft = { title: '회의', body: '저장 못 한 글' };
  assert.deepEqual(parseResume(JSON.stringify({ ...base, draft }), at + 1000)?.draft, draft);
  // 저장 못 한 글이 있으면 30분이 지나도 버리지 않는다 (7일까지)
  assert.deepEqual(parseResume(JSON.stringify({ ...base, draft }), at + 86_400_000)?.draft, draft);
  assert.equal(parseResume(JSON.stringify({ ...base, draft }), at + 8 * 86_400_000), undefined);
  // 모양이 틀린 draft 는 자리만 살린다
  assert.equal(parseResume(JSON.stringify({ ...base, draft: { title: 1 } }), at + 1000)?.draft, undefined);
});

test('거절 상태가 붙은 보관 글을 읽는다 (그때 저장돼 있던 글과 시각)', () => {
  const kept = {
    ...ok,
    draft: { title: 't', body: '내 글' },
    conflict: { body: '다른 곳 글', at: NOW - 5000, title: 'x' },
  };
  assert.deepEqual(parseResume(JSON.stringify(kept), NOW), kept);
  // 보관 글이 없으면 거절 상태만 남지 않는다. 모양이 틀린 거절 상태는 버린다
  assert.equal(parseResume(JSON.stringify({ ...ok, conflict: kept.conflict }), NOW)?.conflict, undefined);
  assert.equal(
    parseResume(JSON.stringify({ ...kept, conflict: { body: 1, at: 1 } }), NOW)?.conflict,
    undefined,
  );
  assert.equal(
    parseResume(JSON.stringify({ ...kept, conflict: { body: 'a', at: -1 } }), NOW)?.conflict,
    undefined,
  );
});
