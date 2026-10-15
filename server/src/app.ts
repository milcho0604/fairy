import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { type AppDeps, appModule } from './app.module';
import type { Config } from './config';

/**
 * 요청 하나를 다 받는 시간. Node 기본(300초)은 느린 회선의 20MB 서버 백업 올리기를 끊는다.
 * 서버 전체는 30분으로 늘리고, 올리기 밖의 경로는 아래 미들웨어가 예전처럼 300초로 묶는다.
 * 올리기는 바이트가 멈추면(BACKUP_STALL_MS) backup.ts 가 끊는다
 */
export const UPLOAD_REQUEST_MS = 30 * 60_000;
export const REQUEST_MS = 300_000;

type RawReq = {
  method?: string;
  url?: string;
  complete: boolean;
  destroy(): void;
  once(ev: 'close', fn: () => void): unknown;
};

/** 서버를 만든다. 시험은 이것으로 아무 포트에 띄운다. */
export async function createApp(config: Config, deps: AppDeps = {}): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(appModule(config, deps), {
    logger: ['error', 'warn', 'log'],
    bodyParser: false,
    // 실패하면 프로세스를 끝내지 말고 던진다 (main 이 끝내고, 시험은 정리할 수 있다)
    abortOnError: false,
  });
  app.disable('x-powered-by');
  // 요청 본문 상한. 서버 백업(5단계)만 따로 크게 받는다.
  app.useBodyParser('json', { limit: '256kb' });
  // 운영자 화면(/admin)의 폼. 스크립트 없이 폼만 쓴다 (admin.ts)
  app.useBodyParser('urlencoded', { limit: '64kb', extended: false });
  const server = app.getHttpServer() as { requestTimeout: number };
  server.requestTimeout = UPLOAD_REQUEST_MS;
  app.use((req: RawReq, _res: unknown, next: () => void) => {
    const upload = req.method === 'PUT' && (req.url ?? '').split('?')[0] === '/v1/backup';
    if (!upload) {
      const timer = setTimeout(() => {
        if (!req.complete) req.destroy();
      }, REQUEST_MS);
      timer.unref();
      req.once('close', () => clearTimeout(timer));
    }
    next();
  });
  app.enableShutdownHooks();
  return app;
}
