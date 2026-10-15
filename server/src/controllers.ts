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
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Redirect,
  Req,
  Res,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { Accounts, isAge } from './accounts';
import { AdminAccess } from './admin-access';
import { Ai, type StreamRes } from './ai';
import { AiAdmin } from './ai-admin';
import { parseChatRequest, parseReport } from './ai-rules';
import { CONFIG } from './app.tokens';
import { Auth, AuthGuard, type AuthInfo, type HttpReq } from './auth.guard';
import { Coins, parseEntries, parseMigrate } from './coins';
import { type Config, googleEnabled } from './config';
import { Feeds } from './feeds';
import { Inbox } from './inbox';
import { doneUrl, Login, parseAppState, parseChallenge, parsePort } from './login';
import { ipKey, LIMITS, RateLimiter } from './rate-limit';
import { Rewards } from './rewards';
import { checkNickname } from './shared/account-profile';
import { EVENT_ID, normalizeCoupon } from './shared/site-events';

// API 경로 (기획서 11절). 요청과 응답은 JSON, 실패는 { error: '<까닭>' }.

/** 닉네임 칸. optional 이면 없을 때 null. 틀리면 400 { error: 'nickname', reason } */
function readNickname(v: unknown, optional: true): string | null;
function readNickname(v: unknown, optional: false): string;
function readNickname(v: unknown, optional: boolean): string | null {
  if (optional && (v === undefined || v === null || v === '')) return null;
  const r = checkNickname(v);
  if (!r.ok) throw new BadRequestException({ error: 'nickname', reason: r.error });
  return r.value;
}

@Controller('v1')
export class AccountController {
  constructor(
    private readonly accounts: Accounts,
    private readonly limiter: RateLimiter,
    private readonly access: AdminAccess,
  ) {}

  /** 이름 없는 기기 계정 + 기기 토큰. 나이 구분은 '14+' 또는 '18+' 만 (만 14세 미만은 앱이 보내지 않는다) */
  @Post('device')
  @HttpCode(201)
  async device(@Body() body: unknown, @Req() req: HttpReq) {
    this.limiter.check(`device:${ipKey(req)}`, LIMITS.deviceByIp);
    this.limiter.check(`device-day:${ipKey(req)}`, LIMITS.deviceByIpDay);
    this.limiter.check('device:all', LIMITS.deviceAll);
    const b = (body ?? {}) as { age?: unknown; nickname?: unknown };
    if (!isAge(b.age)) throw new BadRequestException({ error: 'age' });
    const nickname = readNickname(b.nickname, true);
    const { token, accountId, code } = await this.accounts.createDevice(b.age, nickname);
    return { token, account: { id: Number(accountId), code, nickname } };
  }

  /**
   * 나이 구분이나 닉네임 바꾸기 (둘 중 하나 이상). 기기 토큰과 세션 모두. 14세 미만 값은 400 (앱은 탈퇴를 안내한다).
   * 닉네임은 2~12자, 제어 문자, @, 주소 금지 (400 nickname, reason)
   */
  @Patch('account')
  @UseGuards(AuthGuard)
  @HttpCode(200)
  async age(@Auth() auth: AuthInfo, @Body() body: unknown) {
    const b = (body ?? {}) as { age?: unknown; nickname?: unknown };
    if (b.age === undefined && b.nickname === undefined) throw new BadRequestException({ error: 'age' });
    if (b.age !== undefined && !isAge(b.age)) throw new BadRequestException({ error: 'age' });
    const nickname = b.nickname === undefined ? undefined : readNickname(b.nickname, false);
    if (nickname) await this.accounts.setNickname(auth.accountId, nickname);
    const a = isAge(b.age) ? await this.accounts.setAge(auth.accountId, b.age) : undefined;
    const p = await this.accounts.profile(auth.accountId);
    return { account: { id: Number(a?.id ?? auth.accountId), ...(a ? { age: a.age } : {}), ...p } };
  }

  /**
   * 내 계정: 기기 코드, 닉네임, 운영자인지. 운영자는 ADMIN_GOOGLE_SUBS 의 구글 로그인이 붙은 계정의 세션만
   * (기기 토큰은 언제나 false). 매번 DB 로 다시 본다
   */
  @Get('me')
  @UseGuards(AuthGuard)
  async me(@Auth() auth: AuthInfo) {
    const p = await this.accounts.profile(auth.accountId);
    return { account: p, admin: await this.access.isAdmin(auth) };
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

/** AI 대화권 (8절, #100). 세션(로그인) 토큰과 만 18세 이상만. 대화 내용은 저장하지 않는다 */
@Controller('v1/ai')
@UseGuards(AuthGuard)
export class AiController {
  constructor(
    private readonly ai: Ai,
    private readonly limiter: RateLimiter,
  ) {}

  /** 남은 대화권, 하루 상한과 오늘 쓴 수. 첫 로그인 선물(10개)도 여기서 받는다 */
  @Get()
  async status(@Auth() auth: AuthInfo) {
    return this.ai.status(auth);
  }

  /** 대화권 하나로 질문 하나. 스트리밍(SSE)으로 답한다 (ai.ts relay) */
  @Post('chat')
  async chat(@Auth() auth: AuthInfo, @Body() body: unknown, @Res() res: StreamRes): Promise<void> {
    this.limiter.check(`ai:${auth.accountId}`, LIMITS.aiByAccount);
    const req = parseChatRequest(body);
    if ('error' in req) throw new BadRequestException({ error: req.error });
    await this.ai.relay(auth, req, res);
  }

  /** 신고: 사용자가 따로 동의한(consent: true) 질문과 답 하나. 30일 뒤 지운다 */
  @Post('report')
  @HttpCode(201)
  async report(@Auth() auth: AuthInfo, @Body() body: unknown) {
    this.limiter.check(`ai:${auth.accountId}`, LIMITS.aiByAccount);
    const r = parseReport(body);
    if ('error' in r) throw new BadRequestException({ error: r.error });
    await this.ai.report(auth, r);
    return { ok: true };
  }
}

/** 이벤트 선물 받기와 쿠폰 (9절, #101). 기기 토큰과 세션 모두 */
@Controller('v1')
@UseGuards(AuthGuard)
export class RewardController {
  constructor(
    private readonly rewards: Rewards,
    private readonly limiter: RateLimiter,
  ) {}

  /** 로그인(세션) 계정만 받는 설정이면 기기 토큰은 403 login_required */
  private async needLogin(auth: AuthInfo): Promise<void> {
    if (auth.via !== 'session' && (await this.rewards.loginOnly()))
      throw new HttpException({ error: 'login_required' }, HttpStatus.FORBIDDEN);
  }

  /** 선물 받기: { event: '<이벤트 id>' }. 계정당 이벤트당 한 번 */
  @Post('claim')
  @HttpCode(200)
  async claim(@Auth() auth: AuthInfo, @Body() body: unknown) {
    this.limiter.check(`claim:${auth.accountId}`, LIMITS.claimByAccount);
    await this.needLogin(auth);
    const id = (body as { event?: unknown } | null)?.event;
    if (typeof id !== 'string' || !EVENT_ID.test(id)) throw new BadRequestException({ error: 'event' });
    return this.rewards.claim(auth.accountId, id);
  }

  /** 쿠폰 쓰기: { code: 'XXXX-XXXX-XXXX' }. 계정당 쿠폰당 한 번. 틀린 코드가 잦으면 한동안 받지 않는다 */
  @Post('coupon')
  @HttpCode(200)
  async coupon(@Auth() auth: AuthInfo, @Body() body: unknown, @Req() req: HttpReq) {
    const missKey = `coupon-miss:${auth.accountId}`;
    if (this.limiter.over(missKey, LIMITS.couponMissByAccount))
      throw new HttpException({ error: 'rate_limited' }, HttpStatus.TOO_MANY_REQUESTS);
    this.limiter.check(`coupon:${auth.accountId}`, LIMITS.couponByAccount);
    this.limiter.check(`coupon:${ipKey(req)}`, LIMITS.couponByIp);
    await this.needLogin(auth);
    const code = normalizeCoupon((body as { code?: unknown } | null)?.code);
    if (!code) {
      this.limiter.take(missKey, LIMITS.couponMissByAccount);
      throw new BadRequestException({ error: 'code' });
    }
    try {
      return await this.rewards.coupon(auth.accountId, code);
    } catch (err) {
      if (err instanceof HttpException && err.getStatus() === HttpStatus.NOT_FOUND)
        this.limiter.take(missKey, LIMITS.couponMissByAccount);
      throw err;
    }
  }
}

/**
 * 홈페이지 정적 파일로 나갈 것 (9, 23절). 공개 레포 Actions(site-feeds.yml)가 10분마다 받아 바뀌었으면 site/ 에 올린다.
 * 앱은 이 경로를 읽지 않는다 (홈페이지 정적 파일만). 공지는 운영자 화면에서 한 번도 저장하지 않았으면 404
 */
@Controller('v1')
export class FeedController {
  constructor(
    private readonly feeds: Feeds,
    private readonly limiter: RateLimiter,
  ) {}

  @Get('events.json')
  async events(@Req() req: HttpReq, @Res({ passthrough: true }) res: HeaderRes) {
    this.limiter.check(`feed:${ipKey(req)}`, LIMITS.feedByIp);
    feedHeaders(res);
    return this.feeds.events();
  }

  @Get('notices.json')
  async notices(@Req() req: HttpReq, @Res({ passthrough: true }) res: HeaderRes) {
    this.limiter.check(`feed:${ipKey(req)}`, LIMITS.feedByIp);
    const doc = await this.feeds.notices();
    if (!doc) throw new NotFoundException({ error: 'not_managed' });
    feedHeaders(res);
    return doc;
  }
}

type HeaderRes = { setHeader(name: string, value: string): void };

function feedHeaders(res: HeaderRes) {
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

/**
 * 쪽지함 (#101 범위 추가 4). 서버 DB 에 두고 같은 계정의 모든 기기가 같은 것을 본다. 연 쪽지도 이력으로 남는다.
 * 기기 토큰과 세션 모두
 */
@Controller('v1/inbox')
@UseGuards(AuthGuard)
export class InboxController {
  constructor(
    private readonly inbox: Inbox,
    private readonly aiAdmin: AiAdmin,
    private readonly limiter: RateLimiter,
  ) {}

  /** 최근 것부터 20개. ?before=<번호> 로 다음 쪽. 이번 달 정기 지급 쪽지가 아직이면 먼저 보낸다 */
  @Get()
  async list(@Auth() auth: AuthInfo, @Query('before') before?: string) {
    const b = before === undefined || before === '' ? undefined : Number(before);
    if (b !== undefined && (!Number.isSafeInteger(b) || b < 1))
      throw new BadRequestException({ error: 'before' });
    if (b === undefined) await this.aiAdmin.fillFor(auth.accountId);
    return this.inbox.list(auth.accountId, b);
  }

  /** 열기: 첨부를 준다 (한 번만). 이미 열었으면 409 already_opened, 만료면 410 expired, 남의 것이면 404 */
  @Post(':id/open')
  @HttpCode(200)
  async open(@Auth() auth: AuthInfo, @Param('id') id: string) {
    this.limiter.check(`claim:${auth.accountId}`, LIMITS.claimByAccount);
    const n = Number(id);
    if (!Number.isSafeInteger(n) || n < 1) throw new BadRequestException({ error: 'id' });
    return this.inbox.open(auth.accountId, n);
  }
}
