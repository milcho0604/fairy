-- 0013: 기기별 마지막 요청 시각. 일정 연결 표시는 60일 동안 요청 없는 기기를 세지 않는다 (#130).
-- 기존 기기는 생성일을 마지막 활동의 하한으로 사용한다. 배포 뒤 요청이 오면 실제 요청 시각으로 갱신된다.
ALTER TABLE device
  ADD COLUMN last_used_at TIMESTAMPTZ NOT NULL DEFAULT now();

UPDATE device SET last_used_at = created_at;
