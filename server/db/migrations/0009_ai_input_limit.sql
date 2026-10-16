-- 0009: 질문 글자 수 상한을 운영자가 낮출 수 있게 (AI_MAX_INPUT_CHARS 는 .env 상한, 이 칸은 운영자 설정).
-- 비어 있으면 .env 상한을 그대로 쓴다. 0004 의 ai_setting 한 줄(id = 1)에 칸만 더한다.
ALTER TABLE ai_setting ADD COLUMN input_chars INTEGER CHECK (input_chars IS NULL OR input_chars >= 1);
