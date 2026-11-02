-- 운영 기록(admin_log)에 쪽지 글을 평문으로 남기지 않는다: 쪽지 글은 inbox 칸에서만 암호화해 둔다 (INBOX_ENC_KEY).
-- 새 기록은 글자 수(messageChars)만 담고, 이미 쌓인 기록의 message 키는 지운다.
UPDATE admin_log SET detail = detail - 'message' WHERE action = 'note.send' AND detail ? 'message';
