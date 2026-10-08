import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HOUSE_LEVELS, HOUSE_STYLES, hitsAt, houseLayout, houseSvg, isHouseStyle } from './house-art.ts';

const ALL = HOUSE_STYLES.flatMap((s) => Array.from({ length: HOUSE_LEVELS }, (_, i) => [s, i + 1] as const));

test('모양 넷 x 단계 다섯 모두 그림이 있다', () => {
  assert.equal(ALL.length, 20);
  for (const [s, lv] of ALL) {
    const svg = houseSvg(s, lv);
    assert.match(svg, /^<svg [^>]*viewBox="0 0 120 120"/, `${s} ${lv}`);
    assert.ok(!svg.includes('NaN') && !svg.includes('undefined'), `${s} ${lv} 숫자가 깨졌다`);
    // 쉬는 중 불빛(문, 창), Zzz, 편지
    assert.ok((svg.match(/class="rest"/g) ?? []).length >= 2, `${s} ${lv} 불빛`);
    assert.match(svg, /class="rest zzz"/);
    assert.match(svg, /class="letter"/);
  }
});

test('미리 보기(still)에는 불빛, Zzz, 편지가 없다', () => {
  for (const [s, lv] of ALL) {
    const svg = houseSvg(s, lv, { still: true });
    assert.ok(!svg.includes('class="rest'), `${s} ${lv}`);
    assert.ok(!svg.includes('letter'), `${s} ${lv}`);
  }
});

test('문, Zzz, 편지가 그림 칸 안에 있고 문은 집 위에 있다', () => {
  for (const [s, lv] of ALL) {
    const l = houseLayout(s, lv);
    const where = `${s} ${lv}`;
    assert.ok(l.door.x >= 20 && l.door.x <= 100, `${where} 문 x`);
    assert.ok(l.door.bottom >= 100 && l.door.bottom <= 120, `${where} 문턱`);
    // 문 바로 위는 잡히는 자리 (펫이 들어가는 곳이 그림 위)
    assert.ok(hitsAt(l.hits, l.door.x, l.door.bottom - 6, 0), `${where} 문 위`);
    // Zzz 세 글자(마지막 Z 는 18px)가 칸 밖으로 안 나간다
    assert.ok(l.zzz.x >= 0 && l.zzz.x + 15 + 12 <= 120, `${where} Zzz x`);
    assert.ok(l.zzz.y - 23 - 13 >= -1 && l.zzz.y <= 110, `${where} Zzz y`);
    assert.ok(l.letter.x >= 0 && l.letter.x + 29 <= 120 && l.letter.y >= 0, `${where} 편지`);
  }
});

test('하늘은 잡지 않는다: 1단계 위쪽 구석, 마당 없는 단계의 바닥 옆', () => {
  for (const s of HOUSE_STYLES) {
    const l1 = houseLayout(s, 1);
    assert.ok(!hitsAt(l1.hits, 4, 4), `${s} 왼쪽 위`);
    assert.ok(!hitsAt(l1.hits, 116, 4), `${s} 오른쪽 위`);
    assert.ok(!hitsAt(l1.hits, 4, 116), `${s} 1단계 마당 없음`);
    assert.ok(hitsAt(houseLayout(s, 3).hits, 60, 117), `${s} 3단계 마당`);
  }
});

test('이상한 모양, 단계는 나무집과 끝 단계로', () => {
  assert.equal(isHouseStyle('castle'), true);
  assert.equal(isHouseStyle('palace'), false);
  assert.equal(isHouseStyle(undefined), false);
  assert.deepEqual(houseLayout('palace' as never, 2), houseLayout('wood', 2));
  assert.deepEqual(houseLayout('igloo', 0), houseLayout('igloo', 1));
  assert.deepEqual(houseLayout('igloo', 99), houseLayout('igloo', 5));
  assert.deepEqual(houseLayout('igloo', Number.NaN), houseLayout('igloo', 1));
});

test('잡는 자리: 사각형, 타원, 다각형 (pad 만큼 너그럽게)', () => {
  const hits = [{ rect: [10, 10, 10, 10] }, { ell: [60, 60, 10, 5] }, { poly: [80, 100, 100, 80, 120, 100] }];
  assert.ok(hitsAt(hits, 15, 15, 0));
  assert.ok(!hitsAt(hits, 22, 15, 0));
  assert.ok(hitsAt(hits, 22, 15, 3));
  assert.ok(hitsAt(hits, 69, 60, 0));
  assert.ok(!hitsAt(hits, 60, 67, 0));
  assert.ok(hitsAt(hits, 100, 90, 0));
  assert.ok(!hitsAt(hits, 85, 85, 0));
  assert.ok(hitsAt(hits, 89, 89, 2), '빗변 가까이');
});
