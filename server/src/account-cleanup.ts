import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit, Optional } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { Accounts, type LockedAccount } from './accounts';
import { CLOCK } from './app.tokens';
import { Backups } from './backup';
import { Db } from './db';

// 오래 안 쓴 기기 계정 정리 (개인정보처리방침 #104, 사용자 결정 2026-10-16).
// 앱을 지우면 로그인 없는 기기 계정은 다시 찾을 수 없으므로, 1년 동안 쓰지 않은 것은 서버에서 지운다.
// - 지우는 것: 1년 동안 요청(account.last_active_at)이 없고, 세션도 로그인(구글, 카카오)도 없는 계정.
//   합쳐서 닫힌 계정(merged_into)은 남는 쪽을 따라간다: 남는 쪽이 지워질 때 함께 지워진다.
// - 안 지우는 것: 세션이 있는 계정(로그인해 둔 사람), 로그인 연결이 있는 계정(로그아웃해도 구글로 다시 찾을 수 있다),
//   1년 안에 쓴 계정.
// - 지우는 방식은 탈퇴와 같다 (Accounts.delete): 코인 내역, 기기, 쪽지함, 서버 백업 줄, 친구와 선물 등 딸린 행이 함께
//   지워지고, 서버 백업 파일은 디스크에서도 바로 지운다. 탈퇴 길에 선물 돌려주기(#135)가 들어오면 이쪽도 같이 탄다.
// - 계정을 잠근 뒤에 조건을 다시 따진다: 후보를 읽은 사이 로그인하거나 요청을 보낸 계정은 지우지 않는다.

export const ACCOUNT_IDLE_DAYS = 365;
const DAY_MS = 86_400_000;
const SWEEP_MS = 6 * 3_600_000;
/** 한 번에 지우는 계정 수 (한꺼번에 많이 쌓였어도 서버를 오래 붙잡지 않게. 다음 돌 때 이어서 지운다) */
const BATCH = 200;

/** 지울 수 있는 계정인가 (계정이 잠긴 트랜잭션 안에서 다시 따진다) */
async function stillIdle(c: PoolClient, a: LockedAccount, cutoff: Date): Promise<boolean> {
  const r = await c.query<{ ok: boolean }>(
    `SELECT (a.merged_into IS NULL AND a.last_active_at < $2
             AND NOT EXISTS (SELECT 1 FROM session s WHERE s.account_id = a.id)
             AND NOT EXISTS (SELECT 1 FROM login l WHERE l.account_id = a.id)) AS ok
       FROM account a WHERE a.id = $1`,
    [a.id, cutoff],
  );
  return r.rows[0]?.ok === true;
}

@Injectable()
export class AccountCleanup implements OnModuleInit, OnModuleDestroy {
  #sweep: NodeJS.Timeout | undefined;
  private readonly clock: () => number;

  constructor(
    private readonly db: Db,
    private readonly accounts: Accounts,
    private readonly backups: Backups,
    @Optional() @Inject(CLOCK) clock?: () => number,
  ) {
    this.clock = clock ?? Date.now;
  }

  onModuleInit(): void {
    const run = () =>
      void this.sweep().catch((err) => console.warn('[account-cleanup] 정리 실패:', (err as Error).message));
    run();
    this.#sweep = setInterval(run, SWEEP_MS);
    this.#sweep.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.#sweep);
  }

  /** 정리 한 번. 시험은 now 를 넘겨 1년 뒤를 흉내 낸다. 지운 계정 수를 돌려준다 */
  async sweep(now = this.clock()): Promise<{ deleted: number }> {
    const cutoff = new Date(now - ACCOUNT_IDLE_DAYS * DAY_MS);
    const cand = await this.db.pool.query<{ id: string }>(
      `SELECT a.id FROM account a
        WHERE a.merged_into IS NULL AND a.last_active_at < $1
          AND NOT EXISTS (SELECT 1 FROM session s WHERE s.account_id = a.id)
          AND NOT EXISTS (SELECT 1 FROM login l WHERE l.account_id = a.id)
        ORDER BY a.last_active_at, a.id
        LIMIT ${BATCH}`,
      [cutoff],
    );
    let deleted = 0;
    for (const { id } of cand.rows) {
      try {
        const files = await this.accounts.delete(id, (c, a) => stillIdle(c, a, cutoff));
        if (files === null) continue;
        await this.backups.removeFiles(files);
        deleted++;
      } catch (err) {
        // 한 계정이 실패해도 나머지는 계속 (그사이 탈퇴해 없는 계정은 401 이다)
        console.warn('[account-cleanup] 계정을 못 지움:', id, (err as Error).message);
      }
    }
    return { deleted };
  }
}
