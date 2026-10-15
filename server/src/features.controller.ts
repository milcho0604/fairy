import { Controller, Get, Req } from '@nestjs/common';
import { AuthGuard, type HttpReq } from './auth.guard';
import { FEATURES, type FeatureKey, Features } from './features';
import { ipKey, LIMITS, RateLimiter } from './rate-limit';

// 요청자가 지금 쓸 수 있는 기능 (#102). 토큰이 있으면 그 계정 기준(allowlist), 없으면 everyone 인 것만 true.
// 앱은 이것만 보고 단추를 보이거나 숨긴다 (앱에 기능 값을 박아 두지 않는다).
//   GET /v1/features → { features: { kakao_login: false, coin_reset: false } }
@Controller('v1/features')
export class FeaturesController {
  constructor(
    private readonly features: Features,
    private readonly guard: AuthGuard,
    private readonly limiter: RateLimiter,
  ) {}

  @Get()
  async list(@Req() req: HttpReq) {
    this.limiter.check(`features:${ipKey(req)}`, LIMITS.loginByIp);
    const auth = await this.guard.identify(req);
    const out: Partial<Record<FeatureKey, boolean>> = {};
    for (const key of Object.keys(FEATURES) as FeatureKey[])
      out[key] = await this.features.featureAllowed(key, auth?.accountId ?? null);
    return { features: out };
  }
}
