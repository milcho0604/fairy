-- 0018: 색인 더하기만 한다 (옛 서버 코드는 그대로 돈다). 실측(계정 1만, 쪽지 15만, 코인 기록 30만, 질문 30만)에서 빠진 것들.
-- 마이그레이션 실행기는 파일을 트랜잭션 하나로 돌려서 CREATE INDEX CONCURRENTLY 를 쓸 수 없다. 일반 생성은 표를 만드는
-- 동안(수 초 안쪽) 그 표의 쓰기를 막는다. 홈서버 운영 규모(표 하나가 수십만 줄 이하)에서는 짧다. 새 서버 컨테이너가 이
-- 파일을 적용한 뒤에야 뜨므로 그동안 요청은 기다린다.

-- 쪽지를 지우거나(inbox 청소) 친구 신청을 지울 때 외래키(ON DELETE SET NULL)가 inbox 를 통째로 훑지 않게
CREATE INDEX inbox_friend_request ON inbox (friend_request_id) WHERE friend_request_id IS NOT NULL;
-- 쪽지를 지울 때 선물, 정기 지급 줄의 외래키(ON DELETE SET NULL)가 그 표를 통째로 훑지 않게
-- (friend_gift_open 은 returned_at IS NULL 인 줄만 담아 외래키 검사에 쓰이지 않는다)
CREATE INDEX friend_gift_inbox ON friend_gift (inbox_id) WHERE inbox_id IS NOT NULL;
CREATE INDEX ai_subscription_fill_inbox ON ai_subscription_fill (inbox_id) WHERE inbox_id IS NOT NULL;
-- 쪽지함 목록: 계정별 최신순 (account_id = ANY(...) ORDER BY id DESC LIMIT)
CREATE INDEX inbox_account_id ON inbox (account_id, id DESC);

-- 코인 기록 최근 24시간 합과 14일 활동 계정 수 (운영자 홈): 시간순으로 쌓여 BRIN 이 작고 충분하다
CREATE INDEX coin_entry_created_brin ON coin_entry USING brin (created_at);
-- 이번 달 AI 비용 합 (질문마다 전역 잠금 안에서 더한다, 운영자 홈도 같이): 표를 읽지 않고 색인만 읽는다
CREATE INDEX ai_usage_created_cost ON ai_usage (created_at) INCLUDE (cost_micros);
DROP INDEX ai_usage_created;
