import { type DynamicModule, Module } from '@nestjs/common';
import type { Config } from './config';
import { Db } from './db';
import { HealthController } from './health.controller';

@Module({})
export class AppModule {}

/** 설정을 받아 앱 모듈을 만든다. 기능 모듈은 단계마다 여기 더한다. */
export function appModule(config: Config): DynamicModule {
  return {
    module: AppModule,
    controllers: [HealthController],
    providers: [{ provide: Db, useFactory: () => new Db(config.databaseUrl) }],
  };
}
