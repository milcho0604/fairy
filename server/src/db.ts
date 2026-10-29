import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { Pool, type PoolClient, type QueryConfig } from 'pg';

// Postgres 연결 하나를 앱 전체가 같이 쓴다.
@Injectable()
export class Db implements OnApplicationShutdown {
  readonly pool: Pool;

  constructor(databaseUrl: string, max = 20) {
    this.pool = new Pool({
      connectionString: databaseUrl,
      max,
      connectionTimeoutMillis: 2000,
      idleTimeoutMillis: 30_000,
      // 느린 질의 하나와 열어 놓고 잊은 트랜잭션이 연결과 잠금을 쥐고 있지 않게 서버가 끊는다
      statement_timeout: 15_000,
      idle_in_transaction_session_timeout: 30_000,
    });
    // 놀던 연결이 끊겨도 서버가 죽지 않게 한다. 다음 요청이 새 연결을 받는다.
    this.pool.on('error', () => {});
  }

  /** DB 가 답하면 true. 2초 안에 답이 없으면 false. */
  async ping(): Promise<boolean> {
    try {
      const r = await this.pool.query<{ ok: number }>({
        text: 'SELECT 1 AS ok',
        query_timeout: 2000,
      } as QueryConfig);
      return r.rows[0]?.ok === 1;
    } catch {
      return false;
    }
  }

  /** 트랜잭션 하나. fn 이 던지면 되돌리고 다시 던진다 */
  async tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const out = await fn(client);
      await client.query('COMMIT');
      return out;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
