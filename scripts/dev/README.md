# 개발 점검 도구

실제 앱을 띄워 놓고 화면(DevTools 포트)과 메인 프로세스(디버거)를 움직여 확인하는 도구다. 사람 마우스를 쓰지 않는다.

```bash
npm run build
JJ_NO_FOCUS=1 JJ_USER_DATA=<빈 폴더> npx electron --inspect=9229 . --remote-debugging-port=9344 &   # 맥북 화면에만, 포커스 안 뺏음
OUT=/tmp/jj-shots node scripts/dev/audit-chat.mjs   # 채팅 창 상태별 화면, 가로 넘침 검사
OUT=/tmp/jj-shots node scripts/dev/audit-pet.mjs    # 펫과 말풍선 위치, 크기, 어두운 모드
OUT=/tmp/jj-shots node scripts/dev/panel.mjs        # 패널: 할 일 넣기, 끝내기, 되돌리기, 밥, 빠른 입력
OUT=/tmp/jj-shots node scripts/dev/settings.mjs     # 설정 창: 이름, 크기, 돌아다니기
OUT=/tmp/jj-shots PHOTO=<사진> node scripts/dev/maker.mjs  # 사진으로 펫 만들기 전체
```

- `cdp.mjs`: 메인 디버거(9229)에서 식 실행(`main`), 창 페이지 찾기(`page`), 화면 찍기, 어두운 모드. 다른 포트로 띄웠으면 `JJ_INSPECT_PORT`, `JJ_PAGE_PORT`
- 메인 쪽 개발용 손잡이는 `globalThis.__jj` (`src/main/index.ts`, 설치한 앱에는 없다). 상태 넣기: `__jj.chat.debugSetState`, `__jj.pet.debugMoveTo`, `__jj.pet.debugScale`
- 펫 화면 쪽 손잡이는 `window.__pet` (`setInputs`, `requestActivity`, `mood`)
- 실제 데이터를 건드리지 않으려면 `JJ_USER_DATA=<빈 폴더>` 로 따로 띄운다(하나만 띄우기 잠금도 따로라 쓰는 앱과 같이 뜬다). 진단 기록은 그 폴더의 `logs/main.log`(1MB 넘으면 `main.old.log`)에 남는다
- `JJ_NO_FOCUS=1`(시험 인스턴스, 늘 켠다): 창을 처음부터 맥북 내장 화면에 연다(`src/main/focus.ts` `confineTestDisplay`. 앱이 내장 화면만 있는 것처럼 본다). 창은 투명하게 숨기고 마우스를 통과시켜 사람이 실수로 잡지 못하고, 창을 앞으로 가져와 입력을 뺏지도 않는다. 화면은 CDP 로 찍고 입력도 CDP 로 넣는다. 띄운 뒤 옮기는 방식은 쓰지 않는다: 옮기기 전에 작업 모니터에 잠깐 떠 버린다 (규칙은 `CLAUDE.md`)
- `JJ_SHOW=1`: `JJ_NO_FOCUS=1` 과 같이 쓰면 숨기지 않고 보이게 둔다(사람이 눈으로 봐야 할 때만). 맥북 화면 안, 입력 안 뺏기는 그대로
- v1: `__jj.notes`, `__jj.events`, `__jj.planner`(집중 `startFocus`, 알림과 브리핑 `check`). 패널은 다른 곳을 누르면 닫혀서 시험 때는 `__jj.panel.window.removeAllListeners('blur')`. 집중 끝은 메인에서 `Date.now` 를 잠깐 바꾸고 `planner.check()`
- 펫 MCP 서버: `npm run build` 뒤 `ELECTRON_RUN_AS_NODE=1 JJ_USER_DATA=<폴더> node_modules/electron/dist/Electron.app/Contents/MacOS/Electron out/main/mcp-server.js` 에 JSON-RPC 줄을 넣는다. 실제 Claude Code 로는 `claude -p "<질문>" --setting-sources "" --strict-mcp-config --mcp-config '<json>' --allowedTools mcp__jjakkung__add_todo` (질문을 맨 앞에. `--allowedTools` 가 뒤 글을 먹는다)
- 업데이트 시험: `JJ_RELEASES_API=http://127.0.0.1:<포트>/latest` 로 가짜 릴리스 서버를 가리킨다(설치판이 아닌 `npx electron .` 실행에서만, 이 컴퓨터 주소만). 비공개 레포는 토큰 없이 404 라서. 본문에 `min-version:` 을 넣으면 강제 업데이트를 본다
- 베타 기록: `__jj.stats.tick(시각, 숨김)`, `countLook`, `countCrash` 로 가짜 기록을 넣고 `__jj.settingsWindow.open('stats')`. 비정상 종료 세기는 개발 실행에서 꺼져 있어 `JJ_BETA_CRASH=1` 로 켠다
- 시험이 만든 할 일, 사진 펫, 위치는 끝나고 되돌린다. 할 일 저장 파일은 사용자 데이터 폴더의 `jjakkung.db`
