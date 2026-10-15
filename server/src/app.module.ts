import { type DynamicModule, Module } from '@nestjs/common';
import { Accounts } from './accounts';
import { CONFIG, GOOGLE_API } from './app.tokens';
import { AuthGuard } from './auth.guard';
import { Coins } from './coins';
import type { Config } from './config';
import { AccountController, CoinController, LoginController } from './controllers';
import { Db } from './db';
import { type GoogleApi, realGoogleApi } from './google';
import { HealthController } from './health.controller';
import { Login } from './login';
import { RateLimiter } from './rate-limit';

@Module({})
export class AppModule {}

/** 바꿔 끼울 수 있는 것. 시험은 가짜 구글을 넣어 진짜 구글을 부르지 않는다 */
export interface AppDeps {
  google?: GoogleApi;
}

/** 설정을 받아 앱 모듈을 만든다. 기능 모듈은 단계마다 여기 더한다. */
export function appModule(config: Config, deps: AppDeps = {}): DynamicModule {
  return {
    module: AppModule,
    controllers: [HealthController, AccountController, CoinController, LoginController],
    providers: [
      { provide: CONFIG, useValue: config },
      { provide: GOOGLE_API, useFactory: () => deps.google ?? realGoogleApi() },
      { provide: Db, useFactory: () => new Db(config.databaseUrl) },
      { provide: RateLimiter, useFactory: () => new RateLimiter() },
      Accounts,
      Coins,
      Login,
      AuthGuard,
    ],
  };
}
