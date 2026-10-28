import { Inject, Injectable } from '@nestjs/common';
import { CONFIG } from './app.tokens';
import type { AuthInfo } from './auth.guard';
import type { Config } from './config';
import { Db } from './db';

// 운영자 계정 판정 (이슈 #101 범위 추가 2). 운영자는 .env 의 ADMIN_GOOGLE_SUBS 에 적은 구글 sub 의 로그인이 붙은 계정의
// 세션(fs_)뿐이다. 기기 토큰(fd_)은 언제나 운영자가 아니다. 캐시하지 않는다: 요청마다 DB 로 다시 보므로 설정에서 빼고
// 다시 띄우면 바로 403 이다. sub 는 화면이나 기록에 내보내지 않는다.

@Injectable()
export class AdminAccess {
  constructor(
    private readonly db: Db,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  /** 이 계정에 운영자 구글 로그인이 붙어 있나 (세션인지는 보지 않는다. AI 허용 목록에 쓴다) */
  async isAdminAccount(accountId: string, q: Pick<Db['pool'], 'query'> = this.db.pool): Promise<boolean> {
    const subs = this.config.adminSubs ?? [];
    if (subs.length === 0) return false;
    // 트랜잭션 안에서는 그 클라이언트(q)로 묻는다: 풀에서 연결을 하나 더 잡으면 풀이 찬 때 서로 기다려 멎는다
    const r = await q.query(
      `SELECT 1 FROM login WHERE account_id = $1 AND service = 'google' AND sub = ANY($2::text[]) LIMIT 1`,
      [accountId, subs],
    );
    return (r.rowCount ?? 0) > 0;
  }

  /** 운영자인가: 세션 토큰이고 운영자 구글 로그인이 붙은 계정 */
  async isAdmin(auth: AuthInfo | undefined): Promise<boolean> {
    return !!auth && auth.via === 'session' && (await this.isAdminAccount(auth.accountId));
  }
}
