import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isSealed, openText, plainStored, sealText } from './seal';

const key = Buffer.alloc(32, 7);
const other = Buffer.alloc(32, 9);

test('왕복: 잠그면 접두어가 붙고 평문이 보이지 않으며 같은 자리에서 풀린다', () => {
  const s = sealText(key, '안녕 쪽지 hello', 'inbox|1');
  assert.ok(isSealed(s));
  assert.ok(!s.includes('hello'));
  assert.equal(openText(key, s, 'inbox|1'), '안녕 쪽지 hello');
});

test('같은 글도 매번 다른 암호문 (nonce)', () => {
  assert.notEqual(sealText(key, 'a', 'inbox|1'), sealText(key, 'a', 'inbox|1'));
});

test('AAD 가 다르면 풀리지 않는다 (줄 바꿔치기)', () => {
  const s = sealText(key, 'a', 'inbox|1');
  assert.throws(() => openText(key, s, 'inbox|2'));
});

test('잘못된 열쇠, 열쇠 없음, 깨진 글, 바뀐 글은 던진다', () => {
  const s = sealText(key, 'a', 'inbox|1');
  assert.throws(() => openText(other, s, 'inbox|1'));
  assert.throws(() => openText(undefined, s, 'inbox|1'));
  assert.throws(() => openText(key, 's1:AAAA', 'inbox|1'));
  const raw = Buffer.from(s.slice(3), 'base64');
  raw[14] = (raw[14] ?? 0) ^ 1;
  assert.throws(() => openText(key, `s1:${raw.toString('base64')}`, 'inbox|1'));
});

test('접두어가 없으면 평문으로 보고 그대로 돌려준다 (열쇠가 없어도)', () => {
  assert.equal(openText(undefined, '옛 평문', 'inbox|1'), '옛 평문');
  assert.equal(openText(key, '옛 평문', 'inbox|1'), '옛 평문');
});

test('평문이 접두어로 시작해도 구분된다 (s0: 로 감싸 저장)', () => {
  for (const t of ['s1:가짜', 's0:가짜', 's1:']) {
    const stored = plainStored(t);
    assert.ok(!isSealed(stored));
    assert.equal(openText(undefined, stored, 'inbox|1'), t);
  }
  assert.equal(plainStored('일반'), '일반');
});
