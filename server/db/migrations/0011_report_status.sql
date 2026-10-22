-- 0011: 신고 처리 상태 (#151). 더하기만 한다: 옛 서버 코드는 이 열을 모르고 INSERT 해도 기본값 pending 으로 들어간다.
-- status 는 pending(미처리), seen(확인), done(조치). 처리자는 운영 기록과 같은 모양(actor: 웹 세션 앞 8자 또는 account:번호,
-- handled_name: 쓰는 때의 이름 그림자)이고, 미처리로 되돌리면 셋 다 비운다. 신고는 받은 날부터 30일 뒤 지우는 규칙(ai.ts sweep)은 그대로다.
ALTER TABLE ai_report ADD COLUMN status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'seen', 'done'));
ALTER TABLE ai_report ADD COLUMN handled_by TEXT CHECK (handled_by IS NULL OR length(handled_by) <= 120);
ALTER TABLE ai_report ADD COLUMN handled_name TEXT CHECK (handled_name IS NULL OR length(handled_name) <= 80);
ALTER TABLE ai_report ADD COLUMN handled_at TIMESTAMPTZ;
CREATE INDEX ai_report_status ON ai_report (status, created_at DESC);
