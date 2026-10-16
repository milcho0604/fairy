// 업데이트 세 단계 (이슈 #120): 권장(알림), 기능 제한(restrict), 강제(min).
// 서버 미들웨어(server/src/update-gate.ts)와 앱(server-core, update.ts)이 같은 규칙을 쓴다. 순수 규칙만 둔다.
// 서버는 이 파일을 server/src/shared/ 로 복사해 쓴다 (scripts/sync-shared.mjs, Dockerfile, 워크플로 경로).

/** 앱이 모든 서버 요청에 실어 보내는 앱 판 머리 */
export const APP_VERSION_HEADER = 'x-fairy-version';

/** 운영자가 정하는 세 기준. 모두 선택 사항이다 (없으면 그 단계는 꺼짐) */
export interface UpdateLevels {
  /** 권장: 알림만 */
  recommend?: string;
  /** 기능 제한: 이보다 낮으면 서버 기능 전체를 거절한다 (426 update_required) */
  restrict?: string;
  /** 강제: 이보다 낮으면 앱을 잠근다. 서버도 같은 기준으로 거절한다 */
  min?: string;
}

export type GateLevel = 'restrict' | 'force';

/** 426 의 몸: 어느 단계인가와 필요한 최소 판 */
export interface GateNeed {
  level: GateLevel;
  need: string;
}

const SEMVER = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;

export const isVersion = (v: unknown): v is string => typeof v === 'string' && SEMVER.test(v);

/** a 가 b 보다 낮으면 -1, 같으면 0, 높으면 1. 둘 다 X.Y.Z 모양이어야 한다 */
export function cmpVersion(a: string, b: string): number {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

/** 판을 숫자 모양으로 맞춘다 (0000.0005.0000 → 0.5.0). X.Y.Z 모양이어야 쓴다 */
export function normalVersion(v: string): string {
  return v
    .split('.')
    .map((x) => String(Number(x)))
    .join('.');
}

/**
 * 요청 머리의 앱 판. 없거나 모양이 틀리면 undefined (gateOf 가 가장 낮은 판으로 본다). 숫자 모양으로 맞춘다.
 * 미리 나온 판(-beta.1)과 빌드 표시(+abc)는 떼고 본다: 0.5.0-beta 는 0.5.0 이다 (이슈 #127 버그잡이)
 */
export function appVersionOf(raw: unknown): string | undefined {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (typeof v !== 'string') return undefined;
  const t = v.trim().replace(/[-+].*$/, '');
  return isVersion(t) ? normalVersion(t) : undefined;
}

/**
 * 이 앱 판이 막히는가. 머리가 없거나 틀리면 아주 옛 앱으로 보고 0.0.0 으로 센다 (그러면 기준이 있는 한 막힌다).
 * 강제가 먼저 본다: 강제 기준보다 낮으면 force, 기능 제한 기준보다 낮으면 restrict
 */
export function gateOf(levels: UpdateLevels, app: string | undefined): GateNeed | undefined {
  const v = app ?? '0.0.0';
  if (levels.min && cmpVersion(v, levels.min) < 0) return { level: 'force', need: levels.min };
  if (levels.restrict && cmpVersion(v, levels.restrict) < 0)
    return { level: 'restrict', need: levels.restrict };
  return undefined;
}

/**
 * 세 기준의 순서 검사: 강제 ≤ 기능 제한 ≤ 권장 (정한 것끼리만 본다). 어긋나면 까닭 글, 맞으면 undefined
 */
export function levelsOrder(l: UpdateLevels): string | undefined {
  const named: [string, string | undefined][] = [
    ['강제', l.min],
    ['기능 제한', l.restrict],
    ['권장', l.recommend],
  ];
  const set = named.filter((x): x is [string, string] => !!x[1]);
  for (let i = 1; i < set.length; i++) {
    const [prevName, prev] = set[i - 1] as [string, string];
    const [name, cur] = set[i] as [string, string];
    if (cmpVersion(prev, cur) > 0)
      return `${name} ${cur} 는 ${prevName} ${prev} 보다 낮아요 (강제 ≤ 기능 제한 ≤ 권장)`;
  }
  return undefined;
}

/**
 * 관문을 건너는 요청인가 (메서드와 경로, 쿼리 뺀 것). 업데이트 전에도 되어야 하는 것: 상태 확인, 공지와 이벤트 파일,
 * 로그인 시작과 완료, 운영자 화면과 운영자 API, 내 계정 보기(업데이트 기준을 알려 준다), 로그아웃과 탈퇴.
 * 서버 관문(server/src/update-gate.ts)과 앱(server-core.ts)이 같이 쓴다.
 */
export function exempt(method: string, rawPath: string): boolean {
  const path = rawPath.toLowerCase();
  if (path === '/health' || path.startsWith('/auth/')) return true;
  if (/^\/admin(\/|\.|$)/.test(path)) return true;
  if (path.startsWith('/v1/admin/') || path.startsWith('/v1/auth/')) return true;
  // 공지와 이벤트 파일은 GET 과 HEAD (머리만 받는 확인) 모두 건넌다
  if (method === 'GET' || method === 'HEAD') {
    if (path === '/v1/notices.json' || path === '/v1/events.json') return true;
    return method === 'GET' && path === '/v1/me';
  }
  if (method === 'POST') return path === '/v1/session';
  if (method === 'DELETE') return path === '/v1/session' || path === '/v1/account';
  return false;
}
