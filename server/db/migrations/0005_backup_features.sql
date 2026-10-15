-- 0005: 서버 백업 (기획서 7, 12, 13절, 이슈 #102)과 기능 키.
-- 백업 파일은 DB 가 아니라 디스크 볼륨(fairy_backups)에 AES-256-GCM 으로 암호화해 둔다. DB 에는 메타만.
-- 탈퇴하면 줄이 함께 지워지고(ON DELETE CASCADE) 서버가 파일도 바로 지운다. 줄 없는 파일은 정리 작업이 지운다.

CREATE TABLE backup (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id BIGINT NOT NULL REFERENCES account (id) ON DELETE CASCADE,
  -- 디스크의 파일 이름 (<file>.fbk). 무작위 값이라 계정 번호를 드러내지 않는다
  file TEXT NOT NULL UNIQUE CHECK (file ~ '^[0-9a-f]{32}$'),
  -- 평문(.fairybackup) 크기와 sha256. 파일 하나 최대 20MB (20 * 1024 * 1024)
  size INTEGER NOT NULL CHECK (size > 0 AND size <= 20971520),
  sha256 BYTEA NOT NULL CHECK (octet_length(sha256) = 32),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 마지막으로 올리거나 받은 때 (보이기용. 지우는 기준은 account.last_active_at)
  last_access_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX backup_account ON backup (account_id, created_at);

-- 계정 활동: 토큰을 든 요청(맞추기, 로그인, 그 밖)이 오면 하루 한 번 고친다 (auth.guard.ts).
-- 이로부터 1년이 지나면 그 계정의 서버 백업을 지운다 (30일 전부터 앱 목록에 "곧 지워짐")
ALTER TABLE account ADD COLUMN last_active_at TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE INDEX account_last_active ON account (last_active_at);

-- 기능 키 kakao_login, coin_reset 은 0004 의 기능 스위치 표(feature_flag, feature_allow)를 같이 쓴다 (server/src/features.ts).
-- 여기서는 줄을 넣지 않는다: 줄이 없으면 서버 설정(env FEATURE_*, 기본 off)을 따르고, 운영자가 바꾸면 그 줄이 이긴다
