import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createNoteKeep, DRAFT_MS, NOTE_KEEP_MAX, parseNoteKept, RESUME_MS } from './note-keep.ts';
import { NOTE_BODY_MAX } from './note-store.ts';

const NOW = 1_800_000_000_000;
const pos = { field: 'body', start: 2, end: 2, scroll: 0, at: NOW };
const withDraft = (body: string, extra = {}) => ({ ...pos, draft: { title: 't', body }, ...extra });

test('메모마다 따로 둔다: 다른 메모의 보관 글을 쓰거나 지워도 서로 안 건드린다', () => {
  const k = createNoteKeep();
  k.set(1, withDraft('A 의 내 글', { conflict: { body: '다른 곳 글', at: NOW - 1 } }), NOW);
  // B 를 열었다 닫는다 (자리만 적고 지운다)
  k.set(2, pos, NOW);
  k.set(2, null, NOW);
  assert.equal(k.get(1, NOW)?.draft?.body, 'A 의 내 글');
  assert.equal(k.get(1, NOW)?.conflict?.body, '다른 곳 글');
  assert.equal(k.get(2, NOW), undefined);
  // A 만 지우면 A 가 사라진다
  k.set(1, undefined, NOW);
  assert.equal(k.get(1, NOW), undefined);
});

test('값의 id 는 무시하고 키의 id 를 쓴다 (다른 메모를 덮지 못한다)', () => {
  const k = createNoteKeep();
  k.set(1, { ...withDraft('x'), id: 99 }, NOW);
  assert.equal(k.get(1, NOW)?.id, 1);
  assert.equal(k.get(99, NOW), undefined);
});

test('모양이 틀린 값은 그 메모의 보관 글을 지운다', () => {
  const k = createNoteKeep();
  k.set(1, withDraft('x'), NOW);
  k.set(1, { field: 'x' }, NOW);
  assert.equal(k.get(1, NOW), undefined);
  k.set('1', withDraft('x'), NOW);
  k.set(-1, withDraft('x'), NOW);
  k.set(1.5, withDraft('x'), NOW);
  assert.equal(k.latest(NOW), undefined);
});

test('크기 상한: 글은 메모 상한으로 자르고, 메모는 30개까지만 둔다 (오래된 것부터 버림)', () => {
  const k = createNoteKeep();
  k.set(1, withDraft('가'.repeat(NOTE_BODY_MAX + 500)), NOW);
  assert.equal(k.get(1, NOW)?.draft?.body.length, NOTE_BODY_MAX);
  const k2 = createNoteKeep();
  for (let i = 1; i <= NOTE_KEEP_MAX + 5; i++) k2.set(i, withDraft(`글${i}`), NOW);
  assert.equal(k2.get(1, NOW), undefined);
  assert.equal(k2.get(5, NOW), undefined);
  assert.equal(k2.get(6, NOW)?.draft?.body, '글6');
  assert.equal(k2.get(NOTE_KEEP_MAX + 5, NOW)?.draft?.body, `글${NOTE_KEEP_MAX + 5}`);
});

test('오래됨: 자리만 있으면 30분, 저장하지 못한 글이 있으면 7일', () => {
  const k = createNoteKeep();
  k.set(1, pos, NOW);
  k.set(2, withDraft('글'), NOW);
  assert.ok(k.get(1, NOW + RESUME_MS));
  assert.equal(k.get(1, NOW + RESUME_MS + 1), undefined);
  assert.ok(k.get(2, NOW + DRAFT_MS));
  assert.equal(k.get(2, NOW + DRAFT_MS + 1), undefined);
});

test('패널을 열 때 돌아갈 메모: 가장 나중 것. 나간(parked) 것과 오래된 자리는 저절로 열지 않는다', () => {
  const k = createNoteKeep();
  k.set(1, { ...withDraft('A', { parked: true }), at: NOW }, NOW);
  assert.equal(k.latest(NOW), undefined, '뒤로 나간 메모는 저절로 열리지 않는다');
  assert.equal(k.get(1, NOW)?.draft?.body, 'A', '그 메모를 열면 보관 글이 돌아온다');
  k.set(2, { ...pos, at: NOW - 1000 }, NOW);
  k.set(3, { ...pos, at: NOW - 10 }, NOW);
  assert.equal(k.latest(NOW)?.id, 3);
  // 자리만 있던 오래된 것(30분 넘음)은 저절로 열지 않는다
  assert.equal(k.latest(NOW + RESUME_MS + 100)?.id, undefined);
});

test('읽을 때 모르는 칸은 버리고, 뒤집힌 범위는 세운다', () => {
  const r = parseNoteKept({ ...pos, id: 3, start: 9, end: 5, evil: 'x' }, NOW);
  assert.deepEqual(r, { id: 3, field: 'body', start: 5, end: 9, scroll: 0, at: NOW });
});
