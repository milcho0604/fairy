// 앱 시험(src/**/*.test.ts)이 글로 읽는 server/ 파일을 찾는다. 의존성 없음.
// check.yml 의 changes 작업이 부른다: 서버만 바뀐 PR 이라도 이 목록과 겹치면 앱 검사를 돌린다.
//
// 알아보는 형식:
//   1. join/resolve 의 인자에 글자 'server' 가 있고 그 뒤 인자가 글자: join(x, 'server', 'src', 'a.ts')
//   2. 글자 안의 경로: '../../server/src/a.ts', new URL('../../server/src/a.ts', import.meta.url), 'server/test'
//      (./, ../ 로 시작하면 시험 파일 기준, 아니면 레포 루트 기준)
// 폴더를 가리키면 그 아래 모든 파일, 인자 뒤쪽이 변수면 글자까지의 앞부분 폴더 아래 모든 파일로 넓게 잡는다 (넓게 잡는 쪽이 안전하다).
// 위 형식으로 풀리지 않는데 파일 읽기와 'server' 글자가 함께 있는 시험 파일은 "못 푼 것"으로 알린다.
//
// 쓰는 법: node scripts/ci/app-reads-server.mjs [--root <레포>] [--json]
//   기본: 파일 목록을 한 줄씩 출력, 못 푼 것이 있으면 stderr 에 적고 종료 코드 2 (CI 는 이때 앱 검사를 돌린다)
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const FS_API = /\b(readFileSync|readFile|readdirSync|readdir|existsSync|statSync|createReadStream|openSync|globSync|cpSync)\b|import\.meta\.(dirname|url|filename)|process\.cwd\(/;
// 'server' 가 경로 조각으로 쓰일 법한 모양 (종류 이름표인 source: 'server', assert.equal(x, 'server') 는 해당 없음)
const MENTION = /[/\\]server(?:[/\\]|['"`])|['"`]server[/\\]|=\s*['"`]server['"`]|\[\s*['"`]server['"`]|['"`]server['"`]\s*\]/;
// 이 스크립트의 시험 파일은 못 알아보는 형식의 예를 글로 담고 있어서 훑지 않는다
const SELF_TEST = 'src/shared/app-reads-server.test.ts';
const IS_TEST = /\.test\.ts$/;
const SKIP_DIRS = new Set(['node_modules', 'dist', 'dist-test', 'out', '.git']);

function walk(dir, keep) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, keep));
    else if (keep(p)) out.push(p);
  }
  return out;
}

// 글자 하나(작은따옴표, 큰따옴표, ${} 없는 백틱)면 값, 아니면 null
function literal(arg) {
  const m = /^\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1\s*$/s.exec(arg);
  if (!m || (m[1] === '`' && m[2].includes('${'))) return null;
  return m[2];
}

// 여는 괄호 자리에서 짝이 맞는 닫는 괄호까지 안쪽 글, 최상위 인자로 나눈 것
function callArgs(src, open) {
  let depth = 0;
  let quote = '';
  let cur = '';
  const args = [];
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      cur += c;
      if (c === '\\') cur += src[++i] ?? '';
      else if (c === quote) quote = '';
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      quote = c;
      cur += c;
    } else if (c === '(' || c === '[' || c === '{') {
      if (depth++ > 0) cur += c;
    } else if (c === ')' || c === ']' || c === '}') {
      if (--depth === 0) {
        args.push(cur);
        return { args, text: src.slice(open + 1, i) };
      }
      cur += c;
    } else if (c === ',' && depth === 1) {
      args.push(cur);
      cur = '';
    } else cur += c;
  }
  return null;
}

const toRel = (root, abs) => relative(root, abs).split(sep).join('/');

function expand(root, abs, into) {
  if (!existsSync(abs)) return false;
  if (statSync(abs).isDirectory()) for (const f of walk(abs, () => true)) into.add(toRel(root, f));
  else into.add(toRel(root, abs));
  return true;
}

// 시험 파일 하나가 읽는 server/ 아래 파일들. 풀지 못한 것이 있으면 unresolved 에 이유
export function scanTest(root, testAbs) {
  const src = readFileSync(testAbs, 'utf8');
  const found = new Set();
  const bad = [];
  const base = dirname(testAbs);
  const under = (abs) => {
    const r = toRel(root, abs);
    return r === 'server' || r.startsWith('server/');
  };

  // 2. 글자 안의 경로
  for (const m of src.matchAll(/(['"`])([^'"`\n]*?)\1/g)) {
    const s = m[2];
    if (!/(?:^|[/\\])server[/\\]/.test(s)) continue;
    // ${} 가 있으면 그 앞의 폴더까지만 (넓게 잡는다)
    const clean = s.includes('${') ? s.slice(0, s.indexOf('${')).replace(/[^/\\]*$/, '') : s;
    const rel = clean.startsWith('./') || clean.startsWith('../');
    for (const cand of rel ? [resolve(base, clean), resolve(root, clean)] : [resolve(root, clean)]) {
      if (under(cand) && expand(root, cand, found)) break;
    }
  }

  // 1. join / resolve 의 인자
  let nested = 0;
  let top = 0;
  for (const m of src.matchAll(/\b(?:join|resolve)\s*\(/g)) {
    const call = callArgs(src, m.index + m[0].length - 1);
    if (!call) continue;
    const lits = call.args.map(literal);
    const i = lits.indexOf('server');
    if (i >= 0) {
      top++;
      const parts = ['server'];
      for (let j = i + 1; j < lits.length && lits[j] !== null; j++) parts.push(lits[j]);
      // 뒤쪽 인자가 변수여도 글자까지의 앞부분 폴더로 넓게 잡는다
      let abs = join(root, ...parts);
      while (!existsSync(abs) && parts.length > 1) abs = join(root, ...parts.splice(0, parts.length - 1));
      if (!expand(root, join(root, ...parts), found)) bad.push(`join/resolve 의 'server' 아래가 레포에 없다: ${parts.join('/')}`);
    }
    // 'server' 글자가 인자 안쪽 깊이 숨어 있으면 못 푼다
    nested += (call.text.match(/(['"`])server\1/g) ?? []).length;
  }
  if (nested > top) bad.push(`join/resolve 안쪽 깊이 숨은 'server' 글자 ${nested - top}개`);

  // 안전망: 파일을 읽거나 경로를 만드는 시험에 'server' 글자나 server/ 경로가 있는데 하나도 못 풀었으면 못 푼 것
  // ('server' 가 종류 이름표일 뿐인 시험은 파일 읽기가 없어 여기 걸리지 않는다)
  if (found.size === 0 && bad.length === 0 && FS_API.test(src) && MENTION.test(src)) {
    bad.push("파일을 읽는 시험에 'server' 경로 글자가 있는데 어느 파일인지 풀지 못했다");
  }
  return { files: [...found].sort(), unresolved: bad };
}

export function scanApp(root) {
  const byTest = {};
  const unresolved = [];
  const all = new Set();
  const tests = walk(join(root, 'src'), (p) => IS_TEST.test(p)).sort();
  for (const t of tests) {
    if (toRel(root, t) === SELF_TEST) continue;
    const r = scanTest(root, t);
    const name = toRel(root, t);
    if (r.files.length) byTest[name] = r.files;
    for (const f of r.files) all.add(f);
    for (const why of r.unresolved) unresolved.push({ test: name, why });
  }
  return { files: [...all].sort(), byTest, unresolved, tests: tests.length };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const argv = process.argv.slice(2);
  const ri = argv.indexOf('--root');
  const root = resolve(ri >= 0 ? argv[ri + 1] : join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
  const r = scanApp(root);
  if (argv.includes('--json')) console.log(JSON.stringify(r, null, 2));
  else for (const f of r.files) console.log(f);
  for (const u of r.unresolved) console.error(`[app-reads-server] 못 푼 것 ${u.test}: ${u.why}`);
  process.exit(r.unresolved.length ? 2 : 0);
}
