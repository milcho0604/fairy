# AI CLI 연동 검증 시나리오

짝꿍이 로컬 AI CLI(claude, codex)를 부르는 방식이 실제로 되는지 확인하는 시나리오다. 기획서 "AI 연동 규격"의 근거가 된다. 결과는 표의 "결과" 칸과 아래 "실행 기록"에 남긴다.

## 준비

- 작은 테스트 이미지 하나 (예: 폭 320px PNG). 글자가 들어 있어 답이 맞는지 판정할 수 있어야 한다.
- 이미지를 stream-json 입력으로 바꾸는 한 줄 (macOS):

```bash
B=$(base64 -i t.png | tr -d '\n')
printf '{"type":"user","message":{"role":"user","content":[{"type":"image","source":{"type":"base64","media_type":"image/png","data":"%s"}},{"type":"text","text":"이 그림의 제목 글자만 한 줄로 답해"}]}}\n' "$B" > in.jsonl
```

- 판정은 출력의 마지막 이벤트로 한다. claude 는 `type: result`, codex 는 `turn.completed` 또는 `turn.failed`.

## Claude Code (`claude`)

| ID | 확인할 것 | 명령 | 통과 기준 | 결과 |
| --- | --- | --- | --- | --- |
| C1 | 로그인 상태 확인 | `claude auth status` | JSON 의 `loggedIn` 이 true, 종료 코드 0 | 통과 (2026-10-01) |
| C2 | 이미지 질문 | `claude -p --input-format stream-json --output-format stream-json --verbose --tools "" --no-session-persistence < in.jsonl` | `result` 이벤트의 답에 그림 제목이 맞게 나온다 | 통과. 모델 4.0초, 전체 7초 |
| C3 | 사용자 설정 격리 | C2 에 `--setting-sources ""` 추가 | `system/hook_started` 이벤트가 0개 | 통과. 격리 전 6개, 격리 후 0개 |
| C4 | 성격 지시 | `--append-system-prompt "너는 데스크톱 펫 짝꿍이다. 반말로 짧게 답한다."` | 반말로 짧게 답한다 | 통과 |
| C5 | 대화 이어가기 | 1차 `--session-id <uuid>`, 2차 `--resume <uuid>` | 2차에서 1차 내용을 기억한다 | 통과. 1차 3.4초, 2차 4.2초 |
| C6 | 답변 실시간 표시 | C2 에 `--include-partial-messages` 추가 | 답이 여러 조각 이벤트로 나뉘어 온다 | 미실행 |
| C7 | 로그아웃 상태 | 로그아웃한 계정이나 다른 HOME 으로 C1, C2 실행 | C1 이 false 또는 0 이 아닌 종료 코드. C2 는 오류 이벤트 | 미실행 |
| C8 | 사용 한도 초과 | 한도에 걸린 상태에서 C2 | 오류 문구를 받아 펫 말풍선으로 바꿀 수 있다 | 미실행 (한도에 걸렸을 때 기회 실행) |
| C9 | 중단 | 답변 도중 프로세스 종료 (SIGTERM) | 2초 안에 끝나고 고아 프로세스가 남지 않는다 | 미실행 |
| C10 | 펫 MCP 연결 | `--mcp-config pet-mcp.json --strict-mcp-config` | 채팅에서 "오늘 할 일 알려줘"가 펫 할 일을 읽는다 | 미실행 (펫 MCP 서버 구현 후) |

## Codex (`codex`)

2026-10-01 첫 실행은 사용 한도 초과로 중단됐다. 아래는 한도가 넉넉할 때 다시 돌린다.

| ID | 확인할 것 | 명령 | 통과 기준 | 결과 |
| --- | --- | --- | --- | --- |
| X1 | 로그인 상태 확인 | `codex login status` | "Logged in" 문구, 종료 코드 0 | 통과 (2026-10-01) |
| X2 | 이미지 질문 | `codex exec "이 그림의 제목 글자만 한 줄로 답해" --json --skip-git-repo-check --ephemeral -s read-only -i t.png < /dev/null` | `item.completed` 의 agent_message 에 제목이 나온다 | **대기**. 한도 초과로 실패 |
| X3 | 사용 한도 초과 문구 | X2 를 한도 초과 상태에서 실행 | `turn.failed` 의 `error.message` 에 재시도 가능 시각이 들어 있다 | 통과. "try again at 7:48 PM" 형식 확인 |
| X4 | 대화 이어가기 | 1차 X2 에서 `--ephemeral` 빼고 `thread.started` 의 `thread_id` 저장, 2차 `codex exec resume <thread_id> "아까 답 다시 말해"` | 2차가 1차 맥락을 안다 | **대기** |
| X5 | 성격 지시 | 프롬프트 앞에 성격 지시를 붙이거나 `-c` 로 지시문 설정 | 반말로 짧게 답한다 | **대기**. 적절한 설정 키부터 확인 |
| X6 | 사용자 설정 격리 | 빈 `CODEX_HOME` 이나 `--profile` 로 실행 | 사용자 스킬, MCP 경고가 나오지 않는다 | **대기** |
| X7 | 중단 | 답변 도중 SIGTERM | 2초 안에 끝난다 | **대기** |
| X8 | 응답 시간 | X2 를 3번 | 중앙값을 기록한다 (목표: 첫 글자 10초 안) | **대기** |

## 알아낸 함정

- **codex `-i` 는 파일을 여러 개 받는다.** `-i t.png "질문"` 순서로 쓰면 질문까지 이미지 파일로 먹고 "No prompt provided" 로 끝난다. 질문을 앞에 두거나 `--` 로 끊는다.
- **codex 는 표준 입력을 기다린다.** 앱에서 부를 때 표준 입력을 바로 닫는다 (`< /dev/null` 과 같은 효과).
- **codex 는 경고도 `item.completed` 의 `error` 항목으로 보낸다.** 예: 스킬 설명이 줄었다는 경고. 오류 판정은 `turn.failed` 로만 한다.
- **claude 는 사용자 훅과 설정을 그대로 탄다.** 격리하지 않으면 사용자의 훅 6개가 펫 채팅마다 실행됐다. 기본은 `--setting-sources ""` 로 격리하고, 설정에서 "내 Claude 설정 그대로 쓰기"를 고를 수 있게 한다.
- **로그 줄이 섞인다.** codex 는 MCP 연결 오류 같은 로그를 표준 출력에 섞어 낸다. JSON 으로 읽히지 않는 줄은 버린다.

## 실행 기록

| 날짜 | 버전 | 실행한 ID | 메모 |
| --- | --- | --- | --- |
| 2026-10-01 | Claude Code 2.1.286 | C1~C5 | 모두 통과 |
| 2026-10-01 | codex-cli 0.155.1 | X1, X3 (X2 시도) | 사용 한도 초과. 19:48 이후 재시도 가능 |
