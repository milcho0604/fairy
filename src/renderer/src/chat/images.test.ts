import assert from 'node:assert/strict';
import { test } from 'node:test';
import { splitFiles } from './images.ts';

const f = (name: string, type: string) => ({ name, type });

test('끌어다 놓은 파일을 그림과 그 밖으로 가른다', () => {
  const r = splitFiles([
    f('a.png', 'image/png'),
    f('b.pdf', 'application/pdf'),
    f('c.ts', ''),
    f('d.jpg', 'image/jpeg'),
  ]);
  assert.deepEqual(
    r.images.map((x) => x.name),
    ['a.png', 'd.jpg'],
  );
  assert.deepEqual(
    r.others.map((x) => x.name),
    ['b.pdf', 'c.ts'],
  );
});

test('아무것도 없으면 둘 다 빈 목록', () => {
  assert.deepEqual(splitFiles([]), { images: [], others: [] });
});
