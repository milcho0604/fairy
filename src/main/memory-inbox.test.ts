import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { drainInbox, writeInbox } from './memory-inbox.ts';

const fresh = () => mkdtempSync(join(tmpdir(), 'jj-inbox-'));

test('편지함 쓰기: 같은 것은 한 번, 임시 파일은 남기지 않는다', () => {
  const dir = fresh();
  try {
    assert.equal(writeInbox(dir, '커피 좋아함'), true);
    assert.equal(writeInbox(dir, '커피  좋아함'), false);
    assert.equal(writeInbox(dir, '아침엔 회의'), true);
    assert.deepEqual(JSON.parse(readFileSync(join(dir, 'memory-inbox.json'), 'utf8')), [
      '커피 좋아함',
      '아침엔 회의',
    ]);
    assert.deepEqual(
      readdirSync(dir).filter((n) => n.endsWith('.tmp')),
      [],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('편지함 비우기: 지난번에 읽다 남은 .taking 도 같이 읽고, 다 지운다', () => {
  const dir = fresh();
  try {
    // 예전 이름과 새 이름의 남은 파일, 그리고 지금 편지함
    writeFileSync(join(dir, 'memory-inbox.json.taking'), JSON.stringify(['남은 것 1']));
    writeFileSync(join(dir, 'memory-inbox.json.1-2-ab.taking'), JSON.stringify(['남은 것 2']));
    writeFileSync(join(dir, 'memory-inbox.json.9-9-zz.taking'), '{깨짐');
    writeInbox(dir, '새것');
    const got: unknown[] = [];
    assert.equal(
      drainInbox(dir, (v) => got.push(...(v as unknown[]))),
      3,
    );
    assert.deepEqual([...got].sort(), ['남은 것 1', '남은 것 2', '새것'].sort());
    assert.deepEqual(readdirSync(dir), []);
    // 비어 있으면 아무것도 안 한다
    assert.equal(
      drainInbox(dir, () => assert.fail('부르면 안 된다')),
      0,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('편지함 비우기: 옮기다 실패하면 .taking 을 남겨 다음에 다시 읽는다', () => {
  const dir = fresh();
  try {
    writeInbox(dir, '잃으면 안 됨');
    assert.throws(() =>
      drainInbox(dir, () => {
        throw new Error('설정 저장 실패');
      }),
    );
    const got: unknown[] = [];
    drainInbox(dir, (v) => got.push(...(v as unknown[])));
    assert.deepEqual(got, ['잃으면 안 됨']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
