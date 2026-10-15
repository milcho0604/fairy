import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { SecretCrypto } from './secret-file.ts';
import { sealedSecret } from './server-secret.ts';

/** 글자를 뒤집는 가짜 열쇠. key 를 바꾸면 예전 것을 못 푼다 */
function fakeCrypto(o: { available: boolean; key: string }): SecretCrypto {
  return {
    available: () => o.available,
    encrypt: (text) => Buffer.from(`${o.key}:${[...text].reverse().join('')}`),
    decrypt: (data) => {
      const s = data.toString();
      if (!s.startsWith(`${o.key}:`)) throw new Error('다른 열쇠');
      return [...s.slice(o.key.length + 1)].reverse().join('');
    },
  };
}

test('서버 토큰: 열쇠로 암호화해서만 쓰고, 열쇠가 없으면 쓰지 않는다 (평문 금지)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jj-sealed-'));
  try {
    const path = join(dir, 'server-device.json');
    const c = { available: true, key: 'k1' };
    const s = sealedSecret(path, () => fakeCrypto(c));
    s.set('fd_secret_token');
    assert.equal(s.get(), 'fd_secret_token');
    assert.ok(!readFileSync(path, 'utf8').includes('fd_secret_token'), '파일에 평문이 없다');
    assert.equal(s.unreadable(), false);
    // 열쇠가 바뀌면 못 푼다: 덮어쓰지 않게 unreadable
    c.key = 'k2';
    assert.equal(s.get(), undefined);
    assert.equal(s.unreadable(), true);
    // 열쇠를 못 쓰면 쓰기를 거절한다
    c.available = false;
    assert.throws(() => s.set('fd_other'));
    // 평문 파일은 읽지 않는다
    c.available = true;
    writeFileSync(path, JSON.stringify({ v: 2, plain: 'fd_plain' }));
    assert.equal(s.get(), undefined);
    assert.equal(s.unreadable(), true);
    s.set(null);
    assert.equal(s.unreadable(), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
