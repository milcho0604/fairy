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

/** 로그인 서비스. 어느 것을 보일지는 서버가 알려 준다 (GET /v1/auth/providers, 앱에 박아 두지 않는다) */
export type LoginService = 'google' | 'kakao';
export const isLoginService = (v: unknown): v is LoginService => v === 'google' || v === 'kakao';

/** 서버가 알려 준, 지금 쓸 수 있는 로그인. login: 로그인 전, link: 로그인한 뒤 더 이을 수 있는 것 */
export interface LoginProviders {
  login: LoginService[];
  link: LoginService[];
}

/** 서버 백업 하나 (#102). 날짜는 ISO 글 */
export interface ServerBackupItem {
  id: number;
  size: number;
  sha256: string;
  createdAt: string;
  expiresAt: string;
  /** 30일 안에 지워진다 (1년 동안 올리지도 받지도 않음) */
  soon: boolean;
}

/** 설정 칸의 서버 백업 (로그인했을 때만) */
export interface ServerBackupView {
  /** 서버가 백업을 열지 않았다 (503 backup_off) */
  off: boolean;
  /** 민감정보가 섞일 수 있다는 안내에 따로 동의했다 (이 컴퓨터에서) */
  agreed: boolean;
  /** 아직 목록을 못 받았으면 null */
  list: ServerBackupItem[] | null;
  keep: number;
  maxBytes: number;
  busy: 'up' | 'down' | null;
}

/** 서버 백업 단추의 결과. error 는 화면 글 키 끝 (backup.<error>) */
export interface ServerBackupResult {
  ok: boolean;
  error?: 'off' | 'offline' | 'tooBig' | 'full' | 'failed' | 'consent' | 'login' | 'busy' | 'open' | 'update';
  /** 되살리기 확인 칸을 열지 못한 까닭 (백업 파일 검사 글) */
  message?: string;
  status?: ServerStatus;
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
 * - noSecure: 운영체제 열쇠(safeStorage)를 못 써 토큰을 안전하게 둘 수 없음 (평문으로 두지 않고 서버 모드를 쉰다)
 * - keyLost: 토큰 파일을 지금 열쇠로 풀지 못함 (덮어쓰지 않고 서버 모드를 쉰다)
 * - update: 서버가 앱이 낡았다고 막음 (426, 이슈 #120). 서버 기능을 멈추고 업데이트 단추를 보인다 (대기열은 쌓아 둔다)
 */
export type ServerProblem =
  | 'offline'
  | 'server'
  | 'update'
  | 'gone'
  | 'loginOff'
  | 'denied'
  | 'timeout'
  | 'failed'
  | 'noSecure'
  | 'keyLost';

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
  /** 채팅 이용권(AI 대화권)을 쓸 수 있다 (#100, #101): 서버 모드, 만 18세 이상, 구글 로그인, 운영자가 열어 둠 */
  ai: boolean;
  /** 남은 채팅 이용권의 사본. 쓸 수 없거나 아직 못 받았으면 null */
  tickets: number | null;
  /** 채팅 이용권 자리가 차서 대기 중이다 (#101) */
  aiWaitlisted: boolean;
  /** 운영자가 건 정기 지급 (#101). 없으면 null */
  subscription: { monthly: number; nextFill: string | null } | null;
  /** 닉네임 (#101). 아직 정하지 않았으면 null */
  nickname: string | null;
  /** 서버가 준 기기 코드 F-XXXX-XXXX (#101). 계정이 없으면 null */
  code: string | null;
  /** 아직 열지 않은 서버 쪽지 수 (#101) */
  inbox: number;
  /** 운영자 계정이다 (#101, 서버가 정한다). 아니면 운영자 칸을 그리지 않는다 */
  admin: boolean;
  /** 서버가 알려 준 로그인 서비스. 아직 모르면 null (그때는 구글 단추만 예전처럼 보인다) */
  providers: LoginProviders | null;
  /** 이 계정에 이은 로그인 서비스 (세션을 받을 때 서버가 알려 준 것) */
  logins: LoginService[];
  /** 서버 백업 (로그인했을 때만, 아니면 null) */
  backup: ServerBackupView | null;
  /** 서버가 알려 준 이 계정의 기능 키 (GET /v1/features). 서버 모드가 아니거나 아직 모르면 null */
  features: Record<string, boolean> | null;
  /**
   * 같은 계정의 다른 기기에서 구글 일정을 연결했는데 이 기기는 아직이다 (#115): 캘린더 칸에 "이 기기도 연결할까?"를 보인다.
   * 로그인, 서버 모드, 기능 키 calendar_link_hint 가 켜졌을 때만. 이 기기에서 거절했으면 다시 묻지 않는다
   */
  calendarHint: boolean;
}

/** 앱이 서버에 묻는 기능 키 (server/src/features.ts 와 같은 이름) */
export type AppFeature = 'coin_reset' | 'calendar_link_hint';

/**
 * 기능 키가 켜졌나. 앱의 기본값은 여기 한 곳: 서버 주소가 없거나, 만 14세 미만(앱 안 모드)이거나, 서버 모드를 껐거나,
 * 서버에 아직 닿지 않았으면 꺼짐(숨김). 서버가 켜졌다고 알려 줄 때만 켠다
 */
export function featureOn(s: Pick<ServerStatus, 'features'> | null | undefined, key: AppFeature): boolean {
  return s?.features?.[key] === true;
}

/** 닉네임 검사 실패의 까닭 (shared/account-profile.ts) 과 서버에 닿지 않음 */
export type NicknameProblem = 'length' | 'chars' | 'url' | 'at' | 'offline' | 'server';

/**
 * 운영자 쓰기 결과 (#101). text 는 서버가 쓴 한국어 글, code 는 앱이 말에 맞게 바꿀 코드
 * (성공이면 운영 기록의 행동 이름, 실패면 까닭), data 는 덧붙일 값 (만든 쿠폰 코드)
 */
export interface AdminActionResult {
  ok: boolean;
  text: string;
  code?: string;
  data?: Record<string, string | number>;
}

/** 선물 받기, 쿠폰 결과 (#101) */
export type RewardOutcome = { ok: true; coins: number; tickets: number } | { ok: false; error: string };

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
  updateNow: 'server:update-now',
  syncNow: 'server:sync-now',
  login: 'server:login',
  cancelLogin: 'server:cancel-login',
  logout: 'server:logout',
  merge: 'server:merge',
  remove: 'server:remove',
  changed: 'server:changed',
  setNickname: 'server:set-nickname',
  copyCode: 'server:copy-code',
  claim: 'server:claim',
  coupon: 'server:coupon',
  /** 운영자 칸 (#101): 운영자 계정일 때만 메인이 받는다 */
  adminOverview: 'server:admin-overview',
  adminAction: 'server:admin-action',
  backupList: 'server:backup-list',
  backupAgree: 'server:backup-agree',
  backupUpload: 'server:backup-upload',
  backupDownload: 'server:backup-download',
  backupDelete: 'server:backup-delete',
  /** 다른 기기의 구글 일정 연결 안내를 이 기기에서 거절 (#115) */
  calendarHintNo: 'server:calendar-hint-no',
} as const;

/** 운영 기록 찾기 (#155): 대상 이용자(번호, 기기 코드, 닉네임), 동작 종류, 글, 쪽 */
export interface AdminLogFilter {
  user?: string;
  action?: string;
  text?: string;
  page?: number;
}

/** 설정 창이 부르는 것 (preload 가 window.jjakkungServer 로 연다) */
export interface ServerBridge {
  status(): Promise<ServerStatus | undefined>;
  /** 나이 답. 서버 모드를 처음 켤 때는 닉네임도 같이 (만 14세 미만은 보내지 않는다) */
  setAge(age: AgeAnswer, nickname?: string): Promise<ServerStatus | undefined>;
  setNickname(
    nickname: string,
  ): Promise<{ ok: boolean; problem?: NicknameProblem; status: ServerStatus | undefined }>;
  /** 기기 코드를 클립보드로 */
  copyCode(): Promise<boolean>;
  /** 이벤트 선물 받기 */
  claim(eventId: string): Promise<RewardOutcome>;
  /** 쿠폰 쓰기 */
  coupon(code: string): Promise<RewardOutcome>;
  /** 운영자 칸 (운영자가 아니면 undefined) */
  adminOverview(q?: string, log?: AdminLogFilter): Promise<Record<string, unknown> | undefined>;
  adminAction(
    action: string,
    fields: Record<string, string | string[] | boolean | number>,
  ): Promise<AdminActionResult>;
  /** 탈퇴 뒤 서버 모드를 다시 켠다 */
  turnOn(): Promise<ServerStatus | undefined>;
  /** 업데이트 단추 (이슈 #120): 서버가 낡은 앱이라고 막았을 때. 기존 업데이트 흐름을 연다 */
  updateNow(): Promise<ServerStatus | undefined>;
  syncNow(): Promise<ServerStatus | undefined>;
  /** 서비스로 로그인 (로그인했으면 그 서비스를 더 잇는다). 비우면 구글 */
  login(service?: LoginService): Promise<ServerStatus | undefined>;
  cancelLogin(): void;
  logout(): Promise<ServerStatus | undefined>;
  /** 합치기 확인 창의 답 */
  merge(yes: boolean): Promise<ServerStatus | undefined>;
  /** 탈퇴: 서버 계정을 지운다 (앱 안 데이터는 남는다) */
  remove(): Promise<{ ok: boolean; status: ServerStatus | undefined }>;
  onChanged(listener: (s: ServerStatus) => void): () => void;
  /** 서버 백업 목록을 다시 받는다 */
  backupList(): Promise<ServerStatus | undefined>;
  /** 민감정보 안내에 따로 동의 (false 면 거둔다) */
  backupAgree(yes: boolean): Promise<ServerStatus | undefined>;
  backupUpload(): Promise<ServerBackupResult>;
  /** 받아서 되살리기 확인 칸을 연다 (바꾸기는 그 칸에서) */
  backupDownload(id: number): Promise<ServerBackupResult>;
  backupDelete(id: number): Promise<ServerBackupResult>;
  /** 다른 기기의 구글 일정 연결 안내: 이 기기에서는 다시 묻지 않는다 (#115) */
  calendarHintNo(): Promise<ServerStatus | undefined>;
}
