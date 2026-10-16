#!/usr/bin/env node
// 문의 이메일이 site/config.js 의 contactEmail 한 곳에만 있는지 본다 (다른 곳에 적어 두면 바꿀 때 빠뜨린다).
// Fails if the contact email from site/config.js is hardcoded anywhere else in tracked files.
// 예외는 빌드가 config.js 에서 읽어 채운 홈페이지 HTML 뿐이다 (site/**/*.html 은 build.mjs 가 만든다).
// build.mjs 가 끝에서 이 파일을 부르고, src/shared/contact-source.test.ts 가 앱 시험에서도 부른다.
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(readFileSync(join(ROOT, 'site/config.js'), 'utf8'), ctx, { filename: 'config.js' });
const email = String(ctx.window.SITE.contactEmail || '').trim();
if (!email) {
  console.log('contact-check: contactEmail 이 비어 있어 검사할 것이 없다');
  process.exit(0);
}

const files = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  .split('\0')
  .filter(Boolean);
const allowed = (f) => f === 'site/config.js' || /^site\/(?:[^/]+\/)?[^/]*\.html$/.test(f) || f === 'site/tools/contact-check.mjs';
const hits = [];
for (const f of files) {
  if (allowed(f)) continue;
  let st;
  try {
    st = statSync(join(ROOT, f));
  } catch {
    continue; // 지워진 파일
  }
  if (!st.isFile() || st.size > 3 * 1024 * 1024) continue;
  const text = readFileSync(join(ROOT, f));
  if (text.includes(0)) continue; // 바이너리
  if (text.toString('utf8').toLowerCase().includes(email.toLowerCase())) hits.push(f);
}
if (hits.length) {
  console.error(`contact-check: 문의 이메일을 site/config.js 밖에 적어 두었다 (한 곳에서만 바꾸게 {email} 자리를 써 주세요):\n  ${hits.join('\n  ')}`);
  process.exit(1);
}
console.log('contact-check: 문의 이메일은 site/config.js 한 곳에만 있다');
