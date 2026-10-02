# 개발 점검 도구

실제 앱을 띄워 놓고 화면(DevTools 포트)과 메인 프로세스(디버거)를 움직여 확인하는 도구다. 사람 마우스를 쓰지 않는다.

```bash
npm run build
npx electron --inspect=9229 . --remote-debugging-port=9344 &
OUT=/tmp/jj-shots node scripts/dev/audit-chat.mjs   # 채팅 창 상태별 화면, 가로 넘침 검사
OUT=/tmp/jj-shots node scripts/dev/audit-pet.mjs    # 펫과 말풍선 위치, 크기, 어두운 모드
OUT=/tmp/jj-shots node scripts/dev/panel.mjs        # 패널: 할 일 넣기, 끝내기, 되돌리기, 밥, 빠른 입력
OUT=/tmp/jj-shots node scripts/dev/settings.mjs     # 설정 창: 이름, 크기, 돌아다니기
OUT=/tmp/jj-shots PHOTO=<사진> node scripts/dev/maker.mjs  # 사진으로 펫 만들기 전체
```

- `cdp.mjs`: 메인 디버거(9229)에서 식 실행(`main`), 창 페이지 찾기(`page`), 화면 찍기, 어두운 모드
- 메인 쪽 개발용 손잡이는 `globalThis.__jj` (`src/main/index.ts`, 설치한 앱에는 없다). 상태 넣기: `__jj.chat.debugSetState`, `__jj.pet.debugMoveTo`, `__jj.pet.debugScale`
- 펫 화면 쪽 손잡이는 `window.__pet` (`setInputs`, `requestActivity`, `mood`)
- 시험이 만든 할 일, 사진 펫, 위치는 끝나고 되돌린다. 할 일 저장 파일은 사용자 데이터 폴더의 `jjakkung.db`
