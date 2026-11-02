-- 0019: 기기 간 동기화 (docs/sync-plan.md 5절). 더하기만 한다: 옛 서버 코드는 새 표를 몰라도 그대로 돈다.
-- 서버는 항목의 내용을 모른다. 기기에서 잠근 덩어리(blob)와 번호, 크기, 시각만 둔다.

-- 복구 코드로 감싼 데이터 열쇠. 서버는 소금, scrypt 값(N, r, p 만), 감싼 열쇠만 안다.
-- gen: 데이터 열쇠의 세대 (열쇠 바꾸기 때 오른다, 오르면 옛 열쇠로 잠근 항목은 모두 지운다).
-- key_rev: 감싼 열쇠의 판 (복구 코드 새로 만들기든 열쇠 바꾸기든 덮어쓸 때마다 오른다, 옛 판을 든 기기의 덮어쓰기를 막는다)
CREATE TABLE sync_key (
  account_id BIGINT PRIMARY KEY REFERENCES account (id) ON DELETE CASCADE,
  salt BYTEA NOT NULL,
  params JSONB NOT NULL,
  wrapped BYTEA NOT NULL,
  gen INTEGER NOT NULL DEFAULT 1,
  key_rev INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 항목 하나의 지금 모습. rev 는 계정 안에서 항목을 받을 때마다 1씩 오르는 번호다 (sync_head.rev 가 마지막 번호).
-- 지운 항목도 줄을 남긴다 (deleted): 다른 기기가 changes 로 알아야 한다. blob 은 256KB 이하 (코드가 검사한다).
-- 지운 지 90일이 지나면 정리 작업이 blob 을 비우고 purged_at 을 적는다 (uid 와 rev 는 남긴다). 비운 줄은 항목 수와 바이트에 세지 않는다
CREATE TABLE sync_item (
  account_id BIGINT NOT NULL REFERENCES account (id) ON DELETE CASCADE,
  uid TEXT NOT NULL,
  rev BIGINT NOT NULL,
  blob BYTEA NOT NULL,
  deleted BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  purged_at TIMESTAMPTZ,
  PRIMARY KEY (account_id, uid)
);
-- 바뀐 것 찾기 (changes: rev 가 since 보다 큰 것을 rev 순으로)
CREATE INDEX sync_item_rev ON sync_item (account_id, rev);

-- 계정마다 한 줄: 마지막 번호, epoch(서버 사본이 통째로 바뀐 횟수: 지우기, 계정 합치기, 열쇠 세대가 오를 때 오른다.
-- 기기는 요청마다 자기가 아는 epoch 를 보내고 다르면 409 로 다시 맞춘다), 항목 수와 바이트 합(상한 검사용, 쓰는 트랜잭션에서 맞춘다),
-- 마지막으로 어느 기기든 changes 나 push 한 때 (1년 정리 기준)
CREATE TABLE sync_head (
  account_id BIGINT PRIMARY KEY REFERENCES account (id) ON DELETE CASCADE,
  rev BIGINT NOT NULL DEFAULT 0,
  epoch INTEGER NOT NULL DEFAULT 1,
  items INTEGER NOT NULL DEFAULT 0,
  bytes BIGINT NOT NULL DEFAULT 0,
  last_access_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sync_head_access ON sync_head (last_access_at);

-- 기능 키 sync 는 0004 의 기능 스위치 표를 같이 쓴다. 줄을 넣지 않는다 (서버 설정 FEATURE_SYNC, 기본 allowlist)
