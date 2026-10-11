// 설치 파일에 넣는 오픈소스 고지 (THIRD_PARTY_NOTICES.txt). npm run dist 가 빌드 전에 부른다.
//   node scripts/third-party-notices.mjs [출력 경로, 기본 build/THIRD_PARTY_NOTICES.txt]
// 넣는 것:
// - 실행에 들어가는 npm 패키지: dependencies(설치판 node_modules)와 렌더러 묶음에 들어가는
//   devDependencies(react, react-dom, three, onnxruntime-web), 그리고 그 의존성 전부
// - 맥 앱에 넣는 sd.cpp sd-cli: stable-diffusion.cpp, ggml (MIT), libwebp (BSD). 소스(.cache/sdcpp/src)가 있으면
//   그 라이선스 파일, 없으면 고정 고지문
// Electron 과 Chromium 의 고지는 Electron 이 앱 안에 LICENSE, LICENSES.chromium.html 로 넣는다.
// 설정 → 정보 → 오픈소스 라이선스가 이 파일을 연다 (electron-builder.yml extraResources).
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outPath = resolve(process.argv[2] ?? join(root, 'build', 'THIRD_PARTY_NOTICES.txt'));
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
const pkgs = lock.packages;

/** 렌더러가 묶어 넣는 개발 의존성 (electron.vite.config.ts 의 렌더러 묶음) */
const BUNDLED = ['react', 'react-dom', 'three', 'onnxruntime-web'];

/** node_modules/a/node_modules/b 처럼 중첩된 경로에서 의존성 이름을 찾는다 (npm 해석 순서) */
function resolveDep(fromKey, name) {
  let base = fromKey;
  for (;;) {
    const key = `${base ? `${base}/` : ''}node_modules/${name}`;
    if (pkgs[key]) return key;
    if (!base) return undefined;
    const i = base.lastIndexOf('/node_modules/');
    base = i >= 0 ? base.slice(0, i) : '';
  }
}

// 앱 의존성(dependencies)과 렌더러 묶음에서 시작해 의존성(선택 의존성 포함: 운영체제별 네이티브 패키지)을 따라간다
const picked = new Set();
const queue = [...Object.keys(pkgs[''].dependencies ?? {}), ...BUNDLED]
  .map((n) => resolveDep('', n))
  .filter(Boolean);
while (queue.length) {
  const key = queue.pop();
  if (picked.has(key)) continue;
  picked.add(key);
  const v = pkgs[key];
  for (const dep of Object.keys({ ...v.dependencies, ...v.optionalDependencies })) {
    const k = resolveDep(key, dep);
    if (k && !picked.has(k)) queue.push(k);
  }
}

const LICENSE_FILE = /^(licen[cs]e|copying|notice)(\.[\w.-]+)?$/i;
function licenseText(dir) {
  if (!existsSync(dir)) return undefined;
  const files = readdirSync(dir).filter((f) => LICENSE_FILE.test(f)).sort();
  if (files.length === 0) return undefined;
  return files.map((f) => readFileSync(join(dir, f), 'utf8').trim()).join('\n\n');
}

const nameOf = (key) => key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length);
const entries = new Map();
for (const key of picked) {
  const v = pkgs[key];
  const name = nameOf(key);
  const id = `${name}@${v.version}`;
  if (entries.has(id)) continue;
  const dir = join(root, key);
  let license = v.license;
  if (!license && existsSync(join(dir, 'package.json')))
    license = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).license;
  entries.set(id, {
    name,
    version: v.version,
    license: typeof license === 'string' ? license : 'UNKNOWN',
    text: licenseText(dir),
  });
}

const SDCPP = [
  {
    name: 'stable-diffusion.cpp',
    file: 'LICENSE',
    license: 'MIT',
    fallback: 'MIT License\n\nCopyright (c) 2023 leejet\n\nhttps://github.com/leejet/stable-diffusion.cpp/blob/master/LICENSE',
  },
  {
    name: 'ggml',
    file: 'ggml/LICENSE',
    license: 'MIT',
    fallback: 'MIT License\n\nCopyright (c) 2023-2024 The ggml authors\n\nhttps://github.com/ggml-org/ggml/blob/master/LICENSE',
  },
  {
    name: 'libwebp',
    file: 'thirdparty/libwebp/COPYING',
    license: 'BSD-3-Clause',
    fallback: 'Copyright (c) 2010, Google Inc. All rights reserved.\n\nhttps://chromium.googlesource.com/webm/libwebp/+/refs/heads/main/COPYING',
  },
];
const sdSrc = resolve(process.env.JJ_SDCPP_CACHE || join(root, '.cache', 'sdcpp'), 'src');

const MIT_FULL = `Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

const sorted = [...entries.values()].sort((a, b) => a.name.localeCompare(b.name));
const rule = '-'.repeat(78);
const parts = [
  'fairy (페어리) - Third-party notices',
  '',
  'This app includes the open source software listed below. Electron and Chromium',
  'notices are in the LICENSE and LICENSES.chromium.html files that ship with the app.',
  '이 앱에는 아래 오픈소스가 들어 있습니다. Electron, Chromium 고지는 앱과 함께 있는',
  'LICENSE, LICENSES.chromium.html 에 있습니다.',
  '',
  `npm packages: ${sorted.length}`,
  '',
];
for (const e of sorted) {
  parts.push(rule, `${e.name} ${e.version} (${e.license})`, rule);
  if (e.text) parts.push(e.text);
  else if (/^MIT$/i.test(e.license)) parts.push(`MIT License\n\n${MIT_FULL}`);
  else parts.push(`License: ${e.license} (see https://www.npmjs.com/package/${e.name})`);
  parts.push('');
}
parts.push(rule, 'sd-cli (macOS app only: Draw on this computer, sd.cpp engine)', rule, '');
for (const s of SDCPP) {
  const path = join(sdSrc, s.file);
  const text = existsSync(path) ? readFileSync(path, 'utf8').trim() : s.fallback;
  parts.push(`${s.name} (${s.license})`, '', text, '');
  if (!existsSync(path) && s.license === 'MIT') parts.push(MIT_FULL, '');
}

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${parts.join('\n').trimEnd()}\n`);
const unknown = sorted.filter((e) => e.license === 'UNKNOWN').map((e) => e.name);
console.log(`third-party-notices: ${sorted.length}개 패키지 → ${outPath}`);
if (unknown.length) console.warn(`third-party-notices: 라이선스를 모르는 패키지: ${unknown.join(', ')}`);
