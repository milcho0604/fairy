import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { isPrereleaseTag, parseMinVersionFile, releaseBodyHead } from './release-meta.ts';
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

test('레포의 release/min-version 이 지금 버전으로 릴리스할 수 있는 값이다', () => {
  const root = new URL('../../', import.meta.url);
  const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8')) as { version: string };
  const file = readFileSync(new URL('release/min-version', root), 'utf8');
  const r = releaseBodyHead(`v${pkg.version}`, pkg.version, file);
  assert.ok(r.ok, r.ok ? '' : r.error);
});
