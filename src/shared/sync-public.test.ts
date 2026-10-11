// scripts/sync-public.mjs (공개 레포 내용 만들기) 시험. 스크립트를 실제로 돌려 본다
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { PUBLIC_REPO, SOURCE_REPO } from './update-policy.ts';

const script = fileURLToPath(new URL('../../scripts/sync-public.mjs', import.meta.url));
const run = (...args: string[]) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });

function put(root: string, files: Record<string, string>) {
  for (const [p, body] of Object.entries(files)) {
    const f = join(root, p);
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, body);
  }
}

const SOURCE = {
  'public-repo/README.md': 'readme',
  'public-repo/SECURITY.md': 'security',
  'public-repo/LICENSE': 'mit',
  'public-repo/.github/ISSUE_TEMPLATE/config.yml': 'blank_issues_enabled: true',
  'gallery/index.json': '{}',
  'gallery/pets/milk.jjpet': 'pet',
  'gallery/.DS_Store': 'junk',
  'catalog/models.json': '{}',
  'src/secret.ts': 'not public',
};

test('공개 레포 내용을 만들고, .git 은 두고 옛 파일은 지운다', (t) => {
  const tmp = mkdtempSync(join(tmpdir(), 'sync-public-'));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  const src = join(tmp, 'source');
  const out = join(tmp, 'public');
  put(src, SOURCE);
  put(out, { '.git/HEAD': 'ref: refs/heads/main', 'old.txt': 'stale', 'gallery/pets/gone.jjpet': 'stale' });

  const r = run(out, '--from', src);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.stdout.trim().split('\n'), [
    '.github/ISSUE_TEMPLATE/config.yml',
    'LICENSE',
    'README.md',
    'SECURITY.md',
    'catalog/models.json',
    'gallery/index.json',
    'gallery/pets/milk.jjpet',
  ]);
  assert.equal(readFileSync(join(out, '.git/HEAD'), 'utf8'), 'ref: refs/heads/main');
  assert.equal(readFileSync(join(out, 'gallery/pets/milk.jjpet'), 'utf8'), 'pet');
  for (const gone of ['old.txt', 'gallery/pets/gone.jjpet', 'gallery/.DS_Store', 'src', 'public-repo'])
    assert.equal(existsSync(join(out, gone)), false, gone);

  // 다시 돌려도 같다
  assert.equal(run(out, '--from', src).stdout, r.stdout);
});

test('지우면 안 되는 곳에는 쓰지 않는다', (t) => {
  const tmp = mkdtempSync(join(tmpdir(), 'sync-public-'));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  const src = join(tmp, 'source');
  put(src, SOURCE);
  // git 체크아웃이 아닌, 비지 않은 폴더
  put(join(tmp, 'docs'), { 'keep.txt': 'mine' });
  assert.equal(run(join(tmp, 'docs'), '--from', src).status, 1);
  assert.equal(readFileSync(join(tmp, 'docs/keep.txt'), 'utf8'), 'mine');
  // 소스 레포 안, 소스 레포를 품은 폴더
  assert.equal(run(join(src, 'out'), '--from', src).status, 1);
  assert.equal(run(tmp, '--from', src).status, 1);
  assert.ok(existsSync(join(src, 'src/secret.ts')));
});

test('꼭 있어야 할 파일이 없거나 워크플로가 끼면 멈춘다', (t) => {
  const tmp = mkdtempSync(join(tmpdir(), 'sync-public-'));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  const src = join(tmp, 'source');
  put(src, { ...SOURCE, 'public-repo/.github/workflows/x.yml': 'on: push' });
  const r = run(join(tmp, 'out'), '--from', src);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /워크플로/);
  rmSync(join(src, 'public-repo/.github/workflows'), { recursive: true });
  rmSync(join(src, 'catalog/models.json'));
  assert.match(run(join(tmp, 'out'), '--from', src).stderr, /catalog\/models\.json/);
});

test('이 레포의 공개 레포 내용: 필요한 파일이 있고 소스 레포를 가리키지 않는다', (t) => {
  const tmp = mkdtempSync(join(tmpdir(), 'sync-public-'));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  const out = join(tmp, 'public');
  const files = execFileSync(process.execPath, [script, out], { encoding: 'utf8' }).trim().split('\n');
  for (const f of [
    'README.md',
    'SECURITY.md',
    'LICENSE',
    '.github/ISSUE_TEMPLATE/bug_report.yml',
    '.github/ISSUE_TEMPLATE/feature_request.yml',
    '.github/ISSUE_TEMPLATE/config.yml',
    'gallery/index.json',
    'catalog/models.json',
  ])
    assert.ok(files.includes(f), f);
  const source = new RegExp(`${SOURCE_REPO.owner}/${SOURCE_REPO.repo}(?![\\w-])`);
  for (const f of files.filter((p) => /\.(md|yml)$/.test(p) || p === 'LICENSE')) {
    const text = readFileSync(join(out, f), 'utf8');
    assert.doesNotMatch(text, source, `${f} 가 소스 레포를 가리킨다 (비공개가 되면 깨진다)`);
  }
  const readme = readFileSync(join(out, 'README.md'), 'utf8');
  assert.ok(readme.includes(`github.com/${PUBLIC_REPO.owner}/${PUBLIC_REPO.repo}/releases`));
  assert.ok(readme.indexOf('## English') > readme.indexOf('## 받기'), '한국어 먼저');
  assert.equal(
    readFileSync(join(out, 'LICENSE'), 'utf8'),
    readFileSync(new URL('../../LICENSE', import.meta.url), 'utf8'),
  );
});
