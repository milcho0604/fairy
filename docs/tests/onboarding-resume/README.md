# 첫 안내 이어보기와 가져오기 이름 (#149)

## 처리한 항목

1. 첫 안내의 두 번째 쪽을 `일 시작과 마치는 시간` / `Your work hours`로 바꾸고 평일 오전 9시~오후 6시 예시를 넣었다.
2. 데이터 탭의 가져오기를 `백업 파일에서 복원` / `페어리 파일에서 가져오기`로 구분했다. 영어도 같은 뜻으로 바꿨다. 파일 선택·검증·복원 확인은 기존 경로를 사용한다. Codex 펫 ZIP도 기존처럼 페어리 파일 선택에서 고를 수 있다.
3. 안내를 닫거나 앱을 종료해도 완료로 처리하지 않는다. 쪽을 옮길 때마다 `settings.json`의 `onboardPage`에 0~3을 저장하고 다음 실행에서 그 쪽을 연다. 처음부터 있던 설정과 잘못된 값은 첫 쪽으로 읽는다.

`시작`과 `건너뛰기`만 `onboarded=true`로 바꾸고 저장한 쪽을 0으로 되돌린다.
첫 여정과 첫 할 일 유도도 이때 한 번만 시작한다. 완료한 사람이 설정에서 다시 보는 안내는
첫 쪽부터 열리고, 다시 닫아도 완료 상태가 유지된다.

## 함께 발견한 회귀

기존 설정 시험에서 스크롤 직후 탭을 옮기면 scroll 이벤트가 오기 전에 전환되어 위치를 잃는 경우가 나왔다.
이벤트 저장에 더해 탭·검색 전환 직전 실제 scrollTop도 저장하도록 보강했다.
같은 CDP 실행 안에서 스크롤과 탭 클릭을 연달아 넣는 시험은 보강 전 빌드에서 실패하고 보강 후 통과했다.

## 검증 (2026-10-25)

- `npm run check`: 타입 검사·lint·단위 시험 2,301개 통과
- `npm run build`: 통과
- `onboarding-resume.mjs`: 한국어·영어 각 17개 통과
- `settings-polish.mjs`: 한국어·영어 각 57개 통과 (빠른 탭 전환 세 폭 추가)
- 안내 닫기 뒤 디스크의 미완료 상태·쪽 저장, 재열기, 앱 종료/재시작 뒤 자동 이어보기, 마지막 쪽에 도착만 했을 때 미완료 유지
- 시작/건너뛰기의 명시적 완료, 첫 여정 한 번 실행, 완료 뒤 다시 보기·앱 재시작, 이름과 일하는 시간 유지
- 변경한 두 단추를 실제로 눌러 백업과 펫 파일 거르개로 각각 이어지는지 확인 (OS 파일 선택기는 취소 응답으로 대체)
- 한국어·영어 기본/좁은 창, 밝은/어두운 설정 화면 확인. 실제 폭 320을 검사하도록 시험 인스턴스만 최소 폭을 낮추고 창 크기를 확인한다.

```bash
npm run check
npm run build
OUT=/tmp/fairy-onboarding LANG_UNDER_TEST=ko node scripts/dev/onboarding-resume.mjs
OUT=/tmp/fairy-onboarding LANG_UNDER_TEST=en node scripts/dev/onboarding-resume.mjs
OUT=/tmp/fairy-settings LANG_UNDER_TEST=ko node scripts/dev/settings-polish.mjs
OUT=/tmp/fairy-settings LANG_UNDER_TEST=en node scripts/dev/settings-polish.mjs
```

시험은 빈 사용자 데이터·임시 HOME·`JJ_NO_FOCUS=1`로 내장 화면에 숨겨 띄우고 CDP만 사용한다.
종료할 때 디버거 연결, 앱 프로세스, 임시 데이터를 정리한다. 결과와 화면은 OUT에 남긴다.
