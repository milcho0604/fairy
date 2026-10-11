// 릴리스 사전 점검. release.yml 이 부르고, 태그를 올리기 전에 손으로도 돌린다 (docs/release.md "릴리스 사전 점검").
//   node scripts/release-check.mjs tag v0.2.0              빌드 전: 태그 = package.json 버전, release/min-version,
//                                                          CHANGELOG.md 의 "## [0.2.0] - 날짜" 절 (사전 릴리스 태그는 건너뜀)
//   node scripts/release-check.mjs files v0.2.0 <폴더>      올리기 전: 파일 이름과 개수, latest*.yml 의 버전과 sha512,
//                                                          그리고 <폴더>/SHA256SUMS.txt 를 쓴다 (릴리스에 같이 올린다)
//   node scripts/release-check.mjs notes v0.2.0            릴리스 본문: 최소 버전 머리 + CHANGELOG 절 (표준 출력)
// 문제가 있으면 이유를 모두 적고 1 로 끝난다. 규칙은 src/shared/release-meta.ts (시험 release-meta.test.ts)
import { createHash } from 'node:crypto';
import { createReadStream, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CHECKSUM_FILE,
  changelogSection,
  checkReleaseAssets,
  checkUpdateYml,
  isPrereleaseTag,
  releaseBodyHead,
  sha256Sums,
} from '../src/shared/release-meta.ts';

const [mode, tag = '', dir = ''] = process.argv.slice(2);
const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const version = tag.replace(/^v/, '');
const problems = [];

function head() {
  let minFile = '';
  try {
    minFile = read('release/min-version');
  } catch {}
  const r = releaseBodyHead(tag, JSON.parse(read('package.json')).version, minFile);
  if (!r.ok) problems.push(r.error);
  return r.ok ? r.value : '';
}

/** 사전 릴리스(-beta.1 등)는 CHANGELOG 절 없이도 올린다 (정식 판에 모아 적는다) */
function changelog() {
  if (isPrereleaseTag(tag)) return '';
  const r = changelogSection(read('CHANGELOG.md'), version);
  if (!r.ok) problems.push(r.error);
  return r.ok ? r.value : '';
}

function hashFile(path, algo, encoding) {
  return new Promise((resolve, reject) => {
    const h = createHash(algo);
    createReadStream(path)
      .on('data', (d) => h.update(d))
      .on('error', reject)
      .on('end', () => resolve(h.digest(encoding)));
  });
}

async function files() {
  if (!dir) {
    problems.push('파일 폴더를 주지 않았다');
    return;
  }
  const names = readdirSync(dir).filter((f) => statSync(join(dir, f)).isFile());
  const r = checkReleaseAssets(version, names);
  if (!r.ok) problems.push(r.error);
  const sha256 = new Map();
  const sha512 = new Map();
  for (const f of names.filter((n) => n !== CHECKSUM_FILE)) {
    const p = join(dir, f);
    if (statSync(p).size === 0) problems.push(`${f} 이 비었다`);
    sha256.set(f, await hashFile(p, 'sha256', 'hex'));
    sha512.set(f, await hashFile(p, 'sha512', 'base64'));
  }
  for (const yml of ['latest.yml', 'latest-mac.yml']) {
    if (!names.includes(yml)) continue;
    const c = checkUpdateYml(yml, readFileSync(join(dir, yml), 'utf8'), version, (f) => sha512.get(f));
    if (!c.ok) problems.push(c.error);
  }
  if (problems.length) return;
  const list = sha256Sums([...sha256].map(([name, hash]) => ({ name, sha256: hash })));
  writeFileSync(join(dir, CHECKSUM_FILE), list);
  process.stdout.write(list);
}

if (!/^v\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(tag)) problems.push(`태그 모양이 아니다: "${tag}" (v0.2.0 처럼)`);
else if (mode === 'tag') {
  head();
  changelog();
} else if (mode === 'files') await files();
else if (mode === 'notes') {
  const notes = [head(), changelog()].filter(Boolean).join('\n');
  if (!problems.length) process.stdout.write(`${notes}\n`);
} else problems.push(`모르는 일: "${mode}" (tag, files, notes)`);

if (problems.length) {
  for (const p of problems) console.error(`release-check: ${p}`);
  process.exit(1);
}
if (mode !== 'notes') console.error(`release-check ${mode} ${tag}: 통과`);
