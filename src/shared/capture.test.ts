import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  aiTempImageName,
  cleanSendImages,
  dragRect,
  fitWithin,
  IMAGE_MAX_BYTES,
  isAiTempImage,
  isClick,
  needsJpeg,
  SEND_IMAGES_MAX,
  toPixels,
} from './capture.ts';

const screen = { width: 1512, height: 982 };

test('거꾸로 끌어도 같은 사각형', () => {
  assert.deepEqual(dragRect({ x: 300, y: 200 }, { x: 100, y: 50 }, screen), {
    x: 100,
    y: 50,
    width: 200,
    height: 150,
  });
});

test('모니터 밖으로 끌면 모니터 경계에서 자른다', () => {
  assert.deepEqual(dragRect({ x: 1400, y: 900 }, { x: 1700, y: 1200 }, screen), {
    x: 1400,
    y: 900,
    width: 112,
    height: 82,
  });
  assert.deepEqual(dragRect({ x: 50, y: 50 }, { x: -300, y: -10 }, screen), {
    x: 0,
    y: 0,
    width: 50,
    height: 50,
  });
});

test('조금만 움직였으면 클릭', () => {
  assert.equal(isClick({ x: 0, y: 0, width: 7, height: 300 }), true);
  assert.equal(isClick({ x: 0, y: 0, width: 8, height: 8 }), false);
});

test('배율 2 화면은 픽셀이 두 배', () => {
  const px = toPixels({ x: 100, y: 50, width: 200, height: 150 }, screen, { width: 3024, height: 1964 });
  assert.deepEqual(px, { x: 200, y: 100, width: 400, height: 300 });
});

test('캡처 그림 밖으로는 안 나간다', () => {
  const px = toPixels({ x: 1500, y: 970, width: 12, height: 12 }, screen, { width: 3024, height: 1964 });
  assert.deepEqual(px, { x: 3000, y: 1940, width: 24, height: 24 });
  assert.ok(px.x + px.width <= 3024 && px.y + px.height <= 1964);
});

test('긴 변 기준으로 줄인다', () => {
  assert.deepEqual(fitWithin({ width: 4000, height: 1000 }, 2000), { width: 2000, height: 500 });
  assert.equal(fitWithin({ width: 800, height: 600 }, 2000), undefined);
});

test('AI 에 보낼 그림: 3.5MB 를 넘는 PNG 만 JPEG 로 (채팅 붙이기와 같이 보기가 같은 규칙)', () => {
  assert.equal(IMAGE_MAX_BYTES, 3_500_000);
  assert.equal(needsJpeg(IMAGE_MAX_BYTES), false);
  assert.equal(needsJpeg(IMAGE_MAX_BYTES + 1), true);
  assert.equal(needsJpeg(200_000), false);
});

test('채팅 그림 검사: 허용 형식, 개수, base64 만 통과', () => {
  const ok = {
    full: { mediaType: 'image/png', data: 'iVBORw0KGgo=' },
    thumb: { thumb: 'data:image/jpeg;base64,AA==' },
  };
  assert.deepEqual(cleanSendImages([ok]), [ok]);
  assert.deepEqual(cleanSendImages(undefined), []);
  assert.equal(cleanSendImages([{ ...ok, full: { mediaType: 'image/..\\..\\x', data: 'AA==' } }]), undefined);
  assert.equal(cleanSendImages([{ ...ok, full: { mediaType: 'image/png', data: '../etc' } }]), undefined);
  assert.equal(cleanSendImages([{ ...ok, thumb: { thumb: 'javascript:1' } }]), undefined);
  assert.equal(cleanSendImages(Array(SEND_IMAGES_MAX + 1).fill(ok)), undefined);
  assert.equal(cleanSendImages('x'), undefined);
});

test('AI 임시 그림 파일: 만든 이름만 지울 대상으로 본다 (죽은 뒤 남은 캡처 지우기)', () => {
  const uuid = '0b6f1c9e-3d2a-4c55-9a7e-1f2e3d4c5b6a';
  const png = aiTempImageName(uuid, 'image/png');
  const jpg = aiTempImageName(uuid, 'image/jpeg');
  assert.equal(png, `jjakkung-${uuid}.png`);
  assert.equal(jpg, `jjakkung-${uuid}.jpg`);
  assert.ok(isAiTempImage(png) && isAiTempImage(jpg));
  // 다른 앱 파일이나 짝꿍 이름만 같은 파일은 건드리지 않는다
  for (const other of [
    'jjakkung-backup.png',
    `jjakkung-${uuid}.txt`,
    `x-${uuid}.png`,
    `jjakkung-${uuid}.png.bak`,
  ])
    assert.equal(isAiTempImage(other), false, other);
});
