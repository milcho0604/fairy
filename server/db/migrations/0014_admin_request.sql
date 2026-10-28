-- 0014: 운영자 쓰기의 요청 번호. 앱 API 가 같은 요청을 여러 번 보내도(재시도, 두 번 누르기) 쪽지는 한 번만 나가게 한다.
-- 요청 번호가 없는 요청은 예전처럼 매번 쓴다. 번호는 (누가, 어떤 동작, 번호) 가 유일하다.
CREATE TABLE admin_request (
  actor TEXT NOT NULL CHECK (length(actor) BETWEEN 1 AND 40),
  action TEXT NOT NULL CHECK (length(action) BETWEEN 1 AND 40),
  request_id TEXT NOT NULL CHECK (request_id ~ '^[A-Za-z0-9_-]{8,64}$'),
  -- 보낸 내용의 해시. 같은 번호에 다른 내용이 오면 409 로 거절한다
  body_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (actor, action, request_id)
);
CREATE INDEX admin_request_created ON admin_request (created_at);
