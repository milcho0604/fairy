import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  beats,
  bodyHash,
  canon,
  clampClock,
  conflictCopy,
  conflictCopyUid,
  DAY_MS,
  decideNoteBody,
  googleIdFromUid,
  type Json,
  mergeItems,
  type SyncItem,
  sameContent,
} from './sync-item.ts';

const item = (
  f: Record<string, Json>,
  c: Record<string, number>,
  over: Partial<SyncItem> = {},
): SyncItem => ({
  kind: 'todo',
  uid: 'u1',
  f,
  c,
  dev: 'd',
  ...over,
});

test('칸마다 시각이 큰 쪽이 이기고, 같으면 값의 글자 순서로 정한다 (어느 쪽에서 합쳐도 같다)', () => {
  const a = item({ title: '가', done: 0 }, { title: 5, done: 9 });
  const b = item({ title: '나', done: 1 }, { title: 7, done: 3 });
  const ab = mergeItems(a, b, undefined).item;
  const ba = mergeItems(b, a, undefined).item;
  assert.deepEqual(ab.f, { title: '나', done: 0 });
  assert.deepEqual(ab.f, ba.f);
  assert.deepEqual(ab.c, ba.c);
  const t1 = item({ title: '가' }, { title: 5 });
  const t2 = item({ title: '나' }, { title: 5 });
  assert.equal(mergeItems(t1, t2, undefined).item.f.title, '나');
  assert.equal(mergeItems(t2, t1, undefined).item.f.title, '나');
  assert.equal(beats(5, 'b', 5, 'a'), true);
  assert.equal(beats(5, 'a', 5, 'b'), false);
});

test('이 기기가 앞선 칸이 있으면 ahead, 받은 것이 모두 이기면 아니다', () => {
  const local = item({ title: '로컬', done: 0 }, { title: 9, done: 1 });
  const remote = item({ title: '원격', done: 1 }, { title: 5, done: 5 });
  const m = mergeItems(local, remote, undefined);
  assert.equal(m.ahead, true);
  assert.deepEqual(m.changed, ['done']);
  const m2 = mergeItems(item({ title: 'a' }, { title: 1 }), item({ title: 'b' }, { title: 2 }), undefined);
  assert.equal(m2.ahead, false);
  assert.equal(sameContent(m2.item, item({ title: 'b' }, { title: 2 })), true);
  // 이 기기에 없던 칸(새 판 앱의 칸)은 받는다
  assert.equal(
    mergeItems(item({ a: 1 }, { a: 1 }), item({ a: 1, extra: 'x' }, { a: 1, extra: 1 }), undefined).item.f
      .extra,
    'x',
  );
});

test('받은 칸 시각은 지금 + 1일로 자른다', () => {
  const now = 1_000_000_000_000;
  assert.equal(clampClock(now + 3 * DAY_MS, now), now + DAY_MS);
  assert.equal(clampClock(now + 1000, now), now + 1000);
  assert.equal(clampClock(5, now), 5);
});

test('canon 은 키 순서와 상관없다', () => {
  assert.equal(canon({ b: 1, a: [1, { d: 1, c: 2 }] }), canon({ a: [1, { c: 2, d: 1 }], b: 1 }));
  assert.notEqual(canon('1'), canon(1));
});

const seenOf = (body: string) => ({ hash: bodyHash(body), body });

test('메모 본문: 한쪽만 고쳤으면 충돌이 아니다', () => {
  const base = '처음';
  // 받은 쪽만 고침
  const r1 = decideNoteBody({ body: base, t: 1 }, seenOf(base), {
    body: '원격 고침',
    t: 5,
    baseHash: bodyHash(base),
  });
  assert.deepEqual([r1.body, r1.copy], ['원격 고침', undefined]);
  // 이 기기만 고침 (원격은 base 와 같은 본문)
  const r2 = decideNoteBody({ body: '로컬 고침', t: 9 }, seenOf(base), {
    body: base,
    t: 1,
    baseHash: bodyHash(base),
  });
  assert.deepEqual([r2.body, r2.copy], ['로컬 고침', undefined]);
});

test('메모 본문: 둘 다 고쳤고 덧붙임이면 합치고, 아니면 진 쪽이 사본이다', () => {
  const base = '우유';
  const r = decideNoteBody({ body: '우유\n빵', t: 5 }, seenOf(base), {
    body: '우유\n계란',
    t: 7,
    baseHash: bodyHash(base),
  });
  assert.equal(r.copy, undefined);
  assert.ok(r.body.includes('빵') && r.body.includes('계란'));
  assert.equal(r.t, 8, '합친 본문은 둘보다 늦은 시각');
  // 같은 입력을 반대로 두어도(양쪽 기기 관점) 같은 본문
  const r2 = decideNoteBody({ body: '우유\n계란', t: 7 }, seenOf(base), {
    body: '우유\n빵',
    t: 5,
    baseHash: bodyHash(base),
  });
  assert.equal(r2.body, r.body);
  assert.equal(r2.t, r.t);
  const x = decideNoteBody({ body: '다른 글 하나', t: 5 }, seenOf(base), {
    body: '또 다른 글',
    t: 7,
    baseHash: bodyHash(base),
  });
  assert.equal(x.body, '또 다른 글');
  assert.deepEqual(x.copy && [x.copy.body, x.copy.fromLocal], ['다른 글 하나', true]);
  const y = decideNoteBody({ body: '또 다른 글', t: 7 }, seenOf(base), {
    body: '다른 글 하나',
    t: 5,
    baseHash: bodyHash(base),
  });
  assert.equal(y.body, '또 다른 글');
  assert.deepEqual(y.copy && [y.copy.body, y.copy.fromLocal], ['다른 글 하나', false]);
  assert.equal(y.copy?.hash, x.copy?.hash, '진 쪽 지문이 같다');
});

test('메모 본문: 마지막으로 맞춘 본문을 모르면(처음 보는 항목) 둘 다 고친 것으로 보고 사본을 남긴다', () => {
  const r = decideNoteBody({ body: '가', t: 5 }, undefined, { body: '나', t: 7, baseHash: null });
  assert.equal(r.body, '나');
  assert.equal(r.copy?.body, '가');
});

test('충돌 사본 uid 는 원본 uid, 진 쪽 시각, 본문 지문이 같으면 같다', () => {
  assert.equal(conflictCopyUid('o', 5, 'h'), conflictCopyUid('o', 5, 'h'));
  assert.notEqual(conflictCopyUid('o', 5, 'h'), conflictCopyUid('o', 6, 'h'));
  assert.notEqual(conflictCopyUid('o', 5, 'h'), conflictCopyUid('p', 5, 'h'));
  assert.match(conflictCopyUid('o', 5, 'h'), /^[0-9a-f]{32}$/);
  const orig = item({ source: 'ai', title: '원본' }, {}, { kind: 'note', uid: 'o' });
  const c1 = conflictCopy(
    orig,
    { body: '본문', t: 9, hash: bodyHash('본문'), fromLocal: true },
    '제목 (충돌 사본)',
    { id: 'a' },
  );
  const c2 = conflictCopy(
    orig,
    { body: '본문', t: 9, hash: bodyHash('본문'), fromLocal: false },
    '제목 (충돌 사본)',
    { id: 'b' },
  );
  assert.equal(c1.uid, c2.uid);
  assert.deepEqual(c1.f, c2.f);
  assert.deepEqual(c1.c, c2.c);
  assert.equal(c1.copyOf, 'o');
  assert.equal(c1.f.source, 'ai');
});

test('구글 일정 id: uid 에서 정한다 (a~v, 0~9, 5~1024자, 같은 uid 는 같은 id)', () => {
  const uid = '0123456789abcdef0123456789abcdef';
  const id = googleIdFromUid(uid);
  assert.equal(id, googleIdFromUid(uid));
  assert.match(id, /^jjk[0-9a-v]{26}$/);
  assert.ok(id.length >= 5 && id.length <= 1024);
  assert.notEqual(id, googleIdFromUid('ffffffffffffffffffffffffffffffff'));
  // 16진 32자리가 아닌 uid 도 쓸 수 있는 id 가 나온다
  assert.match(googleIdFromUid('not a hex uid!'), /^jjk[0-9a-v]{26}$/);
  // 서로 다른 무작위 uid 1000개가 겹치지 않는다
  const seen = new Set<string>();
  for (let i = 0; i < 1000; i++) seen.add(googleIdFromUid(bodyHash(`x${i}`)));
  assert.equal(seen.size, 1000);
});
