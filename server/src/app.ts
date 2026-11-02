import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { type AppDeps, appModule } from './app.module';
import type { Config } from './config';
import { Feeds } from './feeds';
import { rejectEncodedBody } from './no-encoded-body';
import { SYNC_PUSH_BODY } from './sync';
import { updateGate } from './update-gate';

/**
 * 요청 하나를 다 받는 시간. Node 기본(300초)은 느린 회선의 20MB 서버 백업 올리기를 끊는다.
 * 서버 전체는 30분으로 늘리고, 올리기 밖의 경로는 아래 미들웨어가 예전처럼 300초로 묶는다.
 * 올리기는 바이트가 멈추면(BACKUP_STALL_MS) backup.ts 가 끊는다
 */
export const UPLOAD_REQUEST_MS = 30 * 60_000;
export const REQUEST_MS = 300_000;

type UseArg = Parameters<NestExpressApplication['use']>[0];
// 본문 해석기를 길별로 고르려고 platform-express 가 쓰는 express 를 그대로 가져온다
const expressJson = (require('express') as { json(o: { limit: string }): UseArg }).json;

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
  // 압축된 요청 본문은 415 로 거절한다 (본문 해석기보다 먼저)
  app.use(rejectEncodedBody);
  // 동기화 올리기(push)만 4MB: 잠근 덩어리가 커서 아래 256KB 상한과 따로 둔다 (서버 백업 PUT 처럼 길별로).
  // 먼저 읽힌 본문은 아래 json 해석기가 다시 읽지 않는다
  app.use('/v1/sync/push', expressJson({ limit: SYNC_PUSH_BODY }));
  // 요청 본문 상한. 서버 백업(5단계)만 따로 크게 받는다.
  app.useBodyParser('json', { limit: '256kb' });
  // 운영자 화면(/admin)의 폼. 스크립트 없이 폼만 쓴다 (admin.ts)
  app.useBodyParser('urlencoded', { limit: '64kb', extended: false });
  // 업데이트 단계 관문 (이슈 #120): /v1/* 를 앱 판 머리와 기준으로 거른다. 기준은 공지 문서에서 매번 읽는다
  const feeds = app.get(Feeds);
  app.use(updateGate(() => feeds.levels()));
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
