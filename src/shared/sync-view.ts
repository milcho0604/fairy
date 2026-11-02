// 기기 간 동기화의 상태 (설정 창이 서버 상태 ServerStatus.sync 로 받는다, docs/sync-plan.md 7절).

/**
 * off: 꺼짐, enabling: 켜는 중, needCode: 복구 코드 넣기 필요, on: 켜짐,
 * askUpload: 이 컴퓨터는 다른 계정과 맞추던 것이라, 이 컴퓨터 항목을 이 계정에 올릴지 서버 것만 받을지 고를 때까지 멈춤
 */
export type SyncPhase = 'off' | 'enabling' | 'needCode' | 'askUpload' | 'on';

/**
 * 멈춘 까닭. epoch: 다른 곳에서 서버 사본을 지우고 다시 시작했다, gen: 다른 기기가 열쇠를 바꿨다,
 * full: 서버 공간이 찼다, login: 로그인이 필요하다, feature: 이 계정에는 아직 열리지 않았다,
 * secure: 운영체제 열쇠를 쓸 수 없다, account: 다른 계정으로 바뀌어 지웠다, update: 앱을 올려야 한다
 */
export type SyncProblem = 'epoch' | 'gen' | 'full' | 'login' | 'feature' | 'secure' | 'account' | 'update';

export interface SyncView {
  phase: SyncPhase;
  problem: SyncProblem | null;
  /** 마지막으로 맞춘 시각 */
  lastAt: number | null;
  /** 서버에 닿지 않아 나중에 다시 한다 */
  offline: boolean;
  /** 아직 서버로 못 보낸 항목 수 */
  pending: number;
  /** 풀지 못하거나 적용하지 못해 따로 둔 항목 수 */
  held: number;
  /** 서버 사용량 (아직 모르면 null) */
  usage: { items: number; bytes: number; maxItems: number; maxBytes: number } | null;
  /** 1년 동안 맞추지 않아 곧 서버 사본이 지워진다 */
  soon: boolean;
  /** 맞추는 중 */
  running: boolean;
}
