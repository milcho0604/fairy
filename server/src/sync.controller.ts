import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Auth, AuthGuard, type AuthInfo } from './auth.guard';
import { LIMITS, RateLimiter } from './rate-limit';
import { SYNC_CHANGES_MAX, Sync } from './sync';

// 기기 간 동기화 길 (docs/sync-plan.md 5절). 모두 세션(로그인) 토큰만, 기능 키 sync 가 켜진 계정만.
// 기기 토큰은 403 login, 기능이 꺼졌으면 403 feature_off. 서버는 덩어리(base64)를 풀지 않고 보관만 한다.
//
//   PUT    /v1/sync/key      { salt, params: {N, r, p}, wrapped, gen?, key_rev? } -> { epoch, gen, key_rev, created }
//                            처음이면 저장, 있으면 key_rev 가 같을 때만 덮어쓰기(아니면 409 key_rev, 안 보내면 409 key_exists).
//                            gen 을 +1 로 보내면 열쇠 바꾸기: 항목을 모두 지우고 epoch+1
//   GET    /v1/sync/key      { salt, params, wrapped, gen, key_rev, epoch } 또는 404 none
//   GET    /v1/sync/status   { on, items, bytes, maxItems, maxBytes, soon, epoch, gen }
//   GET    /v1/sync/changes?since=&limit=&epoch=   { items: [{ uid, rev, blob, deleted }], head, more, epoch, gen }
//   POST   /v1/sync/push     { epoch, items: [{ uid, base, blob, deleted }] } (최대 200개, 본문 4MB) -> { results, head, epoch, gen }
//   DELETE /v1/sync          서버 사본과 열쇠를 모두 지우고 epoch+1 -> { epoch, gen: 0 }
//   epoch 가 지금과 다르면 changes, push 는 409 { error: 'epoch', epoch, gen }

/** 쿼리 값을 0 이상 정수로. 없으면 기본값, 모양이 틀리면 400 */
function intParam(v: unknown, name: string, def: number): number {
  if (v === undefined || v === '') return def;
  if (typeof v !== 'string' || !/^\d{1,15}$/.test(v)) throw new BadRequestException({ error: name });
  return Number(v);
}

@Controller('v1/sync')
@UseGuards(AuthGuard)
export class SyncController {
  constructor(
    private readonly sync: Sync,
    private readonly limiter: RateLimiter,
  ) {}

  @Put('key')
  async putKey(@Auth() auth: AuthInfo, @Body() body: unknown) {
    await this.sync.gate(auth);
    this.limiter.check(`sync-w:${auth.accountId}`, LIMITS.syncWrite);
    return this.sync.putKey(auth.accountId, body);
  }

  @Get('key')
  async getKey(@Auth() auth: AuthInfo) {
    await this.sync.gate(auth);
    this.limiter.check(`sync-r:${auth.accountId}`, LIMITS.syncRead);
    return this.sync.getKey(auth.accountId);
  }

  @Get('status')
  async status(@Auth() auth: AuthInfo) {
    await this.sync.gate(auth);
    this.limiter.check(`sync-r:${auth.accountId}`, LIMITS.syncRead);
    return this.sync.status(auth.accountId);
  }

  @Get('changes')
  async changes(
    @Auth() auth: AuthInfo,
    @Query('since') since: unknown,
    @Query('limit') limit: unknown,
    @Query('epoch') epoch: unknown,
  ) {
    await this.sync.gate(auth);
    this.limiter.check(`sync-r:${auth.accountId}`, LIMITS.syncRead);
    const n = Math.min(intParam(limit, 'limit', SYNC_CHANGES_MAX), SYNC_CHANGES_MAX);
    if (n < 1) throw new BadRequestException({ error: 'limit' });
    if (epoch === undefined) throw new BadRequestException({ error: 'epoch' });
    return this.sync.changes(auth.accountId, intParam(since, 'since', 0), n, intParam(epoch, 'epoch', 0));
  }

  @Post('push')
  @HttpCode(200)
  async push(@Auth() auth: AuthInfo, @Body() body: unknown) {
    await this.sync.gate(auth);
    this.limiter.check(`sync-w:${auth.accountId}`, LIMITS.syncWrite);
    return this.sync.push(auth.accountId, body);
  }

  @Delete()
  @HttpCode(200)
  async removeAll(@Auth() auth: AuthInfo) {
    await this.sync.gate(auth);
    this.limiter.check(`sync-w:${auth.accountId}`, LIMITS.syncWrite);
    return this.sync.removeAll(auth.accountId);
  }
}
