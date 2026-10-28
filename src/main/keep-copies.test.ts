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
    utimesSync(d, old + i * 10 * 86_400, old + i * 10 * 86_400);
  }
  for (let i = 0; i < 4; i++) {
    const f = join(root, `jjakkung-broken-2026010${i}-000000.db`);
    writeFileSync(f, 'x');
    writeFileSync(`${f}-wal`, 'x');
    utimesSync(f, old + i * 10 * 86_400, old + i * 10 * 86_400);
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

test('시계가 앞으로 튀어도(몇 해 뒤) 새것 3개와, 그 종류의 가장 새 복사본에서 7일 안인 것은 남긴다 (버그잡이 4)', () => {
  const real = Date.UTC(2026, 9, 11);
  const mk = (name: string, ageDays: number) => ({
    name,
    kind: 'broken' as const,
    at: real - ageDays * DAY,
    bytes: 1,
  });
  const list = [mk('a', 0), mk('b', 1), mk('c', 2), mk('d', 3), mk('e', 6), mk('f', 20)];
  // 시계가 4년 앞으로: 예전에는 새것 3개 밖(d, e, f)을 모두 지웠다. 가장 새것(a)에서 7일 안인 d, e 는 남긴다
  assert.deepEqual(
    expiredCopies(list, real + 4 * 365 * DAY).map((c) => c.name),
    ['f'],
  );
  // 보통 시계에서는 30일 규칙 그대로 (모두 30일 안)
  assert.deepEqual(expiredCopies(list, real), []);
});

test('가져오기 전 복사본은 새것 5개만 두고 30일을 기다리지 않는다', () => {
  const now = Date.now();
  const list = Array.from({ length: 9 }, (_, i) => ({
    name: `before-import-2026102${i}-0000`,
    kind: 'beforeImport' as const,
    at: now - i * 2 * 86_400_000,
    bytes: 1,
  }));
  // 가장 새것에서 7일 안인 것(0~3번)은 시계가 튄 경우를 위해 남고, 5개 밖이면서 7일 넘은 것(5~8번)만 지운다
  assert.deepEqual(
    expiredCopies(list, now).map((c) => c.name),
    list.slice(5).map((c) => c.name),
  );
  assert.deepEqual(expiredCopies(list.slice(0, 5), now), []);
});
