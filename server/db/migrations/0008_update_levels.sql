-- 0008: 업데이트 세 단계 (이슈 #120). 기준 세 개(권장, 기능 제한, 강제)는 공지 문서(site_doc 의 notices 줄)에 둔다:
-- recommendVersion, restrictVersion, minVersion (server/src/notice-doc.ts). 서버 미들웨어와 /v1/notices.json 이 같은 줄을 읽는다.
-- 계정의 마지막 앱 판: 활동 기록(auth.guard.ts)과 같이 하루 한 번 쓴다. 운영자 화면의 분포 표(최근 30일 활동 계정)가 읽는다.

-- app_version_at: 앱 판을 마지막으로 적은 때. 판을 하루에 한 번만 적게 하는 기준 (auth.guard.ts)
ALTER TABLE account
  ADD COLUMN app_version TEXT CHECK (app_version ~ '^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$'),
  ADD COLUMN app_version_at TIMESTAMPTZ;
