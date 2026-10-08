// 받기와 저장 실패를 사람이 읽을 안내로 바꾼다. 원문(err.message)은 기록에만 남기고 화면에는 이 글만 보낸다.
// 원문은 "net::ERR_INTERNET_DISCONNECTED", "ENOSPC: no space left on device, write" 처럼 영어 개발자 말이라
// 한국어 화면에 그대로 뜨면 무엇을 해야 할지 모른다 (2026-10-08 회귀 시험)
import { t } from './i18n/index.ts';

/** 실패 갈래. 사용자가 할 일이 달라지는 만큼만 나눈다 */
export type FailReason =
  | 'offline' // 인터넷에 안 붙음: 연결을 확인
  | 'network' // 붙었는데 끊김, 시간 초과, 연결 거절, 프록시 실패: 연결 확인 뒤 다시
  | 'server' // 서버가 오류로 답함(5xx 등): 잠시 뒤 다시
  | 'gone' // 파일이 서버에 없음(404, 410): 다시 해도 안 됨, 앱 업데이트
  | 'hash' // 받은 파일이 원본과 다름: 다시, 계속되면 회사 프록시 등
  | 'disk-full' // 저장 공간 모자람: 비우고 다시
  | 'no-permission' // 폴더에 쓸 수 없음
  | 'busy' // 같은 파일을 이미 받는 중
  | 'cancelled' // 사용자가 멈춤
  | 'failed'; // 그 밖

/** 우리가 던지는 받기 실패. 갈래와 (있으면) 서버 상태 번호를 들고 다닌다 */
export class DownloadError extends Error {
  readonly reason: FailReason;
  readonly status: number | undefined;
  constructor(reason: FailReason, status?: number) {
    super(status === undefined ? `download ${reason}` : `download ${reason} (${status})`);
    this.name = 'DownloadError';
    this.reason = reason;
    this.status = status;
  }
}

/** 서버 상태 번호로 갈래를 고른다. 없어진 파일은 다시 해도 소용없어 따로 둔다 */
export const statusReason = (status: number): FailReason =>
  status === 404 || status === 410 ? 'gone' : 'server';

// Chromium 네트워크 오류 중 "인터넷에 아예 안 붙은" 것. 나머지 net::ERR_ 는 연결 문제(network)로 본다
const OFFLINE =
  /net::ERR_(INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|NAME_RESOLUTION_FAILED|ADDRESS_UNREACHABLE|NETWORK_ACCESS_DENIED|NETWORK_CHANGED)\b/;
const NET = /net::ERR_\w+/;
const DISK_FULL = new Set(['ENOSPC', 'EDQUOT']);
const NO_PERMISSION = new Set(['EACCES', 'EPERM', 'EROFS']);
const OFFLINE_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH']);
const NET_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'ECONNABORTED', 'ETIMEDOUT', 'EPIPE']);

/** 실패 원인을 갈래로. aborted 는 우리 쪽 AbortSignal 이 멈췄는지 (멈춘 뒤 나는 오류는 모양이 제각각이다) */
export function failReason(err: unknown, aborted = false): FailReason {
  if (aborted) return 'cancelled';
  if (err instanceof DownloadError) return err.reason;
  if (!(err instanceof Error)) return 'failed';
  if (err.name === 'AbortError') return 'cancelled';
  const code = (err as { code?: unknown }).code;
  if (typeof code === 'string') {
    if (DISK_FULL.has(code)) return 'disk-full';
    if (NO_PERMISSION.has(code)) return 'no-permission';
    if (OFFLINE_CODES.has(code)) return 'offline';
    if (NET_CODES.has(code)) return 'network';
  }
  // 감싸져 와서 code 가 없어진 경우 (IPC, pipeline 너머)
  const msg = err.message;
  if (/\bENOSPC\b|\bEDQUOT\b/.test(msg)) return 'disk-full';
  if (/\bEACCES\b|\bEPERM\b|\bEROFS\b/.test(msg)) return 'no-permission';
  if (OFFLINE.test(msg)) return 'offline';
  if (err.name === 'TimeoutError' || NET.test(msg)) return 'network';
  return 'failed';
}

/** 모델 받기 실패를 화면 글로. mb 는 받을 크기 (공간이 모자랄 때 얼마나 비울지 알린다) */
export function downloadErrorText(err: unknown, o: { aborted?: boolean; mb?: number } = {}): string {
  const reason = failReason(err, o.aborted);
  const status = err instanceof DownloadError ? err.status : undefined;
  switch (reason) {
    case 'offline':
      return t('main.model.offline');
    case 'network':
      return t('main.model.network');
    case 'server':
      return t('main.model.server', { status: status ?? 0 });
    case 'gone':
      return t('main.model.gone', { status: status ?? 404 });
    case 'hash':
      return t('main.model.badHash');
    case 'disk-full':
      return o.mb ? t('main.model.diskFull', { mb: o.mb }) : t('main.file.diskFull');
    case 'no-permission':
      return t('main.file.noPermission');
    case 'busy':
      return t('main.model.busy');
    case 'cancelled':
      return t('main.model.cancelled');
    default:
      return t('main.model.failed');
  }
}

/** 파일 쓰기(펫 저장, 펫 가져오기) 실패를 화면 글로 */
export function saveErrorText(err: unknown): string {
  const reason = failReason(err);
  if (reason === 'disk-full') return t('main.file.diskFull');
  if (reason === 'no-permission') return t('main.file.noPermission');
  return t('main.file.saveFailed');
}
