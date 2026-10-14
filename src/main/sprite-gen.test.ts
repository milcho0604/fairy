import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rowOf, type SpriteRow, STRIP_H, STRIP_W } from '../shared/sprite-strip.ts';
import { type FetchLike, IllustError, KLEIN, spaceRoot } from './hf-illust.ts';
import { drawStrip, stripSpace } from './sprite-gen.ts';

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
const ROW = rowOf('walk') as SpriteRow;

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
