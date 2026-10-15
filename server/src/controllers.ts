import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Post,
  Query,
  Redirect,
  Req,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { Accounts, isAge } from './accounts';
import { CONFIG } from './app.tokens';
import { Auth, AuthGuard, type AuthInfo, type HttpReq } from './auth.guard';
import { Coins, parseEntries, parseMigrate } from './coins';
import { type Config, googleEnabled } from './config';
import { doneUrl, Login, parseAppState, parsePort } from './login';
import { ipKey, LIMITS, RateLimiter } from './rate-limit';

// API 경로 (기획서 11절). 요청과 응답은 JSON, 실패는 { error: '<까닭>' }.

@Controller('v1')
export class AccountController {
  constructor(
    private readonly accounts: Accounts,
    private readonly limiter: RateLimiter,
  ) {}

  /** 이름 없는 기기 계정 + 기기 토큰. 나이 구분은 '14+' 또는 '18+' 만 (만 14세 미만은 앱이 보내지 않는다) */
  @Post('device')
  @HttpCode(201)
  async device(@Body() body: unknown, @Req() req: HttpReq) {
    this.limiter.check(`device:${ipKey(req.headers)}`, LIMITS.deviceByIp);
    this.limiter.check('device:all', LIMITS.deviceAll);
    const age = (body as { age?: unknown } | null)?.age;
    if (!isAge(age)) throw new BadRequestException({ error: 'age' });
    const { token, accountId } = await this.accounts.createDevice(age);
    return { token, account: { id: Number(accountId) } };
  }

  /** 탈퇴: 바로 지운다 */
  @Delete('account')
  @UseGuards(AuthGuard)
  @HttpCode(204)
  async remove(@Auth() auth: AuthInfo): Promise<void> {
    await this.accounts.delete(auth.accountId);
  }
}

@Controller('v1')
@UseGuards(AuthGuard)
export class CoinController {
  constructor(private readonly coins: Coins) {}

  @Post('sync')
  @HttpCode(200)
  async sync(@Auth() auth: AuthInfo, @Body() body: unknown) {
    return this.coins.sync(auth.accountId, parseEntries(body));
  }

  /** 기존 잔액과 산 물건 올리기. 기기마다 한 번이라 기기 토큰으로만 */
  @Post('migrate')
  @HttpCode(200)
  async migrate(@Auth() auth: AuthInfo, @Body() body: unknown) {
    if (!auth.deviceId) throw new BadRequestException({ error: 'device_token' });
    return this.coins.migrate(auth.accountId, auth.deviceId, parseMigrate(body));
  }
}

@Controller()
export class LoginController {
  constructor(
    @Inject(CONFIG) private readonly config: Config,
    private readonly login: Login,
    private readonly limiter: RateLimiter,
  ) {}

  private on(req: HttpReq) {
    if (!googleEnabled(this.config)) throw new ServiceUnavailableException({ error: 'login_off' });
    this.limiter.check(`login:${ipKey(req.headers)}`, LIMITS.loginByIp);
  }

  @Get('auth/google/start')
  @Redirect()
  start(@Query('port') port: unknown, @Query('state') state: unknown, @Req() req: HttpReq) {
    this.on(req);
    const p = parsePort(port);
    const s = parseAppState(state);
    if (p === undefined) throw new BadRequestException({ error: 'port' });
    if (s === undefined) throw new BadRequestException({ error: 'state' });
    return { url: this.login.start(p, s), statusCode: 302 };
  }

  /** 구글이 돌려보내는 곳. 결과는 언제나 앱의 루프백(127.0.0.1:<port>/done)으로 넘긴다 */
  @Get('auth/google/callback')
  @Redirect()
  async callback(@Query() q: Record<string, unknown>, @Req() req: HttpReq) {
    this.on(req);
    const pending = this.login.takePending(q.state);
    if (!pending) throw new BadRequestException({ error: 'state' });
    const back = (params: Record<string, string>) => ({
      url: doneUrl(pending.port, { ...params, state: pending.appState }),
      statusCode: 302,
    });
    if (typeof q.error === 'string') return back({ error: 'denied' });
    if (typeof q.code !== 'string' || q.code.length === 0 || q.code.length > 2048)
      return back({ error: 'code' });
    try {
      return back({ code: await this.login.finish(pending, q.code) });
    } catch (err) {
      console.warn('[login] 구글 로그인 확인 실패:', (err as Error).message);
      return back({ error: 'login' });
    }
  }

  /** 일회용 코드를 세션으로. 기기 토큰(또는 세션)으로 지금 계정을 알린다 */
  @Post('v1/session')
  @UseGuards(AuthGuard)
  @HttpCode(200)
  async session(@Auth() auth: AuthInfo, @Body() body: unknown, @Req() req: HttpReq) {
    this.on(req);
    const b = (body ?? {}) as { code?: unknown; merge?: unknown };
    const out = await this.login.exchange(b.code, auth.accountId, b.merge === true);
    if (!out) throw new BadRequestException({ error: 'code' });
    if (out.kind === 'confirm')
      throw new ConflictException({
        error: 'merge_needed',
        code: out.code,
        current: out.current,
        other: out.other,
      });
    return {
      session: out.token,
      account: { id: Number(out.accountId) },
      merged: out.merged,
      linked: out.linked,
    };
  }
}
