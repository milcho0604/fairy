# PR #49 지난 대화 목록 (feat/chat-history-list 4712479, 채팅 창 2배로 찍음)

## 목록 기능 (10~25)

대화는 가짜 claude(stream-json 으로 미리 적은 답을 돌려주는 스크립트, PATH 앞에 둠)로 넷을 만들고 마지막 대화는 두 번 이어 말했다. 모두 [후] 화면 (main 에는 목록이 없다).

- 10-ko-light-400-chat-with-list-button.png: [후] ko 밝게 400폭, 이어 말한 대화와 머리줄의 목록 단추
- 11-ko-light-400-list.png: [후] ko 밝게 400폭, 지난 대화 목록 (대화 넷, 지금 대화 표시, AI 이름, 날짜)
- 12-ko-light-400-search.png: [후] ko 밝게 400폭, 찾기 (고양이)
- 13-ko-light-400-no-match.png: [후] ko 밝게 400폭, 찾기 결과 없음
- 14-ko-light-400-rename.png: [후] ko 밝게 400폭, 이름 바꾸기 칸 (고양이 사료 대화)
- 15-ko-light-400-renamed.png: [후] ko 밝게 400폭, 이름 바꾼 뒤 목록
- 16-ko-light-400-delete-confirm.png: [후] ko 밝게 400폭, 지우기 확인 줄
- 17-ko-light-400-empty.png: [후] ko 밝게 400폭, 빈 목록
- 18-en-dark-320-chat-with-list-button.png: [후] en 어둡게 320폭, 이어 말한 대화와 머리줄의 목록 단추
- 19-en-dark-320-list.png: [후] en 어둡게 320폭, 지난 대화 목록 (대화 넷, 지금 대화 표시, AI 이름, 날짜)
- 20-en-dark-320-search.png: [후] en 어둡게 320폭, 찾기 (cat)
- 21-en-dark-320-no-match.png: [후] en 어둡게 320폭, 찾기 결과 없음
- 22-en-dark-320-rename.png: [후] en 어둡게 320폭, 이름 바꾸기 칸 (고양이 사료 대화)
- 23-en-dark-320-renamed.png: [후] en 어둡게 320폭, 이름 바꾼 뒤 목록
- 24-en-dark-320-delete-confirm.png: [후] en 어둡게 320폭, 지우기 확인 줄
- 25-en-dark-320-empty.png: [후] en 어둡게 320폭, 빈 목록

눈에 띈 것:
- 14: ko 400폭 이름 바꾸기 줄에서 '저장', '취소' 단추가 좁아 글자가 세로로 한 자씩 꺾인다 ('저/장', '취/소'). en 320폭(22)은 단추가 아래 줄로 내려가 괜찮다
- 12, 13, 20, 21: 찾기 칸의 지우기(x) 그림이 브라우저 기본 파란색이다 (어두운 모드에서는 흰색)
- 20: en 'cat' 찾기에 'duplicate' 가 든 대화도 나온다 (낱말이 아니라 글자 조각으로 찾는다)
