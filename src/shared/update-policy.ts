// 업데이트 정책 (강제 업데이트와 자동 설치). 순수 로직만 둔다. 실제 확인과 말풍선은 main/update.ts.
import { isNewer, parseVersion, readRelease } from './version.ts';

/**
 * 이 앱의 GitHub 레포 (주소를 적는 곳은 여기 하나). 릴리스를 올리는 레포라 앱의 새 버전 확인(GitHub API)과
 * 자동 설치(electron-updater)가 같이 쓰고, 갤러리(gallery.ts), 모델 목록(ai/catalog.ts), 버그 제보(feedback.ts)도 이것으로 주소를 만든다.
 * 이름이 짝꿍에서 페어리로 바뀌며 레포도 milcho0604/jjakkung → milcho0604/fairy (2026-10-11. 옛 주소는 GitHub 가 넘겨준다).
 * D8(공개 배포)에서 레포를 바꾸면 여기와 electron-builder.yml 의 publish 를 같이 바꾼다
 * (둘이 다르면 update-policy.test.ts 가 깨진다). 토큰은 넣지 않는다. 공개 레포만 읽을 수 있다.
 */
export const RELEASE_REPO = { owner: 'milcho0604', repo: 'fairy' } as const;

export const RELEASES_API = `https://api.github.com/repos/${RELEASE_REPO.owner}/${RELEASE_REPO.repo}/releases/latest`;

/**
 * 스스로 받아 설치하는 운영체제. 둘 다 받아 두고 "다시 켜서 업데이트"를 누를 때만 설치한다 (main/update.ts installOnQuit).
 * 맥(Squirrel.Mac)은 새 앱의 서명이 지금 앱의 서명 조건(앱 ID + 자체 인증서, scripts/mac-sign.mjs)을
 * 만족해야 받아들인다. 늘 같은 인증서로 서명하므로 된다(2026-10-09 실험: 같은 인증서는 설치, 임시 서명은 거절).
 */
export const AUTO_INSTALL_PLATFORMS: readonly string[] = ['win32', 'darwin'];

export function canAutoInstall(platform: string, packaged: boolean): boolean {
  return packaged && AUTO_INSTALL_PLATFORMS.includes(platform);
}

/** 릴리스 본문이 너무 길면 표시를 찾지 않는다 (이상한 응답) */
const MAX_BODY = 100_000;
const MARK = /^\s*(?:<!--\s*)?min-version:\s*v?(\d{1,4}\.\d{1,4}\.\d{1,4})\s*(?:-->)?\s*$/i;

/**
 * 릴리스 본문에서 최소 버전 표시를 읽는다. 한 줄에 `min-version: 1.4.0` 또는 `<!-- min-version: 1.4.0 -->`.
 * 코드 블록(```) 안의 줄은 예시로 보고 읽지 않는다. 서로 다른 값이 둘 이상이면 어느 쪽도 믿지 않는다.
 */
export function readMinVersion(body: unknown): string | undefined {
  if (typeof body !== 'string' || body.length > MAX_BODY) return undefined;
  const found = new Set<string>();
  let fence = false;
  for (const line of body.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      fence = !fence;
      continue;
    }
    if (fence) continue;
    const m = MARK.exec(line);
    if (m?.[1]) found.add(m[1]);
  }
  return found.size === 1 ? [...found][0] : undefined;
}

export type UpdateDecision =
  | { kind: 'none' }
  | { kind: 'notify'; version: string; url: string }
  | { kind: 'force'; version: string; url: string; minVersion: string };

/**
 * GitHub 최신 릴리스 응답과 지금 버전으로 할 일을 정한다.
 * 잠그는(force) 조건은 모두 맞아야 한다. 하나라도 어긋나면 잠그지 않는 쪽으로 떨어진다.
 * - 응답이 정상 릴리스(초안, 미리보기 아님, github.com 주소, 읽히는 태그)
 * - 최신 버전이 지금보다 새것 (받을 것이 있어야 잠근다)
 * - 최소 버전 표시가 정확히 하나
 * - 최소 버전이 최신 버전 이하 (없는 버전을 요구하면 업데이트해도 못 푼다)
 * - 지금 버전이 최소 버전보다 낮음
 */
export function decideUpdate(json: unknown, current: string): UpdateDecision {
  if (!parseVersion(current)) return { kind: 'none' };
  const latest = readRelease(json);
  if (!latest || !isNewer(latest.version, current)) return { kind: 'none' };
  const min = readMinVersion((json as Record<string, unknown>).body);
  if (min && isNewer(min, current) && !isNewer(min, latest.version))
    return { kind: 'force', version: latest.version, url: latest.url, minVersion: min };
  return { kind: 'notify', version: latest.version, url: latest.url };
}

/**
 * 잠그기 전에 따로 두 번 받은 응답이 같은 최소 버전으로 잠그라고 해야 잠근다.
 * 한 번 잘못 온 응답(캐시, 중간 장비, 잠깐 잘못 올린 릴리스)으로 앱이 잠기지 않게.
 */
export function confirmedForce(first: UpdateDecision, second: UpdateDecision): boolean {
  return first.kind === 'force' && second.kind === 'force' && first.minVersion === second.minVersion;
}
