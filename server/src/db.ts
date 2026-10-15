import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { Pool, type QueryConfig } from 'pg';

// Postgres 연결 하나를 앱 전체가 같이 쓴다.
@Injectable()
export class Db implements OnApplicationShutdown {
  readonly pool: Pool;

  constructor(databaseUrl: string) {
    this.pool = new Pool({
      connectionString: databaseUrl,
      max: 10,
      connectionTimeoutMillis: 2000,
      idleTimeoutMillis: 30_000,
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

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
