import assert from 'node:assert/strict';
import test from 'node:test';
import {
  adminEnabled,
  DEFAULT_RELEASES_API,
  googleEnabled,
  kakaoConfigured,
  readConfig,
  readSubs,
} from './config';

test('DATABASE_URL 이 없으면 뜨지 않는다', () => {
  assert.throws(() => readConfig({}), /DATABASE_URL/);
});

test('PORT 는 기본 3002, 숫자가 아니면 거절', () => {
  assert.equal(readConfig({ DATABASE_URL: 'postgres://x' }).port, 3002);
  assert.equal(readConfig({ DATABASE_URL: 'postgres://x', PORT: '4000' }).port, 4000);
  assert.throws(() => readConfig({ DATABASE_URL: 'postgres://x', PORT: 'abc' }), /PORT/);
});

test('PUBLIC_URL 은 기본 fairy-api.moilga.com, https 만 (127.0.0.1 은 http 허락)', () => {
  assert.equal(readConfig({ DATABASE_URL: 'postgres://x' }).publicUrl, 'https://fairy-api.moilga.com');
  assert.equal(
    readConfig({ DATABASE_URL: 'postgres://x', PUBLIC_URL: 'https://a.example/' }).publicUrl,
    'https://a.example',
  );
  assert.equal(
    readConfig({ DATABASE_URL: 'postgres://x', PUBLIC_URL: 'http://127.0.0.1:9' }).publicUrl,
    'http://127.0.0.1:9',
  );
  assert.throws(() => readConfig({ DATABASE_URL: 'postgres://x', PUBLIC_URL: 'http://a.example' }), /https/);
  assert.throws(() => readConfig({ DATABASE_URL: 'postgres://x', PUBLIC_URL: 'nope' }), /PUBLIC_URL/);
});

test('구글 로그인은 클라이언트 번호와 비밀이 둘 다 있어야 켜진다', () => {
  assert.equal(googleEnabled(readConfig({ DATABASE_URL: 'postgres://x' })), false);
  assert.equal(googleEnabled(readConfig({ DATABASE_URL: 'postgres://x', GOOGLE_CLIENT_ID: 'a' })), false);
  assert.equal(
    googleEnabled(
      readConfig({ DATABASE_URL: 'postgres://x', GOOGLE_CLIENT_ID: 'a', GOOGLE_CLIENT_SECRET: 'b' }),
    ),
    true,
  );
});

test('AI 대화권: 기본은 공식 주소와 Haiku 5.5, 월 90달러, 하루 20번, 질문 8000자. 주소는 https 만, 모델 이름 검사', () => {
  assert.deepEqual(readConfig({ DATABASE_URL: 'postgres://x' }).ai, {
    apiKey: '',
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-haiku-5-5',
    monthlyBudgetMicros: 90_000_000,
    dailyLimit: 20,
    maxInputChars: 8000,
    giftKey: '',
  });
  assert.deepEqual(
    readConfig({
      DATABASE_URL: 'postgres://x',
      ANTHROPIC_API_KEY: ' k ',
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:9/',
      ANTHROPIC_MODEL: 'claude-haiku-5-5',
      AI_MONTHLY_BUDGET_USD: '0.5',
      AI_DAILY_LIMIT: '3',
      AI_MAX_INPUT_CHARS: '1200',
      GIFT_HMAC_KEY: ' g ',
    }).ai,
    {
      apiKey: 'k',
      baseUrl: 'http://127.0.0.1:9',
      model: 'claude-haiku-5-5',
      monthlyBudgetMicros: 500_000,
      dailyLimit: 3,
      maxInputChars: 1200,
      giftKey: 'g',
    },
  );
  const env = { DATABASE_URL: 'postgres://x' };
  assert.throws(() => readConfig({ ...env, ANTHROPIC_BASE_URL: 'http://api.example' }), /https/);
  assert.throws(() => readConfig({ ...env, ANTHROPIC_MODEL: 'bad model' }), /ANTHROPIC_MODEL/);
  assert.throws(() => readConfig({ ...env, AI_DAILY_LIMIT: '1.5' }), /AI_DAILY_LIMIT/);
  assert.throws(() => readConfig({ ...env, AI_MONTHLY_BUDGET_USD: '-1' }), /AI_MONTHLY_BUDGET_USD/);
  assert.throws(() => readConfig({ ...env, AI_MAX_INPUT_CHARS: '0' }), /AI_MAX_INPUT_CHARS/);
  assert.throws(() => readConfig({ ...env, AI_MAX_INPUT_CHARS: '2.5' }), /AI_MAX_INPUT_CHARS/);
  // 8000 을 넘는 값, 16진수, 지수 표기는 기동 오류 (Number 가 받아 주는 값도 거절한다)
  for (const v of ['8001', '0x10', '1e3', ' ', '-5']) {
    if (v.trim() === '') continue;
    assert.throws(() => readConfig({ ...env, AI_MAX_INPUT_CHARS: v }), /AI_MAX_INPUT_CHARS/, v);
  }
  assert.equal(readConfig({ ...env, AI_MAX_INPUT_CHARS: '8000' }).ai?.maxInputChars, 8000);
});

test('운영자 화면은 ADMIN_TOKEN 이 32자 이상일 때만, 최신 릴리스 주소는 https 만', () => {
  const base = { DATABASE_URL: 'postgres://x' };
  assert.equal(adminEnabled(readConfig(base)), false);
  assert.equal(adminEnabled(readConfig({ ...base, ADMIN_TOKEN: 'short' })), false);
  assert.equal(adminEnabled(readConfig({ ...base, ADMIN_TOKEN: 'a'.repeat(32) })), true);
  assert.equal(readConfig(base).releasesApi, DEFAULT_RELEASES_API);
  assert.equal(
    readConfig({ ...base, RELEASES_API: 'http://127.0.0.1:9/latest' }).releasesApi,
    'http://127.0.0.1:9/latest',
  );
  assert.throws(() => readConfig({ ...base, RELEASES_API: 'http://a.example/latest' }), /https/);
});

test('ADMIN_GOOGLE_SUBS: 쉼표로 여럿, 빈 값과 이상한 값은 버린다', () => {
  assert.deepEqual(readSubs(undefined), []);
  assert.deepEqual(readSubs(' 123 , ,456,123,bad sub,'), ['123', '456']);
  assert.deepEqual(readConfig({ DATABASE_URL: 'postgres://x', ADMIN_GOOGLE_SUBS: '1,2' }).adminSubs, [
    '1',
    '2',
  ]);
});

test('운영(NODE_ENV=production)에서는 GIFT_HMAC_KEY 가 없으면 뜨지 않는다 (하루 수를 계정 번호로 세면 합치기로 초기화된다)', () => {
  const env = { DATABASE_URL: 'postgres://x', NODE_ENV: 'production' };
  assert.throws(() => readConfig(env), /GIFT_HMAC_KEY/);
  assert.equal(readConfig({ ...env, GIFT_HMAC_KEY: 'g' }).ai?.giftKey, 'g');
  assert.equal(readConfig({ DATABASE_URL: 'postgres://x' }).ai?.giftKey, '');
});

test('서버 백업 키: 비면 끔, hex 64자만. 카카오 주소는 https 만, 기능 키는 off 가 기본', () => {
  const env = { DATABASE_URL: 'postgres://x' };
  const c = readConfig(env);
  assert.equal(c.backup?.key, undefined);
  assert.equal(c.backup?.dir, '/data/backups');
  assert.equal(c.kakaoAuthUrl, 'https://kauth.kakao.com');
  assert.deepEqual(c.features, { kakao_login: 'off', coin_reset: 'off', calendar_link_hint: 'allowlist' });
  assert.equal(readConfig({ ...env, FEATURE_CALENDAR_LINK_HINT: 'off' }).features?.calendar_link_hint, 'off');
  assert.equal(c.backup?.totalMaxBytes, 80 * 1024 ** 3);
  assert.equal(readConfig({ ...env, BACKUP_TOTAL_MAX_GB: '0.5' }).backup?.totalMaxBytes, 512 * 1024 ** 2);
  assert.throws(() => readConfig({ ...env, BACKUP_TOTAL_MAX_GB: '-1' }), /BACKUP_TOTAL_MAX_GB/);
  assert.equal(readConfig({ ...env, FEATURE_COIN_RESET: 'everyone' }).features?.coin_reset, 'everyone');
  assert.equal(kakaoConfigured(c), false);
  const k = 'ab'.repeat(32);
  assert.equal(readConfig({ ...env, BACKUP_ENC_KEY: k }).backup?.key?.toString('hex'), k);
  assert.throws(() => readConfig({ ...env, BACKUP_ENC_KEY: 'short' }), /BACKUP_ENC_KEY/);
  assert.throws(() => readConfig({ ...env, KAKAO_AUTH_URL: 'http://kauth.example' }), /https/);
  assert.equal(readConfig({ ...env, FEATURE_KAKAO_LOGIN: 'Allowlist' }).features?.kakao_login, 'allowlist');
  assert.throws(() => readConfig({ ...env, FEATURE_KAKAO_LOGIN: 'on' }), /FEATURE_KAKAO_LOGIN/);
  assert.equal(
    kakaoConfigured(readConfig({ ...env, KAKAO_REST_API_KEY: 'a', KAKAO_CLIENT_SECRET: 'b' })),
    true,
  );
});

test('AI_MONTHLY_BUDGET_USD, AI_DAILY_LIMIT: 보통 10진수만 (0x10, 1e2, 공백 섞인 값은 기동 오류)', () => {
  const env = { DATABASE_URL: 'postgres://x' };
  assert.equal(readConfig({ ...env, AI_MONTHLY_BUDGET_USD: '90' }).ai?.monthlyBudgetMicros, 90_000_000);
  assert.equal(readConfig({ ...env, AI_MONTHLY_BUDGET_USD: '0.5' }).ai?.monthlyBudgetMicros, 500_000);
  assert.equal(readConfig({ ...env, AI_MONTHLY_BUDGET_USD: '0' }).ai?.monthlyBudgetMicros, 0);
  for (const bad of ['0x10', '1e2', '-1', '1,5', '.5', '1 2', 'Infinity'])
    assert.throws(() => readConfig({ ...env, AI_MONTHLY_BUDGET_USD: bad }), /AI_MONTHLY_BUDGET_USD/, bad);
  for (const bad of ['0x10', '1e2', '1.5', '-1'])
    assert.throws(() => readConfig({ ...env, AI_DAILY_LIMIT: bad }), /AI_DAILY_LIMIT/, bad);
  assert.equal(readConfig({ ...env, AI_DAILY_LIMIT: '7' }).ai?.dailyLimit, 7);
});
