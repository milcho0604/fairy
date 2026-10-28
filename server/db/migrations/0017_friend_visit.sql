-- 0017: 친구 2부, 펫 놀러 가기 (이슈 #141). 더하기만 한다: 옛 서버 코드는 새 칸과 표를 몰라도 그대로 돈다.
-- visit_on: account_id 의 펫이 friend_id 에게 놀러 가도 된다 (친구별로 켠다, 기본 꺼짐). 양쪽 줄이 모두 켜져야 성립한다.
ALTER TABLE friend ADD COLUMN visit_on BOOLEAN NOT NULL DEFAULT false;

-- 내 펫 카드: 앱에 든 기본 펫의 종류 id, 이름, 네 발 서기 여부뿐이다 (사진, 그림 파일은 받지 않는다).
-- 종류 허용 목록과 이름 규칙은 코드가 검사한다 (src/shared/pet-card.ts, 종류가 늘 때마다 마이그레이션을 쓰지 않으려고 DB 는 모양만 본다).
-- 놀러 갈 친구가 없어지면 바로 지우고, 14일 동안 안 올리면 정리 작업이 지운다. 방문 기록은 서버에 남기지 않는다
CREATE TABLE pet_card (
  account_id BIGINT PRIMARY KEY REFERENCES account (id) ON DELETE CASCADE,
  species TEXT NOT NULL CHECK (species ~ '^(kind|starter):[a-z0-9]{2,12}$'),
  name TEXT CHECK (name IS NULL OR char_length(name) BETWEEN 1 AND 12),
  stand BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX pet_card_updated ON pet_card (updated_at);

-- 기능 키 friend_visit 는 0004 의 기능 스위치 표를 같이 쓴다. 줄을 넣지 않는다 (서버 설정 FEATURE_FRIEND_VISIT, 기본 allowlist)
