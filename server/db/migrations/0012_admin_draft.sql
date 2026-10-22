-- 0012: 알리기 초안 (이슈 #154). 더하기만 한다: 옛 서버 코드는 이 표를 모른다.
-- 운영자가 쓰다 만 공지, 이벤트, 쿠폰, 버전 폼을 종류마다 한 개씩 둔다. 공지 글과 날짜와 숫자뿐이고 이용자 개인정보는 없다.
-- 쿠폰 원본 코드는 폼에 없고 서버도 해시만 둔다. 초안은 확정하거나 지우면 사라진다.
CREATE TABLE admin_draft (
  kind TEXT PRIMARY KEY CHECK (kind IN ('notices', 'events', 'coupons', 'versions')),
  body JSONB NOT NULL,
  saved_by TEXT NOT NULL CHECK (length(saved_by) <= 120),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
