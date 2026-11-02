// 설정 > 데이터와 계정 > "기기 간 동기화" 칸이 무엇을 보일지 고르는 규칙 (docs/sync-plan.md 7절). 화면 없이 시험한다.
import type { I18nKey } from './i18n/index.ts';
import { featureOn, type ServerStatus, serverView } from './server-account.ts';
import type { SyncProblem, SyncView } from './sync-view.ts';

/**
 * 칸이 보이나: 서버 계정이 켜졌고, 로그인했고, 엔진이 상태를 줬고, 서버가 기능 키 sync 를 열었을 때.
 * 키가 꺼졌어도 이 기기에서 동기화를 켜 둔 상태(phase 가 off 가 아님)면 끄기 위해 보인다
 */
export function syncShown(s: ServerStatus | null | undefined): boolean {
  if (!s || serverView(s) !== 'server' || !s.signedIn || !s.sync) return false;
  return featureOn(s, 'sync') || s.sync.phase !== 'off';
}

/** 서버 기능 키가 꺼졌는데 이 기기는 켜 둔 상태: "지금은 동기화를 쓸 수 없어" 와 끄기만 보인다 */
export function syncUnavailable(s: ServerStatus | null | undefined): boolean {
  return !!s && !featureOn(s, 'sync') && !!s.sync && s.sync.phase !== 'off';
}

/** 서버 상한(100MB)과 같은 1024 기준 크기 글 ("100MB", "1.5MB", "12KB") */
export function sizeText(n: number): string {
  const mb = n / 1048576;
  if (mb >= 1) return `${Number.isInteger(mb) || mb >= 10 ? Math.round(mb) : mb.toFixed(1)}MB`;
  return `${Math.max(1, Math.round(n / 1024))}KB`;
}

/**
 * 칸 모양. off: 꺼짐(켜기 단추), enabling: 켜는 중, code: 복구 코드 넣기(다른 기기, 서버 사본이 다시 시작됨, 다른 기기가 열쇠를 바꿈),
 * ask: 이 컴퓨터 항목을 올릴지 묻기, on: 켜짐
 */
export type SyncBoxMode = 'off' | 'enabling' | 'code' | 'ask' | 'on';

export function syncBoxMode(v: SyncView): SyncBoxMode {
  if (v.phase === 'enabling') return 'enabling';
  if (v.phase === 'needCode') return 'code';
  if (v.phase === 'askUpload') return 'ask';
  return v.phase === 'on' ? 'on' : 'off';
}

/** 복구 코드를 넣으라는 말: 멈춘 까닭에 따라 */
export function codeWhy(v: SyncView): I18nKey {
  if (v.problem === 'epoch') return 'sync.need.epoch';
  if (v.problem === 'gen') return 'sync.need.gen';
  return 'sync.need.lede';
}

/** 켜진 칸의 상태 줄 하나. at, n, pct 는 화면이 말에 채운다 */
export interface SyncLine {
  key: I18nKey;
  tone: 'ok' | 'warn' | 'error';
  at?: number;
  n?: number;
  pct?: number;
}

const PROBLEM_KEY: Record<SyncProblem, I18nKey> = {
  epoch: 'sync.need.epoch',
  gen: 'sync.need.gen',
  full: 'sync.problem.full',
  login: 'sync.problem.login',
  feature: 'sync.problem.feature',
  secure: 'sync.problem.secure',
  account: 'sync.problem.account',
  update: 'sync.problem.update',
};

/** 멈춘 까닭을 보일 말의 키 */
export const problemKey = (p: SyncProblem): I18nKey => PROBLEM_KEY[p];

/** 이 시간 안에 맞췄으면 "방금" */
export const FRESH_MS = 90_000;
/** 사용량이 이만큼을 넘으면 경고 */
export const USAGE_WARN = 0.8;

/** 사용량 비율(0~1). 모르면 null */
export function usageRatio(v: SyncView): number | null {
  const u = v.usage;
  if (!u) return null;
  const items = u.maxItems > 0 ? u.items / u.maxItems : 0;
  const bytes = u.maxBytes > 0 ? u.bytes / u.maxBytes : 0;
  return Math.max(items, bytes);
}

/** 켜진 칸의 상태 줄들 (위에서 아래 차례). 멈춘 까닭, 마지막 맞춤, 보낼 것, 맞추지 못한 것, 사용량 경고, 곧 지워짐 */
export function syncLines(v: SyncView, now: number): SyncLine[] {
  const out: SyncLine[] = [];
  if (v.problem && v.problem !== 'epoch' && v.problem !== 'gen')
    out.push({ key: PROBLEM_KEY[v.problem], tone: v.problem === 'full' ? 'warn' : 'error' });
  if (v.offline) out.push({ key: 'sync.on.offline', tone: 'warn' });
  else if (v.running) out.push({ key: 'sync.on.running', tone: 'ok' });
  else if (v.lastAt === null) out.push({ key: 'sync.on.never', tone: 'ok' });
  else if (now - v.lastAt < FRESH_MS) out.push({ key: 'sync.on.fresh', tone: 'ok' });
  else out.push({ key: 'sync.on.at', tone: 'ok', at: v.lastAt });
  if (v.pending > 0) out.push({ key: 'sync.on.pending', tone: 'ok', n: v.pending });
  if (v.held > 0) out.push({ key: 'sync.on.held', tone: 'warn', n: v.held });
  const r = usageRatio(v);
  if (r !== null && r >= USAGE_WARN)
    out.push({ key: 'sync.usage.warn', tone: 'warn', pct: Math.min(100, Math.round(r * 100)) });
  if (v.soon) out.push({ key: 'sync.soon', tone: 'warn' });
  return out;
}

/** 엔진이 돌려준 까닭 코드를 사용자에게 보일 말의 키로 */
export function syncErrorKey(error: string): I18nKey {
  switch (error) {
    case 'login':
      return 'sync.err.login';
    case 'secure':
      return 'sync.err.secure';
    case 'offline':
      return 'sync.err.offline';
    case 'code':
      return 'sync.need.bad';
    case 'params':
      return 'sync.err.params';
    case 'none':
      return 'sync.err.none';
    case 'epoch':
      return 'sync.need.epoch';
    case 'gen':
      return 'sync.need.gen';
    case 'key_rev':
      return 'sync.err.keyRev';
    case 'off':
      return 'sync.err.off';
    default:
      return 'sync.err.failed';
  }
}
