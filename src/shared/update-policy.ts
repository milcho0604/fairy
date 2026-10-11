// 업데이트 정책 (강제 업데이트와 자동 설치). 순수 로직만 둔다. 실제 확인과 말풍선은 main/update.ts.
import { isNewer, parseVersion, readRelease } from './version.ts';

/**
 * 소스 코드 레포. 개발 문서에서만 가리킨다. 앱은 이 레포를 읽지 않는다 (비공개로 바꿔도 설치된 앱이 멀쩡하도록).
 * 이름이 짝꿍에서 페어리로 바뀌며 milcho0604/jjakkung → milcho0604/fairy (2026-10-11. 옛 주소는 GitHub 가 넘겨준다).
 */
export const SOURCE_REPO = { owner: 'milcho0604', repo: 'fairy' } as const;

/**
 * 사용자가 쓰는 공개 레포 (주소를 적는 곳은 여기 하나). 앱이 GitHub 에서 읽는 것은 모두 여기다:
 * 새 버전 확인(GitHub API)과 자동 설치(electron-updater, main/update.ts), 갤러리(gallery.ts),
 * 모델 목록(ai/catalog.ts), 버그 제보(feedback.ts issueUrl). 소스 레포의 public-repo/, gallery/, catalog/ 를
 * sync-public.yml 이 이 레포에 옮겨 두고, release.yml 이 설치 파일을 이 레포의 릴리스로 올린다 (docs/release.md "두 레포").
 * 바꾸면 electron-builder.yml 의 publish 와 두 워크플로의 레포도 같이 바꾼다 (다르면 update-policy.test.ts 가 깨진다).
 * 토큰은 넣지 않는다. 공개 레포만 읽을 수 있다.
 */
export const PUBLIC_REPO = { owner: 'milcho0604', repo: 'fairy-releases' } as const;

/** 릴리스를 올리고 업데이트를 받는 레포 = 공개 레포 */
export const RELEASE_REPO = PUBLIC_REPO;

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

/** 강제 업데이트 잠금. 켤 때 바로 잠그려고 사용자 데이터 폴더(update-lock.json)에 남긴다 */
export interface SavedLock {
  version: string;
  url: string;
  minVersion: string;
}

/**
 * 저장해 둔 잠금을 읽는다. 지금 버전으로 여전히 잠가야 할 때만 돌려준다 (decideUpdate 의 force 조건과 같다).
 * 업데이트해서 최소 버전 이상이 됐거나, 모양이 이상하면 undefined (부르는 쪽이 파일을 지운다).
 */
export function readSavedLock(raw: unknown, current: string): SavedLock | undefined {
  if (typeof raw !== 'object' || raw === null || !parseVersion(current)) return undefined;
  const r = raw as Record<string, unknown>;
  const { version, url, minVersion } = r;
  if (typeof version !== 'string' || typeof url !== 'string' || typeof minVersion !== 'string')
    return undefined;
  if (!parseVersion(version) || !parseVersion(minVersion) || !url.startsWith('https://github.com/'))
    return undefined;
  if (!isNewer(version, current) || !isNewer(minVersion, current) || isNewer(minVersion, version))
    return undefined;
  return { version, url, minVersion };
}

/**
 * 자동 확인에서 찾은 새 버전(강제 아님)을 말풍선으로 알릴지. 설정 "새 버전 알림"을 끄면 알리지 않는다.
 * 꺼져 있어도 확인은 한다: 강제 업데이트(잠금)와 잠금 풀기는 이 설정과 상관없다 (main/update.ts check).
 */
export function notifyPlan(o: {
  manual: boolean;
  updateCheck: boolean;
  skipVersion?: string;
  version: string;
}): 'notify' | 'off' | 'skipped' {
  if (o.manual) return 'notify';
  if (!o.updateCheck) return 'off';
  return o.skipVersion === o.version ? 'skipped' : 'notify';
}

/** 눌러 닫은 강제 안내를 다시 띄우는 간격 */
export const NAG_DISMISSED_MS = 500;
/**
 * 강제 안내가 다른 말풍선에 밀렸거나 못 떴을 때 다시 띄우는 간격. 보통 말풍선이 떠 있는 시간(8초)쯤 보여 준 뒤 되찾는다.
 * 예전 60초는 잠긴 채 안내가 1분 가까이 사라졌다 (2026-10-12 점검).
 */
export const NAG_PUSHED_MS = 10_000;

export function nagDelayMs(answer: string | undefined): number {
  return answer === 'dismiss' ? NAG_DISMISSED_MS : NAG_PUSHED_MS;
}
