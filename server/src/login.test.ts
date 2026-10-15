import assert from 'node:assert/strict';
import test from 'node:test';
import { doneUrl, parseAppState, parsePort } from './login';
import { RateLimiter } from './rate-limit';
import { tokenKind } from './tokens';

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
