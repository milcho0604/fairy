import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HOUSE_LEVELS, HOUSE_STYLES, hitsAt, houseLayout, houseSvg, isHouseStyle } from './house-art.ts';
import { zzzRect } from './house-room.ts';

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

test('미리 보기(still)에는 불빛, 집 안, Zzz, 편지가 없다', () => {
  for (const [s, lv] of ALL) {
    const svg = houseSvg(s, lv, { still: true });
    assert.ok(!svg.includes('class="rest'), `${s} ${lv}`);
    assert.ok(!svg.includes('letter'), `${s} ${lv}`);
    assert.ok(!svg.includes('class="room"') && !svg.includes('class="slp"'), `${s} ${lv} 집 안`);
  }
});

test('집 창 그림: 문짝, 문간 펫 그림, 방, 침대의 자는 얼굴이 하나씩. clipPath 이름은 모양과 단계마다 다르다', () => {
  const ids = new Set<string>();
  for (const [s, lv] of ALL) {
    const svg = houseSvg(s, lv);
    const where = `${s} ${lv}`;
    for (const cls of ['leaf', 'walker', 'wk', 'room', 'slp', 'blk'])
      assert.equal((svg.match(new RegExp(`class="${cls}"`, 'g')) ?? []).length, 1, `${where} ${cls}`);
    for (const m of svg.matchAll(/<clipPath id="([^"]+)"/g)) {
      assert.ok(!ids.has(m[1] ?? ''), `${where} ${m[1]} 겹침`);
      ids.add(m[1] ?? '');
      assert.ok(svg.includes(`url(#${m[1]})`), `${where} ${m[1]} 안 씀`);
    }
    // 방은 집 몸 뒤가 아니라 앞에 (앞벽을 걷어 낸 것처럼), Zzz 와 편지는 방보다 앞에
    assert.ok(svg.indexOf('class="room"') > svg.indexOf('class="hb"'), `${where} 방 순서`);
    assert.ok(svg.indexOf('class="rest zzz"') > svg.indexOf('class="room"'), `${where} Zzz 순서`);
  }
  assert.equal(ids.size, 40);
});

test('문, Zzz, 편지가 그림 칸 안에 있고 문은 집 위에 있다', () => {
  for (const [s, lv] of ALL) {
    const l = houseLayout(s, lv);
    const where = `${s} ${lv}`;
    assert.ok(l.door.x >= 20 && l.door.x <= 100, `${where} 문 x`);
    assert.ok(l.door.bottom >= 100 && l.door.bottom <= 120, `${where} 문턱`);
    // 문 바로 위는 잡히는 자리 (펫이 들어가는 곳이 그림 위)
    assert.ok(hitsAt(l.hits, l.door.x, l.door.bottom - 6, 0), `${where} 문 위`);
    // Zzz 세 글자(마지막 Z 는 15k px, 13k 오른쪽 19k 위)가 칸 밖으로 안 나간다
    const k = l.zzz.k;
    assert.ok(k >= 0.7 && k <= 1, `${where} Zzz 크기`);
    assert.ok(l.zzz.x >= 0 && l.zzz.x + (13 + 12) * k <= 120, `${where} Zzz x`);
    assert.ok(l.zzz.y - (19 + 13) * k >= -1 && l.zzz.y <= 110, `${where} Zzz y`);
    // 편지: 봉투(24x17)와 오른쪽 위 빨간 점(가운데 x+23, y, 반지름 4.5)이 들썩여도(위로 3) 칸 안에
    const { x: lx, y: ly } = l.letter;
    assert.ok(lx >= 0 && lx + 23 + 4.5 + 1 <= 120, `${where} 편지 x`);
    assert.ok(ly - 4.5 - 1 - 3 >= 0 && ly + 17 <= 120, `${where} 편지 y`);
    // 편지는 집에 붙어 있다 (하늘에 뜨지 않게): 봉투 가운데 근처가 집 그림 위
    assert.ok(hitsAt(l.hits, lx + 12, ly + 12, 6), `${where} 편지가 집에 붙음`);
  }
});

test('지붕 띠가 바로 위인 방(버섯집 1~3단계)은 Zzz 가 띠 아래, 방 안, 얼굴과 이불 사이에 든다', () => {
  for (const [s, lv] of ALL) {
    const l = houseLayout(s, lv);
    if (l.room.kind !== 'rect' || l.room.ceiling === undefined) continue;
    const where = `${s} ${lv}`;
    const z = zzzRect(l.zzz);
    // Z 꼭대기 (글자 크기 15k 의 0.74 가 대문자 높이)
    const zTop = l.zzz.y - 19 * l.zzz.k * (l.zzz.rise ?? 1) - 15 * 0.74 * l.zzz.k;
    assert.ok(zTop >= l.room.ceiling - 0.01, `${where} Z 꼭대기 ${zTop} < 띠 ${l.room.ceiling}`);
    assert.ok(z.x + z.w <= l.room.x + l.room.w, `${where} 방 오른쪽`);
    assert.ok(l.zzz.y <= l.scene.blanket.top, `${where} 이불 위`);
    assert.ok((l.zzz.rise ?? 1) >= 0.4, `${where} 너무 눕지 않게`);
  }
  // 버섯집 1~3단계만 띠가 있다 (다른 집은 예전 자리 그대로)
  const ceiled = ALL.filter(([s, lv]) => {
    const r = houseLayout(s, lv).room;
    return r.kind === 'rect' && r.ceiling !== undefined;
  });
  assert.deepEqual(
    ceiled.map(([s, lv]) => `${s}${lv}`),
    ['mushroom1', 'mushroom2', 'mushroom3'],
  );
  assert.equal(houseLayout('wood', 1).zzz.rise, 1);
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
