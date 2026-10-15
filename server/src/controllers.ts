import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Patch,
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
import { doneUrl, Login, parseAppState, parseChallenge, parsePort } from './login';
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
    this.limiter.check(`device:${ipKey(req)}`, LIMITS.deviceByIp);
    this.limiter.check(`device-day:${ipKey(req)}`, LIMITS.deviceByIpDay);
    this.limiter.check('device:all', LIMITS.deviceAll);
    const age = (body as { age?: unknown } | null)?.age;
    if (!isAge(age)) throw new BadRequestException({ error: 'age' });
    const { token, accountId } = await this.accounts.createDevice(age);
    return { token, account: { id: Number(accountId) } };
  }

  /** 나이 구분 바꾸기. 기기 토큰과 세션 모두. 14세 미만 값은 400 (앱은 탈퇴를 안내한다) */
  @Patch('account')
  @UseGuards(AuthGuard)
  @HttpCode(200)
  async age(@Auth() auth: AuthInfo, @Body() body: unknown) {
    const age = (body as { age?: unknown } | null)?.age;
    if (!isAge(age)) throw new BadRequestException({ error: 'age' });
    const a = await this.accounts.setAge(auth.accountId, age);
    return { account: { id: Number(a.id), age: a.age } };
  }

  /** 로그아웃: 이 세션만 지운다. 세션 토큰으로만 */
  @Delete('session')
  @UseGuards(AuthGuard)
  @HttpCode(204)
  async logout(@Auth() auth: AuthInfo): Promise<void> {
    if (!auth.sessionId) throw new BadRequestException({ error: 'session_token' });
    await this.accounts.deleteSession(auth.sessionId);
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

  /** 기존 잔액과 산 물건 올리기. 기기 계정마다 한 번, 로그인마다 한 번 */
  @Post('migrate')
  @HttpCode(200)
  async migrate(@Auth() auth: AuthInfo, @Body() body: unknown) {
    return this.coins.migrate(auth.accountId, parseMigrate(body));
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
    this.limiter.check(`login:${ipKey(req)}`, LIMITS.loginByIp);
  }

  @Get('auth/google/start')
  @Redirect()
  start(@Query() q: Record<string, unknown>, @Req() req: HttpReq) {
    this.on(req);
    const p = parsePort(q.port);
    const s = parseAppState(q.state);
    const challenge = parseChallenge(q.challenge);
    if (p === undefined) throw new BadRequestException({ error: 'port' });
    if (s === undefined) throw new BadRequestException({ error: 'state' });
    if (challenge === undefined) throw new BadRequestException({ error: 'challenge' });
    const url = this.login.start(p, s, challenge, ipKey(req));
    if (!url) throw new HttpException({ error: 'rate_limited' }, HttpStatus.TOO_MANY_REQUESTS);
    return { url, statusCode: 302 };
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

  /** 일회용 코드와 verifier 를 세션으로. 기기 토큰(또는 세션)으로 지금 계정을 알린다 */
  @Post('v1/session')
  @UseGuards(AuthGuard)
  @HttpCode(200)
  async session(@Auth() auth: AuthInfo, @Body() body: unknown, @Req() req: HttpReq) {
    this.on(req);
    const b = (body ?? {}) as { code?: unknown; verifier?: unknown; merge?: unknown };
    const out = await this.login.exchange(b.code, b.verifier, auth.accountId, b.merge === true);
    if (out.kind === 'error') throw new BadRequestException({ error: out.error });
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
