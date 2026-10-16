-- 0006: 친구 맺기, 친구 선물, 일정 공유 1차 (이슈 #110 1부). 펫 놀러 가기(2부)는 여기 없다.
-- account 표는 고치지 않는다 (같은 때 #115 가 0007 로 account 를 고친다).
-- 개인정보는 최소로: 친구 관계, 신청, 차단은 계정 번호만. 일정은 바쁜 시간대(시작, 끝)만 두고 제목, 장소, 참석자는 받지 않는다.
-- 계정을 지우면(탈퇴) 딸린 행이 모두 함께 지워진다. 합치기(21절)는 server/src/friend-links.ts 가 남는 쪽으로 옮긴다.

-- 친구 관계. 한 쌍마다 두 줄(나 → 친구, 친구 → 나)이라 내 목록은 account_id 로만 읽는다.
-- share_busy: account_id 가 friend_id 에게 바쁜 시간을 보여 준다 (친구별로 켠다, 기본 꺼짐)
CREATE TABLE friend (
  account_id BIGINT NOT NULL REFERENCES account (id) ON DELETE CASCADE,
  friend_id BIGINT NOT NULL REFERENCES account (id) ON DELETE CASCADE,
  share_busy BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, friend_id),
  CHECK (account_id <> friend_id)
);
CREATE INDEX friend_friend ON friend (friend_id);

-- 친구 신청. 보낸 사람과 받는 사람마다 하나. 14일 뒤 만료(정리 작업이 지운다).
-- declined: 받은 사람이 거절했다. 만료까지 남겨 같은 사람이 바로 다시 보내 쪽지함을 채우지 못하게 한다 (보낸 쪽에는 알리지 않는다)
CREATE TABLE friend_request (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  from_account BIGINT NOT NULL REFERENCES account (id) ON DELETE CASCADE,
  to_account BIGINT NOT NULL REFERENCES account (id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'declined')),
  -- 거절된 신청을 보낸 쪽이 거뒀다: 보낸 목록에서는 빼지만 만료까지 남겨 다시 보내지 못하게 한다 (버그잡이 #135)
  withdrawn BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  UNIQUE (from_account, to_account),
  CHECK (from_account <> to_account)
);
CREATE INDEX friend_request_to ON friend_request (to_account);
CREATE INDEX friend_request_expires ON friend_request (expires_at);

-- 차단. blocker 가 blocked 를 막았다: 서로 신청, 선물, 일정 보기가 안 된다. 막힌 쪽에는 알리지 않는다
CREATE TABLE friend_block (
  blocker BIGINT NOT NULL REFERENCES account (id) ON DELETE CASCADE,
  blocked BIGINT NOT NULL REFERENCES account (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker, blocked),
  CHECK (blocker <> blocked)
);
CREATE INDEX friend_block_blocked ON friend_block (blocked);

-- 친구 선물 (코인, 채팅 이용권). 보낼 때 보낸 사람 잔액에서 빼고 받는 사람 쪽지함에 쪽지 한 장을 넣는다 (열 때 준다, 한 번만).
-- 하루 상한은 이 표로 센다 (한국 날짜 day, 보낸 쪽과 받는 쪽 각각, 합쳐진 계정은 가족 전체).
-- request_id: 앱이 만든 무작위 번호. 같은 번호로 다시 보내면 처음 결과를 돌려준다 (두 번 눌러도 한 번).
-- 탈퇴해도 상대 쪽 기록은 남는다 (계정 번호만 비운다). 쪽지는 받는 사람 것이라 보낸 사람이 탈퇴해도 열 수 있다
CREATE TABLE friend_gift (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  from_account BIGINT REFERENCES account (id) ON DELETE SET NULL,
  to_account BIGINT REFERENCES account (id) ON DELETE SET NULL,
  request_id TEXT NOT NULL CHECK (request_id ~ '^[A-Za-z0-9_-]{8,64}$'),
  coins INTEGER NOT NULL DEFAULT 0 CHECK (coins BETWEEN 0 AND 500),
  passes INTEGER NOT NULL DEFAULT 0 CHECK (passes BETWEEN 0 AND 5),
  day DATE NOT NULL,
  inbox_id BIGINT REFERENCES inbox (id) ON DELETE SET NULL,
  -- 받는 사람이 30일 안에 열지 않았거나 탈퇴해 보낸 사람에게 돌려준 때 (장부 'gift-back:<선물>')
  returned_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (coins > 0 OR passes > 0)
);
-- 보낸 사람이 지워지면(NULL) 유일 검사에서 빠진다
CREATE UNIQUE INDEX friend_gift_request ON friend_gift (from_account, request_id);
CREATE INDEX friend_gift_from_day ON friend_gift (from_account, day);
CREATE INDEX friend_gift_to_day ON friend_gift (to_account, day);
CREATE INDEX friend_gift_open ON friend_gift (inbox_id) WHERE returned_at IS NULL;

-- 쪽지함에 친구 쪽지 세 가지: gift(선물, 첨부는 열 때, 30일 기한), friend(친구 신청 알림, 첨부 없음),
-- gift_back(열지 않은 선물이 돌아왔다는 알림. coins, chat_passes 는 돌려준 양이고 돌려줄 때 이미 넣었다: 열어도 더 주지 않는다).
-- from_account: 보낸 친구 (운영자 쪽지는 NULL). 탈퇴하면 NULL 로 두고 "떠난 친구"로 보인다
ALTER TABLE inbox DROP CONSTRAINT inbox_kind_check;
ALTER TABLE inbox ADD CONSTRAINT inbox_kind_check
  CHECK (kind IN ('grant', 'notice', 'subscription', 'gift', 'friend', 'gift_back'));
ALTER TABLE inbox ADD COLUMN from_account BIGINT REFERENCES account (id) ON DELETE SET NULL;
ALTER TABLE inbox ADD COLUMN friend_request_id BIGINT REFERENCES friend_request (id) ON DELETE SET NULL;
ALTER TABLE inbox ADD CONSTRAINT inbox_gift_check CHECK (kind <> 'gift' OR coins > 0 OR chat_passes > 0);
ALTER TABLE inbox ADD CONSTRAINT inbox_friend_check CHECK (kind <> 'friend' OR (coins = 0 AND chat_passes = 0));
CREATE INDEX inbox_from_account ON inbox (from_account) WHERE from_account IS NOT NULL;

-- 일정 공유 1차: 앱이 몇 분마다 올리는 앞으로 14일의 바쁜 시간대. 시작과 끝뿐이다 (제목 없음).
-- 공유를 모두 끄거나 친구를 끊어 보여 줄 사람이 없어지면 바로 지운다. 끝난 시간대는 정리 작업이 지운다
CREATE TABLE busy_block (
  account_id BIGINT NOT NULL REFERENCES account (id) ON DELETE CASCADE,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  CHECK (ends_at > starts_at)
);
CREATE INDEX busy_block_account ON busy_block (account_id, starts_at);
CREATE INDEX busy_block_ends ON busy_block (ends_at);

-- 마지막으로 올린 때 (친구 화면의 "N분 전에 고침")
CREATE TABLE busy_upload (
  account_id BIGINT PRIMARY KEY REFERENCES account (id) ON DELETE CASCADE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 기능 키 friends, friend_gifts, friend_gift_passes, friend_calendar 는 0004 의 기능 스위치 표를 같이 쓴다
-- (server/src/features.ts). 줄을 넣지 않는다: 줄이 없으면 서버 설정(env FEATURE_*) 을 따르고, 그 기본은
-- 모두 allowlist(허용 계정과 운영자 계정)다
