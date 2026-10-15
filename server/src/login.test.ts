import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import type { Accounts } from './accounts';
import type { Config } from './config';
import type { Db } from './db';
import type { GoogleApi } from './google';
import {
  doneUrl,
  Login,
  MAX_PENDING,
  PENDING_PER_IP,
  parseAppState,
  parseChallenge,
  parsePort,
  verifierMatches,
} from './login';
import { ipKey, RateLimiter } from './rate-limit';
import { tokenKind } from './tokens';

test('레이트리밋 키: cf-connecting-ip 가 없으면 소켓 원격 주소로 (한 키로 몰지 않는다)', () => {
  const a = ipKey({ headers: {}, socket: { remoteAddress: '192.0.2.1' } });
  const b = ipKey({ headers: {}, socket: { remoteAddress: '192.0.2.2' } });
  assert.notEqual(a, b);
  assert.doesNotMatch(a, /192/);
  const cf = ipKey({
    headers: { 'cf-connecting-ip': '198.51.100.7' },
    socket: { remoteAddress: '127.0.0.1' },
  });
  assert.equal(
    cf,
    ipKey({ headers: { 'cf-connecting-ip': '198.51.100.7' }, socket: { remoteAddress: '::1' } }),
  );
});

test('대기 로그인: 같은 곳은 PENDING_PER_IP 까지, 전체가 차면 가장 오래된 것을 밀어낸다 (던지지 않는다)', () => {
  const config = { publicUrl: 'https://x.example', googleClientId: 'c', googleClientSecret: 's' } as Config;
  const login = new Login(config, {} as GoogleApi, {} as Db, {} as Accounts);
  const ch = 'A'.repeat(43);
  for (let i = 0; i < PENDING_PER_IP; i++) assert.ok(login.start(5000, 'abcdefgh', ch, 'ip:a', 0));
  assert.equal(login.start(5000, 'abcdefgh', ch, 'ip:a', 0), undefined);
  const first = new URL(login.start(5000, 'abcdefgh', ch, 'ip:0', 0) ?? '').searchParams.get('state');
  for (let i = 1; login.pendingCount < MAX_PENDING; i++) login.start(5000, 'abcdefgh', ch, `ip:${i}`, 0);
  assert.ok(login.start(5000, 'abcdefgh', ch, 'ip:new', 0));
  assert.equal(login.pendingCount, MAX_PENDING);
  // 가장 먼저 연 것(ip:a 의 첫 것)이 밀려났다. ip:0 은 아직 있다
  assert.ok(login.takePending(first, 0));
});

test('로컬 PKCE: challenge 는 43자, verifier 의 sha256 이 맞아야 한다', () => {
  const v = 'v'.repeat(43);
  const ch = createHash('sha256').update(v).digest('base64url');
  assert.equal(parseChallenge(ch), ch);
  assert.equal(parseChallenge('short'), undefined);
  assert.ok(verifierMatches(v, ch));
  assert.ok(!verifierMatches('w'.repeat(43), ch));
  assert.ok(!verifierMatches('v'.repeat(42), ch));
  assert.ok(!verifierMatches(undefined, ch));
});

test('루프백 포트는 1024~65535 숫자만', () => {
  assert.equal(parsePort('53682'), 53682);
  assert.equal(parsePort('1024'), 1024);
  for (const bad of ['80', '1023', '65536', '0x50', '5000 ', '-1', '', undefined, ['5000']])
    assert.equal(parsePort(bad), undefined, String(bad));
});

test('돌려보내는 곳은 언제나 127.0.0.1/done (오픈 리디렉트 없음)', () => {
  const u = new URL(doneUrl(5000, { code: 'a b', state: 'x@evil.example/' }));
  assert.equal(u.origin, 'http://127.0.0.1:5000');
  assert.equal(u.pathname, '/done');
  assert.equal(u.searchParams.get('state'), 'x@evil.example/');
  assert.equal(parseAppState('x@evil.example/'), undefined);
  assert.equal(parseAppState('abcDEF12_-'), 'abcDEF12_-');
});

test('토큰 모양: 기기 fd_, 세션 fs_, 32바이트 base64url', () => {
  assert.equal(tokenKind(`fd_${'A'.repeat(43)}`), 'device');
  assert.equal(tokenKind(`fs_${'A'.repeat(43)}`), 'session');
  assert.equal(tokenKind(`fd_${'A'.repeat(42)}`), undefined);
  assert.equal(tokenKind(`fx_${'A'.repeat(43)}`), undefined);
});

test('레이트리밋: 창 안에서 max 까지, 창이 지나면 다시', () => {
  let now = 0;
  const r = new RateLimiter(() => now);
  const limit = { max: 2, windowMs: 1000 };
  assert.equal(r.take('k', limit), true);
  assert.equal(r.take('k', limit), true);
  assert.equal(r.take('k', limit), false);
  assert.equal(r.take('other', limit), true);
  now = 1000;
  assert.equal(r.take('k', limit), true);
  r.onModuleDestroy();
});
