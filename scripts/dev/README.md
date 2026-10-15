# 개발 점검 도구

실제 앱을 띄워 놓고 화면(DevTools 포트)과 메인 프로세스(디버거)를 움직여 확인하는 도구다. 사람 마우스를 쓰지 않는다.

개발용 환경 변수는 앱 이름이 페어리(fairy)로 바뀐 뒤에도 예전 머리 `JJ_` 그대로다 (`JJ_NO_FOCUS`, `JJ_USER_DATA`, `JJ_SHOW` 등. 사용자에게 안 보이고, 스크립트와 CI 가 같이 쓴다). `JJ_USER_DATA` 를 주면 예전 `jjakkung` 데이터 폴더 옮기기(src/main/data-move.ts)도 하지 않는다. 옮기기를 시험하려면 `XDG_CONFIG_HOME=<빈 폴더>` 아래에 `jjakkung/` 을 심고 띄운다 (리눅스).

```bash
npm run build
JJ_NO_FOCUS=1 JJ_USER_DATA=<빈 폴더> npx electron --inspect=9229 . --remote-debugging-port=9344 &   # 맥북 화면에만, 포커스 안 뺏음
OUT=/tmp/jj-shots node scripts/dev/audit-chat.mjs   # 채팅 창 상태별 화면, 가로 넘침 검사
OUT=/tmp/jj-shots node scripts/dev/audit-pet.mjs    # 페어리와 말풍선 위치, 크기, 어두운 모드
node scripts/dev/pet-moves.mjs                     # 움직임과 입력이 겹칠 때: 뛰다 잡기, 걷다 크기 바꾸기, 끄는 동안 온 답, 친구 자리, 숨긴 동안 온 친구 (PASS/FAIL)
OUT=/tmp/jj-shots node scripts/dev/panel.mjs        # 패널: 할 일 넣기, 끝내기, 되돌리기, 밥, 빠른 입력
OUT=/tmp/jj-shots node scripts/dev/settings.mjs     # 설정 창: 이름, 크기, 돌아다니기
OUT=/tmp/jj-shots PHOTO=<사진> node scripts/dev/maker.mjs  # 사진으로 페어리 만들기 전체
```

- `screens.mjs`: 문서 화면 `docs/assets/screens/` 를 다시 찍는다 (페어리 줄, 모습, 바탕 화면, 설정, 패널, 채팅, 빠른 입력, 시작 안내, 페어리 만들기). 앱을 직접 띄우고(빈 데이터 폴더, `JJ_NO_FOCUS=1`, 포트 9851/9852) 지어낸 할 일, 일정, 메모, 대화를 넣어 창을 2배로 찍은 뒤 숨은 창에서 한 장으로 합친다. 리눅스에서는 `npm run build && xvfb-run -a -s "-screen 0 1512x982x24" node scripts/dev/screens.mjs [pets|styles|desktop|settings|panel|chat|quick|onboarding|maker]`. 만들기 화면은 받아 둔 배경 지우기 모델이 있어야 한다(`JJ_BG_MODEL=<isnet-general-use.onnx>`). 맥 글꼴과 비슷하게 찍으려면 Pretendard 를 fontconfig 로 "Apple SD Gothic Neo" 에 잇는다(`FONTCONFIG_FILE`). 창 화면(설정, 패널, 채팅, 만들기 등)은 찍은 뒤 256색으로 줄여 용량을 반쯤으로 줄였다(Pillow `quantize(256)`, 사진이 든 desktop, pets, pet-styles 는 그대로). 끝나면 데이터 폴더를 지운다
- `smoke-packaged.mjs`: 설치판(`electron-builder --dir`) 켜 보기 시험. CI 의 리눅스 묶음 시험이 쓴다
- `cdp.mjs`: 메인 디버거(9229)에서 식 실행(`main`), 창 페이지 찾기(`page`), 화면 찍기, 어두운 모드. 다른 포트로 띄웠으면 `JJ_INSPECT_PORT`, `JJ_PAGE_PORT`
- 메인 쪽 개발용 손잡이는 `globalThis.__jj` (`src/main/index.ts`, 설치한 앱에는 없다). 상태 넣기: `__jj.chat.debugSetState`, `__jj.pet.debugMoveTo`, `__jj.pet.debugScale`
- 페어리 화면 쪽 손잡이는 `window.__pet` (`setInputs`, `requestActivity`, `mood`). 움직임 점검: 페이지에서 `performance.now` 를 가상 시계로 바꿔 끼우고 `__pet.debugFrame()` 으로 한 틀씩 그리면(돌려준 값이 다음 틀까지 ms) 느린 가상 화면(swiftshader)에서도 앱이 고른 빠르기 그대로 틀을 찍는다. `__pet.debugFeetLog(true)` 는 입체 발바닥 자리와 디딘 발인지(두 발, 앉은 네 발, 네 발로 선 몸)를 모은다
- 실제 데이터를 건드리지 않으려면 `JJ_USER_DATA=<빈 폴더>` 로 따로 띄운다(하나만 띄우기 잠금도 따로라 쓰는 앱과 같이 뜬다). 진단 기록은 그 폴더의 `logs/main.log`(1MB 넘으면 `main.old.log`)에 남는다
- `JJ_NO_FOCUS=1`(시험 인스턴스, 늘 켠다): 창을 처음부터 맥북 내장 화면에 연다(`src/main/focus.ts` `confineTestDisplay`. 앱이 내장 화면만 있는 것처럼 본다). 창은 투명하게 숨기고 마우스를 통과시켜 사람이 실수로 잡지 못하고, 창을 앞으로 가져와 입력을 뺏지도 않는다. 화면은 CDP 로 찍고 입력도 CDP 로 넣는다. 띄운 뒤 옮기는 방식은 쓰지 않는다: 옮기기 전에 작업 모니터에 잠깐 떠 버린다 (규칙은 `CLAUDE.md`)
- 시험 실행(`JJ_NO_FOCUS=1` 이나 `JJ_USER_DATA`, 설치판 아님)은 진짜 키체인을 건드리지 않는다: 메인이 시작 직후 Chromium 에 가짜 열쇠고리(맥 `use-mock-keychain`, 리눅스 `password-store=basic`)를 붙인다 (`src/main/test-keychain.ts`). 서버 토큰까지 메모리에만 두려면 `JJ_TEST_SECRETS=memory` (서버 계정 시험이 쓴다)
- `JJ_SHOW=1`: `JJ_NO_FOCUS=1` 과 같이 쓰면 숨기지 않고 보이게 둔다(사람이 눈으로 봐야 할 때만). 맥북 화면 안, 입력 안 뺏기는 그대로
- v1: `__jj.notes`, `__jj.events`, `__jj.planner`(집중 `startFocus`, 알림과 브리핑 `check`). 패널은 다른 곳을 누르면 닫혀서 시험 때는 `__jj.panel.window.removeAllListeners('blur')`. 집중 끝은 메인에서 `Date.now` 를 10초씩 앞당기며 `await planner.check()` 를 되풀이한다(한 번에 25분을 건너뛰면 `skipGap` 이 잠자기로 보고 집중 시간을 그만큼 뒤로 미뤄 끝나지 않는다. `src/shared/focus.ts`). 되돌린 시계도 뒤로 뛴 것으로 보니 시험 인스턴스는 앞당긴 시계 그대로 둔다
- 페어리 MCP 서버: `npm run build` 뒤 `ELECTRON_RUN_AS_NODE=1 JJ_USER_DATA=<폴더> node_modules/electron/dist/Electron.app/Contents/MacOS/Electron out/main/mcp-server.js` 에 JSON-RPC 줄을 넣는다. 실제 Claude Code 로는 `claude -p "<질문>" --setting-sources "" --strict-mcp-config --mcp-config '<json>' --allowedTools mcp__fairy__add_todo` (질문을 맨 앞에. `--allowedTools` 가 뒤 글을 먹는다)
- 사진 AI 엔진 wasm 은 설치 파일에 없고 처음 쓸 때 CDN 에서 받는다(`src/shared/ort-wasm.ts`). CDN 이 막힌 곳에서는 `node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jspi.wasm` 을 이 컴퓨터 http 서버로 내주고 `JJ_ORT_WASM_URL=http://127.0.0.1:<포트>/ort-wasm-simd-threaded.jspi.wasm` 로 띄운다(해시는 똑같이 맞춘다)
- 무료 AI 엔진(llama.cpp)도 설치 파일에 없고 처음 모델을 받을 때 npm 저장소에서 받는다(`src/shared/llama-bins.ts`). 막힌 곳에서는 `npm pack @node-llama-cpp/linux-x64@<판>` 으로 받은 .tgz 를 이 컴퓨터 http 서버로 내주고 `JJ_LLAMA_BINS_URL=http://127.0.0.1:<포트>/<파일>.tgz` 로 띄운다(해시는 똑같이 맞춘다). 받은 엔진은 데이터 폴더의 `engines/llama-<패키지>-<판>/`
- 업데이트 시험: `JJ_RELEASES_API=http://127.0.0.1:<포트>/latest` 로 가짜 릴리스 서버를 가리킨다(설치판이 아닌 `npx electron .` 실행에서만, 이 컴퓨터 주소만). 비공개 레포는 토큰 없이 404 라서. 본문에 `min-version:` 을 넣으면 강제 업데이트를 본다
- 공지 창 시험: `npm run build && OUT=<폴더> LANG_UNDER_TEST=ko node scripts/dev/notices.mjs`. 앱을 직접 띄우고(빈 데이터 폴더, `JJ_NO_FOCUS=1`, 환경 변수 비움, 포트 9861/9862) 이 컴퓨터 http 서버로 `notices.json`(`JJ_NOTICES_URL`)과 가짜 릴리스(`JJ_RELEASES_API`)를 내준다. 종류 넷을 밝은, 어두운 모드로 찍고 하루 상한, 집중 중 미루기, 두 번 받기, 높은 minVersion, 깨진 파일, 큰 파일, 오프라인, 강제 창이 떠 있을 때 끝내기를 PASS/FAIL 로 본다. 본 기록을 비우는 손잡이는 `__jj.notices.debugForget()`
- 서버 계정 시험 (#99): `npm run build && (cd server && npm run build) && OUT=<폴더> LANG_UNDER_TEST=ko node scripts/dev/server-account.mjs`. 시험용 Postgres 컨테이너(`jj-server-test-pg-<무작위>`)와 `server/dist` 를 무작위 포트로 띄우고(구글 값 비움) 앱을 `JJ_SERVER_URL_OVERRIDE` 로 붙인다(빈 데이터 폴더, `JJ_NO_FOCUS=1`, 포트 9871/9872). 나이 확인, 기기 계정과 옮기기, 코인 맞추기와 서버 잔액, 서버 끔/켬, 거절된 구매 되돌리기, 만 14세 미만 전환, 탈퇴를 PASS/FAIL 로 보고 설정 칸을 찍는다. 끝나면 컨테이너와 폴더를 지운다. 메인 손잡이는 `__jj.server.core` (`status()`, `run()`, `setAge()`)
- AI 대화권 시험 (#100): `npm run build && (cd server && npm run build) && OUT=<폴더> LANG_UNDER_TEST=ko node scripts/dev/server-ai.mjs`. 서버 계정 시험과 같이 시험용 Postgres 컨테이너와 `server/dist` 를 띄우고, 가짜 Anthropic(`server/scripts/fake-anthropic.mjs`, 진짜 Anthropic 은 부르지 않는다)을 `ANTHROPIC_BASE_URL` 로 붙인다. 시험 서버는 구글 값이 비어 로그인은 DB 에 세션을 만들어 `__jj.server.debugSetSession` 으로 넣는다(`JJ_TEST_SECRETS=memory` 일 때만). 첫 로그인 10개, 국외 이전 안내 전 보내기 막힘, 답과 차감, 실패 되돌림, 신고, 내용 미저장(표 전체), 다 씀 안내, 14~17 숨김을 PASS/FAIL 로 보고 채팅 창을 찍는다(포트 9873/9874). 끝나면 컨테이너와 폴더를 지운다. 가짜 Anthropic 은 마지막 질문의 `[[fail]]`, `[[cut]]`, `[[sse-error]]`, `[[slow]]` 로 실패를 흉내 낸다
- 페어리 갤러리 시험: `python3 -m http.server <포트> --bind 127.0.0.1 --directory gallery` 로 레포의 gallery/ 를 내주고 `JJ_GALLERY_URL=http://127.0.0.1:<포트>/` 로 띄운다(설치판이 아닌 실행에서만, 이 컴퓨터 http 주소만). 빈 폴더를 내주면 404(아직 안 열림), 서버를 끄면 인터넷 없음 안내
- 베타 기록: `__jj.stats.tick(시각, 숨김)`, `countLook`, `countCrash` 로 가짜 기록을 넣고 `__jj.settingsWindow.open('stats')`. 비정상 종료 세기는 개발 실행에서 꺼져 있어 `JJ_BETA_CRASH=1` 로 켠다
- 시험이 만든 할 일, 사진 페어리, 위치는 끝나고 되돌린다. 할 일 저장 파일은 사용자 데이터 폴더의 `jjakkung.db`
- 같이 지내는 느낌: `__jj.together.debugFeed(true)` 는 키보드를 치는 것처럼(진짜 입력은 안 본다, `false` 손 뗌, `undefined` 진짜로), `__jj.together.debugWork()` 는 MCP 를 부른 것처럼. 매일 쪽지는 `__jj.dailyNotes.debugBring()`(오늘 쪽지를 다시 들고 온다, `debugBring(7)` 은 7일 편지), 페어리 화면에서 그림만 볼 때는 `__pet.debugTogether({ typing, working, note }, 두드린ms)`
