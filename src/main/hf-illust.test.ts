import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  classify,
  type FetchLike,
  IllustError,
  type IllustSpace,
  illustrate,
  imageKind,
  parseSse,
  resultUrl,
  SPACES,
  spaceRoot,
  worst,
} from './hf-illust.ts';

const KONTEXT = 'https://black-forest-labs-flux-1-kontext-dev.hf.space';
const QWEN = 'https://qwen-qwen-image-edit.hf.space';
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5]);
const WEBP = new Uint8Array([
  ...new TextEncoder().encode('RIFF'),
  9,
  0,
  0,
  0,
  ...new TextEncoder().encode('WEBPVP8 '),
  7,
]);

test('Space 주소와 순서: Kontext 가 먼저, 그리는 길은 /infer 하나', () => {
  assert.equal(spaceRoot('black-forest-labs/FLUX.1-Kontext-Dev'), KONTEXT);
  assert.equal(spaceRoot('Qwen/Qwen-Image-Edit'), QWEN);
  assert.equal(SPACES[0]?.id, 'black-forest-labs/FLUX.1-Kontext-Dev');
  for (const s of SPACES) assert.equal(s.endpoint, 'infer');
  const file = { path: '/tmp/x.jpg', orig_name: 'pet.jpg', meta: { _type: 'gradio.FileData' as const } };
  // input_image, prompt, seed, randomize_seed, guidance_scale, steps
  assert.deepEqual(SPACES[0]?.inputs(file, 'p'), [file, 'p', 0, true, 2.5, 28]);
  assert.deepEqual(SPACES[1]?.inputs(file, 'p'), [file, 'p', 0, true, 4, 50, false]);
});

test('오류 종류: 실제 쿼터 글, 크기 제한, 토큰, 바쁨, 그 밖', () => {
  assert.equal(
    classify(
      'You have exceeded your ZeroGPU runs limit. Authenticate with a Hugging Face token for more quota - https://huggingface.co/settings/tokens',
    ),
    'quota',
  );
  assert.equal(classify('You have exceeded your GPU quota (60s requested vs. 0s left).'), 'quota');
  assert.equal(classify('The requested GPU duration (240s) is larger than the maximum allowed'), 'limit');
  assert.equal(classify('', 429), 'busy');
  assert.equal(classify('nope', 401, true), 'auth');
  // 토큰을 안 보냈으면 401, 403 은 토큰 탓이 아니다
  assert.equal(classify('nope', 403), 'busy');
  assert.equal(classify('Invalid token'), 'runtime');
  assert.equal(classify('', 503), 'busy');
  assert.equal(classify('This application is currently busy. Queue is full'), 'busy');
  assert.equal(classify('RuntimeError: CUDA error'), 'runtime');
  // 첫 Space 가 잠깐 막히고 둘째가 크기 제한이면 "토큰이 있어야 해" 가 아니라 잠깐 안 됨
  assert.equal(worst(['runtime', 'limit', 'network']), 'busy');
  assert.equal(worst(['network', 'limit']), 'limit');
  assert.equal(worst(['network', 'network']), 'network');
  assert.equal(worst(['runtime', 'network']), 'busy');
  assert.equal(worst([]), 'busy');
});

test('결과 파일 주소: 경로 글, {url, path}, dict, 갤러리. 다른 곳 주소는 믿지 않는다', () => {
  const R = KONTEXT;
  assert.equal(
    resultUrl(['/tmp/gradio/a/image.webp', 123], R),
    `${R}/gradio_api/file=/tmp/gradio/a/image.webp`,
  );
  assert.equal(
    resultUrl([{ path: '/tmp/a.webp', url: `${R}/gradio_api/file=/tmp/a.webp` }, 1], R),
    `${R}/gradio_api/file=/tmp/a.webp`,
  );
  // 다른 곳을 가리키는 url 은 버리고 path 로
  assert.equal(
    resultUrl([{ path: '/tmp/a.webp', url: 'https://evil.example/a.webp' }], R),
    `${R}/gradio_api/file=/tmp/a.webp`,
  );
  assert.equal(resultUrl([{ url: 'https://evil.example/a.webp' }], R), undefined);
  assert.equal(resultUrl(['https://evil.example/a.webp'], R), undefined);
  assert.equal(resultUrl([{ image: { path: '/tmp/b.png' } }], R), `${R}/gradio_api/file=/tmp/b.png`);
  assert.equal(
    resultUrl([[{ image: { path: '/tmp/c.png' } }, { path: '/tmp/d.png' }]], R),
    `${R}/gradio_api/file=/tmp/c.png`,
  );
  assert.equal(resultUrl(['/tmp/e.png'], R, ''), `${R}/file=/tmp/e.png`);
  assert.equal(resultUrl([null, 1], R), undefined);
  assert.equal(resultUrl([42], R), undefined);
});

test('SSE 나누기: 빈 줄로 사건, 줄바꿈 \\r\\n, 덜 온 끝은 남긴다', () => {
  const { events, rest } = parseSse(
    'event: generating\r\ndata: null\r\n\r\nevent: complete\ndata: ["/tmp/a.webp", 5]\n\nevent: heart',
  );
  assert.deepEqual(events, [
    { event: 'generating', data: 'null' },
    { event: 'complete', data: '["/tmp/a.webp", 5]' },
  ]);
  assert.equal(rest, 'event: heart');
});

test('그림 형식: PNG, JPEG, WebP 머리말', () => {
  assert.equal(imageKind(WEBP), 'webp');
  assert.equal(imageKind(JPEG), 'jpeg');
  assert.equal(imageKind(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0, 0])), 'png');
  assert.equal(imageKind(new TextEncoder().encode('<html>nope</html>')), undefined);
});

// ---- 가짜 Gradio 서버 ----

interface Seen {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: Uint8Array | string;
  redirect?: RequestRedirect;
}

/** SSE 몸통을 조각으로 흘린다. hang 이면 닫지 않는다 */
function sse(chunks: string[], hang = false): Response {
  const enc = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(c) {
        for (const ch of chunks) c.enqueue(enc.encode(ch));
        if (!hang) c.close();
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  );
}

/**
 * 가짜 서버. events 는 Space 주소마다 SSE 조각, image 는 받을 그림. legacy 면 /gradio_api 가 404
 */
function fakeServer(opts: {
  events?: Record<string, string[] | 'hang' | 'throw'>;
  image?: Uint8Array;
  legacy?: string[];
}) {
  const seen: Seen[] = [];
  const fetch: FetchLike = async (url, init = {}) => {
    const headers = Object.fromEntries(
      Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]),
    );
    seen.push({
      method: init.method ?? 'GET',
      url,
      headers,
      body: init.body as Uint8Array | string | undefined,
      redirect: init.redirect,
    });
    const root = url.slice(0, url.indexOf('.hf.space') + '.hf.space'.length);
    const ev = opts.events?.[root];
    if (ev === 'throw') throw new TypeError('fetch failed');
    const legacy = opts.legacy?.includes(root);
    const prefix = legacy ? '' : '/gradio_api';
    if (legacy && url.includes('/gradio_api/')) return new Response('Not Found', { status: 404 });
    if (url === `${root}${prefix}/upload`) return Response.json(['/tmp/gradio/up/pet.jpg']);
    if (url === `${root}${prefix}/call/infer` && init.method === 'POST')
      return Response.json({ event_id: 'ev1' });
    if (url === `${root}${prefix}/call/infer/ev1`) return ev === 'hang' ? sse([], true) : sse(ev ?? []);
    if (url.startsWith(`${root}${prefix}/file=`)) return new Response((opts.image ?? WEBP) as BodyInit);
    return new Response('Not Found', { status: 404 });
  };
  return { fetch, seen };
}

const complete = (path = '/tmp/gradio/out/image.webp') => [
  'event: generating\ndata: null\n\n',
  // 사건 하나가 두 조각에 걸쳐 온다
  'event: complete\ndata: [{"path": "',
  `${path}", "url": "https://evil.example/x.webp", "meta": {"_type": "gradio.FileData"}}, 42]\n\n`,
];

test('그리기: 올리기, 부르기, 기다리기, 받기. 토큰은 그 Space 에만, /infer 만 부른다', async () => {
  const { fetch, seen } = fakeServer({ events: { [KONTEXT]: complete() } });
  const token = `hf_${'x'.repeat(30)}`;
  const r = await illustrate(JPEG, 'image/jpeg', 'make it cute', { fetch, token });
  assert.equal(r.space, 'black-forest-labs/FLUX.1-Kontext-Dev');
  assert.equal(r.kind, 'webp');
  assert.deepEqual([...r.bytes], [...WEBP]);
  assert.deepEqual(
    seen.map((s) => `${s.method} ${s.url}`),
    [
      `POST ${KONTEXT}/gradio_api/upload`,
      `POST ${KONTEXT}/gradio_api/call/infer`,
      `GET ${KONTEXT}/gradio_api/call/infer/ev1`,
      `GET ${KONTEXT}/gradio_api/file=/tmp/gradio/out/image.webp`,
    ],
  );
  for (const s of seen) {
    assert.ok(s.url.startsWith(`${KONTEXT}/`));
    assert.equal(s.headers.authorization, `Bearer ${token}`);
    assert.ok(!s.url.includes('lambda'));
    // 다른 주소로 넘겨주기를 따라가지 않는다
    assert.equal(s.redirect, 'error');
  }
  // multipart 에 사진 바이트와 파일 이름
  const up = seen[0];
  assert.match(up?.headers['content-type'] ?? '', /^multipart\/form-data; boundary=/);
  const text = Buffer.from(up?.body as Uint8Array).toString('latin1');
  assert.match(text, /name="files"; filename="pet.jpg"\r\nContent-Type: image\/jpeg/);
  assert.ok(text.includes(Buffer.from(JPEG).toString('latin1')));
  const call = JSON.parse(String(seen[1]?.body)) as { data: unknown[] };
  assert.deepEqual(call.data, [
    { path: '/tmp/gradio/up/pet.jpg', orig_name: 'pet.jpg', meta: { _type: 'gradio.FileData' } },
    'make it cute',
    0,
    true,
    2.5,
    28,
  ]);
});

test('토큰이 없으면 Authorization 머리를 보내지 않는다', async () => {
  const { fetch, seen } = fakeServer({ events: { [KONTEXT]: complete() } });
  await illustrate(JPEG, 'image/jpeg', 'p', { fetch });
  for (const s of seen) assert.equal(s.headers.authorization, undefined);
});

test('옛 Gradio: /gradio_api 가 404 면 바로 아래 길로', async () => {
  const { fetch, seen } = fakeServer({ events: { [KONTEXT]: complete() }, legacy: [KONTEXT] });
  const r = await illustrate(JPEG, 'image/jpeg', 'p', { fetch });
  assert.equal(r.kind, 'webp');
  assert.ok(seen.some((s) => s.url === `${KONTEXT}/call/infer/ev1`));
  assert.equal(seen.at(-1)?.url, `${KONTEXT}/file=/tmp/gradio/out/image.webp`);
});

test('그 Space 오류(runtime)면 다음 Space 로', async () => {
  const { fetch, seen } = fakeServer({
    events: {
      [KONTEXT]: ['event: error\ndata: "RuntimeError: boom"\n\n'],
      [QWEN]: complete('/tmp/q.webp'),
    },
  });
  const logs: unknown[][] = [];
  const r = await illustrate(JPEG, 'image/jpeg', 'p', { fetch, log: (...a) => logs.push(a) });
  assert.equal(r.space, 'Qwen/Qwen-Image-Edit');
  assert.ok(seen.some((s) => s.url.startsWith(QWEN)));
  assert.deepEqual(logs[0]?.slice(0, 3), ['illust', 'black-forest-labs/FLUX.1-Kontext-Dev', 'runtime']);
});

test('이유 없는 거절(data: null)은 refused: 다음 Space 도 거절하면 refused 로 보인다', async () => {
  // 2026-10-09 실제: 무료 세 번 뒤 넷째 요청이 두 Space 모두 data: null 로 거절됐다
  const { fetch, seen } = fakeServer({
    events: { [KONTEXT]: ['event: error\ndata: null\n\n'], [QWEN]: ['event: error\ndata: null\n\n'] },
  });
  await assert.rejects(
    illustrate(JPEG, 'image/jpeg', 'p', { fetch }),
    (e: unknown) => e instanceof IllustError && e.kind === 'refused',
  );
  assert.ok(seen.some((s) => s.url.startsWith(QWEN)));
  assert.equal(worst(['refused', 'limit']), 'refused');
  assert.equal(worst(['refused', 'busy']), 'refused');
});

test('무료 사용량 끝이면 다음 Space 를 부르지 않고 quota', async () => {
  const { fetch, seen } = fakeServer({
    events: {
      [KONTEXT]: [
        'event: error\ndata: "You have exceeded your ZeroGPU runs limit. Authenticate with a Hugging Face token for more quota"\n\n',
      ],
      [QWEN]: complete(),
    },
  });
  await assert.rejects(
    illustrate(JPEG, 'image/jpeg', 'p', { fetch }),
    (e: unknown) => e instanceof IllustError && e.kind === 'quota',
  );
  assert.ok(!seen.some((s) => s.url.startsWith(QWEN)));
});

test('받은 그림이 보낸 사진 그대로면 성공으로 세지 않는다 (same)', async () => {
  const spaces: IllustSpace[] = [SPACES[0] as IllustSpace];
  const { fetch } = fakeServer({ events: { [KONTEXT]: complete() }, image: JPEG });
  await assert.rejects(
    illustrate(JPEG, 'image/jpeg', 'p', { fetch, spaces }),
    (e: unknown) => e instanceof IllustError && e.kind === 'same',
  );
});

test('결과가 그림이 아니면 bad, 끝까지 complete 가 없으면 다음으로 넘어가고 busy', async () => {
  const one: IllustSpace[] = [SPACES[0] as IllustSpace];
  const html = fakeServer({ events: { [KONTEXT]: complete() }, image: new TextEncoder().encode('<html>') });
  await assert.rejects(
    illustrate(JPEG, 'image/jpeg', 'p', { fetch: html.fetch, spaces: one }),
    (e: unknown) => e instanceof IllustError && e.kind === 'bad',
  );
  const ended = fakeServer({ events: { [KONTEXT]: ['event: heartbeat\ndata: null\n\n'], [QWEN]: [] } });
  await assert.rejects(
    illustrate(JPEG, 'image/jpeg', 'p', { fetch: ended.fetch }),
    (e: unknown) => e instanceof IllustError && e.kind === 'busy',
  );
});

test('연결이 안 되면 network', async () => {
  const { fetch } = fakeServer({ events: { [KONTEXT]: 'throw', [QWEN]: 'throw' } });
  await assert.rejects(
    illustrate(JPEG, 'image/jpeg', 'p', { fetch }),
    (e: unknown) => e instanceof IllustError && e.kind === 'network',
  );
});

test('너무 오래 걸리면 timeout, 그만두면 cancelled (기다리던 SSE 도 멈춘다)', async () => {
  const hang = fakeServer({ events: { [KONTEXT]: 'hang', [QWEN]: 'hang' } });
  const t0 = Date.now();
  await assert.rejects(
    illustrate(JPEG, 'image/jpeg', 'p', { fetch: hang.fetch, timeoutMs: 60 }),
    (e: unknown) => e instanceof IllustError && e.kind === 'timeout',
  );
  assert.ok(Date.now() - t0 < 2000);
  // 첫 Space 에서 멈추면 다음 Space 로 넘어가지 않는다
  assert.ok(!hang.seen.some((s) => s.url.startsWith(QWEN)));

  const ac = new AbortController();
  const again = fakeServer({ events: { [KONTEXT]: 'hang' } });
  const p = illustrate(JPEG, 'image/jpeg', 'p', { fetch: again.fetch, signal: ac.signal });
  setTimeout(() => ac.abort(), 20);
  await assert.rejects(p, (e: unknown) => e instanceof IllustError && e.kind === 'cancelled');

  const pre = new AbortController();
  pre.abort();
  await assert.rejects(
    illustrate(JPEG, 'image/jpeg', 'p', { fetch: again.fetch, signal: pre.signal }),
    (e: unknown) => e instanceof IllustError && e.kind === 'cancelled',
  );
});
