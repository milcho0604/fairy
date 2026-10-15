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
  /** 토큰이 틀린 요청: 같은 곳에서 1분 30번 */
  badTokenByIp: { max: 30, windowMs: 60_000 },
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
