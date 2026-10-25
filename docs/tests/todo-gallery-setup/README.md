# 새 할 일 표시와 첫 실행 보완 (#146, #149)

## 처리 범위

- 할 일 탭에서 추가한 줄을 찾아 화면 안으로 옮기고 1초 동안 테두리로 강조한다. 입력 포커스는 유지한다. 100개씩 나누어 그리는 목록은 새 줄을 포함할 만큼만 펼친다. 여러 줄을 붙여 넣으면 마지막으로 추가한 할 일을 표시한다.
- 검색이나 태그가 새 항목을 가리면 조건을 유지하며 추가 안내와 `보기`를 보여 준다. 보기를 누를 때 검색·태그를 풀고 새 줄로 간다. 안내는 긴 제목에서도 두 줄로 제한한다.
- 갤러리의 내장 밀크·초코는 `이미 있어요`로 표시하고 위쪽 모습에서 고르는 방법을 알린다. 받기 단추와 실제 가져오기 요청 모두 중복을 막는다. 다른 갤러리 항목의 받기 경로는 유지한다.
- 첫 안내에 다섯 번째 설정 쪽을 추가한다. 자동 실행, 컴퓨터 상태 아이콘, 같이 타자 치기를 설명하고 선택하게 한다. 기존 네 쪽의 번호와 미완료 이어보기 위치는 유지한다.

자동 실행은 기존 로그인 항목 정책을 따른다. 설치판이 실제 사용자 데이터를 사용할 때만 선택할 수 있고,
개발·격리 실행에서는 비활성화한다. 메인도 이때 자동 실행 변경 요청을 적용하지 않는다.
컴퓨터 상태와 같이 타자는 저장한 설정을 즉시 반영하며, 안내를 닫았다 다시 열어도 유지한다.

## 함께 확인한 종료 오류

큰 창을 닫을 때 본문 WebContents가 파괴되면 `view.webContents`가 비워져 closed 듣개에서
`undefined.isDestroyed()` 오류가 났다. 닫기를 연결할 때 원래 WebContents를 잡아 두고 그 객체로 종료 여부를 확인한다.
실제 큰 창 닫기를 CDP 시험에 넣고 uncaught 오류가 없는지 확인했다.

## 검증 (2026-10-25)

- `npm run check`: 타입 검사, lint, 단위 시험 2,302개 통과
- `npm run build`: 통과
- 한국어·영어 각각 신규 시나리오 30개, 첫 안내 이어보기 회귀 17개, 설정 회귀 60개 통과 (각 107개)
- 작은 패널과 큰 창에서 235개 기존 할 일 뒤 새 줄 표시, 입력 포커스, 강조 해제, 검색/태그 유지와 보기, 긴 제목, 여러 줄 붙여넣기, 어두운 화면
- 갤러리는 로컬 HTTP 시험 목록을 사용. 내장 ID 두 개를 내 페어리/친구로 직접 요청해도 파일 다운로드와 펫·보관함·친구 데이터 변경이 없음을 확인
- 내장 항목 외 시험 항목은 파일 받기 경로로 진행하는지 확인 (시험 파일 응답은 404로 두어 실제 입양은 하지 않음)
- 다섯 번째 안내, 설정 저장과 재열기, 시작 단추 완료, 기본 창/작은 창 버튼 접근, 실제 폭 320 화면, 밝은/어두운 화면 확인
- 격리 시험의 자동 실행 UI와 메인 요청 거절을 확인. 사용자 OS 로그인 항목은 읽거나 변경하지 않음. 설치판의 실제 자동 실행 등록은 이 CDP 시험에서 실행하지 않음

```bash
npm run check
npm run build
OUT=/tmp/fairy-146149 LANG_UNDER_TEST=ko node scripts/dev/todo-gallery-setup.mjs
OUT=/tmp/fairy-146149 LANG_UNDER_TEST=en node scripts/dev/todo-gallery-setup.mjs
OUT=/tmp/fairy-onboarding LANG_UNDER_TEST=ko node scripts/dev/onboarding-resume.mjs
OUT=/tmp/fairy-onboarding LANG_UNDER_TEST=en node scripts/dev/onboarding-resume.mjs
OUT=/tmp/fairy-settings LANG_UNDER_TEST=ko node scripts/dev/settings-polish.mjs
OUT=/tmp/fairy-settings LANG_UNDER_TEST=en node scripts/dev/settings-polish.mjs
```

시험 인스턴스는 빈 사용자 데이터·임시 HOME·`JJ_NO_FOCUS=1`로 내장 화면에 숨겨 띄우며 입력과 촬영은 CDP만 사용한다.
시험 앱, 디버거 연결, 로컬 HTTP 서버와 임시 데이터를 마지막에 정리하고 결과와 PNG는 OUT에 남긴다.
