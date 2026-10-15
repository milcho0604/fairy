import assert from 'node:assert/strict';
import test from 'node:test';
import { googleEnabled, readConfig } from './config';

test('DATABASE_URL 이 없으면 뜨지 않는다', () => {
  assert.throws(() => readConfig({}), /DATABASE_URL/);
});

test('PORT 는 기본 3002, 숫자가 아니면 거절', () => {
  assert.equal(readConfig({ DATABASE_URL: 'postgres://x' }).port, 3002);
  assert.equal(readConfig({ DATABASE_URL: 'postgres://x', PORT: '4000' }).port, 4000);
  assert.throws(() => readConfig({ DATABASE_URL: 'postgres://x', PORT: 'abc' }), /PORT/);
});

test('PUBLIC_URL 은 기본 fairy-api.moilga.com, https 만 (127.0.0.1 은 http 허락)', () => {
  assert.equal(readConfig({ DATABASE_URL: 'postgres://x' }).publicUrl, 'https://fairy-api.moilga.com');
  assert.equal(
    readConfig({ DATABASE_URL: 'postgres://x', PUBLIC_URL: 'https://a.example/' }).publicUrl,
    'https://a.example',
  );
  assert.equal(
    readConfig({ DATABASE_URL: 'postgres://x', PUBLIC_URL: 'http://127.0.0.1:9' }).publicUrl,
    'http://127.0.0.1:9',
  );
  assert.throws(() => readConfig({ DATABASE_URL: 'postgres://x', PUBLIC_URL: 'http://a.example' }), /https/);
  assert.throws(() => readConfig({ DATABASE_URL: 'postgres://x', PUBLIC_URL: 'nope' }), /PUBLIC_URL/);
});

test('구글 로그인은 클라이언트 번호와 비밀이 둘 다 있어야 켜진다', () => {
  assert.equal(googleEnabled(readConfig({ DATABASE_URL: 'postgres://x' })), false);
  assert.equal(googleEnabled(readConfig({ DATABASE_URL: 'postgres://x', GOOGLE_CLIENT_ID: 'a' })), false);
  assert.equal(
    googleEnabled(
      readConfig({ DATABASE_URL: 'postgres://x', GOOGLE_CLIENT_ID: 'a', GOOGLE_CLIENT_SECRET: 'b' }),
    ),
    true,
  );
});
