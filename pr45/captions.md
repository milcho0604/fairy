# PR #45 설치, 로그인 안내 (채팅 창 400폭, 2배로 찍음)

못 찾음: PATH=/usr/bin:/bin (로그인 셸 PATH 읽기 끔). 로그인 안 됨: --version 만 되고 'Not logged in' 으로 끝나는 가짜 claude, codex. 전 = origin/main(33e6abd), 후 = feat/ai-install-guide(78e55bb).

- 01-before-ko-claude-notfound-bubble.png: [전 main] Claude 못 찾음 오류 말풍선. 아래 '설치 방법 보기' 는 시트를 연다
- 02-before-ko-claude-notfound-sheet.png: [전 main] 그 단추로 연 설치 시트 (대화 위를 덮는다)
- 03-before-ko-codex-notfound-bubble.png: [전 main] Codex 못 찾음 오류 말풍선
- 04-before-ko-codex-notfound-sheet.png: [전 main] Codex 설치 시트
- 05-before-ko-claude-login-bubble.png: [전 main] Claude 로그인 안 됨: 안내 단추 없음, 머리 줄에도 '다시 확인'만
- 06-before-ko-codex-login-bubble.png: [전 main] Codex 로그인 안 됨: 안내 단추 없음
- 07-after-ko-claude-notfound-bubble.png: [후] Claude 못 찾음: 말풍선 아래 '설치 방법 보기' (접힌 상태)
- 08-after-ko-claude-notfound-steps.png: [후] Claude 못 찾음: 그 자리에 펼친 단계 (설치 명령 복사, 로그인, 깔았는데도 못 찾으면, 공식 설치 안내 열기, 다시 확인)
- 09-after-ko-claude-login-bubble.png: [후] Claude 로그인 안 됨: 말풍선 아래 '로그인 방법 보기', 머리 줄에도 같은 단추
- 10-after-ko-claude-login-steps.png: [후] Claude 로그인 안 됨: 펼친 단계 (로그인 명령 복사, 상태 확인 명령, 공식 안내, 다시 확인)
- 11-after-ko-codex-notfound-bubble.png: [후] Codex 못 찾음: 말풍선 아래 '설치 방법 보기' (접힌 상태)
- 12-after-ko-codex-notfound-steps.png: [후] Codex 못 찾음: 그 자리에 펼친 단계 (설치 명령 복사, 로그인, 깔았는데도 못 찾으면, 공식 설치 안내 열기, 다시 확인)
- 13-after-ko-codex-login-bubble.png: [후] Codex 로그인 안 됨: 말풍선 아래 '로그인 방법 보기', 머리 줄에도 같은 단추
- 14-after-ko-codex-login-steps.png: [후] Codex 로그인 안 됨: 펼친 단계 (로그인 명령 복사, 상태 확인 명령, 공식 안내, 다시 확인)
- 15-after-en-claude-notfound-bubble.png: [후] en, Claude 못 찾음 접힌 상태
- 16-after-en-claude-notfound-steps.png: [후] en, Claude 못 찾음 펼친 단계
- 17-after-en-claude-login-bubble.png: [후] en, Claude 로그인 안 됨 접힌 상태
- 18-after-en-claude-login-steps.png: [후] en, Claude 로그인 안 됨 펼친 단계
- 19-after-en-codex-notfound-bubble.png: [후] en, Codex 못 찾음 접힌 상태
- 20-after-en-codex-notfound-steps.png: [후] en, Codex 못 찾음 펼친 단계
- 21-after-en-codex-login-bubble.png: [후] en, Codex 로그인 안 됨 접힌 상태
- 22-after-en-codex-login-steps.png: [후] en, Codex 로그인 안 됨 펼친 단계
- 23-after-dark-ko-claude-notfound-bubble.png: [후] 어두운 모드, Claude 못 찾음 접힌 상태
- 24-after-dark-ko-claude-notfound-steps.png: [후] 어두운 모드, Claude 못 찾음 펼친 단계
- 25-after-dark-ko-claude-login-bubble.png: [후] 어두운 모드, Claude 로그인 안 됨 접힌 상태
- 26-after-dark-ko-claude-login-steps.png: [후] 어두운 모드, Claude 로그인 안 됨 펼친 단계
- 27-after-dark-ko-codex-notfound-bubble.png: [후] 어두운 모드, Codex 못 찾음 접힌 상태
- 28-after-dark-ko-codex-notfound-steps.png: [후] 어두운 모드, Codex 못 찾음 펼친 단계
- 29-after-dark-ko-codex-login-bubble.png: [후] 어두운 모드, Codex 로그인 안 됨 접힌 상태
- 30-after-dark-ko-codex-login-steps.png: [후] 어두운 모드, Codex 로그인 안 됨 펼친 단계

참고: en Codex 못 찾음 펼친 단계(20)는 '공식 설치 안내 열기'와 '다시 확인' 단추가 두 줄로 나뉜다 (Claude 는 한 줄).
