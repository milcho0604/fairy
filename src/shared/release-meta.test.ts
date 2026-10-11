import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  ARTIFACT_PREFIX,
  CHECKSUM_FILE,
  changelogSection,
  checkReleaseAssets,
  checkUpdateYml,
  isPrereleaseTag,
  parseMinVersionFile,
  releaseAssetNames,
  releaseBodyHead,
  sha256Sums,
} from './release-meta.ts';
import { decideUpdate, readMinVersion } from './update-policy.ts';

const HEAD = '# 설명\n# 1.4.0 처럼 적는다\n';

test('최소 버전 파일 읽기', () => {
  assert.deepEqual(parseMinVersionFile(''), { ok: true, value: undefined });
  assert.deepEqual(parseMinVersionFile(HEAD), { ok: true, value: undefined });
  assert.deepEqual(parseMinVersionFile(`${HEAD}\n  1.4.0  \r\n`), { ok: true, value: '1.4.0' });
  assert.deepEqual(parseMinVersionFile('v1.4.0'), { ok: true, value: '1.4.0' });
  // 숫자 둘, 꼬리, 글 섞임, 두 줄은 오류 (조용히 무시하지 않고 릴리스를 멈춘다)
  for (const bad of ['1.4', '1.4.0-beta', 'min-version: 1.4.0', '1.4.0\n1.5.0', '1.4.0 # 메모'])
    assert.equal(parseMinVersionFile(bad).ok, false, bad);
});

test('릴리스 본문 머리: 태그, 버전, 최소 버전을 맞춰 본다', () => {
  assert.deepEqual(releaseBodyHead('v0.2.0', '0.2.0', HEAD), { ok: true, value: '' });
  const r = releaseBodyHead('v0.3.0', '0.3.0', '0.2.0');
  assert.equal(r.ok, true);
  // 만든 본문을 앱이 그대로 읽어 0.2.0 보다 낮은 버전만 잠근다
  const body = r.ok ? `${r.value}\n## What's Changed\n* 고침` : '';
  assert.equal(readMinVersion(body), '0.2.0');
  const json = { tag_name: 'v0.3.0', html_url: 'https://github.com/a/b/releases/tag/v0.3.0', body };
  assert.equal(decideUpdate(json, '0.1.0').kind, 'force');
  assert.equal(decideUpdate(json, '0.2.0').kind, 'notify');
  // 최소 버전이 이 릴리스와 같아도 된다
  assert.equal(releaseBodyHead('v0.3.0', '0.3.0', '0.3.0').ok, true);
  // 태그와 package.json 이 다르면 (버전 올리기를 잊음) 멈춘다. 그대로 두면 새 앱이 스스로를 옛 버전으로 본다
  assert.equal(releaseBodyHead('v0.3.0', '0.2.0', '').ok, false);
  assert.equal(releaseBodyHead('0.3.0', '0.3.0', '').ok, false);
  // 이 릴리스보다 높은 최소 버전, 잘못된 파일
  assert.equal(releaseBodyHead('v0.3.0', '0.3.0', '0.4.0').ok, false);
  assert.equal(releaseBodyHead('v0.3.0', '0.3.0', '0.3').ok, false);
  // 사전 릴리스 태그도 package.json 과 똑같아야 한다
  assert.equal(releaseBodyHead('v0.3.0-beta.1', '0.3.0-beta.1', '').ok, true);
});

test('사전 릴리스 태그', () => {
  assert.equal(isPrereleaseTag('v0.3.0-beta.1'), true);
  assert.equal(isPrereleaseTag('v0.3.0'), false);
});

test('릴리스 파일 이름: 빠진 것, 이름이 다른 것', () => {
  const all = releaseAssetNames('0.2.0');
  assert.equal(all.length, 12);
  assert.deepEqual(checkReleaseAssets('0.2.0', [...all, CHECKSUM_FILE]), { ok: true, value: undefined });
  const less = checkReleaseAssets('0.2.0', all.slice(1));
  assert.equal(less.ok, false);
  assert.match(less.ok ? '' : less.error, /빠진 파일: fairy-0\.2\.0-mac-arm64\.dmg/);
  // 다른 버전으로 빌드된 파일(버전을 안 올림)이나 이름이 바뀐 파일
  const odd = checkReleaseAssets('0.2.0', [...all, 'fairy-0.1.0-win-x64.exe']);
  assert.match(odd.ok ? '' : odd.error, /이름이 다른 파일: fairy-0\.1\.0-win-x64\.exe/);
});

test('electron-builder.yml 의 설치 파일 이름이 점검과 같은 모양이다', () => {
  const yml = readFileSync(new URL('../../electron-builder.yml', import.meta.url), 'utf8');
  const name = /^artifactName:\s*(\S+)\s*$/m.exec(yml)?.[1];
  assert.equal(name, `${ARTIFACT_PREFIX}-\${version}-\${os}-\${arch}.\${ext}`);
});

test('CHANGELOG 의 버전 절', () => {
  const log =
    '# Changelog\n\n## [Unreleased]\n\n- 새것\n\n## [0.2.0] - 2026-10-20\n\n### 더한 것\n\n- 하나\n\n## [0.1.0] - 2026-10-01\n\n- 옛것\n';
  assert.deepEqual(changelogSection(log, '0.2.0'), { ok: true, value: '### 더한 것\n\n- 하나' });
  assert.deepEqual(changelogSection(log, '0.1.0'), { ok: true, value: '- 옛것' });
  // 없음, 날짜 없음, 항목 없음, 비슷한 버전(0.2.0 절이 0.2.0-beta.1 에 걸리지 않게)
  assert.equal(changelogSection(log, '0.3.0').ok, false);
  assert.equal(changelogSection('## [0.3.0]\n\n- 하나\n', '0.3.0').ok, false);
  assert.equal(changelogSection('## [0.3.0] - 2026-10-20\n\n### 더한 것\n', '0.3.0').ok, false);
  assert.equal(changelogSection(log, '0.2').ok, false);
  assert.equal(changelogSection('## [0.2.0-beta.1] - 2026-10-20\n- 하나\n', '0.2.0').ok, false);
});

test('자동 업데이트 파일의 버전과 sha512', () => {
  const yml = [
    'version: 0.2.0',
    'files:',
    '  - url: fairy-0.2.0-mac-arm64.zip',
    '    sha512: AAA==',
    '    size: 10',
    '  - url: fairy-0.2.0-mac-x64.zip',
    '    sha512: BBB==',
    '    size: 11',
    'path: fairy-0.2.0-mac-arm64.zip',
    'sha512: AAA==',
    "releaseDate: '2026-10-20T00:00:00.000Z'",
    '',
  ].join('\n');
  const real: Record<string, string> = {
    'fairy-0.2.0-mac-arm64.zip': 'AAA==',
    'fairy-0.2.0-mac-x64.zip': 'BBB==',
  };
  const of = (f: string) => real[f];
  assert.equal(checkUpdateYml('latest-mac.yml', yml, '0.2.0', of).ok, true);
  assert.equal(checkUpdateYml('latest-mac.yml', yml.replace(/\n/g, '\r\n'), '0.2.0', of).ok, true);
  assert.equal(checkUpdateYml('latest-mac.yml', yml, '0.3.0', of).ok, false);
  assert.equal(checkUpdateYml('latest-mac.yml', yml.replace('BBB==', 'CCC=='), '0.2.0', of).ok, false);
  assert.equal(checkUpdateYml('latest-mac.yml', yml, '0.2.0', () => undefined).ok, false);
  assert.equal(checkUpdateYml('latest.yml', 'version: 0.2.0\n', '0.2.0', of).ok, false);
});

test('SHA256 목록은 sha256sum -c 모양으로 이름 순', () => {
  assert.equal(
    sha256Sums([
      { name: 'b.exe', sha256: '22' },
      { name: 'a.dmg', sha256: '11' },
    ]),
    '11  a.dmg\n22  b.exe\n',
  );
});

test('레포의 release/min-version 이 지금 버전으로 릴리스할 수 있는 값이다', () => {
  const root = new URL('../../', import.meta.url);
  const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8')) as { version: string };
  const file = readFileSync(new URL('release/min-version', root), 'utf8');
  const r = releaseBodyHead(`v${pkg.version}`, pkg.version, file);
  assert.ok(r.ok, r.ok ? '' : r.error);
});
