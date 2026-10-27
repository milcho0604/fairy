import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { BrotliDecompress, brotliCompressSync, gzipSync } from 'node:zlib';
import { createMainFetch, type FetchFn, guardGlobalFetch } from './net-fetch-core.ts';

const nodeFetch: FetchFn = globalThis.fetch.bind(globalThis);

async function serve(
  handler: Parameters<typeof createServer>[1],
): Promise<{ url: string; close: () => void; srv: Server }> {
  const srv = createServer(handler);
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}/`, close: () => srv.close(), srv };
}

/** Node zlib 의 Brotli 풀개가 몇 번 일했는지 센다 (_transform 이 실제 풀기) */
function spyBrotli(): { count: () => number; restore: () => void } {
  const proto = BrotliDecompress.prototype as unknown as { _transform: (...a: unknown[]) => unknown };
  const orig = proto._transform;
  let n = 0;
  proto._transform = function (this: unknown, ...a: unknown[]) {
    n++;
    return orig.apply(this, a);
  };
  return {
    count: () => n,
    restore: () => {
      proto._transform = orig;
    },
  };
}

test('공용 fetch 는 ready 를 기다린 뒤에 보낸다', async () => {
  const log: string[] = [];
  let open!: () => void;
  const gate = new Promise<void>((r) => (open = r));
  const f = createMainFetch({
    ready: async () => {
      log.push('ready 기다림');
      await gate;
      log.push('ready 됨');
    },
    fetch: async () => {
      log.push('보냄');
      return new Response('ok');
    },
  });
  const p = f('https://example.com/');
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(log, ['ready 기다림']);
  open();
  assert.equal(await (await p).text(), 'ok');
  assert.deepEqual(log, ['ready 기다림', 'ready 됨', '보냄']);
});

test('공용 fetch 는 주소, 헤더, 신호를 그대로 넘긴다', async () => {
  let seen: { input: unknown; init?: RequestInit } | undefined;
  const f = createMainFetch({
    ready: async () => {},
    fetch: async (input, init) => {
      seen = { input, init };
      return new Response(null, { status: 204 });
    },
  });
  const ac = new AbortController();
  const init = { method: 'POST', headers: { 'x-fairy-version': '1.2.3' }, signal: ac.signal };
  const res = await f('https://example.com/a', init);
  assert.equal(res.status, 204);
  assert.equal(seen?.input, 'https://example.com/a');
  assert.equal(seen?.init, init);
});

test('전역 fetch 막이: http(s) 는 공용 fetch 로만 가고 원래(Node) fetch 는 안 불린다', async () => {
  const calls: string[] = [];
  const host = {
    fetch: (async () => {
      calls.push('node');
      return new Response('node');
    }) as FetchFn,
  };
  const restore = guardGlobalFetch(host, async (input) => {
    calls.push(`main:${typeof input === 'string' ? input : input instanceof URL ? input.href : input.url}`);
    return new Response('main');
  });
  assert.equal(await (await host.fetch('http://a.test/x')).text(), 'main');
  assert.equal(await (await host.fetch('https://b.test/y')).text(), 'main');
  assert.equal(await (await host.fetch(new URL('https://c.test/z'))).text(), 'main');
  assert.equal(await (await host.fetch(new Request('https://d.test/w'))).text(), 'main');
  assert.deepEqual(calls, [
    'main:http://a.test/x',
    'main:https://b.test/y',
    'main:https://c.test/z',
    'main:https://d.test/w',
  ]);
  restore();
  assert.equal(await (await host.fetch('https://e.test/')).text(), 'node');
});

test('전역 fetch 막이: 네트워크가 아닌 data: 만 원래 fetch 로, 나머지(file:, ftp:, 깨진 주소)는 거절', async () => {
  const calls: string[] = [];
  const host = {
    fetch: (async (i: string | URL | Request) => {
      calls.push(String(i));
      return new Response('node');
    }) as FetchFn,
  };
  guardGlobalFetch(host, async () => new Response('main'));
  assert.equal(await (await host.fetch('data:text/plain,hi')).text(), 'node');
  for (const bad of ['file:///etc/hosts', 'ftp://a.test/x', 'not a url'])
    await assert.rejects(host.fetch(bad), /fetch failed/);
  assert.deepEqual(calls, ['data:text/plain,hi']);
});

test('근거: Node 의 fetch(undici)는 br 를 fetch() 가 돌아오기 전에 이미 Node zlib 에 먹인다 (accept-encoding 을 줄여도, 본문을 읽지 않아도)', async () => {
  const s = await serve((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain', 'content-encoding': 'br' });
    res.end(Buffer.from('not brotli at all, header lies'));
  });
  const spy = spyBrotli();
  try {
    const res = await nodeFetch(s.url, { headers: { 'accept-encoding': 'gzip, deflate' } });
    assert.equal(res.headers.get('content-encoding'), 'br');
    // 헤더를 본 시점에 이미 풀개가 일했다. 그래서 래퍼에서 br 를 보고 거절하는 방식은 안전하지 않다
    assert.ok(spy.count() >= 1, `br 풀개가 일하지 않았다: ${spy.count()}`);
    await res.arrayBuffer().catch(() => {});
  } finally {
    spy.restore();
    s.close();
  }
});

test('막이를 거친 요청은 br 를 보내는 서버를 만나도 Node 의 Brotli 풀개가 한 번도 안 일한다', async () => {
  const s = await serve((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain', 'content-encoding': 'br' });
    res.end(Buffer.from('not brotli at all, header lies'));
  });
  const spy = spyBrotli();
  // 크로미움 자리: br 를 Node 로 풀지 않고 거절하는 가짜 전송 (진짜 net.fetch 는 scripts/dev/net-brotli.mjs 가 앱 안에서 잰다)
  const host = { fetch: nodeFetch };
  guardGlobalFetch(host, async () => {
    throw new TypeError('net::ERR_CONTENT_DECODING_FAILED');
  });
  try {
    await assert.rejects(host.fetch(s.url), /ERR_CONTENT_DECODING_FAILED/);
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(spy.count(), 0);
  } finally {
    spy.restore();
    s.close();
  }
});

test('보통 응답(gzip, 압축 없음)은 몸통, 상태, 헤더가 그대로 온다', async () => {
  const body = 'hello 안녕 '.repeat(500);
  const s = await serve((req, res) => {
    if (req.url === '/gz') {
      res.writeHead(200, {
        'content-encoding': 'gzip',
        'content-type': 'text/plain; charset=utf-8',
        'x-t': '1',
      });
      res.end(gzipSync(Buffer.from(body)));
    } else if (req.url === '/plain') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(body);
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  const f = createMainFetch({ ready: async () => {}, fetch: nodeFetch });
  try {
    const gz = await f(`${s.url}gz`, { headers: { 'accept-encoding': 'gzip' } });
    assert.equal(gz.status, 200);
    assert.equal(gz.headers.get('x-t'), '1');
    assert.equal(await gz.text(), body);
    assert.equal(await (await f(`${s.url}plain`)).text(), body);
    assert.equal((await f(`${s.url}none`)).status, 404);
  } finally {
    s.close();
  }
});

test('시험 자체 점검: br 로 정말 압축한 응답은 Node 로는 풀리고, 이 시험의 spy 가 그걸 센다', async () => {
  const s = await serve((_req, res) => {
    res.writeHead(200, { 'content-encoding': 'br' });
    res.end(brotliCompressSync(Buffer.from('ok')));
  });
  const spy = spyBrotli();
  try {
    const res = await nodeFetch(s.url);
    assert.equal(await res.text(), 'ok');
    assert.ok(spy.count() >= 1);
  } finally {
    spy.restore();
    s.close();
  }
});
