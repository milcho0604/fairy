import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { type SecretCrypto, secretFile } from './secret-file.ts';

const root = mkdtempSync(join(tmpdir(), 'jj-secret-'));
after(() => rmSync(root, { recursive: true, force: true }));

/** 시험용 "암호화": 글자를 뒤집는다 */
const fake = (on: boolean): SecretCrypto => ({
  available: () => on,
  encrypt: (s) => Buffer.from(`enc:${[...s].reverse().join('')}`),
  decrypt: (b) => {
    const s = b.toString();
    if (!s.startsWith('enc:')) throw new Error('bad');
    return [...s.slice(4)].reverse().join('');
  },
});

test('암호화할 수 있으면 파일에 평문이 남지 않는다', () => {
  const f = join(root, 'hf-token.json');
  const s = secretFile(f, 'token', () => fake(true));
  s.write('hf_secretvalue');
  assert.ok(!readFileSync(f, 'utf8').includes('hf_secretvalue'));
  assert.equal(s.read(), 'hf_secretvalue');
});

test('옛 평문 파일을 읽으면 암호화해 다시 쓴다', () => {
  const f = join(root, 'google-token.json');
  writeFileSync(f, JSON.stringify({ refreshToken: '1//abc' }));
  const s = secretFile(f, 'refreshToken', () => fake(true));
  assert.equal(s.read(), '1//abc');
  const raw = JSON.parse(readFileSync(f, 'utf8'));
  assert.equal(raw.enc, 'os');
  assert.ok(!readFileSync(f, 'utf8').includes('1//abc'));
  assert.equal(s.read(), '1//abc');
});

test('열쇠고리가 없으면(리눅스 basic_text) 평문으로 두고 그대로 읽는다', () => {
  const f = join(root, 'plain.json');
  const s = secretFile(f, 'token', () => fake(false));
  s.write('hf_x');
  assert.equal(JSON.parse(readFileSync(f, 'utf8')).plain, 'hf_x');
  assert.equal(s.read(), 'hf_x');
});

test('풀지 못하면(다른 컴퓨터) 없는 것으로 본다. 파일은 지우지 않는다', () => {
  const f = join(root, 'moved.json');
  writeFileSync(f, JSON.stringify({ v: 2, enc: 'os', data: Buffer.from('garbage').toString('base64') }));
  const s = secretFile(f, 'token', () => fake(true));
  assert.equal(s.read(), undefined);
  assert.ok(readFileSync(f, 'utf8').length > 0);
  s.remove();
  assert.equal(s.read(), undefined);
});

test('열쇠가 바뀌어 못 푸는 것만 unreadable (없음, 평문, 열쇠를 잠깐 못 씀은 아니다)', () => {
  const f = join(root, 'renamed.json');
  const s = secretFile(f, 'refreshToken', () => fake(true));
  assert.equal(s.unreadable(), false); // 파일 없음
  s.write('1//token');
  assert.equal(s.unreadable(), false); // 지금 열쇠로 풀린다
  // 앱 이름이 바뀌어 다른 열쇠로 암호화된 것처럼
  writeFileSync(f, JSON.stringify({ v: 2, enc: 'os', data: Buffer.from('other-key').toString('base64') }));
  assert.equal(s.unreadable(), true);
  // 열쇠를 지금 못 쓰면(리눅스 열쇠고리 잠김) 바뀐 것인지 모른다: 그대로 둔다
  assert.equal(secretFile(f, 'refreshToken', () => fake(false)).unreadable(), false);
  // 평문 파일은 늘 읽힌다
  secretFile(f, 'refreshToken', () => fake(false)).write('1//plain');
  assert.equal(s.unreadable(), false);
});
