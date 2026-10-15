import assert from 'node:assert/strict';
import { generateKeyPairSync, type JsonWebKey, sign } from 'node:crypto';
import test from 'node:test';
import { verifyIdToken } from './google';

const key = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...(key.publicKey.export({ format: 'jwk' }) as JsonWebKey), kid: 'k1' };
const NOW = 1_800_000_000_000;

function token(claims: Record<string, unknown>, head: Record<string, unknown> = { alg: 'RS256', kid: 'k1' }) {
  const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const data = `${enc(head)}.${enc(claims)}`;
  return `${data}.${sign('RSA-SHA256', Buffer.from(data), key.privateKey).toString('base64url')}`;
}

const good = {
  iss: 'accounts.google.com',
  aud: 'cid',
  sub: '1234',
  nonce: 'n1',
  iat: NOW / 1000,
  exp: NOW / 1000 + 600,
};
const opts = { clientId: 'cid', nonce: 'n1', jwks: async () => [jwk], now: NOW };

test('맞는 id_token 은 sub 를 돌려준다', async () => {
  assert.equal(await verifyIdToken(token(good), opts), '1234');
});

test('서명, 알고리즘, 키, aud, iss, exp, nonce, sub 가 틀리면 던진다', async () => {
  const bad: [string, string][] = [
    [token({ ...good, aud: 'x' }), 'aud'],
    [token({ ...good, iss: 'https://evil' }), 'iss'],
    [token({ ...good, exp: NOW / 1000 - 120 }), '만료'],
    [token({ ...good, nonce: 'n2' }), 'nonce'],
    [token({ ...good, sub: '' }), 'sub'],
    [token(good, { alg: 'none', kid: 'k1' }), '머리'],
    [token(good, { alg: 'RS256', kid: 'k2' }), '키'],
    [`${token(good).slice(0, -4)}AAAA`, '서명'],
    ['a.b', '모양'],
  ];
  for (const [t, why] of bad) await assert.rejects(verifyIdToken(t, opts), new RegExp(why), why);
});

test('kid 를 못 찾으면 공개 키를 한 번 다시 받는다', async () => {
  const calls: (boolean | undefined)[] = [];
  const jwks = async (refresh?: boolean) => {
    calls.push(refresh);
    return refresh ? [jwk] : [];
  };
  assert.equal(await verifyIdToken(token(good), { ...opts, jwks }), '1234');
  assert.deepEqual(calls, [undefined, true]);
  await assert.rejects(verifyIdToken(token(good), { ...opts, jwks: async () => [] }), /키/);
});

test('카카오 id_token: iss 를 넘기면 그것만 받는다 (구글 iss 는 거절)', async () => {
  const kakao = new Set(['https://kauth.kakao.com']);
  const k = { ...good, iss: 'https://kauth.kakao.com' };
  assert.equal(await verifyIdToken(token(k), { ...opts, issuers: kakao }), '1234');
  await assert.rejects(verifyIdToken(token(good), { ...opts, issuers: kakao }), /iss/);
  await assert.rejects(verifyIdToken(token(k), opts), /iss/);
});
