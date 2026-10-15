import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanServerUrl, serverEnabled, serverUrl } from './server-url.ts';

test('빌드 때 주소가 없으면 서버 기능이 꺼진다', () => {
  assert.equal(serverUrl('', undefined, true), '');
  assert.equal(serverUrl(undefined, undefined, false), '');
  assert.equal(serverEnabled(serverUrl('', undefined, true)), false);
});

test('운영 주소는 https origin 만 받는다', () => {
  assert.equal(cleanServerUrl('https://fairy-api.moilga.com'), 'https://fairy-api.moilga.com');
  assert.equal(cleanServerUrl('https://fairy-api.moilga.com/'), 'https://fairy-api.moilga.com');
  assert.equal(cleanServerUrl(' https://fairy-api.moilga.com '), 'https://fairy-api.moilga.com');
  for (const bad of [
    'http://fairy-api.moilga.com',
    'https://fairy-api.moilga.com/v1',
    'https://u:p@fairy-api.moilga.com',
    'https://fairy-api.moilga.com/?a=1',
    'javascript:alert(1)',
    '아무 글',
  ]) {
    assert.equal(cleanServerUrl(bad), '', bad);
  }
  assert.equal(serverEnabled(serverUrl('https://fairy-api.moilga.com', undefined, true)), true);
});

test('시험용 주소는 개발 실행에서 이 컴퓨터 http 만', () => {
  assert.equal(serverUrl('', 'http://127.0.0.1:3002', false), 'http://127.0.0.1:3002');
  assert.equal(serverUrl('', 'http://localhost:3002/', false), 'http://localhost:3002');
  // 설치판은 무시하고 빌드 때 주소를 쓴다
  assert.equal(
    serverUrl('https://fairy-api.moilga.com', 'http://127.0.0.1:3002', true),
    'https://fairy-api.moilga.com',
  );
  // 다른 컴퓨터, 경로가 붙은 것은 받지 않는다
  assert.equal(serverUrl('', 'http://192.168.0.2:3002', false), '');
  assert.equal(serverUrl('', 'http://127.0.0.1:3002/v1', false), '');
  assert.equal(serverUrl('', 'https://evil.example', false), '');
});
