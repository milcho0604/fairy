import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fitSavedBounds } from './geometry.ts';
import {
  clampPanelSize,
  defaultPanelBounds,
  PANEL_DEFAULT,
  panelOffsetAfterMove,
  parsePanelOffset,
  placePanel,
  resizePanelRect,
  SNAP_PX,
} from './panel-place.ts';

// geometry.test.ts 와 같은 개발 맥 배치: 내장 화면이 왼쪽 음수 좌표, 외장 둘.
const builtIn = { x: -1512, y: 33, width: 1512, height: 949 };
const main = { x: 0, y: 30, width: 1920, height: 1050 };
const right = { x: 1920, y: 30, width: 1920, height: 1050 };
const areas = [builtIn, main, right];
const size = { width: 360, height: 540 };
const pet = (x: number, y: number) => ({ x, y, width: 160, height: 160 });

test('기본 자리는 펫 왼쪽, 아래 끝을 펫과 맞춘다', () => {
  assert.deepEqual(defaultPanelBounds(pet(1000, 900), size, main), { x: 634, y: 520, ...size });
});

test('왼쪽에 자리가 없으면 펫 오른쪽', () => {
  assert.deepEqual(defaultPanelBounds(pet(100, 900), size, main), { x: 266, y: 520, ...size });
});

test('펫이 화면 위쪽이면 패널이 위로 넘치지 않게 내린다', () => {
  assert.equal(defaultPanelBounds(pet(1000, 40), size, main).y, 30);
});

test('기억한 거리가 없으면 기본 자리', () => {
  assert.deepEqual(
    placePanel(pet(1000, 900), size, main, areas, undefined),
    defaultPanelBounds(pet(1000, 900), size, main),
  );
});

test('기억한 거리가 있으면 펫이 걸어가도 같은 거리에 뜬다', () => {
  const offset = { x: -100, y: -560 };
  assert.deepEqual(placePanel(pet(1000, 900), size, main, areas, offset), { x: 900, y: 340, ...size });
  assert.deepEqual(placePanel(pet(1400, 900), size, main, areas, offset), { x: 1300, y: 340, ...size });
});

test('기억한 자리가 화면 밖이면 보이는 화면 안으로 끌어온다', () => {
  // 펫이 오른쪽 끝으로 걸어가 패널이 화면 밖으로 나가는 경우
  const r = placePanel(pet(1700, 900), size, main, [main], { x: 300, y: -200 });
  assert.equal(r.x, main.x + main.width - size.width);
  assert.equal(r.y, main.y + main.height - size.height);
});

test('옮겨 둔 외장 모니터를 빼면 남은 화면 안으로', () => {
  // 펫은 가운데 모니터, 패널은 오른쪽 모니터로 옮겨 두었다가 오른쪽 모니터를 뺐다
  const offset = { x: 1200, y: -500 };
  const withRight = placePanel(pet(1000, 900), size, main, areas, offset);
  assert.equal(withRight.x, 2200);
  const unplugged = placePanel(pet(1000, 900), size, main, [builtIn, main], offset);
  assert.deepEqual(unplugged, { x: main.x + main.width - size.width, y: 400, ...size });
});

test('음수 좌표 모니터에서도 거리대로', () => {
  const r = placePanel(pet(-500, 700), size, builtIn, areas, { x: -400, y: -300 });
  assert.deepEqual(r, { x: -900, y: 400, ...size });
});

test('기본 자리 가까이 놓으면 기억하지 않는다 (기본으로 돌아감)', () => {
  const p = pet(1000, 900);
  const def = defaultPanelBounds(p, size, main);
  assert.equal(panelOffsetAfterMove({ ...def, x: def.x + SNAP_PX, y: def.y - SNAP_PX }, p, def), undefined);
  assert.deepEqual(panelOffsetAfterMove({ ...def, x: def.x + SNAP_PX + 1 }, p, def), {
    x: def.x + SNAP_PX + 1 - p.x,
    y: def.y - p.y,
  });
});

test('놓은 자리는 펫 왼쪽 위 기준 거리로 저장한다', () => {
  const p = pet(1000, 900);
  const def = defaultPanelBounds(p, size, main);
  assert.deepEqual(panelOffsetAfterMove({ x: 300, y: 100, ...size }, p, def), { x: -700, y: -800 });
});

test('저장 파일이 깨졌으면 기본 자리', () => {
  assert.equal(parsePanelOffset(undefined), undefined);
  assert.equal(parsePanelOffset(null), undefined);
  assert.equal(parsePanelOffset('x'), undefined);
  assert.equal(parsePanelOffset({ x: 1, y: 2 }), undefined);
  assert.equal(parsePanelOffset({ dx: '1', dy: 2 }), undefined);
  assert.equal(parsePanelOffset({ dx: Number.NaN, dy: 2 }), undefined);
  assert.equal(parsePanelOffset({ dx: 1e9, dy: 2 }), undefined);
  assert.deepEqual(parsePanelOffset({ dx: -100.4, dy: 20.6 }), { x: -100, y: 21 });
});

test('패널 크기 범위: 너비 320~560, 높이 420 이상, 작업 영역 안', () => {
  assert.deepEqual(clampPanelSize({ width: 100, height: 100 }, main), { width: 320, height: 420 });
  assert.deepEqual(clampPanelSize({ width: 900, height: 5000 }, main), { width: 560, height: main.height });
  assert.deepEqual(clampPanelSize(PANEL_DEFAULT, main), PANEL_DEFAULT);
  assert.deepEqual(clampPanelSize({ width: 400.4, height: 500.6 }, main), { width: 400, height: 501 });
  // 깨진 값은 처음 크기
  assert.deepEqual(
    clampPanelSize({ width: Number.NaN, height: Number.POSITIVE_INFINITY }, main),
    PANEL_DEFAULT,
  );
});

test('작업 영역이 최소보다 작으면 작업 영역이 이긴다', () => {
  const tiny = { x: 0, y: 0, width: 300, height: 380 };
  assert.deepEqual(clampPanelSize({ width: 360, height: 540 }, tiny), { width: 300, height: 380 });
});

test('끌어서 크기 바꾸기: 왼쪽 위는 그대로, 범위 안으로', () => {
  const rect = { x: 500, y: 100, ...PANEL_DEFAULT };
  assert.deepEqual(resizePanelRect(rect, { width: 480, height: 700 }, main), {
    x: 500,
    y: 100,
    width: 480,
    height: 700,
  });
  assert.deepEqual(resizePanelRect(rect, { width: 50, height: 50 }, main), {
    x: 500,
    y: 100,
    width: 320,
    height: 420,
  });
  assert.equal(resizePanelRect(rect, { width: 9999, height: 9999 }, main).width, 560);
});

test('끌어서 키울 때 작업 영역 아래, 오른쪽을 넘으면 위치를 안쪽으로 민다', () => {
  // 펫이 화면 아래에 있어 패널 아래 끝이 작업 영역 아래 끝에 닿아 있다
  const rect = { x: 1500, y: main.y + main.height - 540, ...PANEL_DEFAULT };
  const r = resizePanelRect(rect, { width: 560, height: 700 }, main);
  assert.equal(r.height, 700);
  assert.equal(r.y + r.height, main.y + main.height);
  assert.equal(r.x + r.width, main.x + main.width);
});

test('화면이 작으면 위치만 옮기지 않고 크기를 먼저 줄인다 (기본 자리)', () => {
  const small = { x: 0, y: 25, width: 1024, height: 500 };
  const r = placePanel(pet(800, 300), { width: 560, height: 700 }, small, [small], undefined);
  assert.deepEqual(r.height, 500);
  assert.ok(r.x >= small.x && r.x + r.width <= small.x + small.width);
  assert.ok(r.y >= small.y && r.y + r.height <= small.y + small.height);
});

test('화면이 작으면 기억한 자리에서도 크기를 줄이고 통째로 보이게', () => {
  const small = { x: 0, y: 25, width: 400, height: 500 };
  const r = placePanel(pet(100, 300), { width: 560, height: 700 }, small, [small], { x: 200, y: 100 });
  assert.deepEqual({ w: r.width, h: r.height }, { w: 400, h: 500 });
  assert.deepEqual({ x: r.x, y: r.y }, { x: 0, y: 25 });
});

test('다른 모니터로 옮겨 둔 패널은 그 모니터 크기에 맞춘다', () => {
  const small = { x: 1920, y: 30, width: 800, height: 450 };
  const r = placePanel(pet(1000, 900), { width: 560, height: 700 }, main, [main, small], {
    x: 1000,
    y: -800,
  });
  assert.equal(r.height, 450);
  assert.ok(r.x >= small.x && r.x + r.width <= small.x + small.width);
});

test('설정 창 최소 높이 520: 저장한 높이가 작으면 올리되 화면보다는 크지 않게', () => {
  const min = { width: 360, height: 520 };
  assert.equal(fitSavedBounds({ width: 440, height: 400 }, [main], min)?.height, 520);
  const laptop = { x: 0, y: 25, width: 1280, height: 480 };
  assert.equal(fitSavedBounds({ width: 440, height: 400 }, [laptop], min)?.height, 480);
});
