import assert from 'node:assert/strict';
import { test } from 'node:test';
import { keepOrder, swapIn } from './pet-order.ts';

const p = (id: string) => ({ id });
const ids = (l: { id: string }[]) => l.map((x) => x.id);

test('보관한 펫을 꺼내면 지금 펫이 그 자리로 들어간다 (다른 카드가 밀리지 않게)', () => {
  const lib = [p('a'), p('b'), p('c'), p('d')];
  assert.deepEqual(ids(swapIn(lib, p('now'), 'c')), ['a', 'b', 'now', 'd']);
});

test('꺼낸 자리가 없으면(기본 펫이나 밀크, 초코로 바꿀 때) 지금 펫은 맨 앞', () => {
  assert.deepEqual(ids(swapIn([p('a'), p('b')], p('now'))), ['now', 'a', 'b']);
  assert.deepEqual(ids(swapIn([p('a'), p('b')], p('now'), 'zz')), ['now', 'a', 'b']);
});

test('보관하지 않는 지금 펫(손대지 않은 밀크, 초코)이면 꺼낸 펫만 빠진다', () => {
  assert.deepEqual(ids(swapIn([p('a'), p('b'), p('c')], undefined, 'b')), ['a', 'c']);
  assert.deepEqual(ids(swapIn([p('a'), p('b')], undefined)), ['a', 'b']);
});

test('카드 순서는 고를 때마다 그대로: 고른 카드는 제자리에서 지금 표시만 바뀐다', () => {
  // 처음: 지금 펫 x, 보관함 a b c
  let order = keepOrder([], ['x', 'a', 'b', 'c']);
  assert.deepEqual(order, ['x', 'a', 'b', 'c']);
  // b 를 고르면 데이터는 지금 b, 보관함 a x c (또는 x a c). 화면 순서는 그대로
  order = keepOrder(order, ['b', 'x', 'a', 'c']);
  assert.deepEqual(order, ['x', 'a', 'b', 'c']);
  // 기본 펫으로: 지금 펫이 없고 보관함에 b 가 들어간다. 그래도 그대로
  order = keepOrder(order, ['b', 'x', 'a', 'c']);
  assert.deepEqual(order, ['x', 'a', 'b', 'c']);
});

test('잠깐 목록에서 빠진 카드(설정이 먼저 오고 보관함이 늦게 올 때)도 자리를 잃지 않는다', () => {
  let order = keepOrder([], ['x', 'a', 'b']);
  order = keepOrder(order, ['b', 'a']);
  assert.deepEqual(order, ['x', 'a', 'b']);
  order = keepOrder(order, ['b', 'x', 'a']);
  assert.deepEqual(order, ['x', 'a', 'b']);
});

test('새로 생긴 펫(펫 만들기, 보관함으로 처음 들어온 밀크 복사본)은 앞에', () => {
  const order = keepOrder(['a', 'b'], ['n', 'a', 'b']);
  assert.deepEqual(order, ['n', 'a', 'b']);
});
