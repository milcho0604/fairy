// 릴리스 본문의 최소 버전 줄을 사람 손 대신 파일에서 만든다 (scripts/release-check.mjs notes, release.yml).
// 값은 레포의 release/min-version 한 곳에 두고 커밋으로 남긴다. 지우기 전까지 다음 릴리스에도 계속 붙는다.
import { isNewer, parseVersion } from './version.ts';

const EXACT = /^v?(\d{1,4}\.\d{1,4}\.\d{1,4})$/;

export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * release/min-version 파일을 읽는다. `#` 로 시작하는 줄과 빈 줄은 건너뛴다.
 * 남은 줄이 없으면 최소 버전 없음, 하나면 그 값(1.4.0 처럼 셋 다), 그 밖은 오류.
 */
export function parseMinVersionFile(text: string): Checked<string | undefined> {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  if (lines.length === 0) return { ok: true, value: undefined };
  if (lines.length > 1) return { ok: false, error: `값이 한 줄이어야 한다: ${lines.join(', ')}` };
  const m = EXACT.exec(lines[0] ?? '');
  if (!m?.[1]) return { ok: false, error: `1.4.0 처럼 숫자 셋이어야 한다: ${lines[0]}` };
  return { ok: true, value: m[1] };
}

/** 태그에 붙은 미리보기 꼬리(-beta.1 등)가 있으면 사전 릴리스로 올린다. 앱은 사전 릴리스를 보지 않는다 */
export function isPrereleaseTag(tag: string): boolean {
  return /^v\d+\.\d+\.\d+-/.test(tag);
}

/**
 * 태그, package.json 버전, 최소 버전 파일을 맞춰 보고 릴리스 본문 머리를 만든다.
 * - 태그는 `v` + package.json 버전과 똑같아야 한다. 다르면 앱이 스스로를 옛 버전으로 보고
 *   업데이트 안내(최소 버전이면 잠금)가 끝나지 않는다.
 * - 최소 버전은 이 릴리스 버전 이하여야 한다(앱이 더 높은 값은 무시하므로 실수다).
 */
export function releaseBodyHead(tag: string, pkgVersion: string, minFile: string): Checked<string> {
  if (tag !== `v${pkgVersion}`)
    return {
      ok: false,
      error: `태그 ${tag} 와 package.json 버전 ${pkgVersion} 이 다르다 (v${pkgVersion} 이어야 한다)`,
    };
  if (!parseVersion(pkgVersion)) return { ok: false, error: `package.json 버전을 못 읽는다: ${pkgVersion}` };
  const min = parseMinVersionFile(minFile);
  if (!min.ok) return { ok: false, error: `release/min-version: ${min.error}` };
  if (!min.value) return { ok: true, value: '' };
  if (isNewer(min.value, pkgVersion))
    return { ok: false, error: `최소 버전 ${min.value} 이 이 릴리스 ${pkgVersion} 보다 높다` };
  // 사람이 읽는 문장과 앱이 읽는 표시를 따로 둔다. 표시는 화면에 안 보이는 주석 한 줄
  return {
    ok: true,
    value: `**꼭 필요한 업데이트:** ${min.value} 보다 낮은 페어리는 업데이트해야 AI 대화를 쓸 수 있어요.\n\n<!-- min-version: ${min.value} -->\n`,
  };
}

// ── 릴리스 사전 점검 (scripts/release-check.mjs, release.yml) ──

/** 설치 파일 이름 머리. electron-builder.yml 의 artifactName `fairy-${version}-${os}-${arch}.${ext}` 와 같아야 한다 */
export const ARTIFACT_PREFIX = 'fairy';

/** SHA256 목록 파일 이름. 릴리스에 같이 올린다 */
export const CHECKSUM_FILE = 'SHA256SUMS.txt';

/**
 * 이 버전의 릴리스에 올라가야 하는 파일 전부 (release.yml 의 upload-artifact 경로와 같다).
 * 맥: 처음 설치용 dmg 두 칩, 자동 업데이트용 zip, .zip.blockmap, latest-mac.yml.
 * 윈도우: exe, .exe.blockmap, latest.yml. 리눅스: tar.xz, AppImage (AppImage 칩 이름은 x86_64 로 나온다)
 */
export function releaseAssetNames(version: string): string[] {
  const p = `${ARTIFACT_PREFIX}-${version}`;
  return [
    `${p}-mac-arm64.dmg`,
    `${p}-mac-x64.dmg`,
    `${p}-mac-arm64.zip`,
    `${p}-mac-x64.zip`,
    `${p}-mac-arm64.zip.blockmap`,
    `${p}-mac-x64.zip.blockmap`,
    'latest-mac.yml',
    `${p}-win-x64.exe`,
    `${p}-win-x64.exe.blockmap`,
    'latest.yml',
    `${p}-linux-x64.tar.xz`,
    `${p}-linux-x86_64.AppImage`,
  ];
}

/** 받은 파일 이름 목록이 이 버전의 릴리스 파일과 꼭 맞는지 (빠진 것, 남는 것). 체크섬 파일은 남는 것으로 치지 않는다 */
export function checkReleaseAssets(version: string, present: readonly string[]): Checked<void> {
  const want = releaseAssetNames(version);
  const have = new Set(present);
  const missing = want.filter((f) => !have.has(f));
  const extra = present.filter((f) => !want.includes(f) && f !== CHECKSUM_FILE);
  const errors: string[] = [];
  if (missing.length) errors.push(`빠진 파일: ${missing.join(', ')}`);
  if (extra.length) errors.push(`이름이 다른 파일: ${extra.join(', ')}`);
  return errors.length ? { ok: false, error: errors.join(' / ') } : { ok: true, value: undefined };
}

/**
 * CHANGELOG.md 에서 이 버전의 절(`## [0.2.0] - 2026-10-20`)을 찾아 본문을 돌려준다.
 * 머리에 날짜가 없거나 항목이 없으면 오류. 릴리스 본문에 그대로 넣는다
 */
export function changelogSection(text: string, version: string): Checked<string> {
  const lines = text.split(/\r?\n/);
  const at = lines.findIndex((l) => l.startsWith(`## [${version}]`));
  if (at < 0) return { ok: false, error: `CHANGELOG.md 에 "## [${version}] - YYYY-MM-DD" 절이 없다` };
  const rest = (lines[at] ?? '').slice(`## [${version}]`.length);
  if (!/^ - \d{4}-\d{2}-\d{2}\s*$/.test(rest))
    return {
      ok: false,
      error: `CHANGELOG.md 의 [${version}] 머리에 날짜가 없다 ("## [${version}] - YYYY-MM-DD")`,
    };
  const end = lines.findIndex((l, i) => i > at && l.startsWith('## '));
  const body = lines
    .slice(at + 1, end < 0 ? undefined : end)
    .join('\n')
    .trim();
  if (!/^- /m.test(body))
    return { ok: false, error: `CHANGELOG.md 의 [${version}] 절에 항목(- 로 시작하는 줄)이 없다` };
  return { ok: true, value: body };
}

/**
 * 자동 업데이트 파일(latest.yml, latest-mac.yml)이 이 버전이고, 적힌 파일마다 sha512 가 실제 파일과 같은지.
 * electron-builder 가 쓰는 모양(`version:`, `files:` 아래 `- url:` 다음 줄 `sha512:`)만 읽는다.
 * sha512Of 는 파일 이름 → base64 sha512 (릴리스에 없는 파일이면 undefined)
 */
export function checkUpdateYml(
  name: string,
  yml: string,
  version: string,
  sha512Of: (file: string) => string | undefined,
): Checked<void> {
  const ver = /^version:\s*['"]?([^'"\s]+)['"]?\s*$/m.exec(yml)?.[1];
  if (ver !== version)
    return { ok: false, error: `${name} 의 version 이 ${ver ?? '(없음)'} 이다 (${version} 이어야 한다)` };
  const files = [...yml.matchAll(/^\s*- url:\s*(\S+)\s*\r?\n\s*sha512:\s*(\S+)/gm)].map((m) => ({
    url: m[1] ?? '',
    sha: m[2] ?? '',
  }));
  if (!files.length) return { ok: false, error: `${name} 에 files 목록이 없다` };
  for (const f of files) {
    const real = sha512Of(f.url);
    if (real === undefined) return { ok: false, error: `${name} 이 가리키는 ${f.url} 이 릴리스에 없다` };
    if (real !== f.sha) return { ok: false, error: `${name} 의 ${f.url} sha512 가 실제 파일과 다르다` };
  }
  return { ok: true, value: undefined };
}

/** `sha256sum -c` 로 확인할 수 있는 목록 (이름 순, 해시 두 칸 띄우고 이름) */
export function sha256Sums(entries: readonly { name: string; sha256: string }[]): string {
  return [...entries]
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((e) => `${e.sha256}  ${e.name}\n`)
    .join('');
}
