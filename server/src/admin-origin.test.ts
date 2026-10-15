import assert from 'node:assert/strict';
import test from 'node:test';
import { type AdminReq, sameOrigin } from './admin';

// 웹 /admin 의 같은 곳 판정 (QA #112). 실제 브라우저 확인은 scripts/dev/qa-pr112.mjs (Chromium 창에서 폼 제출)
const URL_ = 'https://fairy-api.moilga.com';
const req = (headers: Record<string, string>) => ({ headers }) as unknown as AdminReq;

test('Origin 이 null 이면 Sec-Fetch-Site: same-origin 일 때만 (Chromium 이 출처를 숨길 때)', () => {
  assert.equal(sameOrigin(req({ origin: 'null', 'sec-fetch-site': 'same-origin' }), URL_), true);
  assert.equal(sameOrigin(req({ origin: 'null', 'sec-fetch-site': 'cross-site' }), URL_), false);
  assert.equal(sameOrigin(req({ origin: 'null', 'sec-fetch-site': 'same-site' }), URL_), false);
  assert.equal(sameOrigin(req({ origin: 'null' }), URL_), false);
});

test('Origin 이 있으면 이 서버여야, 없으면 Sec-Fetch-Site 로', () => {
  assert.equal(sameOrigin(req({ origin: URL_, 'sec-fetch-site': 'same-origin' }), URL_), true);
  assert.equal(
    sameOrigin(req({ origin: 'https://evil.example', 'sec-fetch-site': 'same-origin' }), URL_),
    false,
  );
  assert.equal(sameOrigin(req({ origin: URL_, 'sec-fetch-site': 'cross-site' }), URL_), false);
  assert.equal(sameOrigin(req({}), URL_), true);
  assert.equal(sameOrigin(req({ 'sec-fetch-site': 'cross-site' }), URL_), false);
});
