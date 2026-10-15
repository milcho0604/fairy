-- 0001: 뼈대. 실제 표(account, device, coin_entry ...)는 2단계부터 다음 번호로 더한다 (기획서 12절).
-- 토큰 해시(sha256)에 쓴다.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
