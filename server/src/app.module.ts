import { type DynamicModule, Module } from '@nestjs/common';
import { Accounts } from './accounts';
import { AdminApiController, AdminController, AdminService } from './admin';
import { AdminAccess } from './admin-access';
import { AdminAuth } from './admin-auth';
import { Ai } from './ai';
import { AiAdmin } from './ai-admin';
import { CLOCK, CONFIG, GOOGLE_API, KAKAO_API } from './app.tokens';
import { AuthGuard } from './auth.guard';
import { Backups } from './backup';
import { BackupController } from './backup.controller';
import { Coins } from './coins';
import type { Config } from './config';
import {
  AccountController,
  AiController,
  CoinController,
  FeedController,
  InboxController,
  LoginController,
  RewardController,
} from './controllers';
import { Db } from './db';
import { Features } from './features';
import { FeaturesController } from './features.controller';
import { Feeds } from './feeds';
import { type GoogleApi, realGoogleApi } from './google';
import { HealthController } from './health.controller';
import { Inbox } from './inbox';
import { type KakaoApi, realKakaoApi } from './kakao';
import { Login } from './login';
import { RateLimiter } from './rate-limit';
import { Rewards } from './rewards';

@Module({})
export class AppModule {}

/** 바꿔 끼울 수 있는 것. 시험은 가짜 구글을 넣어 진짜 구글을 부르지 않는다 */
export interface AppDeps {
  google?: GoogleApi;
  /** 지금 시각 (정기 지급의 달, 서버 백업 1년 정리). 시험이 바꿔 끼운다 */
  now?: () => number;
  /** 가짜 카카오 (#102). 없으면 KAKAO_AUTH_URL 의 카카오 */
  kakao?: KakaoApi;
}

/** 설정을 받아 앱 모듈을 만든다. 기능 모듈은 단계마다 여기 더한다. */
export function appModule(config: Config, deps: AppDeps = {}): DynamicModule {
  return {
    module: AppModule,
    controllers: [
      HealthController,
      AccountController,
      CoinController,
      LoginController,
      AiController,
      RewardController,
      FeedController,
      AdminController,
      AdminApiController,
      InboxController,
      BackupController,
      FeaturesController,
    ],
    providers: [
      { provide: CONFIG, useValue: config },
      { provide: CLOCK, useValue: deps.now ?? Date.now },
      { provide: GOOGLE_API, useFactory: () => deps.google ?? realGoogleApi() },
      {
        provide: KAKAO_API,
        useFactory: () => deps.kakao ?? realKakaoApi(config.kakaoAuthUrl ?? 'https://kauth.kakao.com'),
      },

      Backups,
      Features,
      { provide: Db, useFactory: () => new Db(config.databaseUrl) },
      { provide: RateLimiter, useFactory: () => new RateLimiter() },
      {
        provide: AdminAuth,
        useFactory: (c: Config, l: RateLimiter) => new AdminAuth(c, l),
        inject: [CONFIG, RateLimiter],
      },
      Accounts,
      AdminAccess,
      AdminService,
      Ai,
      AiAdmin,
      Inbox,
      Feeds,
      Rewards,
      Coins,
      Login,
      AuthGuard,
    ],
  };
}
