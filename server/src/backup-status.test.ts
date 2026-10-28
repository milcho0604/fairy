// 밖에서 도는 백업의 상태 파일: 읽는 쪽(admin-home.ts)과 쓰는 쪽(ops/backup-files/run.sh)이 같은 모양을 쓰는지 (#152).
// run.sh 는 시험용 폴더로 한 번만 돌려 본다(ONCE=1). rsync 나 gzip 이 없는 곳에서는 그 시험만 건너뛴다.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { BACKUP_STALE_MS, type BackupJob, backupJobOf, parseStatusLine, UNKNOWN_JOB } from './admin-home';
import { todoOf, todoText } from './admin-page';

const at = (ms: number) => String(Math.floor(ms / 1000));
const H = 3_600_000;

test('parseStatusLine: "초 탭 글" 만 받고 모양이 틀리면 null, 글은 200자로 자른다', () => {
  assert.deepEqual(parseStatusLine('1761600000\t덤프 4096바이트\n'), {
    at: 1_761_600_000_000,
    note: '덤프 4096바이트',
  });
  assert.deepEqual(parseStatusLine('1761600000\n'), { at: 1_761_600_000_000, note: '' });
  for (const bad of [undefined, '', 'garbage', '12\tx', '-1761600000\tx'])
    assert.equal(parseStatusLine(bad), null, String(bad));
  assert.equal(parseStatusLine(`1761600000\t${'가'.repeat(500)}`)?.note.length, 200);
  // 줄바꿈 뒤의 글은 읽지 않는다
  assert.equal(parseStatusLine('1761600000\tab\ncd')?.note, 'ab');
});

test('backupJobOf: 없음 unknown, 성공 ok, 마지막이 실패 failed, 26시간 넘게 성공 못 하면 stale', () => {
  const now = 1_761_700_000_000;
  assert.deepEqual(backupJobOf({}, now), UNKNOWN_JOB);
  assert.equal(backupJobOf({ ok: 'garbage', fail: '1\tx', checked: '' }, now).state, 'unknown');
  assert.equal(backupJobOf({ ok: `${at(now - H)}\t덤프` }, now).state, 'ok');
  // 경계: 26시간 딱이면 아직 ok, 1초 넘으면 stale
  assert.equal(backupJobOf({ ok: at(now - BACKUP_STALE_MS) }, now).state, 'ok');
  assert.equal(backupJobOf({ ok: at(now - BACKUP_STALE_MS - 1000) }, now).state, 'stale');
  // 성공 기록 없이 확인만 있으면 stale (돌긴 하는데 한 번도 성공 못 함)
  const only = backupJobOf({ checked: at(now) }, now);
  assert.equal(only.state, 'stale');
  assert.equal(only.lastOkAt, null);
  // 마지막 실패가 마지막 성공보다 뒤면 failed, 성공이 뒤거나 같은 초면 ok
  const failed = backupJobOf({ ok: at(now - 5 * H), fail: `${at(now - H)}\t압축 실패` }, now);
  assert.equal(failed.state, 'failed');
  assert.equal(failed.lastFailReason, '압축 실패');
  assert.equal(backupJobOf({ ok: at(now - H), fail: `${at(now - 5 * H)}\t옛 실패` }, now).state, 'ok');
  assert.equal(backupJobOf({ ok: at(now - H), fail: at(now - H) }, now).state, 'ok');
  // 까닭이 비면 대신 말을 단다
  assert.equal(backupJobOf({ fail: at(now) }, now).lastFailReason, '까닭을 남기지 않았어요');
});

test('todoOf: 밖 백업이 실패면 bad, 오래 성공 못 했으면 warn(시간), 정상과 unknown 은 카드가 없다', () => {
  const base = {
    reports: 0,
    costMicros: 0,
    budgetMicros: 1_000_000,
    events: [],
    coupons: [],
    now: 1_761_700_000_000,
  };
  const job = (state: BackupJob['state'], lastOkAt: number | null = null): BackupJob => ({
    ...UNKNOWN_JOB,
    state,
    lastOkAt,
  });
  assert.deepEqual(todoOf({ ...base, external: { db: job('ok', base.now), files: job('unknown') } }), []);
  const got = todoOf({
    ...base,
    external: { db: job('failed', base.now - 99), files: job('stale', base.now - 30 * H - 5) },
  });
  assert.deepEqual(
    got.map((t) => [t.kind, t.level, t.n]),
    [
      ['backup_db', 'bad', -1],
      ['backup_files', 'warn', 30],
    ],
  );
  assert.equal(todoText(got[0] as never), '데이터베이스 덤프 백업이 마지막에 실패했어요');
  assert.equal(todoText(got[1] as never), '백업 파일 외장 디스크 사본 백업이 30시간째 성공하지 못했어요');
  const never = todoOf({ ...base, external: { db: job('stale'), files: job('ok', base.now) } });
  assert.equal(todoText(never[0] as never), '데이터베이스 덤프 백업이 성공한 기록이 없어요');
});

// ---- run.sh ----

const RUN = join(__dirname, '..', '..', 'ops', 'backup-files', 'run.sh');
const have = (cmd: string) => spawnSync('which', [cmd]).status === 0;
const tools = have('rsync') && have('gzip');

interface Dirs {
  root: string;
  src: string;
  dst: string;
  dumps: string;
  status: string;
}
function dirs(): Dirs {
  const root = mkdtempSync(join(tmpdir(), 'fairy-runsh-'));
  const d = {
    root,
    src: join(root, 'src'),
    dst: join(root, 'dst', 'files'),
    dumps: join(root, 'dst', 'daily'),
    status: join(root, 'status'),
  };
  for (const p of [d.src, d.dumps]) mkdirSync(p, { recursive: true });
  writeFileSync(join(d.src, 'a.bin'), 'x');
  return d;
}
function gz(path: string, ageH = 0): void {
  writeFileSync(path, execFileSync('gzip', ['-c'], { input: 'select 1;\n' }));
  const t = new Date(Date.now() - ageH * H);
  utimesSync(path, t, t);
}
function run(d: Dirs, env: Record<string, string> = {}): string {
  const r = spawnSync('sh', [RUN], {
    env: {
      PATH: process.env.PATH,
      SRC: `${d.src}/`,
      DST: `${d.dst}/`,
      DUMP_DIR: d.dumps,
      STATUS: d.status,
      ONCE: '1',
      SYNC_ON_START: '1',
      FRESH_SEC: '0',
      ...env,
    },
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  return r.stderr;
}
const read = (d: Dirs, name: string): string | undefined => {
  try {
    return readFileSync(join(d.status, name), 'utf8');
  } catch {
    return undefined;
  }
};
const jobs = (d: Dirs) => ({
  db: backupJobOf(
    { ok: read(d, 'db.ok'), fail: read(d, 'db.fail'), checked: read(d, 'db.checked') },
    Date.now(),
  ),
  files: backupJobOf(
    { ok: read(d, 'files.ok'), fail: read(d, 'files.fail'), checked: read(d, 'files.checked') },
    Date.now(),
  ),
});

test('run.sh: 사본과 덤프가 정상이면 두 작업 모두 ok, 성공 시각과 설명이 서버가 읽는 모양이다', {
  skip: !tools,
}, () => {
  const d = dirs();
  try {
    gz(join(d.dumps, 'fairy-20261028-053000.sql.gz'), 2);
    run(d);
    const j = jobs(d);
    assert.equal(j.db.state, 'ok');
    assert.match(j.db.lastOkNote ?? '', /^fairy-20261028-053000\.sql\.gz \d+바이트$/);
    assert.ok(Math.abs((j.db.lastOkAt ?? 0) - (Date.now() - 2 * H)) < 60_000, '덤프 파일의 시각');
    assert.equal(j.files.state, 'ok');
    assert.equal(j.files.lastOkNote, '서버 백업 파일 1개 맞춤');
    assert.ok(Math.abs((j.files.lastOkAt ?? 0) - Date.now()) < 60_000, '맞추기가 끝난 시각');
    assert.ok(j.files.checkedAt !== null && j.db.checkedAt !== null);
    assert.equal(read(d, 'db.fail'), undefined);
    assert.equal(read(d, 'files.fail'), undefined);
    assert.equal(readFileSync(join(d.dst, 'a.bin'), 'utf8'), 'x', '사본이 실제로 생겼다');
    // 임시 파일이 남지 않는다
    assert.deepEqual(
      execFileSync('ls', ['-A', d.status], { encoding: 'utf8' })
        .split('\n')
        .filter((x) => x.startsWith('.')),
      [],
    );
  } finally {
    rmSync(d.root, { recursive: true, force: true });
  }
});

test('run.sh: 사본 맞추기가 실패하면 files.fail 에 까닭, 덤프가 없으면 db.fail', { skip: !tools }, () => {
  const d = dirs();
  try {
    rmSync(d.src, { recursive: true, force: true });
    rmSync(d.dumps, { recursive: true, force: true });
    run(d);
    const j = jobs(d);
    assert.equal(j.files.state, 'failed');
    assert.match(j.files.lastFailReason ?? '', /^rsync 종료 코드 \d+/);
    assert.equal(j.db.state, 'failed');
    assert.match(j.db.lastFailReason ?? '', /덤프 폴더가 없어요/);
    assert.equal(read(d, 'files.ok'), undefined, '성공 기록은 만들지 않는다');
    // 덤프 폴더만 만들어 두면 "하나도 없어요"
    mkdirSync(d.dumps, { recursive: true });
    run(d);
    assert.match(jobs(d).db.lastFailReason ?? '', /덤프 파일이 하나도 없어요/);
  } finally {
    rmSync(d.root, { recursive: true, force: true });
  }
});

test('run.sh: 깨진 덤프, 빈 덤프, 26시간 넘은 덤프는 실패이고 까닭이 다르다. 새 덤프가 오면 ok 로 돌아온다', {
  skip: !tools,
}, () => {
  const d = dirs();
  try {
    const f = join(d.dumps, 'fairy-1.sql.gz');
    writeFileSync(f, 'this is not gzip data at all, certainly');
    run(d, { SYNC_ON_START: '0' });
    assert.match(jobs(d).db.lastFailReason ?? '', /깨졌어요.*압축 검사 실패/);
    writeFileSync(f, '');
    run(d, { SYNC_ON_START: '0' });
    assert.match(jobs(d).db.lastFailReason ?? '', /비었어요/);
    gz(f, 30);
    run(d, { SYNC_ON_START: '0' });
    assert.match(jobs(d).db.lastFailReason ?? '', /30시간 전 것이에요/);
    assert.equal(jobs(d).db.state, 'failed');
    // 새 덤프: 성공 시각(파일 시각)이 마지막 실패보다 뒤라 ok
    gz(join(d.dumps, 'fairy-2.sql.gz'), 0.01);
    writeFileSync(join(d.status, 'db.fail'), `${at(Date.now() - H)}\t옛 실패\n`);
    run(d, { SYNC_ON_START: '0' });
    const j = jobs(d);
    assert.equal(j.db.state, 'ok');
    assert.match(j.db.lastOkNote ?? '', /^fairy-2\.sql\.gz/);
  } finally {
    rmSync(d.root, { recursive: true, force: true });
  }
});

test('run.sh: 켠 때 사본 성공 기록이 25시간 안이면 바로 맞추지 않고, 오래됐거나 없으면 바로 맞춘다', {
  skip: !tools,
}, () => {
  const d = dirs();
  try {
    gz(join(d.dumps, 'fairy-1.sql.gz'));
    mkdirSync(d.status, { recursive: true });
    writeFileSync(join(d.status, 'files.ok'), `${at(Date.now() - H)}\t지난번\n`);
    // 맞추는 시각(AT)을 하루 끝으로 밀어 오늘 몫이 아직 안 온 것으로 만든다
    run(d, { SYNC_ON_START: '0', SYNC_AT_UTC_SEC: '86399' });
    assert.equal(read(d, 'files.ok'), `${at(Date.now() - H)}\t지난번\n`, '건드리지 않았다');
    writeFileSync(join(d.status, 'files.ok'), `${at(Date.now() - 30 * H)}\t옛날\n`);
    run(d, { SYNC_ON_START: '0', SYNC_AT_UTC_SEC: '86399' });
    assert.match(read(d, 'files.ok') ?? '', /서버 백업 파일 1개 맞춤/);
  } finally {
    rmSync(d.root, { recursive: true, force: true });
  }
});

test('run.sh: 상태 폴더가 읽기 전용이거나 파일이어도 죽지 않고 사본은 한다 (경고만 stderr)', {
  skip: !tools,
}, () => {
  const d = dirs();
  try {
    mkdirSync(d.status);
    chmodSync(d.status, 0o555);
    const err = run(d);
    chmodSync(d.status, 0o755);
    assert.equal(readFileSync(join(d.dst, 'a.bin'), 'utf8'), 'x');
    if (process.getuid?.() !== 0) assert.match(err, /상태 파일을 못 써요/);
    rmSync(d.status, { recursive: true, force: true });
    writeFileSync(d.status, 'file');
    rmSync(d.dst, { recursive: true, force: true });
    const err2 = run(d);
    assert.equal(readFileSync(join(d.dst, 'a.bin'), 'utf8'), 'x', '상태 경로가 파일이어도 사본은 생긴다');
    assert.match(err2, /상태 폴더를 못 만들어요/);
  } finally {
    rmSync(d.root, { recursive: true, force: true });
  }
});

test('run.sh: 덤프 폴더에 끊어진 링크가 가장 새 것이어도 루프는 죽지 않는다', { skip: !tools }, () => {
  const d = dirs();
  try {
    symlinkSync(join(d.root, 'gone.sql.gz'), join(d.dumps, 'fairy-latest.sql.gz'));
    run(d, { SYNC_ON_START: '0' });
  } finally {
    rmSync(d.root, { recursive: true, force: true });
  }
});

test('run.sh: 2분 안에 바뀐 덤프(쓰는 중)는 건너뛰고 그다음 새 파일을 본다. 쓰는 중인 파일뿐이면 판단하지 않는다', {
  skip: !tools,
}, () => {
  const d = dirs();
  try {
    writeFileSync(join(d.dumps, 'fairy-new.sql.gz'), 'half written');
    gz(join(d.dumps, 'fairy-old.sql.gz'), 3);
    run(d, { SYNC_ON_START: '0', FRESH_SEC: '120' });
    const j = jobs(d);
    assert.equal(j.db.state, 'ok', '쓰는 중인 파일 때문에 거짓 실패가 나지 않는다');
    assert.match(j.db.lastOkNote ?? '', /^fairy-old\.sql\.gz/);
    rmSync(join(d.dumps, 'fairy-old.sql.gz'));
    rmSync(d.status, { recursive: true, force: true });
    run(d, { SYNC_ON_START: '0', FRESH_SEC: '120' });
    assert.equal(read(d, 'db.fail'), undefined);
    assert.equal(read(d, 'db.ok'), undefined);
  } finally {
    rmSync(d.root, { recursive: true, force: true });
  }
});

test('run.sh: 압축 검사가 시간 안에 안 끝나면 "점검 시간 초과" 로 기록하고 루프는 계속', {
  skip: !(tools && have('timeout')),
}, () => {
  const d = dirs();
  try {
    gz(join(d.dumps, 'fairy-1.sql.gz'), 3);
    const bin = join(d.root, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'gzip'), '#!/bin/sh\nsleep 5\n');
    chmodSync(join(bin, 'gzip'), 0o755);
    run(d, { SYNC_ON_START: '0', GZ_TIMEOUT: '1', PATH: `${bin}:${process.env.PATH}` });
    assert.match(jobs(d).db.lastFailReason ?? '', /점검 시간 초과/);
  } finally {
    rmSync(d.root, { recursive: true, force: true });
  }
});
