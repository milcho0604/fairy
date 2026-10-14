import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { crc32, deflateRawSync } from 'node:zlib';
import { BACKUP_FORMAT, BACKUP_HEADER, BACKUP_LIMITS, makeHeader } from '../shared/backup-file.ts';
import { BackupReadError, extractBackupZip, writeBackupZip } from './backup-zip.ts';

const TOP = ['jjakkung.db', 'settings.json', 'grow.json'];

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'fairy-backup-zip-'));
}

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

/** 시험용 zip 만들기: 이름과 내용을 그대로 (검사를 거치지 않은 남이 만든 파일 흉내) */
function rawZip(entries: { name: string; data: Buffer; deflate?: boolean; usize?: number }[]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const body = e.deflate ? deflateRawSync(e.data) : e.data;
    const name = Buffer.from(e.name, 'utf8');
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(0x0800, 6);
    head.writeUInt16LE(e.deflate ? 8 : 0, 8);
    head.writeUInt32LE(crc32(e.data) >>> 0, 14);
    head.writeUInt32LE(body.length, 18);
    head.writeUInt32LE(e.usize ?? e.data.length, 22);
    head.writeUInt16LE(name.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(e.deflate ? 8 : 0, 10);
    c.writeUInt32LE(crc32(e.data) >>> 0, 16);
    c.writeUInt32LE(body.length, 20);
    c.writeUInt32LE(e.usize ?? e.data.length, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(offset, 42);
    parts.push(head, name, body);
    central.push(c, name);
    offset += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}

/** 머리 파일까지 맞춘 zip (경로나 판만 바꿔 보는 시험) */
function zipWithHeader(files: { name: string; data: Buffer }[], over: Record<string, unknown> = {}): Buffer {
  const header = {
    ...makeHeader(
      '0.4.3',
      Date.now(),
      files.map((f) => ({ path: f.name, size: f.data.length, sha256: sha(f.data) })),
    ),
    ...over,
  };
  return rawZip([...files, { name: BACKUP_HEADER, data: Buffer.from(JSON.stringify(header)) }]);
}

async function reason(file: string, out: string): Promise<string> {
  try {
    await extractBackupZip(file, out, TOP);
    return 'ok';
  } catch (err) {
    assert.ok(err instanceof BackupReadError, String(err));
    return err.reason;
  }
}

/** 원본 폴더에서 시험 백업 파일을 만든다 */
async function makeBackup(root: string) {
  const src = join(root, 'src');
  mkdirSync(join(src, 'pets', 'sub'), { recursive: true });
  const files = {
    'jjakkung.db': randomBytes(300_000),
    'settings.json': Buffer.from(JSON.stringify({ petName: '밀크', lang: 'ko' })),
    'grow.json': Buffer.from('{}'),
    // 큰 펫 그림 (누르지 않고 그대로 넣는다)
    'pets/pet-1.png': randomBytes(3 * 1024 * 1024),
    'pets/sub/model.json': Buffer.from(JSON.stringify({ parts: Array(2000).fill({ a: 1 }) })),
    'pets/빈 파일.json': Buffer.alloc(0),
  };
  for (const [name, data] of Object.entries(files)) writeFileSync(join(src, name), data);
  const target = join(root, '페어리 백업 2026-10-15.fairybackup');
  const header = await writeBackupZip(
    target,
    Object.keys(files).map((name) => ({ name, path: join(src, name) })),
    { app: '0.4.3', at: 1_760_000_000_000 },
  );
  return { files, target, header };
}

test('왕복: 만들고 빈 폴더에 풀면 항목과 바이트가 같다', async () => {
  const root = tmp();
  try {
    const { files, target, header } = await makeBackup(root);
    assert.equal(header.version, BACKUP_FORMAT);
    assert.equal(header.entries.length, Object.keys(files).length);
    // 임시 .part 파일이 남지 않는다
    assert.deepEqual(
      readdirSync(root).filter((f) => f.endsWith('.part')),
      [],
    );
    const out = join(root, 'out');
    mkdirSync(out);
    const got = await extractBackupZip(target, out, TOP);
    assert.deepEqual(got, header);
    for (const [name, data] of Object.entries(files))
      assert.ok(readFileSync(join(out, name)).equals(data), name);
    // 머리 파일은 검사에만 쓰고 풀지 않는다
    assert.equal(existsSync(join(out, BACKUP_HEADER)), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('보통 zip 이라 운영체제 압축 풀기 도구로도 검사가 된다', async (t) => {
  if (!existsSync('/usr/bin/unzip')) return t.skip('unzip 없음');
  const root = tmp();
  try {
    const { target } = await makeBackup(root);
    const r = spawnSync('/usr/bin/unzip', ['-t', target], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('같은 파일을 두 번 풀어도 같다 (읽기만 한다)', async () => {
  const root = tmp();
  try {
    const { target } = await makeBackup(root);
    const before = readFileSync(target);
    for (const n of [1, 2]) {
      const out = join(root, `out${n}`);
      mkdirSync(out);
      assert.equal(await reason(target, out), 'ok');
    }
    assert.ok(readFileSync(target).equals(before));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('만들다 실패하면(원본이 사라짐) 그 이름의 파일도 임시 파일도 남지 않는다', async () => {
  const root = tmp();
  try {
    const good = join(root, 'a.json');
    writeFileSync(good, '{}');
    const target = join(root, 'x.fairybackup');
    await assert.rejects(
      writeBackupZip(
        target,
        [
          { name: 'settings.json', path: good },
          { name: 'grow.json', path: join(root, 'none.json') },
        ],
        { app: '0', at: Date.now() },
      ),
    );
    assert.deepEqual(readdirSync(root), ['a.json']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('믿지 않는 입력: 백업이 아닌 것, 더 새 판, 경로, 수, 크기, 깨짐을 모두 거른다', async () => {
  const root = tmp();
  try {
    const db = { name: 'jjakkung.db', data: randomBytes(1000) };
    const cases: [string, Buffer, string][] = [
      ['zip 아님', randomBytes(5000), 'notBackup'],
      ['너무 작음', Buffer.from('PK'), 'notBackup'],
      ['머리 파일 없음', rawZip([db]), 'notBackup'],
      ['머리 파일이 JSON 아님', rawZip([db, { name: BACKUP_HEADER, data: Buffer.from('{') }]), 'notBackup'],
      ['다른 형식', zipWithHeader([db], { format: 'other' }), 'notBackup'],
      ['더 새 판', zipWithHeader([db], { version: BACKUP_FORMAT + 1 }), 'newer'],
      ['.. 경로', zipWithHeader([db, { name: '../evil.json', data: Buffer.from('x') }]), 'unsafe'],
      ['pets 안 ..', zipWithHeader([db, { name: 'pets/../../evil', data: Buffer.from('x') }]), 'unsafe'],
      ['절대 경로', zipWithHeader([db, { name: '/tmp/evil', data: Buffer.from('x') }]), 'unsafe'],
      ['역슬래시', zipWithHeader([db, { name: 'pets\\..\\evil', data: Buffer.from('x') }]), 'unsafe'],
      [
        '모르는 맨 위 파일',
        zipWithHeader([db, { name: 'ai-custom.json', data: Buffer.from('[]') }]),
        'unsafe',
      ],
      ['폴더 항목', zipWithHeader([db, { name: 'pets/', data: Buffer.alloc(0) }]), 'unsafe'],
      [
        '같은 이름 두 번 (대소문자만 다름)',
        zipWithHeader([
          db,
          { name: 'pets/A.png', data: Buffer.from('1') },
          { name: 'pets/a.png', data: Buffer.from('2') },
        ]),
        'unsafe',
      ],
      [
        'sha256 다름',
        zipWithHeader([db], { entries: [{ path: db.name, size: 1000, sha256: 'b'.repeat(64) }] }),
        'damaged',
      ],
      ['목록에 없는 항목', zipWithHeader([db], { entries: [] }), 'damaged'],
      [
        '목록 크기 다름',
        zipWithHeader([db], { entries: [{ path: db.name, size: 999, sha256: sha(db.data) }] }),
        'damaged',
      ],
    ];
    for (const [label, data, want] of cases) {
      const f = join(root, `${label}.fairybackup`);
      writeFileSync(f, data);
      const out = join(root, `out-${label}`);
      mkdirSync(out);
      assert.equal(await reason(f, out), want, label);
      // 거른 것은 머리 파일 밖으로 하나도 쓰지 않는다 (경로 시험)
      assert.equal(existsSync(join(root, 'evil.json')), false, label);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('깨진 파일: 바이트 하나가 바뀌거나 잘리면 damaged', async () => {
  const root = tmp();
  try {
    const { target } = await makeBackup(root);
    const good = readFileSync(target);
    // 저장 파일 본문 한가운데 (crc32 가 다르다)
    const flipped = Buffer.from(good);
    flipped[1000] = (flipped[1000] ?? 0) ^ 0xff;
    writeFileSync(join(root, 'flip.fairybackup'), flipped);
    mkdirSync(join(root, 'o1'));
    assert.equal(await reason(join(root, 'flip.fairybackup'), join(root, 'o1')), 'damaged');
    // 앞이 잘림: 끝 레코드는 있지만 가리키는 자리가 어긋난다
    writeFileSync(join(root, 'cut.fairybackup'), good.subarray(5000));
    mkdirSync(join(root, 'o2'));
    assert.notEqual(await reason(join(root, 'cut.fairybackup'), join(root, 'o2')), 'ok');
    // 뒤가 잘림 (받다 끊김): 끝 레코드가 없다
    writeFileSync(join(root, 'tail.fairybackup'), good.subarray(0, good.length - 30));
    mkdirSync(join(root, 'o3'));
    assert.equal(await reason(join(root, 'tail.fairybackup'), join(root, 'o3')), 'notBackup');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('zip 폭탄: 적힌 크기보다 크게 풀리면 멈추고, 합이 상한을 넘으면 풀기 전에 거른다', async () => {
  const root = tmp();
  try {
    const big = Buffer.alloc(5 * 1024 * 1024);
    const header = makeHeader('0', Date.now(), [{ path: 'jjakkung.db', size: 100, sha256: sha(big) }]);
    const bomb = rawZip([
      { name: 'jjakkung.db', data: big, deflate: true, usize: 100 },
      { name: BACKUP_HEADER, data: Buffer.from(JSON.stringify(header)) },
    ]);
    writeFileSync(join(root, 'bomb.fairybackup'), bomb);
    mkdirSync(join(root, 'o1'));
    assert.equal(await reason(join(root, 'bomb.fairybackup'), join(root, 'o1')), 'damaged');
    // 가운데 목록의 풀린 크기를 상한보다 크게 적는다
    const { target } = await makeBackup(root);
    const z = Buffer.from(readFileSync(target));
    const cd = z.readUInt32LE(z.length - 6);
    z.writeUInt32LE(BACKUP_LIMITS.totalBytes + 1, cd + 24);
    writeFileSync(join(root, 'huge.fairybackup'), z);
    mkdirSync(join(root, 'o2'));
    assert.equal(await reason(join(root, 'huge.fairybackup'), join(root, 'o2')), 'tooBig');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('항목이 너무 많으면 풀기 전에 거른다', async () => {
  const root = tmp();
  try {
    const many = Array.from({ length: BACKUP_LIMITS.entries + 1 }, (_, i) => ({
      name: `pets/${i}.json`,
      data: Buffer.from('1'),
    }));
    writeFileSync(join(root, 'many.fairybackup'), rawZip(many));
    mkdirSync(join(root, 'o'));
    assert.equal(await reason(join(root, 'many.fairybackup'), join(root, 'o')), 'tooBig');
    assert.deepEqual(readdirSync(join(root, 'o')), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('파일이 아닌 것(폴더)과 없는 파일은 백업이 아니다', async () => {
  const root = tmp();
  try {
    mkdirSync(join(root, 'o'));
    assert.equal(await reason(root, join(root, 'o')), 'notBackup');
    assert.equal(await reason(join(root, 'none.fairybackup'), join(root, 'o')), 'notBackup');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
