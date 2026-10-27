import assert from 'node:assert/strict';
import test from 'node:test';
import { hasEncodedBody, rejectEncodedBody } from './no-encoded-body';

test('Content-Encoding: 없거나 identity 만 통과', () => {
  assert.equal(hasEncodedBody(undefined), false);
  assert.equal(hasEncodedBody(''), false);
  assert.equal(hasEncodedBody('identity'), false);
  assert.equal(hasEncodedBody(' Identity '), false);
  for (const v of ['gzip', 'GZIP', 'deflate', 'br', 'zstd', 'identity, gzip', 'x-unknown']) {
    assert.equal(hasEncodedBody(v), true, v);
  }
  assert.equal(hasEncodedBody(['identity', 'gzip']), true);
});

test('rejectEncodedBody: 압축 본문은 415 로 끝내고 next 를 부르지 않는다', () => {
  const sent: { status?: number; body?: string; headers: Record<string, unknown> } = { headers: {} };
  const res = {
    statusCode: 200,
    setHeader(k: string, v: unknown) {
      sent.headers[k] = v;
    },
    end(b: string) {
      sent.status = this.statusCode;
      sent.body = b;
    },
  };
  let nexted = 0;
  // biome-ignore lint/suspicious/noExplicitAny: 시험용 가짜 요청과 응답
  rejectEncodedBody({ headers: { 'content-encoding': 'gzip' } } as any, res as any, () => nexted++);
  assert.equal(sent.status, 415);
  assert.deepEqual(JSON.parse(sent.body ?? ''), { error: 'unsupported_content_encoding' });
  assert.equal(nexted, 0);
  // biome-ignore lint/suspicious/noExplicitAny: 시험용 가짜 요청과 응답
  rejectEncodedBody({ headers: {} } as any, res as any, () => nexted++);
  assert.equal(nexted, 1);
});
