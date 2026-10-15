// 페어리 서버 계정 (기획서 5, 6, 21절, 이슈 #99): 나이 확인과 두 모드, 기기 계정, 코인 맞추기, 구글 로그인, 탈퇴.
// 설정 창과 메인이 같이 쓰는 모양만 둔다. 토큰과 네트워크는 메인(main/server-core.ts)에만 있다.

/** 나이 답 (생년월일은 받지 않는다). 만 14세 미만, 만 14세 이상 18세 미만, 만 18세 이상 */
export const AGE_ANSWERS = ['under14', 'teen', 'adult'] as const;
export type AgeAnswer = (typeof AGE_ANSWERS)[number];

export const isAgeAnswer = (v: unknown): v is AgeAnswer =>
  typeof v === 'string' && (AGE_ANSWERS as readonly string[]).includes(v);

/** 서버에 보내는 나이 구분. 만 14세 미만은 서버 모드가 아니라 보낼 것이 없다 */
export function ageClass(age: AgeAnswer | null): '14+' | '18+' | undefined {
  if (age === 'teen') return '14+';
  if (age === 'adult') return '18+';
  return undefined;
}

/** 산 물건 (서버 owned_item 모양): house 는 단계, toy:<이름>, house-style:<모양> 은 1 */
export type Items = Record<string, number>;

/** 잔액과 산 물건 한 벌 (합치기 확인 창에 두 계정을 보인다) */
export interface AccountSummary {
  balance: number;
  items: Items;
}

/**
 * 칸에 보일 문제
 * - offline: 서버에 닿지 않음 (앱은 사본 잔액으로 계속 돈다)
 * - server: 서버가 받지 않음 (5xx, 모르는 대답)
 * - gone: 서버 계정이 없어짐 (다른 기기에서 탈퇴)
 * - loginOff: 서버가 로그인을 아직 열지 않음
 * - denied, timeout, failed: 로그인을 못 함
 */
export type ServerProblem = 'offline' | 'server' | 'gone' | 'loginOff' | 'denied' | 'timeout' | 'failed';

export interface ServerStatus {
  /** 서버 주소가 있다. 없으면 칸을 통째로 숨긴다 */
  enabled: boolean;
  age: AgeAnswer | null;
  /** 서버 모드를 켰다 (만 14세 이상이고 끄거나 탈퇴하지 않았다) */
  on: boolean;
  /** 기기 계정이 있다 */
  device: boolean;
  /** 구글로 로그인했다 */
  signedIn: boolean;
  /** 브라우저에서 로그인을 기다리는 중 */
  loggingIn: boolean;
  syncing: boolean;
  /** 서버 정본 잔액의 사본. 아직 못 받았으면 null */
  balance: number | null;
  /** 아직 서버로 못 보낸 코인 기록 수 */
  pending: number;
  lastSyncAt: number | null;
  problem: ServerProblem | null;
  /** 다른 계정과 합칠지 묻는 중 (두 잔액) */
  merge: { current: AccountSummary; other: AccountSummary } | null;
  /** 만 14세 미만으로 바꿨는데 서버에 계정이 남아 있다 (탈퇴 안내) */
  leftover: boolean;
}

/** 칸 모양: 숨김, 나이 묻기, 앱 안 모드, 서버 모드 꺼짐(탈퇴 뒤 등), 서버 모드 */
export type ServerView = 'hidden' | 'askAge' | 'appMode' | 'serverOff' | 'server';

export function serverView(s: Pick<ServerStatus, 'enabled' | 'age' | 'on'> | null | undefined): ServerView {
  if (!s?.enabled) return 'hidden';
  if (s.age === null) return 'askAge';
  if (s.age === 'under14') return 'appMode';
  return s.on ? 'server' : 'serverOff';
}

export const SERVER = {
  status: 'server:status',
  setAge: 'server:set-age',
  turnOn: 'server:turn-on',
  syncNow: 'server:sync-now',
  login: 'server:login',
  cancelLogin: 'server:cancel-login',
  logout: 'server:logout',
  merge: 'server:merge',
  remove: 'server:remove',
  changed: 'server:changed',
} as const;

/** 설정 창이 부르는 것 (preload 가 window.jjakkungServer 로 연다) */
export interface ServerBridge {
  status(): Promise<ServerStatus | undefined>;
  setAge(age: AgeAnswer): Promise<ServerStatus | undefined>;
  /** 탈퇴 뒤 서버 모드를 다시 켠다 */
  turnOn(): Promise<ServerStatus | undefined>;
  syncNow(): Promise<ServerStatus | undefined>;
  login(): Promise<ServerStatus | undefined>;
  cancelLogin(): void;
  logout(): Promise<ServerStatus | undefined>;
  /** 합치기 확인 창의 답 */
  merge(yes: boolean): Promise<ServerStatus | undefined>;
  /** 탈퇴: 서버 계정을 지운다 (앱 안 데이터는 남는다) */
  remove(): Promise<{ ok: boolean; status: ServerStatus | undefined }>;
  onChanged(listener: (s: ServerStatus) => void): () => void;
}
