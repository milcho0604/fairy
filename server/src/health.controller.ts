import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { Db } from './db';

// 감시(맥미니 fairy-monitor, Actions server-uptime)와 배포 확인이 이 주소를 본다.
// DB 까지 답해야 200, 아니면 503 (기획서 11절).
@Controller('health')
export class HealthController {
  constructor(private readonly db: Db) {}

  @Get()
  async health() {
    const ok = await this.db.ping();
    if (!ok) throw new ServiceUnavailableException({ status: 'down', db: 'down' });
    return { status: 'ok', db: 'ok' };
  }
}
