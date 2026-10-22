-- 0010: 운영 기록에 "누가" 를 이름으로 (#155). actor 는 그대로(웹 세션 앞 8자, 앱은 account:번호)이고,
-- actor_name 은 쓰는 때의 이름 그림자(앱 운영자는 닉네임과 번호, 웹은 "웹 운영자")다. 옛 기록은 비어 있고 화면은 actor 를 보인다.
-- 대상 이용자와 동작 종류로 찾는 길에 색인을 더한다.
ALTER TABLE admin_log ADD COLUMN actor_name TEXT CHECK (actor_name IS NULL OR length(actor_name) <= 80);
CREATE INDEX admin_log_action ON admin_log (action);
CREATE INDEX admin_log_target ON admin_log (target) WHERE target IS NOT NULL;
