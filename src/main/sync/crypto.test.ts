import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import {
  checkScryptParams,
  formatRecoveryCode,
  newDataKey,
  newRecoveryCode,
  normalizeRecoveryCode,
  openItem,
  sealItem,
  unwrapDataKey,
  wrapDataKey,
} from './crypto.ts';

const fast = { N: 1 << 10, r: 8, p: 1 };
const ctx = { account: 'F-AAAA-BBBB', gen: 1 };

test('복구 코드는 25글자이고 5글자씩 다섯 묶음이다', () => {
  const c = newRecoveryCode();
  assert.match(c, /^[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){4}$/);
  const seen = new Set(Array.from({ length: 50 }, () => newRecoveryCode()));
  assert.equal(seen.size, 50);
});

test('복구 코드 정규화: 대소문자, 하이픈, 공백, O/0, I/L/1 혼동', () => {
  const canon = '0123456789ABCDEFGHJKMNPQR';
  assert.equal(normalizeRecoveryCode(formatRecoveryCode(canon)), canon);
  assert.equal(normalizeRecoveryCode('o1234 56789-abcde fghjk mnpqr'), canon);
  assert.equal(normalizeRecoveryCode('01234 56789 ABCDE FGHJK MNPQR'), canon);
  // 붙여 넣을 때 하이픈이 다른 줄표 모양으로 바뀐 경우
  assert.equal(
    normalizeRecoveryCode(['01234', '56789', 'ABCDE', 'FGHJK', 'MNPQR'].join(String.fromCharCode(0x2013))),
    canon,
  );
  // 붙여 넣을 때 따라온 눈에 안 보이는 글자와 여러 공백류
  const hidden = ['\u200b', '\u200c', '\u200d', '\ufeff', '\u2060', '\u00ad'].join('');
  assert.equal(normalizeRecoveryCode(`${hidden}01234\u00a056789\u3000ABCDE\tFGHJK\r\nMNPQR${hidden}`), canon);
  assert.equal(normalizeRecoveryCode('01\u200b234-56789-ABCDE-FGHJK-MNPQR'), canon);
  // I 와 L 은 1 로 읽는다
  assert.equal(normalizeRecoveryCode('IIIII-LLLLL-iiiii-lllll-11111'), '1'.repeat(25));
  // 길이가 다르거나 없는 글자(U)가 있으면 null
  assert.equal(normalizeRecoveryCode('0123-4567'), null);
  assert.equal(normalizeRecoveryCode('U'.repeat(25)), null);
  assert.equal(normalizeRecoveryCode(`${canon}0`), null);
  assert.equal(normalizeRecoveryCode(''), null);
});

test('열쇠 감싸기 왕복, 틀린 코드와 바꿔치기(다른 계정, 다른 세대, 다른 소금, 다른 매개변수)는 풀리지 않는다', async () => {
  const key = newDataKey();
  const code = newRecoveryCode();
  const w = await wrapDataKey(key, code, 'F-AAAA-BBBB', 1, fast);
  assert.equal(w.params.N, 1024);
  const got = await unwrapDataKey(w, code, 'F-AAAA-BBBB', 1);
  assert.deepEqual(got, key);
  // 표기만 다른 같은 코드
  assert.deepEqual(await unwrapDataKey(w, code.toLowerCase().replace(/-/g, ' '), 'F-AAAA-BBBB', 1), key);
  assert.equal(await unwrapDataKey(w, newRecoveryCode(), 'F-AAAA-BBBB', 1), null, '틀린 코드');
  assert.equal(await unwrapDataKey(w, code, 'F-CCCC-DDDD', 1), null, '다른 계정');
  assert.equal(await unwrapDataKey(w, code, 'F-AAAA-BBBB', 2), null, '다른 세대');
  const w2 = await wrapDataKey(key, code, 'F-AAAA-BBBB', 1, fast);
  assert.equal(await unwrapDataKey({ ...w, salt: w2.salt }, code, 'F-AAAA-BBBB', 1), null, '다른 소금');
  assert.equal(
    await unwrapDataKey({ ...w, params: { N: 2048, r: 8, p: 1 } }, code, 'F-AAAA-BBBB', 1),
    null,
    '다른 매개변수',
  );
  // 감쌀 때마다 소금과 nonce 가 다르다
  assert.notEqual(w.salt, w2.salt);
  assert.notEqual(w.wrapped, w2.wrapped);
});

test('범위 밖 scrypt 매개변수는 받지 않는다 (N<=2^17, r<=8, p<=1)', async () => {
  assert.deepEqual(checkScryptParams({ N: 1 << 17, r: 8, p: 1 }), { N: 131072, r: 8, p: 1 });
  assert.deepEqual(checkScryptParams({ N: 1 << 15, r: 8, p: 1 }), { N: 32768, r: 8, p: 1 });
  for (const bad of [
    { N: 1 << 18, r: 8, p: 1 },
    { N: 1 << 15, r: 9, p: 1 },
    { N: 1 << 15, r: 8, p: 2 },
    { N: 1000, r: 8, p: 1 },
    { N: 1, r: 8, p: 1 },
    { N: 1 << 15, r: 0, p: 1 },
    { N: 1 << 15, r: 8 },
    { N: 1 << 15, r: 8, p: 1, extra: 1 },
    { N: '32768', r: 8, p: 1 },
    null,
    [],
  ])
    assert.equal(checkScryptParams(bad), null, JSON.stringify(bad));
  // 서버가 준 값이 범위 밖이면 풀기 전에 던진다 (느린 값을 억지로 쓰게 하지 못한다)
  const key = newDataKey();
  const code = newRecoveryCode();
  const w = await wrapDataKey(key, code, 'F-AAAA-BBBB', 1, fast);
  await assert.rejects(unwrapDataKey({ ...w, params: { N: 1 << 20, r: 8, p: 1 } }, code, 'F-AAAA-BBBB', 1));
  await assert.rejects(wrapDataKey(key, code, 'F-AAAA-BBBB', 1, { N: 1 << 18, r: 8, p: 1 }));
});

test('항목 잠그기 왕복, 256바이트 단위로 채우고 nonce 는 매번 다르다', () => {
  const key = newDataKey();
  const a = sealItem(key, ctx, 'u1', 'todo', { f: { title: '우유 사기' }, c: { title: 5 } });
  const b = sealItem(key, ctx, 'u1', 'todo', { f: { title: '우유 사기' }, c: { title: 5 } });
  assert.notDeepEqual(a, b, '같은 글도 잠글 때마다 다르다');
  assert.notDeepEqual(a.subarray(0, 12), b.subarray(0, 12), 'nonce');
  assert.equal((a.length - 12 - 16) % 256, 0);
  const o = openItem(key, ctx, 'u1', a);
  assert.equal(o.kind, 'todo');
  assert.equal(o.uid, 'u1');
  assert.deepEqual(o.f, { title: '우유 사기' });
  // 짧은 글과 긴 글은 길이가 256 단위로만 다르다
  const small = sealItem(key, ctx, 'u1', 'note', { f: { body: 'a' } });
  const big = sealItem(key, ctx, 'u1', 'note', { f: { body: randomBytes(4000).toString('hex') } });
  assert.equal(small.length, 12 + 256 + 16);
  assert.ok(big.length > small.length);
  assert.equal((big.length - 28) % 256, 0);
  // nonce 400개가 겹치지 않는다
  const nonces = new Set(
    Array.from({ length: 400 }, () => sealItem(key, ctx, 'u1', 'todo', {}).subarray(0, 12).toString('hex')),
  );
  assert.equal(nonces.size, 400);
});

test('항목 바꿔치기(다른 uid, 다른 세대, 다른 계정, 다른 열쇠, 깨진 글)는 풀리지 않고 안쪽 uid 가 다르면 거절한다', () => {
  const key = newDataKey();
  const blob = sealItem(key, ctx, 'u1', 'note', { f: { title: 't' } });
  assert.throws(() => openItem(key, ctx, 'u2', blob), '다른 uid');
  assert.throws(() => openItem(key, { ...ctx, gen: 2 }, 'u1', blob), '다른 세대');
  assert.throws(() => openItem(key, { ...ctx, account: 'F-ZZZZ-ZZZZ' }, 'u1', blob), '다른 계정');
  assert.throws(() => openItem(newDataKey(), ctx, 'u1', blob), '다른 열쇠');
  const bent = Buffer.from(blob);
  bent[40] = (bent[40] as number) ^ 1;
  assert.throws(() => openItem(key, ctx, 'u1', bent), '비트 하나 뒤집음');
  assert.throws(() => openItem(key, ctx, 'u1', blob.subarray(0, 20)), '잘림');
  // 같은 AAD 로 잠갔지만 안쪽 uid 가 다른 덩어리 (서버가 다른 항목의 덩어리를 같은 uid 자리에 둔 경우): 안쪽 비교로 거절
  const other = sealItem(key, ctx, 'u9', 'note', { f: {} });
  assert.throws(() => openItem(key, ctx, 'u1', other));
});
