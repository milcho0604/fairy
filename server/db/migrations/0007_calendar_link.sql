-- 0007: 같은 계정의 기기끼리 구글 일정 연결 이어 주기 (이슈 #115).
-- 구글 캘린더 토큰은 서버에 두지 않는다 (유출 위험, 구글 민감 권한 심사). 기기마다 "이 기기는 구글 일정을 연결했다"는 표시만 둔다.
-- 계정의 표시는 그 계정 기기 중 연결한 기기가 하나라도 있는가로 센다: 마지막 기기가 끊으면 저절로 거짓이 된다.
-- 기기 줄을 따라가므로 합치면 남는 쪽으로 옮겨 가고(device.account_id 가 바뀐다), 탈퇴하면 함께 지워진다(ON DELETE CASCADE).
-- 기능 키 calendar_link_hint 는 0004 의 기능 스위치 표를 같이 쓴다 (server/src/features.ts, 줄이 없으면 env 기본 allowlist).

CREATE TABLE calendar_link (
  device_id BIGINT PRIMARY KEY REFERENCES device (id) ON DELETE CASCADE,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
