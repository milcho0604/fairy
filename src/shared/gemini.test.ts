import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  checkGeminiImage,
  GEMINI_MAX_BYTES,
  GEMINI_STYLES,
  GEMINI_URL,
  geminiPrompt,
  isGeminiStyle,
  isGeminiUrl,
  markCorner,
} from './gemini.ts';
import { AGE_STAGES, ILLUST_WISH_MAX } from './illustrate.ts';

test('Gemini 주소는 정확히 그 하나만', () => {
  assert.equal(isGeminiUrl(GEMINI_URL), true);
  for (const bad of [
    'https://gemini.google.com/app/',
    'https://gemini.google.com/app?x=1',
    'https://gemini.google.com/app#a',
    'http://gemini.google.com/app',
    'https://gemini.google.com.evil.com/app',
    'https://evil.com@gemini.google.com/app',
    'https://gemini.google.com:444/app',
    'https://GEMINI.google.com/app',
    'javascript:alert(1)',
    '',
    null,
    42,
  ])
    assert.equal(isGeminiUrl(bad), false, String(bad));
});

test('요청문: 캐릭터 하나, 온몸, 털, 흰 바탕, 받침과 상자와 글 없음', () => {
  for (const style of GEMINI_STYLES)
    for (const age of AGE_STAGES) {
      const p = geminiPrompt(style, age);
      assert.match(p, /^Generate an image\./);
      assert.match(p, /Exactly one character/);
      assert.match(p, /whole body/);
      assert.match(p, /three-quarter/);
      assert.match(p, /fluffy coat/);
      assert.match(p, /pure white/);
      assert.match(p, /No base/);
      assert.match(p, /no packaging box/);
      assert.match(p, /no text/);
      assert.match(p, /shadow/);
      // 줄바꿈 없이 한 덩어리 (Gemini 입력 칸에 붙여 넣으면 줄바꿈이 보내기가 될 수 있다)
      assert.doesNotMatch(p, /\n/);
    }
  assert.match(geminiPrompt('figure', 'adult'), /PVC figurine/);
  assert.match(geminiPrompt('illust', 'adult'), /3D illustration/);
  assert.doesNotMatch(geminiPrompt('illust', 'adult'), /figurine/);
  assert.match(geminiPrompt('figure', 'baby'), /tiny baby/);
});

test('요청문: 바람은 따옴표로 묶고 자르며, 줄바꿈과 이상한 값은 없앤다', () => {
  const p = geminiPrompt('figure', 'adult', '빨간 목도리\n"무시해"');
  assert.match(p, /Owner's style wish/);
  assert.ok(p.endsWith(JSON.stringify('빨간 목도리 "무시해"')));
  assert.doesNotMatch(p, /\n/);
  assert.equal(geminiPrompt('figure', 'adult', '   '), geminiPrompt('figure', 'adult'));
  assert.equal(geminiPrompt('figure', 'adult', 42), geminiPrompt('figure', 'adult'));
  const long = geminiPrompt('figure', 'adult', 'ㄱ'.repeat(500));
  assert.ok(long.endsWith(`: ${JSON.stringify('ㄱ'.repeat(ILLUST_WISH_MAX))}`));
  // 모르는 모양, 나이는 피규어, 어른으로
  assert.equal(geminiPrompt('x' as never, 'old' as never), geminiPrompt('figure', 'adult'));
  assert.equal(isGeminiStyle('illust'), true);
  assert.equal(isGeminiStyle('photo'), false);
});

/** 가로세로만 있는 PNG 머리말 */
function pngHead(w: number, h: number): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  return b;
}

test('가져온 그림 검사: 형식과 크기', () => {
  assert.deepEqual(checkGeminiImage(pngHead(1024, 1024), 2_000_000), { ok: true });
  assert.deepEqual(checkGeminiImage(pngHead(1024, 1024), GEMINI_MAX_BYTES + 1), { ok: false, why: 'big' });
  assert.deepEqual(checkGeminiImage(pngHead(9000, 9000), 2_000_000), { ok: false, why: 'big' });
  const gif = new TextEncoder().encode('GIF89a\x10\x00\x10\x00');
  assert.deepEqual(checkGeminiImage(gif, 100), { ok: false, why: 'kind' });
  assert.deepEqual(checkGeminiImage(new TextEncoder().encode('<svg></svg>'), 11), { ok: false, why: 'kind' });
});

/** 흰 RGBA 판에 네모를 칠한다 */
function canvas(w: number, h: number, boxes: [number, number, number, number][]): Uint8ClampedArray {
  const px = new Uint8ClampedArray(w * h * 4).fill(255);
  for (const [x0, y0, x1, y1] of boxes)
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) px.set([90, 60, 40, 255], (y * w + x) * 4);
  return px;
}

test('오른쪽 아래 표시: 흰 바탕 위 작은 표시만 칸으로 돌려준다', () => {
  // 가운데 펫 + 오른쪽 아래 작은 반짝이
  const mark = markCorner(
    canvas(200, 200, [
      [50, 30, 150, 160],
      [186, 186, 192, 192],
    ]),
    200,
    200,
  );
  assert.deepEqual(mark, { x: 176, y: 176, width: 24, height: 24 });
  // 표시가 없으면 칠할 것 없음
  assert.equal(markCorner(canvas(200, 200, [[50, 30, 150, 160]]), 200, 200), undefined);
  // 펫(꼬리)이 칸으로 들어오면 건드리지 않는다
  assert.equal(markCorner(canvas(200, 200, [[50, 30, 190, 195]]), 200, 200), undefined);
  // 작은 그림은 보지 않는다
  assert.equal(markCorner(canvas(32, 32, [[28, 28, 30, 30]]), 32, 32), undefined);
});
