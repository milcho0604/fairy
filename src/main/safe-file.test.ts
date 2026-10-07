import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { plainEntry, readFileIn, safeFileIn } from './safe-file.ts';

const root = mkdtempSync(join(tmpdir(), 'jj-safe-'));
after(() => rmSync(root, { recursive: true, force: true }));
const pets = join(root, 'pets');
mkdirSync(pets);
const secret = join(root, 'secret.txt');
writeFileSync(secret, 'SECRET');
writeFileSync(join(pets, 'pet-1.png'), 'PNG');
symlinkSync(secret, join(pets, 'pet-link.png'));
mkdirSync(join(pets, 'pet-dir.png'));

test('pets 안 일반 파일만 읽는다: 링크, 폴더, 경로가 든 이름은 거른다 (버그잡이 7차)', () => {
  assert.equal(readFileIn(pets, 'pet-1.png')?.toString(), 'PNG');
  assert.equal(readFileIn(pets, 'pet-link.png'), undefined);
  // pets 안을 가리키는 링크도 링크다 (일반 파일만)
  symlinkSync(join(pets, 'pet-1.png'), join(pets, 'pet-inner-link.png'));
  assert.equal(safeFileIn(pets, 'pet-inner-link.png'), undefined);
  assert.equal(safeFileIn(pets, 'pet-dir.png'), undefined);
  assert.equal(safeFileIn(pets, '../secret.txt'), undefined);
  assert.equal(safeFileIn(pets, 'none.png'), undefined);
  assert.equal(safeFileIn(pets, undefined), undefined);
});

test('pets 안의 폴더 링크도 거른다', () => {
  const outside = join(root, 'outside');
  mkdirSync(outside);
  writeFileSync(join(outside, 'pet-2.png'), 'X');
  symlinkSync(outside, join(pets, 'sub'));
  assert.equal(safeFileIn(pets, 'sub'), undefined);
  assert.equal(safeFileIn(join(pets, 'sub'), '../secret.txt'), undefined);
});

test('폴더 복사 거르개: 링크는 빼고 일반 파일과 폴더만 복사한다', () => {
  const dest = join(root, 'copy');
  cpSync(pets, dest, { recursive: true, filter: plainEntry });
  assert.equal(existsSync(join(dest, 'pet-1.png')), true);
  assert.equal(existsSync(join(dest, 'pet-link.png')), false);
  assert.equal(existsSync(join(dest, 'sub')), false);
});
