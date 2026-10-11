import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { chooseDataDir, findDataDir, lockAlive, MOVED_MARKER, oldAppBlocks } from './data-move.ts';

const dirs: string[] = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
/** 앱 데이터 폴더 하나 (안에 jjakkung, fairy 를 만든다) */
function appData() {
  const dir = mkdtempSync(join(tmpdir(), 'jj-data-move-'));
  dirs.push(dir);
  return { root: dir, old: join(dir, 'jjakkung'), now: join(dir, 'fairy') };
}
/** 예전 폴더에 저장 파일, 설정, 펫 그림, 모델 하나씩 */
function seedOld(old: string) {
  mkdirSync(join(old, 'pets'), { recursive: true });
  mkdirSync(join(old, 'models'), { recursive: true });
  writeFileSync(join(old, 'jjakkung.db'), 'db-bytes');
  writeFileSync(join(old, 'jjakkung.db-wal'), 'wal-bytes');
  writeFileSync(join(old, 'settings.json'), '{"petName":"콩이"}');
  writeFileSync(join(old, 'pets', 'kong.png'), 'png');
  writeFileSync(join(old, 'models', 'big.gguf'), 'model');
}
const notRunning = () => false;
const AT = new Date('2026-10-11T00:00:00Z');

test('데이터 옮기기: 새로 설치면 새 폴더를 쓰고 아무것도 만들지 않는다', () => {
  const p = appData();
  const r = chooseDataDir(p.root, { inUse: notRunning });
  assert.deepEqual(r, { dir: p.now, move: { kind: 'none' } });
  assert.ok(!existsSync(p.old));
});

test('데이터 옮기기: 예전 폴더만 있으면 통째로 새 이름으로 옮기고, 예전 자리에는 안내 파일만 남긴다', () => {
  const p = appData();
  seedOld(p.old);
  const r = chooseDataDir(p.root, { inUse: notRunning, now: AT });
  assert.deepEqual(r, { dir: p.now, move: { kind: 'moved', from: p.old, to: p.now } });
  // 하나도 잃지 않는다 (저장 파일과 WAL, 설정, 그림, 모델)
  assert.equal(readFileSync(join(p.now, 'jjakkung.db'), 'utf8'), 'db-bytes');
  assert.equal(readFileSync(join(p.now, 'jjakkung.db-wal'), 'utf8'), 'wal-bytes');
  assert.equal(readFileSync(join(p.now, 'settings.json'), 'utf8'), '{"petName":"콩이"}');
  assert.equal(readFileSync(join(p.now, 'pets', 'kong.png'), 'utf8'), 'png');
  assert.equal(readFileSync(join(p.now, 'models', 'big.gguf'), 'utf8'), 'model');
  // 예전 자리: 안내 파일 하나, 데이터는 없다
  const note = readFileSync(join(p.old, MOVED_MARKER), 'utf8');
  assert.ok(note.includes(p.now) && note.includes('2026-10-11'));
  assert.ok(!existsSync(join(p.old, 'jjakkung.db')));
  // 다시 켜면 그대로 새 폴더 (안내 파일만 있는 예전 폴더는 다시 옮기지 않는다)
  assert.deepEqual(chooseDataDir(p.root, { inUse: notRunning }), { dir: p.now, move: { kind: 'none' } });
});

test('데이터 옮기기: 새 폴더에 무엇이든 있으면 새 폴더가 주인이다 (예전 폴더는 건드리지 않는다)', () => {
  const p = appData();
  seedOld(p.old);
  mkdirSync(p.now);
  writeFileSync(join(p.now, 'settings.json'), '{}');
  const r = chooseDataDir(p.root, { inUse: notRunning });
  assert.deepEqual(r, { dir: p.now, move: { kind: 'none' } });
  assert.equal(readFileSync(join(p.old, 'jjakkung.db'), 'utf8'), 'db-bytes');
  assert.ok(!existsSync(join(p.old, MOVED_MARKER)));
});

test('데이터 옮기기: 새 폴더가 비어 있기만 하면 치우고 옮긴다', () => {
  const p = appData();
  seedOld(p.old);
  mkdirSync(p.now);
  const r = chooseDataDir(p.root, { inUse: notRunning });
  assert.equal(r.move.kind, 'moved');
  assert.equal(readFileSync(join(p.now, 'jjakkung.db'), 'utf8'), 'db-bytes');
});

test('데이터 옮기기: 예전 폴더가 비었거나 데이터가 없으면 옮기지 않는다', () => {
  const p = appData();
  mkdirSync(join(p.old, 'logs'), { recursive: true });
  assert.deepEqual(chooseDataDir(p.root, { inUse: notRunning }), { dir: p.now, move: { kind: 'none' } });
  assert.ok(existsSync(join(p.old, 'logs')));
});

test('데이터 옮기기: 예전 앱이 떠 있으면 이번에는 예전 폴더를 그대로 쓴다', () => {
  const p = appData();
  seedOld(p.old);
  const r = chooseDataDir(p.root, { inUse: () => true });
  assert.deepEqual(r, { dir: p.old, move: { kind: 'in-use', dir: p.old } });
  assert.ok(!existsSync(p.now));
  assert.ok(existsSync(join(p.old, 'jjakkung.db')));
});

test('데이터 옮기기: 이름 바꾸기가 실패하면(윈도우에서 파일이 열림) 예전 폴더를 쓰고 아무것도 지우지 않는다', () => {
  const p = appData();
  seedOld(p.old);
  const r = chooseDataDir(p.root, {
    inUse: notRunning,
    rename: () => {
      throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' });
    },
  });
  assert.equal(r.dir, p.old);
  assert.equal(r.move.kind, 'failed');
  assert.ok(existsSync(join(p.old, 'jjakkung.db')));
  assert.ok(!existsSync(join(p.old, MOVED_MARKER)));
});

test('데이터 옮기기: 같이 켠 다른 페어리가 먼저 옮겼으면 새 폴더를 쓴다', () => {
  const p = appData();
  seedOld(p.old);
  const r = chooseDataDir(p.root, {
    inUse: notRunning,
    rename: () => {
      // 다른 쪽이 이미 옮기고 안내를 남겼다
      chooseDataDir(p.root, { inUse: notRunning });
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    },
  });
  assert.deepEqual(r, { dir: p.now, move: { kind: 'none' } });
  assert.equal(readFileSync(join(p.now, 'jjakkung.db'), 'utf8'), 'db-bytes');
});

test('하나만 띄우기 잠금: 살아 있는 pid 만 쓰는 중으로 본다', { skip: process.platform === 'win32' }, () => {
  const p = appData();
  mkdirSync(p.old);
  assert.equal(lockAlive(p.old), false);
  symlinkSync(`${hostname()}-${process.pid}`, join(p.old, 'SingletonLock'));
  assert.equal(lockAlive(p.old), true);
  assert.equal(
    lockAlive(p.old, () => false),
    false,
  );
  rmSync(join(p.old, 'SingletonLock'));
  symlinkSync('other-host-1234', join(p.old, 'SingletonLock'));
  assert.equal(
    lockAlive(p.old, () => false),
    true,
  );
});

test('MCP 서버 폴더: 새 앱을 아직 켜지 않았으면 예전 폴더를 읽고, 옮긴 뒤에는 새 폴더', () => {
  const p = appData();
  assert.equal(findDataDir(p.root), p.now);
  seedOld(p.old);
  assert.equal(findDataDir(p.root), p.old);
  chooseDataDir(p.root, { inUse: notRunning });
  assert.equal(findDataDir(p.root), p.now);
});

test('데이터 옮기기: 새 폴더에 크로미엄이 만든 것(Crashpad 등)만 있으면 옆으로 비켜 두고 옮긴다 (지우지 않는다)', () => {
  const p = appData();
  seedOld(p.old);
  mkdirSync(join(p.now, 'Crashpad', 'completed'), { recursive: true });
  writeFileSync(join(p.now, 'Crashpad', 'settings.dat'), 'crashpad');
  writeFileSync(join(p.now, 'Local State'), '{}');
  const r = chooseDataDir(p.root, { inUse: notRunning, now: AT });
  assert.equal(r.dir, p.now);
  assert.equal(r.move.kind, 'moved');
  const aside = r.move.kind === 'moved' ? r.move.aside : undefined;
  assert.equal(aside, join(p.root, 'fairy.pre-move-20261011T000000'));
  // 데이터는 새 폴더에, 비켜 둔 것도 그대로
  assert.equal(readFileSync(join(p.now, 'jjakkung.db'), 'utf8'), 'db-bytes');
  assert.equal(readFileSync(join(p.now, 'models', 'big.gguf'), 'utf8'), 'model');
  assert.equal(readFileSync(join(aside as string, 'Crashpad', 'settings.dat'), 'utf8'), 'crashpad');
  assert.ok(existsSync(join(aside as string, 'Local State')));
  assert.ok(existsSync(join(p.old, MOVED_MARKER)));
});

test('데이터 옮기기: 비켜 둔 뒤 옮기기가 실패하면 새 폴더를 제자리로 돌리고 예전 폴더를 쓴다', () => {
  const p = appData();
  seedOld(p.old);
  mkdirSync(join(p.now, 'Crashpad'), { recursive: true });
  const r = chooseDataDir(p.root, {
    inUse: notRunning,
    now: AT,
    rename: (a, b) => {
      if (a === p.old) throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' });
      renameSync(a, b);
    },
  });
  assert.equal(r.dir, p.old);
  assert.equal(r.move.kind, 'failed');
  assert.ok(existsSync(join(p.now, 'Crashpad')));
  assert.ok(!existsSync(join(p.root, 'fairy.pre-move-20261011T000000')));
  assert.ok(existsSync(join(p.old, 'jjakkung.db')));
});

test('데이터 옮기기: 새 폴더에 settings.json 이나 모르는 것이 있으면 Crashpad 가 있어도 건드리지 않는다', () => {
  for (const mine of ['settings.json', 'jjakkung.db', 'pets', 'something-else']) {
    const p = appData();
    seedOld(p.old);
    mkdirSync(join(p.now, 'Crashpad'), { recursive: true });
    if (mine === 'pets') mkdirSync(join(p.now, mine));
    else writeFileSync(join(p.now, mine), '{}');
    const r = chooseDataDir(p.root, { inUse: notRunning, now: AT });
    assert.deepEqual(r, { dir: p.now, move: { kind: 'none' } }, mine);
    assert.ok(existsSync(join(p.now, mine)), mine);
    assert.equal(readFileSync(join(p.old, 'jjakkung.db'), 'utf8'), 'db-bytes', mine);
    assert.ok(!existsSync(join(p.old, MOVED_MARKER)), mine);
  }
});

test('예전 앱이 막을 때만 알리고 끝낸다 (이미 떠 있는 페어리에 두 번째로 켠 것은 말없이)', () => {
  const p = appData();
  assert.equal(oldAppBlocks(false, { kind: 'in-use', dir: p.old }), true);
  assert.equal(oldAppBlocks(false, { kind: 'failed', dir: p.old, error: 'EBUSY' }), true);
  assert.equal(oldAppBlocks(false, { kind: 'none' }), false);
  assert.equal(oldAppBlocks(false, { kind: 'moved', from: p.old, to: p.now }), false);
  // 시험 실행(JJ_USER_DATA)은 옮기기를 보지 않는다
  assert.equal(oldAppBlocks(false, undefined), false);
  // 잠금을 잡았으면 예전 폴더로 그냥 켠다
  assert.equal(oldAppBlocks(true, { kind: 'in-use', dir: p.old }), false);
});
