import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CATALOG_MAX_BYTES, fetchCatalogJson } from './catalog-fetch.ts';

const body = (text: string, headers: Record<string, string> = {}) =>
  new Response(text, { status: 200, headers });

test('모델 목록 받기: 상한보다 크면 버리고, 답이 멈추면 시간 상한에서 그만둔다 (버그잡이 4)', async () => {
  const ok = await fetchCatalogJson(async () => body('{"a":1}'), 'https://x/models.json');
  assert.deepEqual(ok, { ok: true, json: { a: 1 } });
  const big = await fetchCatalogJson(async () => body('x'.repeat(CATALOG_MAX_BYTES + 1)), 'https://x');
  assert.deepEqual(big, { ok: false, why: 'big' });
  const bad = await fetchCatalogJson(async () => body('not json'), 'https://x');
  assert.deepEqual(bad, { ok: false, why: 'json' });
  const status = await fetchCatalogJson(async () => new Response('', { status: 503 }), 'https://x');
  assert.deepEqual(status, { ok: false, why: 'status', status: 503 });
  // 머리말만 오고 본문이 끝나지 않는 응답: 시간 상한에서 끊는다
  const t0 = Date.now();
  const hung = await fetchCatalogJson(
    async (_url, init) =>
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode('{"a":'));
            init.signal?.addEventListener('abort', () => c.error(new DOMException('aborted', 'AbortError')));
          },
        }),
      ),
    'https://x',
    { timeoutMs: 200 },
  );
  assert.deepEqual(hung, { ok: false, why: 'failed' });
  assert.ok(Date.now() - t0 < 3000);
});
