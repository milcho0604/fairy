-- 쪽지 글(message)을 칸 암호화로 저장할 수 있게 길이 검사를 넓힌다 (서버 INBOX_ENC_KEY, seal.ts).
-- 평문 200자 검사는 코드(inbox.ts sendInbox)로 옮겼다. 암호문은 "s1:" + base64(iv 12 + 암호문 + 태그 16)이라
-- 200자(한글 600바이트)까지 약 840자다. 기존 줄의 암호화는 SQL 로 못 하므로 서버가 켜질 때 한다 (Inbox.sealPending).
ALTER TABLE inbox DROP CONSTRAINT inbox_message_check;
ALTER TABLE inbox ADD CONSTRAINT inbox_message_check CHECK (length(message) BETWEEN 1 AND 1000);
-- 열쇠 없던 시절의 평문이 우연히 's1:' 나 's0:' 로 시작하면 암호문 접두어와 겹친다: 's0:' 를 앞에 붙여 평문으로 구분한다 (seal.ts)
UPDATE inbox SET message = 's0:' || message WHERE message LIKE 's1:%' OR message LIKE 's0:%';
