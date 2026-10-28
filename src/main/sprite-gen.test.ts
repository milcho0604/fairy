import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rowOf, type SpriteRow, STRIP_H, STRIP_W, stripPrompt } from '../shared/sprite-strip.ts';
import { type FetchLike, IllustError, KLEIN, spaceRoot } from './hf-illust.ts';
import { checkDrawn, fixedDrawSize, LocalDrawError, MIN_DRAWN_BYTES } from './local-draw-core.ts';
import {
  drawStrip,
  drawStripLocal,
  type LocalStripDraw,
  STRIP_MIN_BYTES,
  STRIP_TIMEOUT_MS,
  stripMinBytes,
  stripSpace,
  stripTimeoutMs,
} from './sprite-gen.ts';

const ROOT = spaceRoot(KLEIN.id);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3]);
const WEBP = new Uint8Array([
  ...new TextEncoder().encode('RIFF'),
  9,
  0,
  0,
  0,
  ...new TextEncoder().encode('WEBPVP8 '),
  7,
]);
const ROW = rowOf('rest') as SpriteRow;
/** 두 줄 여덟 칸 (한 번 호출로 받는다) */
const WALK = rowOf('walk') as SpriteRow;

function server(events: string[]) {
  const urls: string[] = [];
  const bodies: string[] = [];
  const fetch: FetchLike = async (url, init = {}) => {
    urls.push(url);
    if (typeof init.body === 'string') bodies.push(init.body);
    if (!url.startsWith(ROOT)) return new Response('no', { status: 404 });
    if (url === `${ROOT}/gradio_api/upload`) return Response.json(['/tmp/gradio/up/pet.png']);
    if (url === `${ROOT}/gradio_api/call/infer` && init.method === 'POST')
      return Response.json({ event_id: 'e1' });
    if (url === `${ROOT}/gradio_api/call/infer/e1`) return new Response(events.join(''));
    if (url.startsWith(`${ROOT}/gradio_api/file=`)) return new Response(WEBP as BodyInit);
    return new Response('no', { status: 404 });
  };
  return { fetch, urls, bodies };
}

test('띠 그리기는 klein 하나만 부르고 (Kontext 로 넘어가지 않는다) 크기를 띠 크기로 정한다', async () => {
  const { fetch, urls, bodies } = server([
    'event: complete\ndata: [{"path": "/tmp/gradio/out/s.webp", "meta": {"_type": "gradio.FileData"}}, 1]\n\n',
  ]);
  const r = await drawStrip(PNG, ROW, [0, 255, 0], { fetch });
  assert.equal(r.space, KLEIN.id);
  assert.equal(r.kind, 'webp');
  assert.ok(
    urls.every((u) => u.startsWith(ROOT)),
    urls.join('\n'),
  );
  const data = JSON.parse(bodies[0] ?? '{}').data as unknown[];
  assert.equal(data[5], STRIP_W);
  assert.equal(data[6], STRIP_H);
  assert.match(String(data[0]), /exactly 4/);
  assert.match(String(data[0]), /#00FF00/);
  // 기준 그림이 갤러리 첫 장
  assert.deepEqual((data[1] as { image: { path: string } }[])[0]?.image.path, '/tmp/gradio/up/pet.png');
});

test('무료 사용량이 끝나면 quota 로 바로 실패한다 (다른 Space 를 시도하지 않는다)', async () => {
  const { fetch, urls } = server([
    'event: error\ndata: "You have exceeded your ZeroGPU runs limit. Authenticate with a Hugging Face token for more quota"\n\n',
  ]);
  await assert.rejects(
    drawStrip(PNG, ROW, [0, 255, 0], { fetch }),
    (e) => e instanceof IllustError && e.kind === 'quota',
  );
  assert.ok(urls.every((u) => u.startsWith(ROOT)));
});

test('그만두면 cancelled', async () => {
  const ac = new AbortController();
  ac.abort();
  const { fetch } = server([]);
  await assert.rejects(
    drawStrip(PNG, ROW, [0, 255, 0], { fetch, signal: ac.signal }),
    (e) => e instanceof IllustError && e.kind === 'cancelled',
  );
});

test('띠 Space 는 klein 의 /infer, 씨앗은 그때마다 바꾼다', () => {
  const s = stripSpace();
  assert.equal(s.id, 'black-forest-labs/FLUX.2-klein-4B');
  assert.equal(s.endpoint, 'infer');
  const file = { path: '/x.png', orig_name: 'pet.png', meta: { _type: 'gradio.FileData' as const } };
  const v = s.inputs(file, 'p');
  assert.equal(v[4], true);
  assert.deepEqual([v[5], v[6]], [1024, 256]);
});

test('그리는 중에 그만두면 fetch 가 signal 을 몰라도 받은 그림을 쓰지 않는다 (cancelled)', async () => {
  const ac = new AbortController();
  const fetch: FetchLike = async (url) => {
    if (url.endsWith('/upload')) return Response.json(['/tmp/gradio/up/pet.png']);
    if (url.endsWith('/call/infer')) return Response.json({ event_id: 'e1' });
    if (url.endsWith('/e1')) {
      await new Promise((r) => setTimeout(r, 60));
      return new Response('event: complete\ndata: [{"path": "/tmp/gradio/out/s.webp"}]\n\n');
    }
    return new Response(WEBP as BodyInit);
  };
  setTimeout(() => ac.abort(), 10);
  await assert.rejects(
    drawStrip(PNG, ROW, [0, 255, 0], { fetch, signal: ac.signal }),
    (e) => e instanceof IllustError && e.kind === 'cancelled',
  );
});

test('내 컴퓨터 띠: 서버와 같은 요청문과 기준 그림으로, 크기는 1024x256 으로 정하고 하한 바이트를 줄인다', async () => {
  const calls: Parameters<LocalStripDraw>[] = [];
  const draw: LocalStripDraw = async (...args) => {
    calls.push(args);
    return { bytes: PNG, kind: 'png' };
  };
  const ac = new AbortController();
  const r = await drawStripLocal(draw, PNG, ROW, [255, 0, 255], {
    signal: ac.signal,
    onProgress: () => {},
    log: () => {},
  });
  assert.equal(r.kind, 'png');
  const [photo, kind, prompt, o] = calls[0] ?? [];
  assert.equal(photo, PNG);
  assert.equal(kind, 'png');
  assert.equal(prompt, stripPrompt(ROW, [255, 0, 255]));
  assert.deepEqual(o?.size, { width: STRIP_W, height: STRIP_H, minBytes: STRIP_MIN_BYTES });
  assert.equal(o?.signal, ac.signal);
  // 띠는 넓이가 1/3 이라 하한도 그만큼 (40KB 그대로면 단색 배경 띠를 버린다)
  assert.ok(STRIP_MIN_BYTES < MIN_DRAWN_BYTES / 2 && STRIP_MIN_BYTES > 8 * 1024, String(STRIP_MIN_BYTES));
});

test('내 컴퓨터 띠: 실패는 그대로 (준비 안 됨, 그만두기)', async () => {
  for (const kind of ['notReady', 'cancelled', 'memory'] as const) {
    const draw: LocalStripDraw = async () => {
      throw new LocalDrawError(kind);
    };
    await assert.rejects(
      drawStripLocal(draw, PNG, ROW, [0, 255, 0], {
        signal: new AbortController().signal,
        onProgress: () => {},
        log: () => {},
      }),
      (e: unknown) => e instanceof LocalDrawError && e.kind === kind,
    );
  }
});

/** 크기 머리만 맞는 PNG (IHDR 가로, 세로) 를 n 바이트로 */
function pngOf(w: number, h: number, n: number): Uint8Array {
  const b = new Uint8Array(Math.max(n, 33));
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  return b;
}

test('정한 크기로 그린 띠 확인: 1024x256 그대로, 띠 하한으로 단색 판만 거른다', () => {
  assert.deepEqual(fixedDrawSize({ width: STRIP_W, height: STRIP_H, minBytes: 5 }), {
    width: STRIP_W,
    height: STRIP_H,
    minBytes: 5,
  });
  const want = { width: STRIP_W, height: STRIP_H, minBytes: STRIP_MIN_BYTES };
  // 20KB 띠: 원래 하한(40KB)이면 버렸을 것을 받는다
  assert.deepEqual(checkDrawn(pngOf(1024, 256, 20 * 1024), want), { ok: true, kind: 'png' });
  assert.equal(checkDrawn(pngOf(1024, 256, 20 * 1024), { width: 1024, height: 256 }).ok, false);
  assert.equal(checkDrawn(pngOf(1024, 256, 3 * 1024), want).ok, false);
  // 넣은 그림 비율(정사각형)로 그려 왔으면 크기가 틀린 것
  assert.equal(checkDrawn(pngOf(1024, 1024, 20 * 1024), want).ok, false);
});

test('두 줄 시트는 호출 한 번으로 1024x512 를 그리고 요청문에 여덟 칸이 다 든다', async () => {
  const { fetch, urls, bodies } = server([
    'event: complete\ndata: [{"path": "/tmp/gradio/out/s.webp", "meta": {"_type": "gradio.FileData"}}, 1]\n\n',
  ]);
  await drawStrip(PNG, WALK, [0, 255, 0], { fetch });
  // 그림을 부르는 요청은 한 번 (칸이 8개여도 호출 수는 그대로)
  assert.equal(urls.filter((u) => u.endsWith('/call/infer')).length, 1);
  const data = JSON.parse(bodies[0] ?? '{}').data as unknown[];
  assert.deepEqual([data[5], data[6]], [STRIP_W, STRIP_H * 2]);
  assert.match(String(data[0]), /2 horizontal rows/);
  for (const f of WALK.frames) assert.ok(String(data[0]).includes(f));
  assert.ok(
    stripSpace(STRIP_W, STRIP_H * 2).inputs(
      { path: '/x', orig_name: 'p', meta: { _type: 'gradio.FileData' } },
      'p',
    )[6] ===
      STRIP_H * 2,
  );
});

test('두 줄 시트는 한 줄 띠보다 넓이만큼 하한 바이트가 크고 기다리는 시간이 길다', () => {
  assert.equal(stripMinBytes(ROW), STRIP_MIN_BYTES);
  assert.equal(stripMinBytes(WALK), STRIP_MIN_BYTES * 2);
  assert.equal(stripTimeoutMs(ROW), STRIP_TIMEOUT_MS);
  assert.ok(stripTimeoutMs(WALK) > STRIP_TIMEOUT_MS);
});

test('내 컴퓨터 두 줄 시트: 크기는 1024x512 (klein 규칙 안), 하한은 두 배', async () => {
  const calls: Parameters<LocalStripDraw>[] = [];
  const draw: LocalStripDraw = async (...args) => {
    calls.push(args);
    return { bytes: PNG, kind: 'png' };
  };
  await drawStripLocal(draw, PNG, WALK, [0, 255, 0], {
    signal: new AbortController().signal,
    onProgress: () => {},
    log: () => {},
  });
  const [, , prompt, o] = calls[0] ?? [];
  assert.equal(prompt, stripPrompt(WALK, [0, 255, 0]));
  assert.deepEqual(o?.size, { width: STRIP_W, height: STRIP_H * 2, minBytes: STRIP_MIN_BYTES * 2 });
  assert.deepEqual(fixedDrawSize(o?.size ?? { width: 0, height: 0 }), {
    width: STRIP_W,
    height: STRIP_H * 2,
    minBytes: STRIP_MIN_BYTES * 2,
  });
});
