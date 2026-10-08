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
