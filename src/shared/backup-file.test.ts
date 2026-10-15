import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BACKUP_FORMAT,
  BACKUP_HEADER,
  BACKUP_LIMITS,
  backupDate,
  backupFileFromArgv,
  entryNameOk,
  isBackupFileName,
  makeHeader,
  parseBackupHeader,
} from './backup-file.ts';

const TOP = ['jjakkung.db', 'settings.json'];
const SHA = 'a'.repeat(64);

test('항목 경로: 맨 위는 아는 이름만, 그 밖은 pets/ 아래만', () => {
  for (const ok of [
    'jjakkung.db',
    'settings.json',
    BACKUP_HEADER,
    'pets/pet-1.png',
    'pets/sub/model.json',
    'pets/페어리 그림.png',
  ])
    assert.equal(entryNameOk(ok, TOP), true, ok);
  for (const bad of [
    '',
    '../jjakkung.db',
    'pets/../../x',
    'pets/./a.png',
    '/etc/passwd',
    'C:/x',
    'pets\\a.png',
    'pets//a.png',
    'pets/',
    'pets/.hidden',
    'other/a.png',
    'ai-custom.json',
    'unknown.json',
    'pets/a\u0000.png',
    'pets/a\n.png',
    `pets/${'a'.repeat(BACKUP_LIMITS.nameLength)}`,
  ])
    assert.equal(entryNameOk(bad, TOP), false, JSON.stringify(bad));
});

test('머리 파일: 모양이 맞으면 받고, 더 새 판은 newer, 그 밖은 bad', () => {
  const h = makeHeader('0.4.3', 1_760_000_000_000, [{ path: 'jjakkung.db', size: 10, sha256: SHA }]);
  const ok = parseBackupHeader(JSON.parse(JSON.stringify(h)));
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.ok && ok.header, h);
  assert.deepEqual(parseBackupHeader({ ...h, version: BACKUP_FORMAT + 1, entries: 'what' }), {
    ok: false,
    reason: 'newer',
  });
  for (const bad of [
    null,
    'x',
    [],
    { ...h, format: 'zip' },
    { ...h, version: 0 },
    { ...h, version: 1.5 },
    { ...h, version: '1' },
    { ...h, entries: undefined },
    { ...h, entries: [{ path: 'a', size: -1, sha256: SHA }] },
    { ...h, entries: [{ path: 'a', size: 1, sha256: 'xyz' }] },
    { ...h, entries: [{ path: 3, size: 1, sha256: SHA }] },
    {
      ...h,
      entries: Array.from({ length: BACKUP_LIMITS.entries }, () => ({ path: 'a', size: 1, sha256: SHA })),
    },
  ])
    assert.deepEqual(parseBackupHeader(bad), { ok: false, reason: 'bad' }, JSON.stringify(bad)?.slice(0, 80));
  // 앱 판과 만든 때는 보여 주기만 해서 이상하면 비운다
  const odd = parseBackupHeader({ ...h, app: 5, at: -3 });
  assert.equal(odd.ok && odd.header.app, '');
  assert.equal(odd.ok && odd.header.at, 0);
});

test('파일 이름: 날짜, 확장자(대소문자 무시), 명령줄에서 백업 파일 찾기', () => {
  assert.equal(backupDate(new Date(2026, 9, 5, 23, 59)), '2026-10-05');
  assert.equal(isBackupFileName('/x/페어리 백업 2026-10-15.fairybackup'), true);
  assert.equal(isBackupFileName('C:\\x\\B.FAIRYBACKUP'), true);
  assert.equal(isBackupFileName('pet.fairy'), false);
  assert.equal(isBackupFileName('a.fairybackup.zip'), false);
  assert.equal(backupFileFromArgv(['fairy', '--flag', '/x/a.fairybackup']), '/x/a.fairybackup');
  // 첫 인자(실행 파일)와 스위치는 보지 않는다
  assert.equal(backupFileFromArgv(['/x/a.fairybackup']), undefined);
  assert.equal(backupFileFromArgv(['fairy', '--x=a.fairybackup']), undefined);
  assert.equal(backupFileFromArgv(['fairy', 'pet.fairy']), undefined);
});
