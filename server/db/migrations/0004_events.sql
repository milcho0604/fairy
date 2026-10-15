-- 0004: 이벤트(선물, 배수), 쿠폰, 쪽지함, 공지 문서, 운영 기록, 기능 스위치, AI 관리, 닉네임과 기기 코드
-- (기획서 9, 10, 12, 23절, 이슈 #101).
-- 코인은 모두 코인 장부(coin_entry)에 서버가 만든 기록 번호로 남긴다: 'claim:<이벤트>:<계정>', 'coupon:<쿠폰>:<계정>',
-- 'grant:<지급>', 'boost:<앱 기록 번호>'. 기록 번호가 유일해 같은 일은 한 번만 들어간다.

-- 이벤트. 목록은 GET /v1/events.json 으로 내보내 홈페이지 정적 파일이 된다 (앱은 정적 파일만 읽는다)
CREATE TABLE event (
  id TEXT PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$'),
  kind TEXT NOT NULL CHECK (kind IN ('gift', 'boost')),
  title_ko TEXT NOT NULL CHECK (length(title_ko) BETWEEN 1 AND 60),
  title_en TEXT NOT NULL CHECK (length(title_en) BETWEEN 1 AND 60),
  body_ko TEXT NOT NULL CHECK (length(body_ko) BETWEEN 1 AND 300),
  body_en TEXT NOT NULL CHECK (length(body_en) BETWEEN 1 AND 300),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  -- 선물: 받는 코인
  coins INTEGER CHECK (coins BETWEEN 1 AND 1000),
  -- 배수: 까닭('meet', 'focus')과 배수(2, 3)
  boost_reasons TEXT[],
  boost_times INTEGER CHECK (boost_times IN (2, 3)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  CHECK (
    (kind = 'gift' AND coins IS NOT NULL AND boost_reasons IS NULL AND boost_times IS NULL)
    OR (kind = 'boost' AND coins IS NULL AND boost_reasons IS NOT NULL AND boost_times IS NOT NULL
        AND cardinality(boost_reasons) BETWEEN 1 AND 2 AND boost_reasons <@ ARRAY['meet', 'focus'])
  )
);
CREATE INDEX event_ends ON event (ends_at);

-- 선물 받기: 계정과 이벤트마다 한 번 (유일). 합쳐진 계정은 남는 쪽 가족 전체로 본다 (rewards.ts)
CREATE TABLE event_claim (
  event_id TEXT NOT NULL REFERENCES event (id) ON DELETE CASCADE,
  account_id BIGINT NOT NULL REFERENCES account (id) ON DELETE CASCADE,
  coins INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, account_id)
);
CREATE INDEX event_claim_account ON event_claim (account_id);

-- 쿠폰. 코드 원문은 두지 않는다: sha256 만 (만들 때 운영자 화면에 한 번 보인다). hint 는 앞 4자 (목록에서 알아보기)
CREATE TABLE coupon (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code_hash BYTEA NOT NULL UNIQUE CHECK (octet_length(code_hash) = 32),
  hint TEXT NOT NULL CHECK (length(hint) = 4),
  label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 80),
  coins INTEGER NOT NULL DEFAULT 0 CHECK (coins BETWEEN 0 AND 1000),
  tickets INTEGER NOT NULL DEFAULT 0 CHECK (tickets BETWEEN 0 AND 50),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  -- 전체 사용 상한과 지금까지 쓴 수 (쓸 때 이 행을 잠가 센다)
  max_uses INTEGER NOT NULL CHECK (max_uses BETWEEN 1 AND 100000),
  used INTEGER NOT NULL DEFAULT 0,
  disabled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  CHECK (coins > 0 OR tickets > 0),
  CHECK (used BETWEEN 0 AND max_uses)
);

-- 쿠폰 쓰기: 계정과 쿠폰마다 한 번 (유일)
CREATE TABLE coupon_use (
  coupon_id BIGINT NOT NULL REFERENCES coupon (id) ON DELETE CASCADE,
  account_id BIGINT NOT NULL REFERENCES account (id) ON DELETE CASCADE,
  coins INTEGER NOT NULL,
  tickets INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (coupon_id, account_id)
);
CREATE INDEX coupon_use_account ON coupon_use (account_id);

-- 쪽지함 (#101 범위 추가 4). 운영자가 계정에 보내는 쪽지(개인 지급, 알림)와 정기 지급의 달마다 쪽지.
-- 첨부(코인, 채팅 이용권)는 보낼 때가 아니라 사용자가 열 때 준다 (POST /v1/inbox/:id/open, 한 번만: 쪽지 행을 잠그고
-- opened_at 과 장부 기록 번호 'inbox:<id>' 가 막는다). 만료가 지나면 열 수 없다.
-- fill_to: 정기 지급 "N장까지 채우기" 쪽지. 열 때 남은 장수를 보고 모자란 만큼만 준다 (이월 없음)
CREATE TABLE inbox (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id BIGINT NOT NULL REFERENCES account (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('grant', 'notice', 'subscription')),
  message TEXT CHECK (length(message) BETWEEN 1 AND 200),
  coins INTEGER NOT NULL DEFAULT 0 CHECK (coins BETWEEN 0 AND 10000),
  chat_passes INTEGER NOT NULL DEFAULT 0 CHECK (chat_passes BETWEEN 0 AND 1000),
  fill_to INTEGER CHECK (fill_to BETWEEN 1 AND 1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  opened_at TIMESTAMPTZ,
  -- 열 때 실제로 준 것
  opened_coins INTEGER,
  opened_passes INTEGER,
  CHECK (kind <> 'notice' OR (coins = 0 AND chat_passes = 0 AND fill_to IS NULL AND message IS NOT NULL)),
  CHECK (kind <> 'grant' OR coins > 0 OR chat_passes > 0)
);
CREATE INDEX inbox_unopened ON inbox (account_id) WHERE opened_at IS NULL;

-- 운영자 화면에서 고치는 정적 파일 문서. 지금은 'notices' 하나 (site/notices.json 모양 그대로).
-- 한 번도 저장하지 않았으면 행이 없고 GET /v1/notices.json 은 404 (Actions 가 레포 파일을 덮지 않는다)
CREATE TABLE site_doc (
  name TEXT PRIMARY KEY CHECK (name IN ('notices')),
  body JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 서버 설정 (한 키 한 값). rewards_login_only: 선물 받기와 쿠폰은 로그인(구글, 카카오 세션) 계정만 (기본 켬,
-- 버그잡이 #113: 기기 계정을 계속 만들어 선물을 모으는 길을 막는다). 운영자 쪽지 지급은 기기 계정에도 간다
CREATE TABLE server_setting (
  key TEXT PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO server_setting (key, value) VALUES ('rewards_login_only', 'true');

-- 운영 기록 (10절: 누가, 언제, 무엇을). 운영자는 한 사람이라 누가는 운영자 세션 번호 앞 8자. IP 는 두지 않는다.
-- 1년 뒤 지운다 (13절)
CREATE TABLE admin_log (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor TEXT NOT NULL CHECK (length(actor) BETWEEN 1 AND 40),
  action TEXT NOT NULL CHECK (length(action) BETWEEN 1 AND 40),
  target TEXT CHECK (length(target) <= 120),
  detail JSONB
);
CREATE INDEX admin_log_at ON admin_log (at);

-- ---- 운영자의 AI 대화권(채팅 이용권) 관리와 계정의 닉네임, 기기 코드 (#101 범위 추가) ----
-- 기능 스위치(feature_flag, feature_allow): 기능마다 접근 모드(off, allowlist, everyone)와 허용 계정. 첫 항목 ai_chat.
-- 나중에 kakao_login 같은 기능이 같은 표에 들어온다. AI: 월 예산과 하루 상한(ai_setting), 계정별 차단, 정기 지급.
-- .env.prod 의 AI_MONTHLY_BUDGET_USD, AI_DAILY_LIMIT 는 넘을 수 없는 상한이고, 실제 값은 이 표의 값과 그 상한 중 작은 쪽이다.

-- 닉네임 (2~12자, 검사는 src/shared/nickname.ts. 중복 허용) 과 기기 코드 (사람에게 보이는 공개 코드 F-XXXX-XXXX.
-- 토큰, 계정 번호와 무관한 무작위 값. 합쳐져 닫힌 계정도 자기 코드를 남겨 운영자가 찾을 수 있다)
ALTER TABLE account ADD COLUMN nickname TEXT CHECK (char_length(nickname) BETWEEN 2 AND 12);
ALTER TABLE account ADD COLUMN code TEXT UNIQUE CHECK (code ~ '^F-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$');
DO $$
DECLARE
  r RECORD;
  alphabet CONSTANT TEXT := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  b BYTEA;
  c TEXT;
BEGIN
  FOR r IN SELECT id FROM account WHERE code IS NULL LOOP
    LOOP
      b := gen_random_bytes(8);
      c := 'F-';
      FOR i IN 0..7 LOOP
        IF i = 4 THEN c := c || '-'; END IF;
        c := c || substr(alphabet, (get_byte(b, i) % 32) + 1, 1);
      END LOOP;
      BEGIN
        UPDATE account SET code = c WHERE id = r.id;
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        -- 같은 코드가 이미 있으면 다시 뽑는다
      END;
    END LOOP;
  END LOOP;
END $$;
ALTER TABLE account ALTER COLUMN code SET NOT NULL;
CREATE INDEX account_nickname ON account (lower(nickname)) WHERE nickname IS NOT NULL;

-- 기능 스위치. ai_chat 은 처음에 allowlist: 허용 계정과 운영자 계정(ADMIN_GOOGLE_SUBS)만 쓴다
CREATE TABLE feature_flag (
  key TEXT PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  mode TEXT NOT NULL DEFAULT 'allowlist' CHECK (mode IN ('off', 'allowlist', 'everyone')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO feature_flag (key, mode) VALUES ('ai_chat', 'allowlist');

-- 기능별 허용 계정 (mode = allowlist 일 때). 탈퇴하면 함께 지워지고, 합치면 남는 쪽으로 옮긴다
CREATE TABLE feature_allow (
  key TEXT NOT NULL REFERENCES feature_flag (key) ON DELETE CASCADE,
  account_id BIGINT NOT NULL REFERENCES account (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (key, account_id)
);
CREATE INDEX feature_allow_account ON feature_allow (account_id);

-- AI 설정 (한 줄). 예산과 하루 상한은 비어 있으면 .env 상한을 그대로 쓴다.
-- 정책 (#101 사용자 결정): 허용된 계정에는 매달 auto_monthly 장까지 채우기 정기 지급이 저절로 걸린다 (이월 없음).
-- 정기 지급 계정은 seat_limit 명까지 (차면 대기 목록). 첫 로그인 선물 10장은 first_gift 를 켤 때만
CREATE TABLE ai_setting (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  monthly_budget_micros BIGINT CHECK (monthly_budget_micros >= 0),
  daily_limit INTEGER CHECK (daily_limit >= 0),
  auto_monthly INTEGER NOT NULL DEFAULT 100 CHECK (auto_monthly BETWEEN 1 AND 1000),
  seat_limit INTEGER NOT NULL DEFAULT 100 CHECK (seat_limit BETWEEN 0 AND 100000),
  first_gift BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO ai_setting (id) VALUES (1);

-- 자리가 없어 기다리는 계정 (정기 지급 상한에 찼을 때). 자리가 나면 운영자가 허용하거나 다음에 물을 때 들어간다
CREATE TABLE ai_waitlist (
  account_id BIGINT PRIMARY KEY REFERENCES account (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 계정별 AI 차단 (있으면 그 계정은 대화권을 못 쓴다). 탈퇴하면 함께 지워지고, 합치면 남는 쪽으로 옮긴다
CREATE TABLE ai_block (
  account_id BIGINT PRIMARY KEY REFERENCES account (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 정기 지급 (구독처럼). 매달(한국 달력) 한 번 채운다. fill: monthly 개까지 채우기(이월 없음), add: monthly 개 더하기
CREATE TABLE ai_subscription (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id BIGINT NOT NULL REFERENCES account (id) ON DELETE CASCADE,
  monthly INTEGER NOT NULL CHECK (monthly BETWEEN 1 AND 1000),
  mode TEXT NOT NULL DEFAULT 'fill' CHECK (mode IN ('fill', 'add')),
  -- 한국 날짜. 끝이 비면 무기한
  starts_on DATE NOT NULL,
  ends_on DATE,
  canceled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_on IS NULL OR ends_on >= starts_on)
);
CREATE INDEX ai_subscription_account ON ai_subscription (account_id);
-- 계정마다 살아 있는 정기 지급은 하나 (바꾸려면 해지하고 새로)
CREATE UNIQUE INDEX ai_subscription_live ON ai_subscription (account_id) WHERE canceled_at IS NULL;

-- 달마다 보낸 쪽지. (정기 지급, 달) 유일이라 같은 달에 두 번 보내지 않는다. 채팅 이용권은 쪽지를 열 때 준다
CREATE TABLE ai_subscription_fill (
  subscription_id BIGINT NOT NULL REFERENCES ai_subscription (id) ON DELETE CASCADE,
  month TEXT NOT NULL CHECK (month ~ '^\d{4}-\d{2}$'),
  inbox_id BIGINT REFERENCES inbox (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (subscription_id, month)
);
