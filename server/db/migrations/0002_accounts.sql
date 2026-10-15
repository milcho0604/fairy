-- 0002: 계정, 기기, 로그인, 세션, 코인 장부, 산 물건, 기존 잔액 옮기기 (기획서 5, 6, 12, 21절).
-- 개인정보는 최소로: 이름, 이메일, 생년월일, IP 는 어디에도 두지 않는다. 토큰은 sha256 해시만 둔다.
-- 계정을 지우면(탈퇴) 딸린 행이 모두 함께 지워진다(ON DELETE CASCADE). 합쳐져 닫힌 계정도 남는 쪽을 따라 지워진다.

CREATE TABLE account (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- 나이 구분만 받는다. 만 14세 미만은 서버 기능을 쓰지 않으므로 값이 없다 (5절)
  age TEXT NOT NULL CHECK (age IN ('14+', '18+')),
  -- 정본 잔액. coin_entry 의 이 계정 amount 합과 같다 (같은 트랜잭션에서 고친다)
  balance BIGINT NOT NULL DEFAULT 0 CHECK (balance >= 0),
  -- 기존 잔액 옮기기로 받은 합. 합쳐도 계정마다 상한(10,000)을 넘지 않게 센다
  migrated INTEGER NOT NULL DEFAULT 0 CHECK (migrated >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 다른 계정에 합쳐져 닫힌 때와 남는 쪽 (21절). 닫힌 계정의 장부는 같은 기록을 다시 받지 않게 남긴다
  closed_at TIMESTAMPTZ,
  merged_into BIGINT REFERENCES account (id) ON DELETE CASCADE
);
CREATE INDEX account_merged_into ON account (merged_into) WHERE merged_into IS NOT NULL;

CREATE TABLE device (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id BIGINT NOT NULL REFERENCES account (id) ON DELETE CASCADE,
  token_hash BYTEA NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX device_account ON device (account_id);

-- 로그인 서비스의 계정 고유 번호(sub)만 둔다. (서비스, sub) 하나는 한 계정에만 붙는다
CREATE TABLE login (
  service TEXT NOT NULL CHECK (service IN ('google', 'kakao')),
  sub TEXT NOT NULL CHECK (length(sub) BETWEEN 1 AND 255),
  account_id BIGINT NOT NULL REFERENCES account (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (service, sub)
);
CREATE INDEX login_account ON login (account_id);

-- 로그인으로 받은 세션 (POST /v1/session). 마지막으로 쓴 뒤 180일이 지나면 무효 (쓸 때 하루 한 번 last_used_at 을 고친다)
CREATE TABLE session (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id BIGINT NOT NULL REFERENCES account (id) ON DELETE CASCADE,
  token_hash BYTEA NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX session_account ON session (account_id);

-- 코인 장부. entry_id 는 앱이 만든 기록 번호(서버가 만든 줄은 'merge:', 'migrate:' 로 시작)라 같은 기록은 한 번만 들어온다.
-- 거절하거나 상한에 걸린 기록도 남겨, 다시 보내면 처음과 같은 결과를 돌려준다.
CREATE TABLE coin_entry (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entry_id TEXT NOT NULL UNIQUE CHECK (length(entry_id) BETWEEN 1 AND 80),
  account_id BIGINT NOT NULL REFERENCES account (id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 40),
  -- 앱이 보낸 양과 실제로 반영한 양
  asked INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok', 'capped', 'rejected')),
  -- 할 일 기록(todo, early, undo)의 할 일 번호. 앱이 만든 값(할 일 id 의 해시 등)이라 서버는 같은지만 본다
  ref TEXT CHECK (length(ref) BETWEEN 1 AND 64),
  error TEXT,
  -- 앱의 현지 날짜 (하루 상한을 세는 날)
  day DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX coin_entry_day ON coin_entry (account_id, reason, day);
CREATE INDEX coin_entry_ref ON coin_entry (account_id, ref) WHERE ref IS NOT NULL;

-- 산 물건. 집은 item='house', count=단계. 장난감과 집 모양은 'toy:ball', 'house-style:igloo' 처럼, count=1
CREATE TABLE owned_item (
  account_id BIGINT NOT NULL REFERENCES account (id) ON DELETE CASCADE,
  item TEXT NOT NULL CHECK (length(item) BETWEEN 1 AND 40),
  count INTEGER NOT NULL CHECK (count > 0),
  PRIMARY KEY (account_id, item)
);

-- 기존 잔액 옮기기는 한 번씩만 (6절): 로그인 없는 기기 계정마다 한 번('account:<번호>'), 로그인(sub)마다 한 번
-- ('login:<서비스>:<sub>'). 옮길 때 계정의 키와 그 계정 로그인의 키를 모두 적고, 하나라도 있으면 거절한다.
-- 합쳐도 키는 남아(닫힌 계정 것) 같은 기기나 로그인으로 다시 옮기지 못한다. 탈퇴하면 함께 지워진다
CREATE TABLE migration_done (
  key TEXT PRIMARY KEY CHECK (length(key) BETWEEN 1 AND 300),
  account_id BIGINT NOT NULL REFERENCES account (id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX migration_done_account ON migration_done (account_id);
