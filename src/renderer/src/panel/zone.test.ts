import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { MEDIUM_MIN, WIDE_MIN, zoneOf } from './zone.ts';

test('구간 경계: 좁음 <520, 보통 520~860 미만, 넓음 >=860', () => {
  assert.equal(MEDIUM_MIN, 520);
  assert.equal(WIDE_MIN, 860);
  assert.equal(zoneOf(519.9), 'narrow');
  assert.equal(zoneOf(520), 'medium');
  assert.equal(zoneOf(859.9), 'medium');
  assert.equal(zoneOf(860), 'wide');
  assert.equal(zoneOf(2000), 'wide');
});

test('작은 패널: 기본 360 과 최소 320 은 좁음, 최대 560 은 보통 (본문 칸 = 창 폭 - 여백 12 - 테두리 2)', () => {
  const body = (win: number) => win - 12 - 2;
  assert.equal(zoneOf(body(320)), 'narrow');
  assert.equal(zoneOf(body(360)), 'narrow');
  assert.equal(zoneOf(body(560)), 'medium');
});

test('깨진 폭(0, 음수, NaN)은 좁음', () => {
  assert.equal(zoneOf(0), 'narrow');
  assert.equal(zoneOf(-10), 'narrow');
  assert.equal(zoneOf(Number.NaN), 'narrow');
});

// CSS 의 컨테이너 쿼리와 어긋나지 않게: 본문 칸이 컨테이너이고, 구간 숫자를 CSS 에서 쓰면 이 값과 같아야 한다
test('본문 칸(.panel-tabpanel)은 inline-size 컨테이너다', () => {
  const css = readFileSync(join(import.meta.dirname, 'panel.css'), 'utf8');
  const rule = /\.panel-tabpanel\s*\{([^}]*)\}/g;
  const bodies = [...css.matchAll(rule)].map((m) => m[1] ?? '');
  assert.ok(
    bodies.some((b) => /container-type:\s*inline-size/.test(b)),
    '.panel-tabpanel 에 container-type: inline-size',
  );
  for (const m of css.matchAll(/@container[^{]*\((?:min|max)-width:\s*(\d+)px\)/g)) {
    const w = Number(m[1]);
    // 구간 경계(520, 860)를 쓰는 쿼리가 있다면 zone.ts 와 같은 값이어야 한다 (이름 없는 컨테이너 쿼리는 달력의 300 이 있다)
    if (w >= 500) assert.ok(w === MEDIUM_MIN || w === WIDE_MIN, `구간과 다른 폭 ${w}`);
  }
});
