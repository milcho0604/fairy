import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { CATALOG_URL } from './ai/catalog.ts';
import { GALLERY_BASE } from './gallery.ts';
import {
  canAutoInstall,
  confirmedForce,
  decideUpdate,
  NAG_DISMISSED_MS,
  NAG_PUSHED_MS,
  nagDelayMs,
  notifyPlan,
  PUBLIC_REPO,
  RELEASE_REPO,
  RELEASES_API,
  readMinVersion,
  readSavedLock,
  SAVED_LOCK_MAX_AGE_MS,
  SOURCE_REPO,
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
  assert.match(wf, /node scripts\/release-check\.mjs notes "\$GITHUB_REF_NAME" > notes\.md/);
  assert.match(wf, /--notes-file notes\.md/);
});

test('electron-builder.yml 의 publish 레포가 앱의 레포와 같다', () => {
  const yml = readFileSync(new URL('../../electron-builder.yml', import.meta.url), 'utf8');
  const publish = /^publish:\s*\n((?:[ \t]+.*\n?)+)/m.exec(yml)?.[1] ?? '';
  assert.match(publish, /provider:\s*github/);
  assert.match(publish, new RegExp(`owner:\\s*${RELEASE_REPO.owner}\\s*$`, 'm'));
  assert.match(publish, new RegExp(`repo:\\s*${RELEASE_REPO.repo}\\s*$`, 'm'));
});

test('앱이 읽는 것은 모두 공개 레포에서 (소스 레포를 비공개로 바꿔도 설치된 앱이 멀쩡하다)', () => {
  const pub = `${PUBLIC_REPO.owner}/${PUBLIC_REPO.repo}`;
  assert.notEqual(pub, `${SOURCE_REPO.owner}/${SOURCE_REPO.repo}`);
  assert.equal(RELEASE_REPO, PUBLIC_REPO);
  assert.equal(RELEASES_API, `https://api.github.com/repos/${pub}/releases/latest`);
  assert.equal(GALLERY_BASE, `https://raw.githubusercontent.com/${pub}/main/gallery/`);
  assert.equal(CATALOG_URL, `https://raw.githubusercontent.com/${pub}/main/catalog/models.json`);
});

test('릴리스와 공개 레포 옮기기 워크플로가 같은 공개 레포를 쓴다', () => {
  const pub = `${PUBLIC_REPO.owner}/${PUBLIC_REPO.repo}`;
  for (const name of ['release.yml', 'sync-public.yml']) {
    const wf = readFileSync(new URL(`../../.github/workflows/${name}`, import.meta.url), 'utf8');
    const repos = [...wf.matchAll(/PUBLIC_REPO:\s*(\S+)/g)].map((m) => m[1]);
    assert.deepEqual(repos, [pub], `${name} 의 PUBLIC_REPO`);
    assert.match(wf, /secrets\.RELEASES_TOKEN/);
  }
  const wf = readFileSync(new URL('../../.github/workflows/release.yml', import.meta.url), 'utf8');
  // 소스 레포(GITHUB_REPOSITORY)에 릴리스를 만들지 않는다
  assert.doesNotMatch(wf, /--repo "\$GITHUB_REPOSITORY"/);
  assert.match(wf, /gh release create [^\n]*--repo "\$PUBLIC_REPO"/);
});

test('새 버전 알림을 꺼도 강제 업데이트는 확인한다 (말풍선만 생략)', () => {
  const v = { version: '1.5.0' };
  assert.equal(notifyPlan({ manual: false, updateCheck: true, ...v }), 'notify');
  assert.equal(notifyPlan({ manual: false, updateCheck: false, ...v }), 'off');
  assert.equal(notifyPlan({ manual: false, updateCheck: true, skipVersion: '1.5.0', ...v }), 'skipped');
  assert.equal(notifyPlan({ manual: false, updateCheck: true, skipVersion: '1.4.0', ...v }), 'notify');
  // 직접 확인은 꺼짐과 건너뛰기를 넘는다
  assert.equal(notifyPlan({ manual: true, updateCheck: false, skipVersion: '1.5.0', ...v }), 'notify');
  // 확인 자체를 꺼짐으로 건너뛰면 강제 업데이트도 잠금 풀기도 오지 않는다 (2026-10-12 점검의 빈틈 1)
  const src = readFileSync(new URL('../main/update.ts', import.meta.url), 'utf8');
  const check = src.slice(
    src.indexOf('async function check('),
    src.indexOf('const first = await fetchDecision()'),
  );
  assert.ok(
    check.length > 0 && !/updateCheck/.test(check),
    'check() 가 확인 전에 updateCheck 로 돌아가면 안 된다',
  );
  assert.match(src, /notifyPlan\(/);
});

test('저장한 잠금은 지금 버전으로 여전히 잠가야 할 때만 쓴다', () => {
  const lock = { version: '1.5.0', url: 'https://github.com/a/b/releases/tag/v1.5.0', minVersion: '1.4.0' };
  assert.deepEqual(readSavedLock(lock, '1.3.9'), lock);
  // 업데이트해서 최소 버전 이상이 됐다
  assert.equal(readSavedLock(lock, '1.4.0'), undefined);
  assert.equal(readSavedLock(lock, '1.5.0'), undefined);
  // 받을 버전이 지금보다 새것이 아니다, 최소 버전이 받을 버전보다 높다
  assert.equal(readSavedLock({ ...lock, version: '1.3.9' }, '1.3.9'), undefined);
  assert.equal(readSavedLock({ ...lock, minVersion: '1.6.0' }, '1.0.0'), undefined);
  // 모양이 이상하다
  assert.equal(readSavedLock({ ...lock, url: 'https://evil.example/x' }, '1.0.0'), undefined);
  assert.equal(readSavedLock({ ...lock, minVersion: 140 }, '1.0.0'), undefined);
  assert.equal(readSavedLock({ ...lock, version: 'x' }, '1.0.0'), undefined);
  assert.equal(readSavedLock(null, '1.0.0'), undefined);
  // 저장한 지 오래된 잠금은 버린다 (릴리스가 사라져 확인이 계속 실패해도 영영 잠기지 않게)
  const at = 1_000_000_000_000;
  assert.deepEqual(readSavedLock({ ...lock, savedAt: at }, '1.3.9', at + SAVED_LOCK_MAX_AGE_MS), lock);
  assert.equal(readSavedLock({ ...lock, savedAt: at }, '1.3.9', at + SAVED_LOCK_MAX_AGE_MS + 1), undefined);
  assert.equal(readSavedLock({ ...lock, savedAt: 'x' }, '1.3.9', at), undefined);
  // 저장한 시각이 지금보다 뒤(시계가 뒤로 감)면 믿지 않는다: 예전에는 그 시각 + 14일까지 잠금이 남았다 (버그잡이 4)
  assert.equal(readSavedLock({ ...lock, savedAt: at + 365 * 86_400_000 }, '1.3.9', at), undefined);
  assert.equal(readSavedLock('min-version: 1.4.0', '1.0.0'), undefined);
  assert.equal(readSavedLock(lock, '개발판'), undefined);
  // 남는 칸은 버린다
  assert.deepEqual(readSavedLock({ ...lock, extra: 1 }, '1.0.0'), lock);
});

test('강제 안내가 밀리면 10초 안에 다시 띄운다', () => {
  assert.equal(nagDelayMs('dismiss'), NAG_DISMISSED_MS);
  for (const a of ['replaced', 'cleared', 'timeout', undefined]) assert.equal(nagDelayMs(a), NAG_PUSHED_MS);
  assert.ok(NAG_PUSHED_MS <= 10_000, '밀린 안내가 10초 넘게 사라지면 안 된다');
  assert.ok(NAG_DISMISSED_MS < NAG_PUSHED_MS);
});
