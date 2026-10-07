import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readCapped } from './read-capped.ts';

function streamOf(parts: string[], onPull?: () => void): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream({
    pull(c) {
      onPull?.();
      const p = parts[i++];
      if (p === undefined) c.close();
      else c.enqueue(new TextEncoder().encode(p));
    },
  });
}

test('상한 안이면 글 그대로 (한글 한 글자가 두 조각으로 나뉘어도)', async () => {
  const bytes = new TextEncoder().encode('BEGIN:VCALENDAR 한글');
  const cut = bytes.length - 2; // '글'의 가운데
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      if (i === 0) c.enqueue(bytes.slice(0, cut));
      else if (i === 1) c.enqueue(bytes.slice(cut));
      else c.close();
      i++;
    },
  });
  assert.equal(await readCapped(new Response(body), 1000), 'BEGIN:VCALENDAR 한글');
});

test('상한을 넘으면 끝까지 받지 않고 멈춘다 (버그잡이 7차)', async () => {
  let pulls = 0;
  const parts = Array.from({ length: 100 }, () => 'x'.repeat(100));
  const res = new Response(streamOf(parts, () => pulls++));
  assert.equal(await readCapped(res, 450), undefined);
  assert.ok(pulls < 10, `조각을 ${pulls}번 읽었다`);
});

test('content-length 가 상한보다 크면 읽지 않는다', async () => {
  const res = new Response('작은 본문', { headers: { 'content-length': '999999' } });
  assert.equal(await readCapped(res, 100), undefined);
});
