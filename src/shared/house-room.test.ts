import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HOUSE_LEVELS, HOUSE_STYLES, hitsAt, houseLayout } from './house-art.ts';
import {
  artToScreen,
  DEFAULT_BOX,
  doorSprite,
  inRoom,
  letterSpot,
  parseSprites,
  type RoomShape,
  roomBox,
  roomPath,
  spriteToPet,
} from './house-room.ts';

const ALL = HOUSE_STYLES.flatMap((s) => Array.from({ length: HOUSE_LEVELS }, (_, i) => [s, i + 1] as const));
const PNG = `data:image/png;base64,${'A'.repeat(40)}`;

test('방 안 가구: 모양 넷 x 단계 다섯 모두 침대, 얼굴, 등, 창이 방 안에 있다', () => {
  for (const [s, lv] of ALL) {
    const l = houseLayout(s, lv);
    const { room, scene: sc } = l;
    const where = `${s} ${lv}`;
    const inside = (x: number, y: number, what: string) =>
      assert.ok(inRoom(room, x, y), `${where} ${what} (${x}, ${y})`);
    inside(sc.bed.x, sc.headboard, '머리판 위');
    inside(sc.bed.x + sc.bed.w, sc.footboard, '발판 위');
    inside(sc.bed.x, sc.bed.floor - 0.5, '침대 왼쪽 아래');
    inside(sc.bed.x + sc.bed.w, sc.bed.floor - 0.5, '침대 오른쪽 아래');
    inside(sc.head.x + sc.head.size / 2, sc.head.y, '얼굴 위');
    inside(sc.lamp.x, sc.lamp.y, '등');
    if (sc.window) {
      inside(sc.window.x, sc.window.y, '창 왼쪽 위');
      inside(sc.window.x + sc.window.w, sc.window.y + sc.window.h, '창 오른쪽 아래');
    }
    // 얼굴은 베개(매트리스 위)에 눕고 이불은 턱 밑에서 발판까지, 볼록하다
    assert.ok(sc.head.y + sc.head.size > sc.bed.top && sc.head.y < sc.bed.top, `${where} 베개 위 얼굴`);
    assert.ok(sc.blanket.x0 > sc.head.x && sc.blanket.x0 < sc.head.x + sc.head.size, `${where} 이불 턱 밑`);
    assert.ok(sc.blanket.x1 <= sc.bed.x + sc.bed.w && sc.blanket.top < sc.bed.top, `${where} 이불`);
    // 얼굴은 작은 집(104px)에서도 알아볼 만큼: 그림 칸 15 이상 (104px 집에서 13px)
    assert.ok(sc.head.size >= 15, `${where} 얼굴 ${sc.head.size}`);
    // 방은 문을 덮는다 (쉬는 동안 문 대신 방이 보인다)
    assert.ok(inRoom(room, l.door.x, l.door.bottom - 4), `${where} 문 위`);
    assert.ok(!roomPath(room).includes('NaN'), where);
  }
});

test('뒷벽 창은 Zzz 와 등을 가리지 않는다', () => {
  for (const [s, lv] of ALL) {
    const { scene: sc } = houseLayout(s, lv);
    const w = sc.window;
    if (!w) continue;
    const k = sc.zzz.k;
    const zx0 = sc.zzz.x - 1;
    const zy0 = sc.zzz.y - 31 * k;
    const apart = w.x + w.w <= zx0 || zx0 + 28 * k <= w.x || w.y + w.h <= zy0 || sc.zzz.y + 2 <= w.y;
    assert.ok(apart, `${s} ${lv}`);
  }
});

test('반타원 방: 가구 자리는 바닥 위, 벽 안 너비', () => {
  const dome: RoomShape = { kind: 'dome', cx: 60, floor: 110, rx: 40, ry: 50 };
  const b = roomBox(dome);
  assert.equal(b.y + b.h, 110);
  assert.ok(inRoom(dome, b.x, b.y + b.h * 0.38) && inRoom(dome, b.x + b.w, b.y + b.h * 0.38));
  assert.ok(!inRoom(dome, 60, 111) && !inRoom(dome, 21, 60));
  assert.match(roomPath(dome), /^M20 110A40 50 0 0 1 100 110Z$/);
  assert.match(roomPath({ kind: 'rect', x: 0, y: 0, w: 10, h: 10, r: 2 }), /Q10 10 8 10/);
});

test('편지는 방 위 모서리에 걸치고 칸 안에 (빨간 점과 들썩임까지), Zzz 와 겹치면 반대쪽', () => {
  const room: RoomShape = { kind: 'rect', x: 22, y: 57, w: 76, h: 53 };
  assert.deepEqual(letterSpot(room), { x: 78, y: 53 });
  assert.deepEqual(letterSpot(room, { x: 80, y: 80, k: 1 }), { x: 18, y: 53 });
  assert.deepEqual(letterSpot({ kind: 'rect', x: 0, y: 0, w: 120, h: 120 }), { x: 90, y: 10 });
  const far = letterSpot({ kind: 'rect', x: 200, y: 200, w: 1, h: 1 });
  assert.ok(far.x + 27.5 <= 120 && far.y + 17 <= 120);
  for (const [s, lv] of ALL) {
    const l = houseLayout(s, lv);
    const z = l.zzz;
    const apart =
      l.letter.x + 29 <= z.x - 1 ||
      z.x - 1 + 28 * z.k <= l.letter.x ||
      l.letter.y + 17 <= z.y - 31 * z.k ||
      z.y + 2 <= l.letter.y - 5;
    assert.ok(apart, `${s} ${lv} 편지와 Zzz`);
  }
});

test('문간 펫 그림: 문 안 아래에 붙고, 넓은 펫도 문 너비를 크게 넘지 않는다', () => {
  for (const [s, lv] of ALL) {
    const d = houseLayout(s, lv).door;
    const sp = doorSprite(d);
    const where = `${s} ${lv}`;
    assert.equal(sp.y + sp.size, d.bottom, `${where} 문턱`);
    assert.ok(Math.abs(sp.x + sp.size / 2 - d.x) < 1e-9, `${where} 가운데`);
    assert.ok(sp.size <= d.w * 1.15 + 1e-9 && sp.size <= (d.bottom - d.top) * 0.86 + 1e-9, `${where} 크기`);
    assert.ok(sp.y >= d.top - 1, `${where} 문 위로 안 나감`);
  }
  // 모양과 단계마다 문이 다르다 (나무집 1단계 하나로 쓰면 다른 집에서 엉뚱한 자리로 들어간다)
  const spots = new Set(ALL.map(([s, lv]) => JSON.stringify(doorSprite(houseLayout(s, lv).door))));
  assert.ok(spots.size >= 12, `${spots.size}`);
});

test('펫 창 맞추기: 펫 캔버스에서 자른 자리가 화면 그림 자리와 겹친다 (되돌리면 그대로)', () => {
  const house = { x: -1000, y: 500, width: 136, height: 136 };
  const sprite = artToScreen(house, doorSprite(houseLayout('castle', 3).door));
  for (const box of [DEFAULT_BOX, { x: 0.2, y: 0.1, side: 0.6 }, { x: -0.05, y: 0.3, side: 1.1 }]) {
    const pet = spriteToPet(sprite, box);
    assert.equal(pet.width, pet.height);
    // 펫 창 안 box 자리 = 그림 자리 (반올림 2px 안)
    assert.ok(Math.abs(pet.x + box.x * pet.width - sprite.x) <= 2);
    assert.ok(Math.abs(pet.y + box.y * pet.width - sprite.y) <= 2);
    assert.ok(Math.abs(box.side * pet.width - sprite.width) <= 2);
  }
  assert.deepEqual(artToScreen({ x: 10, y: 20, width: 240, height: 240 }, { x: 60, y: 30, size: 12 }), {
    x: 130,
    y: 80,
    width: 24,
    height: 24,
  });
});

test('펫 화면이 보낸 집 안 그림 검사', () => {
  const good = { awake: PNG, sleep: PNG, box: { x: 0.1, y: 0.2, side: 0.8 } };
  assert.deepEqual(parseSprites(good), good);
  for (const bad of [
    null,
    'x',
    { ...good, awake: 'data:image/svg+xml;base64,AAAA' },
    { ...good, sleep: `${PNG}<` },
    { ...good, box: undefined },
    { ...good, box: { x: 0.1, y: 0.2, side: 0 } },
    { ...good, box: { x: Number.NaN, y: 0.2, side: 0.8 } },
    { ...good, box: { x: 0.1, y: 3, side: 0.8 } },
    { ...good, box: { x: '0.1', y: 0.2, side: 0.8 } },
  ])
    assert.equal(parseSprites(bad), undefined, JSON.stringify(bad)?.slice(0, 80));
  // 다른 키는 버린다
  assert.deepEqual(parseSprites({ ...good, extra: 1 }), good);
});

test('방이 쉬는 동안 보일 자리는 집 그림 위 (하늘에 뜬 방이 없다)', () => {
  for (const [s, lv] of ALL) {
    const l = houseLayout(s, lv);
    const b = roomBox(l.room);
    assert.ok(hitsAt(l.hits, b.x + b.w / 2, b.y + b.h / 2, 0), `${s} ${lv}`);
  }
});
