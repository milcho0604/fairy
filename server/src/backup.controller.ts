import {
  BadRequestException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Head,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Auth, AuthGuard, type AuthInfo } from './auth.guard';
import { BACKUP_KEEP, BACKUP_MAX_BYTES, Backups, type UploadReq } from './backup';
import { LIMITS, RateLimiter } from './rate-limit';

// 서버 백업 경로 (기획서 7, 11절, #102). 모두 세션(로그인) 토큰만. 기기 토큰은 403 login.
// 키(BACKUP_ENC_KEY)가 없으면 모두 503 backup_off.
//
//   PUT    /v1/backup?consent=yes   본문: .fairybackup 그대로 (content-type application/octet-stream, 최대 20MB)
//   GET    /v1/backup               목록 { backups, keep, maxBytes }
//   GET    /v1/backup/:id           받기 (application/octet-stream, x-backup-sha256)
//   DELETE /v1/backup/:id           지우기

type DownloadRes = Parameters<Backups['download']>[2];

@Controller('v1/backup')
@UseGuards(AuthGuard)
export class BackupController {
  constructor(
    private readonly backups: Backups,
    private readonly limiter: RateLimiter,
  ) {}

  private gate(auth: AuthInfo) {
    if (!this.backups.enabled)
      throw new HttpException({ error: 'backup_off' }, HttpStatus.SERVICE_UNAVAILABLE);
    if (auth.via !== 'session') throw new ForbiddenException({ error: 'login' });
  }

  @Get()
  async list(@Auth() auth: AuthInfo) {
    this.gate(auth);
    return {
      backups: await this.backups.list(auth.accountId),
      keep: BACKUP_KEEP,
      maxBytes: BACKUP_MAX_BYTES,
    };
  }

  /**
   * 올리기. 민감한 내용이 섞일 수 있어 따로 동의를 받은 요청만 (consent=yes, 13절 제23조).
   * json 본문 파서는 application/json 만 읽으므로 이 본문은 그대로 흘러 들어온다
   */
  @Put()
  @HttpCode(201)
  async upload(
    @Auth() auth: AuthInfo,
    @Query('consent') consent: unknown,
    @Req() req: UploadReq,
    @Res({ passthrough: true }) res: { setHeader(n: string, v: string): unknown },
  ) {
    this.gate(auth);
    this.limiter.check(`backup-put:${auth.accountId}`, LIMITS.backupPut);
    if (consent !== 'yes') throw new BadRequestException({ error: 'consent' });
    const raw = req.headers['content-type'];
    const type = (Array.isArray(raw) ? raw[0] : raw)?.split(';')[0]?.trim().toLowerCase();
    if (type !== 'application/octet-stream')
      throw new HttpException({ error: 'content_type' }, HttpStatus.UNSUPPORTED_MEDIA_TYPE);
    try {
      return { backup: await this.backups.upload(auth.accountId, req) };
    } catch (err) {
      // 다 읽지 않은 본문이 남았을 수 있다: 응답 뒤 연결을 닫는다
      if (err instanceof HttpException && err.getStatus() === HttpStatus.PAYLOAD_TOO_LARGE)
        res.setHeader('connection', 'close');
      throw err;
    }
  }

  /**
   * HEAD 는 받지 않는다. Express 는 GET 경로로 HEAD 를 처리해 마지막 접근을 고치고, 풀고, 받기 횟수를 쓴다.
   * GET 보다 먼저 두어야 Express 가 이것을 먼저 고른다
   */
  @Head(':id')
  headOne(): never {
    throw new HttpException({ error: 'method' }, HttpStatus.METHOD_NOT_ALLOWED);
  }

  @Get(':id')
  async download(@Auth() auth: AuthInfo, @Param('id') id: string, @Res() res: DownloadRes): Promise<void> {
    this.gate(auth);
    this.limiter.check(`backup-get:${auth.accountId}`, LIMITS.backupGet);
    await this.backups.download(auth.accountId, id, res);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Auth() auth: AuthInfo, @Param('id') id: string): Promise<void> {
    this.gate(auth);
    await this.backups.remove(auth.accountId, id);
  }
}
