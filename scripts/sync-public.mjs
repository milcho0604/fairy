// 공개 레포(milcho0604/fairy-releases)의 내용을 만든다. sync-public.yml 이 부르고, 손으로도 돌린다 (docs/release.md "두 레포").
//   node scripts/sync-public.mjs <폴더> [--from <소스 레포 폴더>]
// <폴더> 에 이렇게 놓는다 (릴리스 파일은 release.yml 이 따로 올린다):
//   public-repo/*  → <폴더>/       (README.md, SECURITY.md, LICENSE, .github/ISSUE_TEMPLATE/ 등)
//   gallery/       → <폴더>/gallery/   (앱의 페어리 갤러리, src/shared/gallery.ts GALLERY_BASE)
//   catalog/       → <폴더>/catalog/   (앱의 모델 목록, src/shared/ai/catalog.ts CATALOG_URL)
// <폴더> 에 원래 있던 것은 .git 만 남기고 지운다 (소스에서 지운 파일이 공개 레포에도 남지 않게).
// 그래서 <폴더> 는 없거나, 비었거나, git 체크아웃(.git 있음)이어야 하고 소스 레포 안이면 안 된다.
// 공개 레포에 워크플로(.github/workflows)는 두지 않는다: 토큰에 Workflows 권한이 없고, 있을 까닭도 없다.
// 놓은 파일 목록을 표준 출력에 적는다. 문제가 있으면 이유를 적고 1 로 끝난다
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 소스 폴더 → 공개 레포 안 위치. '' 는 맨 위 */
export const PUBLIC_TREE = [
  ['public-repo', ''],
  ['gallery', 'gallery'],
  ['catalog', 'catalog'],
];
/** 꼭 있어야 하는 파일 (없으면 앱이나 사용자가 길을 잃는다) */
const REQUIRED = [
  'README.md',
  'SECURITY.md',
  'LICENSE',
  '.github/ISSUE_TEMPLATE/config.yml',
  'gallery/index.json',
  'catalog/models.json',
];
const IGNORED = new Set(['.DS_Store', 'Thumbs.db']);

/** child 가 parent 이거나 그 안인가 */
const inside = (parent, child) => {
  const r = relative(parent, child);
  return r === '' || (r !== '..' && !r.startsWith(`..${sep}`) && !isAbsolute(r));
};

/** 소스 폴더 아래 일반 파일을 모두 (공개 레포 기준 상대 경로, 소스 경로). 링크 같은 것은 문제로 적는다 */
function collect(dir, to, problems, out = []) {
  for (const name of readdirSync(dir).sort()) {
    if (IGNORED.has(name)) continue;
    const from = join(dir, name);
    const dest = to ? `${to}/${name}` : name;
    const st = lstatSync(from);
    if (st.isDirectory()) collect(from, dest, problems, out);
    else if (st.isFile()) out.push([dest, from]);
    else problems.push(`${from}: 일반 파일이 아니에요 (링크 등)`);
  }
  return out;
}

/** 공개 레포에 놓을 파일 목록 [공개 레포 상대 경로, 소스 경로]. 문제가 있으면 throw */
export function publicFiles(srcRoot) {
  const problems = [];
  const files = [];
  for (const [from, to] of PUBLIC_TREE) {
    const dir = join(srcRoot, from);
    if (!existsSync(dir)) problems.push(`${from}/ 가 없어요`);
    else files.push(...collect(dir, to, problems));
  }
  const names = new Set(files.map(([p]) => p));
  for (const r of REQUIRED) if (!names.has(r)) problems.push(`${r} 가 없어요`);
  for (const [p] of files) {
    if (p.startsWith('.github/workflows/')) problems.push(`${p}: 공개 레포에는 워크플로를 두지 않아요`);
    if (p === '.git' || p.startsWith('.git/')) problems.push(`${p}: .git 은 옮기지 않아요`);
  }
  if (problems.length) throw new Error(problems.join('\n'));
  return files.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/** <out> 을 공개 레포 내용으로 맞춘다 (.git 은 그대로). 놓은 파일 목록을 돌려준다 */
export function syncPublic(srcRoot, out) {
  const src = resolve(srcRoot);
  const dest = resolve(out);
  if (inside(dest, src)) throw new Error(`${dest}: 소스 레포를 품은 폴더에는 쓰지 않아요`);
  if (inside(src, dest)) throw new Error(`${dest}: 소스 레포 안에는 쓰지 않아요 (옆 폴더나 임시 폴더로)`);
  const files = publicFiles(src);
  if (existsSync(dest)) {
    if (!lstatSync(dest).isDirectory()) throw new Error(`${dest}: 폴더가 아니에요`);
    const entries = readdirSync(dest);
    if (entries.length && !entries.includes('.git'))
      throw new Error(`${dest}: 비어 있지도, git 체크아웃도 아니에요 (안의 파일을 지울 수 있어 멈춰요)`);
    for (const e of entries) if (e !== '.git') rmSync(join(dest, e), { recursive: true, force: true });
  }
  for (const [p, from] of files) {
    const to = join(dest, ...p.split('/'));
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
  }
  return files.map(([p]) => p);
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const i = args.indexOf('--from');
  const from = i >= 0 ? args.splice(i, 2)[1] : fileURLToPath(new URL('../', import.meta.url));
  const [out] = args;
  if (!out || !from) {
    console.error('쓰는 법: node scripts/sync-public.mjs <폴더> [--from <소스 레포 폴더>]');
    process.exit(1);
  }
  try {
    for (const p of syncPublic(from, out)) console.log(p);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}
