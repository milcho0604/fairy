# 다른 앱에서 페어리 부르기 (fairy:// 주소)

> **English summary.** fairy registers the `fairy://` URL scheme. Other apps (macOS Shortcuts, Raycast,
> Alfred, Windows PowerToys Run, a terminal) can open these links to add a to-do or event, save a memo, start a
> focus timer or open a panel tab. Your fairy confirms in a speech bubble. Only the four actions below exist; unknown
> actions or parameters, repeated parameters and over-long text are rejected, and links never open files or web
> pages. Turn it off in Settings → General → "Accept fairy:// links". Links made for the old name (`jjakkung://`) keep
> working, and the MCP server is now named `fairy` (re-register it if you added the old `jjakkung` server by hand).
>
> | Link | What it does |
> |---|---|
> | `fairy://add?text=meeting%20tomorrow%203pm` | Same as the quick-add line: a time makes it an event, otherwise a to-do (up to 300 characters) |
> | `fairy://memo?text=...` | Saves a memo (multi-line, up to 4000 characters) |
> | `fairy://focus?min=25` | Starts focus. `min` is 15, 25 or 50; omit it to use your last length |
> | `fairy://open?tab=today` | Opens the panel on `today`, `todo`, `memo` or `calendar` |

페어리는 `fairy://` 주소를 받는다. 단축어, Raycast, Alfred, PowerToys Run, 터미널처럼 주소를 열 수 있는 곳이면
어디서든 할 일과 일정을 넣고, 메모를 적고, 집중을 시작하고, 패널을 열 수 있다. 넣으면 페어리가 말풍선으로 무엇을 넣었는지 알려 준다.

끄기: 설정 → 편의 → **fairy:// 주소 받기**. 끄면 주소가 와도 아무것도 넣지 않고, 페어리가 꺼져 있다고만 말한다.

## 동작

| 주소 | 하는 일 |
|---|---|
| `fairy://add?text=내일%203시%20회의` | 빠른 입력 한 줄과 같다. 시각이 있으면 일정, 없으면 할 일 ("금요일까지 보고서!", "매일 아침 7시 스트레칭"). 300자까지 |
| `fairy://memo?text=...` | 메모 하나. 여러 줄(줄바꿈 `%0A`), 4000자까지. 첫 줄이 제목처럼 보인다 |
| `fairy://focus?min=25` | 집중 시작. `min` 은 15, 25, 50 중 하나. 빼면 마지막에 고른 길이. 이미 집중 중이면 그대로 둔다 |
| `fairy://open?tab=today` | 패널을 그 탭으로. `today`, `todo`, `memo`, `calendar`. 빼면 오늘 |

글은 주소 안에 넣으니 **퍼센트 인코딩**해야 한다 (공백 `%20` 또는 `+`, 한글도 인코딩). 단축어와 Raycast 는 알아서 해 준다.

### 안전하게 받기

다른 앱이 아무 주소나 넘길 수 있는 문이라 엄하게 본다 (`src/shared/url-scheme.ts`, 시험 `url-scheme.test.ts`).

- 위 네 동작과 그 칸만 받는다. 모르는 동작, 모르는 칸, 같은 칸 두 번, 사용자 이름, 포트, `#` 이 붙은 주소는 거절한다
- 길이 상한을 넘으면 자르지 않고 거절한다 (잘린 할 일이 조용히 들어가지 않게). 주소 전체도 8KB 까지
- 제어 문자와 글 방향을 바꾸는 문자는 뺀다
- 파일을 열거나 웹 주소로 옮겨 가는 동작은 없다. 글은 할 일, 일정, 메모 제목과 본문으로만 쓰인다
- 10초에 8개까지만 받는다 (웹 페이지가 주소를 마구 열어도 할 일이 쌓이지 않게)
- 넣은 글은 진단 기록에 남기지 않는다 (동작 이름만)

## macOS 단축어

1. 단축어 앱 → 새 단축어 → **입력 요청** (텍스트, "무엇을 넣을까?")
2. **URL 인코딩** 동작으로 입력을 인코딩
3. **텍스트** 동작: `fairy://add?text=` 뒤에 인코딩한 값을 붙인다
4. **URL 열기**

메뉴 막대나 키보드 단축키(단축어 설정 → 단축키 추가), Siri("페어리에 넣어")로 부를 수 있다.
집중 시작은 **URL 열기** 하나로 충분하다: `fairy://focus?min=25`

터미널에서 시험:

```bash
open "fairy://add?text=$(python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))' '내일 3시 회의')"
open "fairy://open?tab=calendar"
```

## Raycast (Script Command)

Raycast → Extensions → Script Commands → 폴더를 하나 정하고 아래 파일을 넣는다 (`chmod +x`).

```bash
#!/bin/bash
# @raycast.schemaVersion 1
# @raycast.title 페어리에 넣기
# @raycast.mode silent
# @raycast.icon 🐾
# @raycast.argument1 { "type": "text", "placeholder": "내일 3시 회의" }
q=$(python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))' "$1")
open "fairy://add?text=$q"
```

메모는 `add` 를 `memo` 로, 집중은 인자 없이 `open "fairy://focus?min=25"`.

## Alfred (Workflow)

1. Alfred Preferences → Workflows → **+** → Blank Workflow
2. **Inputs → Keyword**: 키워드 `jj`, Argument Required
3. **Actions → Open URL**: `fairy://add?text={query}` (Alfred 가 `{query}` 를 인코딩한다. "Encode" 옵션 켜기)
4. 둘을 잇는다. 이제 Alfred 에서 `jj 금요일까지 보고서!`

메모용 키워드(`jjm` → `fairy://memo?text={query}`), 집중용(`jjf` → `fairy://focus?min=25`)도 같은 방법.

## Windows PowerToys Run

PowerToys Run(Alt+Space)의 **URI 처리기** 플러그인은 주소를 그대로 연다. 입력창에 바로 적는다:

```
fairy://add?text=내일 3시 회의
fairy://focus?min=25
fairy://open?tab=todo
```

PowerToys Run 은 공백이 있는 주소도 연다. 다른 곳(배치 파일, 작업 스케줄러)에서는 인코딩한다:

```powershell
Start-Process ("fairy://add?text=" + [uri]::EscapeDataString("내일 3시 회의"))
```

## 페어리가 꺼져 있으면

주소를 열면 페어리가 켜지고, 페어리가 뜬 뒤에 처리한다. 이미 켜져 있으면 그 페어리가 받는다 (두 번째로 뜨지 않는다).

## .fairy 페어리 파일

설치한 페어리는 `.fairy` 파일과, 예전 이름(짝꿍) 때의 `.jjpet` 파일에 연결된다. 파일을 두 번 누르면 설정 → 페어리 가져오기와 같은 검사(크기, 형식)를 거치고,
지금 페어리를 바꿀지 묻는다. 형식은 페어리 파일 문서를 따른다.

## 예전 이름(짝꿍)에서 옮기기

- 예전에 만든 `jjakkung://...` 단축어, Raycast, Alfred 명령은 그대로 된다. 페어리가 `jjakkung://` 도 같은 주소로 받고 운영체제에 같이 등록한다. 새로 만들 때는 `fairy://` 를 쓴다.
- `.jjpet` 파일도 그대로 두 번 눌러 열린다. 새로 내보내는 파일은 `.fairy`.
- **MCP 서버**: 이름이 `jjakkung` 에서 `fairy` 로 바뀌었다 (도구 이름 `add_todo` 등은 그대로라 Claude Code 에서는 `mcp__fairy__add_todo`). 페어리 채팅이 부르는 것은 저절로 바뀐다. Claude Code, Codex 에 직접 등록해 뒀다면 실행 파일 경로도 바뀌었으니 예전 것을 지우고 설정 → AI → "다른 AI에서 페어리 쓰기"의 새 명령으로 다시 등록한다:
  ```bash
  claude mcp remove jjakkung -s user
  claude mcp add fairy -s user -e ELECTRON_RUN_AS_NODE=1 -- <설정에서 복사한 경로들>
  ```
  Codex 는 `~/.codex/config.toml` 의 `[mcp_servers.jjakkung]` 조각을 지우고 새 `[mcp_servers.fairy]` 조각을 붙인다. MCP 서버는 새 데이터 폴더가 아직 없으면(페어리를 한 번도 켜지 않았으면) 예전 `jjakkung` 폴더를 읽는다.

## 개발자 메모

- 등록: `electron-builder.yml` 의 `protocols`, `fileAssociations`. 설치판만 운영체제에 등록한다
  (`app.setAsDefaultProtocolClient`). 개발 실행과 시험(`JJ_USER_DATA`)은 설치한 페어리의 주소를 가로채지 않는다
- 받기: `src/main/open-handler.ts` (맥 `open-url`, `open-file`, 윈도우와 리눅스는 명령줄 인자와 `second-instance`)
- 개발 실행에서 시험: 메인 디버거에서 `__jj.handleUrl('fairy://add?text=...')`
