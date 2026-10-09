import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  canAutoInstall,
  confirmedForce,
  decideUpdate,
  RELEASE_REPO,
  readMinVersion,
} from './update-policy.ts';

const release = (body: unknown, tag = 'v1.5.0') => ({
  tag_name: tag,
  html_url: `https://github.com/a/b/releases/tag/${tag}`,
  body,
});

test('최소 버전 표시 읽기', () => {
  assert.equal(readMinVersion('고친 것\n\nmin-version: 1.4.0\n'), '1.4.0');
  assert.equal(readMinVersion('<!-- min-version: v1.4.0 -->'), '1.4.0');
  assert.equal(readMinVersion('  MIN-VERSION:1.4.0  \r\n다음 줄'), '1.4.0');
  // 같은 값이 두 번이면 괜찮다
  assert.equal(readMinVersion('min-version: 1.4.0\nmin-version: 1.4.0'), '1.4.0');
  // 없음, 문장 속, 틀린 모양, 다른 값 둘, 코드 블록 속 예시, 글이 아님, 너무 김
  assert.equal(readMinVersion('그냥 고친 것'), undefined);
  assert.equal(readMinVersion('이번엔 min-version: 1.4.0 을 쓰지 않았다'), undefined);
  assert.equal(readMinVersion('min-version: 1.4'), undefined);
  assert.equal(readMinVersion('min-version: 1.4.0-beta'), undefined);
  assert.equal(readMinVersion('min-version: 1.4.0\nmin-version: 1.3.0'), undefined);
  assert.equal(readMinVersion('예시\n```\nmin-version: 1.4.0\n```\n'), undefined);
  assert.equal(readMinVersion(null), undefined);
  assert.equal(readMinVersion(42), undefined);
  assert.equal(readMinVersion(`${'가'.repeat(100_001)}\nmin-version: 1.4.0`), undefined);
});

test('할 일 정하기: 알림과 강제', () => {
  assert.deepEqual(decideUpdate(release('min-version: 1.4.0'), '1.3.9'), {
    kind: 'force',
    version: '1.5.0',
    url: 'https://github.com/a/b/releases/tag/v1.5.0',
    minVersion: '1.4.0',
  });
  // 최소 버전 이상이면 알림만
  assert.equal(decideUpdate(release('min-version: 1.4.0'), '1.4.0').kind, 'notify');
  assert.equal(decideUpdate(release('그냥'), '1.0.0').kind, 'notify');
  // 이미 최신이면 아무것도
  assert.equal(decideUpdate(release('min-version: 1.4.0'), '1.5.0').kind, 'none');
});

test('잘못된 응답으로는 잠그지 않는다', () => {
  const body = 'min-version: 1.4.0';
  // 최소 버전이 최신 릴리스보다 높다 (업데이트해도 못 푼다)
  assert.equal(decideUpdate(release('min-version: 9.0.0'), '1.0.0').kind, 'notify');
  // 초안, 미리보기, 다른 주소, 오류 응답, 빈 응답
  assert.equal(decideUpdate({ ...release(body), draft: true }, '1.0.0').kind, 'none');
  assert.equal(decideUpdate({ ...release(body), prerelease: true }, '1.0.0').kind, 'none');
  assert.equal(decideUpdate({ ...release(body), html_url: 'https://evil.example/x' }, '1.0.0').kind, 'none');
  assert.equal(decideUpdate({ message: 'Not Found', body }, '1.0.0').kind, 'none');
  assert.equal(decideUpdate(null, '1.0.0').kind, 'none');
  assert.equal(decideUpdate('min-version: 1.4.0', '1.0.0').kind, 'none');
  // 지금 버전을 못 읽으면
  assert.equal(decideUpdate(release(body), '개발판').kind, 'none');
});

test('두 번 다 같은 최소 버전으로 강제여야 잠근다', () => {
  const force = decideUpdate(release('min-version: 1.4.0'), '1.0.0');
  const other = decideUpdate(release('min-version: 1.2.0'), '1.0.0');
  const notify = decideUpdate(release(''), '1.0.0');
  assert.equal(confirmedForce(force, force), true);
  assert.equal(confirmedForce(force, other), false);
  assert.equal(confirmedForce(force, notify), false);
  assert.equal(confirmedForce(notify, force), false);
  assert.equal(confirmedForce({ kind: 'none' }, { kind: 'none' }), false);
});

test('자동 설치는 설치판 윈도우와 맥 (맥은 늘 같은 자체 인증서로 서명)', () => {
  assert.equal(canAutoInstall('win32', true), true);
  assert.equal(canAutoInstall('win32', false), false);
  assert.equal(canAutoInstall('darwin', true), true);
  assert.equal(canAutoInstall('darwin', false), false);
  assert.equal(canAutoInstall('linux', true), false);
});

test('자동 설치가 받을 파일을 빌드하고 릴리스에 올린다', () => {
  const yml = readFileSync(new URL('../../electron-builder.yml', import.meta.url), 'utf8');
  const mac = /^mac:\s*\n((?:[ \t]+.*\n?|\s*\n)+?)^\S/m.exec(yml)?.[1] ?? '';
  // 맥 자동 업데이트는 zip 만 받는다 (dmg 는 처음 설치용)
  assert.match(mac, /target:\s*zip/);
  assert.match(mac, /target:\s*dmg/);
  const wf = readFileSync(new URL('../../.github/workflows/release.yml', import.meta.url), 'utf8');
  for (const f of [
    'dist/latest.yml',
    'dist/*.exe.blockmap',
    'dist/latest-mac.yml',
    'dist/*.zip',
    'dist/*.zip.blockmap',
  ])
    assert.ok(wf.includes(f), `release.yml 이 ${f} 를 올리지 않는다`);
  // 본문의 최소 버전 줄은 손이 아니라 release/min-version 에서
  assert.match(wf, /node scripts\/release-body\.mjs "\$GITHUB_REF_NAME" > notes\.md/);
  assert.match(wf, /--notes-file notes\.md/);
});

test('electron-builder.yml 의 publish 레포가 앱의 레포와 같다', () => {
  const yml = readFileSync(new URL('../../electron-builder.yml', import.meta.url), 'utf8');
  const publish = /^publish:\s*\n((?:[ \t]+.*\n?)+)/m.exec(yml)?.[1] ?? '';
  assert.match(publish, /provider:\s*github/);
  assert.match(publish, new RegExp(`owner:\\s*${RELEASE_REPO.owner}\\s*$`, 'm'));
  assert.match(publish, new RegExp(`repo:\\s*${RELEASE_REPO.repo}\\s*$`, 'm'));
});
