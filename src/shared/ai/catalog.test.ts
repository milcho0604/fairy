import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { DEFAULT_CATALOG, LOCAL_MAX_BYTES, parseCatalog, pickCli, pickLocal } from './catalog.ts';

const good = {
  id: 'tiny',
  label: 'Tiny',
  file: 'tiny-Q4_K_M.gguf',
  url: 'https://huggingface.co/x/y/resolve/main/tiny-Q4_K_M.gguf',
  sha256: 'a'.repeat(64),
  bytes: 300_000_000,
  license: 'Apache-2.0',
};

test('기본 목록은 검사를 통과하는 모양이다', () => {
  const parsed = parseCatalog({ ...DEFAULT_CATALOG });
  assert.ok(parsed);
  assert.equal(parsed.localDefault, DEFAULT_CATALOG.localDefault);
  assert.deepEqual(
    parsed.cli.claude?.filter((m) => !m.pinned).map((m) => m.id),
    ['opus', 'sonnet', 'haiku'],
  );
  assert.ok(parsed.cli.claude?.some((m) => m.pinned && m.id === 'claude-sonnet-5-5'));
});

test('받은 목록은 엄격하게: 받는 곳, 해시, 크기 상한, 파일 이름', () => {
  const one = (m: object) => parseCatalog({ version: 1, local: [m] });
  assert.ok(one(good));
  assert.equal(one({ ...good, url: 'http://huggingface.co/a.gguf' }), undefined);
  assert.equal(one({ ...good, url: 'https://evil.example/a.gguf' }), undefined);
  assert.equal(one({ ...good, sha256: 'xyz' }), undefined);
  assert.equal(one({ ...good, bytes: LOCAL_MAX_BYTES + 1 }), undefined);
  assert.equal(one({ ...good, file: '../../etc/passwd.gguf' }), undefined);
  assert.equal(one({ ...good, file: 'model.bin' }), undefined);
  assert.equal(parseCatalog({ version: 2, local: [good] }), undefined);
  assert.equal(parseCatalog('nope'), undefined);
});

test('CLI 모델 이름은 옵션처럼 보이면 버린다', () => {
  const c = parseCatalog({
    version: 1,
    local: [good],
    cli: {
      claude: [
        { id: '--dangerously', label: 'x' },
        { id: 'fable', label: '추가 요금 가능' },
        { id: 'best', label: '추가 요금 가능' },
        { id: 'sonnet', label: 'Sonnet' },
      ],
      'Bad!': [],
    },
  });
  assert.deepEqual(c?.cli, { claude: [{ id: 'sonnet', label: 'Sonnet' }] });
});

test('고른 모델이 목록에서 사라지면 기본으로', () => {
  const c = parseCatalog({ version: 1, local: [good, { ...good, id: 'big' }], localDefault: 'big' });
  assert.ok(c);
  assert.equal(pickLocal(c, 'gone').id, 'big');
  assert.equal(pickLocal(c, 'tiny').id, 'tiny');
  assert.equal(pickCli(DEFAULT_CATALOG, 'claude', 'opus'), 'opus');
  assert.equal(pickCli(DEFAULT_CATALOG, 'claude', 'claude-sonnet-5-5'), 'claude-sonnet-5-5');
  // 목록에 없는 이름은 쓰지 않는다 (사용자는 목록에서만 고른다)
  assert.equal(pickCli(DEFAULT_CATALOG, 'claude', 'gpt-9'), undefined);
  assert.equal(pickCli(DEFAULT_CATALOG, 'claude', ''), undefined);
  assert.equal(pickCli(DEFAULT_CATALOG, 'codex', 'opus'), undefined);
});

test('레포의 catalog/models.json 은 검사를 통과하고 앱 기본값과 같다 (새 판을 올릴 때 둘 다 고친다)', () => {
  const file = JSON.parse(readFileSync(new URL('../../../catalog/models.json', import.meta.url), 'utf8'));
  assert.deepEqual(parseCatalog(file), DEFAULT_CATALOG);
});
