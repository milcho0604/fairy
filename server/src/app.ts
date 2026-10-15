import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { type AppDeps, appModule } from './app.module';
import type { Config } from './config';

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
  app.enableShutdownHooks();
  return app;
}
