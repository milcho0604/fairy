// 새 버전 알림 (v1 자동 업데이트). 서명 전(D4)이라 스스로 설치하지는 못하고, 새 버전이 나왔다고 알리고 받는 곳을 연다.

/** "v1.2.3", "1.2.3-beta.1" → [1, 2, 3]. 못 읽으면 undefined */
export function parseVersion(v: string): [number, number, number] | undefined {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined;
}

/** a 가 b 보다 새 버전이면 true. 미리보기(-beta 등)는 정식과 같은 수로 본다 */
export function isNewer(a: string, b: string): boolean {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  }
  return false;
}

export interface LatestRelease {
  version: string;
  url: string;
}

/** GitHub Releases API 의 최신 릴리스 응답에서 버전과 페이지 주소. 초안, 미리보기, 이상한 값은 버린다 */
export function readRelease(json: unknown): LatestRelease | undefined {
  if (typeof json !== 'object' || json === null) return undefined;
  const r = json as Record<string, unknown>;
  if (r.draft === true || r.prerelease === true) return undefined;
  const tag = typeof r.tag_name === 'string' ? r.tag_name : '';
  const url = typeof r.html_url === 'string' ? r.html_url : '';
  if (!parseVersion(tag) || !url.startsWith('https://github.com/')) return undefined;
  return { version: tag.replace(/^v/, ''), url };
}
