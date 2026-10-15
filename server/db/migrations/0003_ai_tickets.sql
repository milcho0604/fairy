-- 0003: AI 대화권 (기획서 8, 12, 13절, 이슈 #100).
-- 대화 내용은 저장하지 않는다. 사용량은 숫자(토큰, 추정 비용)만 둔다. 사용자가 신고한 대화만 따로 동의를 받아 30일 둔다.

-- 남은 대화권. 계정을 지우면(탈퇴) 함께 지워진다. 합치면 더한다 (21절)
CREATE TABLE ai_ticket (
  account_id BIGINT PRIMARY KEY REFERENCES account (id) ON DELETE CASCADE,
  remaining INTEGER NOT NULL DEFAULT 0 CHECK (remaining >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 첫 로그인 선물(10개)을 받은 로그인. 계정에 묶지 않는다: 탈퇴해도 남아 같은 구글 계정으로 다시 가입해 또 받지 못한다.
-- 키는 HMAC-SHA256(GIFT_HMAC_KEY, 'google:<sub>') 라 서버 비밀 없이는 누구의 것인지 알 수 없다. 1년 뒤 지운다 (정리 작업)
CREATE TABLE ai_gift_seen (
  key_hmac BYTEA PRIMARY KEY CHECK (octet_length(key_hmac) = 32),
  first_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '1 year'
);
CREATE INDEX ai_gift_seen_expires ON ai_gift_seen (expires_at);

-- 사람별 하루 질문 수. 키는 위와 같은 HMAC 이라 탈퇴하고 다시 가입해도 그날 수가 이어진다
-- (GIFT_HMAC_KEY 가 없으면 계정 번호로 센다). 이틀 지난 줄은 지운다
CREATE TABLE ai_daily (
  key_hmac BYTEA NOT NULL CHECK (octet_length(key_hmac) = 32),
  day DATE NOT NULL,
  used INTEGER NOT NULL DEFAULT 0 CHECK (used >= 0),
  PRIMARY KEY (key_hmac, day)
);
CREATE INDEX ai_daily_day ON ai_daily (day);

-- 질문 한 번의 사용량. 글은 없다: 토큰 수와 추정 비용(백만분의 1달러)만.
-- pending: 대화권을 뺐고 답을 받는 중 (cost_micros 는 그 질문이 쓸 수 있는 가장 큰 값으로 잡아 둔다)
-- ok: 답을 다 받음 / refunded: 실패해 대화권을 돌려줌 (실제로 쓴 토큰이 있으면 비용은 남긴다)
-- 계정을 지워도 숫자는 남긴다 (월 상한을 세려고). 계정 번호만 비운다
CREATE TABLE ai_usage (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id BIGINT REFERENCES account (id) ON DELETE SET NULL,
  -- 사람별 하루 상한을 세는 날 (한국 날짜)
  day DATE NOT NULL,
  model TEXT NOT NULL CHECK (length(model) BETWEEN 1 AND 80),
  status TEXT NOT NULL CHECK (status IN ('pending', 'ok', 'refunded')),
  input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens INTEGER NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  cost_micros BIGINT NOT NULL DEFAULT 0 CHECK (cost_micros >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);
CREATE INDEX ai_usage_account_day ON ai_usage (account_id, day);
CREATE INDEX ai_usage_created ON ai_usage (created_at);
CREATE INDEX ai_usage_pending ON ai_usage (created_at) WHERE status = 'pending';

-- 사용자가 "신고"를 누르고 따로 동의한 대화 하나 (8절, 13절). 30일 뒤 지운다. 탈퇴하면 바로 지운다
CREATE TABLE ai_report (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id BIGINT NOT NULL REFERENCES account (id) ON DELETE CASCADE,
  question TEXT NOT NULL CHECK (length(question) <= 4000),
  answer TEXT NOT NULL CHECK (length(answer) BETWEEN 1 AND 8000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ai_report_account ON ai_report (account_id);
CREATE INDEX ai_report_created ON ai_report (created_at);
