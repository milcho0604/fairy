// 릴리스 본문의 최소 버전 줄을 사람 손 대신 파일에서 만든다 (scripts/release-body.mjs, release.yml).
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
    value: `**꼭 필요한 업데이트:** ${min.value} 보다 낮은 짝꿍은 업데이트해야 AI 대화를 쓸 수 있어요.\n\n<!-- min-version: ${min.value} -->\n`,
  };
}
