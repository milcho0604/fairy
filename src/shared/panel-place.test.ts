import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  defaultPanelBounds,
  panelOffsetAfterMove,
  parsePanelOffset,
  placePanel,
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
