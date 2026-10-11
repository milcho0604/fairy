import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { copyKind, expiredCopies, listCopies, pruneCopies, removeCopy } from './keep-copies.ts';

const root = mkdtempSync(join(tmpdir(), 'jj-keep-'));
after(() => rmSync(root, { recursive: true, force: true }));
const DAY = 86_400_000;

test('이름으로 종류를 본다. 저장 파일, 설정 파일 자체는 아니다', () => {
  assert.equal(copyKind('before-import-20261011-0930'), 'beforeImport');
  assert.equal(copyKind('before-import-20261011-0930-2'), 'beforeImport');
  assert.equal(copyKind('jjakkung.db.bak-v7'), 'dbVersion');
  assert.equal(copyKind('jjakkung-broken-20261011-093000.db'), 'broken');
  assert.equal(copyKind('settings-broken-20261011-093000.json'), 'broken');
  assert.equal(copyKind('jjakkung.db'), undefined);
  assert.equal(copyKind('settings.json'), undefined);
  assert.equal(copyKind('jjakkung-broken-20261011-093000.db-wal'), undefined);
  assert.equal(copyKind('pets'), undefined);
});

test('종류마다 새것 3개와 30일 안의 것은 남긴다', () => {
  const now = Date.UTC(2026, 9, 11);
  const mk = (name: string, ageDays: number) => ({
    name,
    kind: 'beforeImport' as const,
    at: now - ageDays * DAY,
    bytes: 1,
  });
  const list = [mk('a', 100), mk('b', 90), mk('c', 80), mk('d', 70), mk('e', 10), mk('f', 40)];
  // 새것 순: e(10) f(40) d(70) c(80) b(90) a(100). 새것 3개 e f d, 나머지 c b a 는 30일이 지나 지운다
  assert.deepEqual(
    expiredCopies(list, now).map((c) => c.name),
    ['c', 'b', 'a'],
  );
  // 30일 안이면 4번째여도 남긴다
  assert.deepEqual(expiredCopies([mk('a', 1), mk('b', 2), mk('c', 3), mk('d', 4)], now), []);
});

test('켤 때 정리: 오래된 가져오기 전 복사, 깨진 저장 파일(-wal 포함)을 지운다', () => {
  const now = Date.now();
  const old = (now - 60 * DAY) / 1000;
  for (let i = 0; i < 5; i++) {
    const d = join(root, `before-import-2026010${i}-0000`);
    mkdirSync(d);
    writeFileSync(join(d, 'jjakkung.db'), 'x');
    utimesSync(d, old + i, old + i);
  }
  for (let i = 0; i < 4; i++) {
    const f = join(root, `jjakkung-broken-2026010${i}-000000.db`);
    writeFileSync(f, 'x');
    writeFileSync(`${f}-wal`, 'x');
    utimesSync(f, old + i, old + i);
  }
  writeFileSync(join(root, 'jjakkung.db'), 'keep');
  const gone = pruneCopies(root, now);
  assert.equal(gone.length, 3);
  assert.ok(!existsSync(join(root, 'before-import-20260100-0000')));
  assert.ok(existsSync(join(root, 'before-import-20260104-0000')));
  assert.ok(!existsSync(join(root, 'jjakkung-broken-20260100-000000.db-wal')));
  assert.ok(existsSync(join(root, 'jjakkung.db')));
  assert.equal(listCopies(root).length, 6);
});

test('모양이 다른 이름은 지우지 않는다', () => {
  assert.equal(removeCopy(root, 'jjakkung.db'), false);
  assert.equal(removeCopy(root, '../before-import-20260101-0000'), false);
  assert.ok(existsSync(join(root, 'jjakkung.db')));
});
