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
| C6 | 답변 실시간 표시 | C2 에 `--include-partial-messages` 추가 | 답이 여러 조각 이벤트로 나뉘어 온다 | 통과. 조각 27개, 첫 글자 5.0초 |
| C7 | 로그아웃 상태 | 로그아웃한 계정이나 다른 HOME 으로 C1, C2 실행 | C1 이 false 또는 0 이 아닌 종료 코드. C2 는 오류 이벤트 | 미실행 |
| C8 | 사용 한도 초과 | 한도에 걸린 상태에서 C2 | 오류 문구를 받아 펫 말풍선으로 바꿀 수 있다 | 미실행 (한도에 걸렸을 때 기회 실행) |
| C9 | 중단 | 답변 도중 프로세스 종료 (SIGTERM) | 2초 안에 끝나고 고아 프로세스가 남지 않는다 | 미실행 |
| C11 | MCP 도구 새는지 | C2 를 여러 번, `system/init` 의 `tools` 개수와 `result.usage` 입력 토큰 | 늘 도구 0개, 입력 약 10K 토큰 | 통과 (2026-10-02). 빈 MCP 설정 없이는 한 번 106개, 104,171 토큰이 실렸다. `--strict-mcp-config --mcp-config '{"mcpServers":{}}' --disable-slash-commands` 로 고정 |
| C12 | 사용량 | 출력의 `rate_limit_event` | `unifiedWindows` 에 5시간, 7일 `utilization` 과 `resetsAt` | 통과 (2026-10-02). 앱 표시 5시간 58%, 7일 63% |
| C10 | 펫 MCP 연결 | `--mcp-config pet-mcp.json --strict-mcp-config` | 채팅에서 "오늘 할 일 알려줘"가 펫 할 일을 읽는다 | 미실행 (펫 MCP 서버 구현 후) |

## Codex (`codex`)

2026-10-01 19시 첫 실행은 사용 한도 초과로 중단됐고, 같은 날 20:35에 다시 돌려 모두 통과했다.

| ID | 확인할 것 | 명령 | 통과 기준 | 결과 |
| --- | --- | --- | --- | --- |
| X1 | 로그인 상태 확인 | `codex login status` | "Logged in" 문구, 종료 코드 0 | 통과 (2026-10-01) |
| X2 | 이미지 질문 | `codex exec "이 그림의 제목 글자만 한 줄로 답해" --json --skip-git-repo-check --ephemeral -s read-only -i t.png < /dev/null` | `item.completed` 의 agent_message 에 제목이 나온다 | 통과. 9.4초. 입력 25,073 토큰 (사용자 스킬과 설정이 같이 실림) |
| X3 | 사용 한도 초과 문구 | X2 를 한도 초과 상태에서 실행 | `turn.failed` 의 `error.message` 에 재시도 가능 시각이 들어 있다 | 통과. "try again at 7:48 PM" 형식 확인 |
| X4 | 대화 이어가기 | 1차 X2 에서 `--ephemeral` 빼고 `thread.started` 의 `thread_id` 저장, 2차 `codex exec resume <thread_id> "아까 답 다시 말해"` | 2차가 1차 맥락을 안다 | 통과. 2차 4.7초. 이어 갈수록 입력이 쌓인다 (1차 25,608, 2차 54,099 토큰) |
| X5 | 성격 지시 | `-c developer_instructions="<성격 지시>"` | 반말로 짧게 답한다 | 통과. "네가 말 걸어줘서 반가워" (이모지를 붙이는 버릇이 있어 지시에 넣을지 정한다) |
| X6 | 사용자 설정 격리 | 임시 폴더를 `CODEX_HOME` 으로 두고 `auth.json` 만 심볼릭 링크 | 사용자 스킬, MCP 경고가 나오지 않는다 | 통과. 스킬 경고가 사라지고 입력 25,073 에서 19,063 토큰으로 줄었다 |
| X7 | 중단 | 답변 도중 SIGTERM | 2초 안에 끝난다 | 통과. 0.03초, 하위 프로세스도 남지 않음 |
| X9 | 이어가기와 그림 같이 | `codex exec resume <id> "<질문>" --json --skip-git-repo-check -c sandbox_mode="read-only" -i <파일>` | 앞 대화를 기억하고 그림도 읽는다 | 통과 (2026-10-02). resume 에는 `-s` 가 없다 |
| X10 | 사용량 | `CODEX_HOME/sessions/연/월/일/rollout-*-<thread_id>.jsonl` 의 마지막 `rate_limits` | `primary`(300분), `secondary`(10080분) 의 `used_percent`, `resets_at`, `plan_type` | 통과 (2026-10-02). 5시간 27%, 7일 58%, plus |
| X8 | 응답 시간 | X2 를 격리 상태로 3번 | 중앙값을 기록한다 (목표: 답 10초 안) | 통과. 8.3, 8.6, 10.1초, 중앙값 8.6초. 3번 중 1번은 제목 한 단어를 잘못 읽음 (320px 작은 그림) |

## 알아낸 함정

- **codex `-i` 는 파일을 여러 개 받는다.** `-i t.png "질문"` 순서로 쓰면 질문까지 이미지 파일로 먹고 "No prompt provided" 로 끝난다. 질문을 앞에 두거나 `--` 로 끊는다.
- **codex 는 표준 입력을 기다린다.** 앱에서 부를 때 표준 입력을 바로 닫는다 (`< /dev/null` 과 같은 효과).
- **codex 는 경고도 `item.completed` 의 `error` 항목으로 보낸다.** 예: 스킬 설명이 줄었다는 경고. 오류 판정은 `turn.failed` 로만 한다.
- **claude 는 사용자 훅과 설정을 그대로 탄다.** 격리하지 않으면 사용자의 훅 6개가 펫 채팅마다 실행됐다. 기본은 `--setting-sources ""` 로 격리하고, 설정에서 "내 Claude 설정 그대로 쓰기"를 고를 수 있게 한다.
- **앱을 Finder 에서 열면 PATH 가 짧다.** `/usr/bin:/bin:/usr/sbin:/sbin` 만으로는 `~/.local/bin/claude` 를 못 찾는다. 로그인 셸(`$SHELL -lic "command -v claude"`)로 찾으면 되고 약 2초 걸리므로, 찾은 경로를 설정에 저장해 둔다. 2026-10-01 실험 앱에서 확인.
- **codex 는 답을 조각으로 흘려보내지 않는다.** `exec --json` 은 답이 다 만들어진 뒤 `agent_message` 하나로 온다. 그동안 펫은 "생각 중" 동작으로 기다린다. claude 는 조각으로 온다.
- **codex 설정 폴더가 기본 위치가 아닐 수 있다.** 이 컴퓨터에서는 Orca 앱이 `CODEX_HOME` 을 자기 폴더로 바꿔 두었다. 짝꿍은 사용자 설정 위치를 추측하지 말고, 격리 실행 때는 자기 임시 폴더를 쓴다. 로그인 파일 `auth.json` 위치는 `~/.codex` 와 `CODEX_HOME` 둘 다 찾아본다.
- **`--strict-config` 는 쓰지 않는다.** 다른 앱이 넣어 둔 설정 항목 때문에 바로 실패한다.
- **로그 줄이 섞인다.** codex 는 MCP 연결 오류 같은 로그를 표준 출력에 섞어 낸다. JSON 으로 읽히지 않는 줄은 버린다.

## 실행 기록

| 날짜 | 버전 | 실행한 ID | 메모 |
| --- | --- | --- | --- |
| 2026-10-01 | Claude Code 2.1.286 | C1~C5 | 모두 통과 |
| 2026-10-01 | codex-cli 0.155.1 | X1, X3 (X2 시도) | 사용 한도 초과. 19:48 이후 재시도 가능 |
| 2026-10-01 20:35 | codex-cli 0.155.1 | X2, X4~X8 | 모두 통과. 격리, 성격 지시, 이어가기, 중단 확인 |
| 2026-10-02 | Claude Code 2.1.287, codex-cli 0.155.1, 앱 채팅 창 | C2, C5, C11, C12, X2, X9, X10 | 모두 통과. claude 에 빈 MCP 설정 필요(C11) |
| 2026-10-01 | Electron 44.5.1 실험 앱 | C2, C3, C4, C6 | 앱 프로세스에서 이미지 질문 성공. 첫 글자 5.0초, 조각 27개 (C6 통과) |
