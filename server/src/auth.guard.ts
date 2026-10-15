import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Db } from './db';
import { ipKey, LIMITS, RateLimiter } from './rate-limit';
import { sameBytes, sha256, tokenKind } from './tokens';

// Authorization: Bearer <기기 토큰 또는 세션 토큰>. 토큰 해시로 찾고 해시를 상수 시간으로 한 번 더 비교한다.
// 찾은 계정이 합쳐져 닫혔으면(옛 세션) 남는 쪽으로 따라간다. 계정마다 레이트리밋을 센다.

export interface AuthInfo {
  accountId: string;
  via: 'device' | 'session';
  /** 기기 토큰으로 왔을 때의 기기 번호 */
  deviceId: string | null;
  /** 세션으로 왔을 때의 세션 번호 */
  sessionId: string | null;
}

export interface HttpReq {
  headers: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string | undefined };
  auth?: AuthInfo;
}

/** 세션을 마지막으로 쓴 뒤 이만큼 지나면 무효 */
export const SESSION_IDLE_DAYS = 180;

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly db: Db,
    private readonly limiter: RateLimiter,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<HttpReq>();
    const auth = await this.identify(req);
    if (!auth) {
      this.limiter.check(`bad:${ipKey(req)}`, LIMITS.badTokenByIp);
      throw new UnauthorizedException({ error: 'token' });
    }
    this.limiter.check(`acct:${auth.accountId}`, LIMITS.account);
    req.auth = auth;
    return true;
  }

  /**
   * 토큰이 있으면 누구인지 (없거나 틀리면 undefined, 던지지 않는다). 토큰 없이도 되는 경로(GET /v1/auth/providers)가
   * 요청자에 맞춰 답할 때 쓴다
   */
  async identify(req: HttpReq): Promise<AuthInfo | undefined> {
    const raw = req.headers.authorization;
    const header = Array.isArray(raw) ? raw[0] : raw;
    const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
    return this.resolve(token);
  }

  /** 토큰을 계정으로 (모양이 틀리거나 모르는 토큰이면 undefined). 운영자 API 도 쓴다 (admin.ts) */
  async resolve(token: string): Promise<AuthInfo | undefined> {
    const kind = tokenKind(token);
    return kind ? this.lookup(kind, token) : undefined;
  }

  private async lookup(kind: 'device' | 'session', token: string): Promise<AuthInfo | undefined> {
    const hash = sha256(token);
    const table = kind === 'device' ? 'device' : 'session';
    // 세션은 마지막으로 쓴 뒤 SESSION_IDLE_DAYS 가 지나면 무효
    const alive =
      kind === 'session' ? `AND t.last_used_at > now() - interval '${SESSION_IDLE_DAYS} days'` : '';
    const r = await this.db.pool.query<{
      id: string;
      token_hash: Buffer;
      account_id: string;
      stale: boolean;
      idle: boolean;
    }>(
      `SELECT t.id, t.token_hash, COALESCE(a.merged_into, a.id) AS account_id,
              ${kind === 'session' ? "t.last_used_at < now() - interval '1 day'" : 'false'} AS stale,
              a.last_active_at < now() - interval '1 day' AS idle
         FROM ${table} t JOIN account a ON a.id = t.account_id
        WHERE t.token_hash = $1 ${alive}`,
      [hash],
    );
    const row = r.rows[0];
    if (!row || !sameBytes(row.token_hash, hash)) return undefined;
    // 쓴 때는 하루 한 번만 적는다 (요청마다 쓰지 않게)
    // 계정 활동(서버 백업 1년 정리의 기준, backup.ts)도 하루 한 번만 적는다. 기기 토큰이든 세션이든 요청이 오면 활동이다
    if (row.idle)
      await this.db.pool.query('UPDATE account SET last_active_at = now() WHERE id = $1', [row.account_id]);
    if (row.stale)
      await this.db.pool.query('UPDATE session SET last_used_at = now() WHERE id = $1', [row.id]);
    return {
      accountId: row.account_id,
      via: kind,
      deviceId: kind === 'device' ? row.id : null,
      sessionId: kind === 'session' ? row.id : null,
    };
  }
}

/** 가드가 붙인 인증 정보 */
export const Auth = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthInfo => {
  const auth = ctx.switchToHttp().getRequest<HttpReq>().auth;
  if (!auth) throw new UnauthorizedException({ error: 'token' });
  return auth;
});
