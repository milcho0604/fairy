-- 0015: 안 연 쪽지 철회 (#153). 더하기만 한다: 옛 서버 코드는 이 열을 모르고 INSERT 해도 NULL(철회 아님)로 들어간다.
-- 철회한 쪽지는 쪽지함 목록과 안 연 개수에서 빠지고 열 수 없다. 행은 1년 동안 남겨 운영 화면이 "철회됨" 으로 보인다.
-- 연 쪽지는 철회할 수 없다: 열린 줄에는 withdrawn_at 이 있을 수 없다 (열기와 철회가 동시에 와도 둘 중 하나만).
-- withdrawn_by 는 운영 기록과 같은 모양의 철회한 사람 (웹 세션 앞 8자 또는 account:번호).
ALTER TABLE inbox ADD COLUMN withdrawn_at TIMESTAMPTZ;
ALTER TABLE inbox ADD COLUMN withdrawn_by TEXT CHECK (withdrawn_by IS NULL OR length(withdrawn_by) <= 120);
ALTER TABLE inbox ADD CONSTRAINT inbox_withdrawn_check CHECK (withdrawn_at IS NULL OR opened_at IS NULL);
