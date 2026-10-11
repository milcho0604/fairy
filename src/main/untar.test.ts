import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tarEntries } from './untar.ts';

/** ustar 머리 하나 (검사합까지) */
function header(name: string, size: number, type = '0', prefix = ''): Buffer {
  const h = Buffer.alloc(512);
  h.write(name, 0, 100, 'utf8');
  h.write('0000644\0', 100);
  h.write(`${size.toString(8).padStart(11, '0')}\0`, 124);
  h.write(type, 156);
  h.write('ustar\0', 257);
  h.write('00', 263);
  h.write(prefix, 345, 155, 'utf8');
  h.fill(0x20, 148, 156);
  let sum = 0;
  for (const b of h) sum += b;
  h.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
  return h;
}
const pad = (b: Buffer) => Buffer.concat([b, Buffer.alloc((512 - (b.length % 512)) % 512)]);
const file = (name: string, body: string, type = '0', prefix = '') => {
  const data = Buffer.from(body);
  return Buffer.concat([header(name, data.length, type, prefix), pad(data)]);
};
const END = Buffer.alloc(1024);

test('tar: 파일, 폴더, 긴 이름(prefix, pax, GNU)을 읽는다', () => {
  const pax = (path: string) => {
    const rec = (n: number) => `${n} path=${path}\n`;
    let len = rec(0).length;
    while (rec(len).length !== len) len = rec(len).length;
    return rec(len);
  };
  const tar = Buffer.concat([
    file('package/', '', '5'),
    file('package/a.txt', 'hello'),
    file('b.txt', 'x'.repeat(700), '0', 'package/deep'),
    file('PaxHeader', pax('package/long-pax.bin'), 'x'),
    file('ignored', 'pax body'),
    file('././@LongLink', 'package/gnu-long.bin\0', 'L'),
    file('ignored2', 'gnu body'),
    END,
  ]);
  const got = [...tarEntries(tar)].map((e) => [e.name, e.type, e.data.toString()]);
  assert.deepEqual(got, [
    ['package/', '5', ''],
    ['package/a.txt', '0', 'hello'],
    ['package/deep/b.txt', '0', 'x'.repeat(700)],
    ['package/long-pax.bin', '0', 'pax body'],
    ['package/gnu-long.bin', '0', 'gnu body'],
  ]);
});

test('tar: 검사합이 틀리거나 끊긴 묶음은 멈춘다', () => {
  const ok = file('a', 'hello');
  const bad = Buffer.from(ok);
  bad[0] = 0x62; // 이름 한 글자를 바꾼다
  assert.throws(() => [...tarEntries(Buffer.concat([bad, END]))], /검사합/);
  assert.throws(() => [...tarEntries(ok.subarray(0, 512 + 2))], /끊겼다/);
});
