-- 쪽지 글(message)을 칸 암호화로 저장할 수 있게 길이 검사를 넓힌다 (서버 INBOX_ENC_KEY, seal.ts).
-- 평문 200자 검사는 코드(inbox.ts sendInbox)로 옮겼다. 암호문은 "s1:" + base64(iv 12 + 암호문 + 태그 16)이라
-- 200자(한글 600바이트)까지 약 840자다. 기존 줄의 암호화는 SQL 로 못 하므로 서버가 켜질 때 한다 (Inbox.sealPending).
ALTER TABLE inbox DROP CONSTRAINT inbox_message_check;
ALTER TABLE inbox ADD CONSTRAINT inbox_message_check CHECK (length(message) BETWEEN 1 AND 1000);
