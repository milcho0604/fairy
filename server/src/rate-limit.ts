import { createHash } from 'node:crypto';
import { HttpException, HttpStatus, Injectable, type OnModuleDestroy } from '@nestjs/common';

// 메모리 레이트리밋 (기획서 14절). 기기와 계정 단위가 기본이고, 아직 토큰이 없는 요청(기기 만들기, 로그인)은
// Cloudflare 가 붙이는 cf-connecting-ip 를 보조로 쓴다. IP 는 저장하지 않는다: 메모리 키도 해시로만 두고 창이 지나면 지운다.

export interface Limit {
  /** 창 하나에 허락하는 수 */
  max: number;
  /** 창 길이 (ms) */
  windowMs: number;
}

export const LIMITS = {
  /** 기기 계정 만들기: 같은 곳에서 한 시간 20개 */
  deviceByIp: { max: 20, windowMs: 3_600_000 },
  /** 기기 계정 만들기: 같은 곳에서 하루 40개 (한 시간 상한을 하루 내내 채우지 못하게) */
  deviceByIpDay: { max: 40, windowMs: 86_400_000 },
  /** 기기 계정 만들기 전체: 한 시간 500개 (cf-connecting-ip 가 없는 요청이 한 곳으로 몰려도 서버를 지킨다) */
  deviceAll: { max: 500, windowMs: 3_600_000 },
  /** 구글 로그인 시작, 돌아오기, 세션 바꾸기: 같은 곳에서 10분 30번 */
  loginByIp: { max: 30, windowMs: 600_000 },
  /** 토큰을 든 요청: 계정마다 1분 120번 (맞추기는 몇 분에 한 번) */
  account: { max: 120, windowMs: 60_000 },
  /** AI 대화권 질문과 신고: 계정마다 1분 10번 (하루 상한은 따로 DB 로 센다) */
  aiByAccount: { max: 10, windowMs: 60_000 },
  /** 서버 백업 올리기: 계정마다 한 시간 10번 (누를 때만, 한 번에 20MB 까지) */
  backupPut: { max: 10, windowMs: 3_600_000 },
  /** 서버 백업 받기: 계정마다 한 시간 20번 */
  backupGet: { max: 20, windowMs: 3_600_000 },
  /** 토큰이 틀린 요청: 같은 곳에서 1분 30번 */
  badTokenByIp: { max: 30, windowMs: 60_000 },
  /** 선물 받기: 계정마다 1분 20번 */
  claimByAccount: { max: 20, windowMs: 60_000 },
  /** 쿠폰 쓰기 시도: 계정마다 10분 10번, 같은 곳에서 한 시간 30번 (코드 추측을 막는다) */
  couponByAccount: { max: 10, windowMs: 600_000 },
  couponByIp: { max: 30, windowMs: 3_600_000 },
  /** 없는 쿠폰 코드: 계정마다 한 시간 5번까지 틀릴 수 있다. 넘으면 그 시간 동안 쿠폰을 받지 않는다 */
  couponMissByAccount: { max: 5, windowMs: 3_600_000 },
  /** 친구 신청과 차단 (#110): 계정마다 10분 10번, 같은 곳에서 한 시간 60번 (기기 코드 추측을 막는다) */
  friendByAccount: { max: 10, windowMs: 600_000 },
  friendByIp: { max: 60, windowMs: 3_600_000 },
  /** 없는 기기 코드로 신청: 계정마다 한 시간 5번까지. 넘으면 그 시간 동안 신청을 받지 않는다 */
  friendMissByAccount: { max: 5, windowMs: 3_600_000 },
  /** 친구 선물: 계정마다 1분 20번 (하루 상한은 따로 DB 로 센다) */
  giftByAccount: { max: 20, windowMs: 60_000 },
  /** 바쁜 시간대 올리기: 계정마다 한 시간 30번 (앱은 몇 분마다, 바뀌었을 때만) */
  busyByAccount: { max: 30, windowMs: 3_600_000 },
  /** 운영자 로그인 실패: 같은 곳에서 15분 5번 (넘으면 맞는 토큰도 받지 않는다). 서버 전체 15분 20번은 막지 않고 경고만 */
  adminFailByIp: { max: 5, windowMs: 900_000 },
  adminFailAll: { max: 20, windowMs: 900_000 },
  /** 운영자 화면 요청: 세션마다 1분 120번 */
  adminBySession: { max: 120, windowMs: 60_000 },
  /** 공개 정적 파일 내보내기 (Actions 가 10분마다 읽는다): 같은 곳에서 1분 30번 */
  feedByIp: { max: 30, windowMs: 60_000 },
} as const satisfies Record<string, Limit>;

type Window = { start: number; n: number; windowMs: number };

@Injectable()
export class RateLimiter implements OnModuleDestroy {
  #windows = new Map<string, Window>();
  #sweep: NodeJS.Timeout;

  constructor(private readonly now: () => number = Date.now) {
    this.#sweep = setInterval(() => this.sweep(), 60_000);
    this.#sweep.unref();
  }

  /** 한 번 센다. 창 안에서 max 를 넘으면 false */
  take(key: string, limit: Limit): boolean {
    const now = this.now();
    const w = this.#windows.get(key);
    if (!w || now - w.start >= w.windowMs) {
      this.#windows.set(key, { start: now, n: 1, windowMs: limit.windowMs });
      return true;
    }
    w.n += 1;
    return w.n <= limit.max;
  }

  /** 세지 않고 본다: 창 안에서 이미 max 번을 썼으면 true */
  over(key: string, limit: Limit): boolean {
    const w = this.#windows.get(key);
    return !!w && this.now() - w.start < w.windowMs && w.n >= limit.max;
  }

  /** take 가 false 면 429 */
  check(key: string, limit: Limit): void {
    if (!this.take(key, limit))
      throw new HttpException({ error: 'rate_limited' }, HttpStatus.TOO_MANY_REQUESTS);
  }

  sweep(): void {
    const now = this.now();
    for (const [k, w] of this.#windows) if (now - w.start >= w.windowMs) this.#windows.delete(k);
  }

  onModuleDestroy(): void {
    clearInterval(this.#sweep);
  }
}

/**
 * 요청을 보낸 곳의 키. cf-connecting-ip 를, 없으면 소켓 원격 주소를 해시로만 쓴다(한 키로 몰지 않는다).
 * 둘 다 없을 때만 'ip:none'
 */
export function ipKey(req: {
  headers: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string | undefined };
}): string {
  const raw = req.headers['cf-connecting-ip'];
  const ip = (Array.isArray(raw) ? raw[0] : raw)?.trim() || req.socket?.remoteAddress;
  if (!ip) return 'ip:none';
  return `ip:${createHash('sha256').update(ip).digest('base64url').slice(0, 16)}`;
}
