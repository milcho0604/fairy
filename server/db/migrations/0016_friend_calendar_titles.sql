-- 0016: 일정 공유 2차, 친구별 일정 제목 공유 (이슈 #110). 더하기만 한다: 옛 서버 코드는 새 칸과 표를 몰라도 그대로 돈다.
-- share_title: account_id 가 friend_id 에게 일정 제목까지 보여 준다 (친구별로 켠다, 기본 꺼짐).
-- 바쁜 시간을 보여 주는 중(share_busy)일 때만 켤 수 있고, 둘 다 만 18세 이상일 때만 켠다 (서버가 강제, friends.ts).
ALTER TABLE friend ADD COLUMN share_title BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE friend ADD CONSTRAINT friend_title_check CHECK (NOT share_title OR share_busy);

-- 앱이 올린 일정 제목 (비공개 일정은 앱이 올리지 않는다). 제목을 보여 줄 친구가 없어지면 바로 지운다.
-- 끝난 것은 정리 작업이 지운다. busy_block 과 따로 둔 까닭: 바쁨 블록은 겹친 것을 합치지만 제목은 일정마다 한 줄이다
CREATE TABLE busy_title (
  account_id BIGINT NOT NULL REFERENCES account (id) ON DELETE CASCADE,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  CHECK (ends_at > starts_at)
);
CREATE INDEX busy_title_account ON busy_title (account_id, starts_at);
CREATE INDEX busy_title_ends ON busy_title (ends_at);
