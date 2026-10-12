import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import {
  freePath,
  plainEntry,
  plainFile,
  readFileIn,
  readPlainCapped,
  renameRetry,
  safeFileIn,
  writableDir,
  writeFileAtomic,
} from './safe-file.ts';

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

test('같은 이름 폴더가 있으면 -2, -3 을 붙인 새 경로 (같은 분에 두 번 가져오기)', () => {
  const base = join(root, 'before-import-20261007-1637');
  assert.equal(freePath(base), base);
  mkdirSync(base);
  assert.equal(freePath(base), `${base}-2`);
  mkdirSync(`${base}-2`);
  assert.equal(freePath(base), `${base}-3`);
});

test('원자적 쓰기: 다 쓰면 바뀌고, 실패하면 원래 파일과 임시 파일 없음이 남는다', () => {
  const dir = join(root, 'atomic');
  mkdirSync(dir);
  const file = join(dir, 'model-1.json');
  writeFileAtomic(file, '{"v":1}');
  assert.equal(readFileSync(file, 'utf8'), '{"v":1}');
  writeFileAtomic(file, Buffer.from('{"v":2}'));
  assert.equal(readFileSync(file, 'utf8'), '{"v":2}');
  // 바꿀 자리가 폴더라 rename 이 실패한다: 오류를 던지고 임시 파일은 치운다
  const blocked = join(dir, 'blocked.png');
  mkdirSync(blocked);
  assert.throws(() => writeFileAtomic(blocked, 'PNG'));
  assert.deepEqual(readdirSync(dir).sort(), ['blocked.png', 'model-1.json']);
});

test('크기 상한을 주면 그보다 큰 파일은 읽지 않는다 (설계도를 화면에 보낼 때)', () => {
  writeFileSync(join(pets, 'model-big.json'), 'x'.repeat(2048));
  assert.equal(readFileIn(pets, 'model-big.json', 1024), undefined);
  assert.equal(readFileIn(pets, 'model-big.json', 4096)?.length, 2048);
  assert.equal(readFileIn(pets, 'model-big.json')?.length, 2048);
  assert.equal(readFileIn(pets, 'pet-link.png', 4096), undefined);
});

const busy = (code: string) => Object.assign(new Error(code), { code });

test('renameRetry: 윈도우에서 잠깐 잡힌 파일(EBUSY, EPERM, EACCES)은 몇 번 더 해 본다', () => {
  let calls = 0;
  const waits: number[] = [];
  renameRetry(
    'a',
    'b',
    () => {
      calls++;
      if (calls < 3) throw busy(calls === 1 ? 'EBUSY' : 'EPERM');
    },
    'win32',
    (ms) => waits.push(ms),
  );
  assert.equal(calls, 3);
  assert.equal(waits.length, 2);
});

test('renameRetry: 끝까지 잡혀 있으면 몇 번만 해 보고 던진다, 다른 오류와 다른 운영체제는 바로 던진다', () => {
  let calls = 0;
  const always = () => {
    calls++;
    throw busy('EACCES');
  };
  assert.throws(() => renameRetry('a', 'b', always, 'win32', () => {}), /EACCES/);
  assert.ok(calls > 1 && calls <= 6, `${calls}번`);
  calls = 0;
  assert.throws(() => renameRetry('a', 'b', always, 'darwin', () => {}), /EACCES/);
  assert.equal(calls, 1);
  calls = 0;
  const missing = () => {
    calls++;
    throw busy('ENOENT');
  };
  assert.throws(() => renameRetry('a', 'b', missing, 'win32', () => {}), /ENOENT/);
  assert.equal(calls, 1);
});

test('일반 파일만: 링크, 폴더, 없는 것은 아니다 (백업 가져오기의 설정, 저장 파일. 버그잡이 4)', () => {
  assert.equal(plainFile(join(pets, 'pet-1.png')), true);
  assert.equal(plainFile(join(pets, 'pet-link.png')), false);
  assert.equal(plainFile(join(pets, 'pet-dir.png')), false);
  assert.equal(plainFile(join(pets, 'none.png')), false);
});

test('고른 파일 상한까지 읽기: 일반 파일만, 크면 tooBig, 장치 링크와 파이프는 멈추지 않고 거른다 (버그잡이 4)', () => {
  const f = join(root, 'pet.fairy');
  writeFileSync(f, '{"a":1}');
  assert.equal(readPlainCapped(f, 100)?.toString(), '{"a":1}');
  assert.equal(readPlainCapped(f, 3), 'tooBig');
  assert.equal(readPlainCapped(join(root, 'none.fairy'), 100), undefined);
  assert.equal(readPlainCapped(pets, 100), undefined);
  if (process.platform !== 'win32') {
    const dev = join(root, 'zero.fairy');
    symlinkSync('/dev/zero', dev);
    assert.equal(readPlainCapped(dev, 100), undefined);
    const fifo = join(root, 'pipe.fairy');
    execFileSync('mkfifo', [fifo]);
    assert.equal(readPlainCapped(fifo, 100), undefined);
  }
});

test('폴더에 쓸 수 있는지: 있는 폴더, 아직 없는 폴더(부모), 읽기 전용 (버그잡이 4)', () => {
  assert.equal(writableDir(root), true);
  assert.equal(writableDir(join(root, 'not-yet')), true);
  assert.equal(writableDir(join(root, 'no', 'parent')), false);
  // root 는 권한을 무시하므로 리눅스 /proc 처럼 늘 읽기 전용인 곳으로 본다
  if (process.platform === 'linux') assert.equal(writableDir('/proc/self'), false);
});
