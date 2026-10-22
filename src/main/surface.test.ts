import assert from 'node:assert/strict';
import { test } from 'node:test';
import { closesPanelFor, originOf, pickSurface } from './surface.ts';

interface W {
  name: string;
  dead?: boolean;
}
const alive = (w: W) => !w.dead;
const home: W = { name: 'home' };
const panel: W = { name: 'panel' };

test('지금 보이는 면: 큰 창이 있으면 큰 창, 없으면 패널', () => {
  assert.equal(pickSurface(home, panel, alive), home);
  assert.equal(pickSurface(undefined, panel, alive), panel);
  assert.equal(pickSurface(home, undefined, alive), home);
  assert.equal(pickSurface<W>(undefined, undefined, alive), undefined);
});

test('닫힌 창은 면이 아니다: 큰 창이 부서졌으면 패널로, 둘 다 부서졌으면 없음', () => {
  assert.equal(pickSurface({ ...home, dead: true }, panel, alive), panel);
  assert.equal(pickSurface({ ...home, dead: true }, { ...panel, dead: true }, alive), undefined);
  assert.equal(pickSurface(undefined, { ...panel, dead: true }, alive), undefined);
});

test('열기 요청의 출처: 큰 창만 home, 나머지는 패널', () => {
  assert.equal(originOf(home, home), 'home');
  assert.equal(originOf(panel, home), 'panel');
  assert.equal(originOf(panel, undefined), 'panel');
  assert.equal(originOf(home, undefined), 'panel');
});

test('패널에서 온 열기 요청만 패널을 먼저 닫는다', () => {
  assert.equal(closesPanelFor('panel'), true);
  assert.equal(closesPanelFor('home'), false);
  assert.equal(closesPanelFor(originOf(panel, home)), true);
  assert.equal(closesPanelFor(originOf(home, home)), false);
});

test('숨겨 둔 큰 창은 보이는 면이 아니다: 패널이 열려 있으면 패널, 둘 다 없으면 없음', () => {
  const hidden = new Set<W>([home]);
  const shown = (w: W) => !w.dead && !hidden.has(w);
  assert.equal(pickSurface(home, panel, shown), panel);
  assert.equal(pickSurface(home, undefined, shown), undefined);
  hidden.clear();
  assert.equal(pickSurface(home, panel, shown), home);
});
