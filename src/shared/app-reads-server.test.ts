// scripts/ci/app-reads-server.mjs (앱 시험이 글로 읽는 server/ 파일 찾기) 시험.
// check.yml 의 changes 작업이 이 목록으로 "서버만 바뀐 PR" 의 앱 검사를 건너뛸지 정한다 (#251 뒤 admin-web.test.ts 가 깨졌는데 CI 가 못 잡았다)
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../../scripts/ci/app-reads-server.mjs', import.meta.url));
const REPO = fileURLToPath(new URL('../../', import.meta.url));

type Result = {
  files: string[];
  byTest: Record<string, string[]>;
  unresolved: { test: string; why: string }[];
};
function scan(root: string) {
  const r = spawnSync(process.execPath, [script, '--root', root, '--json'], { encoding: 'utf8' });
  return { code: r.status, out: JSON.parse(r.stdout) as Result };
}

function fixture(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'app-reads-'));
  for (const [p, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), body);
  }
  return root;
}

function withFixture(files: Record<string, string>, fn: (root: string) => void) {
  const root = fixture(files);
  try {
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const SERVER = { 'server/src/a.ts': 'x', 'server/src/b.ts': 'y', 'server/test/t.test.ts': 'z' };

test('지금 레포: admin-web.test.ts 가 읽는 server/src/admin-page.ts 를 찾고, 못 푼 것이 없다', () => {
  const { code, out } = scan(REPO);
  assert.equal(code, 0, JSON.stringify(out.unresolved));
  assert.deepEqual(out.unresolved, []);
  assert.ok(out.files.includes('server/src/admin-page.ts'));
  assert.deepEqual(out.byTest['src/shared/admin-web.test.ts'], ['server/src/admin-page.ts']);
});

test('지금 레포: test-leftovers.test.ts 가 폴더째 읽는 server/test 도 찾는다', () => {
  const { out } = scan(REPO);
  assert.ok(out.byTest['src/main/test-leftovers.test.ts']?.some((f) => f.startsWith('server/test/')));
});

test('안전: 파일을 읽으면서 server 경로 글자를 쓰는 src 시험은 모두 찾은 것이거나 못 푼 것으로 보고된다', () => {
  const { out } = scan(REPO);
  const reported = new Set([...Object.keys(out.byTest), ...out.unresolved.map((u) => u.test)]);
  const tests = (readdirSync(join(REPO, 'src'), { recursive: true, encoding: 'utf8' }) as string[]).filter(
    (f) => f.endsWith('.test.ts'),
  );
  const reads =
    /readFileSync|readdirSync|readFile\b|readdir\b|existsSync|statSync|import\.meta\.(dirname|url)/;
  const serverPath = /['"`]server['"`]|['"`/\\]server[/\\]/;
  let checked = 0;
  for (const raw of tests) {
    // 윈도우의 readdirSync 는 \ 로 이어 준다
    const f = raw.split('\\').join('/');
    const text = readFileSync(join(REPO, 'src', f), 'utf8');
    if (f === 'shared/app-reads-server.test.ts') continue;
    if (!reads.test(text) || !serverPath.test(text)) continue;
    checked++;
    assert.ok(reported.has(`src/${f}`), `${f}: 서버 경로를 쓰는데 app-reads-server.mjs 가 못 잡았다`);
  }
  assert.ok(checked >= 2, `server 경로를 쓰는 시험 ${checked}개 (admin-web, test-leftovers 는 있어야 한다)`);
});

test('join 형식: join(x, "server", "src", "a.ts")', () => {
  withFixture(
    {
      ...SERVER,
      'src/x.test.ts':
        "import { join } from 'node:path';\nreadFileSync(join(import.meta.dirname, '..', 'server', 'src', 'a.ts'));",
    },
    (root) => {
      const { code, out } = scan(root);
      assert.equal(code, 0);
      assert.deepEqual(out.files, ['server/src/a.ts']);
    },
  );
});

test('여러 줄 join, resolve, 쌍따옴표도 푼다', () => {
  withFixture(
    {
      ...SERVER,
      'src/x.test.ts':
        'readFileSync(\n  resolve(\n    import.meta.dirname,\n    "..",\n    "server",\n    "src",\n    "b.ts",\n  ),\n);',
    },
    (root) => assert.deepEqual(scan(root).out.files, ['server/src/b.ts']),
  );
});

test('new URL 상대 경로와 시험 파일 기준 ../ 를 푼다', () => {
  withFixture(
    {
      ...SERVER,
      'src/deep/x.test.ts': "readFileSync(new URL('../../server/src/a.ts', import.meta.url), 'utf8');",
    },
    (root) => assert.deepEqual(scan(root).out.files, ['server/src/a.ts']),
  );
});

test('폴더를 가리키거나 뒤쪽이 변수면 그 폴더 아래 전부로 넓게 잡는다', () => {
  withFixture(
    {
      ...SERVER,
      'src/x.test.ts': "readdirSync(join(ROOT, 'server/test'));",
      'src/y.test.ts': "readFileSync(join(ROOT, 'server', 'src', name));",
    },
    (root) => {
      const { out } = scan(root);
      assert.deepEqual(out.byTest['src/x.test.ts'], ['server/test/t.test.ts']);
      assert.deepEqual(out.byTest['src/y.test.ts'], ['server/src/a.ts', 'server/src/b.ts']);
    },
  );
});

test("종류 이름표 'server' 만 있는 시험은 건드리지 않는다", () => {
  withFixture(
    {
      ...SERVER,
      'src/x.test.ts': "assert.equal(reason, 'server');\nreadFileSync(join(here, 'tokens.css'));",
    },
    (root) => {
      const { code, out } = scan(root);
      assert.equal(code, 0);
      assert.deepEqual(out.files, []);
    },
  );
});

test('못 알아보는 형식으로 서버 파일을 읽는 시험은 실패(종료 코드 2)로 알린다', () => {
  const odd: Record<string, string> = {
    '인자 안쪽에 숨은 글자': "readFileSync(join(here, pick('server'), 'src', 'a.ts'));",
    '변수에 담은 폴더 이름': "const d = 'server';\nreadFileSync(join(here, d, 'src', 'a.ts'));",
    '조각을 더해 만든 경로': "readFileSync(here + '/server' + '/src/a.ts');",
    '없는 경로': "readFileSync(join(here, 'server', 'nope', 'zzz.ts'));",
  };
  for (const [name, body] of Object.entries(odd)) {
    withFixture({ ...SERVER, 'src/x.test.ts': body }, (root) => {
      const { code, out } = scan(root);
      assert.equal(code, 2, name);
      assert.equal(out.unresolved[0]?.test, 'src/x.test.ts', name);
    });
  }
});
